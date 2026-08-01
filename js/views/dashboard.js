/* Home — the "what needs me right now" screen. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  root.Views.dashboard = function (el) {
    var me = S.me();
    var customers = S.all('customers');
    var vendors = S.all('vendors');
    var wos = S.all('workOrders');
    var today = S.today();

    var open = customers.filter(function (c) { return S.status(c.status).open; });
    var won = customers.filter(function (c) { return S.status(c.status).won; });
    var lost = customers.filter(function (c) { return c.status === 'lost'; });
    var freeAccounts = customers.filter(S.isFree);
    /* Pro bono and internal work is real work but not pipeline money. */
    var pipelineValue = open.filter(S.isRevenue)
      .reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
    var openPaying = open.filter(S.isRevenue).length;
    var closeRate = (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 100) : 0;

    var dueToday = wos.filter(function (w) { return w.status !== 'complete' && (w.scheduledDate === today || w.dueDate === today); });
    var overdue = wos.filter(S.isOverdue);
    var myWork = wos.filter(function (w) { return w.assigneeId === me.id && w.status !== 'complete'; });

    /* Recurring revenue: prefer what Stripe actually bills over the
       hand-entered contract values, which drift the moment someone
       forgets to update a record. Fall back to the manual figure when
       Stripe is not connected or has no subscriptions yet. */
    var stripeSubs = S.all('stripeSubscriptions');
    var mrrNow = S.recurringCents();
    var recurring = S.cents(mrrNow.cents);
    var recurringFoot = mrrNow.source === 'stripe'
      ? stripeSubs.filter(function (s) { return s.status === 'active'; }).length + ' active in Stripe'
      : won.length + ' paying accounts · from CRM values';
    var goal = S.goalProgress();

    /* Money customers actually owe right now, straight from Stripe. */
    var openInvoices = S.all('stripeInvoices').filter(function (i) { return i.status === 'open'; });
    var outstanding = openInvoices.reduce(function (s, i) { return s + (Number(i.amountRemainingCents) || 0); }, 0);
    var lateInvoices = openInvoices.filter(function (i) { return i.dueDate && i.dueDate < today; });

    var billingSoon = customers.concat(vendors)
      .filter(function (r) { var d = S.daysUntil(r.billingDate); return d !== null && d <= 14; })
      .sort(function (a, b) { return (a.billingDate || '').localeCompare(b.billingDate || ''); });

    var followUps = customers.filter(function (c) { return c.status === 'followup'; });

    el.innerHTML =
      '<div class="page-head">' +
        '<div>' +
          '<div class="eyebrow">' + U.esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })) + '</div>' +
          '<h1 class="page-title">Good to see you, ' + U.esc(me.name.split(' ')[0]) + '.</h1>' +
          '<div class="page-sub">' + dueToday.length + ' work order' + (dueToday.length === 1 ? '' : 's') + ' on the board today' +
            (overdue.length ? ' · <span style="color:var(--danger)">' + overdue.length + ' overdue</span>' : '') + '</div>' +
        '</div>' +
        '<div class="page-actions">' +
          '<a class="btn" href="#/tracker">Open Daily Tracker</a>' +
          '<a class="btn btn-primary" href="#/customers?new=1">New Customer</a>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('Open Pipeline', S.money(pipelineValue),
            (pipelineValue ? openPaying + ' active opportunities'
                           : openPaying + ' open · no contract values set') +
            (freeAccounts.length ? ' · ' + freeAccounts.length + ' free' : ''), 'accent') +
        kpi('Recurring / mo', recurring, recurringFoot, 'ok') +
        (outstanding || lateInvoices.length
          ? kpi('Outstanding', S.cents(outstanding),
                lateInvoices.length ? lateInvoices.length + ' past due in Stripe'
                                    : openInvoices.length + ' invoices open',
                lateInvoices.length ? 'danger' : '')
          : kpi('Close Rate', closeRate + '%', won.length + ' won · ' + lost.length + ' lost', '')) +
        kpi('Overdue Work', String(overdue.length), overdue.length ? 'Needs attention today' : 'All clear', overdue.length ? 'danger' : 'ok') +
      '</div>' +

      goalCard(goal) +

      '<div class="grid" style="grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);align-items:start">' +

        '<div class="stack">' +
          /* My work */
          '<div class="card">' +
            '<div class="card-head"><span class="card-title">My Open Work Orders</span>' +
              '<div class="page-actions"><a class="btn btn-sm" href="#/workorders">View all</a></div></div>' +
            (myWork.length ? myWork.slice(0, 6).map(woRow).join('') :
              '<div class="empty" style="padding:30px"><div>Nothing assigned to you. Nice.</div></div>') +
          '</div>' +

          /* Follow ups */
          '<div class="card">' +
            '<div class="card-head"><span class="card-title">Follow Ups Waiting On You</span>' +
              '<span class="kcol-count">' + followUps.length + '</span>' +
              '<div class="page-actions"><a class="btn btn-sm" href="#/pipeline">Pipeline</a></div></div>' +
            (followUps.length ? U.table([
              { key: 'name', label: 'Customer', render: function (c) { return '<span class="link">' + U.esc(c.name) + '</span>'; } },
              { key: 'owner', label: 'Owner', render: function (c) { return U.userCell(c.ownerId); } },
              { key: 'value', label: 'Value', cls: 'right', render: function (c) { return '<span class="mono">' + S.money(c.value) + '</span>'; } },
              { key: 'billing', label: 'Next Billing', render: function (c) { var t = U.dueTone(c.billingDate); return '<span class="' + (t.cls.indexOf('b-') === 0 ? 'badge ' + t.cls : t.cls) + '">' + U.esc(t.text) + '</span>'; } }
            ], followUps, { rowLink: true }) : '<div class="empty" style="padding:30px"><div>No follow ups queued.</div></div>') +
          '</div>' +
        '</div>' +

        '<div class="stack">' +
          /* Billing radar */
          '<div class="card">' +
            '<div class="card-head"><span class="card-title">Billing Radar · 14 Days</span>' +
              '<div class="page-actions"><a class="btn btn-sm" href="#/billing">All</a></div></div>' +
            (billingSoon.length ? '<div>' + billingSoon.slice(0, 7).map(function (r) {
              var isVendor = r.vendorType !== undefined;
              var t = U.dueTone(r.billingDate);
              return '<div class="wo-row"><div class="wo-main">' +
                '<div class="wo-title">' + U.esc(r.name) + '</div>' +
                '<div class="wo-sub">' + U.badge(isVendor ? 'Vendor' : 'Customer', isVendor ? 'b-violet' : 'b-blue') +
                  '<span>' + U.esc(r.billingCycle || '—') + '</span>' +
                  '<span class="mono">' + S.money(r.value) + '</span></div>' +
                '</div><div class="wo-side"><span class="badge ' + (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '">' + U.esc(t.text) + '</span></div></div>';
            }).join('') + '</div>' : '<div class="empty" style="padding:30px"><div>Nothing bills in the next two weeks.</div></div>') +
          '</div>' +

          /* Team activity */
          '<div class="card">' +
            '<div class="card-head"><span class="card-title">Team Activity</span></div>' +
            '<div class="card-body">' + U.timeline(S.all('activity'), 12) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    /* row clicks */
    el.querySelectorAll('tr.row-link').forEach(function (tr, i) {
      tr.onclick = function () { location.hash = '#/customers/' + followUps[i].id; };
    });
    el.querySelectorAll('[data-wo]').forEach(function (n) {
      n.onclick = function () { location.hash = '#/workorders/' + n.dataset.wo; };
    });

    function woRow(w) {
      var t = U.dueTone(w.dueDate, w.status === 'complete');
      var p = S.priority(w.priority);
      return '<div class="wo-row" data-wo="' + U.esc(w.id) + '" style="cursor:pointer">' +
        '<span class="prio-flag" style="background:' + p.color + '"></span>' +
        '<div class="wo-main"><div class="wo-title">' + U.esc(w.title) + '</div>' +
          '<div class="wo-sub">' + U.esc(S.recordName(w.entityType, w.entityId)) +
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
    var avg = subs.length ? g.current / subs.length : 0;
    var needed = (!g.hit && avg > 0) ? Math.ceil(g.remaining / avg) : 0;

    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head">' +
        '<span class="card-title">Monthly Recurring Revenue Goal</span>' +
        (g.hit ? U.badge('Goal reached', 'b-green') : U.badge(g.pct + '%', 'b-orange')) +
        '<div class="page-actions"><span class="hint">' +
          (g.source === 'stripe' ? 'live from Stripe' : 'from CRM contract values') +
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
