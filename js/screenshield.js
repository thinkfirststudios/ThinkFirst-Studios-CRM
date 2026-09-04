/* ═══════════════════════════════════════════════════════════════════
   screenshield.js — capture deterrents on the screens that show lead
   contact details (All Leads and Daily Outreach).

   READ THIS BEFORE TRUSTING IT.

   A web page cannot block a screenshot. There is no browser API for it,
   on any platform. The operating system owns the screen, the page does
   not, and every "screenshot blocker" library for the web is either a
   watermark or a focus trick wearing a confident name. A phone is the
   worst case of all: Android and iOS take a screenshot without telling
   the page anything, so nothing in this file can stop a screenshot
   taken in a phone browser. Only a NATIVE wrapper can — see
   docs/screenshot-protection.md for what that would take.

   So this file does the three things that actually work in a browser:

     1. HIDE ON FOCUS LOSS. Every desktop capture tool that lets you
        pick a region — Snipping Tool, Win+Shift+S, macOS Cmd+Shift+4,
        Greenshot, Lightshot — takes focus away from the browser to do
        it. When focus leaves, the lead data goes behind an opaque
        cover, so the region that gets captured is the cover. Same for
        screen sharing when the sharer alt-tabs, and same for the app
        switcher thumbnail on a phone, which is a real leak on a shared
        or stolen handset.

     2. WATERMARK. A tiled overlay stamps who is looking and when across
        every pixel of lead data. This does not prevent a capture; it
        makes the capture traceable to one account and one minute, which
        is the deterrent every real CRM actually ships. It is the only
        layer that does anything at all on a phone.

     3. REFUSE THE EASY EXITS. PrintScreen is swallowed and the
        clipboard overwritten, Ctrl+P is blocked, and printing renders a
        notice instead of the lead list.

   Attempts are recorded in localStorage — ScreenShield.log() reads them
   back. Set SHIELD_ENABLED to false below to turn the whole thing off.

   THE ONLY REAL BLOCK. Screenshots can be refused outright, by the
   operating system, but only for a NATIVE window — Electron's
   setContentProtection on Windows and macOS, FLAG_SECURE on Android.
   None of those exist for a browser tab. So if the requirement is
   genuinely "no screenshots of the CRM, ever", the CRM has to stop
   being reachable in a plain browser: flip REQUIRE_SECURE_CLIENT to
   true and the app refuses to render anywhere except inside the
   wrapper. That switch is the enforcement. Everything above it is
   deterrence. Do not turn it on before the wrapper exists — it locks
   everyone out, by design. docs/screenshot-protection.md has the build.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SHIELD_ENABLED = true;

  /* Every screen is covered. Lead contact details are the obvious
     target, but accounts, contacts, opportunities, billing and the
     dashboard's pipeline numbers are all the same data wearing a
     different layout — protecting two routes and leaving eleven open
     was a gap, not a policy. Set this false and only the routes listed
     in PROTECTED stay shielded. */
  var PROTECT_EVERY_SCREEN = true;
  var PROTECTED = { leads: 1, outreach: 1 };

  /* When true the CRM refuses to run in a plain browser and will only
     render inside the native wrapper, which is the only place the OS
     will honour a no-capture flag. See the note at the top of the file
     before switching this on. */
  var REQUIRE_SECURE_CLIENT = false;

  var LOG_KEY = 'tfs_crm_shield_log';
  var LOG_MAX = 50;

  var S = root.Store, U = root.UI;

  var gated = false;       // blocked outright: not a permitted client
  var active = false;      // is the current screen a protected one
  var hidden = false;      // is the cover currently down
  var wm = null, cover = null;
  var stampedAt = 0;

  /* ── watermark ───────────────────────────────────────────────────
     Drawn as a repeating background image rather than DOM text so there
     is nothing to delete from the inspector one node at a time, and so
     it cannot be selected or dragged aside. Two short lines tile better
     than one long one: rotated text clips at the tile edge, and a
     46-character line fits inside the box at this angle where a
     90-character line would be sliced in half. */
  function watermarkTile() {
    var me = who_am_i();
    var who = (me.name || 'Unknown user') + (me.email ? '  ·  ' + me.email : '');
    var when = new Date().toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="540" height="260">' +
        '<g transform="rotate(-22 270 130)" font-family="Inter, Helvetica, Arial, sans-serif" ' +
           'font-size="12" font-weight="600" fill="rgba(26,26,24,0.115)" letter-spacing="0.4">' +
          '<text x="46" y="122">' + xml(who) + '</text>' +
          '<text x="46" y="142">' + xml(when + '  ·  CONFIDENTIAL — do not share') + '</text>' +
        '</g>' +
      '</svg>';

    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }

  /* The store can be mid-sign-in or mid-sync when a route renders, and
     an unstamped watermark is a far better outcome than a screen that
     fails to draw. */
  function who_am_i() {
    try { return (S && S.me && S.me()) || {}; }
    catch (e) { return {}; }
  }

  function xml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function restamp(force) {
    if (!wm) return;
    /* Once a minute is as fine as the timestamp is — restamping more
       often just rebuilds the same string. */
    if (!force && Date.now() - stampedAt < 60000) return;
    stampedAt = Date.now();
    wm.style.backgroundImage = watermarkTile();
  }

  /* ── overlays ────────────────────────────────────────────────────
     Both sit above everything the app draws, modals and toasts
     included, so a screenshot of a lead detail modal carries the
     watermark too. */
  function build() {
    if (wm) return;

    wm = document.createElement('div');
    wm.className = 'shield-watermark';
    wm.setAttribute('aria-hidden', 'true');
    wm.hidden = true;

    cover = document.createElement('div');
    cover.className = 'shield-cover';
    cover.hidden = true;
    cover.innerHTML =
      '<div class="shield-cover-box">' +
        '<svg viewBox="0 0 24 24" class="shield-cover-ico" aria-hidden="true">' +
          '<path d="M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6l8-4z"/>' +
          '<path d="M9.5 12.4l1.8 1.8 3.4-3.6"/>' +
        '</svg>' +
        '<h2>Lead data is hidden</h2>' +
        '<p>This screen covers itself whenever the CRM loses focus, so screen-capture ' +
           'tools grab this panel instead of your leads.</p>' +
        '<button class="btn btn-primary btn-sm" type="button">Show leads again</button>' +
      '</div>';

    document.body.appendChild(wm);
    document.body.appendChild(cover);

    /* A click anywhere on the cover lifts it — hunting for a small
       button after every alt-tab would make this unbearable to use. */
    cover.addEventListener('mousedown', function (e) { e.preventDefault(); reveal(); });
    cover.addEventListener('touchstart', function () { reveal(); }, { passive: true });
  }

  function conceal() {
    if (!active || hidden) return;
    build();
    hidden = true;
    cover.hidden = false;
    document.body.setAttribute('data-shield-hidden', '1');
  }

  function reveal() {
    if (!hidden) return;
    hidden = false;
    if (cover) cover.hidden = true;
    document.body.removeAttribute('data-shield-hidden');
  }

  /* ── attempt log ─────────────────────────────────────────────────
     Kept in localStorage rather than pushed at the database: this is a
     deterrent record for the person at the keyboard, not an audit trail
     that would survive someone clearing their browser. Treat it as a
     smoke alarm, not as evidence. */
  function flag(kind, quiet) {
    var me = who_am_i();
    var row = {
      at: new Date().toISOString(),
      kind: kind,
      user: me.name || '',
      email: me.email || '',
      route: (location.hash || '').replace(/^#\/?/, '')
    };

    try {
      var log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      log.push(row);
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
    } catch (e) { /* private mode or a full quota — the toast still lands */ }

    console.warn('[ScreenShield] capture attempt:', kind, row);
    if (!quiet && U && U.toast) {
      U.toast('Lead data is confidential. This capture attempt was logged against your account.', 'err');
    }
  }

  /* Windows does not let a page cancel PrintScreen — by the time the
     key event arrives the bitmap is already on the clipboard. What CAN
     be done is overwrite the clipboard immediately afterwards, which
     turns the paste into a notice instead of a screenful of leads. It
     needs the document focused and clipboard permission, so it is
     best-effort by design. */
  function scrubClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(
      'ThinkFirst Studios CRM — screen captures of lead data are not permitted. ' +
      'This clipboard entry replaced a screenshot taken at ' + new Date().toLocaleString() + '.'
    ).catch(function () { /* no permission — nothing more to try */ });
  }

  /* ── wiring ──────────────────────────────────────────────────────
     Listeners are attached once and check `active` themselves, so
     nothing has to be torn down and re-bound on every route change. */
  function listen() {
    window.addEventListener('blur', function () { conceal(); });
    window.addEventListener('focus', function () { reveal(); });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) conceal(); else reveal();
    });

    /* Returning from the phone's app switcher restores from the page
       cache without firing focus on some builds of iOS Safari. */
    window.addEventListener('pageshow', function () { reveal(); });

    document.addEventListener('keydown', function (e) {
      if (!active) return;

      if (e.key === 'PrintScreen') { e.preventDefault(); return; }

      /* macOS capture shortcuts. Preventing the event does not stop the
         OS, but the attempt is worth recording, and the cover drops as
         soon as the capture UI takes focus anyway. */
      if (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5')) {
        conceal();
        flag('macOS screen capture shortcut');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        flag('print', true);
        if (U && U.toast) U.toast('Printing lead lists is turned off.', 'err');
      }
    });

    /* Windows only reports PrintScreen on keyup. */
    document.addEventListener('keyup', function (e) {
      if (!active || e.key !== 'PrintScreen') return;
      scrubClipboard();
      flag('PrintScreen');
    });

    /* Ctrl+P is not the only way into the print dialog — the browser
       menu is another — so the print media query is watched as well.
       The CSS does the blanking; this only records it. */
    if (window.matchMedia) {
      var mq = window.matchMedia('print');
      if (mq.addEventListener) {
        mq.addEventListener('change', function (m) { if (m.matches && active) flag('print', true); });
      }
    }
  }

  /* ── public ──────────────────────────────────────────────────────
     app.js calls apply() on every render with the route it just drew. */
  function apply(routeName) {
    if (!SHIELD_ENABLED || gated) return;
    build();

    active = PROTECT_EVERY_SCREEN || !!PROTECTED[routeName];
    if (active) document.body.setAttribute('data-shield', '1');
    else document.body.removeAttribute('data-shield');

    if (!active) {
      wm.hidden = true;
      reveal();
      return;
    }

    wm.hidden = false;
    restamp(true);
  }

  /* ── secure client gate ──────────────────────────────────────────
     The wrapper announces itself before any page code runs — an
     Electron preload script or a Capacitor plugin sets the global, and
     the wrapper's user agent carries a token as a fallback for cold
     loads. A plain browser has neither.

     Be clear-eyed about what this gate is: a way to stop the team
     casually using the browser once a protected app exists, not a
     security boundary. Someone who opens the console can set the global
     by hand, and the Supabase API is reachable with a session token
     regardless of what any page renders. Access control lives in the
     database; this lives in the UI. */
  function isSecureClient() {
    return root.TFS_SECURE_CLIENT === true ||
           /TFSCRM-Secure/.test(navigator.userAgent || '');
  }

  function gate() {
    var box = document.createElement('div');
    box.className = 'shield-cover shield-gate';
    box.innerHTML =
      '<div class="shield-cover-box">' +
        '<svg viewBox="0 0 24 24" class="shield-cover-ico" aria-hidden="true">' +
          '<path d="M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6l8-4z"/>' +
          '<path d="M12 8v4M12 15.5v.01"/>' +
        '</svg>' +
        '<h2>Open the CRM in the app</h2>' +
        '<p>Lead data is set to no-capture, and only the ThinkFirst Studios ' +
           'desktop and mobile apps can enforce that with the operating system. ' +
           'A browser tab cannot, so this one will not load records.</p>' +
        '<p class="hint">Ask Alex for the install link if you do not have it yet.</p>' +
      '</div>';
    document.body.appendChild(box);
    console.warn('[ScreenShield] blocked: REQUIRE_SECURE_CLIENT is on and this is a plain browser.');
  }

  root.ScreenShield = {
    apply: apply,
    isSecureClient: isSecureClient,
    /* Read the attempt log: ScreenShield.log() in the console. */
    log: function () {
      try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
      catch (e) { return []; }
    },
    clearLog: function () { try { localStorage.removeItem(LOG_KEY); } catch (e) {} },
    enabled: function () { return SHIELD_ENABLED; }
  };

  if (SHIELD_ENABLED) {
    if (REQUIRE_SECURE_CLIENT && !isSecureClient()) {
      /* Nothing else arms — the gate is the whole response. */
      gated = true;
      if (document.body) gate();
      else document.addEventListener('DOMContentLoaded', gate);
    } else {
      listen();
      setInterval(function () { if (active) restamp(false); }, 30000);
    }
  }
})(window);
