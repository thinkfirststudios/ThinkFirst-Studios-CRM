/* ═══════════════════════════════════════════════════════════════════
   tracker.js — the everyday work-order tracker.
   One screen answering: what's on the board today, what slipped,
   who's carrying what, and what actually got done.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var st = { date: null, who: 'all', group: 'status' };

  root.Views.tracker = function (el) {
    if (!st.date) st.date = S.today();
    var date = st.date;
    var isToday = date === S.today();
    var me = S.me();

    /* Items on the board: scheduled for the date, plus anything open that
       slipped past its due date (only rolls onto today, not history). */
    var board = S.all('workOrders').filter(function (w) {
      var scheduled = w.scheduledDate === date;
      var slipped = isToday && w.status !== 'complete' && w.dueDate && w.dueDate < date;
      return scheduled || slipped;
    }).filter(function (w) { return st.who === 'all' || w.assigneeId === me.id; });

    var overdue = board.filter(function (w) { return S.isOverdue(w) && w.scheduledDate !== date; });
    var scheduled = board.filter(function (w) { return overdue.indexOf(w) < 0; });
    var done = board.filter(function (w) { return w.status === 'complete'; });
    var hours = S.hoursOn(date, st.who === 'mine' ? me.id : null);
    var estTotal = board.reduce(function (s, w) { return s + (Number(w.estHours) || 0); }, 0);
    var pct = board.length ? Math.round(done.length / board.length * 100) : 0;
    var log = S.dailyLog(date, me.id);

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Everyday Tracker</div>' +
          '<h1 class="page-title">' + U.esc(longDate(date)) + (isToday ? ' <span style="color:var(--orange)">· Today</span>' : '') + '</h1>' +
          '<div class="page-sub">' + board.length + ' on the board · ' + done.length + ' done · ' +
            '<span class="mono">' + hours + 'h</span> logged of ' + estTotal + 'h estimated</div></div>' +
        '<div class="page-actions">' +
          '<div class="date-nav">' +
            '<button class="btn btn-icon" id="prevDay"><svg viewBox="0 0 24 24" class="ico"><path d="M15 18l-6-6 6-6"/></svg></button>' +
            '<input class="input" type="date" id="dateInput" value="' + date + '">' +
            '<button class="btn btn-icon" id="nextDay"><svg viewBox="0 0 24 24" class="ico"><path d="M9 18l6-6-6-6"/></svg></button>' +
            '<button class="btn btn-sm" id="todayBtn">Today</button>' +
          '</div>' +
          '<div class="seg" id="whoSeg">' +
            '<button data-who="all" class="' + (st.who === 'all' ? 'on' : '') + '">Team</button>' +
            '<button data-who="mine" class="' + (st.who === 'mine' ? 'on' : '') + '">My day</button>' +
          '</div>' +
          '<button class="btn btn-primary" id="newWo">+ Work Order</button>' +
        '</div>' +
      '</div>' +

      dayStrip(date) +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('On The Board', String(board.length), (board.length - done.length) + ' still open', '') +
        kpi('Completed', done.length + ' / ' + board.length, pct + '% of the day', pct === 100 && board.length ? 'ok' : 'accent') +
        kpi('Rolled Over', String(overdue.length), overdue.length ? 'Past due, carried to today' : 'Nothing slipped', overdue.length ? 'danger' : 'ok') +
        kpi('Hours Logged', hours + 'h', 'against ' + estTotal + 'h estimated', '') +
      '</div>' +

      '<div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);align-items:start">' +
        '<div class="stack">' +
          (overdue.length ?
            '<div class="card" style="border-color:rgba(229,72,77,.35)">' +
              '<div class="card-head"><span class="card-title" style="color:var(--danger)">Rolled Over — Past Due</span>' +
                '<span class="kcol-count">' + overdue.length + '</span></div>' +
              overdue.map(woRow).join('') + '</div>' : '') +

          '<div class="card">' +
            '<div class="card-head"><span class="card-title">The Board</span>' +
              '<div class="page-actions"><div class="seg" id="groupSeg">' +
                '<button data-group="status" class="' + (st.group === 'status' ? 'on' : '') + '">By status</button>' +
                '<button data-group="assignee" class="' + (st.group === 'assignee' ? 'on' : '') + '">By person</button>' +
              '</div></div></div>' +
            (scheduled.length ? groups(scheduled) :
              U.empty('Nothing scheduled', 'Schedule a work order for this day to get started.',
                '<button class="btn btn-primary btn-sm" id="emptyNew">+ New Work Order</button>')) +
          '</div>' +
        '</div>' +

        '<div class="stack">' +
          '<div class="card"><div class="card-head"><span class="card-title">Team Load</span></div>' +
            '<div class="card-body">' + teamLoad(date) + '</div></div>' +

          '<div class="card"><div class="card-head"><span class="card-title">End Of Day Log</span>' +
            '<div class="page-actions">' + U.avatar(me.id, 'sm') + '</div></div>' +
            '<div class="card-body">' +
              '<textarea class="input" id="dayLog" placeholder="What moved today? What is blocked? What is first thing tomorrow?" style="min-height:120px">' +
                U.esc(log ? log.summary : '') + '</textarea>' +
              '<div class="split" style="margin-top:9px">' +
                '<span class="hint">Saved to ' + U.esc(me.name) + ' · ' + U.esc(U.fmtDateShort(date)) + '</span>' +
                '<button class="btn btn-primary btn-sm" id="saveLog" style="margin-left:auto">Save log</button>' +
              '</div>' +
            '</div></div>' +

          '<div class="card"><div class="card-head"><span class="card-title">Logged Today</span></div>' +
            '<div class="card-body">' + timeToday(date) + '</div></div>' +
        '</div>' +
      '</div>';

    /* ── wiring ─────────────────────────────────────────────── */
    el.querySelector('#dateInput').onchange = function () { st.date = this.value || S.today(); root.render(); };
    el.querySelector('#prevDay').onclick = function () { st.date = addDays(date, -1); root.render(); };
    el.querySelector('#nextDay').onclick = function () { st.date = addDays(date, 1); root.render(); };
    el.querySelector('#todayBtn').onclick = function () { st.date = S.today(); root.render(); };
    el.querySelectorAll('#whoSeg button').forEach(function (b) { b.onclick = function () { st.who = b.dataset.who; root.render(); }; });
    el.querySelectorAll('#groupSeg button').forEach(function (b) { b.onclick = function () { st.group = b.dataset.group; root.render(); }; });
    el.querySelectorAll('.day-cell').forEach(function (c) { c.onclick = function () { st.date = c.dataset.date; root.render(); }; });

    var newBtn = el.querySelector('#newWo');
    newBtn.onclick = function () { root.WorkOrderForm.open({ scheduledDate: date, dueDate: date }, root.render); };
    var emptyNew = el.querySelector('#emptyNew');
    if (emptyNew) emptyNew.onclick = newBtn.onclick;

    el.querySelector('#saveLog').onclick = function () {
      S.saveDailyLog(date, el.querySelector('#dayLog').value.trim());
      U.toast('Day log saved.', 'ok');
    };

    el.querySelectorAll('.wo-check').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var w = S.find('workOrders', b.dataset.done);
        S.setWorkOrderStatus(w.id, w.status === 'complete' ? 'inprogress' : 'complete');
        root.render();
      };
    });
    el.querySelectorAll('[data-time]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        root.WorkOrderForm.openTimeLog(S.find('workOrders', b.dataset.time), root.render);
      };
    });
    el.querySelectorAll('[data-open]').forEach(function (n) {
      n.onclick = function (e) {
        if (e.target.closest('button')) return;
        location.hash = '#/workorders/' + n.dataset.open;
      };
    });

    /* ── pieces ─────────────────────────────────────────────── */
    function groups(list) {
      if (st.group === 'assignee') {
        var byUser = {};
        list.forEach(function (w) { (byUser[w.assigneeId] = byUser[w.assigneeId] || []).push(w); });
        return Object.keys(byUser).map(function (uid) {
          return groupHead(U.avatar(uid, 'sm') + ' ' + U.esc(S.user(uid).name), byUser[uid].length) +
            byUser[uid].map(woRow).join('');
        }).join('');
      }
      return S.WO_STATUSES.map(function (ws) {
        var inGroup = list.filter(function (w) { return w.status === ws.id; });
        if (!inGroup.length) return '';
        return groupHead(U.badge(ws.label, ws.tone), inGroup.length) + inGroup.map(woRow).join('');
      }).join('');
    }

    function groupHead(label, count) {
      return '<div style="padding:9px 14px;background:var(--surface-2);border-bottom:1px solid var(--line);' +
        'display:flex;align-items:center;gap:9px;font-size:12px">' + label +
        '<span class="kcol-count" style="margin-left:auto">' + count + '</span></div>';
    }
  };

  /* ── a single work-order line on the board ─────────────────── */
  function woRow(w) {
    var isDone = w.status === 'complete';
    var p = S.priority(w.priority);
    var t = U.dueTone(w.dueDate, isDone);
    var logged = S.timeFor(w.id).reduce(function (s, e) { return s + e.hours; }, 0);
    return '<div class="wo-row' + (isDone ? ' done' : '') + '" data-open="' + U.esc(w.id) + '" style="cursor:pointer">' +
      '<span class="prio-flag" style="background:' + p.color + '"></span>' +
      '<button class="wo-check' + (isDone ? ' on' : '') + '" data-done="' + U.esc(w.id) + '" title="Toggle complete">' +
        '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></button>' +
      '<div class="wo-main">' +
        '<div class="wo-title">' + U.esc(w.title) + '</div>' +
        '<div class="wo-sub">' +
          U.avatar(w.assigneeId, 'sm') +
          '<span>' + U.esc(S.recordName(w.entityType, w.entityId)) + '</span>' +
          '<span class="chip">' + U.esc(S.service(w.serviceId).name) + '</span>' +
          '<span class="mono">' + logged + '/' + (w.estHours || 0) + 'h</span>' +
        '</div>' +
      '</div>' +
      '<div class="wo-side">' +
        '<span class="badge ' + (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '">' + U.esc(t.text) + '</span>' +
        U.woBadge(w.status) +
        '<button class="btn btn-ghost btn-sm" data-time="' + U.esc(w.id) + '">+ Time</button>' +
      '</div></div>';
  }

  /* ── seven-day strip ───────────────────────────────────────── */
  function dayStrip(active) {
    var cells = [];
    for (var i = -3; i <= 3; i++) {
      var d = addDays(S.today(), i);
      var items = S.all('workOrders').filter(function (w) { return w.scheduledDate === d; });
      var dt = new Date(d + 'T00:00:00');
      cells.push('<div class="day-cell' + (d === active ? ' on' : '') + (d === S.today() ? ' today' : '') + '" data-date="' + d + '">' +
        '<div class="dc-dow">' + dt.toLocaleDateString('en-US', { weekday: 'short' }) + '</div>' +
        '<div class="dc-num">' + dt.getDate() + '</div>' +
        '<div class="dc-bar">' + items.slice(0, 5).map(function (w) {
          return '<i style="background:' + (w.status === 'complete' ? 'var(--ok)' : S.priority(w.priority).color) + '"></i>';
        }).join('') + '</div></div>');
    }
    return '<div class="day-strip">' + cells.join('') + '</div>';
  }

  /* ── team load for the day ─────────────────────────────────── */
  function teamLoad(date) {
    var users = S.activeUsers();
    var rows = users.map(function (u) {
      var mine = S.all('workOrders').filter(function (w) {
        return w.assigneeId === u.id && (w.scheduledDate === date ||
          (date === S.today() && w.status !== 'complete' && w.dueDate && w.dueDate < date));
      });
      var doneN = mine.filter(function (w) { return w.status === 'complete'; }).length;
      var est = mine.reduce(function (s, w) { return s + (Number(w.estHours) || 0); }, 0);
      var pct = mine.length ? Math.round(doneN / mine.length * 100) : 0;
      return { u: u, n: mine.length, done: doneN, est: est, pct: pct };
    }).sort(function (a, b) { return b.n - a.n; });

    return rows.map(function (r) {
      return '<div style="padding:9px 0;border-bottom:1px solid var(--line)">' +
        '<div class="split">' + U.avatar(r.u.id, 'sm') +
          '<span style="font-size:12.5px">' + U.esc(r.u.name) + '</span>' +
          '<span class="muted mono" style="margin-left:auto">' + r.done + '/' + r.n + ' · ' + r.est + 'h</span></div>' +
        '<div class="bar" style="margin-top:7px"><i style="width:' + r.pct + '%"></i></div></div>';
    }).join('');
  }

  /* ── time entries recorded on the day ──────────────────────── */
  function timeToday(date) {
    var entries = S.all('timeEntries').filter(function (t) { return t.date === date; });
    if (!entries.length) return '<span class="muted">No time logged for this day yet.</span>';
    return entries.map(function (t) {
      var w = S.find('workOrders', t.workOrderId);
      return '<div style="padding:8px 0;border-bottom:1px solid var(--line)">' +
        '<div class="split">' + U.avatar(t.userId, 'sm') +
          '<span style="font-size:12.5px">' + U.esc(w ? w.title : 'Deleted work order') + '</span>' +
          '<span class="mono strong" style="margin-left:auto;color:var(--orange)">' + t.hours + 'h</span></div>' +
        (t.note ? '<div class="muted" style="font-size:11.5px;margin-top:3px">' + U.esc(t.note) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  /* ── utils ─────────────────────────────────────────────────── */
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    /* Local, to match how the date was parsed a line above — see
       Store.dateKey. UTC here shifted the whole 7-day strip. */
    return S.dateKey(d);
  }
  function longDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function kpi(label, value, foot, mod) {
    return '<div class="kpi ' + mod + '"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + U.esc(value) + '</div><div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }
})(window);
