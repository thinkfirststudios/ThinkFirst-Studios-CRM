/* ═══════════════════════════════════════════════════════════════════
   auth.js — sign-in gate. Only used when js/config.js points at a
   Supabase project; offline demo mode never sees this.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var B = root.Backend;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Supabase returns auth failures as hash params on the redirect back
     (e.g. #error=access_denied&error_code=otp_expired). Turn that into a
     readable message instead of letting the router silently ignore it. */
  function hashError() {
    var h = (root.location.hash || '').replace(/^#\/?/, '');
    if (h.indexOf('error') < 0) return null;

    var p = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    if (!p.error && !p.error_code) return null;

    /* clear it so a reload doesn't show the same message again */
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}

    if (p.error_code === 'otp_expired') {
      return 'That confirmation link has already been used or has expired. ' +
             'Links work once — if you clicked it before, your account is already confirmed, so just sign in below.';
    }
    if (p.error_code === 'access_denied' || p.error === 'access_denied') {
      return 'That link was rejected: ' + (p.error_description || 'access denied') + '. Try signing in below.';
    }
    return p.error_description || p.error_code || p.error;
  }

  /* The tables have not been created yet — PostgREST reports this as a
     missing entry in its schema cache. It is a setup step, not a bug, so
     say what to do about it. */
  function isMissingSchema(msg) {
    return /schema cache|Could not find the table|does not exist/i.test(msg || '');
  }

  /* Boot failed. The person may well already be signed in, so this is a
     status screen with a way forward — not a sign-in form. */
  function fatalScreen(message) {
    var setup = isMissingSchema(message);
    var signedIn = !!B.session();

    var wrap = document.createElement('div');
    wrap.className = 'auth-wrap';
    document.body.appendChild(wrap);
    document.body.classList.add('auth-open');

    wrap.innerHTML =
      '<div class="auth-card">' +
        '<div class="auth-brand">' +
          '<img src="assets/thinkfirst-mark.svg" alt="">' +
          '<div class="brand-text">THINKFIRST<em>STUDIOS</em></div>' +
        '</div>' +
        '<h1 class="auth-title">' + (setup ? 'One setup step left' : 'Could not start') + '</h1>' +
        '<p class="auth-sub">' + (setup
          ? 'You are signed in, but this project has no CRM tables yet. Run <span class="mono">supabase/schema.sql</span> ' +
            'in the Supabase SQL Editor, then come back and retry.'
          : 'The CRM could not reach its database. Nothing has been lost — it stopped rather than falling back to local data.') +
        '</p>' +
        '<div class="auth-error">' + esc(message) + '</div>' +
        '<div class="stack" style="gap:9px;margin-top:18px">' +
          '<button class="btn btn-primary" id="auRetry" style="justify-content:center;padding:10px">Retry</button>' +
          (signedIn ? '<button class="btn btn-ghost btn-sm" id="auOut" style="justify-content:center">Sign out</button>' : '') +
        '</div>' +
        '<div class="auth-foot">Connected to <span class="mono">' + esc(shortHost(B.config.url)) + '</span></div>' +
      '</div>';

    wrap.querySelector('#auRetry').onclick = function () { location.reload(); };
    var out = wrap.querySelector('#auOut');
    if (out) out.onclick = function () { B.signOut().then(function () { location.reload(); }); };
  }

  function screen(opts) {
    opts = opts || {};
    if (opts.fatal) return fatalScreen(opts.fatal);

    var mode = 'in';   // 'in' | 'up'
    var initialNotice = hashError();

    var wrap = document.createElement('div');
    wrap.className = 'auth-wrap';
    document.body.appendChild(wrap);
    document.body.classList.add('auth-open');
    paint();

    function paint(error) {
      if (initialNotice && !error) { error = initialNotice; initialNotice = null; }
      wrap.innerHTML =
        '<div class="auth-card">' +
          '<div class="auth-brand">' +
            '<img src="assets/thinkfirst-mark.svg" alt="">' +
            '<div class="brand-text">THINKFIRST<em>STUDIOS</em></div>' +
          '</div>' +
          '<h1 class="auth-title">' + (mode === 'in' ? 'Sign in to the CRM' : 'Create your account') + '</h1>' +
          '<p class="auth-sub">' + (mode === 'in'
            ? 'Your notes, work orders and time entries are recorded under this account.'
            : 'The first account created becomes the admin. Everyone after starts as a rep.') + '</p>' +

          (error ? '<div class="auth-error">' + esc(error) + '</div>' : '') +

          '<div class="stack" style="gap:12px;margin-top:18px">' +
            (mode === 'up'
              ? '<div class="field"><label>Full Name</label><input class="input" id="auName" placeholder="Alex Phillips"></div>'
              : '') +
            '<div class="field"><label>Email</label><input class="input" id="auEmail" type="email" autocomplete="username" placeholder="you@thinkfirststudios.com"></div>' +
            '<div class="field"><label>Password</label><input class="input" id="auPass" type="password" autocomplete="' +
              (mode === 'in' ? 'current-password' : 'new-password') + '" placeholder="••••••••"></div>' +
            '<button class="btn btn-primary" id="auGo" style="justify-content:center;padding:10px">' +
              (mode === 'in' ? 'Sign in' : 'Create account') + '</button>' +
            '<button class="btn btn-ghost btn-sm" id="auToggle" style="justify-content:center">' +
              (mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in') + '</button>' +
          '</div>' +

          '<div class="auth-foot">Connected to <span class="mono">' + esc(shortHost(B.config.url)) + '</span></div>' +
        '</div>';

      var go = wrap.querySelector('#auGo');
      var email = wrap.querySelector('#auEmail');
      var pass = wrap.querySelector('#auPass');
      var name = wrap.querySelector('#auName');

      wrap.querySelector('#auToggle').onclick = function () {
        mode = mode === 'in' ? 'up' : 'in';
        paint();
      };

      go.onclick = function () {
        var e = (email.value || '').trim();
        var p = pass.value || '';
        if (!e || !p) { paint('Enter your email and password.'); return; }

        go.disabled = true;
        go.textContent = mode === 'in' ? 'Signing in…' : 'Creating…';

        var work = mode === 'in'
          ? B.signIn(e, p)
          : B.signUp(e, p, (name && name.value.trim()) || e.split('@')[0]);

        work.then(function (session) {
          if (!session) {
            /* email confirmation is switched on for this project */
            paint('Account created. Check your email to confirm it, then sign in.');
            mode = 'in';
            return;
          }
          location.reload();
        }).catch(function (err) {
          paint(friendly(err));
        });
      };

      [email, pass, name].forEach(function (el) {
        if (!el) return;
        el.onkeydown = function (ev) { if (ev.key === 'Enter') go.click(); };
      });

      (name || email).focus();
    }
  }

  function friendly(err) {
    var m = (err && err.message) || String(err);
    if (/Invalid login credentials/i.test(m)) return 'That email and password combination did not match.';
    if (/User already registered/i.test(m)) return 'That email already has an account — sign in instead.';
    if (/Password should be/i.test(m)) return m;
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach Supabase. Check your connection.';
    return m;
  }

  function shortHost(url) {
    try { return new URL(url).host; } catch (e) { return url || ''; }
  }

  root.Auth = { screen: screen };
})(window);
