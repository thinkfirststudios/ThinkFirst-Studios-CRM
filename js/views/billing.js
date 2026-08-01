/* Billing — one calendar of every billing date across customers and vendors. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var st = { scope: 'all', window: '30', sortKey: 'date', sortDir: 1 };

  root.Views.billing = function (el) {
    var rows = [];
    if (st.scope !== 'vendor') {
      S.all('customers').forEach(function (c) { rows.push(wrap(c, 'customer')); });
    }
    if (st.scope !== 'customer') {
      S.all('vendors').forEach(function (v) { rows.push(wrap(v, 'vendor')); });
    }
    rows = rows.filter(function (r) {
      if (!r.date) return false;
      if (st.window === 'all') return true;
      var d = S.daysUntil(r.date);
      return d <= Number(st.window);
    });

    /* Free accounts have a value on the record but bill nothing. */
    var incoming = rows
      .filter(function (r) { return r.kind === 'customer' && !(r.health && r.health.source === 'free'); })
      .reduce(function (s, r) { return s + r.amount; }, 0);
    var outgoing = rows.filter(function (r) { return r.kind === 'vendor'; }).reduce(function (s, r) { return s + r.amount; }, 0);
    var overdue = rows.filter(function (r) { return S.daysUntil(r.date) < 0; });

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Money</div><h1 class="page-title">Billing Calendar</h1>' +
          '<div class="page-sub">Every customer invoice and vendor payment on one timeline.</div></div>' +
        '<div class="page-actions">' +
          '<div class="seg" id="scopeSeg">' +
            '<button data-scope="all" class="' + (st.scope === 'all' ? 'on' : '') + '">All</button>' +
            '<button data-scope="customer" class="' + (st.scope === 'customer' ? 'on' : '') + '">Incoming</button>' +
            '<button data-scope="vendor" class="' + (st.scope === 'vendor' ? 'on' : '') + '">Outgoing</button>' +
          '</div>' +
          '<select class="input" id="win" style="max-width:170px">' +
            opt('7', 'Next 7 days') + opt('30', 'Next 30 days') + opt('90', 'Next 90 days') + opt('all', 'All dated') +
          '</select>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('Incoming', S.money(incoming), 'billed to customers', 'ok') +
        kpi('Outgoing', S.money(outgoing), 'owed to vendors', '') +
        kpi('Net', S.money(incoming - outgoing), 'in this window', 'accent') +
        kpi('Past Due', String(overdue.length), overdue.length ? 'needs chasing' : 'nothing late', overdue.length ? 'danger' : 'ok') +
      '</div>' +

      stripeStrip() +

      '<div class="card"><div class="card-head"><span class="card-title">Scheduled Billing</span>' +
        '<span class="kcol-count">' + rows.length + '</span>' +
        '<div class="page-actions"><button class="btn btn-sm" id="exportCsv">Export CSV</button></div></div>' +
        U.table(cols(), rows, {
          sortKey: st.sortKey, sortDir: st.sortDir, rowLink: true,
          emptyHTML: U.empty('Nothing scheduled', 'No billing dates fall inside this window.')
        }) + '</div>';

    el.querySelectorAll('#scopeSeg button').forEach(function (b) {
      b.onclick = function () { st.scope = b.dataset.scope; root.render(); };
    });
    el.querySelector('#win').onchange = function () { st.window = this.value; root.render(); };
    el.querySelector('#exportCsv').onclick = function () {
      var head = ['Account', 'Type', 'Billing Date', 'Cycle', 'Amount', 'Status', 'Owner'];
      var lines = [head.join(',')].concat(rows.map(function (r) {
        return [r.name, r.kind, r.date, r.cycle, r.amount, S.status(r.status).label, S.user(r.ownerId).name]
          .map(function (f) { return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(',');
      }));
      root.download('thinkfirst-billing-' + S.today() + '.csv', lines.join('\n'), 'text/csv');
      U.toast('CSV exported.', 'ok');
    };

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) {
        var r = rows.filter(function (x) { return x.id === id; })[0];
        location.hash = '#/' + (r.kind === 'vendor' ? 'vendors' : 'customers') + '/' + r.id;
      }
    });

    function opt(v, label) {
      return '<option value="' + v + '"' + (st.window === v ? ' selected' : '') + '>' + label + '</option>';
    }
  };

  function wrap(rec, kind) {
    return {
      id: rec.id, kind: kind, name: rec.name, date: rec.billingDate,
      cycle: rec.billingCycle, amount: Number(rec.value) || 0,
      status: rec.status, ownerId: rec.ownerId, services: rec.services,
      health: kind === 'customer' ? S.billingHealth(rec) : null
    };
  }

  function cols() {
    return [
      { key: 'date', label: 'Billing Date', sort: function (r) { return r.date || '9999'; },
        render: function (r) {
          var t = U.dueTone(r.date);
          return '<div class="strong">' + U.fmtDate(r.date) + '</div><span class="badge ' +
            (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-top:3px">' + U.esc(t.text) + '</span>';
        } },
      { key: 'name', label: 'Account', sort: function (r) { return r.name; },
        render: function (r) { return '<span class="link">' + U.esc(r.name) + '</span>'; } },
      { key: 'kind', label: 'Direction', sort: function (r) { return r.kind; },
        render: function (r) {
          return r.kind === 'vendor'
            ? U.badge('Outgoing · Vendor', 'b-violet')
            : U.badge('Incoming · Customer', 'b-green');
        } },
      { key: 'cycle', label: 'Cycle', sort: function (r) { return r.cycle || ''; },
        render: function (r) { return '<span class="chip">' + U.esc(r.cycle || '—') + '</span>'; } },
      { key: 'services', label: 'Services',
        render: function (r) {
          var names = S.serviceNames(r.services);
          return names.length ? '<span class="muted" style="font-size:12px">' + U.esc(names.join(', ')) + '</span>' : '<span class="muted">—</span>';
        } },
      { key: 'payment', label: 'Payment', sort: function (r) { return r.health ? r.health.label : 'zz'; },
        render: function (r) {
          if (!r.health) return '<span class="muted">—</span>';
          if (r.health.source === 'free') {
            /* Owes nothing by design — must not read as unpaid. */
            return U.badge(r.health.label, r.health.tone) +
              '<div class="muted" style="font-size:11px;margin-top:3px">no charge</div>';
          }
          if (r.health.source === 'manual') {
            /* Deliberately neutral: not linked to Stripe is not the same
               as not paid, and must never read like a red flag. */
            return '<span class="chip">Tracked manually</span>';
          }
          return U.badge(r.health.label, r.health.tone) +
            (r.health.outstanding
              ? '<div class="mono" style="font-size:11px;margin-top:3px;color:var(--text-3)">' +
                S.cents(r.health.outstanding) + ' outstanding</div>'
              : '');
        } },
      { key: 'status', label: 'Stage', sort: function (r) { return S.status(r.status).order; },
        render: function (r) { return U.statusBadge(r.status); } },
      { key: 'owner', label: 'Owner', sort: function (r) { return S.user(r.ownerId).name; },
        render: function (r) { return U.userCell(r.ownerId); } },
      { key: 'amount', label: 'Amount', cls: 'right', sort: function (r) { return r.amount; },
        render: function (r) {
          return '<span class="mono strong" style="color:' + (r.kind === 'vendor' ? 'var(--text-2)' : 'var(--ok)') + '">' +
            (r.kind === 'vendor' ? '−' : '+') + S.money(r.amount) + '</span>';
        } }
    ];
  }

  function kpi(label, value, foot, mod) {
    return '<div class="kpi ' + mod + '"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + U.esc(value) + '</div><div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }

  /* Real numbers from Stripe, shown only once the mirror has something in
     it — an empty strip would just be noise before the first sync. */
  function stripeStrip() {
    if (!S.stripeEnabled()) return '';
    var invoices = S.all('stripeInvoices');
    var subs = S.all('stripeSubscriptions');
    var sync = S.syncState();
    if (!invoices.length && !subs.length) return '';

    var open = invoices.filter(function (i) { return i.status === 'open'; });
    var outstanding = open.reduce(function (s, i) { return s + (Number(i.amountRemainingCents) || 0); }, 0);
    var today = S.today();
    var late = open.filter(function (i) { return i.dueDate && i.dueDate < today; });
    var paid30 = invoices.filter(function (i) {
      return i.paidAt && i.paidAt >= new Date(Date.now() - 30 * 86400000).toISOString();
    });
    var collected = paid30.reduce(function (s, i) { return s + (Number(i.amountPaidCents) || 0); }, 0);
    var unlinked = S.unlinkedInvoices().length;

    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head"><span class="card-title">From Stripe</span>' +
        U.badge('Live', 'b-green') +
        '<div class="page-actions"><span class="hint">' +
          (sync && sync.lastEventAt ? 'last event ' + U.esc(U.fmtWhen(sync.lastEventAt))
           : sync && sync.lastSyncAt ? 'last sync ' + U.esc(U.fmtWhen(sync.lastSyncAt))
           : 'not synced yet') +
        '</span></div></div>' +
      '<div class="card-body"><div class="grid g-4">' +
        kpi('Recurring / mo', S.cents(S.stripeMrr()),
            subs.filter(function (s) { return s.status === 'active'; }).length + ' active subscriptions', 'accent') +
        kpi('Collected · 30d', S.cents(collected), paid30.length + ' invoices paid', 'ok') +
        kpi('Outstanding', S.cents(outstanding), open.length + ' invoices open', open.length ? '' : 'ok') +
        kpi('Past Due', String(late.length),
            late.length ? S.cents(late.reduce(function (s, i) { return s + i.amountRemainingCents; }, 0)) + ' late'
                        : 'nothing late', late.length ? 'danger' : 'ok') +
      '</div>' +
      (unlinked
        ? '<div class="hint" style="margin-top:12px">' + unlinked + ' invoice' + (unlinked === 1 ? '' : 's') +
          ' could not be matched to a CRM customer. Open the customer and paste their Stripe ' +
          'customer id to link them.</div>'
        : '') +
      '</div></div>';
  }
})(window);
