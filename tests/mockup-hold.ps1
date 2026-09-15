# Holding a mockup back, through the real Leads page.
#
#   powershell -File tests\mockup-hold.ps1
#
# Rules live in tests/mockup-hold.js. This clicks Hold on the ready card,
# checks the mockup folds away under "On hold" with a count still showing,
# opens that section, and brings it back with "Back to ready".
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-hold"

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
    pre.id = 'hdResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'HOLD FAILURES' : 'HOLD ALL PASS') + '\n';
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
  function readyCard() {
    return [].filter.call(document.querySelectorAll('.card'), function (c) {
      var t = c.querySelector('.card-title');
      return t && t.textContent === 'Mockups Ready To Send';
    })[0] || null;
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, casa;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    function mk(name) {
      return S.insert('leads', { name: name, leadStatus: 'contacted', rating: 'warm', ownerId: S.me().id,
        branch: '', tags: [], nextFollowUp: S.shift(3), mockupStatus: 'ready',
        mockupUrl: 'https://example.com/' + name.toLowerCase().replace(/ /g, '-') + '/',
        mockupTypes: ['Website'], mockupReadyAt: S.shift(-3), mockupSentAt: '' }, 'l', name);
    }
    casa = mk('Casa Mare Floripa');
    mk('Cris Hotel');
    window.render();

    until(function () {
      var c = readyCard();
      return c && c.querySelectorAll('[data-holdmockup]').length === 2 ? c : null;
    }, 'both mockups on the ready card, each with a Hold button', function (card) {
      say('  and no On hold section yet', !card.querySelector('[data-toggleheld]'));
      card.querySelector('[data-holdmockup="' + casa.id + '"]').click();
      until(function () {
        var c = readyCard();
        return c && c.querySelector('[data-toggleheld]') ? c : null;
      }, 'Hold folds it away under "On hold"', afterHold);
    });
  }

  function afterHold(card) {
    say('  it left the ready rows', !card.querySelector('[data-holdmockup="' + casa.id + '"]'));
    say('  the ready count is one', card.querySelector('.card-head .kcol-count').textContent === '1',
        card.querySelector('.card-head .kcol-count').textContent);
    var toggle = card.querySelector('[data-toggleheld]');
    say('  the On hold count shows one', /1/.test(toggle.textContent), toggle.textContent);
    say('  folded by default, so it stops asking', !card.querySelector('[data-heldrow]'));
    say('  and the lead is On hold', S.find('leads', casa.id).mockupStatus === 'hold');

    toggle.click();
    until(function () {
      var c = readyCard();
      return c && c.querySelector('[data-heldrow="' + casa.id + '"]') ? c : null;
    }, 'opening "On hold" lists it', function (c) {
      var row = c.querySelector('[data-heldrow="' + casa.id + '"]');
      say('  with its View link still there', !!row.querySelector('a[href*="casa-mare-floripa"]'));
      row.querySelector('[data-unholdmockup]').click();
      until(function () {
        var c2 = readyCard();
        return c2 && c2.querySelector('[data-holdmockup="' + casa.id + '"]') && !c2.querySelector('[data-toggleheld]') ? c2 : null;
      }, 'Back to ready returns it to the ready card', function () {
        say('  and the lead is ready again', S.find('leads', casa.id).mockupStatus === 'ready');
        var sel = document.querySelector('#fmockup');
        say('the table filter offers On hold, for finding them all', !!(sel &&
            [].some.call(sel.options, function (o) { return o.value === 'hold'; })));
        finish();
      });
    });
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-hold-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="hdResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
