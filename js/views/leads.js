/* ═══════════════════════════════════════════════════════════════════
   leads.js — the top of the funnel.

   A lead is its own object, not a customer with a different status:
   leads arrive in volume, most never become anything, and mixing them
   into customers would wreck every count and every money figure on the
   dashboard. They move one way — into a customer, once.

   The screen is built around the next touch rather than the record.
   A lead with no follow-up booked is treated as a problem, because
   that is how leads actually get lost.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var ICON = '<svg viewBox="0 0 24 24" class="ico"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6"/></svg>';

  var st = { q: '', status: 'open', rating: '', owner: '', source: '', tag: '', due: '', sortKey: 'follow', sortDir: 1 };

  /* ── list ────────────────────────────────────────────────────── */
  root.Views.leads = function (el, params) {
    if (params.id) return detail(el, params.id);

    var stats = S.leadStats();
    var rows = S.all('leads').filter(function (l) {
      if (st.status === 'open' ? !S.isLeadOpen(l) : (st.status && l.leadStatus !== st.status)) return false;
      if (st.rating && (l.rating || 'warm') !== st.rating) return false;
      if (st.owner && l.ownerId !== st.owner) return false;
      if (st.source && l.source !== st.source) return false;
      if (st.tag && !S.hasTag(l, st.tag)) return false;
      if (st.due) {
        var k = S.followUpState(l).key;
        if (st.due === 'attention' && k !== 'overdue' && k !== 'today' && k !== 'unscheduled') return false;
        if (st.due !== 'attention' && k !== st.due) return false;
      }
      if (st.q) {
        var hay = [l.name, l.contactName, l.email, l.phone, l.industry, l.address, l.website, l.source]
          .concat(S.tagsOf(l)).join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var attention = S.leadsNeedingAttention();

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Leads</h1>' +
          '<div class="page-sub">' + stats.open + ' still in play · ' +
            (stats.attention
              ? '<span style="color:var(--danger)">' + stats.attention + ' need a follow-up</span>'
              : 'every open lead has a next touch booked') + '</div></div>' +
        '<div class="page-actions">' +
          '<button class="btn" id="importBtn">Import list</button>' +
          '<button class="btn btn-primary" id="newLead">+ New Lead</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('Open Leads', String(stats.open), S.money(stats.value) + ' estimated', 'accent') +
        kpi('Needs Follow-Up', String(stats.attention),
            stats.attention ? 'overdue, due today, or unscheduled' : 'all scheduled',
            stats.attention ? 'danger' : 'ok') +
        kpi('Qualified', String(stats.qualified), 'ready to convert', '') +
        kpi('Converted', String(stats.converted),
            stats.converted + stats.unqualified
              ? stats.convRate + '% of decided leads'
              : 'nothing decided yet', 'ok') +
      '</div>' +

      attentionCard(attention) +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search name, contact, email…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="fstatus">' +
          '<option value="open"' + (st.status === 'open' ? ' selected' : '') + '>Open leads</option>' +
          '<option value=""' + (st.status === '' ? ' selected' : '') + '>All leads</option>' +
          S.LEAD_STATUSES.map(function (x) {
            return '<option value="' + U.esc(x.id) + '"' + (st.status === x.id ? ' selected' : '') + '>' + U.esc(x.label) + '</option>';
          }).join('') +
        '</select>' +
        '<select class="input" id="fdue"><option value="">Any follow-up</option>' +
          dueOpt('attention', 'Needs attention') + dueOpt('overdue', 'Overdue') +
          dueOpt('today', 'Due today') + dueOpt('unscheduled', 'Unscheduled') +
          dueOpt('soon', 'This week') + dueOpt('scheduled', 'Later') +
        '</select>' +
        '<select class="input" id="frating"><option value="">Any rating</option>' + U.options(S.LEAD_RATINGS, st.rating) + '</select>' +
        '<select class="input" id="fowner"><option value="">All owners</option>' + U.options(S.activeUsers(), st.owner, 'id', 'name') + '</select>' +
        (sourcesInUse().length
          ? '<select class="input" id="fsource"><option value="">All sources</option>' +
              sourcesInUse().map(function (s) {
                return '<option value="' + U.esc(s) + '"' + (s === st.source ? ' selected' : '') + '>' + U.esc(s) + '</option>';
              }).join('') + '</select>'
          : '') +
        (S.allTags().length
          ? '<select class="input" id="ftag"><option value="">All tags</option>' +
              S.allTags().map(function (t) {
                return '<option value="' + U.esc(t) + '"' + (t === st.tag ? ' selected' : '') + '>' + U.esc(t) + '</option>';
              }).join('') + '</select>'
          : '') +
        '<button class="btn btn-ghost btn-sm" id="clear">Clear</button>' +
        '<button class="btn btn-sm" id="exportCsv" style="margin-left:auto">Export CSV</button>' +
      '</div>' +
      U.table(cols(), rows, {
        rowLink: true, sortKey: st.sortKey, sortDir: st.sortDir,
        emptyHTML: U.empty('No leads match',
          S.all('leads').length ? 'Try clearing the filters.' : 'Add one by hand, or paste a list in with Import.',
          '<button class="btn btn-primary btn-sm" id="emptyNew">+ New Lead</button>')
      }) + '</div>';

    el.querySelector('#newLead').onclick = function () { openForm(null, root.render); };
    el.querySelector('#importBtn').onclick = function () { openImport(root.render); };
    var emptyNew = el.querySelector('#emptyNew');
    if (emptyNew) emptyNew.onclick = function () { openForm(null, root.render); };
    if (params.new) openForm(null, function () { location.hash = '#/leads'; root.render(); });

    bindFilter(el, '#fq', 'q', true);
    [['#fstatus', 'status'], ['#fdue', 'due'], ['#frating', 'rating'],
     ['#fowner', 'owner'], ['#fsource', 'source'], ['#ftag', 'tag']].forEach(function (pair) {
      if (el.querySelector(pair[0])) bindFilter(el, pair[0], pair[1]);
    });
    el.querySelector('#clear').onclick = function () {
      st.q = ''; st.status = 'open'; st.rating = ''; st.owner = ''; st.source = ''; st.tag = ''; st.due = '';
      root.render();
    };
    el.querySelector('#exportCsv').onclick = function () { exportCsv(rows); };

    bindAttention(el);

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { location.hash = '#/leads/' + id; }
    });

    function dueOpt(v, label) {
      return '<option value="' + v + '"' + (st.due === v ? ' selected' : '') + '>' + label + '</option>';
    }
    function bindFilter(scope, sel, key, isText) {
      var node = scope.querySelector(sel);
      if (isText) {
        var t;
        node.oninput = function () {
          clearTimeout(t);
          t = setTimeout(function () { st[key] = node.value; root.render(); }, 220);
        };
      } else {
        node.onchange = function () { st[key] = node.value; root.render(); };
      }
    }
  };

  function sourcesInUse() {
    var seen = {};
    S.all('leads').forEach(function (l) { if (l.source) seen[l.source] = 1; });
    return Object.keys(seen).sort();
  }

  /* ── the follow-up queue ─────────────────────────────────────────
     Deliberately above the table: this is the day's actual work list,
     and a list you have to filter for is a list nobody looks at. */
  function attentionCard(list) {
    if (!list.length) {
      return S.openLeads().length
        ? '<div class="card" style="margin-bottom:14px"><div class="card-body split">' +
            U.badge('All clear', 'b-green') +
            '<span class="hint">Every open lead has its next touch booked.</span>' +
          '</div></div>'
        : '';
    }
    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head"><span class="card-title">Follow Up Now</span>' +
        '<span class="kcol-count">' + list.length + '</span>' +
        '<div class="page-actions"><span class="hint">Overdue, due today, or never scheduled</span></div></div>' +
      list.slice(0, 8).map(function (l) {
        var f = S.followUpState(l);
        return '<div class="wo-row">' +
          '<span class="prio-flag" style="background:' + (f.key === 'overdue' ? '#E5484D' : f.key === 'today' ? '#FA7700' : '#E8B931') + '"></span>' +
          '<div class="wo-main">' +
            '<div class="wo-title"><a class="link" href="#/leads/' + U.esc(l.id) + '">' + U.esc(l.name) + '</a></div>' +
            '<div class="wo-sub">' +
              U.badge(S.leadStatus(l.leadStatus).label, S.leadStatus(l.leadStatus).tone) +
              '<span>' + U.esc(l.contactName || 'No contact name') + '</span>' +
              (l.estValue ? '<span class="mono">' + S.money(l.estValue) + '</span>' : '') +
              (l.lastContactedAt ? '<span>last touched ' + U.esc(U.fmtDateShort(l.lastContactedAt)) + '</span>'
                                 : '<span>never contacted</span>') +
            '</div>' +
          '</div>' +
          '<div class="wo-side">' +
            U.badge(followLabel(f), f.tone) +
            '<button class="btn btn-sm" data-logcontact="' + U.esc(l.id) + '">Log contact</button>' +
            '<button class="btn btn-ghost btn-sm" data-snooze="' + U.esc(l.id) + '" title="Push the next touch out one week">+1w</button>' +
          '</div></div>';
      }).join('') +
      (list.length > 8
        ? '<div class="card-body"><span class="hint">' + (list.length - 8) + ' more — ' +
          '<a class="link" href="#" data-showall="1">show the full queue</a></span></div>'
        : '') +
      '</div>';
  }

  function bindAttention(el) {
    el.querySelectorAll('[data-logcontact]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openLogContact(b.dataset.logcontact, root.render); };
    });
    el.querySelectorAll('[data-snooze]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var l = S.find('leads', b.dataset.snooze);
        /* Snooze from today, not from the old date — otherwise pushing a
           three-week-old follow-up "one week" leaves it still overdue. */
        S.update('leads', l.id, { nextFollowUp: S.shift(7) }, 'follow-up moved to next week');
        U.toast(l.name + ' — follow-up moved to ' + U.fmtDateShort(S.shift(7)) + '.', 'ok');
        root.render();
      };
    });
    var showAll = el.querySelector('[data-showall]');
    if (showAll) showAll.onclick = function (e) {
      e.preventDefault();
      st.due = 'attention'; st.status = 'open';
      root.render();
    };
  }

  function followLabel(f) {
    if (f.key === 'overdue') return Math.abs(f.days) + 'd overdue';
    if (f.key === 'soon') return 'in ' + f.days + ' days';
    return f.label;
  }

  function cols() {
    return [
      { key: 'name', label: 'Lead', sort: function (l) { return l.name; },
        render: function (l) {
          return '<div><span class="link">' + U.esc(l.name) + '</span>' +
            '<div class="muted" style="font-size:11.5px">' +
              U.esc(l.contactName || '') + (l.contactTitle ? ' · ' + U.esc(l.contactTitle) : '') + '</div>' +
            (S.tagsOf(l).length ? '<div style="margin-top:4px">' + U.tagChips(l.tags, 3) + '</div>' : '') +
            '</div>';
        } },
      { key: 'status', label: 'Status', sort: function (l) { return S.leadStatus(l.leadStatus).order; },
        render: function (l) {
          var x = S.leadStatus(l.leadStatus);
          return U.badge(x.label, x.tone) +
            (l.convertedCustomerId
              ? '<div style="margin-top:3px"><a class="link" style="font-size:11px" href="#/accounts/' +
                U.esc(l.convertedCustomerId) + '">view account →</a></div>'
              : '');
        } },
      { key: 'follow', label: 'Next Follow-Up', sort: function (l) {
          var f = S.followUpState(l);
          /* Sort by urgency band first so unscheduled leads cannot hide at
             the bottom behind a blank date. */
          return f.rank * 1e9 + (l.nextFollowUp ? Number(l.nextFollowUp.replace(/-/g, '')) : 0);
        },
        render: function (l) {
          var f = S.followUpState(l);
          if (f.key === 'closed') return '<span class="muted">—</span>';
          return U.badge(followLabel(f), f.tone) +
            (l.nextFollowUp ? '<div class="muted" style="font-size:11px;margin-top:3px">' +
              U.fmtDateShort(l.nextFollowUp) + '</div>' : '');
        } },
      { key: 'rating', label: 'Rating', sort: function (l) { return S.leadRating(l.rating).order; },
        render: function (l) { var r = S.leadRating(l.rating); return U.badge(r.label, r.tone); } },
      { key: 'value', label: 'Est. Value', cls: 'right', sort: function (l) { return Number(l.estValue) || 0; },
        render: function (l) {
          return l.estValue
            ? '<span class="mono">' + S.money(l.estValue) + '</span>'
            : '<span class="muted">—</span>';
        } },
      { key: 'source', label: 'Source', sort: function (l) { return l.source || ''; },
        render: function (l) { return l.source ? '<span class="chip">' + U.esc(l.source) + '</span>' : '<span class="muted">—</span>'; } },
      { key: 'owner', label: 'Owner', sort: function (l) { return S.user(l.ownerId).name; },
        render: function (l) { return U.userCell(l.ownerId); } }
    ];
  }

  function kpi(label, value, foot, mod) {
    return '<div class="kpi ' + mod + '"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + U.esc(value) + '</div><div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }

  /* ── detail ──────────────────────────────────────────────────── */
  function detail(el, id) {
    var l = S.find('leads', id);
    if (!l) {
      el.innerHTML = U.empty('Lead not found', 'It may have been deleted or converted.',
        '<a class="btn" href="#/leads">Back to Leads</a>');
      return;
    }

    var rerender = function () { detail(el, id); };
    var notes = S.notesFor('lead', l.id);
    var acts = S.activityFor('leads', l.id);
    var f = S.followUpState(l);
    var status = S.leadStatus(l.leadStatus);
    var rating = S.leadRating(l.rating);
    var tab = ['details', 'notes', 'activity'].indexOf(root.__leadTab) > -1 ? root.__leadTab : 'details';

    el.innerHTML =
      '<div style="margin-bottom:12px"><a class="btn btn-ghost btn-sm" href="#/leads">' +
        '<svg viewBox="0 0 24 24" class="ico"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Leads</a></div>' +

      (l.convertedCustomerId ? convertedBanner(l) : '') +

      '<div class="record-hero">' +
        '<div class="record-top">' +
          '<div class="record-icon">' + ICON + '</div>' +
          '<div style="min-width:0">' +
            '<h1 class="record-name">' + U.esc(l.name) + '</h1>' +
            '<div class="record-meta">' +
              U.badge(status.label, status.tone) +
              U.badge(rating.label + ' lead', rating.tone) +
              U.tagChips(l.tags) +
              (l.industry ? '<span class="chip">' + U.esc(l.industry) + '</span>' : '') +
              (l.website ? '<a class="chip" href="' + U.esc(href(l.website)) + '" target="_blank" rel="noopener">' + U.esc(l.website) + '</a>' : '') +
              (l.address ? '<span>' + U.esc(l.address) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="page-actions">' +
            (S.isLeadOpen(l) ? '<button class="btn btn-sm" id="logBtn">Log contact</button>' : '') +
            (S.isLeadOpen(l) ? '<button class="btn btn-primary btn-sm" id="convBtn">Convert to Customer</button>' : '') +
            '<button class="btn btn-sm" id="editBtn">Edit</button>' +
            (S.canManage() ? '<button class="btn btn-sm btn-danger" id="delBtn">Delete</button>' : '') +
          '</div>' +
        '</div>' +

        '<div class="highlights">' +
          hl('Primary Contact', U.esc(l.contactName || '—') +
             (l.contactTitle ? '<div class="muted" style="font-size:11.5px;font-weight:400">' + U.esc(l.contactTitle) + '</div>' : '')) +
          hl('Phone', l.phone ? '<a href="tel:' + U.esc(l.phone) + '">' + U.esc(l.phone) + '</a>' : '—') +
          hl('Email', l.email ? '<a href="mailto:' + U.esc(l.email) + '" style="color:var(--orange)">' + U.esc(l.email) + '</a>' : '—') +
          hl('Next Follow-Up', f.key === 'closed'
            ? '<span class="muted">—</span>'
            : U.badge(followLabel(f), f.tone) +
              (l.nextFollowUp ? ' <span class="muted" style="font-size:12px;font-weight:400">' + U.fmtDate(l.nextFollowUp) + '</span>' : '')) +
          hl('Last Contacted', l.lastContactedAt ? U.fmtDate(l.lastContactedAt) : '<span class="muted">Never</span>') +
          hl('Est. Value', l.estValue ? '<span class="mono">' + S.money(l.estValue) + '</span>' : '<span class="muted">—</span>') +
          hl('Owner', U.userCell(l.ownerId)) +
        '</div>' +
      '</div>' +

      '<div class="tabs">' +
        tabBtn('details', 'Details', '') +
        tabBtn('notes', 'Notes', notes.length) +
        tabBtn('activity', 'Activity', acts.length) +
      '</div>' +
      '<div id="tabBody"></div>';

    function hl(label, value) {
      return '<div class="highlight"><div class="hl-label">' + U.esc(label) + '</div><div class="hl-value">' + value + '</div></div>';
    }
    function tabBtn(id_, label, count) {
      return '<button data-tab="' + id_ + '"' + (tab === id_ ? ' class="on"' : '') + '>' + U.esc(label) +
        (count !== '' && count !== undefined ? '<span class="count">' + count + '</span>' : '') + '</button>';
    }

    var body = el.querySelector('#tabBody');
    paintTab();

    el.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () {
        root.__leadTab = tab = b.dataset.tab;
        el.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
        paintTab();
      };
    });

    el.querySelector('#editBtn').onclick = function () { openForm(l, rerender); };
    var logBtn = el.querySelector('#logBtn');
    if (logBtn) logBtn.onclick = function () { openLogContact(l.id, rerender); };
    var convBtn = el.querySelector('#convBtn');
    if (convBtn) convBtn.onclick = function () { openConvert(l, rerender); };
    var delBtn = el.querySelector('#delBtn');
    if (delBtn) delBtn.onclick = function () {
      U.confirmDelete(l.name, function () {
        S.removeCascade('leads', l.id);
        U.toast(l.name + ' deleted.');
        location.hash = '#/leads';
      }, S.childrenOf('leads', l.id));
    };

    function paintTab() {
      if (tab === 'notes') {
        body.innerHTML =
          '<div class="detail-cols"><div class="card"><div class="card-head">' +
            '<span class="card-title">Team Notes</span><span class="kcol-count">' + notes.length + '</span>' +
            '<div class="page-actions"><span class="hint">These move to the customer record on conversion</span></div>' +
          '</div><div class="card-body">' + U.notesPanel('lead', l.id) + '</div></div>' +
          '<div class="card"><div class="card-head"><span class="card-title">Touch History</span></div>' +
            '<div class="card-body">' +
              (l.lastContactedAt
                ? '<div class="split"><span class="muted">Last contacted</span>' +
                  '<span class="strong" style="margin-left:auto">' + U.fmtDate(l.lastContactedAt) + '</span></div>'
                : '<span class="muted">No contact logged yet.</span>') +
              (S.isLeadOpen(l)
                ? '<button class="btn btn-primary btn-sm" id="logBtn2" style="margin-top:12px;width:100%">Log a contact</button>' : '') +
            '</div></div></div>';
        U.bindNotes(body, 'lead', l.id, rerender);
        var lb = body.querySelector('#logBtn2');
        if (lb) lb.onclick = function () { openLogContact(l.id, rerender); };

      } else if (tab === 'activity') {
        body.innerHTML = '<div class="card"><div class="card-head"><span class="card-title">Activity History</span></div>' +
          '<div class="card-body">' + U.timeline(acts, 60) + '</div></div>';

      } else {
        body.innerHTML =
          '<div class="detail-cols">' +
            '<div class="card"><div class="card-head"><span class="card-title">Lead Detail</span></div>' +
              '<div class="card-body"><dl class="dl">' +
                row('Company', U.esc(l.name)) +
                row('Contact', U.esc(l.contactName || '—')) +
                row('Title', U.esc(l.contactTitle || '—')) +
                row('Email', l.email ? '<a href="mailto:' + U.esc(l.email) + '" style="color:var(--orange)">' + U.esc(l.email) + '</a>' : '—') +
                row('Phone', U.esc(l.phone || '—')) +
                row('Status', U.badge(status.label, status.tone) +
                  ' <span class="muted" style="font-size:11.5px">' + U.esc(status.hint) + '</span>') +
                row('Rating', U.badge(rating.label, rating.tone)) +
                row('Source', U.esc(l.source || '—')) +
                row('Came From', outreachOrigin(l)) +
                row('Estimated Value', l.estValue ? '<span class="mono">' + S.money(l.estValue) + '</span>' : '—') +
                row('Next Follow-Up', l.nextFollowUp ? U.fmtDate(l.nextFollowUp) : '<span class="muted">Not scheduled</span>') +
                row('Last Contacted', l.lastContactedAt ? U.fmtDate(l.lastContactedAt) : '<span class="muted">Never</span>') +
                row('Tags', S.tagsOf(l).length ? U.tagChips(l.tags) : '<span class="muted">—</span>') +
                row('Industry', U.esc(l.industry || '—')) +
                row('Location', U.esc(l.address || '—')) +
                row('Website', l.website ? '<a href="' + U.esc(href(l.website)) + '" target="_blank" rel="noopener" style="color:var(--orange)">' + U.esc(l.website) + '</a>' : '—') +
                row('Owner', U.userCell(l.ownerId)) +
                row('Created', U.fmtDate(l.createdAt)) +
              '</dl></div></div>' +
            '<div class="stack">' +
              '<div class="card"><div class="card-head"><span class="card-title">Next Step</span></div>' +
                '<div class="card-body">' + nextStep(l, f) + '</div></div>' +
              '<div class="card"><div class="card-head"><span class="card-title">Pinned Notes</span></div><div class="card-body">' +
                (notes.filter(function (n) { return n.pinned; }).length
                  ? notes.filter(function (n) { return n.pinned; }).map(function (n) {
                      return '<div style="margin-bottom:12px"><div class="split" style="margin-bottom:4px">' + U.avatar(n.authorId, 'sm') +
                        '<span class="strong" style="font-size:12.5px">' + U.esc(S.user(n.authorId).name) + '</span>' +
                        '<span class="note-time">' + U.esc(U.fmtWhen(n.createdAt)) + '</span></div>' +
                        '<div class="note-text" style="font-size:12.5px">' + U.esc(n.body) + '</div></div>';
                    }).join('')
                  : '<span class="muted">Nothing pinned yet.</span>') +
              '</div></div>' +
            '</div>' +
          '</div>';
        var q = body.querySelector('#quickAct');
        if (q) q.onclick = function () {
          if (q.dataset.act === 'convert') openConvert(l, rerender);
          else openLogContact(l.id, rerender);
        };
      }
    }
  }

  function row(k, v) { return '<dt>' + U.esc(k) + '</dt><dd>' + v + '</dd>'; }

  /* Which outreach touch produced this lead, if any. This is the middle
     link in group -> lead -> account -> won deal; without it the
     outreach performance table cannot tell you anything. */
  function outreachOrigin(l) {
    if (!l.outreachId) return '<span class="muted">—</span>';
    var o = S.find('outreach', l.outreachId);
    if (!o) return '<span class="muted">A logged outreach touch (since deleted)</span>';
    var g = o.groupId ? S.outreachGroup(o.groupId) : null;
    var ch = S.outreachChannel(o.channel);
    return U.badge(ch.label, ch.tone) +
      (g ? ' <a class="link" href="#/outreach">' + U.esc(g.name) + '</a>' : '') +
      ' <span class="muted" style="font-size:11.5px">· ' + U.esc(S.outreachKind(o.kind).label) +
      ' on ' + U.esc(U.fmtDateShort(o.date)) + '</span>';
  }
  function href(w) { return /^https?:\/\//i.test(w) ? w : 'https://' + w; }

  function convertedBanner(l) {
    var c = S.find('customers', l.convertedCustomerId);
    return '<div class="card" style="margin-bottom:12px;border-color:rgba(47,191,113,.4)">' +
      '<div class="card-body split">' + U.badge('Converted', 'b-green') +
        '<span>This lead became ' +
          (c ? '<a class="link" href="#/accounts/' + U.esc(c.id) + '">' + U.esc(c.name) + '</a>'
             : 'a customer that has since been deleted') +
          (l.convertedAt ? ' on ' + U.esc(U.fmtDate(l.convertedAt)) : '') + '. ' +
          'Its notes moved with it.</span>' +
        (c ? '<a class="btn btn-sm" href="#/accounts/' + U.esc(c.id) + '" style="margin-left:auto">Open account</a>' : '') +
      '</div></div>';
  }

  function nextStep(l, f) {
    if (l.convertedCustomerId) {
      return '<span class="muted">Converted — the work now lives on the customer record.</span>';
    }
    if (l.leadStatus === 'unqualified') {
      return '<span class="muted">Marked unqualified. Edit the lead to put it back in play.</span>';
    }
    var msg, act = 'log', btn = 'Log a contact';
    if (l.leadStatus === 'qualified') {
      msg = 'Qualified and ready. Convert it into a customer to start billing.';
      act = 'convert'; btn = 'Convert to Customer';
    } else if (f.key === 'overdue') {
      msg = 'This follow-up is ' + Math.abs(f.days) + ' days late.';
    } else if (f.key === 'today') {
      msg = 'Due today.';
    } else if (f.key === 'unscheduled') {
      msg = 'No next touch is booked. This is how leads go quiet — pick a date.';
    } else {
      msg = 'Next touch ' + U.fmtDate(l.nextFollowUp) + '.';
    }
    return '<div style="font-size:13px;margin-bottom:12px">' + U.esc(msg) + '</div>' +
      '<button class="btn ' + (act === 'convert' ? 'btn-primary' : '') + ' btn-sm" id="quickAct" data-act="' + act + '" style="width:100%">' +
      U.esc(btn) + '</button>';
  }

  /* ── create / edit ───────────────────────────────────────────── */
  function openForm(l, done) {
    var isNew = !l;
    l = l || {
      leadStatus: 'new', rating: 'warm', ownerId: S.me().id,
      nextFollowUp: S.shift(2), source: '', tags: []
    };
    /* "Converted" is set by converting, never picked from a dropdown —
       choosing it by hand would claim a customer that does not exist. */
    var pickable = S.LEAD_STATUSES.filter(function (x) {
      return x.id !== 'converted' || l.leadStatus === 'converted';
    });

    U.modal({
      title: isNew ? 'New Lead' : 'Edit ' + l.name,
      wide: true,
      okText: isNew ? 'Create Lead' : 'Save Changes',
      body: '<div class="form-grid">' +
        U.field('Company Name *', '<input class="input" name="name" value="' + U.esc(l.name || '') + '" required>') +
        U.field('Primary Contact', '<input class="input" name="contactName" value="' + U.esc(l.contactName || '') + '">') +
        U.field('Contact Title', '<input class="input" name="contactTitle" placeholder="Owner, GM…" value="' + U.esc(l.contactTitle || '') + '">') +
        U.field('Email', '<input class="input" type="email" name="email" value="' + U.esc(l.email || '') + '">') +
        U.field('Phone', '<input class="input" name="phone" value="' + U.esc(l.phone || '') + '">') +
        U.field('Status',
          '<select class="input" name="leadStatus">' + U.options(pickable, l.leadStatus) + '</select>' +
          '<div class="hint">' + U.esc(S.leadStatus(l.leadStatus).hint) + '</div>') +
        U.field('Rating', '<select class="input" name="rating">' + U.options(S.LEAD_RATINGS, l.rating || 'warm') + '</select>') +
        U.field('Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), l.ownerId, 'id', 'name') + '</select>') +
        U.field('Next Follow-Up',
          '<input class="input" type="date" name="nextFollowUp" value="' + U.esc(l.nextFollowUp || '') + '">' +
          '<div class="hint">Leave blank only if this lead is closed — an open lead with no date is flagged.</div>') +
        U.field('Last Contacted', '<input class="input" type="date" name="lastContactedAt" value="' + U.esc(l.lastContactedAt || '') + '">') +
        U.field('Source',
          '<input class="input" name="source" list="leadSourceOptions" value="' + U.esc(l.source || '') + '">' +
          '<datalist id="leadSourceOptions">' +
            S.LEAD_SOURCES.map(function (s) { return '<option value="' + U.esc(s) + '">'; }).join('') +
          '</datalist>') +
        U.field('Estimated Value ($)', '<input class="input" type="number" min="0" step="50" name="estValue" value="' + U.esc(l.estValue || 0) + '">') +
        U.field('Tags', U.tagInput('tagsRaw', l.tags)) +
        U.field('Industry', '<input class="input" name="industry" value="' + U.esc(l.industry || '') + '">') +
        U.field('Location', '<input class="input" name="address" value="' + U.esc(l.address || '') + '">') +
        U.field('Website', '<input class="input" name="website" placeholder="example.com" value="' + U.esc(l.website || '') + '">') +
        (isNew ? '<div class="field span-2"><label>Opening Note (optional)</label>' +
          '<textarea class="input" name="openingNote" placeholder="Where did this come from, what do they need…"></textarea></div>' : '') +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Company name is required.', 'err'); return false; }
        v.estValue = Number(v.estValue) || 0;
        v.tags = S.parseTags(v.tagsRaw); delete v.tagsRaw;
        var note = v.openingNote; delete v.openingNote;

        if (isNew) {
          v.convertedCustomerId = '';
          v.convertedAt = '';
          var created = S.insert('leads', v, 'l', v.name);
          if (note) S.addNote('lead', created.id, note);
          U.toast(v.name + ' added to leads.', 'ok');
        } else {
          S.update('leads', l.id, v, 'lead details');
          U.toast('Saved.', 'ok');
        }
        done();
      }
    });
  }

  /* ── log a contact ───────────────────────────────────────────── */
  function openLogContact(id, done) {
    var l = S.find('leads', id);
    if (!l) return;
    var pickable = S.LEAD_STATUSES.filter(function (x) { return x.id !== 'converted'; });

    U.modal({
      title: 'Log contact — ' + l.name,
      okText: 'Save contact',
      body: '<div class="form-grid">' +
        '<div class="field span-2"><label>What happened?</label>' +
          '<textarea class="input" name="note" placeholder="Called Luis — wants a quote for the rebrand, sending Thursday."></textarea></div>' +
        U.field('Contacted On', '<input class="input" type="date" name="date" value="' + U.esc(S.today()) + '">') +
        U.field('Move Status To', '<select class="input" name="leadStatus">' + U.options(pickable, l.leadStatus) + '</select>') +
        U.field('Next Follow-Up',
          '<input class="input" type="date" name="nextFollowUp" value="' + U.esc(l.nextFollowUp && S.daysUntil(l.nextFollowUp) > 0 ? l.nextFollowUp : S.shift(7)) + '">' +
          '<div class="hint">Clearing this leaves the lead with no next touch — it will show up as needing attention.</div>', true) +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        S.logContact(l.id, {
          note: v.note, date: v.date, nextFollowUp: v.nextFollowUp, leadStatus: v.leadStatus
        });
        U.toast('Contact logged for ' + l.name + '.', 'ok');
        done();
      }
    });
  }

  /* ── convert ─────────────────────────────────────────────────────
     Salesforce's conversion: one lead becomes an Account, a Contact and
     an Opportunity. Each is optional to a degree — the lead may turn
     out to be a second person at a company already on the books, and
     not every lead worth keeping is a live deal today. */
  function openConvert(l, done) {
    var accounts = S.accounts().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    /* If a company with this name is already an account, offer it —
       converting into a duplicate is the classic way to end up with
       "Acme Roofing" twice and half the history on each. */
    var dupe = accounts.filter(function (a) {
      return a.name.toLowerCase().replace(/[^a-z0-9]/g, '') ===
             String(l.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    })[0];

    U.modal({
      title: 'Convert ' + l.name,
      wide: true,
      okText: 'Convert Lead',
      body: '<p style="margin:0 0 14px;color:var(--text-2);font-size:13px">' +
          'This creates an <strong>account</strong>, a <strong>contact</strong> and an ' +
          '<strong>opportunity</strong>, and moves this lead\'s notes and open activities across. ' +
          'The lead stays as the record of where the business came from. It can only be done once.</p>' +

        (dupe ? '<div class="card" style="margin-bottom:14px;border-color:rgba(232,185,49,.45)">' +
          '<div class="card-body split">' + U.badge('Possible duplicate', 'b-yellow') +
          '<span style="font-size:12.5px">An account called <strong>' + U.esc(dupe.name) +
          '</strong> already exists. Attach to it below rather than creating a second one.</span>' +
          '</div></div>' : '') +

        '<div class="form-grid">' +
        U.field('Account',
          '<select class="input" name="accountId">' +
            '<option value="">— create a new account —</option>' +
            accounts.map(function (a) {
              return '<option value="' + U.esc(a.id) + '"' + (dupe && a.id === dupe.id ? ' selected' : '') + '>' +
                U.esc(a.name) + '</option>';
            }).join('') +
          '</select>' +
          '<div class="hint">Pick an existing account if this person works somewhere you already deal with.</div>') +
        U.field('New Account Name', '<input class="input" name="accountName" value="' + U.esc(l.name) + '">') +
        U.field('Contact Name',
          '<input class="input" name="contactName" value="' + U.esc(l.contactName || '') + '">' +
          '<div class="hint">Leave blank to skip creating a contact.</div>') +
        U.field('Role in Deal',
          '<select class="input" name="contactRole"><option value="">—</option>' +
            S.CONTACT_ROLES.map(function (r) { return '<option value="' + U.esc(r) + '">' + U.esc(r) + '</option>'; }).join('') +
          '</select>') +
        U.field('Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), l.ownerId, 'id', 'name') + '</select>') +
        U.field('Billing Type',
          '<select class="input" name="billingType">' + U.options(S.BILLING_TYPES, 'paid') + '</select>' +
          '<div class="hint">Pro Bono keeps the account out of revenue.</div>') +

        '<div class="field span-2"><label class="check" style="width:fit-content">' +
          '<input type="checkbox" name="createOpportunity" checked>Create an opportunity</label></div>' +
        U.field('Opportunity Name',
          '<input class="input" name="oppName" value="' + U.esc(l.name + ' — New Business') + '">') +
        U.field('Type',
          '<select class="input" name="oppType">' +
            S.OPP_TYPES.map(function (t) { return '<option value="' + U.esc(t) + '">' + U.esc(t) + '</option>'; }).join('') +
          '</select>') +
        U.field('Stage', '<select class="input" name="stage">' +
          U.options(S.OPP_STAGES.filter(function (s) { return s.open; }), 'qualification') + '</select>') +
        U.field('Amount ($)', '<input class="input" type="number" min="0" step="50" name="amount" value="' + U.esc(l.estValue || 0) + '">') +
        U.field('Expected Close', '<input class="input" type="date" name="closeDate" value="' + U.esc(S.shift(30)) + '">') +
        '<div class="field span-2"><label>Services</label>' + U.serviceChecks('services', []) + '</div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        v.createOpportunity = Array.isArray(v.createOpportunity)
          ? v.createOpportunity.length > 0 : !!v.createOpportunity;
        var out;
        try {
          out = S.convertLead(l.id, v);
        } catch (err) {
          U.toast(err.message, 'err');
          return false;
        }
        U.toast(out.account.name + ' converted' +
          (out.opportunity ? ' — opportunity created.' : '.'), 'ok');
        /* Land on the deal if there is one; that is what gets worked next. */
        location.hash = out.opportunity
          ? '#/opportunities/' + out.opportunity.id
          : '#/accounts/' + out.account.id;
        done();
      }
    });
  }

  /* ── import ──────────────────────────────────────────────────────
     Leads arrive as spreadsheet exports. Typing them in one at a time
     is not a real option, so paste-in import is part of the feature
     rather than a nicety. */
  var ALIASES = {
    name:         ['company', 'company name', 'business', 'business name', 'organization', 'organisation', 'account', 'account name', 'name', 'lead', 'lead name'],
    contactName:  ['contact', 'contact name', 'full name', 'owner name', 'person', 'first name', 'name of contact', 'primary contact'],
    contactTitle: ['title', 'job title', 'role', 'position'],
    email:        ['email', 'e-mail', 'email address', 'contact email', 'mail'],
    phone:        ['phone', 'phone number', 'telephone', 'mobile', 'cell', 'contact phone'],
    website:      ['website', 'url', 'site', 'web', 'domain', 'web address'],
    address:      ['address', 'city', 'location', 'street', 'town', 'city state', 'full address'],
    industry:     ['industry', 'category', 'niche', 'business type', 'sector', 'type'],
    source:       ['source', 'lead source', 'channel', 'origin', 'referrer'],
    estValue:     ['value', 'est value', 'estimated value', 'deal size', 'budget', 'amount', 'potential value'],
    noteText:     ['notes', 'note', 'comment', 'comments', 'description', 'details']
  };
  var FIELD_LABELS = [
    ['name', 'Company Name *'], ['contactName', 'Contact'], ['contactTitle', 'Title'],
    ['email', 'Email'], ['phone', 'Phone'], ['website', 'Website'], ['address', 'Location'],
    ['industry', 'Industry'], ['source', 'Source'], ['estValue', 'Est. Value'], ['noteText', 'Note']
  ];

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function detectDelim(text) {
    var line = (text.split(/\r?\n/)[0] || '');
    var tabs = (line.match(/\t/g) || []).length;
    var commas = (line.match(/,/g) || []).length;
    var semis = (line.match(/;/g) || []).length;
    if (tabs && tabs >= commas && tabs >= semis) return '\t';
    if (semis > commas) return ';';
    return ',';
  }

  /* A real parser rather than split(','), because company names contain
     commas and a naive split silently shifts every later column. */
  function parseDelimited(text, delim) {
    var rows = [], row = [], field = '', inQ = false, i = 0;
    text = String(text).replace(/\r\n?/g, '\n');
    while (i < text.length) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
  }

  function guessMap(headers) {
    var map = {}, used = {};
    Object.keys(ALIASES).forEach(function (field) {
      var aliases = ALIASES[field];
      for (var i = 0; i < headers.length; i++) {
        if (used[i]) continue;
        if (aliases.indexOf(norm(headers[i])) > -1) { map[field] = i; used[i] = 1; return; }
      }
      /* fall back to a contains match — "Business Email", "Company URL" */
      for (var j = 0; j < headers.length; j++) {
        if (used[j]) continue;
        var h = norm(headers[j]);
        for (var k = 0; k < aliases.length; k++) {
          if (h.indexOf(aliases[k]) > -1) { map[field] = j; used[j] = 1; return; }
        }
      }
    });
    return map;
  }

  function openImport(done) {
    U.modal({
      title: 'Import leads',
      wide: true,
      okText: 'Preview',
      body: '<p style="margin:0 0 14px;color:var(--text-2);font-size:13px">' +
          'Copy the rows out of your spreadsheet — including the header row — and paste them below. ' +
          'Commas, tabs and semicolons all work.</p>' +
        '<div class="form-grid">' +
          '<div class="field span-2"><label>Pasted rows</label>' +
            '<textarea class="input" name="raw" rows="9" style="min-height:170px;font-family:var(--font-mono);font-size:12px" ' +
              'placeholder="Company,Contact,Email,Phone,Website&#10;Acme Roofing,Dan Ruiz,dan@acme.com,(602) 555-0100,acme.com"></textarea></div>' +
          U.field('Owner for imported leads', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), S.me().id, 'id', 'name') + '</select>') +
          U.field('Source label',
            '<input class="input" name="source" list="leadSourceOptions2" value="List / Import">' +
            '<datalist id="leadSourceOptions2">' +
              S.LEAD_SOURCES.map(function (s) { return '<option value="' + U.esc(s) + '">'; }).join('') +
            '</datalist>' +
            '<div class="hint">Used when a row has no source of its own.</div>') +
          U.field('First Follow-Up',
            '<input class="input" type="date" name="nextFollowUp" value="' + U.esc(S.shift(2)) + '">' +
            '<div class="hint">Applied to every imported lead so none of them land with no next step.</div>') +
          U.field('Tag them', U.tagInput('tagsRaw', [])) +
        '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.raw || !v.raw.trim()) { U.toast('Paste some rows first.', 'err'); return false; }
        var grid = parseDelimited(v.raw.trim(), detectDelim(v.raw));
        if (grid.length < 2) {
          U.toast('That looks like a header row with no data under it.', 'err');
          return false;
        }
        setTimeout(function () { previewImport(grid, v, done); }, 0);
      }
    });
  }

  function previewImport(grid, opts, done) {
    var headers = grid[0].map(function (h) { return String(h).trim(); });
    var dataRows = grid.slice(1);
    var map = guessMap(headers);

    U.modal({
      title: 'Check the columns',
      wide: true,
      okText: 'Import',
      body: '<div id="impMap"><div class="form-grid">' +
          FIELD_LABELS.map(function (pair) {
            return U.field(pair[1],
              '<select class="input" data-field="' + pair[0] + '">' +
                '<option value="">— not in this list —</option>' +
                headers.map(function (h, i) {
                  return '<option value="' + i + '"' + (map[pair[0]] === i ? ' selected' : '') + '>' +
                    U.esc(h || ('Column ' + (i + 1))) + '</option>';
                }).join('') +
              '</select>');
          }).join('') +
        '</div></div>' +
        '<div id="impPreview" style="margin-top:16px"></div>',
      onMount: function (box) {
        var okBtn = box.querySelector('[data-ok]');

        function build() {
          var m = {};
          box.querySelectorAll('[data-field]').forEach(function (sel) {
            if (sel.value !== '') m[sel.dataset.field] = Number(sel.value);
          });
          var known = S.knownKeys();
          var seen = {};
          var fresh = [], dupes = [], blank = 0;

          dataRows.forEach(function (r) {
            function cell(f) { return m[f] === undefined ? '' : String(r[m[f]] == null ? '' : r[m[f]]).trim(); }
            var rec = {
              name: cell('name'), contactName: cell('contactName'), contactTitle: cell('contactTitle'),
              email: cell('email'), phone: cell('phone'), website: cell('website'),
              address: cell('address'), industry: cell('industry'),
              source: cell('source') || opts.source || '',
              estValue: Number(String(cell('estValue')).replace(/[^0-9.]/g, '')) || 0,
              noteText: cell('noteText')
            };
            if (!rec.name) {
              /* No company name, but an email is still a usable handle. */
              if (rec.email) rec.name = rec.email.split('@')[0];
              else { blank++; return; }
            }
            var key = S.leadKey(rec);
            if (known[key] || seen[key]) { dupes.push(rec); return; }
            seen[key] = 1;
            fresh.push(rec);
          });

          box.__fresh = fresh;

          var noName = m.name === undefined;
          okBtn.disabled = noName || !fresh.length;
          okBtn.textContent = fresh.length ? 'Import ' + fresh.length + ' lead' + (fresh.length === 1 ? '' : 's') : 'Nothing to import';

          box.querySelector('#impPreview').innerHTML =
            (noName
              ? '<div class="card" style="border-color:rgba(229,72,77,.4)"><div class="card-body">' +
                '<strong>Pick the column holding the company name.</strong>' +
                '<div class="hint" style="margin-top:5px">Nothing can be imported without it.</div></div></div>'
              : '') +
            '<div class="split" style="margin-bottom:10px;flex-wrap:wrap">' +
              U.badge(fresh.length + ' new', fresh.length ? 'b-green' : 'b-grey') +
              (dupes.length ? U.badge(dupes.length + ' already known — skipped', 'b-yellow') : '') +
              (blank ? U.badge(blank + ' rows with no name — skipped', 'b-grey') : '') +
              '<span class="hint" style="margin-left:auto">Matched on email, then website, then company name.</span>' +
            '</div>' +
            (fresh.length
              ? U.table([
                  { key: 'name', label: 'Company', render: function (r) { return '<span class="strong">' + U.esc(r.name) + '</span>'; } },
                  { key: 'contact', label: 'Contact', render: function (r) { return U.esc(r.contactName || '—'); } },
                  { key: 'email', label: 'Email', render: function (r) { return U.esc(r.email || '—'); } },
                  { key: 'phone', label: 'Phone', render: function (r) { return U.esc(r.phone || '—'); } },
                  { key: 'website', label: 'Website', render: function (r) { return U.esc(r.website || '—'); } }
                ], fresh.slice(0, 8), {})
              : '') +
            (fresh.length > 8
              ? '<div class="hint" style="margin-top:8px">Showing the first 8 of ' + fresh.length + '.</div>' : '');
        }

        box.querySelectorAll('[data-field]').forEach(function (sel) { sel.onchange = build; });
        build();
      },
      onOk: function (box) {
        var fresh = box.__fresh || [];
        if (!fresh.length) { U.toast('Nothing to import.', 'err'); return false; }

        var tags = S.parseTags(opts.tagsRaw);
        var pending = [];
        var rows = fresh.map(function (r) {
          var noteText = r.noteText; delete r.noteText;
          var lead = {
            id: S.uid('l'),
            name: r.name, contactName: r.contactName, contactTitle: r.contactTitle,
            email: r.email, phone: r.phone, website: r.website,
            address: r.address, industry: r.industry, source: r.source,
            estValue: r.estValue,
            leadStatus: 'new', rating: 'warm',
            ownerId: opts.ownerId || S.me().id,
            nextFollowUp: opts.nextFollowUp || '',
            lastContactedAt: '',
            tags: tags.slice(),
            convertedCustomerId: '', convertedAt: ''
          };
          if (noteText) pending.push({ id: lead.id, body: noteText });
          return lead;
        });

        S.insertMany('leads', rows, 'l', rows.length + ' leads imported');
        pending.forEach(function (p) { S.addNote('lead', p.id, p.body); });

        U.toast(rows.length + ' lead' + (rows.length === 1 ? '' : 's') + ' imported.', 'ok');
        done();
      }
    });
  }

  /* ── CSV export ──────────────────────────────────────────────── */
  function exportCsv(rows) {
    var head = ['Company', 'Contact', 'Title', 'Email', 'Phone', 'Status', 'Rating',
      'Next Follow-Up', 'Last Contacted', 'Est. Value', 'Source', 'Owner', 'Industry', 'Location', 'Website', 'Tags'];
    var lines = [head.join(',')].concat(rows.map(function (l) {
      return [l.name, l.contactName, l.contactTitle, l.email, l.phone,
        S.leadStatus(l.leadStatus).label, S.leadRating(l.rating).label,
        l.nextFollowUp, l.lastContactedAt, l.estValue, l.source,
        S.user(l.ownerId).name, l.industry, l.address, l.website, S.tagsOf(l).join(' | ')]
        .map(function (f) { return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(',');
    }));
    root.download('thinkfirst-leads-' + S.today() + '.csv', lines.join('\n'), 'text/csv');
    U.toast('CSV exported.', 'ok');
  }

  root.Views.leads.openForm = openForm;
  root.Views.leads.openImport = openImport;
  /* exposed for the smoke tests */
  root.Views.leads._parse = parseDelimited;
  root.Views.leads._detectDelim = detectDelim;
  root.Views.leads._guessMap = guessMap;
})(window);
