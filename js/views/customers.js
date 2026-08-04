/* ═══════════════════════════════════════════════════════════════════
   Accounts — the company record.

   Stored in the `customers` collection for compatibility (see the
   naming note in store.js); the interface says Account throughout.

   The account holds the ongoing commercial relationship — who they are,
   what they pay, when they are billed. Individual sales cycles live on
   opportunities and the people live on contacts, so this record no
   longer has to pretend to be all three.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var ICON = '<svg viewBox="0 0 24 24" class="ico"><path d="M3 21V8l7-5 7 5v13M3 21h18M13 21v-6h4v6M7 11h2M7 15h2"/></svg>';

  var st = { q: '', type: '', owner: '', service: '', tag: '', billingType: '', sortKey: 'name', sortDir: 1 };

  /* ── list ────────────────────────────────────────────────────── */
  root.Views.accounts = function (el, params) {
    if (params.id) return detail(el, params.id);

    var rows = S.accounts().filter(function (a) {
      if (st.type && S.deriveAccountType(a) !== st.type) return false;
      if (st.owner && a.ownerId !== st.owner) return false;
      if (st.service && (a.services || []).indexOf(st.service) < 0) return false;
      if (st.tag && !S.hasTag(a, st.tag)) return false;
      if (st.billingType && (a.billingType || 'paid') !== st.billingType) return false;
      if (st.q) {
        var hay = [a.name, a.contactName, a.email, a.phone, a.industry, a.address]
          .concat(S.tagsOf(a))
          .concat(S.contactsFor(a.id).map(S.contactName))
          .join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var customers = rows.filter(S.isCustomerAccount);
    var recurring = rows.filter(function (a) { return S.isCustomerAccount(a) && S.isRevenue(a); })
      .reduce(function (s, a) { return s + (Number(a.value) || 0); }, 0);
    var freeCount = rows.filter(S.isFree).length;

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Accounts</h1>' +
          '<div class="page-sub">' + rows.length + ' of ' + S.accounts().length + ' records · ' +
            customers.length + ' customers · ' + S.money(recurring) + ' under contract' +
            (freeCount ? ' · ' + freeCount + ' free / non-billing' : '') + '</div></div>' +
        '<div class="page-actions">' +
          '<a class="btn" href="#/contacts">Contacts</a>' +
          '<a class="btn" href="#/opportunities">Opportunities</a>' +
          '<button class="btn btn-primary" id="newAcct">+ New Account</button>' +
        '</div>' +
      '</div>' +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search account, contact, email…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="ftype"><option value="">All types</option>' + U.options(S.ACCOUNT_TYPES, st.type) + '</select>' +
        '<select class="input" id="fowner"><option value="">All owners</option>' + U.options(S.activeUsers(), st.owner, 'id', 'name') + '</select>' +
        '<select class="input" id="fservice"><option value="">All services</option>' + U.options(S.all('services'), st.service, 'id', 'name') + '</select>' +
        '<select class="input" id="fbillingType"><option value="">Paid &amp; free</option>' +
          U.options(S.BILLING_TYPES, st.billingType) + '</select>' +
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
        emptyHTML: U.empty('No accounts match', 'Try clearing the filters, or add your first record.')
      }) + '</div>';

    el.querySelector('#newAcct').onclick = function () { openForm(null, root.render); };
    if (params.new) openForm(null, function () { location.hash = '#/accounts'; root.render(); });

    bindFilter(el, '#fq', 'q', true);
    [['#ftype', 'type'], ['#fowner', 'owner'], ['#fservice', 'service'],
     ['#fbillingType', 'billingType'], ['#ftag', 'tag']].forEach(function (p) {
      if (el.querySelector(p[0])) bindFilter(el, p[0], p[1]);
    });
    el.querySelector('#clear').onclick = function () {
      st.q = ''; st.type = ''; st.owner = ''; st.service = ''; st.tag = ''; st.billingType = '';
      root.render();
    };
    el.querySelector('#exportCsv').onclick = function () { exportCsv(rows); };

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { location.hash = '#/accounts/' + id; }
    });

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

  function cols() {
    return [
      { key: 'name', label: 'Account', sort: function (a) { return a.name; },
        render: function (a) {
          var p = S.primaryContact(a.id);
          return '<div><span class="link">' + U.esc(a.name) + '</span>' +
            (S.isFree(a) ? ' ' + U.billingTypeBadge(a) : '') +
            '<div class="muted" style="font-size:11.5px">' +
              U.esc(p ? S.contactName(p) + (p.title ? ' · ' + p.title : '') : a.industry || '') + '</div>' +
            (S.tagsOf(a).length ? '<div style="margin-top:4px">' + U.tagChips(a.tags, 3) + '</div>' : '') +
            '</div>';
        } },
      { key: 'type', label: 'Type', sort: function (a) { return S.accountType(S.deriveAccountType(a)).order; },
        render: function (a) {
          var t = S.accountType(S.deriveAccountType(a));
          return U.badge(t.label, t.tone);
        } },
      { key: 'contacts', label: 'Contacts', cls: 'right', sort: function (a) { return S.contactsFor(a.id).length; },
        render: function (a) {
          var list = S.contactsFor(a.id);
          if (!list.length) return '<span class="muted">—</span>';
          return '<div class="split" style="justify-content:flex-end"><span class="avatars">' +
            list.slice(0, 3).map(function (c) { return U.avatar(c.ownerId, 'sm'); }).join('') +
            '</span><span class="muted mono">' + list.length + '</span></div>';
        } },
      { key: 'opps', label: 'Open Deals', cls: 'right', sort: function (a) {
          return S.opportunitiesFor(a.id).filter(function (o) { return S.oppStage(o.stage).open; }).length;
        },
        render: function (a) {
          var open = S.opportunitiesFor(a.id).filter(function (o) { return S.oppStage(o.stage).open; });
          if (!open.length) return '<span class="muted">—</span>';
          var sum = open.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0);
          return '<span class="mono strong">' + open.length + '</span>' +
            '<div class="muted" style="font-size:11px">' + S.money(sum) + '</div>';
        } },
      { key: 'value', label: 'Contract', cls: 'right', sort: function (a) { return Number(a.value) || 0; },
        render: function (a) {
          if (S.isFree(a)) {
            return '<span class="muted">—</span><div class="muted" style="font-size:11px">' +
              U.esc(S.billingType(a.billingType).label.toLowerCase()) + '</div>';
          }
          return '<span class="mono">' + S.money(a.value) + '</span>' +
            '<div class="muted" style="font-size:11px">' + U.esc(a.billingCycle || '') + '</div>';
        } },
      { key: 'billing', label: 'Next Billing', sort: function (a) { return a.billingDate || '9999'; },
        render: function (a) {
          if (!a.billingDate) return '<span class="muted">—</span>';
          var t = U.dueTone(a.billingDate);
          return '<div>' + U.fmtDateShort(a.billingDate) + '</div><span class="badge ' +
            (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-top:3px">' + U.esc(t.text) + '</span>';
        } },
      { key: 'owner', label: 'Owner', sort: function (a) { return S.user(a.ownerId).name; },
        render: function (a) { return U.userCell(a.ownerId); } }
    ];
  }

  /* ── detail ──────────────────────────────────────────────────── */
  function detail(el, id) {
    root.RecordView.render(el, {
      coll: 'customers', type: 'customer', id: id, icon: ICON,
      backHref: '#/accounts', backLabel: 'Accounts', objectLabel: 'Account',

      badges: function (a) {
        var t = S.accountType(S.deriveAccountType(a));
        return U.badge(t.label, t.tone) +
          (S.isFree(a) ? U.billingTypeBadge(a) : '') +
          U.tagChips(a.tags) +
          (a.industry ? '<span class="chip">' + U.esc(a.industry) + '</span>' : '') +
          (a.website ? '<a class="chip" href="' + U.esc(href(a.website)) + '" target="_blank" rel="noopener">' + U.esc(a.website) + '</a>' : '') +
          (a.address ? '<span>' + U.esc(a.address) + '</span>' : '');
      },

      highlights: function (a) {
        var p = S.primaryContact(a.id);
        var open = S.opportunitiesFor(a.id).filter(function (o) { return S.oppStage(o.stage).open; });
        var bt = U.dueTone(a.billingDate);
        return [
          { label: 'Primary Contact', value: p
              ? '<a class="link" href="#/contacts/' + U.esc(p.id) + '">' + U.esc(S.contactName(p)) + '</a>' +
                (p.title ? '<div class="muted" style="font-size:11.5px;font-weight:400">' + U.esc(p.title) + '</div>' : '')
              : '<span class="muted">None set</span>' },
          { label: 'Phone', value: (p && p.phone) || a.phone
              ? '<a href="tel:' + U.esc((p && p.phone) || a.phone) + '">' + U.esc((p && p.phone) || a.phone) + '</a>' : '—' },
          { label: 'Email', value: (p && p.email) || a.email
              ? '<a href="mailto:' + U.esc((p && p.email) || a.email) + '" style="color:var(--orange)">' +
                U.esc((p && p.email) || a.email) + '</a>' : '—' },
          { label: 'Open Deals', value: open.length
              ? '<span class="mono">' + open.length + '</span> <span class="muted" style="font-size:12px;font-weight:400">· ' +
                S.money(open.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0)) + '</span>'
              : '<span class="muted">None</span>' },
          { label: 'Next Billing', value: a.billingDate
              ? U.fmtDate(a.billingDate) + ' <span class="badge ' +
                (bt.cls.indexOf('b-') === 0 ? bt.cls : 'b-grey') + '" style="margin-left:6px">' + U.esc(bt.text) + '</span>'
              : '—' },
          { label: 'Contract', value: S.isFree(a)
              ? U.billingTypeBadge(a)
              : '<span class="mono">' + S.money(a.value) + '</span> <span class="muted">/ ' + U.esc(a.billingCycle || '—') + '</span>' },
          { label: 'Owner', value: U.userCell(a.ownerId) }
        ];
      },

      related: function (a) {
        var contacts = S.contactsFor(a.id);
        var opps = S.opportunitiesFor(a.id);
        var wos = S.workOrdersFor('customer', a.id);
        return [
          { title: 'Contacts', count: contacts.length, addLabel: '+ New Contact',
            emptyText: 'Nobody recorded at this company yet.',
            html: contacts.map(root.RecordView.contactRow).join(''),
            onAdd: function (done) { root.Views.contacts.openForm({ accountId: a.id }, done); } },
          { title: 'Opportunities', count: opps.length, addLabel: '+ New Opportunity',
            emptyText: 'No deals recorded against this account.',
            html: opps.map(root.RecordView.oppRow).join(''),
            onAdd: function (done) { root.Views.opportunities.openForm({ accountId: a.id }, done); } },
          { title: 'Work Orders', count: wos.length, addLabel: '+ New',
            emptyText: 'No work orders against this account yet.',
            html: wos.map(root.RecordView.woRow).join(''),
            onAdd: function (done) { root.WorkOrderForm.open({ entityType: 'customer', entityId: a.id }, done); } }
        ];
      },

      extraTabs: S.stripeEnabled() ? [{
        id: 'payments', label: 'Payments',
        count: function (a) { return S.invoicesFor(a.id).length; },
        render: paymentsTab
      }] : null,

      detailRows: function (a) {
        return row('Account Name', U.esc(a.name)) +
          row('Type', U.badge(S.accountType(S.deriveAccountType(a)).label, S.accountType(S.deriveAccountType(a)).tone) +
            ' <span class="muted" style="font-size:11.5px">' + U.esc(S.accountType(S.deriveAccountType(a)).hint) + '</span>') +
          row('Billing Type', U.billingTypeBadge(a) +
            (S.isFree(a) ? ' <span class="muted" style="font-size:11.5px">excluded from revenue</span>' : '')) +
          row('Tags', S.tagsOf(a).length ? U.tagChips(a.tags) : '<span class="muted">—</span>') +
          row('Phone', U.esc(a.phone || '—')) +
          row('Email', a.email ? '<a href="mailto:' + U.esc(a.email) + '" style="color:var(--orange)">' + U.esc(a.email) + '</a>' : '—') +
          row('Services', S.serviceNames(a.services).join(', ') || '—') +
          row('Billing Date', U.fmtDate(a.billingDate)) +
          row('Billing Cycle', U.esc(a.billingCycle || '—')) +
          row('Contract Value', '<span class="mono">' + S.money(a.value) + '</span>') +
          row('Industry', U.esc(a.industry || '—')) +
          row('Source', U.esc(a.source || '—')) +
          row('Location', U.esc(a.address || '—')) +
          row('Website', a.website ? '<a href="' + U.esc(href(a.website)) + '" target="_blank" rel="noopener" style="color:var(--orange)">' + U.esc(a.website) + '</a>' : '—') +
          row('Account Owner', U.userCell(a.ownerId)) +
          row('Created', U.fmtDate(a.createdAt));
      },

      onEdit: function (a, done) { openForm(a, done); }
    });
  }
  function row(k, v) { return '<dt>' + U.esc(k) + '</dt><dd>' + v + '</dd>'; }
  function href(w) { return /^https?:\/\//i.test(w) ? w : 'https://' + w; }

  /* ── Payments tab (Stripe mirror — read only) ────────────────── */
  function paymentsTab(c) {
    if (!S.isOnStripe(c)) {
      return '<div class="card"><div class="card-head"><span class="card-title">Payments</span></div>' +
        U.empty('Not linked to Stripe',
          'This account\'s billing is tracked by hand. Edit the record and paste their Stripe customer id (cus_…) to pull real invoices in.',
          '<button class="btn btn-primary btn-sm" id="linkStripe">Edit record</button>') + '</div>';
    }

    var invoices = S.invoicesFor(c.id);
    var subs = S.subscriptionsFor(c.id);
    var health = S.billingHealth(c);

    return '<div class="stack">' +
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
        ], invoices, {}) : U.empty('No invoices yet', 'Nothing has been billed to this account in Stripe.')) +
      '</div>' +

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
    '</div>';
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
  function openForm(a, done) {
    var isNew = !a;
    a = a || { accountType: 'prospect', ownerId: S.me().id, billingCycle: 'Monthly', services: [] };
    var derived = S.deriveAccountType(a);
    var hasWon = !isNew && S.opportunitiesFor(a.id).some(function (o) { return S.oppStage(o.stage).won; });

    U.modal({
      title: isNew ? 'New Account' : 'Edit ' + a.name,
      wide: true,
      okText: isNew ? 'Create Account' : 'Save Changes',
      body: '<div class="form-grid">' +
        U.field('Account Name *', '<input class="input" name="name" value="' + U.esc(a.name || '') + '" required>') +
        U.field('Account Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), a.ownerId, 'id', 'name') + '</select>') +
        U.field('Type',
          '<select class="input" name="accountType">' + U.options(S.ACCOUNT_TYPES, derived) + '</select>' +
          '<div class="hint">' + (hasWon
            ? 'This account has a won deal, so it reads as a Customer regardless — set Partner or Former to override.'
            : U.esc(S.accountType(derived).hint)) + '</div>') +
        U.field('Billing Type',
          '<select class="input" name="billingType">' + U.options(S.BILLING_TYPES, a.billingType || 'paid') + '</select>' +
          '<div class="hint">' + U.esc(S.billingType(a.billingType).hint) + '</div>') +
        U.field('Tags', U.tagInput('tagsRaw', a.tags)) +
        U.field('Phone', '<input class="input" name="phone" value="' + U.esc(a.phone || '') + '">') +
        U.field('Email', '<input class="input" type="email" name="email" value="' + U.esc(a.email || '') + '">') +
        U.field('Website', '<input class="input" name="website" placeholder="example.com" value="' + U.esc(a.website || '') + '">') +
        U.field('Billing Date', '<input class="input" type="date" name="billingDate" value="' + U.esc(a.billingDate || '') + '">') +
        U.field('Billing Cycle', '<select class="input" name="billingCycle">' + U.options(S.BILLING_CYCLES, a.billingCycle) + '</select>') +
        U.field('Contract Value ($)',
          '<input class="input" type="number" min="0" step="50" name="value" value="' + U.esc(a.value || 0) + '">' +
          '<div class="hint">What they pay on the cycle above — not the size of a one-off deal.</div>') +
        U.field('Industry', '<input class="input" name="industry" value="' + U.esc(a.industry || '') + '">') +
        U.field('Source', '<input class="input" name="source" value="' + U.esc(a.source || '') + '">') +
        U.field('Location', '<input class="input" name="address" value="' + U.esc(a.address || '') + '">') +
        (S.stripeEnabled()
          ? U.field('Stripe Customer ID',
              '<input class="input mono" name="stripeCustomerId" placeholder="cus_..." value="' +
                U.esc(a.stripeCustomerId || '') + '">' +
              '<div class="hint">Links this record to Stripe. Leave blank to keep billing tracked by hand.</div>', true)
          : '') +
        '<div class="field span-2"><label>Services</label>' + U.serviceChecks('services', a.services) + '</div>' +
        (isNew
          ? '<div class="field span-2"><label>Primary Contact (optional)</label>' +
              '<input class="input" name="firstContact" placeholder="Dan Whitaker">' +
              '<div class="hint">Creates the account\'s first contact. You can add more afterwards.</div></div>' +
            '<div class="field span-2"><label>Opening Note (optional)</label>' +
              '<textarea class="input" name="openingNote" placeholder="Context the rest of the team should know…"></textarea></div>'
          : '') +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Account name is required.', 'err'); return false; }
        v.value = Number(v.value) || 0;
        v.tags = S.parseTags(v.tagsRaw); delete v.tagsRaw;
        var note = v.openingNote; delete v.openingNote;
        var first = v.firstContact; delete v.firstContact;

        if (isNew) {
          v.status = 'new';
          var created = S.insert('customers', v, 'c', v.name);
          if (first) {
            var parts = S.splitName(first);
            S.insert('contacts', {
              accountId: created.id, firstName: parts.first, lastName: parts.last,
              title: '', email: v.email || '', phone: v.phone || '', role: '',
              isPrimary: true, ownerId: v.ownerId, tags: []
            }, 'ct', first);
          }
          if (note) S.addNote('customer', created.id, note);
          U.toast(v.name + ' created.', 'ok');
        } else {
          S.update('customers', a.id, v, 'account details');
          U.toast('Saved.', 'ok');
        }
        done();
      }
    });
  }

  /* ── CSV export ──────────────────────────────────────────────── */
  function exportCsv(rows) {
    var head = ['Account', 'Type', 'Primary Contact', 'Contacts', 'Open Deals', 'Open Deal Value',
      'Billing Type', 'Tags', 'Services', 'Billing Date', 'Cycle', 'Contract Value', 'Owner', 'Industry', 'Source'];
    var lines = [head.join(',')].concat(rows.map(function (a) {
      var p = S.primaryContact(a.id);
      var open = S.opportunitiesFor(a.id).filter(function (o) { return S.oppStage(o.stage).open; });
      return [a.name, S.accountType(S.deriveAccountType(a)).label, p ? S.contactName(p) : '',
        S.contactsFor(a.id).length, open.length,
        open.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0),
        S.billingType(a.billingType).label, S.tagsOf(a).join(' | '),
        S.serviceNames(a.services).join(' | '), a.billingDate, a.billingCycle, a.value,
        S.user(a.ownerId).name, a.industry, a.source]
        .map(function (f) { return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(',');
    }));
    download('thinkfirst-accounts-' + S.today() + '.csv', lines.join('\n'), 'text/csv');
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

  root.Views.accounts.openForm = openForm;
  /* Older links and bookmarks still say #/customers. */
  root.Views.customers = root.Views.accounts;
  root.download = download;
})(window);
