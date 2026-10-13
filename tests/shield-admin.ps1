# Who gets the cover when the CRM loses focus, clicked in a real browser.
#
#   powershell -File tests\shield-admin.ps1
#
# An admin alt-tabs between the CRM and a spreadsheet all day, and the
# cover fired every time - so the deterrent read as a fault in the app,
# which is how a protection ends up switched off altogether. Admins are
# now exempt from the COVER only.
#
# This is a security control, so the exemption needs holding to exactly
# what it is. What must stay true:
#
#   · a rep still gets the cover on blur
#   · an admin does not
#   · the WATERMARK still stamps the admin's screen - that is the layer
#     that makes a capture traceable, and it is the only one that does
#     anything on a phone
#   · an unknown or signed-out user gets the cover, not the exemption
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-shield"

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
  var lines = [], errors = [];
  window.addEventListener('error', function (e) { errors.push(e.message); });
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function finish() {
    say('no script errors along the way', !errors.length, errors.join(' | '));
    var pre = document.createElement('pre');
    pre.id = 'shieldResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'SHIELD FAILURES' : 'SHIELD ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function covered() {
    return document.body.getAttribute('data-shield-hidden') === '1';
  }
  function watermarked() {
    var w = document.querySelector('.shield-watermark');
    return !!(w && !w.hidden);
  }
  function blur()  { window.dispatchEvent(new Event('blur')); }
  function focus() { window.dispatchEvent(new Event('focus')); }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.ScreenShield && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app and the shield loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S;
  function run() {
    S = window.Store;
    say('the shield is switched on', window.ScreenShield.enabled() === true);

    if (!S.find('users', 'rep1')) {
      S.insert('users', { id: 'rep1', name: 'Rita Rep', role: 'rep', active: true, branch: '' }, 'u', 'Rita');
    }
    var admin = S.all('users').filter(function (u) { return u.role === 'admin'; })[0];
    if (!admin) { say('there is an admin to test with', false); return finish(); }

    /* A rep first - the control case. */
    S.setMe('rep1');
    location.hash = '#/leads';
    window.render();
    setTimeout(function () {
      say('a rep is on the leads screen', location.hash.indexOf('leads') > -1);
      blur();
      setTimeout(function () {
        say('a rep DOES get the cover on blur', covered(), 'covered=' + covered());
        focus();
        setTimeout(function () {
          say('  and it lifts again on focus', !covered());
          adminTurn(admin);
        }, 60);
      }, 60);
    }, 120);
  }

  function adminTurn(admin) {
    S.setMe(admin.id);
    location.hash = '#/leads';
    window.render();
    setTimeout(function () {
      say('an admin is on the leads screen', location.hash.indexOf('leads') > -1);
      say('  and is an admin', S.isAdmin() === true);
      blur();
      setTimeout(function () {
        say('an admin does NOT get the cover on blur', !covered(), 'covered=' + covered());
        say('  but the watermark is still on the screen', watermarked(),
            'watermark present=' + watermarked());
        focus();
        setTimeout(function () {
          say('  and nothing is left stuck on screen afterwards', !covered());
          signedOut();
        }, 60);
      }, 80);
    }, 120);
  }

  /* The exemption must be an exemption, not a hole. With no session the
     shield has no role to read, and the answer has to be "cover it". */
  function signedOut() {
    var realIsAdmin = S.isAdmin;
    S.isAdmin = function () { throw new Error('no session'); };
    blur();
    setTimeout(function () {
      say('a user the shield cannot identify still gets the cover', covered(),
          'covered=' + covered());
      S.isAdmin = realIsAdmin;
      focus();
      setTimeout(finish, 60);
    }, 80);
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-shield-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="shieldResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
