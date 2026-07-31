/* Vendors — mirrors the customer object, plus vendor type, terms and rating. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var ICON = '<svg viewBox="0 0 24 24" class="ico"><path d="M3 21V9l9-6 9 6v12M9 21v-7h6v7"/></svg>';
  var st = { q: '', status: '', type: '', owner: '', service: '', sortKey: 'name', sortDir: 1 };

  /* ── list ────────────────────────────────────────────────────── */
  root.Views.vendors = function (el, params) {
    if (params.id) return detail(el, params.id);

    var rows = S.all('vendors').filter(function (v) {
      if (st.status && v.status !== st.status) return false;
      if (st.type && v.vendorType !== st.type) return false;
      if (st.owner && v.ownerId !== st.owner) return false;
      if (st.service && (v.services || []).indexOf(st.service) < 0) return false;
      if (st.q) {
        var hay = [v.name, v.contactName, v.email, v.phone, S.vendorType(v.vendorType).label, v.address].join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var spend = rows.reduce(function (s, v) { return s + (Number(v.value) || 0); }, 0);
    var openWork = S.all('workOrders').filter(function (w) { return w.entityType === 'vendor' && w.status !== 'complete'; }).length;

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Vendors</h1>' +
          '<div class="page-sub">' + rows.length + ' of ' + S.all('vendors').length + ' vendors · ' +
            S.money(spend) + ' committed spend · ' + openWork + ' open vendor work orders</div></div>' +
        '<div class="page-actions">' +
          '<button class="btn" id="vendorWork">Vendor work orders</button>' +
          '<button class="btn btn-primary" id="newVendor">+ New Vendor</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        S.VENDOR_TYPES().slice(0, 4).map(function (t) {
          var n = S.all('vendors').filter(function (v) { return v.vendorType === t.id; }).length;
          return '<div class="kpi"><div class="kpi-label">' + U.esc(t.label) + '</div>' +
            '<div class="kpi-value">' + n + '</div><div class="kpi-foot">vendor' + (n === 1 ? '' : 's') + ' on file</div></div>';
        }).join('') +
      '</div>' +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search vendors…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="ftype"><option value="">All vendor types</option>' + U.options(S.VENDOR_TYPES(), st.type) + '</select>' +
        '<select class="input" id="fstatus"><option value="">All statuses</option>' + U.options(S.STATUSES(), st.status) + '</select>' +
        '<select class="input" id="fowner"><option value="">All owners</option>' + U.options(S.activeUsers(), st.owner, 'id', 'name') + '</select>' +
        '<select class="input" id="fservice"><option value="">All services</option>' + U.options(S.all('services'), st.service, 'id', 'name') + '</select>' +
        '<button class="btn btn-ghost btn-sm" id="clear">Clear</button>' +
        '<button class="btn btn-sm" id="exportCsv" style="margin-left:auto">Export CSV</button>' +
      '</div>' +
      U.table(cols(), rows, {
        rowLink: true, sortKey: st.sortKey, sortDir: st.sortDir,
        emptyHTML: U.empty('No vendors match', 'Clear the filters, or add your first vendor.')
      }) + '</div>';

    el.querySelector('#newVendor').onclick = function () { openForm(null, root.render); };
    el.querySelector('#vendorWork').onclick = function () { location.hash = '#/workorders'; };
    if (params.new) openForm(null, function () { location.hash = '#/vendors'; root.render(); });

    var q = el.querySelector('#fq'), t;
    q.oninput = function () { clearTimeout(t); t = setTimeout(function () { st.q = q.value; root.render(); }, 220); };
    ['type', 'status', 'owner', 'service'].forEach(function (k) {
      el.querySelector('#f' + k).onchange = function () { st[k] = this.value; root.render(); };
    });
    el.querySelector('#clear').onclick = function () {
      st.q = ''; st.type = ''; st.status = ''; st.owner = ''; st.service = ''; root.render();
    };
    el.querySelector('#exportCsv').onclick = function () { exportCsv(rows); };

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { location.hash = '#/vendors/' + id; }
    });
  };

  function cols() {
    return [
      { key: 'name', label: 'Vendor', sort: function (v) { return v.name; },
        render: function (v) {
          return '<div><span class="link">' + U.esc(v.name) + '</span>' +
            '<div class="muted" style="font-size:11.5px">' + U.esc(v.contactName || '') + '</div></div>';
        } },
      { key: 'type', label: 'Vendor Type', sort: function (v) { return S.vendorType(v.vendorType).label; },
        render: function (v) { return U.badge(S.vendorType(v.vendorType).label, 'b-violet'); } },
      { key: 'status', label: 'Status', sort: function (v) { return S.status(v.status).order; },
        render: function (v) { return U.statusBadge(v.status); } },
      { key: 'services', label: 'Services',
        render: function (v) {
          var names = S.serviceNames(v.services);
          if (!names.length) return '<span class="muted">—</span>';
          return '<div class="chips">' + names.slice(0, 2).map(function (n) { return '<span class="chip">' + U.esc(n) + '</span>'; }).join('') +
            (names.length > 2 ? '<span class="chip">+' + (names.length - 2) + '</span>' : '') + '</div>';
        } },
      { key: 'work', label: 'Work Orders', cls: 'right', sort: function (v) { return S.workOrdersFor('vendor', v.id).length; },
        render: function (v) {
          var w = S.workOrdersFor('vendor', v.id);
          var openN = w.filter(function (x) { return x.status !== 'complete'; }).length;
          if (!w.length) return '<span class="muted">—</span>';
          return '<span class="mono">' + openN + ' open</span><div class="muted" style="font-size:11px">' + w.length + ' total</div>';
        } },
      { key: 'value', label: 'Spend', cls: 'right', sort: function (v) { return Number(v.value) || 0; },
        render: function (v) { return '<span class="mono">' + S.money(v.value) + '</span><div class="muted" style="font-size:11px">' + U.esc(v.billingCycle || '') + '</div>'; } },
      { key: 'billing', label: 'Billing Date', sort: function (v) { return v.billingDate || '9999'; },
        render: function (v) {
          if (!v.billingDate) return '<span class="muted">—</span>';
          var t = U.dueTone(v.billingDate);
          return '<div>' + U.fmtDateShort(v.billingDate) + '</div><span class="badge ' +
            (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-top:3px">' + U.esc(t.text) + '</span>';
        } },
      { key: 'owner', label: 'Owner', sort: function (v) { return S.user(v.ownerId).name; },
        render: function (v) { return U.userCell(v.ownerId); } },
      { key: 'notes', label: 'Notes', cls: 'right',
        render: function (v) {
          var n = S.notesFor('vendor', v.id);
          if (!n.length) return '<span class="muted">—</span>';
          var authors = {}; n.forEach(function (x) { authors[x.authorId] = 1; });
          return '<div class="split" style="justify-content:flex-end"><span class="avatars">' +
            Object.keys(authors).slice(0, 3).map(function (id) { return U.avatar(id, 'sm'); }).join('') +
            '</span><span class="muted mono">' + n.length + '</span></div>';
        } }
    ];
  }

  /* ── detail ──────────────────────────────────────────────────── */
  function detail(el, id) {
    root.RecordView.render(el, {
      coll: 'vendors', type: 'vendor', id: id, icon: ICON,
      backHref: '#/vendors', backLabel: 'Vendors',
      detailRows: function (v) {
        return row('Vendor', U.esc(v.name)) +
          row('Vendor Type', U.badge(S.vendorType(v.vendorType).label, 'b-violet')) +
          row('Primary Contact', U.esc(v.contactName || '—')) +
          row('Email', v.email ? '<a href="mailto:' + U.esc(v.email) + '" style="color:var(--orange)">' + U.esc(v.email) + '</a>' : '—') +
          row('Phone', U.esc(v.phone || '—')) +
          row('Status', U.statusBadge(v.status)) +
          row('Services Supplied', S.serviceNames(v.services).join(', ') || '—') +
          row('Billing Date', U.fmtDate(v.billingDate)) +
          row('Billing Cycle', U.esc(v.billingCycle || '—')) +
          row('Committed Spend', '<span class="mono">' + S.money(v.value) + '</span>') +
          row('Payment Terms', U.esc(v.terms || '—')) +
          row('Rating', stars(v.rating)) +
          row('Location', U.esc(v.address || '—')) +
          row('Website', v.website ? '<a href="https://' + U.esc(v.website) + '" target="_blank" rel="noopener" style="color:var(--orange)">' + U.esc(v.website) + '</a>' : '—') +
          row('Relationship Owner', U.userCell(v.ownerId)) +
          row('Created', U.fmtDate(v.createdAt));
      },
      onEdit: function (v, done) { openForm(v, done); }
    });
  }
  function row(k, v) { return '<dt>' + U.esc(k) + '</dt><dd>' + v + '</dd>'; }
  function stars(n) {
    n = Number(n) || 0;
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<span style="color:' + (i <= n ? 'var(--orange)' : 'var(--line-2)') + '">★</span>';
    return out + ' <span class="muted" style="font-size:11.5px">' + (n || '—') + '/5</span>';
  }

  /* ── form ────────────────────────────────────────────────────── */
  function openForm(v, done) {
    var isNew = !v;
    v = v || { status: 'new', ownerId: S.me().id, billingCycle: 'Monthly', services: [], vendorType: S.VENDOR_TYPES()[0].id, rating: 3 };

    U.modal({
      title: isNew ? 'New Vendor' : 'Edit ' + v.name,
      wide: true,
      okText: isNew ? 'Create Vendor' : 'Save Changes',
      body: '<div class="form-grid">' +
        U.field('Vendor Name *', '<input class="input" name="name" value="' + U.esc(v.name || '') + '" required>') +
        U.field('Vendor Type *', '<select class="input" name="vendorType">' + U.options(S.VENDOR_TYPES(), v.vendorType) + '</select>') +
        U.field('Primary Contact', '<input class="input" name="contactName" value="' + U.esc(v.contactName || '') + '">') +
        U.field('Email', '<input class="input" type="email" name="email" value="' + U.esc(v.email || '') + '">') +
        U.field('Phone', '<input class="input" name="phone" value="' + U.esc(v.phone || '') + '">') +
        U.field('Status', '<select class="input" name="status">' + U.options(S.STATUSES(), v.status) + '</select>') +
        U.field('Billing Date', '<input class="input" type="date" name="billingDate" value="' + U.esc(v.billingDate || '') + '">') +
        U.field('Billing Cycle', '<select class="input" name="billingCycle">' + U.options(S.BILLING_CYCLES, v.billingCycle) + '</select>') +
        U.field('Committed Spend ($)', '<input class="input" type="number" min="0" step="50" name="value" value="' + U.esc(v.value || 0) + '">') +
        U.field('Payment Terms', '<input class="input" name="terms" placeholder="Net 30, 50% deposit…" value="' + U.esc(v.terms || '') + '">') +
        U.field('Rating', '<select class="input" name="rating">' +
          [5, 4, 3, 2, 1].map(function (n) { return '<option value="' + n + '"' + (String(v.rating) === String(n) ? ' selected' : '') + '>' + n + ' / 5</option>'; }).join('') +
          '</select>') +
        U.field('Relationship Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), v.ownerId, 'id', 'name') + '</select>') +
        U.field('Location', '<input class="input" name="address" value="' + U.esc(v.address || '') + '">') +
        U.field('Website', '<input class="input" name="website" placeholder="example.com" value="' + U.esc(v.website || '') + '">') +
        '<div class="field span-2"><label>Services They Supply</label>' + U.serviceChecks('services', v.services) + '</div>' +
        (isNew ? '<div class="field span-2"><label>Opening Note (optional)</label>' +
          '<textarea class="input" name="openingNote" placeholder="Lead times, quirks, who to call…"></textarea></div>' : '') +
      '</div>',
      onOk: function (box) {
        var data = U.values(box);
        if (!data.name) { U.toast('Vendor name is required.', 'err'); return false; }
        data.value = Number(data.value) || 0;
        data.rating = Number(data.rating) || 0;
        var note = data.openingNote; delete data.openingNote;

        if (isNew) {
          var created = S.insert('vendors', data, 'v', data.name);
          if (note) S.addNote('vendor', created.id, note);
          U.toast(data.name + ' created.', 'ok');
        } else {
          S.update('vendors', v.id, data, 'vendor details');
          U.toast('Saved.', 'ok');
        }
        done();
      }
    });
  }

  function exportCsv(rows) {
    var head = ['Vendor', 'Vendor Type', 'Contact', 'Email', 'Phone', 'Status', 'Services', 'Billing Date', 'Cycle', 'Spend', 'Terms', 'Rating', 'Owner', 'Open Work Orders'];
    var lines = [head.join(',')].concat(rows.map(function (v) {
      return [v.name, S.vendorType(v.vendorType).label, v.contactName, v.email, v.phone, S.status(v.status).label,
        S.serviceNames(v.services).join(' | '), v.billingDate, v.billingCycle, v.value, v.terms, v.rating,
        S.user(v.ownerId).name, S.workOrdersFor('vendor', v.id).filter(function (w) { return w.status !== 'complete'; }).length]
        .map(function (f) { return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(',');
    }));
    root.download('thinkfirst-vendors-' + S.today() + '.csv', lines.join('\n'), 'text/csv');
    U.toast('CSV exported.', 'ok');
  }

  root.Views.vendors.openForm = openForm;
})(window);
