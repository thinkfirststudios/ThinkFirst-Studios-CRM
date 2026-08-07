/* ═══════════════════════════════════════════════════════════════════
   record.js — the shared record page.

   Laid out the way Salesforce lays out a record: a highlight bar of the
   fields you check at a glance, tabbed content on the left, and the
   activity panel pinned to the right so what is scheduled stays visible
   while you read the details.

   cfg = {
     coll, type, id, icon, backHref, backLabel,
     detailRows(rec)   -> <dt>/<dd> pairs
     highlights(rec)   -> [{label, value}]        (optional)
     badges(rec)       -> html                     (optional)
     related(rec)      -> [{title, count, html, addLabel, onAdd}]  (optional)
     extraTabs         -> [{id, label, count(rec), render(rec)}]   (optional)
     onEdit(rec, done)
   }
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;

  function render(el, cfg) {
    var rec = S.find(cfg.coll, cfg.id);
    if (!rec) {
      el.innerHTML = U.empty('Record not found', 'It may have been deleted.',
        '<a class="btn" href="' + cfg.backHref + '">Back to ' + U.esc(cfg.backLabel) + '</a>');
      return;
    }

    var rerender = function () { render(el, cfg); };
    var extraTabs = cfg.extraTabs || [];
    var related = cfg.related ? cfg.related(rec) : defaultRelated(rec, cfg);
    var notes = S.notesFor(cfg.type, rec.id);
    var acts = S.activityFor(cfg.coll, rec.id);
    var openActs = S.openTasks({ entityType: cfg.type, entityId: rec.id });

    var BASE = ['related', 'details', 'notes', 'history'];
    var tab = root.__recTab || 'related';
    if (BASE.indexOf(tab) < 0 && !extraTabs.some(function (t) { return t.id === tab; })) tab = 'related';
    if (tab === 'related' && !related.length) tab = 'details';

    el.innerHTML =
      '<div style="margin-bottom:12px"><a class="btn btn-ghost btn-sm" href="' + cfg.backHref + '">' +
        '<svg viewBox="0 0 24 24" class="ico"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> ' + U.esc(cfg.backLabel) + '</a></div>' +

      (cfg.banner ? cfg.banner(rec) : '') +

      '<div class="record-hero">' +
        '<div class="record-top">' +
          '<div class="record-icon">' + cfg.icon + '</div>' +
          '<div style="min-width:0">' +
            '<div class="eyebrow">' + U.esc(cfg.objectLabel || cfg.backLabel) + '</div>' +
            '<h1 class="record-name">' + U.esc(cfg.recordTitle ? cfg.recordTitle(rec) : rec.name) + '</h1>' +
            '<div class="record-meta">' + (cfg.badges ? cfg.badges(rec) : '') + '</div>' +
          '</div>' +
          '<div class="page-actions">' +
            (cfg.actions ? cfg.actions(rec) : '') +
            '<button class="btn btn-sm" id="editRec">Edit</button>' +
            (S.canManage() ? '<button class="btn btn-sm btn-danger" id="delRec">Delete</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="highlights">' +
          (cfg.highlights ? cfg.highlights(rec) : []).map(function (h) {
            return '<div class="highlight"><div class="hl-label">' + U.esc(h.label) + '</div>' +
              '<div class="hl-value">' + h.value + '</div></div>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="rec-cols">' +
        '<div>' +
          '<div class="tabs">' +
            (related.length ? tabBtn('related', 'Related', related.reduce(function (s, r) { return s + (r.count || 0); }, 0)) : '') +
            tabBtn('details', 'Details', '') +
            tabBtn('notes', 'Notes', notes.length) +
            extraTabs.map(function (t) { return tabBtn(t.id, t.label, t.count ? t.count(rec) : ''); }).join('') +
            tabBtn('history', 'History', acts.length) +
          '</div>' +
          '<div id="tabBody"></div>' +
        '</div>' +

        /* Activity stays put rather than hiding behind a tab — the whole
           point of it is to be seen while you are looking at something
           else. */
        '<div class="stack">' +
          '<div class="card" style="padding:0">' +
            '<div class="card-head"><span class="card-title">Activity</span>' +
              (openActs.length ? '<span class="kcol-count">' + openActs.length + ' open</span>' : '') +
            '</div>' +
            '<div id="actPanel"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    function tabBtn(id, label, count) {
      return '<button data-tab="' + id + '"' + (tab === id ? ' class="on"' : '') + '>' + U.esc(label) +
        (count !== '' && count !== undefined ? '<span class="count">' + count + '</span>' : '') + '</button>';
    }

    var body = el.querySelector('#tabBody');
    paintTab();
    paintActivity();

    el.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () {
        root.__recTab = tab = b.dataset.tab;
        el.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
        paintTab();
      };
    });

    el.querySelector('#editRec').onclick = function () { cfg.onEdit(rec, rerender); };
    var delBtn = el.querySelector('#delRec');
    if (delBtn) delBtn.onclick = function () {
      var title = cfg.recordTitle ? cfg.recordTitle(rec) : rec.name;
      U.confirmDelete(title, function () {
        var removed = S.removeCascade(cfg.coll, rec.id);
        var extra = Object.keys(removed).map(function (k) { return removed[k] + ' ' + k; });
        U.toast('Deleted ' + title + (extra.length ? ' and ' + extra.join(', ') : '') + '.');
        location.hash = cfg.backHref.replace('#', '');
      }, S.childrenOf(cfg.coll, rec.id));
    };
    if (cfg.bindActions) cfg.bindActions(el, rec, rerender);

    function paintActivity() {
      var host = el.querySelector('#actPanel');
      host.innerHTML = root.Activities.panel(cfg.type, rec.id);
      root.Activities.bind(host, cfg.type, rec.id, rerender);
    }

    function paintTab() {
      if (tab === 'related') {
        body.innerHTML = '<div class="stack">' + related.map(function (r, i) {
          return '<div class="card rel-list" data-rel="' + i + '">' +
            '<div class="rel-head">' +
              '<span class="rel-title">' + U.esc(r.title) + '</span>' +
              '<span class="rel-count">' + (r.count || 0) + '</span>' +
              (r.addLabel ? '<button class="btn btn-sm" data-reladd="' + i + '" style="margin-left:auto">' +
                U.esc(r.addLabel) + '</button>' : '') +
              '<svg viewBox="0 0 24 24" class="rel-caret"' + (r.addLabel ? '' : ' style="margin-left:auto"') +
                '><path d="M6 9l6 6 6-6"/></svg>' +
            '</div>' +
            '<div class="rel-body">' + (r.html || '<div class="rel-empty">' + U.esc(r.emptyText || 'Nothing yet.') + '</div>') + '</div>' +
          '</div>';
        }).join('') + '</div>';

        body.querySelectorAll('.rel-head').forEach(function (h) {
          h.onclick = function (e) {
            if (e.target.closest('button')) return;
            h.parentNode.classList.toggle('collapsed');
          };
        });
        body.querySelectorAll('[data-reladd]').forEach(function (b) {
          b.onclick = function (e) {
            e.stopPropagation();
            related[Number(b.dataset.reladd)].onAdd(rerender);
          };
        });
        body.querySelectorAll('[data-goto]').forEach(function (n) {
          n.onclick = function () { location.hash = n.dataset.goto; };
        });

      } else if (tab === 'details') {
        body.innerHTML =
          '<div class="card"><div class="card-head"><span class="card-title">Record Detail</span></div>' +
            '<div class="card-body"><dl class="dl">' + cfg.detailRows(rec) + '</dl></div></div>';

      } else if (tab === 'notes') {
        body.innerHTML =
          '<div class="card"><div class="card-head">' +
            '<span class="card-title">Team Notes</span>' +
            '<span class="kcol-count">' + notes.length + '</span>' +
          '</div><div class="card-body">' + U.notesPanel(cfg.type, rec.id) + '</div></div>';
        U.bindNotes(body, cfg.type, rec.id, rerender);

      } else if (tab === 'history') {
        body.innerHTML = '<div class="card"><div class="card-head"><span class="card-title">Field History</span></div>' +
          '<div class="card-body">' + U.timeline(acts, 60) + '</div></div>';

      } else {
        var extra = extraTabs.filter(function (t) { return t.id === tab; })[0];
        body.innerHTML = extra ? extra.render(rec) : '';
        var link = body.querySelector('#linkStripe');
        if (link) link.onclick = function () { cfg.onEdit(rec, rerender); };
      }
    }
  }

  /* Vendors and anything else that has not declared its own related
     lists still get work orders, which every record type can have. */
  function defaultRelated(rec, cfg) {
    var wos = S.workOrdersFor(cfg.type, rec.id);
    return [{
      title: 'Work Orders',
      count: wos.length,
      addLabel: '+ New',
      emptyText: 'No work orders against this record yet.',
      html: wos.length ? wos.map(function (w) { return root.RecordView.woRow(w); }).join('') : '',
      onAdd: function (done) {
        root.WorkOrderForm.open({ entityType: cfg.type, entityId: rec.id }, done);
      }
    }];
  }

  /* Shared row renderers so every related list looks the same. */
  function woRow(w) {
    var t = U.dueTone(w.dueDate, w.status === 'complete');
    var p = S.priority(w.priority);
    return '<div class="rel-row" data-goto="#/workorders/' + U.esc(w.id) + '" style="cursor:pointer">' +
      '<span class="prio-flag" style="background:' + p.color + ';height:26px"></span>' +
      '<div class="rel-row-main"><div class="rel-row-title">' + U.esc(w.title) + '</div>' +
        '<div class="rel-row-sub">' + U.esc(S.service(w.serviceId).name) +
          '<span>·</span><span>' + U.esc(S.user(w.assigneeId).name) + '</span></div></div>' +
      U.woBadge(w.status) +
      '<span class="badge ' + (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '">' + U.esc(t.text) + '</span>' +
      '</div>';
  }

  function contactRow(c) {
    return '<div class="rel-row" data-goto="#/contacts/' + U.esc(c.id) + '" style="cursor:pointer">' +
      U.avatar(c.ownerId, 'sm') +
      '<div class="rel-row-main"><div class="rel-row-title">' + U.esc(S.contactName(c)) +
        (c.isPrimary ? ' ' + U.badge('Primary', 'b-orange', true) : '') + '</div>' +
        '<div class="rel-row-sub">' + U.esc(c.title || '—') +
          (c.role ? '<span class="chip">' + U.esc(c.role) + '</span>' : '') +
          (c.email ? '<span>' + U.esc(c.email) + '</span>' : '') + '</div></div>' +
      (c.phone ? '<span class="muted mono" style="font-size:11.5px">' + U.esc(c.phone) + '</span>' : '') +
      '</div>';
  }

  function oppRow(o) {
    var stage = S.oppStage(o.stage);
    var t = U.dueTone(o.closeDate, !stage.open);
    return '<div class="rel-row" data-goto="#/opportunities/' + U.esc(o.id) + '" style="cursor:pointer">' +
      '<div class="rel-row-main"><div class="rel-row-title">' + U.esc(o.name) + '</div>' +
        '<div class="rel-row-sub">' + U.badge(stage.label, stage.tone) +
          (o.type ? '<span class="chip">' + U.esc(o.type) + '</span>' : '') +
          '<span>' + U.esc(stage.open ? 'closes ' + U.fmtDateShort(o.closeDate) : U.fmtDateShort(o.closeDate)) + '</span>' +
          (stage.open && o.closeDate && S.daysUntil(o.closeDate) < 0
            ? U.badge('date passed', 'b-red') : '') +
        '</div></div>' +
      '<span class="mono strong" style="color:var(--orange)">' + S.money(o.amount) + '</span>' +
      '</div>';
  }

  root.RecordView = { render: render, woRow: woRow, contactRow: contactRow, oppRow: oppRow };
})(window);
