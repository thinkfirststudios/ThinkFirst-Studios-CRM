/* Work Orders — the unit of daily execution, shared by customers and vendors. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  /* Work can hang off an account, a deal or a vendor. Deals matter here:
     delivery is usually scoped to the thing that was sold, and pinning
     it to the account instead loses which sale it belonged to. */
  var ENTITY_KINDS = [
    { id: 'customer',    label: 'Account',     list: function () { return S.accounts(); },
      name: function (r) { return r.name; } },
    { id: 'opportunity', label: 'Opportunity', list: function () { return S.all('opportunities'); },
      name: function (r) { return r.name + ' · ' + S.accountName(r.accountId); } },
    { id: 'vendor',      label: 'Vendor',      list: function () { return S.all('vendors'); },
      name: function (r) { return r.name; } }
  ];

  var st = { q: '', status: 'open', assignee: '', scope: 'all', sortKey: 'due', sortDir: 1 };

  /* Column set reused by the record page's Work Orders tab. */
  root.WorkOrderCols = function () {
    return [
      { key: 'title', label: 'Work Order', sort: function (w) { return w.title; },
        render: function (w) {
          var p = S.priority(w.priority);
          return '<div class="split"><span class="prio-flag" style="background:' + p.color + ';height:26px"></span>' +
            '<div><span class="link">' + U.esc(w.title) + '</span>' +
            '<div class="muted" style="font-size:11.5px">' + U.esc(S.service(w.serviceId).name) + '</div></div></div>';
        } },
      { key: 'account', label: 'Account', sort: function (w) { return S.recordName(w.entityType, w.entityId); },
        render: function (w) {
          return '<div>' + U.esc(S.recordName(w.entityType, w.entityId)) + '</div>' +
            U.badge(w.entityType === 'vendor' ? 'Vendor' : 'Customer', w.entityType === 'vendor' ? 'b-violet' : 'b-blue');
        } },
      { key: 'status', label: 'Status', sort: function (w) { return w.status; },
        render: function (w) { return U.woBadge(w.status); } },
      { key: 'priority', label: 'Priority', sort: function (w) { return ['urgent', 'high', 'normal', 'low'].indexOf(w.priority); },
        render: function (w) { var p = S.priority(w.priority); return U.badge(p.label, p.tone); } },
      { key: 'assignee', label: 'Assignee', sort: function (w) { return S.user(w.assigneeId).name; },
        render: function (w) { return U.userCell(w.assigneeId); } },
      { key: 'due', label: 'Due', sort: function (w) { return w.dueDate || '9999'; },
        render: function (w) {
          var t = U.dueTone(w.dueDate, w.status === 'complete');
          return '<div>' + U.fmtDateShort(w.dueDate) + '</div><span class="badge ' +
            (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-top:3px">' + U.esc(t.text) + '</span>';
        } },
      { key: 'hours', label: 'Hours', cls: 'right', sort: function (w) { return Number(w.estHours) || 0; },
        render: function (w) {
          var logged = S.timeFor(w.id).reduce(function (s, t) { return s + t.hours; }, 0);
          return '<span class="mono">' + logged + ' / ' + (w.estHours || 0) + '</span>';
        } }
    ];
  };

  /* ── list ────────────────────────────────────────────────────── */
  root.Views.workorders = function (el, params) {
    if (params.id) return detail(el, params.id);

    var rows = S.all('workOrders').filter(function (w) {
      if (st.status === 'open' && w.status === 'complete') return false;
      if (st.status && st.status !== 'open' && w.status !== st.status) return false;
      if (st.assignee && w.assigneeId !== st.assignee) return false;
      if (st.scope !== 'all' && w.entityType !== st.scope) return false;
      if (st.q) {
        var hay = [w.title, w.description, S.recordName(w.entityType, w.entityId)].join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var overdue = rows.filter(S.isOverdue).length;

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Work Orders</h1>' +
          '<div class="page-sub">' + rows.length + ' shown' + (overdue ? ' · <span style="color:var(--danger)">' + overdue + ' overdue</span>' : '') + '</div></div>' +
        '<div class="page-actions">' +
          '<a class="btn" href="#/tracker">Daily Tracker</a>' +
          '<button class="btn btn-primary" id="newWo">+ New Work Order</button>' +
        '</div>' +
      '</div>' +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search work orders…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="fstatus">' +
          '<option value="open"' + (st.status === 'open' ? ' selected' : '') + '>Open only</option>' +
          '<option value=""' + (st.status === '' ? ' selected' : '') + '>All statuses</option>' +
          U.options(S.WO_STATUSES, st.status) + '</select>' +
        '<select class="input" id="fassignee"><option value="">Everyone</option>' + U.options(S.activeUsers(), st.assignee, 'id', 'name') + '</select>' +
        '<div class="seg" id="scope">' +
          '<button data-scope="all" class="' + (st.scope === 'all' ? 'on' : '') + '">All</button>' +
          '<button data-scope="customer" class="' + (st.scope === 'customer' ? 'on' : '') + '">Customer</button>' +
          '<button data-scope="vendor" class="' + (st.scope === 'vendor' ? 'on' : '') + '">Vendor</button>' +
        '</div>' +
      '</div>' +
      U.table(root.WorkOrderCols(), rows, {
        rowLink: true, sortKey: st.sortKey, sortDir: st.sortDir,
        emptyHTML: U.empty('No work orders match', 'Adjust the filters or create one.')
      }) + '</div>';

    el.querySelector('#newWo').onclick = function () { open({}, root.render); };
    var q = el.querySelector('#fq'), t;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { st.q = q.value; root.render(); }, 220); };
    el.querySelector('#fstatus').onchange = function () { st.status = this.value; root.render(); };
    el.querySelector('#fassignee').onchange = function () { st.assignee = this.value; root.render(); };
    el.querySelectorAll('#scope button').forEach(function (b) {
      b.onclick = function () { st.scope = b.dataset.scope; root.render(); };
    });

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { location.hash = '#/workorders/' + id; }
    });
  };

  /* ── detail ──────────────────────────────────────────────────── */
  function detail(el, id) {
    var w = S.find('workOrders', id);
    if (!w) { el.innerHTML = U.empty('Work order not found', '', '<a class="btn" href="#/workorders">Back</a>'); return; }

    var rerender = function () { detail(el, id); };
    var entries = S.timeFor(w.id).sort(function (a, b) { return b.date.localeCompare(a.date); });
    var logged = entries.reduce(function (s, t) { return s + t.hours; }, 0);
    var p = S.priority(w.priority);
    var t = U.dueTone(w.dueDate, w.status === 'complete');
    var pct = w.estHours ? Math.min(100, Math.round(logged / w.estHours * 100)) : 0;

    el.innerHTML =
      '<div style="margin-bottom:12px"><a class="btn btn-ghost btn-sm" href="#/workorders">' +
        '<svg viewBox="0 0 24 24" class="ico"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Work Orders</a></div>' +

      '<div class="record-hero"><div class="record-top">' +
        '<div class="record-icon"><svg viewBox="0 0 24 24" class="ico"><path d="M20 7h-3V5a2 2 0 00-2-2H9a2 2 0 00-2 2v2H4a1 1 0 00-1 1v11a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1zM9 7V5h6v2"/></svg></div>' +
        '<div style="min-width:0"><h1 class="record-name">' + U.esc(w.title) + '</h1>' +
          '<div class="record-meta">' + U.woBadge(w.status) + U.badge(p.label, p.tone) +
            '<a class="link" href="' + U.esc(S.entityHref(w.entityType, w.entityId)) + '">' +
              U.esc(S.recordName(w.entityType, w.entityId)) + '</a>' +
            '<span class="chip">' + U.esc(S.service(w.serviceId).name) + '</span></div></div>' +
        '<div class="page-actions">' +
          '<select class="input" id="statusSel" style="max-width:170px">' + U.options(S.WO_STATUSES, w.status) + '</select>' +
          '<button class="btn btn-sm" id="logTime">Log Time</button>' +
          '<button class="btn btn-sm" id="editWo">Edit</button>' +
          '<button class="btn btn-sm btn-danger" id="delWo">Delete</button>' +
        '</div></div>' +

        '<div class="highlights">' +
          hl('Assignee', U.userCell(w.assigneeId)) +
          hl('Scheduled', U.fmtDate(w.scheduledDate)) +
          hl('Due', U.fmtDate(w.dueDate) + ' <span class="badge ' + (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-left:6px">' + U.esc(t.text) + '</span>') +
          hl('Hours', '<span class="mono">' + logged + ' / ' + (w.estHours || 0) + '</span>' +
            '<div class="bar" style="margin-top:6px"><i style="width:' + pct + '%"></i></div>') +
        '</div></div>' +

      '<div class="detail-cols">' +
        '<div class="stack">' +
          '<div class="card"><div class="card-head"><span class="card-title">Scope</span></div>' +
            '<div class="card-body"><div class="note-text">' + (U.esc(w.description) || '<span class="muted">No description.</span>') + '</div></div></div>' +
          '<div class="card"><div class="card-head"><span class="card-title">Notes</span>' +
            '<span class="kcol-count">' + S.notesFor('workorder', w.id).length + '</span></div>' +
            '<div class="card-body">' + U.notesPanel('workorder', w.id) + '</div></div>' +
        '</div>' +
        '<div class="stack">' +
          '<div class="card"><div class="card-head"><span class="card-title">Time Log</span>' +
            '<span class="kcol-count mono">' + logged + 'h</span></div><div class="card-body">' +
            (entries.length ? entries.map(function (e) {
              return '<div style="padding:8px 0;border-bottom:1px solid var(--line)">' +
                '<div class="split">' + U.avatar(e.userId, 'sm') +
                  '<span style="font-size:12.5px">' + U.esc(S.user(e.userId).name) + '</span>' +
                  '<span class="mono strong" style="margin-left:auto;color:var(--orange)">' + e.hours + 'h</span></div>' +
                '<div class="muted" style="font-size:11.5px;margin-top:3px">' + U.fmtDateShort(e.date) +
                  (e.note ? ' · ' + U.esc(e.note) : '') + '</div></div>';
            }).join('') : '<span class="muted">No time logged yet.</span>') + '</div></div>' +
          '<div class="card"><div class="card-head"><span class="card-title">History</span></div>' +
            '<div class="card-body">' + U.timeline(S.activityFor('workOrders', w.id), 20) + '</div></div>' +
        '</div>' +
      '</div>';

    function hl(label, value) {
      return '<div class="highlight"><div class="hl-label">' + U.esc(label) + '</div><div class="hl-value">' + value + '</div></div>';
    }

    U.bindNotes(el, 'workorder', w.id, rerender);
    el.querySelector('#statusSel').onchange = function () {
      S.setWorkOrderStatus(w.id, this.value);
      U.toast('Status updated.', 'ok');
      rerender();
    };
    el.querySelector('#editWo').onclick = function () { open(w, rerender); };
    el.querySelector('#logTime').onclick = function () { openTimeLog(w, rerender); };
    el.querySelector('#delWo').onclick = function () {
      U.confirmDelete(w.title, function () {
        S.removeCascade('workOrders', w.id);
        U.toast('Work order deleted.');
        location.hash = '#/workorders';
      });
    };
  }

  /* ── form ────────────────────────────────────────────────────── */
  function open(w, done) {
    var isNew = !w || !w.id;
    var defaults = {
      entityType: 'customer', assigneeId: S.me().id, status: 'notstarted', priority: 'normal',
      scheduledDate: S.today(), dueDate: S.today(), estHours: 1
    };
    w = Object.assign({}, defaults, w || {});

    var box = U.modal({
      title: isNew ? 'New Work Order' : 'Edit Work Order',
      wide: true,
      okText: isNew ? 'Create' : 'Save',
      body: '<div class="form-grid">' +
        U.field('Title *', '<input class="input" name="title" value="' + U.esc(w.title || '') + '" placeholder="What needs doing?">', true) +
        U.field('Related To', '<select class="input" name="entityType">' +
          ENTITY_KINDS.map(function (k) {
            return '<option value="' + k.id + '"' + (w.entityType === k.id ? ' selected' : '') + '>' + k.label + '</option>';
          }).join('') + '</select>') +
        U.field('Record *', '<select class="input" name="entityId" id="entitySel"></select>') +
        U.field('Service', '<select class="input" name="serviceId"><option value="">—</option>' +
          U.options(S.all('services'), w.serviceId, 'id', 'name') + '</select>') +
        U.field('Assignee', '<select class="input" name="assigneeId">' + U.options(S.activeUsers(), w.assigneeId, 'id', 'name') + '</select>') +
        U.field('Status', '<select class="input" name="status">' + U.options(S.WO_STATUSES, w.status) + '</select>') +
        U.field('Priority', '<select class="input" name="priority">' + U.options(S.PRIORITIES, w.priority) + '</select>') +
        U.field('Scheduled For', '<input class="input" type="date" name="scheduledDate" value="' + U.esc(w.scheduledDate || '') + '">') +
        U.field('Due Date', '<input class="input" type="date" name="dueDate" value="' + U.esc(w.dueDate || '') + '">') +
        U.field('Estimated Hours', '<input class="input" type="number" min="0" step="0.25" name="estHours" value="' + U.esc(w.estHours || 0) + '">') +
        U.field('Description', '<textarea class="input" name="description" placeholder="Scope, links, acceptance criteria…">' + U.esc(w.description || '') + '</textarea>', true) +
      '</div>',
      onOk: function (b) {
        var v = U.values(b);
        if (!v.title) { U.toast('Give the work order a title.', 'err'); return false; }
        if (!v.entityId) { U.toast('Pick the record this work belongs to.', 'err'); return false; }
        v.estHours = Number(v.estHours) || 0;
        if (isNew) { S.insert('workOrders', v, 'w', v.title); U.toast('Work order created.', 'ok'); }
        else { S.update('workOrders', w.id, v, v.title); U.toast('Saved.', 'ok'); }
        if (done) done();
      }
    });

    /* the record dropdown follows the Related To toggle */
    var typeSel = box.querySelector('[name=entityType]');
    var entSel = box.querySelector('#entitySel');
    function fillAccounts() {
      var kind = ENTITY_KINDS.filter(function (k) { return k.id === typeSel.value; })[0] || ENTITY_KINDS[0];
      var list = kind.list();
      entSel.innerHTML = '<option value="">— select —</option>' +
        list.map(function (r) {
          return '<option value="' + U.esc(r.id) + '"' + (r.id === w.entityId ? ' selected' : '') + '>' +
            U.esc(kind.name(r)) + '</option>';
        }).join('');
    }
    typeSel.onchange = fillAccounts;
    fillAccounts();
  }

  /* ── time logging ────────────────────────────────────────────── */
  function openTimeLog(w, done) {
    U.modal({
      title: 'Log time — ' + w.title,
      okText: 'Log',
      body: '<div class="form-grid">' +
        U.field('Date', '<input class="input" type="date" name="date" value="' + S.today() + '">') +
        U.field('Hours', '<input class="input" type="number" min="0" step="0.25" name="hours" value="1">') +
        U.field('What did you do?', '<textarea class="input" name="note" placeholder="Optional progress note"></textarea>', true) +
      '</div>',
      onOk: function (b) {
        var v = U.values(b);
        if (!Number(v.hours)) { U.toast('Enter hours.', 'err'); return false; }
        S.logTime(w.id, v.date, v.hours, v.note);
        U.toast('Logged ' + v.hours + 'h.', 'ok');
        if (done) done();
      }
    });
  }

  root.WorkOrderForm = { open: open, openTimeLog: openTimeLog };
})(window);
