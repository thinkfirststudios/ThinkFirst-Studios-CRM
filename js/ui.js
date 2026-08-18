/* ═══════════════════════════════════════════════════════════════════
   ui.js — rendering primitives shared by every view.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var S = root.Store;

  /* ── escaping & formatting ───────────────────────────────────── */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(d) {
    if (!d) return '—';
    var dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateShort(d) {
    if (!d) return '—';
    var dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtWhen(iso) {
    if (!iso) return '';
    var dt = new Date(iso), diff = (Date.now() - dt) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
           ' at ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /* Relative wording for a billing/due date, with urgency tone. */
  function dueTone(dateStr, done) {
    if (!dateStr) return { text: 'No date', cls: 'muted' };
    var d = S.daysUntil(dateStr);
    if (done) return { text: fmtDateShort(dateStr), cls: 'muted' };
    if (d < 0) return { text: Math.abs(d) + 'd overdue', cls: 'b-red' };
    if (d === 0) return { text: 'Due today', cls: 'b-orange' };
    if (d === 1) return { text: 'Due tomorrow', cls: 'b-yellow' };
    if (d <= 7) return { text: 'in ' + d + ' days', cls: 'b-yellow' };
    return { text: fmtDateShort(dateStr), cls: 'muted' };
  }

  /* ── small components (return HTML strings) ──────────────────── */
  function badge(label, tone, noDot) {
    return '<span class="badge ' + (tone || 'b-grey') + (noDot ? ' no-dot' : '') + '">' + esc(label) + '</span>';
  }

  function statusBadge(id) {
    var st = S.status(id);
    return badge(st.label, st.tone);
  }

  function woBadge(id) {
    var st = S.woStatus(id);
    return badge(st.label, st.tone);
  }

  /* Deterministic avatar hue so each teammate is visually distinct. */
  var AV_COLORS = ['#FA7700', '#4C8DFF', '#2FBF71', '#8B7CF6', '#E8B931', '#E5484D', '#22B8CF'];
  function avatarColor(id) {
    var sum = 0;
    for (var i = 0; i < (id || '').length; i++) sum += id.charCodeAt(i);
    return AV_COLORS[sum % AV_COLORS.length];
  }
  function avatar(userId, size) {
    var u = S.user(userId);
    return '<span class="avatar ' + (size || '') + '" style="background:' + avatarColor(userId) + '" title="' + esc(u.name) + '">' +
           esc(S.initials(u.name)) + '</span>';
  }
  function userCell(userId) {
    var u = S.user(userId);
    return '<span class="split">' + avatar(userId, 'sm') + '<span>' + esc(u.name) + '</span></span>';
  }

  function empty(title, sub, actionHTML) {
    return '<div class="empty">' +
      '<svg viewBox="0 0 24 24"><path d="M3 7h18v13H3zM3 7l3-4h12l3 4M9 12h6"/></svg>' +
      '<h4>' + esc(title) + '</h4><div>' + esc(sub || '') + '</div>' +
      (actionHTML ? '<div style="margin-top:14px">' + actionHTML + '</div>' : '') +
      '</div>';
  }

  function options(list, selected, valueKey, labelKey) {
    return list.map(function (item) {
      var v = typeof item === 'string' ? item : item[valueKey || 'id'];
      var l = typeof item === 'string' ? item : item[labelKey || 'label'];
      return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }

  function field(label, inner, span) {
    return '<div class="field' + (span ? ' span-2' : '') + '"><label>' + esc(label) + '</label>' + inner + '</div>';
  }

  /* Comma-separated tag entry with autocomplete from tags already in use,
     so the same idea doesn't end up spelled three ways. */
  function tagInput(name, tags) {
    var existing = S.allTags();
    return '<input class="input" name="' + esc(name) + '" list="tagOptions" ' +
        'placeholder="VIP, Referral, Local…" value="' + esc((tags || []).join(', ')) + '">' +
      '<datalist id="tagOptions">' +
        existing.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') +
      '</datalist>' +
      '<div class="hint">Separate with commas.' +
        (existing.length ? ' In use: ' + esc(existing.slice(0, 8).join(', ')) : '') + '</div>';
  }

  /* The three handle inputs, identical on every object that has them.
     Any format is accepted — the store reduces a pasted profile URL to
     the handle — so nobody has to think about which form is "right". */
  function socialFields(rec) {
    rec = rec || {};
    return S.SOCIALS.map(function (net) {
      return field(net.label,
        '<input class="input" name="' + esc(net.id) + '" placeholder="' + esc(net.placeholder) + '" ' +
          'value="' + esc(rec[net.id] || '') + '">');
    }).join('');
  }

  /* Handles as links. For a business with no website these are the only
     way to reach them, so they are clickable rather than decorative. */
  function socialChips(rec, opts) {
    var list = S.socialsOf(rec);
    if (!list.length) return (opts && opts.emptyHTML) || '';
    return '<div class="chips">' + list.map(function (s) {
      return '<a class="chip social-chip" href="' + esc(s.url) + '" target="_blank" rel="noopener" ' +
        'title="' + esc(s.net.label) + '">' +
        '<span class="social-tag">' + esc(s.net.short) + '</span>@' + esc(s.handle) + '</a>';
    }).join('') + '</div>';
  }

  function tagChips(tags, limit) {
    tags = tags || [];
    if (!tags.length) return '';
    var shown = limit ? tags.slice(0, limit) : tags;
    return '<div class="chips">' +
      shown.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') +
      (limit && tags.length > limit ? '<span class="chip">+' + (tags.length - limit) + '</span>' : '') +
      '</div>';
  }

  /* The Paid / Pro Bono / Internal / Trial badge. */
  function billingTypeBadge(c) {
    var bt = S.billingType(c && c.billingType);
    return badge(bt.label, bt.tone);
  }

  function serviceChecks(name, selectedIds) {
    selectedIds = selectedIds || [];
    return '<div class="checks">' + S.all('services').filter(function (s) { return s.active; }).map(function (s) {
      return '<label class="check"><input type="checkbox" name="' + name + '" value="' + esc(s.id) + '"' +
        (selectedIds.indexOf(s.id) > -1 ? ' checked' : '') + '>' + esc(s.name) + '</label>';
    }).join('') + '</div>';
  }

  /* ── toast ───────────────────────────────────────────────────── */
  function toast(msg, kind) {
    var root_ = document.getElementById('toastRoot');
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    root_.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateX(16px)';
      setTimeout(function () { el.remove(); }, 260);
    }, 2600);
  }

  /* ── modal ───────────────────────────────────────────────────── */
  var modalRoot = null;
  function modal(opts) {
    modalRoot = document.getElementById('modalRoot');
    modalRoot.hidden = false;
    modalRoot.innerHTML =
      '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<h3 class="modal-title">' + esc(opts.title) + '</h3>' +
          '<button class="btn btn-ghost btn-icon" data-close style="margin-left:auto">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' + opts.body + '</div>' +
        (opts.footer === null ? '' :
          '<div class="modal-foot">' +
            (opts.extraFooter || '') +
            '<button class="btn" data-close>' + esc(opts.cancelText || 'Cancel') + '</button>' +
            '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-ok>' +
              esc(opts.okText || 'Save') + '</button>' +
          '</div>') +
      '</div>';

    var box = modalRoot.querySelector('.modal');
    box.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = closeModal; });
    modalRoot.onclick = function (e) { if (e.target === modalRoot) closeModal(); };
    document.addEventListener('keydown', escClose);

    var okBtn = box.querySelector('[data-ok]');
    if (okBtn) {
      okBtn.onclick = function () {
        var result = opts.onOk ? opts.onOk(box) : true;
        if (result !== false) closeModal();
      };
    }
    if (opts.onMount) opts.onMount(box);

    var first = box.querySelector('input:not([type=checkbox]),textarea,select');
    if (first) setTimeout(function () { first.focus(); }, 40);
    return box;
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    var r = document.getElementById('modalRoot');
    r.hidden = true; r.innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  /* `children` is the [{label, rows}] list from Store.childrenOf. Naming
     what else disappears is the whole point: deleting an account takes
     its contacts and deals with it, and finding that out afterwards is
     not a reasonable way to learn it. */
  function confirmDelete(what, onYes, children) {
    var groups = (children || []).filter(function (g) { return g.rows.length; });
    var total = groups.reduce(function (s, g) { return s + g.rows.length; }, 0);

    modal({
      title: 'Delete ' + what + '?',
      body: '<p style="margin:0 0 12px;color:var(--text-2)">This removes <strong>' + esc(what) +
          '</strong> permanently.</p>' +
        (total
          ? '<div class="card" style="border-color:rgba(229,72,77,.4)"><div class="card-body">' +
              '<div class="strong" style="margin-bottom:8px">' + total +
                ' attached record' + (total === 1 ? '' : 's') + ' will be deleted too</div>' +
              '<div class="chips">' + groups.map(function (g) {
                return '<span class="chip">' + g.rows.length + ' ' + esc(g.label) + '</span>';
              }).join('') + '</div>' +
              '<div class="hint" style="margin-top:9px">They only exist as part of this record. ' +
                'Leaving them behind would keep them in your totals with nothing to point at.</div>' +
            '</div></div>'
          : '<div class="hint">Nothing else is attached to it.</div>'),
      okText: 'Delete' + (total ? ' all ' + (total + 1) : ''), danger: true,
      onOk: function () { onYes(); }
    });
  }

  /* ── form value collection ───────────────────────────────────── */
  function values(box) {
    var out = {};
    box.querySelectorAll('[name]').forEach(function (el) {
      if (el.type === 'checkbox') {
        if (!Array.isArray(out[el.name])) out[el.name] = [];
        if (el.checked) out[el.name].push(el.value);
      } else {
        out[el.name] = el.value.trim ? el.value.trim() : el.value;
      }
    });
    return out;
  }

  /* ── sortable table ──────────────────────────────────────────── */
  /* cols: [{key,label,render(row),sort(row),width,cls}] */
  function table(cols, rows, opts) {
    opts = opts || {};
    var sortKey = opts.sortKey, dir = opts.sortDir || 1;

    if (sortKey) {
      var col = cols.filter(function (c) { return c.key === sortKey; })[0];
      if (col) {
        rows = rows.slice().sort(function (a, b) {
          var av = col.sort ? col.sort(a) : '', bv = col.sort ? col.sort(b) : '';
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });
      }
    }

    if (!rows.length) return opts.emptyHTML || empty('Nothing here yet', opts.emptyText || '');

    var html = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      cols.map(function (c) {
        var ind = sortKey === c.key ? '<span class="sort-ind">' + (dir === 1 ? '▲' : '▼') + '</span>' : '';
        return '<th' + (c.sort ? ' class="sortable" data-sort="' + esc(c.key) + '"' : '') +
               (c.width ? ' style="width:' + c.width + '"' : '') + '>' + esc(c.label) + ind + '</th>';
      }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr' + (opts.rowLink ? ' class="row-link" data-id="' + esc(r.id) + '"' : '') + '>' +
          cols.map(function (c) {
            return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.render(r) + '</td>';
          }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div>';
    return html;
  }

  /* Wire sorting + row clicks after the table HTML is in the DOM. */
  function bindTable(container, opts) {
    container.querySelectorAll('th.sortable').forEach(function (th) {
      th.onclick = function () { opts.onSort(th.dataset.sort); };
    });
    if (opts.onRow) {
      container.querySelectorAll('tr.row-link').forEach(function (tr) {
        tr.onclick = function (e) {
          if (e.target.closest('button,a,input,select')) return;
          opts.onRow(tr.dataset.id);
        };
      });
    }
  }

  /* ── notes panel (shared by customers, vendors, work orders) ─── */
  function notesPanel(entityType, entityId, rerender) {
    var notes = S.notesFor(entityType, entityId);
    return '<div class="note-composer">' +
        '<textarea id="noteInput" placeholder="Add a note for the team… (Ctrl+Enter to post)"></textarea>' +
        '<div class="note-composer-foot">' +
          avatar(S.me().id, 'sm') +
          '<span class="hint">Posting as <strong>' + esc(S.me().name) + '</strong></span>' +
          '<button class="btn btn-primary btn-sm" id="postNote" style="margin-left:auto">Post note</button>' +
        '</div>' +
      '</div>' +
      (notes.length ? notes.map(function (n) {
        var author = S.user(n.authorId);
        return '<div class="note' + (n.pinned ? ' pinned' : '') + '" data-note="' + esc(n.id) + '">' +
          avatar(n.authorId) +
          '<div class="note-body">' +
            '<div class="note-head">' +
              '<span class="note-author">' + esc(author.name) + '</span>' +
              '<span class="chip">' + esc(author.title || author.role) + '</span>' +
              '<span class="note-time">' + esc(fmtWhen(n.createdAt)) + '</span>' +
              (n.pinned ? '<span class="badge b-orange no-dot">Pinned</span>' : '') +
              '<span class="note-actions">' +
                '<button class="btn btn-ghost btn-sm" data-pin="' + esc(n.id) + '">' + (n.pinned ? 'Unpin' : 'Pin') + '</button>' +
                (n.authorId === S.me().id || S.isAdmin()
                  ? '<button class="btn btn-ghost btn-sm" data-delnote="' + esc(n.id) + '">Delete</button>' : '') +
              '</span>' +
            '</div>' +
            '<div class="note-text">' + esc(n.body) + '</div>' +
          '</div></div>';
      }).join('') : '<div class="empty" style="padding:28px"><div>No notes yet — be the first to add context.</div></div>');
  }

  function bindNotes(container, entityType, entityId, rerender) {
    var input = container.querySelector('#noteInput');
    var post = container.querySelector('#postNote');
    if (post) {
      post.onclick = function () {
        var body = input.value.trim();
        if (!body) { toast('Write something first.', 'err'); return; }
        S.addNote(entityType, entityId, body);
        toast('Note posted.', 'ok');
        rerender();
      };
    }
    if (input) {
      input.onkeydown = function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post.click();
      };
    }
    container.querySelectorAll('[data-pin]').forEach(function (b) {
      b.onclick = function () {
        var n = S.find('notes', b.dataset.pin);
        S.update('notes', n.id, { pinned: !n.pinned });
        rerender();
      };
    });
    container.querySelectorAll('[data-delnote]').forEach(function (b) {
      b.onclick = function () {
        S.remove('notes', b.dataset.delnote);
        toast('Note deleted.');
        rerender();
      };
    });
  }

  /* ── activity timeline ───────────────────────────────────────── */
  function timeline(items, limit) {
    items = items.slice(0, limit || 25);
    if (!items.length) return '<div class="empty" style="padding:24px"><div>No activity recorded yet.</div></div>';
    return '<div class="timeline">' + items.map(function (a) {
      var u = S.user(a.userId);
      return '<div class="tl-item' + (a.action === 'created' ? ' hot' : '') + '">' +
        '<strong>' + esc(u.name) + '</strong> ' + esc(a.action) +
        ' <span class="muted">' + esc(a.detail) + '</span>' +
        '<div class="tl-when">' + esc(fmtWhen(a.ts)) + '</div></div>';
    }).join('') + '</div>';
  }

  root.UI = {
    esc: esc, fmtDate: fmtDate, fmtDateShort: fmtDateShort, fmtWhen: fmtWhen, dueTone: dueTone,
    badge: badge, statusBadge: statusBadge, woBadge: woBadge,
    avatar: avatar, avatarColor: avatarColor, userCell: userCell,
    empty: empty, options: options, field: field, serviceChecks: serviceChecks,
    tagInput: tagInput, tagChips: tagChips, billingTypeBadge: billingTypeBadge,
    socialFields: socialFields, socialChips: socialChips,
    toast: toast, modal: modal, closeModal: closeModal, confirmDelete: confirmDelete,
    values: values, table: table, bindTable: bindTable,
    notesPanel: notesPanel, bindNotes: bindNotes, timeline: timeline
  };
})(window);
