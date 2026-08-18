/* ═══════════════════════════════════════════════════════════════════
   Contacts — the people, split off the account record.

   One company routinely has three of them: whoever signs, whoever pays
   and whoever you actually talk to every week. The old single
   "contactName" field could hold exactly one, so the other two lived in
   somebody's memory.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var ICON = '<svg viewBox="0 0 24 24" class="ico"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>';

  var st = { q: '', account: '', owner: '', role: '', primaryOnly: false, sortKey: 'name', sortDir: 1 };

  /* ── list ────────────────────────────────────────────────────── */
  root.Views.contacts = function (el, params) {
    if (params.id) return detail(el, params.id);

    var rows = S.all('contacts').filter(function (c) {
      if (st.account && c.accountId !== st.account) return false;
      if (st.owner && c.ownerId !== st.owner) return false;
      if (st.role && c.role !== st.role) return false;
      if (st.primaryOnly && !c.isPrimary) return false;
      if (st.q) {
        var hay = [S.contactName(c), c.title, c.email, c.phone, c.mobile, c.department,
          S.accountName(c.accountId), S.socialSearchText(c)].concat(S.tagsOf(c)).join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    /* An account with people on file but nobody marked primary is a real
       gap: it is the record that tells you who to ring first. */
    var noPrimary = S.accounts().filter(function (a) {
      var list = S.contactsFor(a.id);
      return list.length && !list.some(function (c) { return c.isPrimary; });
    });

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Contacts</h1>' +
          '<div class="page-sub">' + rows.length + ' of ' + S.all('contacts').length + ' people across ' +
            S.accounts().length + ' accounts</div></div>' +
        '<div class="page-actions">' +
          '<button class="btn btn-sm" id="exportCsv">Export CSV</button>' +
          '<button class="btn btn-primary" id="newContact">+ New Contact</button>' +
        '</div>' +
      '</div>' +

      (noPrimary.length
        ? '<div class="card" style="margin-bottom:14px"><div class="card-body split">' +
            U.badge(String(noPrimary.length), 'b-yellow') +
            '<span class="hint">' + (noPrimary.length === 1 ? 'One account has' : noPrimary.length + ' accounts have') +
            ' contacts but nobody marked primary — open one and pick who to call first.</span>' +
          '</div></div>'
        : '') +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search name, title, email, account…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="faccount"><option value="">All accounts</option>' +
          U.options(S.accounts().slice().sort(byName), st.account, 'id', 'name') + '</select>' +
        '<select class="input" id="frole"><option value="">All roles</option>' +
          S.CONTACT_ROLES.map(function (r) {
            return '<option value="' + U.esc(r) + '"' + (r === st.role ? ' selected' : '') + '>' + U.esc(r) + '</option>';
          }).join('') + '</select>' +
        '<select class="input" id="fowner"><option value="">All owners</option>' +
          U.options(S.activeUsers(), st.owner, 'id', 'name') + '</select>' +
        '<label class="check"><input type="checkbox" id="fprimary"' + (st.primaryOnly ? ' checked' : '') + '>Primary only</label>' +
        '<button class="btn btn-ghost btn-sm" id="clear">Clear</button>' +
      '</div>' +
      U.table(cols(), rows, {
        rowLink: true, sortKey: st.sortKey, sortDir: st.sortDir,
        emptyHTML: U.empty('No contacts match',
          S.all('contacts').length ? 'Try clearing the filters.' : 'Add the people you deal with at each account.')
      }) + '</div>';

    el.querySelector('#newContact').onclick = function () { openForm(null, root.render); };
    el.querySelector('#exportCsv').onclick = function () { exportCsv(rows); };
    el.querySelector('#clear').onclick = function () {
      st.q = ''; st.account = ''; st.owner = ''; st.role = ''; st.primaryOnly = false; root.render();
    };
    el.querySelector('#fprimary').onchange = function () { st.primaryOnly = this.checked; root.render(); };
    [['#faccount', 'account'], ['#frole', 'role'], ['#fowner', 'owner']].forEach(function (p) {
      el.querySelector(p[0]).onchange = function () { st[p[1]] = this.value; root.render(); };
    });
    var t;
    el.querySelector('#fq').oninput = function () {
      var v = this.value;
      clearTimeout(t);
      t = setTimeout(function () { st.q = v; root.render(); }, 220);
    };

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { location.hash = '#/contacts/' + id; }
    });
  };

  function byName(a, b) { return a.name.localeCompare(b.name); }

  function cols() {
    return [
      { key: 'name', label: 'Name', sort: function (c) { return S.contactName(c); },
        render: function (c) {
          return '<div><span class="link">' + U.esc(S.contactName(c)) + '</span>' +
            (c.isPrimary ? ' ' + U.badge('Primary', 'b-orange', true) : '') +
            '<div class="muted" style="font-size:11.5px">' + U.esc(c.title || '—') + '</div></div>';
        } },
      { key: 'account', label: 'Account', sort: function (c) { return S.accountName(c.accountId); },
        render: function (c) {
          return '<a class="link" href="#/accounts/' + U.esc(c.accountId) + '">' +
            U.esc(S.accountName(c.accountId)) + '</a>';
        } },
      { key: 'role', label: 'Role', sort: function (c) { return c.role || 'zz'; },
        render: function (c) { return c.role ? '<span class="chip">' + U.esc(c.role) + '</span>' : '<span class="muted">—</span>'; } },
      { key: 'email', label: 'Email', sort: function (c) { return c.email || ''; },
        render: function (c) {
          return c.email
            ? '<a href="mailto:' + U.esc(c.email) + '" style="color:var(--orange)">' + U.esc(c.email) + '</a>'
            : '<span class="muted">—</span>';
        } },
      { key: 'phone', label: 'Phone', sort: function (c) { return c.phone || ''; },
        render: function (c) {
          var n = c.phone || c.mobile;
          return n ? '<a class="mono" href="tel:' + U.esc(n) + '">' + U.esc(n) + '</a>' : '<span class="muted">—</span>';
        } },
      { key: 'owner', label: 'Owner', sort: function (c) { return S.user(c.ownerId).name; },
        render: function (c) { return U.userCell(c.ownerId); } }
    ];
  }

  /* ── detail ──────────────────────────────────────────────────── */
  function detail(el, id) {
    root.RecordView.render(el, {
      coll: 'contacts', type: 'contact', id: id, icon: ICON,
      backHref: '#/contacts', backLabel: 'Contacts', objectLabel: 'Contact',
      recordTitle: function (c) { return S.contactName(c); },

      badges: function (c) {
        return (c.isPrimary ? U.badge('Primary Contact', 'b-orange') : '') +
          (c.role ? '<span class="chip">' + U.esc(c.role) + '</span>' : '') +
          U.tagChips(c.tags) +
          U.socialChips(c) +
          '<a class="chip" href="#/accounts/' + U.esc(c.accountId) + '">' + U.esc(S.accountName(c.accountId)) + '</a>' +
          (c.department ? '<span>' + U.esc(c.department) + '</span>' : '');
      },

      actions: function (c) {
        return c.isPrimary ? '' : '<button class="btn btn-sm" id="makePrimary">Make Primary</button>';
      },
      bindActions: function (el_, c, done) {
        var b = el_.querySelector('#makePrimary');
        if (b) b.onclick = function () {
          S.setPrimaryContact(c.id);
          U.toast(S.contactName(c) + ' is now the primary contact for ' + S.accountName(c.accountId) + '.', 'ok');
          done();
        };
      },

      highlights: function (c) {
        return [
          { label: 'Title', value: U.esc(c.title || '—') },
          { label: 'Account', value: '<a class="link" href="#/accounts/' + U.esc(c.accountId) + '">' +
              U.esc(S.accountName(c.accountId)) + '</a>' },
          { label: 'Email', value: c.email
              ? '<a href="mailto:' + U.esc(c.email) + '" style="color:var(--orange)">' + U.esc(c.email) + '</a>' : '—' },
          { label: 'Phone', value: c.phone ? '<a href="tel:' + U.esc(c.phone) + '">' + U.esc(c.phone) + '</a>' : '—' },
          { label: 'Mobile', value: c.mobile ? '<a href="tel:' + U.esc(c.mobile) + '">' + U.esc(c.mobile) + '</a>' : '—' },
          { label: 'Owner', value: U.userCell(c.ownerId) }
        ];
      },

      related: function (c) {
        /* Deals this person is named on, so you can see what is riding
           on the relationship before you pick up the phone. */
        var opps = S.all('opportunities').filter(function (o) { return o.contactId === c.id; });
        var siblings = S.contactsFor(c.accountId).filter(function (x) { return x.id !== c.id; });
        return [
          { title: 'Opportunities', count: opps.length,
            emptyText: 'Not named on any deal yet.',
            html: opps.map(root.RecordView.oppRow).join('') },
          { title: 'Others at ' + S.accountName(c.accountId), count: siblings.length,
            addLabel: '+ New Contact',
            emptyText: 'The only person on file at this account.',
            html: siblings.map(root.RecordView.contactRow).join(''),
            onAdd: function (done) { openForm({ accountId: c.accountId }, done); } }
        ];
      },

      detailRows: function (c) {
        return '<dt>Name</dt><dd>' + U.esc(S.contactName(c)) + '</dd>' +
          '<dt>Title</dt><dd>' + U.esc(c.title || '—') + '</dd>' +
          '<dt>Account</dt><dd><a class="link" href="#/accounts/' + U.esc(c.accountId) + '">' +
            U.esc(S.accountName(c.accountId)) + '</a></dd>' +
          '<dt>Role in Deal</dt><dd>' + (c.role ? '<span class="chip">' + U.esc(c.role) + '</span>' : '—') + '</dd>' +
          '<dt>Primary</dt><dd>' + (c.isPrimary ? U.badge('Yes', 'b-orange') : '<span class="muted">No</span>') + '</dd>' +
          '<dt>Email</dt><dd>' + (c.email ? '<a href="mailto:' + U.esc(c.email) + '" style="color:var(--orange)">' + U.esc(c.email) + '</a>' : '—') + '</dd>' +
          '<dt>Phone</dt><dd>' + U.esc(c.phone || '—') + '</dd>' +
          '<dt>Mobile</dt><dd>' + U.esc(c.mobile || '—') + '</dd>' +
          '<dt>Department</dt><dd>' + U.esc(c.department || '—') + '</dd>' +
          '<dt>Reports To</dt><dd>' + U.esc(c.reportsTo || '—') + '</dd>' +
          '<dt>Social</dt><dd>' + U.socialChips(c, { emptyHTML: '<span class="muted">—</span>' }) + '</dd>' +
          '<dt>Tags</dt><dd>' + (S.tagsOf(c).length ? U.tagChips(c.tags) : '<span class="muted">—</span>') + '</dd>' +
          '<dt>Description</dt><dd>' + U.esc(c.description || '—') + '</dd>' +
          '<dt>Owner</dt><dd>' + U.userCell(c.ownerId) + '</dd>' +
          '<dt>Created</dt><dd>' + U.fmtDate(c.createdAt) + '</dd>';
      },

      onEdit: function (c, done) { openForm(c, done); }
    });
  }

  /* ── form ────────────────────────────────────────────────────── */
  function openForm(c, done) {
    var isNew = !c || !c.id;
    var seedAccount = (c && c.accountId) || '';
    var accounts = S.accounts().slice().sort(byName);

    if (!accounts.length) {
      U.toast('Create an account first — a contact has to belong to a company.', 'err');
      return;
    }

    c = (c && c.id) ? c : { accountId: seedAccount, ownerId: S.me().id, tags: [], isPrimary: false };
    /* First person on file at an account is the primary by default;
       nobody wants to make that choice twice. */
    var defaultPrimary = isNew && seedAccount && !S.primaryContact(seedAccount);

    U.modal({
      title: isNew ? 'New Contact' : 'Edit ' + S.contactName(c),
      wide: true,
      okText: isNew ? 'Create Contact' : 'Save Changes',
      body: '<div class="form-grid">' +
        U.field('First Name', '<input class="input" name="firstName" value="' + U.esc(c.firstName || '') + '">') +
        U.field('Last Name *', '<input class="input" name="lastName" value="' + U.esc(c.lastName || '') + '" required>') +
        U.field('Account *',
          '<select class="input" name="accountId">' +
            U.options(accounts, c.accountId, 'id', 'name') + '</select>') +
        U.field('Title', '<input class="input" name="title" placeholder="Owner, Office Manager…" value="' + U.esc(c.title || '') + '">') +
        U.field('Email', '<input class="input" type="email" name="email" value="' + U.esc(c.email || '') + '">') +
        U.field('Phone', '<input class="input" name="phone" value="' + U.esc(c.phone || '') + '">') +
        U.field('Mobile', '<input class="input" name="mobile" value="' + U.esc(c.mobile || '') + '">') +
        U.field('Department', '<input class="input" name="department" value="' + U.esc(c.department || '') + '">') +
        U.field('Role in Deal',
          '<select class="input" name="role"><option value="">—</option>' +
            S.CONTACT_ROLES.map(function (r) {
              return '<option value="' + U.esc(r) + '"' + (r === c.role ? ' selected' : '') + '>' + U.esc(r) + '</option>';
            }).join('') + '</select>') +
        U.field('Reports To', '<input class="input" name="reportsTo" value="' + U.esc(c.reportsTo || '') + '">') +
        U.socialFields(c) +
        U.field('Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), c.ownerId, 'id', 'name') + '</select>') +
        U.field('Tags', U.tagInput('tagsRaw', c.tags)) +
        '<div class="field span-2"><label class="check" style="width:fit-content">' +
          '<input type="checkbox" name="isPrimary"' + (c.isPrimary || defaultPrimary ? ' checked' : '') + '>' +
          'Primary contact for this account</label>' +
          '<div class="hint">Only one person per account can hold this — ticking it here clears it from whoever had it.</div></div>' +
        '<div class="field span-2"><label>Description</label>' +
          '<textarea class="input" name="description" placeholder="How they prefer to be reached, what they care about…">' +
          U.esc(c.description || '') + '</textarea></div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.lastName && !v.firstName) { U.toast('Give the contact a name.', 'err'); return false; }
        if (!v.accountId) { U.toast('Pick the account this person belongs to.', 'err'); return false; }
        v.tags = S.parseTags(v.tagsRaw); delete v.tagsRaw;
        S.cleanSocials(v);
        var wantsPrimary = Array.isArray(v.isPrimary) ? v.isPrimary.length > 0 : !!v.isPrimary;
        v.isPrimary = wantsPrimary;

        var rec;
        if (isNew) {
          rec = S.insert('contacts', v, 'ct', S.contactName(v));
          U.toast(S.contactName(rec) + ' added to ' + S.accountName(rec.accountId) + '.', 'ok');
        } else {
          rec = S.update('contacts', c.id, v, 'contact details');
          U.toast('Saved.', 'ok');
        }
        /* Run this after the write so the exclusivity sweep sees the new
           value rather than the one it is replacing. */
        if (wantsPrimary) S.setPrimaryContact(rec.id);
        done();
      }
    });
  }

  /* ── CSV export ──────────────────────────────────────────────── */
  function exportCsv(rows) {
    var head = ['First Name', 'Last Name', 'Title', 'Account', 'Role', 'Primary',
      'Email', 'Phone', 'Mobile', 'Department', 'Owner', 'Tags'];
    var lines = [head.join(',')].concat(rows.map(function (c) {
      return [c.firstName, c.lastName, c.title, S.accountName(c.accountId), c.role,
        c.isPrimary ? 'Yes' : 'No', c.email, c.phone, c.mobile, c.department,
        S.user(c.ownerId).name, S.tagsOf(c).join(' | ')]
        .map(function (f) { return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(',');
    }));
    root.download('thinkfirst-contacts-' + S.today() + '.csv', lines.join('\n'), 'text/csv');
    U.toast('CSV exported.', 'ok');
  }

  root.Views.contacts.openForm = openForm;
})(window);
