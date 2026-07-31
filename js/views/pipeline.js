/* Pipeline — drag-and-drop kanban across the customer statuses. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var TONE_DOT = { 'b-grey': '#9aa3af', 'b-orange': '#FA7700', 'b-blue': '#4C8DFF', 'b-green': '#2FBF71', 'b-red': '#E5484D', 'b-yellow': '#E8B931', 'b-violet': '#8B7CF6' };
  var filterOwner = '';

  root.Views.pipeline = function (el) {
    var statuses = S.STATUSES();
    var customers = S.all('customers').filter(function (c) { return !filterOwner || c.ownerId === filterOwner; });
    var openValue = customers.filter(function (c) { return S.status(c.status).open; })
      .reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Pipeline</h1>' +
          '<div class="page-sub">Drag a card to move the deal. ' + S.money(openValue) + ' still open.</div></div>' +
        '<div class="page-actions">' +
          '<select class="input" id="fowner" style="max-width:190px"><option value="">All owners</option>' +
            U.options(S.activeUsers(), filterOwner, 'id', 'name') + '</select>' +
          '<a class="btn" href="#/customers">List view</a>' +
          '<button class="btn btn-primary" id="newCust">+ New Customer</button>' +
        '</div>' +
      '</div>' +

      '<div class="kanban">' + statuses.map(function (st) {
        var inCol = customers.filter(function (c) { return c.status === st.id; });
        var sum = inCol.reduce(function (s, c) { return s + (Number(c.value) || 0); }, 0);
        return '<div class="kcol" data-status="' + U.esc(st.id) + '">' +
          '<div class="kcol-head"><span class="dot" style="background:' + (TONE_DOT[st.tone] || '#9aa3af') + '"></span>' +
            '<span class="kcol-title">' + U.esc(st.label) + '</span>' +
            '<span class="kcol-count">' + inCol.length + '</span></div>' +
          '<div class="kcol-body">' + (inCol.length ? inCol.map(card).join('') :
            '<div class="muted" style="padding:18px 6px;text-align:center;font-size:12px">Drop a deal here</div>') + '</div>' +
          '<div class="kcol-sum"><span>Total</span><span class="mono">' + S.money(sum) + '</span></div>' +
        '</div>';
      }).join('') + '</div>';

    el.querySelector('#newCust').onclick = function () { root.Views.customers.openForm(null, root.render); };
    el.querySelector('#fowner').onchange = function () { filterOwner = this.value; root.render(); };

    /* drag + drop */
    var dragId = null;
    el.querySelectorAll('.kcard').forEach(function (c) {
      c.draggable = true;
      c.addEventListener('dragstart', function (e) {
        dragId = c.dataset.id;
        c.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
      });
      c.addEventListener('dragend', function () { c.classList.remove('dragging'); });
      c.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        location.hash = '#/customers/' + c.dataset.id;
      });
    });

    el.querySelectorAll('.kcol').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', function () { col.classList.remove('drop'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('drop');
        var id = dragId || e.dataTransfer.getData('text/plain');
        if (!id) return;
        var c = S.find('customers', id);
        if (!c || c.status === col.dataset.status) return;
        S.update('customers', id, { status: col.dataset.status }, c.name + ' → ' + S.status(col.dataset.status).label);
        U.toast(c.name + ' moved to ' + S.status(col.dataset.status).label, 'ok');
        root.render();
      });
    });

    function card(c) {
      var t = U.dueTone(c.billingDate);
      var openWo = S.workOrdersFor('customer', c.id).filter(function (w) { return w.status !== 'complete'; }).length;
      var noteCount = S.notesFor('customer', c.id).length;
      return '<div class="kcard" data-id="' + U.esc(c.id) + '">' +
        '<div class="kcard-title">' + U.esc(c.name) + '</div>' +
        '<div class="muted" style="font-size:11.5px">' + U.esc(c.contactName || '—') + '</div>' +
        '<div class="split" style="margin-top:9px;justify-content:space-between">' +
          '<span class="mono strong" style="color:var(--orange)">' + S.money(c.value) + '</span>' +
          '<span class="chip">' + U.esc(c.billingCycle || '—') + '</span>' +
        '</div>' +
        '<div class="kcard-row">' + U.avatar(c.ownerId, 'sm') +
          '<span>' + U.esc(S.user(c.ownerId).name.split(' ')[0]) + '</span>' +
          '<span style="margin-left:auto" class="' + (t.cls.indexOf('b-') === 0 ? 'badge ' + t.cls : 'muted') + '">' + U.esc(t.text) + '</span>' +
        '</div>' +
        (openWo || noteCount ? '<div class="kcard-row" style="gap:10px">' +
          (openWo ? '<span title="Open work orders">◧ ' + openWo + '</span>' : '') +
          (noteCount ? '<span title="Notes">✎ ' + noteCount + '</span>' : '') + '</div>' : '') +
      '</div>';
    }
  };
})(window);
