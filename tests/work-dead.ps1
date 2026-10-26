# Marking several Work To Build requests dead at once, on the home screen.
#
#   powershell -File tests\work-dead.ps1
#
# Fifteen requests: checks Show all brings in the ones past the first
# twelve, the header box ticks them all, and Mark dead closes exactly
# the ticked ones.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-work"

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
    pre.id = 'wdResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'WORK FAILURES' : 'WORK ALL PASS') + '\n';
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
    if (!(window.Store && window.Views && document.querySelector('.page-head'))) {
      if (++tries > 400) { say('the home screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S;
  function day(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    var ids = [];
    for (var i = 0; i < 14; i++) {
      ids.push(S.insert('leads', { name: 'Build ' + i, source: 'Test', ownerId: S.me().id,
        lastContactedAt: '', nextFollowUp: '', leadStatus: 'new', branch: '', tags: [], rating: 'warm',
        mockupStatus: 'requested', mockupRequestedAt: day(-20 + i),
        createdAt: day(-30) + 'T09:00:00.000Z' }, 'l', 'L').id);
    }
    var keep = S.insert('leads', { name: 'Keep Me', source: 'Test', ownerId: S.me().id,
      lastContactedAt: '', nextFollowUp: '', leadStatus: 'working', branch: '', tags: [], rating: 'warm',
      mockupStatus: 'inprogress', mockupRequestedAt: day(-1),
      createdAt: day(-30) + 'T09:00:00.000Z' }, 'l', 'L').id;
    window.render();
    until(function () { return document.querySelector('#workCard [data-workall="1"]'); },
      'Work To Build offers to show the whole queue', function (b) {
        say('  twelve rows to start with', document.querySelectorAll('#workCard [data-workpick]').length === 12,
            document.querySelectorAll('#workCard [data-workpick]').length);
        b.click();
        until(function () { return document.querySelectorAll('#workCard [data-workpick]').length === 15 ? 1 : null; },
          'Show all lists all fifteen', function () {
            var card = document.querySelector('#workCard');
            card.querySelector('#workAll').click();
            say('the header box ticks every row', card.querySelector('#workCount').textContent === '15 selected',
                card.querySelector('#workCount').textContent);
            card.querySelector('[data-workpick="' + keep + '"]').click();
            say('  and one can be unticked again', card.querySelector('#workCount').textContent === '14 selected');
            card.querySelector('#workDead').click();
            until(function () { return document.querySelector('.modal-root [name=lostReason]'); }, 'Mark dead asks why', function () {
              document.querySelector('.modal-root [data-ok]').click();
              until(function () { return ids.every(function (id) { return S.find('leads', id).leadStatus === 'dead'; }) ? 1 : null; },
                'all fourteen ticked requests are Dead', function () {
                  say('the unticked one is untouched', S.find('leads', keep).leadStatus === 'working');
                  until(function () {
                    var c = document.querySelector('#workCard');
                    return c && c.querySelectorAll('[data-workpick]').length === 1 ? c : null;
                  }, 'Work To Build is down to the one left', function () { finish(); });
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
$profile = "$env:TEMP\tfs-crm-work-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1500,950 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/dashboard" 2>$null | Out-String

if ($dom -match '(?s)<pre id="wdResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
