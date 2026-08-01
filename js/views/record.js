/* ═══════════════════════════════════════════════════════════════════
   record.js — the shared Salesforce-style record page.
   Customers and vendors are the same object shape with different
   fields, so they share one detail shell: hero + highlights + tabs.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;

  /* cfg = {coll, type, id, icon, backHref, backLabel, detailRows(rec), onEdit(rec, done)} */
  function render(el, cfg) {
    var rec = S.find(cfg.coll, cfg.id);
    if (!rec) {
      el.innerHTML = U.empty('Record not found', 'It may have been deleted.',
        '<a class="btn" href="' + cfg.backHref + '">Back to ' + U.esc(cfg.backLabel) + '</a>');
      return;
    }

    var extraTabs = cfg.extraTabs || [];
    var tab = (location.hash.split('?')[1] || '').indexOf('tab=notes') > -1 ? 'notes' : (root.__recTab || 'details');
    /* a tab from another record type may still be selected — fall back */
    if (['details', 'notes', 'work', 'activity'].indexOf(tab) < 0 &&
        !extraTabs.some(function (t) { return t.id === tab; })) tab = 'details';
    var notes = S.notesFor(cfg.type, rec.id);
    var wos = S.workOrdersFor(cfg.type, rec.id);
    var openWos = wos.filter(function (w) { return w.status !== 'complete'; });
    var acts = S.activityFor(cfg.coll, rec.id);
    var st = S.status(rec.status);
    var billTone = U.dueTone(rec.billingDate);

    el.innerHTML =
      '<div style="margin-bottom:12px"><a class="btn btn-ghost btn-sm" href="' + cfg.backHref + '">' +
        '<svg viewBox="0 0 24 24" class="ico"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> ' + U.esc(cfg.backLabel) + '</a></div>' +

      '<div class="record-hero">' +
        '<div class="record-top">' +
          '<div class="record-icon">' + cfg.icon + '</div>' +
          '<div style="min-width:0">' +
            '<h1 class="record-name">' + U.esc(rec.name) + '</h1>' +
            '<div class="record-meta">' +
              U.statusBadge(rec.status) +
              (cfg.type === 'vendor' ? U.badge(S.vendorType(rec.vendorType).label, 'b-violet', true) : '') +
              (rec.industry ? '<span class="chip">' + U.esc(rec.industry) + '</span>' : '') +
              (rec.website ? '<a class="chip" href="https://' + U.esc(rec.website) + '" target="_blank" rel="noopener">' + U.esc(rec.website) + '</a>' : '') +
              (rec.address ? '<span>' + U.esc(rec.address) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="page-actions">' +
            '<button class="btn btn-sm" id="newWo">+ Work Order</button>' +
            '<button class="btn btn-sm" id="editRec">Edit</button>' +
            (S.canManage() ? '<button class="btn btn-sm btn-danger" id="delRec">Delete</button>' : '') +
          '</div>' +
        '</div>' +

        '<div class="highlights">' +
          hl('Primary Contact', U.esc(rec.contactName || '—')) +
          hl('Phone', rec.phone ? '<a href="tel:' + U.esc(rec.phone) + '">' + U.esc(rec.phone) + '</a>' : '—') +
          hl('Email', rec.email ? '<a href="mailto:' + U.esc(rec.email) + '" style="color:var(--orange)">' + U.esc(rec.email) + '</a>' : '—') +
          hl(cfg.type === 'vendor' ? 'Next Payment' : 'Next Billing',
             (rec.billingDate ? U.fmtDate(rec.billingDate) + ' <span class="badge ' + (billTone.cls.indexOf('b-') === 0 ? billTone.cls : 'b-grey') + '" style="margin-left:6px">' + U.esc(billTone.text) + '</span>' : '—')) +
          hl(cfg.type === 'vendor' ? 'Spend' : 'Value', '<span class="mono">' + S.money(rec.value) + '</span> <span class="muted">/ ' + U.esc(rec.billingCycle || '—') + '</span>') +
          hl('Owner', U.userCell(rec.ownerId)) +
        '</div>' +
      '</div>' +

      '<div class="tabs">' +
        tabBtn('details', 'Details', '') +
        tabBtn('notes', 'Notes', notes.length) +
        tabBtn('work', 'Work Orders', openWos.length) +
        extraTabs.map(function (t) {
          return tabBtn(t.id, t.label, t.count ? t.count(rec) : '');
        }).join('') +
        tabBtn('activity', 'Activity', acts.length) +
      '</div>' +

      '<div id="tabBody"></div>';

    function hl(label, value) {
      return '<div class="highlight"><div class="hl-label">' + U.esc(label) + '</div><div class="hl-value">' + value + '</div></div>';
    }
    function tabBtn(id, label, count) {
      return '<button data-tab="' + id + '"' + (tab === id ? ' class="on"' : '') + '>' + U.esc(label) +
        (count !== '' && count !== undefined ? '<span class="count">' + count + '</span>' : '') + '</button>';
    }

    var body = el.querySelector('#tabBody');
    paintTab();

    el.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () {
        root.__recTab = b.dataset.tab;
        el.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
        tab = b.dataset.tab;
        paintTab();
      };
    });

    el.querySelector('#editRec').onclick = function () { cfg.onEdit(rec, function () { render(el, cfg); }); };
    el.querySelector('#newWo').onclick = function () {
      root.WorkOrderForm.open({ entityType: cfg.type, entityId: rec.id }, function () { render(el, cfg); });
    };
    var delBtn = el.querySelector('#delRec');
    if (delBtn) delBtn.onclick = function () {
      U.confirmDelete(rec.name, function () {
        S.remove(cfg.coll, rec.id);
        U.toast(rec.name + ' deleted.');
        location.hash = cfg.backHref.replace('#', '');
      });
    };

    function paintTab() {
      if (tab === 'details') {
        body.innerHTML =
          '<div class="detail-cols">' +
            '<div class="card"><div class="card-head"><span class="card-title">Record Detail</span></div>' +
              '<div class="card-body"><dl class="dl">' + cfg.detailRows(rec) + '</dl></div></div>' +
            '<div class="stack">' +
              '<div class="card"><div class="card-head"><span class="card-title">Services</span></div><div class="card-body">' +
                ((rec.services || []).length
                  ? '<div class="chips">' + rec.services.map(function (sid) {
                      var sv = S.service(sid);
                      return '<span class="chip">' + U.esc(sv.name) + ' <span class="muted mono">' + S.money(sv.rate) + '</span></span>';
                    }).join('') + '</div>'
                  : '<span class="muted">No services attached.</span>') +
              '</div></div>' +
              '<div class="card"><div class="card-head"><span class="card-title">Pinned Notes</span></div><div class="card-body">' +
                (notes.filter(function (n) { return n.pinned; }).length
                  ? notes.filter(function (n) { return n.pinned; }).map(function (n) {
                      return '<div style="margin-bottom:12px"><div class="split" style="margin-bottom:4px">' + U.avatar(n.authorId, 'sm') +
                        '<span class="strong" style="font-size:12.5px">' + U.esc(S.user(n.authorId).name) + '</span>' +
                        '<span class="note-time">' + U.esc(U.fmtWhen(n.createdAt)) + '</span></div>' +
                        '<div class="note-text" style="font-size:12.5px">' + U.esc(n.body) + '</div></div>';
                    }).join('')
                  : '<span class="muted">Nothing pinned. Pin the notes everyone needs to see.</span>') +
              '</div></div>' +
            '</div>' +
          '</div>';

      } else if (tab === 'notes') {
        body.innerHTML =
          '<div class="detail-cols"><div class="card"><div class="card-head">' +
            '<span class="card-title">Team Notes</span>' +
            '<span class="kcol-count">' + notes.length + '</span>' +
            '<div class="page-actions"><span class="hint">Everyone on the team can add context here</span></div>' +
          '</div><div class="card-body">' + U.notesPanel(cfg.type, rec.id) + '</div></div>' +
          '<div class="card"><div class="card-head"><span class="card-title">Who\'s Contributed</span></div><div class="card-body">' +
            contributors(notes) + '</div></div></div>';
        U.bindNotes(body, cfg.type, rec.id, function () { render(el, cfg); });

      } else if (tab === 'work') {
        body.innerHTML =
          '<div class="card"><div class="card-head"><span class="card-title">Work Orders</span>' +
            '<div class="page-actions"><button class="btn btn-primary btn-sm" id="addWo2">+ New Work Order</button></div></div>' +
          (wos.length ? U.table(root.WorkOrderCols(), wos, { rowLink: true, sortKey: 'due', sortDir: 1 })
                      : U.empty('No work orders yet', 'Track the day-to-day deliverables for this account here.')) +
          '</div>';
        body.querySelector('#addWo2').onclick = function () {
          root.WorkOrderForm.open({ entityType: cfg.type, entityId: rec.id }, function () { render(el, cfg); });
        };
        U.bindTable(body, { onSort: function () {}, onRow: function (id) { location.hash = '#/workorders/' + id; } });

      } else if (tab === 'activity') {
        body.innerHTML = '<div class="card"><div class="card-head"><span class="card-title">Activity History</span></div>' +
          '<div class="card-body">' + U.timeline(acts, 60) + '</div></div>';

      } else {
        var extra = extraTabs.filter(function (t) { return t.id === tab; })[0];
        body.innerHTML = extra ? extra.render(rec) : '';
        var link = body.querySelector('#linkStripe');
        if (link) link.onclick = function () { cfg.onEdit(rec, function () { render(el, cfg); }); };
      }
    }

    function contributors(list) {
      var by = {};
      list.forEach(function (n) { by[n.authorId] = (by[n.authorId] || 0) + 1; });
      var ids = Object.keys(by);
      if (!ids.length) return '<span class="muted">No contributors yet.</span>';
      return ids.sort(function (a, b) { return by[b] - by[a]; }).map(function (id) {
        return '<div class="split" style="padding:7px 0;border-bottom:1px solid var(--line)">' + U.avatar(id, 'sm') +
          '<span>' + U.esc(S.user(id).name) + '</span>' +
          '<span class="muted mono" style="margin-left:auto">' + by[id] + '</span></div>';
      }).join('');
    }
  }

  root.RecordView = { render: render };
})(window);
