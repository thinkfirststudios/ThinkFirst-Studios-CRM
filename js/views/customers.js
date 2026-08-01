/* Customers — list view, record page, and the create/edit form. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var ICON = '<svg viewBox="0 0 24 24" class="ico"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87"/></svg>';

  /* view state survives re-renders within a session */
  var st = { q: '', status: '', owner: '', service: '', sortKey: 'name', sortDir: 1 };

  /* ── list ────────────────────────────────────────────────────── */
  root.Views.customers = function (el, params) {
    if (params.id) return detail(el, params.id);

    var rows = S.all('customers').filter(function (c) {
      if (st.status && c.status !== st.status) return false;
      if (st.owner && c.ownerId !== st.owner) return false;
      if (st.service && (c.services || []).indexOf(st.service) < 0) return false;
      if (st.q) {
        var hay = [c.name, c.contactName, c.email, c.phone, c.industry, c.address].join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var totalValue = rows.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Customers</h1>' +
          '<div class="page-sub">' + rows.length + ' of ' + S.all('customers').length + ' records · ' +
            S.money(totalValue) + ' represented</div></div>' +
        '<div class="page-actions">' +
          '<a class="btn" href="#/pipeline">Pipeline view</a>' +
          '<button class="btn btn-primary" id="newCust">+ New Customer</button>' +
        '</div>' +
      '</div>' +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search name, contact, email…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="fstatus"><option value="">All statuses</option>' + U.options(S.STATUSES(), st.status) + '</select>' +
        '<select class="input" id="fowner"><option value="">All owners</option>' + U.options(S.activeUsers(), st.owner, 'id', 'name') + '</select>' +
        '<select class="input" id="fservice"><option value="">All services</option>' + U.options(S.all('services'), st.service, 'id', 'name') + '</select>' +
        '<button class="btn btn-ghost btn-sm" id="clear">Clear</button>' +
        '<button class="btn btn-sm" id="exportCsv" style="margin-left:auto">Export CSV</button>' +
      '</div>' +
      U.table(cols(), rows, {
        rowLink: true, sortKey: st.sortKey, sortDir: st.sortDir,
        emptyHTML: U.empty('No customers match', 'Try clearing the filters, or add your first record.')
      }) + '</div>';

    el.querySelector('#newCust').onclick = function () { openForm(null, function () { root.render(); }); };
    if (params.new) openForm(null, function () { location.hash = '#/customers'; root.render(); });

    bindFilter(el, '#fq', 'q', true);
    bindFilter(el, '#fstatus', 'status');
    bindFilter(el, '#fowner', 'owner');
    bindFilter(el, '#fservice', 'service');
    el.querySelector('#clear').onclick = function () {
      st.q = ''; st.status = ''; st.owner = ''; st.service = ''; root.render();
    };
    el.querySelector('#exportCsv').onclick = function () { exportCsv(rows); };

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { location.hash = '#/customers/' + id; }
    });

    function bindFilter(scope, sel, key, isText) {
      var node = scope.querySelector(sel);
      if (isText) {
        var t;
        node.oninput = function () { clearTimeout(t); t = setTimeout(function () { st[key] = node.value; root.render(); node = null; }, 220); };
      } else {
        node.onchange = function () { st[key] = node.value; root.render(); };
      }
    }
  };

  function cols() {
    return [
      { key: 'name', label: 'Customer', sort: function (c) { return c.name; },
        render: function (c) {
          return '<div><span class="link">' + U.esc(c.name) + '</span>' +
            '<div class="muted" style="font-size:11.5px">' + U.esc(c.contactName || '') + '</div></div>';
        } },
      { key: 'status', label: 'Status', sort: function (c) { return S.status(c.status).order; },
        render: function (c) { return U.statusBadge(c.status); } },
      { key: 'services', label: 'Services',
        render: function (c) {
          var names = S.serviceNames(c.services);
          if (!names.length) return '<span class="muted">—</span>';
          return '<div class="chips">' + names.slice(0, 2).map(function (n) { return '<span class="chip">' + U.esc(n) + '</span>'; }).join('') +
            (names.length > 2 ? '<span class="chip">+' + (names.length - 2) + '</span>' : '') + '</div>';
        } },
      { key: 'value', label: 'Value', cls: 'right', sort: function (c) { return Number(c.value) || 0; },
        render: function (c) { return '<span class="mono">' + S.money(c.value) + '</span><div class="muted" style="font-size:11px">' + U.esc(c.billingCycle || '') + '</div>'; } },
      { key: 'billing', label: 'Billing Date', sort: function (c) { return c.billingDate || '9999'; },
        render: function (c) {
          if (!c.billingDate) return '<span class="muted">—</span>';
          var t = U.dueTone(c.billingDate);
          return '<div>' + U.fmtDateShort(c.billingDate) + '</div><span class="badge ' +
            (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-top:3px">' + U.esc(t.text) + '</span>';
        } },
      { key: 'owner', label: 'Owner', sort: function (c) { return S.user(c.ownerId).name; },
        render: function (c) { return U.userCell(c.ownerId); } },
      { key: 'notes', label: 'Notes', cls: 'right',
        render: function (c) {
          var n = S.notesFor('customer', c.id);
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
      coll: 'customers', type: 'customer', id: id, icon: ICON,
      backHref: '#/customers', backLabel: 'Customers',
      extraTabs: S.stripeEnabled() ? [{
        id: 'payments',
        label: 'Payments',
        count: function (c) { return S.invoicesFor(c.id).length; },
        render: paymentsTab
      }] : null,
      detailRows: function (c) {
        return row('Company', U.esc(c.name)) +
          row('Primary Contact', U.esc(c.contactName || '—')) +
          row('Email', c.email ? '<a href="mailto:' + U.esc(c.email) + '" style="color:var(--orange)">' + U.esc(c.email) + '</a>' : '—') +
          row('Phone', U.esc(c.phone || '—')) +
          row('Status', U.statusBadge(c.status)) +
          row('Services', S.serviceNames(c.services).join(', ') || '—') +
          row('Billing Date', U.fmtDate(c.billingDate)) +
          row('Billing Cycle', U.esc(c.billingCycle || '—')) +
          row('Contract Value', '<span class="mono">' + S.money(c.value) + '</span>') +
          row('Industry', U.esc(c.industry || '—')) +
          row('Lead Source', U.esc(c.source || '—')) +
          row('Location', U.esc(c.address || '—')) +
          row('Website', c.website ? '<a href="https://' + U.esc(c.website) + '" target="_blank" rel="noopener" style="color:var(--orange)">' + U.esc(c.website) + '</a>' : '—') +
          row('Account Owner', U.userCell(c.ownerId)) +
          row('Created', U.fmtDate(c.createdAt));
      },
      onEdit: function (c, done) { openForm(c, done); }
    });
  }
  function row(k, v) { return '<dt>' + U.esc(k) + '</dt><dd>' + v + '</dd>'; }

  /* ── Payments tab (Stripe mirror — read only) ────────────────── */
  function paymentsTab(c) {
    if (!S.isOnStripe(c)) {
      return '<div class="card"><div class="card-head"><span class="card-title">Payments</span></div>' +
        U.empty('Not linked to Stripe',
          'This customer\'s billing is tracked by hand. Edit the record and paste their Stripe customer id (cus_…) to pull real invoices in.',
          '<button class="btn btn-primary btn-sm" id="linkStripe">Edit record</button>') + '</div>';
    }

    var invoices = S.invoicesFor(c.id);
    var subs = S.subscriptionsFor(c.id);
    var health = S.billingHealth(c);

    return '<div class="detail-cols"><div class="stack">' +
      '<div class="card"><div class="card-head"><span class="card-title">Invoices</span>' +
        '<span class="kcol-count">' + invoices.length + '</span>' +
        '<div class="page-actions">' + U.badge(health.label, health.tone) + '</div></div>' +
        (invoices.length ? U.table([
          { key: 'number', label: 'Invoice', render: function (i) {
              return (i.hostedInvoiceUrl
                ? '<a class="link" href="' + U.esc(i.hostedInvoiceUrl) + '" target="_blank" rel="noopener">' +
                  U.esc(i.number || i.id) + '</a>'
                : '<span class="mono">' + U.esc(i.number || i.id) + '</span>') +
                (i.description ? '<div class="muted" style="font-size:11.5px">' + U.esc(i.description) + '</div>' : '');
            } },
          { key: 'status', label: 'Status', render: function (i) { return invoiceBadge(i); } },
          { key: 'due', label: 'Due', render: function (i) {
              if (!i.dueDate) return '<span class="muted">—</span>';
              var t = U.dueTone(i.dueDate, i.status === 'paid');
              return '<div>' + U.fmtDateShort(i.dueDate) + '</div>' +
                (i.status === 'open'
                  ? '<span class="badge ' + (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-top:3px">' +
                    U.esc(t.text) + '</span>' : '');
            } },
          { key: 'amount', label: 'Amount', cls: 'right', render: function (i) {
              return '<span class="mono strong">' + S.cents(i.amountDueCents) + '</span>' +
                (i.status === 'open' && i.amountRemainingCents !== i.amountDueCents
                  ? '<div class="muted" style="font-size:11px">' + S.cents(i.amountRemainingCents) + ' left</div>'
                  : '');
            } }
        ], invoices, {}) : U.empty('No invoices yet', 'Nothing has been billed to this customer in Stripe.')) +
      '</div></div>' +

      '<div class="stack">' +
        '<div class="card"><div class="card-head"><span class="card-title">Subscriptions</span></div>' +
          '<div class="card-body">' +
            (subs.length ? subs.map(function (s) {
              var tone = s.status === 'active' ? 'b-green'
                : s.status === 'past_due' || s.status === 'unpaid' ? 'b-red'
                : s.status === 'trialing' ? 'b-blue' : 'b-grey';
              return '<div style="padding:10px 0;border-bottom:1px solid var(--line)">' +
                '<div class="split">' + U.badge(s.status, tone) +
                  '<span class="mono strong" style="margin-left:auto">' + S.cents(s.amountCents) + '</span></div>' +
                '<div style="margin-top:6px;font-size:12.5px">' + U.esc(s.description || 'Subscription') + '</div>' +
                '<div class="muted" style="font-size:11.5px;margin-top:3px">every ' +
                  (s.intervalCount > 1 ? s.intervalCount + ' ' : '') + U.esc(s.interval || '—') +
                  (s.intervalCount > 1 ? 's' : '') +
                  (s.currentPeriodEnd ? ' · renews ' + U.fmtDateShort(s.currentPeriodEnd) : '') + '</div>' +
                (s.cancelAtPeriodEnd
                  ? '<div style="margin-top:5px">' + U.badge('Cancels at period end', 'b-yellow') + '</div>' : '') +
                '</div>';
            }).join('') : '<span class="muted">No subscriptions.</span>') +
          '</div></div>' +

        '<div class="card"><div class="card-head"><span class="card-title">Stripe Link</span></div>' +
          '<div class="card-body">' +
            '<div class="mono" style="font-size:12px;word-break:break-all">' + U.esc(c.stripeCustomerId) + '</div>' +
            '<div class="hint" style="margin-top:8px">These figures come straight from Stripe and cannot be edited here — ' +
            'that is what keeps the CRM from drifting out of step with what you actually billed.</div>' +
          '</div></div>' +
      '</div></div>';
  }

  function invoiceBadge(i) {
    var map = {
      paid: ['Paid', 'b-green'], open: ['Open', 'b-yellow'], draft: ['Draft', 'b-grey'],
      void: ['Void', 'b-grey'], uncollectible: ['Uncollectible', 'b-red']
    };
    var m = map[i.status] || [i.status || '—', 'b-grey'];
    return U.badge(m[0], m[1]);
  }

  /* ── form ────────────────────────────────────────────────────── */
  function openForm(c, done) {
    var isNew = !c;
    c = c || { status: 'new', ownerId: S.me().id, billingCycle: 'Monthly', services: [] };

    U.modal({
      title: isNew ? 'New Customer' : 'Edit ' + c.name,
      wide: true,
      okText: isNew ? 'Create Customer' : 'Save Changes',
      body: '<div class="form-grid">' +
        U.field('Company Name *', '<input class="input" name="name" value="' + U.esc(c.name || '') + '" required>') +
        U.field('Primary Contact', '<input class="input" name="contactName" value="' + U.esc(c.contactName || '') + '">') +
        U.field('Email', '<input class="input" type="email" name="email" value="' + U.esc(c.email || '') + '">') +
        U.field('Phone', '<input class="input" name="phone" value="' + U.esc(c.phone || '') + '">') +
        U.field('Status', '<select class="input" name="status">' + U.options(S.STATUSES(), c.status) + '</select>') +
        U.field('Account Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), c.ownerId, 'id', 'name') + '</select>') +
        U.field('Billing Date', '<input class="input" type="date" name="billingDate" value="' + U.esc(c.billingDate || '') + '">') +
        U.field('Billing Cycle', '<select class="input" name="billingCycle">' + U.options(S.BILLING_CYCLES, c.billingCycle) + '</select>') +
        U.field('Contract Value ($)', '<input class="input" type="number" min="0" step="50" name="value" value="' + U.esc(c.value || 0) + '">') +
        U.field('Industry', '<input class="input" name="industry" value="' + U.esc(c.industry || '') + '">') +
        U.field('Lead Source', '<input class="input" name="source" value="' + U.esc(c.source || '') + '">') +
        U.field('Location', '<input class="input" name="address" value="' + U.esc(c.address || '') + '">') +
        U.field('Website', '<input class="input" name="website" placeholder="example.com" value="' + U.esc(c.website || '') + '">') +
        (S.stripeEnabled()
          ? U.field('Stripe Customer ID',
              '<input class="input mono" name="stripeCustomerId" placeholder="cus_..." value="' +
                U.esc(c.stripeCustomerId || '') + '">' +
              '<div class="hint">Links this record to Stripe. Leave blank to keep billing tracked by hand.</div>', true)
          : '') +
        '<div class="field span-2"><label>Services</label>' + U.serviceChecks('services', c.services) + '</div>' +
        (isNew ? '<div class="field span-2"><label>Opening Note (optional)</label>' +
          '<textarea class="input" name="openingNote" placeholder="Context the rest of the team should know…"></textarea></div>' : '') +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Company name is required.', 'err'); return false; }
        v.value = Number(v.value) || 0;
        var note = v.openingNote; delete v.openingNote;

        if (isNew) {
          var created = S.insert('customers', v, 'c', v.name);
          if (note) S.addNote('customer', created.id, note);
          U.toast(v.name + ' created.', 'ok');
        } else {
          S.update('customers', c.id, v, 'customer details');
          U.toast('Saved.', 'ok');
        }
        done();
      }
    });
  }

  /* ── CSV export ──────────────────────────────────────────────── */
  function exportCsv(rows) {
    var head = ['Customer', 'Contact', 'Email', 'Phone', 'Status', 'Services', 'Billing Date', 'Cycle', 'Value', 'Owner', 'Industry', 'Source'];
    var lines = [head.join(',')].concat(rows.map(function (c) {
      return [c.name, c.contactName, c.email, c.phone, S.status(c.status).label,
        S.serviceNames(c.services).join(' | '), c.billingDate, c.billingCycle, c.value,
        S.user(c.ownerId).name, c.industry, c.source]
        .map(function (f) { return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(',');
    }));
    download('thinkfirst-customers-' + S.today() + '.csv', lines.join('\n'), 'text/csv');
    U.toast('CSV exported.', 'ok');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  root.Views.customers.openForm = openForm;
  root.download = download;
})(window);
