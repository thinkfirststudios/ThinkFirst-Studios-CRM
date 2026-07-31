/* ═══════════════════════════════════════════════════════════════════
   app.js — hash router, global search, user switcher, shortcuts.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;

  var viewEl = document.getElementById('view');

  var ROUTES = {
    dashboard: 'dashboard', customers: 'customers', pipeline: 'pipeline',
    tracker: 'tracker', workorders: 'workorders', vendors: 'vendors',
    billing: 'billing', admin: 'admin'
  };

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

    document.querySelectorAll('.rail a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.nav === r.name);
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
    userMenu.innerHTML =
      '<div class="menu-label">Acting as</div>' +
      S.activeUsers().map(function (u) {
        return '<button class="menu-item' + (u.id === S.me().id ? ' is-on' : '') + '" data-user="' + U.esc(u.id) + '">' +
          U.avatar(u.id, 'sm') + '<span>' + U.esc(u.name) + '</span><small>' + U.esc(u.role) + '</small></button>';
      }).join('') +
      '<hr class="sep" style="margin:6px 0">' +
      '<div class="menu-label">Notes you post are attributed to the selected user</div>';
    userMenu.hidden = false;
    userMenu.querySelectorAll('[data-user]').forEach(function (b) {
      b.onclick = function () {
        S.setMe(b.dataset.user);
        userMenu.hidden = true;
        U.toast('Now acting as ' + S.me().name + '.', 'ok');
        render();
      };
    });
  };
  document.addEventListener('click', function () { userMenu.hidden = true; });

  /* ── quick create ────────────────────────────────────────────── */
  document.getElementById('quickNewBtn').onclick = function () {
    U.modal({
      title: 'Create new…',
      footer: null,
      body: '<div class="grid g-3">' +
        quickCard('customer', 'Customer', 'A company you sell to') +
        quickCard('vendor', 'Vendor', 'A partner you buy from') +
        quickCard('workorder', 'Work Order', 'A job to do today') +
      '</div>',
      onMount: function (box) {
        box.querySelectorAll('[data-create]').forEach(function (b) {
          b.onclick = function () {
            U.closeModal();
            var kind = b.dataset.create;
            if (kind === 'customer') root.Views.customers.openForm(null, render);
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

    var customers = S.all('customers').filter(function (c) {
      return match(c.name) || match(c.contactName) || match(c.email) || match(c.phone);
    }).slice(0, 6);
    var vendors = S.all('vendors').filter(function (v) {
      return match(v.name) || match(v.contactName) || match(v.email);
    }).slice(0, 6);
    var wos = S.all('workOrders').filter(function (w) {
      return match(w.title) || match(w.description);
    }).slice(0, 6);
    var notes = S.all('notes').filter(function (n) { return match(n.body); }).slice(0, 5);

    var html = '';
    if (customers.length) html += group('Customers', customers.map(function (c) {
      return item('#/customers/' + c.id, c.name, S.status(c.status).label);
    }));
    if (vendors.length) html += group('Vendors', vendors.map(function (v) {
      return item('#/vendors/' + v.id, v.name, S.vendorType(v.vendorType).label);
    }));
    if (wos.length) html += group('Work Orders', wos.map(function (w) {
      return item('#/workorders/' + w.id, w.title, S.recordName(w.entityType, w.entityId));
    }));
    if (notes.length) html += group('Notes', notes.map(function (n) {
      var href = '#/' + (n.entityType === 'vendor' ? 'vendors' : n.entityType === 'workorder' ? 'workorders' : 'customers') + '/' + n.entityId;
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
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/dashboard';
  render();
})(window);
