/* ═══════════════════════════════════════════════════════════════════
   admin.js — users & roles, the service catalog, pipeline statuses,
   vendor types, org settings, backup/restore and the audit log.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var tab = 'users';

  root.Views.admin = function (el) {
    if (!S.isAdmin()) {
      el.innerHTML = U.empty('Admin access required',
        'You are acting as ' + S.me().name + ' (' + S.me().role + '). Switch to an admin user from the top-right menu.');
      return;
    }

    var db = S.db();
    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Setup</div><h1 class="page-title">Admin Panel</h1>' +
          '<div class="page-sub">Everything that shapes how the CRM behaves for the whole team.</div></div>' +
        '<div class="page-actions">' + U.badge(S.me().name + ' · admin', 'b-orange') + '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        stat('Users', db.users.length, db.users.filter(function (u) { return u.active; }).length + ' active') +
        stat('Accounts', db.customers.length, db.contacts.length + ' contacts') +
        stat('Opportunities', db.opportunities.length, S.openOpportunities().length + ' open') +
        stat('Work Orders', db.workOrders.length, db.timeEntries.length + ' time entries') +
      '</div>' +

      '<div class="tabs" id="adminTabs">' +
        ['users', 'services', 'statuses', 'vendorTypes', 'stripe', 'settings', 'health', 'data', 'audit'].map(function (t) {
          return '<button data-t="' + t + '"' + (tab === t ? ' class="on"' : '') + '>' + U.esc(LABELS[t]) + '</button>';
        }).join('') +
      '</div><div id="adminBody"></div>';

    var body = el.querySelector('#adminBody');
    el.querySelectorAll('#adminTabs button').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.t; root.render(); };
    });
    PANELS[tab](body);
  };

  var LABELS = {
    users: 'Users & Roles', services: 'Service Catalog', statuses: 'Pipeline Statuses',
    vendorTypes: 'Vendor Types', stripe: 'Stripe', settings: 'Organization',
    health: 'Data Health', data: 'Data & Backup', audit: 'Audit Log'
  };

  /* ── users ───────────────────────────────────────────────────── */
  var PANELS = {};

  PANELS.users = function (body) {
    var users = S.all('users');
    var hosted = S.mode() === 'supabase';
    body.innerHTML =
      '<div class="card"><div class="card-head"><span class="card-title">Users &amp; Roles</span>' +
        '<div class="page-actions">' +
          (hosted
            /* Creating a login requires the auth service — people join by
               signing up, and an admin sets their role here afterwards. */
            ? '<span class="hint">Teammates join by signing up at your CRM link — set their role here once they appear</span>'
            : '<button class="btn btn-primary btn-sm" id="addUser">+ Add User</button>') +
        '</div></div>' +
      U.table([
        { key: 'name', label: 'Name', render: function (u) {
            return '<div class="split">' + U.avatar(u.id, '') + '<div><div class="strong">' + U.esc(u.name) + '</div>' +
              '<div class="muted" style="font-size:11.5px">' + U.esc(u.title || '') + '</div></div></div>';
          } },
        { key: 'email', label: 'Email', render: function (u) { return '<span class="muted">' + U.esc(u.email) + '</span>'; } },
        { key: 'role', label: 'Role', render: function (u) {
            return U.badge(u.role, u.role === 'admin' ? 'b-orange' : u.role === 'manager' ? 'b-blue' : 'b-grey');
          } },
        { key: 'load', label: 'Open Work', cls: 'right', render: function (u) {
            var n = S.all('workOrders').filter(function (w) { return w.assigneeId === u.id && w.status !== 'complete'; }).length;
            return '<span class="mono">' + n + '</span>';
          } },
        { key: 'accounts', label: 'Accounts', cls: 'right', render: function (u) {
            var n = S.all('customers').filter(function (c) { return c.ownerId === u.id; }).length +
                    S.all('vendors').filter(function (v) { return v.ownerId === u.id; }).length;
            return '<span class="mono">' + n + '</span>';
          } },
        { key: 'active', label: 'Status', render: function (u) {
            return u.active ? U.badge('Active', 'b-green') : U.badge('Disabled', 'b-grey');
          } },
        { key: 'act', label: '', cls: 'right', render: function (u) {
            return '<button class="btn btn-sm" data-edit="' + U.esc(u.id) + '">Edit</button> ' +
              (u.id === S.me().id ? '' : '<button class="btn btn-sm btn-danger" data-del="' + U.esc(u.id) + '">Remove</button>');
          } }
      ], users, {}) + '</div>';

    var add = body.querySelector('#addUser');
    if (add) add.onclick = function () { userForm(null); };
    body.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { userForm(S.find('users', b.dataset.edit)); };
    });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var u = S.find('users', b.dataset.del);
        U.confirmDelete(u.name, function () {
          S.remove('users', u.id);
          U.toast(hosted
            ? 'Profile removed. Their login still exists — delete it in Supabase → Authentication to fully revoke access.'
            : 'User removed. Their records keep the old owner id until reassigned.');
          root.render();
        });
      };
    });
  };

  function userForm(u) {
    var isNew = !u;
    u = u || { role: 'rep', active: true };
    U.modal({
      title: isNew ? 'Add User' : 'Edit ' + u.name,
      okText: isNew ? 'Add User' : 'Save',
      body: '<div class="form-grid">' +
        U.field('Full Name *', '<input class="input" name="name" value="' + U.esc(u.name || '') + '">') +
        U.field('Email', '<input class="input" type="email" name="email" value="' + U.esc(u.email || '') + '">') +
        U.field('Job Title', '<input class="input" name="title" value="' + U.esc(u.title || '') + '">') +
        U.field('Role', '<select class="input" name="role">' +
          S.ROLES.map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
          '</select>') +
        '<div class="field span-2"><label>Access</label><label class="check">' +
          '<input type="checkbox" name="active" value="1"' + (u.active ? ' checked' : '') + '> Active — can be assigned work and own accounts</label></div>' +
        '<div class="field span-2"><div class="hint"><strong>admin</strong> — full setup access · ' +
          '<strong>manager</strong> — can delete records and reassign · <strong>rep</strong> — day-to-day CRM use</div></div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Name is required.', 'err'); return false; }
        v.active = (v.active || []).length > 0;
        if (isNew) S.insert('users', v, 'u', v.name);
        else S.update('users', u.id, v, v.name);
        U.toast('Saved.', 'ok');
        root.render();
      }
    });
  }

  /* ── services ────────────────────────────────────────────────── */
  PANELS.services = function (body) {
    body.innerHTML =
      '<div class="card"><div class="card-head"><span class="card-title">Service Catalog</span>' +
        '<div class="page-actions"><span class="hint">These populate the Services picker on customers, vendors and work orders</span>' +
        '<button class="btn btn-primary btn-sm" id="addSvc">+ Add Service</button></div></div>' +
      U.table([
        { key: 'name', label: 'Service', render: function (s) { return '<span class="strong">' + U.esc(s.name) + '</span>'; } },
        { key: 'category', label: 'Category', render: function (s) { return '<span class="chip">' + U.esc(s.category || '—') + '</span>'; } },
        { key: 'cycle', label: 'Default Cycle', render: function (s) { return U.esc(s.cycle || '—'); } },
        { key: 'rate', label: 'Default Rate', cls: 'right', render: function (s) { return '<span class="mono">' + S.money(s.rate) + '</span>'; } },
        { key: 'used', label: 'In Use', cls: 'right', render: function (s) {
            var n = S.all('customers').filter(function (c) { return (c.services || []).indexOf(s.id) > -1; }).length +
                    S.all('vendors').filter(function (v) { return (v.services || []).indexOf(s.id) > -1; }).length;
            return '<span class="mono">' + n + '</span>';
          } },
        { key: 'active', label: 'Status', render: function (s) { return s.active ? U.badge('Active', 'b-green') : U.badge('Retired', 'b-grey'); } },
        { key: 'act', label: '', cls: 'right', render: function (s) {
            return '<button class="btn btn-sm" data-edit="' + U.esc(s.id) + '">Edit</button> ' +
              '<button class="btn btn-sm btn-danger" data-del="' + U.esc(s.id) + '">Delete</button>';
          } }
      ], S.all('services'), {}) + '</div>';

    body.querySelector('#addSvc').onclick = function () { svcForm(null); };
    body.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { svcForm(S.find('services', b.dataset.edit)); }; });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var s = S.find('services', b.dataset.del);
        U.confirmDelete(s.name, function () { S.remove('services', s.id); root.render(); });
      };
    });
  };

  function svcForm(s) {
    var isNew = !s;
    s = s || { active: true, cycle: 'Monthly' };
    U.modal({
      title: isNew ? 'Add Service' : 'Edit ' + s.name,
      okText: isNew ? 'Add' : 'Save',
      body: '<div class="form-grid">' +
        U.field('Service Name *', '<input class="input" name="name" value="' + U.esc(s.name || '') + '">') +
        U.field('Category', '<input class="input" name="category" value="' + U.esc(s.category || '') + '" placeholder="Creative, Web, Marketing…">') +
        U.field('Default Rate ($)', '<input class="input" type="number" min="0" step="25" name="rate" value="' + U.esc(s.rate || 0) + '">') +
        U.field('Default Billing Cycle', '<select class="input" name="cycle">' + U.options(S.BILLING_CYCLES, s.cycle) + '</select>') +
        '<div class="field span-2"><label class="check"><input type="checkbox" name="active" value="1"' +
          (s.active ? ' checked' : '') + '> Active — offered to new accounts</label></div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Name is required.', 'err'); return false; }
        v.rate = Number(v.rate) || 0;
        v.active = (v.active || []).length > 0;
        if (isNew) S.insert('services', v, 's', v.name); else S.update('services', s.id, v, v.name);
        U.toast('Saved.', 'ok');
        root.render();
      }
    });
  }

  /* ── statuses ────────────────────────────────────────────────── */
  PANELS.statuses = function (body) {
    var TONES = ['b-grey', 'b-blue', 'b-orange', 'b-yellow', 'b-green', 'b-red', 'b-violet'];
    body.innerHTML =
      '<div class="card"><div class="card-head"><span class="card-title">Pipeline Statuses</span>' +
        '<div class="page-actions"><span class="hint">Order controls the Pipeline board left-to-right</span>' +
        '<button class="btn btn-primary btn-sm" id="addSt">+ Add Status</button></div></div>' +
      U.table([
        { key: 'order', label: '#', width: '52px', render: function (s) { return '<span class="mono">' + s.order + '</span>'; } },
        { key: 'label', label: 'Status', render: function (s) { return U.badge(s.label, s.tone); } },
        { key: 'meaning', label: 'Counts As', render: function (s) {
            return s.won ? U.badge('Won / paying', 'b-green', true)
              : s.open ? U.badge('Open pipeline', 'b-blue', true)
              : U.badge('Closed — not won', 'b-grey', true);
          } },
        { key: 'used', label: 'Records', cls: 'right', render: function (s) {
            var n = S.all('vendors').filter(function (c) { return c.status === s.id; }).length +
                    S.all('vendors').filter(function (v) { return v.status === s.id; }).length;
            return '<span class="mono">' + n + '</span>';
          } },
        { key: 'act', label: '', cls: 'right', render: function (s) {
            return '<button class="btn btn-sm" data-edit="' + U.esc(s.id) + '">Edit</button> ' +
              '<button class="btn btn-sm btn-danger" data-del="' + U.esc(s.id) + '">Delete</button>';
          } }
      ], S.STATUSES(), {}) + '</div>';

    body.querySelector('#addSt').onclick = function () { stForm(null); };
    body.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { stForm(S.find('statuses', b.dataset.edit)); }; });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var s = S.find('statuses', b.dataset.del);
        var used = S.all('vendors').filter(function (c) { return c.status === s.id; }).length;
        if (used) { U.toast(used + ' customers still use this status. Move them first.', 'err'); return; }
        U.confirmDelete(s.label, function () { S.remove('statuses', s.id); root.render(); });
      };
    });

    function stForm(s) {
      var isNew = !s;
      s = s || { tone: 'b-grey', order: S.STATUSES().length + 1, open: true, won: false };
      U.modal({
        title: isNew ? 'Add Status' : 'Edit ' + s.label,
        okText: isNew ? 'Add' : 'Save',
        body: '<div class="form-grid">' +
          U.field('Label *', '<input class="input" name="label" value="' + U.esc(s.label || '') + '">') +
          U.field('Order', '<input class="input" type="number" min="1" name="order" value="' + U.esc(s.order) + '">') +
          U.field('Colour', '<select class="input" name="tone">' +
            TONES.map(function (t) { return '<option value="' + t + '"' + (s.tone === t ? ' selected' : '') + '>' + t.slice(2) + '</option>'; }).join('') + '</select>') +
          '<div class="field"><label>Behaviour</label>' +
            '<label class="check"><input type="checkbox" name="open" value="1"' + (s.open ? ' checked' : '') + '> Counts as open pipeline</label>' +
            '<label class="check" style="margin-top:6px"><input type="checkbox" name="won" value="1"' + (s.won ? ' checked' : '') + '> Counts as won / recurring revenue</label></div>' +
        '</div>',
        onOk: function (box) {
          var v = U.values(box);
          if (!v.label) { U.toast('Label is required.', 'err'); return false; }
          v.order = Number(v.order) || 99;
          v.open = (v.open || []).length > 0;
          v.won = (v.won || []).length > 0;
          if (isNew) {
            v.id = v.label.toLowerCase().replace(/[^a-z0-9]+/g, '');
            S.insert('statuses', v, 'st', v.label);
          } else S.update('statuses', s.id, v, v.label);
          U.toast('Saved.', 'ok');
          root.render();
        }
      });
    }
  };

  /* ── vendor types ────────────────────────────────────────────── */
  PANELS.vendorTypes = function (body) {
    body.innerHTML =
      '<div class="card"><div class="card-head"><span class="card-title">Vendor Types</span>' +
        '<div class="page-actions"><button class="btn btn-primary btn-sm" id="addVt">+ Add Vendor Type</button></div></div>' +
      U.table([
        { key: 'label', label: 'Vendor Type', render: function (t) { return U.badge(t.label, 'b-violet'); } },
        { key: 'count', label: 'Vendors', cls: 'right', render: function (t) {
            return '<span class="mono">' + S.all('vendors').filter(function (v) { return v.vendorType === t.id; }).length + '</span>';
          } },
        { key: 'work', label: 'Open Work Orders', cls: 'right', render: function (t) {
            var ids = S.all('vendors').filter(function (v) { return v.vendorType === t.id; }).map(function (v) { return v.id; });
            var n = S.all('workOrders').filter(function (w) {
              return w.entityType === 'vendor' && ids.indexOf(w.entityId) > -1 && w.status !== 'complete';
            }).length;
            return '<span class="mono">' + n + '</span>';
          } },
        { key: 'act', label: '', cls: 'right', render: function (t) {
            return '<button class="btn btn-sm" data-edit="' + U.esc(t.id) + '">Rename</button> ' +
              '<button class="btn btn-sm btn-danger" data-del="' + U.esc(t.id) + '">Delete</button>';
          } }
      ], S.VENDOR_TYPES(), {}) + '</div>';

    body.querySelector('#addVt').onclick = function () { vtForm(null); };
    body.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { vtForm(S.find('vendorTypes', b.dataset.edit)); }; });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var t = S.find('vendorTypes', b.dataset.del);
        var used = S.all('vendors').filter(function (v) { return v.vendorType === t.id; }).length;
        if (used) { U.toast(used + ' vendors still use this type. Reassign them first.', 'err'); return; }
        U.confirmDelete(t.label, function () { S.remove('vendorTypes', t.id); root.render(); });
      };
    });

    function vtForm(t) {
      var isNew = !t;
      t = t || {};
      U.modal({
        title: isNew ? 'Add Vendor Type' : 'Rename ' + t.label,
        okText: 'Save',
        body: U.field('Label *', '<input class="input" name="label" value="' + U.esc(t.label || '') + '" placeholder="Fabricator, Photographer…">'),
        onOk: function (box) {
          var v = U.values(box);
          if (!v.label) { U.toast('Label is required.', 'err'); return false; }
          if (isNew) {
            v.id = v.label.toLowerCase().replace(/[^a-z0-9]+/g, '');
            S.insert('vendorTypes', v, 'vt', v.label);
          } else S.update('vendorTypes', t.id, v, v.label);
          U.toast('Saved.', 'ok');
          root.render();
        }
      });
    }
  };

  /* ── stripe ──────────────────────────────────────────────────── */
  PANELS.stripe = function (body) {
    if (!S.stripeEnabled()) {
      body.innerHTML = U.empty('Stripe needs the hosted backend',
        'Connect Supabase first — the Stripe key has to live server-side, which offline mode has no way to do.');
      return;
    }

    var sync = S.syncState();
    var invoices = S.all('stripeInvoices');
    var subs = S.all('stripeSubscriptions');
    var linked = S.all('customers').filter(S.isOnStripe);
    var unlinkedInv = S.unlinkedInvoices();
    var neverSynced = !invoices.length && !subs.length && !(sync && sync.lastSyncAt);

    body.innerHTML =
      '<div class="grid g-4" style="margin-bottom:14px">' +
        stat('Invoices Mirrored', invoices.length, unlinkedInv.length ? unlinkedInv.length + ' unmatched' : 'all matched') +
        stat('Subscriptions', subs.length, subs.filter(function (s) { return s.status === 'active'; }).length + ' active') +
        stat('Linked Accounts', linked.length, 'of ' + S.accounts().length + ' total') +
        stat('Stripe MRR', S.cents(S.stripeMrr()), 'from active subscriptions') +
      '</div>' +

      '<div class="detail-cols">' +
        '<div class="card"><div class="card-head"><span class="card-title">Sync</span>' +
          '<div class="page-actions">' +
            (sync && sync.lastError ? U.badge('Last run errored', 'b-red') :
             neverSynced ? U.badge('Never synced', 'b-grey') : U.badge('Healthy', 'b-green')) +
          '</div></div>' +
          '<div class="card-body">' +
            '<dl class="dl">' +
              '<dt>Last webhook</dt><dd>' + (sync && sync.lastEventAt ? U.esc(U.fmtWhen(sync.lastEventAt)) : '<span class="muted">none yet</span>') + '</dd>' +
              '<dt>Last backfill</dt><dd>' + (sync && sync.lastSyncAt ? U.esc(U.fmtWhen(sync.lastSyncAt)) : '<span class="muted">never</span>') + '</dd>' +
              '<dt>Last error</dt><dd>' + (sync && sync.lastError ? '<span style="color:var(--danger)">' + U.esc(sync.lastError) + '</span>' : '<span class="muted">none</span>') + '</dd>' +
            '</dl>' +
            '<div class="split" style="margin-top:14px">' +
              '<button class="btn btn-primary btn-sm" id="backfill">Pull everything from Stripe</button>' +
              '<span class="hint">Safe to run repeatedly — it upserts on Stripe ids.</span>' +
            '</div>' +
          '</div></div>' +

        '<div class="card"><div class="card-head"><span class="card-title">How This Works</span></div>' +
          '<div class="card-body">' +
            '<p class="hint" style="margin-top:0">Stripe is the source of truth for money. These tables are a ' +
              'read-only mirror — the CRM cannot write to them, so it can never disagree with what you actually billed.</p>' +
            '<p class="hint">A customer is linked by its <span class="mono">stripeCustomerId</span>. Unlinked customers ' +
              'keep their manual billing fields and are labelled <em>Tracked manually</em> rather than unpaid.</p>' +
            '<p class="hint">The API key is a restricted <span class="mono">read-only</span> key held in Supabase ' +
              'secrets. It cannot charge, refund, or modify anything in Stripe.</p>' +
          '</div></div>' +
      '</div>' +

      (unlinkedInv.length
        ? '<div class="card" style="margin-top:14px"><div class="card-head">' +
            '<span class="card-title">Unmatched Invoices</span><span class="kcol-count">' + unlinkedInv.length + '</span>' +
            '<div class="page-actions"><span class="hint">Paste the Stripe customer id onto the matching CRM customer to link them</span></div></div>' +
          U.table([
            { key: 'number', label: 'Invoice', render: function (i) { return '<span class="mono">' + U.esc(i.number || i.id) + '</span>'; } },
            { key: 'cus', label: 'Stripe Customer', render: function (i) { return '<span class="mono" style="font-size:11.5px">' + U.esc(i.stripeCustomerId) + '</span>'; } },
            { key: 'status', label: 'Status', render: function (i) { return U.badge(i.status, i.status === 'paid' ? 'b-green' : 'b-yellow'); } },
            { key: 'amt', label: 'Amount', cls: 'right', render: function (i) { return '<span class="mono">' + S.cents(i.amountDueCents) + '</span>'; } }
          ], unlinkedInv.slice(0, 50), {}) +
          '</div>'
        : '');

    body.querySelector('#backfill').onclick = function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Pulling…';
      S.stripeBackfill().then(function (r) {
        U.toast('Pulled ' + r.invoices + ' invoices and ' + r.subscriptions + ' subscriptions.', 'ok');
        return S.boot();
      }).then(function () {
        root.render();
      }).catch(function (e) {
        U.toast('Backfill failed: ' + e.message, 'err');
        btn.disabled = false;
        btn.textContent = 'Pull everything from Stripe';
      });
    };
  };

  /* ── settings ────────────────────────────────────────────────── */
  PANELS.settings = function (body) {
    var s = S.db().settings;
    body.innerHTML =
      '<div class="detail-cols"><div class="card"><div class="card-head"><span class="card-title">Organization</span></div>' +
        '<div class="card-body"><div class="form-grid">' +
          U.field('Organization Name', '<input class="input" id="orgName" value="' + U.esc(s.orgName) + '">') +
          U.field('Currency', '<input class="input" id="currency" value="' + U.esc(s.currency) + '">') +
          U.field('Monthly Recurring Revenue Goal ($)',
            '<input class="input" type="number" min="0" step="100" id="mrrGoal" value="' +
              U.esc(S.mrrGoalCents() / 100) + '" placeholder="10000">' +
            '<div class="hint">Shown as a progress tracker on the home screen. Set 0 to hide it.</div>', true) +
        '</div><div style="margin-top:14px"><button class="btn btn-primary btn-sm" id="saveSettings">Save</button></div></div></div>' +
        '<div class="card"><div class="card-head"><span class="card-title">Where Data Lives</span></div><div class="card-body">' +
          (S.mode() === 'supabase'
            ? '<p class="hint" style="margin-top:0">' + U.badge('Live', 'b-green') + ' Records live in your <strong>Supabase</strong> project. ' +
                'Every signed-in teammate sees the same data, and changes appear on their screen in real time.</p>' +
              '<p class="hint">Deletes are limited to admins and managers, and the setup tabs on this page are admin-only — ' +
                'those rules are enforced by the database, not just this interface.</p>'
            : '<p class="hint" style="margin-top:0">' + U.badge('Offline', 'b-grey') + ' Records are stored in this browser only, under ' +
                '<span class="mono">tfs_crm_v1</span>. Nothing is shared with teammates.</p>' +
              '<p class="hint">To switch the team onto shared data, fill in <span class="mono">js/config.js</span> and run ' +
                '<span class="mono">supabase/schema.sql</span> — see the README.</p>') +
          '<p class="hint">Either way, <strong>Data &amp; Backup</strong> exports a portable JSON snapshot.</p>' +
        '</div></div></div>';

    body.querySelector('#saveSettings').onclick = function () {
      S.saveSettings({
        orgName: body.querySelector('#orgName').value.trim(),
        currency: body.querySelector('#currency').value.trim(),
        mrrGoalCents: Math.round((Number(body.querySelector('#mrrGoal').value) || 0) * 100)
      });
      U.toast('Settings saved.', 'ok');
    };
  };

  /* ── data ────────────────────────────────────────────────────── */
  PANELS.data = function (body) {
    body.innerHTML =
      '<div class="grid g-3">' +
        dataCard('Export Backup', 'Download the full database as JSON — every record, note, work order and time entry.',
          '<button class="btn btn-primary btn-sm" id="exp">Download JSON</button>') +
        dataCard('Restore Backup', 'Replace everything in this browser with the contents of a JSON backup file.',
          '<input type="file" id="impFile" accept="application/json" class="input" style="padding:6px">') +
        dataCard('Reload Demo Data', 'Reset to the shipped sample accounts, vendors and work orders.',
          '<button class="btn btn-sm" id="reseed">Reset to demo</button>') +
        dataCard('Start Clean', 'Keep users, services and settings — delete every customer, vendor, work order and note.',
          '<button class="btn btn-sm btn-danger" id="wipe">Clear all records</button>') +
      '</div>';

    body.querySelector('#exp').onclick = function () {
      root.download('thinkfirst-crm-backup-' + S.today() + '.json', S.exportJSON(), 'application/json');
      U.toast('Backup downloaded.', 'ok');
    };
    body.querySelector('#impFile').onchange = function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        U.toast('Restoring…');
        Promise.resolve()
          .then(function () { return S.importJSON(reader.result); })
          .then(function () { U.toast('Backup restored.', 'ok'); root.render(); })
          .catch(function (e) { U.toast('Import failed: ' + e.message, 'err'); });
      };
      reader.readAsText(file);
    };
    body.querySelector('#reseed').onclick = function () {
      U.modal({
        title: 'Reset to demo data?', danger: true, okText: 'Reset',
        body: '<p style="margin:0;color:var(--text-2)">This wipes everything currently stored and reloads the sample dataset. Export a backup first if you have real records.</p>' +
          (S.mode() === 'supabase'
            ? '<p style="margin:12px 0 0;color:var(--danger)"><strong>You are connected to Supabase</strong> — this replaces the shared data for the whole team, not just your browser.</p>'
            : ''),
        onOk: function () {
          S.resetToSeed().then(function () { U.toast('Demo data restored.'); root.render(); })
            .catch(function (e) { U.toast('Reset failed: ' + e.message, 'err'); });
        }
      });
    };
    body.querySelector('#wipe').onclick = function () {
      U.modal({
        title: 'Delete every record?', danger: true, okText: 'Delete all records',
        body: '<p style="margin:0;color:var(--text-2)">Customers, vendors, work orders, notes, time entries and activity will be erased. Users, services and settings are kept.</p>' +
          (S.mode() === 'supabase'
            ? '<p style="margin:12px 0 0;color:var(--danger)"><strong>You are connected to Supabase</strong> — this erases the shared data for the whole team.</p>'
            : ''),
        onOk: function () {
          S.wipe().then(function () { U.toast('All records cleared.'); root.render(); })
            .catch(function (e) { U.toast('Clear failed: ' + e.message, 'err'); });
        }
      });
    };

    function dataCard(title, desc, action) {
      return '<div class="card"><div class="card-head"><span class="card-title">' + U.esc(title) + '</span></div>' +
        '<div class="card-body"><p class="hint" style="margin:0 0 14px">' + U.esc(desc) + '</p>' + action + '</div></div>';
    }
  };

  /* ── data health ─────────────────────────────────────────────────
     Records that survived their parent, and placeholders the schema
     migration created. Both quietly distort the numbers — an orphaned
     opportunity still counts toward open pipeline and win rate while
     displaying "Unknown account" — so they are surfaced for deliberate
     removal rather than swept out automatically. */
  PANELS.health = function (body) {
    var orph = S.orphans();
    var placeholders = S.migrationPlaceholders();

    body.innerHTML =
      '<div class="stack">' +

      '<div class="card"><div class="card-head"><span class="card-title">Orphaned Records</span>' +
        '<span class="kcol-count">' + orph.total + '</span>' +
        (orph.total ? '<div class="page-actions"><button class="btn btn-danger btn-sm" id="fixOrphans">' +
          'Delete all ' + orph.total + '</button></div>' : '') +
      '</div>' +
      (orph.total
        ? '<div class="card-body"><div class="hint" style="margin-bottom:12px">' +
            'These point at a record that no longer exists. Until this release, deleting an account ' +
            'left its contacts and deals behind — they kept counting toward pipeline and win rate ' +
            'while showing “Unknown account”. Deleting an account now takes them with it, so this ' +
            'list should stay empty from here on.</div>' +
          orph.groups.map(function (g) {
            return '<div style="margin-bottom:14px">' +
              '<div class="split" style="margin-bottom:6px">' +
                U.badge(g.rows.length + ' ' + g.label, 'b-red') +
                '<span class="muted" style="font-size:12px">' + U.esc(g.why) + '</span></div>' +
              '<div class="chips">' + g.rows.slice(0, 12).map(function (r) {
                return '<span class="chip">' + U.esc(r.name || r.subject || r.title ||
                  S.contactName(r) || (r.body || '').slice(0, 30) || r.id) + '</span>';
              }).join('') +
              (g.rows.length > 12 ? '<span class="chip">+' + (g.rows.length - 12) + ' more</span>' : '') +
              '</div></div>';
          }).join('') + '</div>'
        : '<div class="card-body"><div class="split">' + U.badge('All clear', 'b-green') +
          '<span class="hint">Every record points at something that exists.</span></div></div>') +
      '</div>' +

      '<div class="card"><div class="card-head"><span class="card-title">Migration Placeholders</span>' +
        '<span class="kcol-count">' + placeholders.length + '</span>' +
        (placeholders.length ? '<div class="page-actions"><button class="btn btn-sm" id="fixPlaceholders">' +
          'Delete all ' + placeholders.length + '</button></div>' : '') +
      '</div>' +
      '<div class="card-body">' +
        (placeholders.length
          ? '<div class="hint" style="margin-bottom:12px">' +
              'When accounts were split into Accounts, Contacts and Opportunities, every existing ' +
              'account was given one opportunity so its history was not lost. These ' + placeholders.length +
              ' still carry the generated name, no amount, and no activity — so nothing has been done ' +
              'with them. They inflate your deal count and your win rate. Deleting them affects no ' +
              'other record. Any placeholder you have since put a value, a next step or an activity ' +
              'on is treated as a real deal and is not listed here.</div>' +
            '<div class="chips">' + placeholders.slice(0, 20).map(function (o) {
              var st_ = S.oppStage(o.stage);
              return '<span class="chip">' + U.esc(o.name) + ' ' + U.badge(st_.label, st_.tone) + '</span>';
            }).join('') +
            (placeholders.length > 20 ? '<span class="chip">+' + (placeholders.length - 20) + ' more</span>' : '') +
            '</div>'
          : '<div class="split">' + U.badge('None', 'b-green') +
            '<span class="hint">No untouched migration placeholders left.</span></div>') +
      '</div></div>' +

      '</div>';

    var fo = body.querySelector('#fixOrphans');
    if (fo) fo.onclick = function () {
      U.confirmDelete(orph.total + ' orphaned record' + (orph.total === 1 ? '' : 's'), function () {
        orph.groups.forEach(function (g) {
          S.removeMany(g.coll, g.rows.map(function (r) { return r.id; }));
        });
        U.toast('Removed ' + orph.total + ' orphaned records.', 'ok');
        root.render();
      });
    };

    var fp = body.querySelector('#fixPlaceholders');
    if (fp) fp.onclick = function () {
      U.confirmDelete(placeholders.length + ' migration placeholder' + (placeholders.length === 1 ? '' : 's'), function () {
        S.removeMany('opportunities', placeholders.map(function (o) { return o.id; }));
        U.toast('Removed ' + placeholders.length + ' placeholder deals.', 'ok');
        root.render();
      });
    };
  };

  /* ── audit ───────────────────────────────────────────────────── */
  PANELS.audit = function (body) {
    var acts = S.all('activity');
    body.innerHTML =
      '<div class="card"><div class="card-head"><span class="card-title">Audit Log</span>' +
        '<span class="kcol-count">' + acts.length + '</span>' +
        '<div class="page-actions"><span class="hint">Last 500 actions across the whole CRM</span></div></div>' +
      U.table([
        { key: 'ts', label: 'When', render: function (a) { return '<span class="muted">' + U.esc(U.fmtWhen(a.ts)) + '</span>'; } },
        { key: 'user', label: 'User', render: function (a) { return U.userCell(a.userId); } },
        { key: 'action', label: 'Action', render: function (a) {
            var tone = a.action === 'deleted' ? 'b-red' : a.action === 'created' ? 'b-green' : a.action === 'noted' ? 'b-violet' : 'b-blue';
            return U.badge(a.action, tone);
          } },
        { key: 'obj', label: 'Object', render: function (a) { return '<span class="chip">' + U.esc(a.entityType) + '</span>'; } },
        { key: 'detail', label: 'Detail', render: function (a) { return '<span class="muted">' + U.esc(a.detail) + '</span>'; } }
      ], acts.slice(0, 200), { emptyHTML: U.empty('No activity yet', 'Actions get recorded here as the team works.') }) + '</div>';
  };

  function stat(label, value, foot) {
    return '<div class="kpi"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + value + '</div><div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }
})(window);
