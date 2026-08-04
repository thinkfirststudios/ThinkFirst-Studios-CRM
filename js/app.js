/* ═══════════════════════════════════════════════════════════════════
   app.js — hash router, global search, user switcher, shortcuts.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;

  var viewEl = document.getElementById('view');

  var ROUTES = {
    dashboard: 'dashboard', leads: 'leads', outreach: 'outreach', accounts: 'accounts',
    contacts: 'contacts', opportunities: 'opportunities', activities: 'activities',
    pipeline: 'pipeline', tracker: 'tracker', workorders: 'workorders',
    vendors: 'vendors', billing: 'billing', admin: 'admin',
    /* Accounts were called customers until the object split; old links
       and bookmarks still resolve. */
    customers: 'accounts'
  };
  /* Which tab lights up for a route that has no tab of its own. */
  var NAV_ALIAS = { customers: 'accounts' };

  function parse() {
    var raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    var parts = raw.split('?');
    var segs = parts[0].split('/').filter(Boolean);
    var params = {};
    (parts[1] || '').split('&').filter(Boolean).forEach(function (kv) {
      var p = kv.split('=');
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    params.id = segs[1] || '';
    return { name: segs[0] || 'dashboard', params: params };
  }

  function render() {
    var r = parse();
    var view = root.Views[ROUTES[r.name] || 'dashboard'];
    var nav = NAV_ALIAS[r.name] || r.name;

    document.querySelectorAll('.tabbar a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.nav === nav);
    });
    /* A grouped tab highlights when any route it contains is showing. */
    document.querySelectorAll('.tabgroup').forEach(function (g) {
      g.classList.remove('open');
      g.classList.toggle('active', (g.dataset.nav || '').split(' ').indexOf(nav) > -1);
    });

    try {
      view(viewEl, r.params);
    } catch (err) {
      console.error(err);
      viewEl.innerHTML = U.empty('Something broke rendering this screen', err.message,
        '<button class="btn" onclick="location.reload()">Reload</button>');
    }
    window.scrollTo(0, 0);
    paintUserChip();
  }
  root.render = render;

  /* ── tab dropdowns ───────────────────────────────────────────── */
  document.querySelectorAll('.tabgroup > button').forEach(function (b) {
    b.onclick = function (e) {
      e.stopPropagation();
      var g = b.parentNode;
      var wasOpen = g.classList.contains('open');
      document.querySelectorAll('.tabgroup').forEach(function (x) { x.classList.remove('open'); });
      if (!wasOpen) g.classList.add('open');
    };
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.tabgroup').forEach(function (g) { g.classList.remove('open'); });
  });

  /* ── user switcher ───────────────────────────────────────────── */
  function paintUserChip() {
    var me = S.me();
    document.getElementById('meAvatar').textContent = S.initials(me.name);
    document.getElementById('meAvatar').style.background = U.avatarColor(me.id);
    document.getElementById('meName').textContent = me.name;
    document.getElementById('meRole').textContent = me.role;
  }

  var userMenu = document.getElementById('userMenu');
  document.getElementById('userChipBtn').onclick = function (e) {
    e.stopPropagation();
    if (!userMenu.hidden) { userMenu.hidden = true; return; }

    if (S.canSwitchUser()) {
      /* Offline demo mode: switch freely between the seeded teammates. */
      userMenu.innerHTML =
        '<div class="menu-label">Acting as</div>' +
        S.activeUsers().map(function (u) {
          return '<button class="menu-item' + (u.id === S.me().id ? ' is-on' : '') + '" data-user="' + U.esc(u.id) + '">' +
            U.avatar(u.id, 'sm') + '<span>' + U.esc(u.name) + '</span><small>' + U.esc(u.role) + '</small></button>';
        }).join('') +
        '<hr class="sep" style="margin:6px 0">' +
        '<div class="menu-label">Offline demo — notes are attributed to the selected user</div>';
    } else {
      /* Signed in: you are who you authenticated as. */
      userMenu.innerHTML =
        '<div class="menu-label">Signed in as</div>' +
        '<div class="menu-item" style="cursor:default">' + U.avatar(S.me().id, 'sm') +
          '<span>' + U.esc(S.me().name) + '</span><small>' + U.esc(S.me().role) + '</small></div>' +
        '<hr class="sep" style="margin:6px 0">' +
        '<div class="menu-label">Team</div>' +
        S.activeUsers().filter(function (u) { return u.id !== S.me().id; }).map(function (u) {
          return '<div class="menu-item" style="cursor:default">' + U.avatar(u.id, 'sm') +
            '<span>' + U.esc(u.name) + '</span><small>' + U.esc(u.role) + '</small></div>';
        }).join('') +
        '<hr class="sep" style="margin:6px 0">' +
        '<button class="menu-item" id="signOutBtn"><span>Sign out</span></button>';
    }

    userMenu.hidden = false;

    userMenu.querySelectorAll('[data-user]').forEach(function (b) {
      b.onclick = function () {
        S.setMe(b.dataset.user);
        userMenu.hidden = true;
        U.toast('Now acting as ' + S.me().name + '.', 'ok');
        render();
      };
    });
    var out = userMenu.querySelector('#signOutBtn');
    if (out) out.onclick = function () { S.signOut().then(function () { location.reload(); }); };
  };
  document.addEventListener('click', function () { userMenu.hidden = true; });

  /* ── quick create ────────────────────────────────────────────── */
  document.getElementById('quickNewBtn').onclick = function () {
    U.modal({
      title: 'Create new…',
      footer: null,
      body: '<div class="grid g-3">' +
        quickCard('lead', 'Lead', 'Someone you hope to sell to') +
        quickCard('account', 'Account', 'A company you work with') +
        quickCard('contact', 'Contact', 'A person at an account') +
        quickCard('opportunity', 'Opportunity', 'A deal you are working') +
        quickCard('task', 'Task', 'Something to do by a date') +
        quickCard('call', 'Log a Call', 'A conversation that happened') +
        quickCard('vendor', 'Vendor', 'A partner you buy from') +
        quickCard('workorder', 'Work Order', 'A job to do today') +
      '</div>',
      onMount: function (box) {
        box.querySelectorAll('[data-create]').forEach(function (b) {
          b.onclick = function () {
            U.closeModal();
            var kind = b.dataset.create;
            if (kind === 'lead') root.Views.leads.openForm(null, render);
            else if (kind === 'account') root.Views.accounts.openForm(null, render);
            else if (kind === 'contact') root.Views.contacts.openForm(null, render);
            else if (kind === 'opportunity') root.Views.opportunities.openForm(null, render);
            else if (kind === 'task' || kind === 'call') root.Activities.quickCreate(kind, render);
            else if (kind === 'vendor') root.Views.vendors.openForm(null, render);
            else root.WorkOrderForm.open({}, render);
          };
        });
      }
    });
  };
  function quickCard(kind, title, sub) {
    return '<button class="card" data-create="' + kind + '" style="cursor:pointer;text-align:left;padding:16px;background:var(--surface-2)">' +
      '<div class="strong" style="font-family:var(--font-display);letter-spacing:.02em">' + U.esc(title) + '</div>' +
      '<div class="hint" style="margin-top:4px">' + U.esc(sub) + '</div></button>';
  }

  /* ── global search ───────────────────────────────────────────── */
  var searchInput = document.getElementById('globalSearch');
  var gsResults = document.getElementById('gsResults');

  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) { gsResults.hidden = true; return; }

    function match(text) { return (text || '').toLowerCase().indexOf(q) > -1; }

    var leads = S.all('leads').filter(function (l) {
      return match(l.name) || match(l.contactName) || match(l.email) || match(l.phone);
    }).slice(0, 5);
    var accounts = S.accounts().filter(function (c) {
      return match(c.name) || match(c.email) || match(c.phone) || match(c.industry);
    }).slice(0, 5);
    var contacts = S.all('contacts').filter(function (c) {
      return match(S.contactName(c)) || match(c.email) || match(c.phone) || match(c.title);
    }).slice(0, 5);
    var opps = S.all('opportunities').filter(function (o) {
      return match(o.name) || match(o.nextStep) || match(o.type);
    }).slice(0, 5);
    var tasks = S.all('tasks').filter(function (t) {
      return match(t.subject) || match(t.description);
    }).slice(0, 4);
    var vendors = S.all('vendors').filter(function (v) {
      return match(v.name) || match(v.contactName) || match(v.email);
    }).slice(0, 4);
    var wos = S.all('workOrders').filter(function (w) {
      return match(w.title) || match(w.description);
    }).slice(0, 4);
    var notes = S.all('notes').filter(function (n) { return match(n.body); }).slice(0, 4);

    var html = '';
    if (leads.length) html += group('Leads', leads.map(function (l) {
      return item('#/leads/' + l.id, l.name, S.leadStatus(l.leadStatus).label);
    }));
    if (accounts.length) html += group('Accounts', accounts.map(function (c) {
      return item('#/accounts/' + c.id, c.name, S.accountType(S.deriveAccountType(c)).label);
    }));
    if (contacts.length) html += group('Contacts', contacts.map(function (c) {
      return item('#/contacts/' + c.id, S.contactName(c),
        (c.title ? c.title + ' · ' : '') + S.accountName(c.accountId));
    }));
    if (opps.length) html += group('Opportunities', opps.map(function (o) {
      return item('#/opportunities/' + o.id, o.name,
        S.oppStage(o.stage).label + ' · ' + S.money(o.amount));
    }));
    if (tasks.length) html += group('Activities', tasks.map(function (t) {
      return item(S.entityHref(t.entityType, t.entityId), t.subject,
        S.taskKind(t.kind).label + ' · ' + S.entityLabel(t.entityType, t.entityId));
    }));
    if (vendors.length) html += group('Vendors', vendors.map(function (v) {
      return item('#/vendors/' + v.id, v.name, S.vendorType(v.vendorType).label);
    }));
    if (wos.length) html += group('Work Orders', wos.map(function (w) {
      return item('#/workorders/' + w.id, w.title, S.recordName(w.entityType, w.entityId));
    }));
    if (notes.length) html += group('Notes', notes.map(function (n) {
      var href = S.entityHref(n.entityType, n.entityId);
      return item(href, n.body.slice(0, 62) + (n.body.length > 62 ? '…' : ''), S.user(n.authorId).name);
    }));

    gsResults.innerHTML = html || '<div class="gs-item muted">No matches for “' + U.esc(q) + '”</div>';
    gsResults.hidden = false;

    gsResults.querySelectorAll('[data-href]').forEach(function (n) {
      n.onclick = function () {
        location.hash = n.dataset.href;
        gsResults.hidden = true;
        searchInput.value = '';
      };
    });

    function group(label, items) {
      return '<div class="gs-group">' + label + '</div>' + items.join('');
    }
    function item(href, title, meta) {
      return '<div class="gs-item" data-href="' + U.esc(href) + '"><span>' + U.esc(title) + '</span>' +
        '<small>' + U.esc(meta) + '</small></div>';
    }
  }

  var searchTimer;
  searchInput.oninput = function () {
    clearTimeout(searchTimer);
    var v = this.value;
    searchTimer = setTimeout(function () { search(v); }, 150);
  };
  searchInput.onkeydown = function (e) {
    if (e.key === 'Escape') { this.value = ''; gsResults.hidden = true; this.blur(); }
    if (e.key === 'Enter') {
      var first = gsResults.querySelector('[data-href]');
      if (first) first.click();
    }
  };
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.global-search')) gsResults.hidden = true;
  });

  /* ── keyboard ────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); searchInput.focus(); }
    if (e.key.toLowerCase() === 'n' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      document.getElementById('quickNewBtn').click();
    }
  });

  /* ── boot ────────────────────────────────────────────────────── */
  function paintSyncDot() {
    var dot = document.getElementById('syncDot');
    if (S.mode() === 'supabase') {
      dot.className = 'sync-dot';
      dot.textContent = 'Live';
      dot.title = 'Shared with your team in real time';
    } else {
      dot.className = 'sync-dot local';
      dot.textContent = 'Offline';
      dot.title = 'This browser only — data is not shared. See README to connect Supabase.';
    }
  }

  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/dashboard';

  viewEl.innerHTML = '<div class="empty" style="padding:80px"><h4>Loading…</h4></div>';

  S.boot().then(function (result) {
    if (!result.authenticated) { root.Auth.screen(); return; }
    paintSyncDot();
    render();
  }).catch(function (err) {
    console.error(err);
    /* A backend that is configured but unreachable must not silently fall
       back to local storage — that would look like the team's data vanished. */
    if (root.Auth) root.Auth.screen({ fatal: err.message });
    else viewEl.innerHTML = U.empty('Could not start', err.message);
  });
})(window);
