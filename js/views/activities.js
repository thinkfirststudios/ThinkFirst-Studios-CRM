/* ═══════════════════════════════════════════════════════════════════
   activities.js — Tasks, Events and logged Calls.

   Two things live here:
     • Activities.panel/bind — the "Upcoming & Overdue" block that sits
       on every record page, with the three composer buttons above it.
     • Views.activities      — the standalone list across every object.

   One panel serves accounts, contacts, leads, opportunities, vendors
   and work orders, because an activity is the same thing whatever it
   is attached to. That is also why the composer takes the entity as a
   parameter rather than each record page rolling its own.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var TONE_DOT = { 'b-grey': '#8E8A82', 'b-orange': '#AF5300', 'b-blue': '#0560FF',
    'b-green': '#1E7C49', 'b-red': '#D71F24', 'b-yellow': '#87680F', 'b-violet': '#6652F3' };

  /* ── the record-page panel ───────────────────────────────────── */
  function panel(entityType, entityId, opts) {
    opts = opts || {};
    var open = S.openTasks({ entityType: entityType, entityId: entityId });
    var done = S.completedTasksFor(entityType, entityId);

    var overdue = open.filter(function (t) { return S.taskState(t).key === 'overdue'; });
    var todayList = open.filter(function (t) { return S.taskState(t).key === 'today'; });
    var later = open.filter(function (t) {
      var k = S.taskState(t).key;
      return k === 'upcoming' || k === 'undated';
    });

    return '<div class="card">' +
      '<div class="act-tabs">' +
        S.TASK_KINDS.map(function (k) {
          return '<button data-newact="' + U.esc(k.id) + '">' +
            '<span class="act-dot" style="background:' + (TONE_DOT[k.tone] || '#8E8A82') + '"></span>' +
            U.esc(k.verb) + '</button>';
        }).join('') +
      '</div>' +

      (open.length || done.length ? '' :
        U.empty('No activities to show',
          'Get started by logging a call, scheduling a task, or booking a meeting.')) +

      group('Overdue', overdue) +
      group('Today', todayList) +
      group('Upcoming', later) +
      (done.length
        ? '<div class="act-group">Done · last ' + Math.min(done.length, opts.doneLimit || 8) + '</div>' +
          done.slice(0, opts.doneLimit || 8).map(item).join('') +
          (done.length > (opts.doneLimit || 8)
            ? '<div class="rel-empty">' + (done.length - (opts.doneLimit || 8)) + ' older, hidden.</div>' : '')
        : '') +
      '</div>';

    function group(label, list) {
      if (!list.length) return '';
      return '<div class="act-group">' + U.esc(label) + ' · ' + list.length + '</div>' +
        list.map(item).join('');
    }
  }

  function item(t) {
    var st = S.taskState(t);
    var kind = S.taskKind(t.kind);
    var isDone = S.isTaskDone(t);
    var p = S.priority(t.priority);
    return '<div class="act-item' + (isDone ? ' is-done' : '') + '">' +
      '<span class="act-check' + (isDone ? ' on' : '') + '" data-toggle="' + U.esc(t.id) + '" ' +
        'title="' + (isDone ? 'Reopen' : 'Mark complete') + '"></span>' +
      '<div class="act-body">' +
        '<div class="act-subject">' + U.esc(t.subject || '(no subject)') + '</div>' +
        '<div class="act-meta">' +
          U.badge(kind.label, kind.tone) +
          (isDone
            ? '<span>' + U.esc(t.completedAt ? U.fmtWhen(t.completedAt) : 'done') + '</span>'
            : U.badge(st.label, st.tone)) +
          (t.dueDate && !isDone ? '<span>' + U.esc(U.fmtDateShort(t.dueDate)) + '</span>' : '') +
          (t.startTime ? '<span>' + U.esc(t.startTime) + (t.endTime ? '–' + U.esc(t.endTime) : '') + '</span>' : '') +
          (t.priority && t.priority !== 'normal' && !isDone ? U.badge(p.label, p.tone) : '') +
          '<span class="split">' + U.avatar(t.assigneeId, 'sm') +
            '<span>' + U.esc(S.user(t.assigneeId).name.split(' ')[0]) + '</span></span>' +
        '</div>' +
        (t.description ? '<div class="act-note">' + U.esc(t.description) + '</div>' : '') +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" data-editact="' + U.esc(t.id) + '">Edit</button>' +
      '</div>';
  }

  /* Wire the panel. `rerender` is called after any change so the host
     record page can repaint itself however it likes. */
  function bind(container, entityType, entityId, rerender) {
    container.querySelectorAll('[data-newact]').forEach(function (b) {
      b.onclick = function () {
        openForm({ kind: b.dataset.newact, entityType: entityType, entityId: entityId }, rerender);
      };
    });
    container.querySelectorAll('[data-toggle]').forEach(function (n) {
      n.onclick = function () {
        var t = S.find('tasks', n.dataset.toggle);
        S.completeTask(t.id, !S.isTaskDone(t));
        U.toast(S.isTaskDone(S.find('tasks', t.id)) ? 'Marked complete.' : 'Reopened.', 'ok');
        rerender();
      };
    });
    container.querySelectorAll('[data-editact]').forEach(function (b) {
      b.onclick = function () { openForm(S.find('tasks', b.dataset.editact), rerender); };
    });
  }

  /* ── create / edit ───────────────────────────────────────────── */
  function openForm(rec, done) {
    var isNew = !rec.id;
    var kind = S.taskKind(rec.kind);
    var isEvent = kind.id === 'event';
    var isCall = kind.id === 'call';

    U.modal({
      title: isNew ? kind.verb : 'Edit ' + kind.label.toLowerCase(),
      wide: true,
      okText: isNew ? (isCall ? 'Log it' : 'Save') : 'Save Changes',
      body: '<div class="form-grid">' +
        '<div class="field span-2"><label>Subject *</label>' +
          '<input class="input" name="subject" value="' + U.esc(rec.subject || '') + '" ' +
            'placeholder="' + U.esc(isCall ? 'Called Dan about the video package'
              : isEvent ? 'Discovery call' : 'Send the revised proposal') + '"></div>' +

        U.field(isCall ? 'Call Date' : isEvent ? 'Date' : 'Due Date',
          '<input class="input" type="date" name="dueDate" value="' +
            U.esc(rec.dueDate || S.today()) + '">') +
        U.field('Assigned To',
          '<select class="input" name="assigneeId">' +
            U.options(S.activeUsers(), rec.assigneeId || S.me().id, 'id', 'name') + '</select>') +

        (isEvent
          ? U.field('Start Time', '<input class="input" type="time" name="startTime" value="' + U.esc(rec.startTime || '') + '">') +
            U.field('End Time', '<input class="input" type="time" name="endTime" value="' + U.esc(rec.endTime || '') + '">')
          : U.field('Priority',
              '<select class="input" name="priority">' + U.options(S.PRIORITIES, rec.priority || 'normal') + '</select>') +
            (isNew && isCall
              ? U.field('Outcome',
                  '<div class="hint" style="padding-top:8px">A logged call is recorded as already done — ' +
                  'it describes something that happened.</div>')
              : U.field('Status',
                  '<select class="input" name="status">' +
                    '<option value="open"' + (rec.status !== 'completed' ? ' selected' : '') + '>Open</option>' +
                    '<option value="completed"' + (rec.status === 'completed' ? ' selected' : '') + '>Completed</option>' +
                  '</select>'))) +

        '<div class="field span-2"><label>' + (isCall ? 'What was said' : 'Details') + '</label>' +
          '<textarea class="input" name="description" placeholder="' +
            U.esc(isCall ? 'What they said, what you promised, what happens next.' : 'Anything the team should know.') +
            '">' + U.esc(rec.description || '') + '</textarea></div>' +

        (isNew ? '' :
          '<div class="field span-2"><div class="hint">Attached to ' +
            U.esc(S.entityLabel(rec.entityType, rec.entityId)) + '.</div></div>') +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.subject) { U.toast('Give it a subject.', 'err'); return false; }

        if (isNew) {
          S.addTask({
            kind: kind.id, subject: v.subject, description: v.description,
            dueDate: v.dueDate, startTime: v.startTime, endTime: v.endTime,
            priority: v.priority || 'normal', status: v.status,
            assigneeId: v.assigneeId,
            entityType: rec.entityType, entityId: rec.entityId
          });
          U.toast(isCall ? 'Call logged.' : kind.label + ' saved.', 'ok');
        } else {
          var patch = {
            subject: v.subject, description: v.description, dueDate: v.dueDate,
            assigneeId: v.assigneeId
          };
          if (v.startTime !== undefined) patch.startTime = v.startTime;
          if (v.endTime !== undefined) patch.endTime = v.endTime;
          if (v.priority) patch.priority = v.priority;
          if (v.status) {
            patch.status = v.status;
            /* Keep completedAt honest — a task flipped back to open that
               kept its completion timestamp would sort as done forever. */
            patch.completedAt = v.status === 'completed' ? (rec.completedAt || S.nowISO()) : '';
          }
          S.update('tasks', rec.id, patch, v.subject);
          U.toast('Saved.', 'ok');
        }
        done();
      },
      extraFooter: isNew ? '' :
        '<button class="btn btn-ghost btn-sm" id="delAct" style="margin-right:auto">Delete</button>',
      onMount: function (box) {
        var d = box.querySelector('#delAct');
        if (d) d.onclick = function () {
          S.remove('tasks', rec.id);
          U.closeModal();
          U.toast('Deleted.');
          done();
        };
      }
    });
  }

  /* ── standalone list ─────────────────────────────────────────── */
  var st = { scope: 'mine', kind: '', show: 'open', q: '', sortKey: 'due', sortDir: 1 };

  root.Views.activities = function (el) {
    var me = S.me();
    var rows = S.all('tasks').filter(function (t) {
      if (st.scope === 'mine' && t.assigneeId !== me.id) return false;
      if (st.kind && t.kind !== st.kind) return false;
      if (st.show === 'open' && S.isTaskDone(t)) return false;
      if (st.show === 'done' && !S.isTaskDone(t)) return false;
      if (st.q) {
        var hay = [t.subject, t.description, S.entityLabel(t.entityType, t.entityId)].join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var mineOpen = S.openTasks({ assigneeId: me.id });
    var overdue = mineOpen.filter(function (t) { return S.taskState(t).key === 'overdue'; });
    var dueToday = mineOpen.filter(function (t) { return S.taskState(t).key === 'today'; });
    var allOpen = S.openTasks();

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Activities</h1>' +
          '<div class="page-sub">Tasks, calls and meetings across every record.</div></div>' +
        '<div class="page-actions">' +
          S.TASK_KINDS.map(function (k) {
            return '<button class="btn btn-sm" data-new="' + U.esc(k.id) + '">' + U.esc(k.verb) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('My Overdue', String(overdue.length), overdue.length ? 'needs clearing' : 'nothing late',
            overdue.length ? 'danger' : 'ok') +
        kpi('My Today', String(dueToday.length), 'due today', 'accent') +
        kpi('My Open', String(mineOpen.length), 'assigned to me', '') +
        kpi('Team Open', String(allOpen.length), 'across everyone', '') +
      '</div>' +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search subject, notes, record…" value="' + U.esc(st.q) + '">' +
        '<div class="seg" id="scopeSeg">' +
          '<button data-scope="mine" class="' + (st.scope === 'mine' ? 'on' : '') + '">Mine</button>' +
          '<button data-scope="all" class="' + (st.scope === 'all' ? 'on' : '') + '">Everyone</button>' +
        '</div>' +
        '<div class="seg" id="showSeg">' +
          '<button data-show="open" class="' + (st.show === 'open' ? 'on' : '') + '">Open</button>' +
          '<button data-show="done" class="' + (st.show === 'done' ? 'on' : '') + '">Done</button>' +
          '<button data-show="" class="' + (st.show === '' ? 'on' : '') + '">All</button>' +
        '</div>' +
        '<select class="input" id="fkind"><option value="">All types</option>' +
          U.options(S.TASK_KINDS, st.kind) + '</select>' +
        '<button class="btn btn-ghost btn-sm" id="clear">Clear</button>' +
      '</div>' +
      U.table(cols(), rows, {
        rowLink: true, sortKey: st.sortKey, sortDir: st.sortDir,
        emptyHTML: U.empty('Nothing here', 'No activities match these filters.')
      }) + '</div>';

    el.querySelectorAll('[data-new]').forEach(function (b) {
      b.onclick = function () {
        /* Created from the list, an activity has nothing to attach to
           yet — ask which record it belongs to. */
        pickEntity(function (target) {
          openForm({ kind: b.dataset.new, entityType: target.type, entityId: target.id }, root.render);
        });
      };
    });
    el.querySelectorAll('#scopeSeg button').forEach(function (b) {
      b.onclick = function () { st.scope = b.dataset.scope; root.render(); };
    });
    el.querySelectorAll('#showSeg button').forEach(function (b) {
      b.onclick = function () { st.show = b.dataset.show; root.render(); };
    });
    el.querySelector('#fkind').onchange = function () { st.kind = this.value; root.render(); };
    el.querySelector('#clear').onclick = function () {
      st.q = ''; st.kind = ''; st.show = 'open'; st.scope = 'mine'; root.render();
    };
    var t;
    el.querySelector('#fq').oninput = function () {
      var v = this.value;
      clearTimeout(t);
      t = setTimeout(function () { st.q = v; root.render(); }, 220);
    };

    el.querySelectorAll('[data-toggle]').forEach(function (n) {
      n.onclick = function (e) {
        e.stopPropagation();
        var task = S.find('tasks', n.dataset.toggle);
        S.completeTask(task.id, !S.isTaskDone(task));
        root.render();
      };
    });

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { openForm(S.find('tasks', id), root.render); }
    });
  };

  function cols() {
    return [
      { key: 'done', label: '', width: '34px',
        render: function (t) {
          return '<span class="act-check' + (S.isTaskDone(t) ? ' on' : '') +
            '" data-toggle="' + U.esc(t.id) + '"></span>';
        } },
      { key: 'subject', label: 'Subject', sort: function (t) { return t.subject; },
        render: function (t) {
          return '<div><span class="link">' + U.esc(t.subject || '(no subject)') + '</span>' +
            (t.description
              ? '<div class="muted" style="font-size:11.5px">' +
                U.esc(t.description.slice(0, 70)) + (t.description.length > 70 ? '…' : '') + '</div>'
              : '') + '</div>';
        } },
      { key: 'kind', label: 'Type', sort: function (t) { return t.kind; },
        render: function (t) { var k = S.taskKind(t.kind); return U.badge(k.label, k.tone); } },
      { key: 'related', label: 'Related To', sort: function (t) { return S.entityLabel(t.entityType, t.entityId); },
        render: function (t) {
          if (!t.entityId) return '<span class="muted">—</span>';
          return '<a class="link" href="' + U.esc(S.entityHref(t.entityType, t.entityId)) + '">' +
            U.esc(S.entityLabel(t.entityType, t.entityId)) + '</a>' +
            '<div class="muted" style="font-size:11px">' + U.esc(objectLabel(t.entityType)) + '</div>';
        } },
      { key: 'due', label: 'Due', sort: function (t) {
          var s = S.taskState(t);
          return s.rank * 1e9 + (t.dueDate ? Number(t.dueDate.replace(/-/g, '')) : 0);
        },
        render: function (t) {
          var s = S.taskState(t);
          if (S.isTaskDone(t)) return '<span class="muted">' + U.esc(U.fmtDateShort(t.dueDate)) + '</span>';
          return U.badge(s.label, s.tone) +
            (t.dueDate ? '<div class="muted" style="font-size:11px;margin-top:3px">' +
              U.fmtDateShort(t.dueDate) + (t.startTime ? ' ' + U.esc(t.startTime) : '') + '</div>' : '');
        } },
      { key: 'assignee', label: 'Assigned To', sort: function (t) { return S.user(t.assigneeId).name; },
        render: function (t) { return U.userCell(t.assigneeId); } }
    ];
  }

  function objectLabel(type) {
    return type === 'customer' ? 'Account'
      : type === 'opportunity' ? 'Opportunity'
      : type === 'contact' ? 'Contact'
      : type === 'lead' ? 'Lead'
      : type === 'vendor' ? 'Vendor'
      : type === 'workorder' ? 'Work Order' : '—';
  }

  /* Which record does this belong to? Ordered by what an activity is
     usually about: the deal first, then the company. */
  function pickEntity(done) {
    var groups = [
      { type: 'opportunity', label: 'Opportunity', list: S.openOpportunities(), name: function (o) { return o.name; } },
      { type: 'customer',    label: 'Account',     list: S.accounts(),          name: function (a) { return a.name; } },
      { type: 'contact',     label: 'Contact',     list: S.all('contacts'),     name: function (c) { return S.contactName(c) + ' · ' + S.accountName(c.accountId); } },
      { type: 'lead',        label: 'Lead',        list: S.openLeads(),         name: function (l) { return l.name; } },
      { type: 'vendor',      label: 'Vendor',      list: S.all('vendors'),      name: function (v) { return v.name; } }
    ].filter(function (g) { return g.list.length; });

    if (!groups.length) {
      U.toast('Create an account or a lead first — an activity has to belong to something.', 'err');
      return;
    }

    U.modal({
      title: 'What is this about?',
      okText: 'Continue',
      body: U.field('Related record',
        '<select class="input" name="target">' +
          groups.map(function (g) {
            return '<optgroup label="' + U.esc(g.label) + '">' +
              g.list.map(function (r) {
                return '<option value="' + U.esc(g.type + ':' + r.id) + '">' + U.esc(g.name(r)) + '</option>';
              }).join('') + '</optgroup>';
          }).join('') +
        '</select>', true),
      onOk: function (box) {
        var v = U.values(box).target || '';
        var i = v.indexOf(':');
        if (i < 0) return false;
        setTimeout(function () { done({ type: v.slice(0, i), id: v.slice(i + 1) }); }, 0);
      }
    });
  }

  function kpi(label, value, foot, mod) {
    return '<div class="kpi ' + mod + '"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + U.esc(value) + '</div><div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }

  /* Created from anywhere that has no record in hand: ask what it is
     about first, then open the composer. */
  function quickCreate(kind, done) {
    pickEntity(function (target) {
      openForm({ kind: kind, entityType: target.type, entityId: target.id }, done);
    });
  }

  root.Activities = {
    panel: panel, bind: bind, open: openForm,
    quickCreate: quickCreate, objectLabel: objectLabel
  };
})(window);
