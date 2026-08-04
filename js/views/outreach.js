/* ═══════════════════════════════════════════════════════════════════
   outreach.js — the daily Nextdoor / Facebook group tracker.

   Three jobs, in order of how much they matter:

     1. Make today obvious and one click to log. A tracker that takes
        effort to update stops being updated by Wednesday.
     2. Say where to post next, without suggesting a group that is still
        inside its posting cooldown — most groups remove you for that.
     3. Show which communities actually produce leads and revenue, so
        the time goes where it pays.

   Without (3) this is a chore checklist. The whole point of putting it
   in the CRM rather than a notes app is that a lead logged from a touch
   stays linked all the way through to a won deal.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var st = { tab: 'today', window: '30', channel: '', user: '', q: '' };

  root.Views.outreach = function (el, params) {
    var me = S.me();
    var streak = S.outreachStreak(me.id);
    var todayList = S.outreachOn(S.today(), me.id);
    var teamToday = S.outreachOn(S.today());
    var stats = S.outreachStats({ days: 30 });

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Prospecting</div><h1 class="page-title">Daily Outreach</h1>' +
          '<div class="page-sub">' + subLine(streak) + '</div></div>' +
        '<div class="page-actions">' +
          (S.isAdmin() ? '<button class="btn btn-sm" id="setGoal">Daily target</button>' : '') +
          '<button class="btn btn-sm" id="newGroup">+ Group</button>' +
          '<button class="btn btn-primary" id="logBtn">Log Outreach</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('Today', streak.todayCount + (streak.hasGoal ? ' / ' + streak.goal : ''),
            streak.hasGoal
              ? (streak.todayMet ? 'target met' : streak.remaining + ' to go')
              : 'touches logged',
            streak.todayMet ? 'ok' : 'accent') +
        kpi('Streak', streak.days + (streak.days === 1 ? ' day' : ' days'),
            streak.days ? (streak.todayMet ? 'including today' : 'today still open') : 'start one today',
            streak.days ? 'ok' : '') +
        kpi('Replies · 30d', String(stats.responses),
            stats.touches + ' touches · ' + stats.yield + '% became leads', '') +
        kpi('Won from outreach', S.money(stats.wonValue),
            stats.leads + ' leads · ' + stats.converted + ' converted', 'ok') +
      '</div>' +

      '<div class="card" style="margin-bottom:14px"><div class="toolbar">' +
        '<div class="seg" id="tabSeg">' +
          seg('today', 'Today') + seg('groups', 'Where to Post') +
          seg('history', 'History') + seg('performance', 'Performance') +
        '</div>' +
        '<span class="hint" style="margin-left:auto">' +
          teamToday.length + ' touch' + (teamToday.length === 1 ? '' : 'es') + ' from the team today</span>' +
      '</div>' +
      '<div id="obody"></div></div>';

    var body = el.querySelector('#obody');
    paint();

    el.querySelectorAll('#tabSeg button').forEach(function (b) {
      b.onclick = function () { st.tab = b.dataset.seg; paint(); };
    });
    el.querySelector('#logBtn').onclick = function () { openLog({}, root.render); };
    el.querySelector('#newGroup').onclick = function () { openGroup(null, root.render); };
    var gb = el.querySelector('#setGoal');
    if (gb) gb.onclick = function () { openGoal(root.render); };

    function seg(id, label) {
      return '<button data-seg="' + id + '" class="' + (st.tab === id ? 'on' : '') + '">' + label + '</button>';
    }

    function paint() {
      el.querySelectorAll('#tabSeg button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.seg === st.tab);
      });
      if (st.tab === 'groups') body.innerHTML = groupsPanel();
      else if (st.tab === 'history') body.innerHTML = historyPanel();
      else if (st.tab === 'performance') body.innerHTML = performancePanel();
      else body.innerHTML = todayPanel(streak, todayList);
      bind();
    }

    function bind() {
      body.querySelectorAll('[data-log]').forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          openLog({ groupId: b.dataset.log }, root.render);
        };
      });
      body.querySelectorAll('[data-editgroup]').forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          openGroup(S.find('outreachGroups', b.dataset.editgroup), root.render);
        };
      });
      body.querySelectorAll('[data-editor]').forEach(function (b) {
        b.onclick = function (e) { e.stopPropagation(); openLog(S.find('outreach', b.dataset.editor), root.render); };
      });
      body.querySelectorAll('[data-makelead]').forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          openLeadFromOutreach(S.find('outreach', b.dataset.makelead), root.render);
        };
      });
      body.querySelectorAll('[data-goto]').forEach(function (n) {
        n.onclick = function () { location.hash = n.dataset.goto; };
      });
      var hq = body.querySelector('#hq');
      if (hq) {
        var t;
        hq.oninput = function () {
          var v = this.value;
          clearTimeout(t);
          t = setTimeout(function () { st.q = v; paint(); }, 220);
        };
      }
      [['#hwin', 'window'], ['#hchan', 'channel'], ['#huser', 'user']].forEach(function (p) {
        var n = body.querySelector(p[0]);
        if (n) n.onchange = function () { st[p[1]] = this.value; paint(); };
      });
    }
  };

  function subLine(s) {
    if (!s.hasGoal) {
      return s.todayCount
        ? s.todayCount + ' logged today · ' + s.days + '-day streak'
        : 'Nothing logged today. Set a daily target to hold yourself to a number.';
    }
    if (s.todayMet) return 'Today is done — ' + s.todayCount + ' of ' + s.goal + '. ' + s.days + '-day streak.';
    return s.remaining + ' more to hit today\'s target of ' + s.goal +
      (s.days ? ' · ' + s.days + '-day streak on the line' : '');
  }

  /* ── Today ───────────────────────────────────────────────────── */
  function todayPanel(streak, list) {
    var pct = streak.hasGoal ? Math.min(100, Math.round((streak.todayCount / streak.goal) * 100)) : 0;
    var due = S.groupsDue().slice(0, 4);

    return '<div class="card-body">' +
      (streak.hasGoal
        ? '<div class="split" style="align-items:baseline;gap:10px">' +
            '<span style="font-family:var(--font-display);font-size:30px;font-weight:700;line-height:1.1;color:' +
              (streak.todayMet ? 'var(--ok)' : 'var(--orange)') + '">' + streak.todayCount + '</span>' +
            '<span class="muted" style="font-size:14px">of ' + streak.goal + ' today</span>' +
            (streak.days ? '<span class="badge b-orange" style="margin-left:auto">' +
              streak.days + '-day streak</span>' : '') +
          '</div>' +
          '<div class="bar" style="margin-top:12px;height:9px"><i style="width:' + pct + '%' +
            (streak.todayMet ? ';background:linear-gradient(90deg,var(--ok),#5fd99a)' : '') + '"></i></div>'
        : '<div class="hint">No daily target set. ' +
          (S.isAdmin() ? 'Use “Daily target” above to pick a number worth holding yourself to.'
                       : 'An admin can set one from this screen.') + '</div>') +
      '</div>' +

      (due.length
        ? '<div class="act-group">Suggested next · not in cooldown</div>' +
          due.map(function (g) { return groupRow(g, true); }).join('')
        : '') +

      '<div class="act-group">Logged today · ' + list.length + '</div>' +
      (list.length ? list.map(touchRow).join('')
        : '<div class="rel-empty">Nothing yet today. Pick a group above and log your first touch.</div>');
  }

  function groupRow(g, compact) {
    var state = S.groupState(g);
    var ch = S.outreachChannel(g.channel);
    var cooling = state.key === 'cooling';
    return '<div class="rel-row">' +
      '<div class="rel-row-main">' +
        '<div class="rel-row-title">' + U.esc(g.name) + '</div>' +
        '<div class="rel-row-sub">' + U.badge(ch.label, ch.tone) +
          U.badge(state.label, state.tone) +
          (g.area ? '<span>' + U.esc(g.area) + '</span>' : '') +
          (g.memberCount ? '<span>' + Number(g.memberCount).toLocaleString('en-US') + ' members</span>' : '') +
          (!compact && g.rules ? '<span style="color:var(--warn,#E8B931)">⚠ ' + U.esc(g.rules) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (cooling
        ? '<span class="muted" style="font-size:11.5px">every ' + (Number(g.cadenceDays) || 7) + 'd</span>'
        : '<button class="btn btn-sm" data-log="' + U.esc(g.id) + '">Log</button>') +
      (compact ? '' : '<button class="btn btn-ghost btn-sm" data-editgroup="' + U.esc(g.id) + '">Edit</button>') +
      '</div>';
  }

  function touchRow(o) {
    var g = o.groupId ? S.outreachGroup(o.groupId) : null;
    var kind = S.outreachKind(o.kind);
    var ch = S.outreachChannel(o.channel);
    var leads = S.leadsFromOutreach(o.id);
    return '<div class="act-item">' +
      '<span class="act-dot" style="margin-top:6px;background:' + toneColor(kind.tone) + '"></span>' +
      '<div class="act-body">' +
        '<div class="act-subject">' + U.esc(g ? g.name : ch.label) + '</div>' +
        '<div class="act-meta">' +
          U.badge(kind.label, kind.tone) +
          U.badge(ch.label, ch.tone) +
          (o.responses ? '<span>' + o.responses + ' repl' + (o.responses === 1 ? 'y' : 'ies') + '</span>'
                       : '<span class="muted">no replies yet</span>') +
          '<span class="split">' + U.avatar(o.userId, 'sm') +
            '<span>' + U.esc(S.user(o.userId).name.split(' ')[0]) + '</span></span>' +
          (o.url ? '<a class="link" href="' + U.esc(href(o.url)) + '" target="_blank" rel="noopener">open thread</a>' : '') +
        '</div>' +
        (o.summary ? '<div class="act-note">' + U.esc(o.summary) + '</div>' : '') +
        (leads.length
          ? '<div class="act-meta" style="margin-top:6px">' +
            leads.map(function (l) {
              return '<a class="chip" href="#/leads/' + U.esc(l.id) + '">→ ' + U.esc(l.name) +
                (l.convertedCustomerId ? ' · converted' : '') + '</a>';
            }).join('') + '</div>'
          : '') +
      '</div>' +
      (leads.length ? '' : '<button class="btn btn-sm" data-makelead="' + U.esc(o.id) + '">+ Lead</button>') +
      '<button class="btn btn-ghost btn-sm" data-editor="' + U.esc(o.id) + '">Edit</button>' +
      '</div>';
  }

  function toneColor(t) {
    return { 'b-grey': '#9aa3af', 'b-orange': '#FA7700', 'b-blue': '#4C8DFF', 'b-green': '#2FBF71',
      'b-red': '#E5484D', 'b-yellow': '#E8B931', 'b-violet': '#8B7CF6' }[t] || '#9aa3af';
  }
  function href(u) { return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

  /* ── Where to post ───────────────────────────────────────────── */
  function groupsPanel() {
    var groups = S.activeGroups().slice().sort(function (a, b) {
      var sa = S.groupState(a), sb = S.groupState(b);
      return sa.rank - sb.rank || (sb.daysSince || 9999) - (sa.daysSince || 9999);
    });
    var inactive = S.all('outreachGroups').filter(function (g) { return g.active === false; });

    if (!groups.length && !inactive.length) {
      return U.empty('No groups yet',
        'Add the Nextdoor neighbourhoods and Facebook groups you post in, and this becomes your daily list.',
        '<button class="btn btn-primary btn-sm" data-editgroup="">+ Add a group</button>');
    }

    return '<div class="act-group">Ready to post · ' +
        groups.filter(function (g) { return S.groupState(g).key !== 'cooling'; }).length + '</div>' +
      groups.filter(function (g) { return S.groupState(g).key !== 'cooling'; })
        .map(function (g) { return groupRow(g, false); }).join('') +
      (groups.some(function (g) { return S.groupState(g).key === 'cooling'; })
        ? '<div class="act-group">Cooling off — posting again too soon gets you removed</div>' +
          groups.filter(function (g) { return S.groupState(g).key === 'cooling'; })
            .map(function (g) { return groupRow(g, false); }).join('')
        : '') +
      (inactive.length
        ? '<div class="act-group">Inactive · ' + inactive.length + '</div>' +
          inactive.map(function (g) {
            return '<div class="rel-row"><div class="rel-row-main">' +
              '<div class="rel-row-title muted">' + U.esc(g.name) + '</div></div>' +
              '<button class="btn btn-ghost btn-sm" data-editgroup="' + U.esc(g.id) + '">Edit</button></div>';
          }).join('')
        : '');
  }

  /* ── History ─────────────────────────────────────────────────── */
  function historyPanel() {
    var since = st.window === 'all' ? '' : S.shift(-Number(st.window));
    var rows = S.all('outreach').filter(function (o) {
      if (since && o.date < since) return false;
      if (st.channel && o.channel !== st.channel) return false;
      if (st.user && o.userId !== st.user) return false;
      if (st.q) {
        var hay = [o.summary, S.outreachGroup(o.groupId).name, S.outreachKind(o.kind).label].join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date)) ||
             String(b.createdAt).localeCompare(String(a.createdAt));
    });

    /* Grouped by day so gaps in the habit are visible rather than
       averaged away by a flat list. */
    var byDay = [];
    var seen = {};
    rows.forEach(function (o) {
      if (!seen[o.date]) { seen[o.date] = []; byDay.push(o.date); }
      seen[o.date].push(o);
    });

    return '<div class="toolbar">' +
        '<input class="input" id="hq" placeholder="Search what you posted…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="hwin">' +
          winOpt('7', 'Last 7 days') + winOpt('30', 'Last 30 days') +
          winOpt('90', 'Last 90 days') + winOpt('all', 'All time') +
        '</select>' +
        '<select class="input" id="hchan"><option value="">All channels</option>' +
          U.options(S.OUTREACH_CHANNELS, st.channel) + '</select>' +
        '<select class="input" id="huser"><option value="">Everyone</option>' +
          U.options(S.activeUsers(), st.user, 'id', 'name') + '</select>' +
        '<span class="hint" style="margin-left:auto">' + rows.length + ' touches over ' +
          byDay.length + ' day' + (byDay.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      (byDay.length
        ? byDay.map(function (d) {
            return '<div class="act-group">' + U.esc(U.fmtDate(d)) +
              (d === S.today() ? ' · today' : '') + ' · ' + seen[d].length + '</div>' +
              seen[d].map(touchRow).join('');
          }).join('')
        : U.empty('Nothing logged', 'No outreach matches these filters.'));

    function winOpt(v, label) {
      return '<option value="' + v + '"' + (st.window === v ? ' selected' : '') + '>' + label + '</option>';
    }
  }

  /* ── Performance ─────────────────────────────────────────────── */
  function performancePanel() {
    var groups = S.all('outreachGroups');
    if (!groups.length) return U.empty('Nothing to measure yet', 'Add a group and log some outreach first.');

    var rows = groups.map(function (g) {
      var s = S.outreachStats({ groupId: g.id });
      return { g: g, s: s };
    }).sort(function (a, b) {
      return b.s.wonValue - a.s.wonValue || b.s.leads - a.s.leads || b.s.touches - a.s.touches;
    });

    var chRows = S.OUTREACH_CHANNELS.map(function (c) {
      return { c: c, s: S.outreachStats({ channel: c.id }) };
    }).filter(function (r) { return r.s.touches; });

    return '<div class="card-body"><div class="hint">Counted over all time. ' +
        '“Yield” is leads per hundred touches — the number that says whether a group ' +
        'is worth the time it costs you.</div></div>' +

      U.table([
        { key: 'name', label: 'Group', render: function (r) {
            var ch = S.outreachChannel(r.g.channel);
            return '<div><span class="strong">' + U.esc(r.g.name) + '</span>' +
              '<div style="margin-top:3px">' + U.badge(ch.label, ch.tone) +
              (r.g.active === false ? ' ' + U.badge('Inactive', 'b-grey') : '') + '</div></div>';
          } },
        { key: 'touches', label: 'Touches', cls: 'right', render: function (r) {
            return '<span class="mono">' + r.s.touches + '</span>';
          } },
        { key: 'responses', label: 'Replies', cls: 'right', render: function (r) {
            return '<span class="mono">' + r.s.responses + '</span>';
          } },
        { key: 'leads', label: 'Leads', cls: 'right', render: function (r) {
            return r.s.leads ? '<span class="mono strong">' + r.s.leads + '</span>'
                             : '<span class="muted">—</span>';
          } },
        { key: 'yield', label: 'Yield', cls: 'right', render: function (r) {
            if (!r.s.touches) return '<span class="muted">—</span>';
            return '<span class="mono">' + r.s.yield + '%</span>';
          } },
        { key: 'won', label: 'Won', cls: 'right', render: function (r) {
            return r.s.wonValue
              ? '<span class="mono strong" style="color:var(--ok)">' + S.money(r.s.wonValue) + '</span>'
              : '<span class="muted">—</span>';
          } }
      ], rows, { emptyHTML: U.empty('No groups', '') }) +

      '<div class="act-group">By channel</div>' +
      (chRows.length
        ? U.table([
            { key: 'c', label: 'Channel', render: function (r) { return U.badge(r.c.label, r.c.tone); } },
            { key: 't', label: 'Touches', cls: 'right', render: function (r) { return '<span class="mono">' + r.s.touches + '</span>'; } },
            { key: 'r', label: 'Replies', cls: 'right', render: function (r) { return '<span class="mono">' + r.s.responses + '</span>'; } },
            { key: 'l', label: 'Leads', cls: 'right', render: function (r) { return '<span class="mono">' + r.s.leads + '</span>'; } },
            { key: 'w', label: 'Won', cls: 'right', render: function (r) { return '<span class="mono">' + S.money(r.s.wonValue) + '</span>'; } }
          ], chRows, {})
        : '<div class="rel-empty">Nothing logged yet.</div>');
  }

  function kpi(label, value, foot, mod) {
    return '<div class="kpi ' + mod + '"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + U.esc(value) + '</div><div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }

  /* ── log a touch ─────────────────────────────────────────────── */
  function openLog(rec, done) {
    var isNew = !rec.id;
    var groups = S.activeGroups();
    if (!groups.length && isNew) {
      U.toast('Add a group first — outreach has to happen somewhere.', 'err');
      return openGroup(null, done);
    }
    var g = rec.groupId ? S.find('outreachGroups', rec.groupId) : null;

    U.modal({
      title: isNew ? 'Log outreach' : 'Edit outreach',
      wide: true,
      okText: isNew ? 'Log it' : 'Save',
      body: (g && g.rules
        ? '<div class="card" style="margin-bottom:14px;border-color:rgba(232,185,49,.45)">' +
          '<div class="card-body split">' + U.badge('Group rules', 'b-yellow') +
          '<span style="font-size:12.5px">' + U.esc(g.rules) + '</span></div></div>'
        : '') +
        '<div class="form-grid">' +
        U.field('Group',
          '<select class="input" name="groupId"><option value="">— no specific group —</option>' +
            groups.map(function (x) {
              var state = S.groupState(x);
              return '<option value="' + U.esc(x.id) + '"' + (x.id === rec.groupId ? ' selected' : '') + '>' +
                U.esc(x.name) + ' · ' + U.esc(S.outreachChannel(x.channel).label) +
                (state.key === 'cooling' ? ' (cooling ' + state.wait + 'd)' : '') + '</option>';
            }).join('') + '</select>') +
        U.field('What kind',
          '<select class="input" name="kind">' + U.options(S.OUTREACH_KINDS, rec.kind || 'recommendation') + '</select>' +
          '<div class="hint">' + U.esc(S.outreachKind(rec.kind || 'recommendation').hint) + '</div>') +
        U.field('Date', '<input class="input" type="date" name="date" value="' + U.esc(rec.date || S.today()) + '">') +
        U.field('Replies so far',
          '<input class="input" type="number" min="0" step="1" name="responses" value="' + U.esc(rec.responses || 0) + '">' +
          '<div class="hint">Update this later as the thread moves.</div>') +
        '<div class="field span-2"><label>What you posted</label>' +
          '<textarea class="input" name="summary" placeholder="Replied to “anyone know a good web designer in Mesa?” — sent the portfolio.">' +
          U.esc(rec.summary || '') + '</textarea></div>' +
        U.field('Link to the thread',
          '<input class="input" name="url" placeholder="facebook.com/groups/…" value="' + U.esc(rec.url || '') + '">', true) +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (isNew) {
          S.logOutreach(v);
          var s = S.outreachStreak(S.me().id);
          U.toast(s.hasGoal && s.todayMet
            ? 'Logged — today\'s target is met. ' + s.days + '-day streak.'
            : 'Logged.' + (s.hasGoal ? ' ' + s.remaining + ' more today.' : ''), 'ok');
        } else {
          v.responses = Number(v.responses) || 0;
          S.update('outreach', rec.id, v, 'outreach');
          U.toast('Saved.', 'ok');
        }
        done();
      },
      extraFooter: isNew ? '' :
        '<button class="btn btn-ghost btn-sm" id="delOr" style="margin-right:auto">Delete</button>',
      onMount: function (box) {
        var kindSel = box.querySelector('[name=kind]');
        var hint = kindSel.parentNode.querySelector('.hint');
        kindSel.onchange = function () { hint.textContent = S.outreachKind(this.value).hint; };
        var d = box.querySelector('#delOr');
        if (d) d.onclick = function () {
          S.remove('outreach', rec.id);
          U.closeModal();
          U.toast('Deleted.');
          done();
        };
      }
    });
  }

  /* ── turn a touch into a lead ────────────────────────────────────
     The link back to the touch is what makes the performance table
     mean anything, so it is set here rather than left to be typed. */
  function openLeadFromOutreach(o, done) {
    var g = o.groupId ? S.outreachGroup(o.groupId) : null;
    var ch = S.outreachChannel(o.channel);

    U.modal({
      title: 'New lead from this outreach',
      wide: true,
      okText: 'Create Lead',
      body: '<p style="margin:0 0 14px;color:var(--text-2);font-size:13px">' +
          'This lead stays linked to the ' + U.esc(ch.label) + ' touch' +
          (g ? ' in <strong>' + U.esc(g.name) + '</strong>' : '') +
          ', so you can see later which groups actually paid off.</p>' +
        '<div class="form-grid">' +
        U.field('Company / Person *', '<input class="input" name="name" required>') +
        U.field('Contact Name', '<input class="input" name="contactName">') +
        U.field('Email', '<input class="input" type="email" name="email">') +
        U.field('Phone', '<input class="input" name="phone">') +
        U.field('Rating', '<select class="input" name="rating">' + U.options(S.LEAD_RATINGS, 'warm') + '</select>') +
        U.field('Estimated Value ($)', '<input class="input" type="number" min="0" step="50" name="estValue" value="0">') +
        U.field('Next Follow-Up',
          '<input class="input" type="date" name="nextFollowUp" value="' + U.esc(S.shift(2)) + '">' +
          '<div class="hint">An open lead with no next touch is how leads go quiet.</div>') +
        U.field('Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), S.me().id, 'id', 'name') + '</select>') +
        '<div class="field span-2"><label>Note</label>' +
          '<textarea class="input" name="note" placeholder="What they asked for.">' +
          U.esc(o.summary || '') + '</textarea></div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Give the lead a name.', 'err'); return false; }
        var note = v.note; delete v.note;
        v.estValue = Number(v.estValue) || 0;
        v.leadStatus = 'new';
        v.outreachId = o.id;
        /* Source records the channel, so leads that came in this way are
           still identifiable if the outreach row is ever deleted. */
        v.source = g ? g.name + ' (' + ch.label + ')' : ch.label;
        v.tags = [];
        v.convertedCustomerId = ''; v.convertedAt = '';
        var lead = S.insert('leads', v, 'l', v.name);
        if (note) S.addNote('lead', lead.id, note);
        U.toast(v.name + ' added to leads.', 'ok');
        done();
      }
    });
  }

  /* ── groups ──────────────────────────────────────────────────── */
  function openGroup(g, done) {
    var isNew = !g;
    g = g || { channel: 'facebook', cadenceDays: 7, active: true, ownerId: S.me().id };

    U.modal({
      title: isNew ? 'New outreach group' : 'Edit ' + g.name,
      wide: true,
      okText: isNew ? 'Add Group' : 'Save Changes',
      body: '<div class="form-grid">' +
        U.field('Name *', '<input class="input" name="name" value="' + U.esc(g.name || '') + '" ' +
          'placeholder="Phoenix Small Business Owners">') +
        U.field('Channel', '<select class="input" name="channel">' + U.options(S.OUTREACH_CHANNELS, g.channel) + '</select>') +
        U.field('Link', '<input class="input" name="url" placeholder="facebook.com/groups/…" value="' + U.esc(g.url || '') + '">') +
        U.field('Area', '<input class="input" name="area" placeholder="Mesa, AZ" value="' + U.esc(g.area || '') + '">') +
        U.field('Members', '<input class="input" type="number" min="0" name="memberCount" value="' + U.esc(g.memberCount || 0) + '">') +
        U.field('Post every (days)',
          '<input class="input" type="number" min="1" max="90" name="cadenceDays" value="' + U.esc(g.cadenceDays || 7) + '">' +
          '<div class="hint">The minimum gap. This group will not be suggested again until it has passed — ' +
          'posting too often is what gets you removed.</div>') +
        U.field('Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), g.ownerId, 'id', 'name') + '</select>') +
        '<div class="field span-2"><label>Group rules</label>' +
          '<input class="input" name="rules" value="' + U.esc(g.rules || '') + '" ' +
            'placeholder="Promo posts Fridays only. One per week.">' +
          '<div class="hint">Shown to you every time you log a touch here.</div></div>' +
        '<div class="field span-2"><label>Notes</label>' +
          '<textarea class="input" name="notes">' + U.esc(g.notes || '') + '</textarea></div>' +
        '<div class="field span-2"><label class="check" style="width:fit-content">' +
          '<input type="checkbox" name="active"' + (g.active !== false ? ' checked' : '') + '>Active</label>' +
          '<div class="hint">Inactive groups stay in the performance table but drop off the daily list.</div></div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Give the group a name.', 'err'); return false; }
        v.memberCount = Number(v.memberCount) || 0;
        v.cadenceDays = Math.max(1, Number(v.cadenceDays) || 7);
        v.active = Array.isArray(v.active) ? v.active.length > 0 : !!v.active;

        if (isNew) { S.insert('outreachGroups', v, 'og', v.name); U.toast(v.name + ' added.', 'ok'); }
        else { S.update('outreachGroups', g.id, v, v.name); U.toast('Saved.', 'ok'); }
        done();
      }
    });
  }

  /* ── daily target ────────────────────────────────────────────── */
  function openGoal(done) {
    U.modal({
      title: 'Daily outreach target',
      okText: 'Save',
      body: '<div class="form-grid">' +
        U.field('Touches per day',
          '<input class="input" type="number" min="0" max="100" name="goal" value="' + S.outreachGoal() + '">' +
          '<div class="hint">A target you can actually hit every day beats an ambitious one you break in a week. ' +
          'Set 0 to turn the target off — any day with at least one touch will then count.</div>', true) +
      '</div>',
      onOk: function (box) {
        S.setOutreachGoal(U.values(box).goal);
        U.toast('Target set.', 'ok');
        done();
      }
    });
  }

  root.Views.outreach.openLog = openLog;
})(window);
