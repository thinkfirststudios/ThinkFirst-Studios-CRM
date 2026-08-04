/* ═══════════════════════════════════════════════════════════════════
   Opportunities — the deals.

   Many per account, each with its own stage, amount and close date.
   That is the whole reason this object exists: the account's status
   used to double as the stage of its only deal, so a repeat client
   could not start a second one without erasing the first.

   Opportunity amount is the value of a sale. It is NOT recurring
   revenue — that lives on the account's contract — and the two are kept
   apart everywhere, because adding them together is how a $13k signing
   turns into a fictional $13k a month.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.Store, U = root.UI;
  root.Views = root.Views || {};

  var ICON = '<svg viewBox="0 0 24 24" class="ico"><path d="M3 3v18h18M7 15V9M12 18V6M17 13V8"/></svg>';

  var st = { q: '', stage: 'open', owner: '', type: '', account: '', sortKey: 'close', sortDir: 1 };

  /* ── list ────────────────────────────────────────────────────── */
  root.Views.opportunities = function (el, params) {
    if (params.id) return detail(el, params.id);

    var rows = S.all('opportunities').filter(function (o) {
      if (st.stage === 'open' ? !S.oppStage(o.stage).open : (st.stage && o.stage !== st.stage)) return false;
      if (st.owner && o.ownerId !== st.owner) return false;
      if (st.type && o.type !== st.type) return false;
      if (st.account && o.accountId !== st.account) return false;
      if (st.q) {
        var hay = [o.name, o.nextStep, o.description, S.accountName(o.accountId), o.type, o.leadSource]
          .join(' ').toLowerCase();
        if (hay.indexOf(st.q.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var stats = S.oppStats();

    el.innerHTML =
      '<div class="page-head">' +
        '<div><div class="eyebrow">Object</div><h1 class="page-title">Opportunities</h1>' +
          '<div class="page-sub">' + stats.open + ' open · ' + S.money(stats.openValue) + ' in play · ' +
            S.money(stats.weighted) + ' weighted' +
            (stats.slipping ? ' · <span style="color:var(--danger)">' + stats.slipping + ' past their close date</span>' : '') +
          '</div></div>' +
        '<div class="page-actions">' +
          '<a class="btn" href="#/pipeline">Pipeline board</a>' +
          '<button class="btn btn-sm" id="exportCsv">Export CSV</button>' +
          '<button class="btn btn-primary" id="newOpp">+ New Opportunity</button>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-4" style="margin-bottom:14px">' +
        kpi('Open Pipeline', S.money(stats.openValue), stats.open + ' live deals', 'accent') +
        kpi('Weighted Forecast', S.money(stats.weighted), 'amount × stage probability', 'ok') +
        kpi('Won', S.money(stats.wonValue), stats.won + ' closed won', 'ok') +
        kpi('Win Rate', stats.winRate + '%', stats.won + ' won · ' + stats.lost + ' lost',
            stats.winRate >= 50 ? 'ok' : '') +
      '</div>' +

      (stats.slipping ? slipCard() : '') +

      '<div class="card"><div class="toolbar">' +
        '<input class="input" id="fq" placeholder="Search deal, account, next step…" value="' + U.esc(st.q) + '">' +
        '<select class="input" id="fstage">' +
          '<option value="open"' + (st.stage === 'open' ? ' selected' : '') + '>Open deals</option>' +
          '<option value=""' + (st.stage === '' ? ' selected' : '') + '>All deals</option>' +
          S.OPP_STAGES.map(function (x) {
            return '<option value="' + U.esc(x.id) + '"' + (st.stage === x.id ? ' selected' : '') + '>' + U.esc(x.label) + '</option>';
          }).join('') +
        '</select>' +
        '<select class="input" id="faccount"><option value="">All accounts</option>' +
          U.options(S.accounts().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }), st.account, 'id', 'name') + '</select>' +
        '<select class="input" id="ftype"><option value="">All types</option>' +
          S.OPP_TYPES.map(function (t) {
            return '<option value="' + U.esc(t) + '"' + (t === st.type ? ' selected' : '') + '>' + U.esc(t) + '</option>';
          }).join('') + '</select>' +
        '<select class="input" id="fowner"><option value="">All owners</option>' +
          U.options(S.activeUsers(), st.owner, 'id', 'name') + '</select>' +
        '<button class="btn btn-ghost btn-sm" id="clear">Clear</button>' +
      '</div>' +
      U.table(cols(), rows, {
        rowLink: true, sortKey: st.sortKey, sortDir: st.sortDir,
        emptyHTML: U.empty('No opportunities match',
          S.all('opportunities').length ? 'Try clearing the filters.' : 'Deals appear here once you create one or convert a lead.')
      }) + '</div>';

    el.querySelector('#newOpp').onclick = function () { openForm(null, root.render); };
    el.querySelector('#exportCsv').onclick = function () { exportCsv(rows); };
    el.querySelector('#clear').onclick = function () {
      st.q = ''; st.stage = 'open'; st.owner = ''; st.type = ''; st.account = ''; root.render();
    };
    [['#fstage', 'stage'], ['#faccount', 'account'], ['#ftype', 'type'], ['#fowner', 'owner']].forEach(function (p) {
      el.querySelector(p[0]).onchange = function () { st[p[1]] = this.value; root.render(); };
    });
    var t;
    el.querySelector('#fq').oninput = function () {
      var v = this.value;
      clearTimeout(t);
      t = setTimeout(function () { st.q = v; root.render(); }, 220);
    };
    var slip = el.querySelector('#showSlipping');
    if (slip) slip.onclick = function () { st.stage = 'open'; st.sortKey = 'close'; st.sortDir = 1; root.render(); };

    U.bindTable(el, {
      onSort: function (k) { st.sortDir = st.sortKey === k ? -st.sortDir : 1; st.sortKey = k; root.render(); },
      onRow: function (id) { location.hash = '#/opportunities/' + id; }
    });
  };

  /* A close date in the past on a still-open deal is not a forecast,
     it is a date nobody updated. Worth saying out loud. */
  function slipCard() {
    var late = S.openOpportunities().filter(function (o) {
      return o.closeDate && S.daysUntil(o.closeDate) < 0;
    }).sort(function (a, b) { return String(a.closeDate).localeCompare(String(b.closeDate)); });

    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head"><span class="card-title">Past Their Close Date</span>' +
        '<span class="kcol-count">' + late.length + '</span>' +
        '<div class="page-actions"><span class="hint">These are inflating the forecast until someone moves them</span></div></div>' +
      late.slice(0, 5).map(function (o) {
        var stage = S.oppStage(o.stage);
        return '<div class="wo-row">' +
          '<span class="prio-flag" style="background:#E5484D"></span>' +
          '<div class="wo-main"><div class="wo-title">' +
            '<a class="link" href="#/opportunities/' + U.esc(o.id) + '">' + U.esc(o.name) + '</a></div>' +
            '<div class="wo-sub">' + U.badge(stage.label, stage.tone) +
              '<span>' + U.esc(S.accountName(o.accountId)) + '</span>' +
              '<span class="mono">' + S.money(o.amount) + '</span></div></div>' +
          '<div class="wo-side">' + U.badge(Math.abs(S.daysUntil(o.closeDate)) + 'd late', 'b-red') + '</div></div>';
      }).join('') +
      '</div>';
  }

  function cols() {
    return [
      { key: 'name', label: 'Opportunity', sort: function (o) { return o.name; },
        render: function (o) {
          return '<div><span class="link">' + U.esc(o.name) + '</span>' +
            (o.nextStep ? '<div class="muted" style="font-size:11.5px">Next: ' +
              U.esc(o.nextStep.slice(0, 64)) + (o.nextStep.length > 64 ? '…' : '') + '</div>' : '') + '</div>';
        } },
      { key: 'account', label: 'Account', sort: function (o) { return S.accountName(o.accountId); },
        render: function (o) {
          return '<a class="link" href="#/accounts/' + U.esc(o.accountId) + '">' + U.esc(S.accountName(o.accountId)) + '</a>' +
            (o.contactId ? '<div class="muted" style="font-size:11px">' +
              U.esc(S.contactName(S.contact(o.contactId))) + '</div>' : '');
        } },
      { key: 'stage', label: 'Stage', sort: function (o) { return S.oppStage(o.stage).order; },
        render: function (o) {
          var s = S.oppStage(o.stage);
          return U.badge(s.label, s.tone) +
            (s.open ? '<div class="muted mono" style="font-size:11px;margin-top:3px">' + s.probability + '%</div>' : '');
        } },
      { key: 'amount', label: 'Amount', cls: 'right', sort: function (o) { return Number(o.amount) || 0; },
        render: function (o) {
          var s = S.oppStage(o.stage);
          return '<span class="mono strong">' + S.money(o.amount) + '</span>' +
            (s.open && s.probability
              ? '<div class="muted" style="font-size:11px">' +
                S.money((Number(o.amount) || 0) * s.probability / 100) + ' weighted</div>'
              : '');
        } },
      { key: 'close', label: 'Close Date', sort: function (o) {
          var s = S.oppStage(o.stage);
          /* Open deals sort ahead of closed ones whatever their date —
             a list of live deals is what you act on. */
          return (s.open ? 0 : 1e12) + (o.closeDate ? Number(o.closeDate.replace(/-/g, '')) : 99999999);
        },
        render: function (o) {
          var s = S.oppStage(o.stage);
          if (!o.closeDate) return '<span class="muted">—</span>';
          if (!s.open) return '<span class="muted">' + U.fmtDateShort(o.closeDate) + '</span>';
          var t = U.dueTone(o.closeDate);
          return '<div>' + U.fmtDateShort(o.closeDate) + '</div><span class="badge ' +
            (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-top:3px">' + U.esc(t.text) + '</span>';
        } },
      { key: 'type', label: 'Type', sort: function (o) { return o.type || ''; },
        render: function (o) { return o.type ? '<span class="chip">' + U.esc(o.type) + '</span>' : '<span class="muted">—</span>'; } },
      { key: 'owner', label: 'Owner', sort: function (o) { return S.user(o.ownerId).name; },
        render: function (o) { return U.userCell(o.ownerId); } }
    ];
  }

  function kpi(label, value, foot, mod) {
    return '<div class="kpi ' + mod + '"><div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + U.esc(value) + '</div><div class="kpi-foot">' + U.esc(foot) + '</div></div>';
  }

  /* ── detail ──────────────────────────────────────────────────── */
  function detail(el, id) {
    root.RecordView.render(el, {
      coll: 'opportunities', type: 'opportunity', id: id, icon: ICON,
      backHref: '#/opportunities', backLabel: 'Opportunities', objectLabel: 'Opportunity',

      banner: function (o) { return stagePath(o); },

      badges: function (o) {
        var s = S.oppStage(o.stage);
        return U.badge(s.label, s.tone) +
          (o.type ? '<span class="chip">' + U.esc(o.type) + '</span>' : '') +
          '<a class="chip" href="#/accounts/' + U.esc(o.accountId) + '">' + U.esc(S.accountName(o.accountId)) + '</a>' +
          (o.leadSource ? '<span>via ' + U.esc(o.leadSource) + '</span>' : '');
      },

      actions: function (o) {
        return S.oppStage(o.stage).open
          ? '<button class="btn btn-sm" id="markLost">Closed Lost</button>' +
            '<button class="btn btn-primary btn-sm" id="markWon">Closed Won</button>'
          : '<button class="btn btn-sm" id="reopen">Reopen</button>';
      },
      bindActions: function (el_, o, done) {
        var won = el_.querySelector('#markWon');
        if (won) won.onclick = function () { closeWon(o, done); };
        var lost = el_.querySelector('#markLost');
        if (lost) lost.onclick = function () { closeLost(o, done); };
        var re = el_.querySelector('#reopen');
        if (re) re.onclick = function () {
          S.setOppStage(o.id, 'negotiation');
          U.toast('Reopened at Negotiation.', 'ok');
          done();
        };
        el_.querySelectorAll('[data-stage]').forEach(function (b) {
          b.onclick = function () {
            var target = b.dataset.stage;
            if (target === 'closedwon') return closeWon(o, done);
            if (target === 'closedlost') return closeLost(o, done);
            S.setOppStage(o.id, target);
            U.toast('Moved to ' + S.oppStage(target).label + '.', 'ok');
            done();
          };
        });
      },

      highlights: function (o) {
        var s = S.oppStage(o.stage);
        var ct = o.contactId ? S.contact(o.contactId) : null;
        var t = U.dueTone(o.closeDate, !s.open);
        return [
          { label: 'Amount', value: '<span class="mono">' + S.money(o.amount) + '</span>' },
          { label: 'Weighted', value: s.open
              ? '<span class="mono">' + S.money((Number(o.amount) || 0) * s.probability / 100) + '</span>' +
                ' <span class="muted" style="font-size:12px;font-weight:400">at ' + s.probability + '%</span>'
              : '<span class="muted">—</span>' },
          { label: 'Close Date', value: o.closeDate
              ? U.fmtDate(o.closeDate) + (s.open ? ' <span class="badge ' +
                  (t.cls.indexOf('b-') === 0 ? t.cls : 'b-grey') + '" style="margin-left:6px">' + U.esc(t.text) + '</span>' : '')
              : '—' },
          { label: 'Account', value: '<a class="link" href="#/accounts/' + U.esc(o.accountId) + '">' +
              U.esc(S.accountName(o.accountId)) + '</a>' },
          { label: 'Contact', value: ct
              ? '<a class="link" href="#/contacts/' + U.esc(ct.id) + '">' + U.esc(S.contactName(ct)) + '</a>'
              : '<span class="muted">None named</span>' },
          { label: 'Owner', value: U.userCell(o.ownerId) }
        ];
      },

      related: function (o) {
        var wos = S.workOrdersFor('opportunity', o.id);
        var siblings = S.opportunitiesFor(o.accountId).filter(function (x) { return x.id !== o.id; });
        var contacts = S.contactsFor(o.accountId);
        return [
          { title: 'Contacts at this account', count: contacts.length,
            emptyText: 'Nobody on file at this account yet.',
            html: contacts.map(root.RecordView.contactRow).join(''),
            addLabel: '+ New Contact',
            onAdd: function (done) { root.Views.contacts.openForm({ accountId: o.accountId }, done); } },
          { title: 'Other deals with ' + S.accountName(o.accountId), count: siblings.length,
            emptyText: 'This is the only deal on this account.',
            html: siblings.map(root.RecordView.oppRow).join(''),
            addLabel: '+ New Opportunity',
            onAdd: function (done) { openForm({ accountId: o.accountId }, done); } },
          { title: 'Work Orders', count: wos.length,
            emptyText: 'No delivery work attached to this deal.',
            html: wos.map(root.RecordView.woRow).join(''),
            addLabel: '+ New',
            onAdd: function (done) { root.WorkOrderForm.open({ entityType: 'opportunity', entityId: o.id }, done); } }
        ];
      },

      detailRows: function (o) {
        var s = S.oppStage(o.stage);
        return '<dt>Opportunity</dt><dd>' + U.esc(o.name) + '</dd>' +
          '<dt>Account</dt><dd><a class="link" href="#/accounts/' + U.esc(o.accountId) + '">' +
            U.esc(S.accountName(o.accountId)) + '</a></dd>' +
          '<dt>Stage</dt><dd>' + U.badge(s.label, s.tone) + ' <span class="muted mono" style="font-size:11.5px">' +
            s.probability + '% probability</span></dd>' +
          '<dt>Amount</dt><dd><span class="mono">' + S.money(o.amount) + '</span></dd>' +
          '<dt>Close Date</dt><dd>' + U.fmtDate(o.closeDate) + '</dd>' +
          '<dt>Type</dt><dd>' + U.esc(o.type || '—') + '</dd>' +
          '<dt>Source</dt><dd>' + U.esc(o.leadSource || '—') + '</dd>' +
          '<dt>Next Step</dt><dd>' + U.esc(o.nextStep || '—') + '</dd>' +
          '<dt>Services</dt><dd>' + (S.serviceNames(o.services).join(', ') || '—') + '</dd>' +
          (o.lostReason ? '<dt>Lost Reason</dt><dd>' + U.esc(o.lostReason) + '</dd>' : '') +
          '<dt>Description</dt><dd>' + U.esc(o.description || '—') + '</dd>' +
          '<dt>Owner</dt><dd>' + U.userCell(o.ownerId) + '</dd>' +
          '<dt>Created</dt><dd>' + U.fmtDate(o.createdAt) + '</dd>' +
          (o.closedAt ? '<dt>Closed</dt><dd>' + U.fmtDate(o.closedAt) + '</dd>' : '');
      },

      onEdit: function (o, done) { openForm(o, done); }
    });
  }

  /* Salesforce's stage path across the top of the deal — one click to
     advance, and the current position always visible. */
  function stagePath(o) {
    var cur = S.oppStage(o.stage);
    return '<div class="card" style="margin-bottom:12px"><div class="act-tabs" style="border-bottom:0">' +
      S.OPP_STAGES.map(function (s) {
        var isCur = s.id === o.stage;
        var passed = cur.open && s.open && s.order < cur.order;
        return '<button data-stage="' + U.esc(s.id) + '"' +
          (isCur ? ' style="border-color:var(--orange);color:var(--orange);background:var(--orange-glow)"'
                 : passed ? ' style="opacity:.65"' : '') + '>' +
          (passed ? '✓ ' : '') + U.esc(s.label) + '</button>';
      }).join('') +
    '</div></div>';
  }

  function closeWon(o, done) {
    var acct = S.account(o.accountId);
    U.modal({
      title: 'Close ' + o.name + ' as won',
      okText: 'Mark Closed Won',
      body: '<div class="form-grid">' +
        U.field('Final Amount ($)', '<input class="input" type="number" min="0" step="50" name="amount" value="' + U.esc(o.amount || 0) + '">') +
        U.field('Closed On', '<input class="input" type="date" name="closeDate" value="' + U.esc(o.closeDate || S.today()) + '">') +
        /* The deal amount and the account's recurring contract are
           different numbers, so rolling one into the other is offered,
           never assumed. */
        '<div class="field span-2"><label class="check" style="width:fit-content">' +
          '<input type="checkbox" name="roll" checked>Add this to ' + U.esc(acct ? acct.name : 'the account') +
          '\'s contract value</label>' +
          '<div class="hint">Currently ' + S.money(acct ? acct.value : 0) +
            ' per ' + U.esc((acct && acct.billingCycle) || 'month').toLowerCase() +
            '. Leave unticked for one-off work that does not recur.</div></div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        var amount = Number(v.amount) || 0;
        var roll = Array.isArray(v.roll) ? v.roll.length > 0 : !!v.roll;
        S.update('opportunities', o.id, {
          stage: 'closedwon', amount: amount, closeDate: v.closeDate,
          closedAt: S.nowISO(), lostReason: ''
        }, o.name + ' → Closed Won');
        if (roll && acct) {
          S.update('customers', acct.id, { value: (Number(acct.value) || 0) + amount },
            'contract value updated from ' + o.name);
        }
        U.toast(o.name + ' won.' + (roll && acct ? ' Contract value updated.' : ''), 'ok');
        done();
      }
    });
  }

  function closeLost(o, done) {
    U.modal({
      title: 'Close ' + o.name + ' as lost',
      okText: 'Mark Closed Lost',
      danger: true,
      body: '<div class="form-grid">' +
        '<div class="field span-2"><label>Why was it lost?</label>' +
          '<textarea class="input" name="lostReason" placeholder="Price, timing, went in-house, went quiet…">' +
          U.esc(o.lostReason || '') + '</textarea>' +
          '<div class="hint">The single most useful field on a lost deal — it is the only record of why, ' +
          'and it is what tells you whether to try again.</div></div>' +
      '</div>',
      onOk: function (box) {
        var v = U.values(box);
        S.update('opportunities', o.id, {
          stage: 'closedlost', closedAt: S.nowISO(), lostReason: v.lostReason || ''
        }, o.name + ' → Closed Lost');
        U.toast(o.name + ' marked lost.', 'ok');
        done();
      }
    });
  }

  /* ── form ────────────────────────────────────────────────────── */
  function openForm(o, done) {
    var isNew = !o || !o.id;
    var seedAccount = (o && o.accountId) || '';
    var accounts = S.accounts().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });

    if (!accounts.length) {
      U.toast('Create an account first — a deal has to belong to one.', 'err');
      return;
    }

    o = (o && o.id) ? o : {
      accountId: seedAccount, stage: 'prospecting', ownerId: S.me().id,
      closeDate: S.shift(30), type: 'New Business', services: []
    };
    var contacts = S.contactsFor(o.accountId || accounts[0].id);

    U.modal({
      title: isNew ? 'New Opportunity' : 'Edit ' + o.name,
      wide: true,
      okText: isNew ? 'Create Opportunity' : 'Save Changes',
      body: '<div class="form-grid">' +
        U.field('Opportunity Name *',
          '<input class="input" name="name" value="' + U.esc(o.name || '') + '" placeholder="Acme — Website Build">') +
        U.field('Account *',
          '<select class="input" name="accountId">' + U.options(accounts, o.accountId, 'id', 'name') + '</select>') +
        U.field('Primary Contact',
          '<select class="input" name="contactId"><option value="">—</option>' +
            contacts.map(function (c) {
              return '<option value="' + U.esc(c.id) + '"' + (c.id === o.contactId ? ' selected' : '') + '>' +
                U.esc(S.contactName(c)) + (c.title ? ' · ' + U.esc(c.title) : '') + '</option>';
            }).join('') + '</select>' +
          '<div class="hint">Pick the account first; this list follows it.</div>') +
        U.field('Stage',
          '<select class="input" name="stage">' + U.options(S.OPP_STAGES, o.stage) + '</select>' +
          '<div class="hint">Use the Closed Won / Closed Lost buttons on the record rather than picking those here — ' +
          'they capture the amount and the reason.</div>') +
        U.field('Amount ($)', '<input class="input" type="number" min="0" step="50" name="amount" value="' + U.esc(o.amount || 0) + '">') +
        U.field('Close Date', '<input class="input" type="date" name="closeDate" value="' + U.esc(o.closeDate || '') + '">') +
        U.field('Type',
          '<select class="input" name="type">' +
            S.OPP_TYPES.map(function (t) {
              return '<option value="' + U.esc(t) + '"' + (t === o.type ? ' selected' : '') + '>' + U.esc(t) + '</option>';
            }).join('') + '</select>') +
        U.field('Owner', '<select class="input" name="ownerId">' + U.options(S.activeUsers(), o.ownerId, 'id', 'name') + '</select>') +
        U.field('Source',
          '<input class="input" name="leadSource" list="oppSourceOptions" value="' + U.esc(o.leadSource || '') + '">' +
          '<datalist id="oppSourceOptions">' +
            S.LEAD_SOURCES.map(function (s) { return '<option value="' + U.esc(s) + '">'; }).join('') +
          '</datalist>') +
        '<div class="field span-2"><label>Next Step</label>' +
          '<input class="input" name="nextStep" value="' + U.esc(o.nextStep || '') + '" ' +
            'placeholder="Send the revised scope by Thursday"></div>' +
        '<div class="field span-2"><label>Services</label>' + U.serviceChecks('services', o.services) + '</div>' +
        '<div class="field span-2"><label>Description</label>' +
          '<textarea class="input" name="description">' + U.esc(o.description || '') + '</textarea></div>' +
      '</div>',
      onMount: function (box) {
        /* Re-point the contact list when the account changes, so it can
           never offer somebody from a different company. */
        var acctSel = box.querySelector('[name=accountId]');
        var ctSel = box.querySelector('[name=contactId]');
        acctSel.onchange = function () {
          var list = S.contactsFor(acctSel.value);
          ctSel.innerHTML = '<option value="">—</option>' + list.map(function (c) {
            return '<option value="' + U.esc(c.id) + '">' + U.esc(S.contactName(c)) +
              (c.title ? ' · ' + U.esc(c.title) : '') + '</option>';
          }).join('');
        };
      },
      onOk: function (box) {
        var v = U.values(box);
        if (!v.name) { U.toast('Give the opportunity a name.', 'err'); return false; }
        if (!v.accountId) { U.toast('Pick the account.', 'err'); return false; }
        v.amount = Number(v.amount) || 0;

        if (isNew) {
          v.closedAt = S.oppStage(v.stage).open ? '' : S.nowISO();
          v.lostReason = '';
          var created = S.insert('opportunities', v, 'op', v.name);
          U.toast(created.name + ' created.', 'ok');
        } else {
          /* Stage edited here still has to keep closedAt honest. */
          v.closedAt = S.oppStage(v.stage).open ? '' : (o.closedAt || S.nowISO());
          S.update('opportunities', o.id, v, 'opportunity details');
          U.toast('Saved.', 'ok');
        }
        done();
      }
    });
  }

  /* ── CSV export ──────────────────────────────────────────────── */
  function exportCsv(rows) {
    var head = ['Opportunity', 'Account', 'Contact', 'Stage', 'Probability', 'Amount', 'Weighted',
      'Close Date', 'Type', 'Source', 'Next Step', 'Owner', 'Lost Reason'];
    var lines = [head.join(',')].concat(rows.map(function (o) {
      var s = S.oppStage(o.stage);
      return [o.name, S.accountName(o.accountId),
        o.contactId ? S.contactName(S.contact(o.contactId)) : '',
        s.label, s.probability, o.amount,
        s.open ? Math.round((Number(o.amount) || 0) * s.probability / 100) : '',
        o.closeDate, o.type, o.leadSource, o.nextStep, S.user(o.ownerId).name, o.lostReason]
        .map(function (f) { return '"' + String(f == null ? '' : f).replace(/"/g, '""') + '"'; }).join(',');
    }));
    root.download('thinkfirst-opportunities-' + S.today() + '.csv', lines.join('\n'), 'text/csv');
    U.toast('CSV exported.', 'ok');
  }

  root.Views.opportunities.openForm = openForm;
  root.Views.opportunities.closeWon = closeWon;
})(window);
