/* Pipeline — the deal board. Drag a card to move the opportunity.

   This board used to hold accounts, which meant moving a company to
   "Sale Lost" wrote off the whole relationship rather than one deal.
   It now holds opportunities, so an account can have a won deal, a lost
   deal and a live one at the same time — which is what actually
   happens. */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var TONE_DOT = { 'b-grey': '#9aa3af', 'b-orange': '#FA7700', 'b-blue': '#4C8DFF',
    'b-green': '#2FBF71', 'b-red': '#E5484D', 'b-yellow': '#E8B931', 'b-violet': '#8B7CF6' };
  var st = { owner: '', closed: false };

  root.Views.pipeline = function (el) {
    var stages = S.OPP_STAGES.filter(function (s) { return st.closed || s.open; });
    var deals = S.all('opportunities').filter(function (o) {
      return !st.owner || o.ownerId === st.owner;
    });
    var open = deals.filter(function (o) { return S.oppStage(o.stage).open; });
    var weighted = S.weightedPipeline(open);

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Pipeline</h1>' +
          '<div class="page-sub">Drag a card to move the deal. ' +
            S.money(open.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0)) +
            ' open · ' + S.money(weighted) + ' weighted.</div></div>' +
        '<div class="page-actions">' +
          '<select class="input" id="fowner" style="max-width:190px"><option value="">All owners</option>' +
            U.options(S.activeUsers(), st.owner, 'id', 'name') + '</select>' +
          '<div class="seg" id="closedSeg">' +
            '<button data-closed="0" class="' + (st.closed ? '' : 'on') + '">Open only</button>' +
            '<button data-closed="1" class="' + (st.closed ? 'on' : '') + '">Include closed</button>' +
          '</div>' +
          '<a class="btn" href="#/opportunities">List view</a>' +
          '<button class="btn btn-primary" id="newOpp">+ New Opportunity</button>' +
        '</div>' +
      '</div>' +

      '<div class="kanban">' + stages.map(function (stage) {
        var inCol = deals.filter(function (o) { return o.stage === stage.id; });
        var sum = inCol.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0);
        return '<div class="kcol" data-stage="' + U.esc(stage.id) + '">' +
          '<div class="kcol-head"><span class="dot" style="background:' + (TONE_DOT[stage.tone] || '#9aa3af') + '"></span>' +
            '<span class="kcol-title">' + U.esc(stage.label) + '</span>' +
            '<span class="kcol-count">' + inCol.length + '</span></div>' +
          '<div class="kcol-body">' + (inCol.length ? inCol.map(card).join('') :
            '<div class="muted" style="padding:18px 6px;text-align:center;font-size:12px">Drop a deal here</div>') + '</div>' +
          '<div class="kcol-sum"><span>' + (stage.open ? stage.probability + '% · Total' : 'Total') + '</span>' +
            '<span class="mono">' + S.money(sum) + '</span></div>' +
        '</div>';
      }).join('') + '</div>';

    el.querySelector('#newOpp').onclick = function () { root.Views.opportunities.openForm(null, root.render); };
    el.querySelector('#fowner').onchange = function () { st.owner = this.value; root.render(); };
    el.querySelectorAll('#closedSeg button').forEach(function (b) {
      b.onclick = function () { st.closed = b.dataset.closed === '1'; root.render(); };
    });

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
        location.hash = '#/opportunities/' + c.dataset.id;
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
        var o = S.find('opportunities', id);
        var target = col.dataset.stage;
        if (!o || o.stage === target) return;

        /* Closing a deal is not a drag-and-drop gesture: won needs the
           final amount, lost needs a reason. Hand both to the dialog
           that asks for them. */
        if (target === 'closedwon') return root.Views.opportunities.closeWon(o, root.render);
        if (target === 'closedlost') return closeLostFromBoard(o);

        S.setOppStage(id, target);
        U.toast(o.name + ' moved to ' + S.oppStage(target).label + '.', 'ok');
        root.render();
      });
    });

    function closeLostFromBoard(o) {
      U.modal({
        title: 'Close ' + o.name + ' as lost',
        okText: 'Mark Closed Lost', danger: true,
        body: '<div class="field"><label>Why was it lost?</label>' +
          '<textarea class="input" name="lostReason" placeholder="Price, timing, went in-house, went quiet…"></textarea>' +
          '<div class="hint">The only record of why. Worth the ten seconds.</div></div>',
        onOk: function (box) {
          S.update('opportunities', o.id, {
            stage: 'closedlost', closedAt: S.nowISO(), lostReason: U.values(box).lostReason || ''
          }, o.name + ' → Closed Lost');
          U.toast(o.name + ' marked lost.', 'ok');
          root.render();
        }
      });
    }

    function card(o) {
      var stage = S.oppStage(o.stage);
      var t = U.dueTone(o.closeDate, !stage.open);
      var ct = o.contactId ? S.contact(o.contactId) : null;
      var openTasks = S.openTasks({ entityType: 'opportunity', entityId: o.id }).length;
      var noteCount = S.notesFor('opportunity', o.id).length;
      return '<div class="kcard" data-id="' + U.esc(o.id) + '">' +
        '<div class="kcard-title">' + U.esc(o.name) + '</div>' +
        '<div class="muted" style="font-size:11.5px">' + U.esc(S.accountName(o.accountId)) +
          (ct ? ' · ' + U.esc(S.contactName(ct)) : '') + '</div>' +
        '<div class="split" style="margin-top:9px;justify-content:space-between">' +
          '<span class="mono strong" style="color:var(--orange)">' + S.money(o.amount) + '</span>' +
          '<span class="chip">' + U.esc(o.type || '—') + '</span>' +
        '</div>' +
        (o.nextStep
          ? '<div class="muted" style="font-size:11px;margin-top:7px">Next: ' +
            U.esc(o.nextStep.slice(0, 54)) + (o.nextStep.length > 54 ? '…' : '') + '</div>'
          : '') +
        '<div class="kcard-row">' + U.avatar(o.ownerId, 'sm') +
          '<span>' + U.esc(S.user(o.ownerId).name.split(' ')[0]) + '</span>' +
          '<span style="margin-left:auto" class="' + (t.cls.indexOf('b-') === 0 ? 'badge ' + t.cls : 'muted') + '">' +
            U.esc(t.text) + '</span>' +
        '</div>' +
        (openTasks || noteCount ? '<div class="kcard-row" style="gap:10px">' +
          (openTasks ? '<span title="Open activities">◷ ' + openTasks + '</span>' : '') +
          (noteCount ? '<span title="Notes">✎ ' + noteCount + '</span>' : '') + '</div>' : '') +
      '</div>';
    }
  };
})(window);
