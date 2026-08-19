/* Home — the "what needs me right now" screen. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  root.Views.dashboard = function (el) {
    var me = S.me();
    var accounts = S.accounts();
    var vendors = S.all('vendors');
    var wos = S.all('workOrders');
    var today = S.today();

    var opp = S.oppStats();
    var freeAccounts = accounts.filter(S.isFree);

    var overdue = wos.filter(S.isOverdue);
    var dueToday = wos.filter(function (w) {
      return w.status !== 'complete' && (w.scheduledDate === today || w.dueDate === today);
    });

    /* My activities and my deals — this screen answers "what do I do
       now", so it leads with mine and only then shows the team's. */
    var myTasks = S.openTasks({ assigneeId: me.id });
    var myOverdueTasks = myTasks.filter(function (t) { return S.taskState(t).key === 'overdue'; });
    var leadQueue = S.leadsNeedingAttention();

    /* Deals with a close date inside two weeks — the ones that either
       land or slip this fortnight. */
    var closingSoon = S.openOpportunities().filter(function (o) {
      var d = S.daysUntil(o.closeDate);
      return d !== null && d <= 14;
    }).sort(function (a, b) { return String(a.closeDate).localeCompare(String(b.closeDate)); });

    var stripeSubs = S.all('stripeSubscriptions');
    var mrrNow = S.recurringCents();
    var recurring = S.cents(mrrNow.cents);
    var recurringFoot = mrrNow.source === 'stripe'
      ? stripeSubs.filter(function (s) { return s.status === 'active'; }).length + ' active in Stripe'
      : accounts.filter(S.isCustomerAccount).length + ' customer accounts · from contracts';
    var goal = S.goalProgress();

    var openInvoices = S.all('stripeInvoices').filter(function (i) { return i.status === 'open'; });
    var outstanding = openInvoices.reduce(function (s, i) { return s + (Number(i.amountRemainingCents) || 0); }, 0);
    var lateInvoices = openInvoices.filter(function (i) { return i.dueDate && i.dueDate < today; });

    var billingSoon = accounts.concat(vendors)
      .filter(function (r) { var d = S.daysUntil(r.billingDate); return d !== null && d <= 14; })
      .sort(function (a, b) { return (a.billingDate || '').localeCompare(b.billingDate || ''); });

    el.innerHTML =
      '<div class="page-head">' +
        '<div>' +
          '<div class="eyebrow">' + U.esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })) + '</div>' +
          '<h1 class="page-title">Good to see you, ' + U.esc(me.name.split(' ')[0]) + '.</h1>' +
          '<div class="page-sub">' +
            myTasks.length + ' open activit' + (myTasks.length === 1 ? 'y' : 'ies') + ' assigned to you' +
            (myOverdueTasks.length ? ' · <span style="color:var(--danger)">' + myOverdueTasks.length + ' overdue</span>' : '') +
            ' · ' + dueToday.length + ' work order' + (dueToday.length === 1 ? '' : 's') + ' on the board' +
            (leadQueue.length ? ' · ' + leadQueue.length + ' lead' + (leadQueue.length === 1 ? '' : 's') + ' to follow up' : '') +
          '</div>' +
        '</div>' +
        '<div class="page-actions">' +
          '<a class="btn" href="#/pipeline">Pipeline</a>' +
          '<a class="btn" href="#/tracker">Daily Tracker</a>' +
          '<a class="btn btn-primary" href="#/leads?new=1">New Lead</a>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('Open Pipeline', S.money(opp.openValue),
            opp.open + ' deal' + (opp.open === 1 ? '' : 's') + ' · ' + S.money(opp.weighted) + ' weighted' +
            (freeAccounts.length ? ' · ' + freeAccounts.length + ' free' : ''), 'accent') +
        kpi('Recurring / mo', recurring, recurringFoot, 'ok') +
        (outstanding || lateInvoices.length
          ? kpi('Outstanding', S.cents(outstanding),
                lateInvoices.length ? lateInvoices.length + ' past due in Stripe'
                                    : openInvoices.length + ' invoices open',
                lateInvoices.length ? 'danger' : '')
          : kpi('Win Rate', opp.winRate + '%', opp.won + ' won · ' + opp.lost + ' lost', '')) +
        kpi('Overdue Work', String(overdue.length),
            overdue.length ? 'Needs attention today' : 'All clear',
            overdue.length ? 'danger' : 'ok') +
      '</div>' +

      goalCard(goal) +

      '<div class="grid" style="grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);align-items:start">' +

        '<div class="stack">' +
          myActivityCard(myTasks) +
          closingCard(closingSoon, opp) +
          '<div class="card">' +
            '<div class="card-head"><span class="card-title">My Open Work Orders</span>' +
              '<div class="page-actions"><a class="btn btn-sm" href="#/workorders">View all</a></div></div>' +
            (function () {
              var mine = wos.filter(function (w) { return w.assigneeId === me.id && w.status !== 'complete'; });
              return mine.length ? mine.slice(0, 5).map(woRow).join('')
                : '<div class="empty" style="padding:30px"><div>Nothing assigned to you. Nice.</div></div>';
            })() +
          '</div>' +
        '</div>' +

        '<div class="stack">' +
          outreachCard(S.outreachStreak(me.id)) +
          leadCard(leadQueue, S.leadsNeedingAttention(me.id)) +
          '<div class="card">' +
            '<div class="card-head"><span class="card-title">Billing Radar · 14 Days</span>' +
              '<div class="page-actions"><a class="btn btn-sm" href="#/billing">All</a></div></div>' +
            (billingSoon.length ? '<div>' + billingSoon.slice(0, 6).map(function (r) {
              var isVendor = r.vendorType !== undefined;
              var t = U.dueTone(r.billingDate);
              return '<div class="wo-row"><div class="wo-main">' +
                '<div class="wo-title">' + U.esc(r.name) + '</div>' +
                '<div class="wo-sub">' + U.badge(isVendor ? 'Vendor' : 'Account', isVendor ? 'b-violet' : 'b-blue') +
                  '<span>' + U.esc(r.billingCycle || '—') + '</span>' +
                  '<span class="mono">' + S.money(r.value) + '</span></div>' +
                '</div><div class="wo-side"><span class="badge ' + (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '">' + U.esc(t.text) + '</span></div></div>';
            }).join('') + '</div>' : '<div class="empty" style="padding:30px"><div>Nothing bills in the next two weeks.</div></div>') +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><span class="card-title">Team Activity</span></div>' +
            '<div class="card-body">' + U.timeline(S.all('activity'), 12) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    el.querySelectorAll('[data-wo]').forEach(function (n) {
      n.onclick = function () { location.hash = '#/workorders/' + n.dataset.wo; };
    });
    el.querySelectorAll('[data-lead]').forEach(function (n) {
      n.onclick = function () { location.hash = '#/leads/' + n.dataset.lead; };
    });
    el.querySelectorAll('[data-opp]').forEach(function (n) {
      n.onclick = function () { location.hash = '#/opportunities/' + n.dataset.opp; };
    });
    el.querySelectorAll('[data-tasklink]').forEach(function (n) {
      n.onclick = function () { location.hash = n.dataset.tasklink; };
    });
    el.querySelectorAll('[data-donetask]').forEach(function (n) {
      n.onclick = function (e) {
        e.stopPropagation();
        S.completeTask(n.dataset.donetask, true);
        U.toast('Marked complete.', 'ok');
        root.render();
      };
    });

    function woRow(w) {
      var t = U.dueTone(w.dueDate, w.status === 'complete');
      var p = S.priority(w.priority);
      return '<div class="wo-row" data-wo="' + U.esc(w.id) + '" style="cursor:pointer">' +
        '<span class="prio-flag" style="background:' + p.color + '"></span>' +
        '<div class="wo-main"><div class="wo-title">' + U.esc(w.title) + '</div>' +
          '<div class="wo-sub">' + U.esc(S.entityLabel(w.entityType, w.entityId)) +
            '<span>·</span><span>' + U.esc(S.service(w.serviceId).name) + '</span></div></div>' +
        '<div class="wo-side">' + U.woBadge(w.status) +
          '<span class="badge ' + (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '">' + U.esc(t.text) + '</span></div></div>';
    }
  };

  function kpi(label, value, foot, mod) {
    return '<div class="kpi ' + mod + '"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + U.esc(value) + '</div>' +
      '<div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }

  /* ── my activities ─────────────────────────────────────────────
     Tasks, calls and meetings assigned to me, most urgent first, with
     a one-click tick so clearing the list does not need a page change. */
  function myActivityCard(list) {
    var head = '<div class="card"><div class="card-head"><span class="card-title">My Activities</span>' +
      (list.length ? '<span class="kcol-count">' + list.length + '</span>' : '') +
      '<div class="page-actions"><a class="btn btn-sm" href="#/activities">All activities</a></div></div>';

    if (!list.length) {
      return head + '<div class="empty" style="padding:30px"><div>Nothing on your list. ' +
        'Log a call or schedule a task from any record.</div></div></div>';
    }

    return head + list.slice(0, 6).map(function (t) {
      var s = S.taskState(t);
      var kind = S.taskKind(t.kind);
      return '<div class="wo-row">' +
        '<span class="act-check" data-donetask="' + U.esc(t.id) + '" title="Mark complete"></span>' +
        '<div class="wo-main" data-tasklink="' + U.esc(S.entityHref(t.entityType, t.entityId)) + '" style="cursor:pointer">' +
          '<div class="wo-title">' + U.esc(t.subject) + '</div>' +
          '<div class="wo-sub">' + U.badge(kind.label, kind.tone) +
            '<span>' + U.esc(S.entityLabel(t.entityType, t.entityId)) + '</span>' +
            (t.startTime ? '<span>' + U.esc(t.startTime) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="wo-side">' + U.badge(s.label, s.tone) + '</div></div>';
    }).join('') +
    (list.length > 6
      ? '<div class="card-body"><a class="link" href="#/activities">' + (list.length - 6) + ' more →</a></div>'
      : '') + '</div>';
  }

  /* ── deals closing soon ────────────────────────────────────────── */
  function closingCard(list, stats) {
    if (!S.all('opportunities').length) return '';
    var head = '<div class="card"><div class="card-head"><span class="card-title">Closing Within 14 Days</span>' +
      (list.length ? '<span class="kcol-count">' + list.length + '</span>' : '') +
      '<div class="page-actions"><a class="btn btn-sm" href="#/pipeline">Pipeline</a></div></div>';

    if (!list.length) {
      return head + '<div class="empty" style="padding:30px"><div>' +
        (stats.open ? 'No deals are due to close in the next two weeks.' : 'No open deals.') +
        '</div></div></div>';
    }

    return head + list.slice(0, 5).map(function (o) {
      var stage = S.oppStage(o.stage);
      var t = U.dueTone(o.closeDate);
      return '<div class="wo-row" data-opp="' + U.esc(o.id) + '" style="cursor:pointer">' +
        '<div class="wo-main"><div class="wo-title">' + U.esc(o.name) + '</div>' +
          '<div class="wo-sub">' + U.badge(stage.label, stage.tone) +
            '<span>' + U.esc(S.accountName(o.accountId)) + '</span>' +
            '<span class="mono">' + S.money(o.amount) + '</span></div></div>' +
        '<div class="wo-side"><span class="badge ' +
          (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '">' + U.esc(t.text) + '</span></div></div>';
    }).join('') + '</div>';
  }

  /* ── daily outreach ──────────────────────────────────────────────
     A habit only holds if the prompt is somewhere you already look, so
     the nudge lives on Home rather than only on its own screen. */
  function outreachCard(s) {
    if (!S.all('outreachGroups').length && !S.all('outreach').length) return '';

    var due = S.groupsDue().slice(0, 3);
    var pct = s.hasGoal ? Math.min(100, Math.round((s.todayCount / s.goal) * 100)) : 0;

    return '<div class="card">' +
      '<div class="card-head"><span class="card-title">Daily Outreach</span>' +
        (s.days ? U.badge(s.days + '-day streak', s.todayMet ? 'b-green' : 'b-orange') : '') +
        '<div class="page-actions"><a class="btn btn-sm" href="#/outreach">Open</a></div></div>' +
      '<div class="card-body">' +
        (s.hasGoal
          ? '<div class="split" style="align-items:baseline;gap:8px">' +
              '<span style="font-family:var(--font-display);font-size:24px;font-weight:700;line-height:1;color:' +
                (s.todayMet ? 'var(--ok)' : 'var(--orange)') + '">' + s.todayCount + '</span>' +
              '<span class="muted" style="font-size:13px">of ' + s.goal + ' today</span>' +
            '</div>' +
            '<div class="bar" style="margin-top:10px;height:7px"><i style="width:' + pct + '%' +
              (s.todayMet ? ';background:linear-gradient(90deg,var(--ok),#5fd99a)' : '') + '"></i></div>'
          : '<div class="split"><span class="strong">' + s.todayCount + '</span>' +
            '<span class="muted" style="font-size:12.5px">logged today</span></div>') +
        (s.todayMet
          ? '<div class="hint" style="margin-top:10px">Done for today.</div>'
          : due.length
            ? '<div class="hint" style="margin-top:10px">Next up: ' +
              U.esc(due.map(function (g) { return g.name; }).join(', ')) + '</div>'
            : '<div class="hint" style="margin-top:10px">Every group is inside its posting cooldown.</div>') +
      '</div></div>';
  }

  /* ── lead follow-ups ─────────────────────────────────────────────
     Yours first, then the rest of the team's, because the point of the
     card is to tell you what to do — not to report on everyone. */
  function leadCard(all, mine) {
    if (!S.all('leads').length) return '';

    var head = '<div class="card"><div class="card-head"><span class="card-title">Lead Follow-Ups</span>' +
      (all.length ? '<span class="kcol-count">' + all.length + '</span>' : '') +
      '<div class="page-actions"><a class="btn btn-sm" href="#/leads">All leads</a></div></div>';

    if (!all.length) {
      return head + '<div class="card-body split">' + U.badge('All clear', 'b-green') +
        '<span class="hint">Every open lead has its next touch booked.</span></div></div>';
    }

    var others = all.filter(function (l) { return mine.indexOf(l) < 0; });
    var show = mine.concat(others).slice(0, 6);

    return head + show.map(function (l) {
      var f = S.followUpState(l);
      return '<div class="wo-row" data-lead="' + U.esc(l.id) + '" style="cursor:pointer">' +
        '<span class="prio-flag" style="background:' +
          (f.key === 'overdue' ? '#D71F24' : f.key === 'today' ? '#AF5300' : '#87680F') + '"></span>' +
        '<div class="wo-main"><div class="wo-title">' + U.esc(l.name) + '</div>' +
          '<div class="wo-sub">' + U.esc(S.leadStatus(l.leadStatus).label) +
            '<span>·</span><span>' + U.esc(S.user(l.ownerId).name.split(' ')[0]) + '</span>' +
            (l.estValue ? '<span class="mono">' + S.money(l.estValue) + '</span>' : '') +
          '</div></div>' +
        '<div class="wo-side">' + U.badge(
          f.key === 'overdue' ? Math.abs(f.days) + 'd late' : f.label, f.tone) + '</div></div>';
    }).join('') +
    (all.length > show.length
      ? '<div class="card-body"><a class="link" href="#/leads">' + (all.length - show.length) +
        ' more waiting →</a></div>' : '') +
    '</div>';
  }

  /* ── MRR goal tracker ──────────────────────────────────────────
     Hidden entirely until a goal is set — an empty progress bar is
     worse than no progress bar. */
  function goalCard(g) {
    if (!g) {
      return S.isAdmin()
        ? '<div class="card" style="margin-bottom:14px"><div class="card-body split">' +
            '<span class="hint">Set a monthly recurring revenue goal to track progress here.</span>' +
            '<a class="btn btn-sm" href="#/admin" style="margin-left:auto">Set a goal</a>' +
          '</div></div>'
        : '';
    }

    /* How many more accounts at the current average would close the gap —
       turns an abstract gap into a concrete number of sales. */
    var subs = S.all('stripeSubscriptions').filter(function (s) { return s.status === 'active'; });
    var payers = subs.length || S.accounts().filter(function (a) {
      return S.isCustomerAccount(a) && S.isRevenue(a) && Number(a.value);
    }).length;
    var avg = payers ? g.current / payers : 0;
    var needed = (!g.hit && avg > 0) ? Math.ceil(g.remaining / avg) : 0;

    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head">' +
        '<span class="card-title">Monthly Recurring Revenue Goal</span>' +
        (g.hit ? U.badge('Goal reached', 'b-green') : U.badge(g.pct + '%', 'b-orange')) +
        '<div class="page-actions"><span class="hint">' +
          (g.source === 'stripe' ? 'live from Stripe' : 'from account contract values') +
        '</span></div>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="split" style="align-items:baseline;gap:10px">' +
          '<span style="font-family:var(--font-display);font-size:30px;font-weight:700;color:var(--orange);line-height:1.1">' +
            U.esc(S.cents(g.current)) + '</span>' +
          '<span class="muted" style="font-size:14px">of ' + U.esc(S.cents(g.goal)) + '</span>' +
        '</div>' +
        '<div class="bar" style="margin-top:12px;height:9px"><i style="width:' + g.clamped + '%' +
          (g.hit ? ';background:linear-gradient(90deg,var(--ok),#5fd99a)' : '') + '"></i></div>' +
        '<div class="split" style="margin-top:9px;font-size:12.5px">' +
          '<span class="muted">' +
            (g.hit
              ? 'Target passed by ' + U.esc(S.cents(g.current - g.goal)) + ' — time to raise it.'
              : U.esc(S.cents(g.remaining)) + ' to go' +
                (needed ? ' · about ' + needed + ' more account' + (needed === 1 ? '' : 's') +
                          ' at your current average' : '')) +
          '</span>' +
          '<span class="mono muted" style="margin-left:auto">' + g.pct + '%</span>' +
        '</div>' +
      '</div></div>';
  }
})(window);
