# Marking several Follow Up Now leads dead at once, through the real screen.
#
#   powershell -File teststtention-dead.ps1
#
# Ticks two of three overdue leads, marks them Dead with one reason, and
# checks that only those two closed, both carry the reason, and the queue
# is left with the one that was not ticked.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-attn"

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
    pre.id = 'adResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'DEAD FAILURES' : 'DEAD ALL PASS') + '\n';
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
  function chipFor(name) {
    var all = document.querySelectorAll('#listBar [data-list]');
    for (var i = 0; i < all.length; i++) if (all[i].dataset.list === name) return all[i];
    return null;
  }
  function bodyRows() { return document.querySelectorAll('.tbl tbody tr').length; }
  function day(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && document.querySelector('#fq'))) {
      if (++tries > 400) { say('the leads screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S;
  function day(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    var ids = ['Gone One', 'Gone Two', 'Still Here'].map(function (n) {
      return S.insert('leads', { name: n, source: 'Test', ownerId: S.me().id,
        lastContactedAt: day(-40), nextFollowUp: day(-30), leadStatus: 'new', branch: '',
        tags: [], rating: 'warm', mockupStatus: 'none', createdAt: day(-50) + 'T09:00:00.000Z' }, 'l', 'L').id;
    });
    window.render();
    until(function () { return document.querySelector('#attnCard'); }, 'Follow Up Now is on the leads screen', function (card) {
      say('  every row has a tick box', card.querySelectorAll('[data-attnpick]').length === 3,
          card.querySelectorAll('[data-attnpick]').length);
      say('  and the Mark dead button waits until something is ticked',
          card.querySelector('#attnBulk').style.display === 'none');
      card.querySelector('[data-attnpick="' + ids[0] + '"]').click();
      card.querySelector('[data-attnpick="' + ids[1] + '"]').click();
      say('ticking two shows the button', card.querySelector('#attnBulk').style.display !== 'none');
      say('  with the count', card.querySelector('#attnCount').textContent === '2 selected',
          card.querySelector('#attnCount').textContent);
      say('  and the header box reads as partly ticked', card.querySelector('#attnAll').indeterminate);
      card.querySelector('#attnDead').click();
      until(function () { return document.querySelector('.modal-root [name=lostReason]'); }, 'Mark dead asks why', function (inp) {
        inp.value = 'Never answered';
        document.querySelector('.modal-root [data-ok]').click();
        until(function () { return S.find('leads', ids[0]).leadStatus === 'dead' ? 1 : null; },
          'the ticked leads are Dead', function () {
            say('  both of them', S.find('leads', ids[1]).leadStatus === 'dead');
            say('  with the reason', S.find('leads', ids[0]).lostReason === 'Never answered' &&
                S.find('leads', ids[1]).lostReason === 'Never answered');
            say('the unticked lead is untouched', S.find('leads', ids[2]).leadStatus === 'new');
            until(function () {
              var c = document.querySelector('#attnCard');
              return c && c.querySelectorAll('[data-attnpick]').length === 1 ? c : null;
            }, 'the queue is down to the one left', function (c) {
              say('  and nothing is still ticked', !c.querySelector('[data-attnpick]:checked') &&
                  c.querySelector('#attnBulk').style.display === 'none');
              finish();
            });
          });
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
$profile = "$env:TEMP\tfs-crm-attn-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1500,950 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="adResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
