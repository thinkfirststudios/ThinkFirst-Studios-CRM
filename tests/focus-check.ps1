# Typing has to survive the repaint.
#
#   powershell -File tests\focus-check.ps1
#
# The search box searches 220ms after a keystroke by rebuilding the screen -
# which replaced the box being typed in. The text came back, because it lives
# in the filter state, but the cursor did not, so it was one letter, click
# back in, one letter, click back in. On every filter box in the CRM.
#
# Typed here one character at a time, with the real debounce in between,
# because the bug only appears once a repaint lands mid-word.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-focus"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($item in @('index.html', 'css', 'js', 'assets')) {
  Copy-Item -Recurse -Force (Join-Path $src $item) $stage
}
Set-Content -Encoding utf8 (Join-Path $stage 'js\config.js') @'
window.CRM_CONFIG = { supabase: { url: '', anonKey: '' } };
'@

$driver = @'
<script>
(function () {
  var lines = [], errors = [], finished = false;
  window.addEventListener('error', function (e) {
    errors.push(e.message + ' @' + (e.lineno || '?'));
    if (!finished) finish();
  });
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function finish() {
    if (finished) return;
    finished = true;
    say('no script errors along the way', !errors.length, errors.join(' | '));
    var pre = document.createElement('pre');
    pre.id = 'fcResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'FOCUS FAILURES' : 'FOCUS ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function until(get, label, then) {
    var n = 0;
    (function spin() {
      var got;
      try { got = get(); } catch (e) { got = null; }
      if (got) { say(label, true); return then(got); }
      if (++n > 500) { say(label, false, 'timed out'); return finish(); }
      setTimeout(spin, 20);
    })();
  }

  /* One letter at a time, 300ms apart - longer than the 220ms the box waits,
     so a repaint lands between every keystroke, exactly as it does when a
     person types a name. */
  function typeInto(id, text, done) {
    var i = 0;
    (function next() {
      var box = document.getElementById(id);
      if (!box) { say('the box ' + id + ' is still there', false); return finish(); }
      box.focus();
      box.value += text.charAt(i);
      try { box.setSelectionRange(box.value.length, box.value.length); } catch (e) {}
      box.dispatchEvent(new Event('input', { bubbles: true }));
      i++;
      if (i < text.length) return setTimeout(next, 300);
      setTimeout(function () { done(); }, 320);
    })();
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && document.querySelector('#fq'))) {
      if (++tries > 400) { say('the leads screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    ['Zafonte Realty', 'Quarles Group', 'Novack Homes', 'Kosier & Co'].forEach(function (n) {
      S.insert('leads', { name: n, leadStatus: 'contacted', rating: 'warm', ownerId: S.me().id,
        branch: '', tags: [], nextFollowUp: S.shift(3), mockupStatus: 'none' }, 'l', n);
    });
    /* Enough rows that a repaint is real work, as it is with a full book. */
    var bulk = [];
    for (var i = 0; i < 600; i++) {
      bulk.push({ name: 'Filler ' + i, leadStatus: 'new', rating: 'cold', ownerId: S.me().id,
        branch: '', tags: [], nextFollowUp: S.shift(9), mockupStatus: 'none' });
    }
    S.insertMany('leads', bulk, 'l', 'filler');
    window.render();

    typeInto('fq', 'Zafonte', function () {
      var box = document.getElementById('fq');
      say('the whole word arrived', box.value === 'Zafonte', box.value);
      say('the box still has the cursor after the list redrew', document.activeElement === box,
          document.activeElement ? document.activeElement.id || document.activeElement.tagName : 'none');
      say('  with the caret at the end, not lost', box.selectionStart === 'Zafonte'.length, box.selectionStart);
      say('and it actually searched', document.querySelectorAll('.tbl tbody tr').length === 1,
          document.querySelectorAll('.tbl tbody tr').length);
      elsewhere();
    });
  }

  function elsewhere() {
    /* The same box on another screen, since the fix is in the shell rather
       than on the leads page. */
    location.hash = '#/accounts';
    /* Wait for the accounts screen itself, not just for "a box with this id
       exists" - the leads box is still on the page until the swap lands, and
       typing into that one loses the first letter. */
    until(function () {
      var t = document.querySelector('.page-title');
      return t && /Account/i.test(t.textContent) && document.querySelector('#fq');
    }, 'the accounts screen has a search box too', function () {
      typeInto('fq', 'Sono', function () {
        var box = document.getElementById('fq');
        say('typing there keeps the cursor as well', document.activeElement === box,
            document.activeElement ? document.activeElement.id || document.activeElement.tagName : 'none');
        say('  and the text is whole', box.value === 'Sono', box.value);
        dialog();
      });
    });
  }

  function dialog() {
    /* A repaint while a dialog is open must not drag the cursor back out of
       it and into the screen behind. */
    location.hash = '#/leads';
    until(function () { return document.querySelector('#newLead'); }, 'back on leads', function (btn) {
      btn.click();
      var m = document.querySelector('.modal-root');
      var field = m && m.querySelector('[name=name]');
      say('the new lead dialog opened', !!field);
      field.focus();
      window.render();
      setTimeout(function () {
        say('a repaint leaves the dialog holding the cursor', document.activeElement === field,
            document.activeElement ? (document.activeElement.name || document.activeElement.id || document.activeElement.tagName) : 'none');
        finish();
      }, 60);
    });
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-focus-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1400,900 --user-data-dir=$profile `
  --virtual-time-budget=90000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="fcResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
