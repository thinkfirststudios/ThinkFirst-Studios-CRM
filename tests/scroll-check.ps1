# Scroll position surviving a repaint.
#
#   powershell -File tests\scroll-check.ps1
#
# render() is not only navigation - it is also how the app repaints after
# any change, including one that arrived over realtime from somebody else.
# It used to scrollTo(0,0) every time, so reading down a long list and
# having an unrelated edit land threw you back to the top a second later.
#
# Only a real viewport has a scroll position, so this has to run in a
# browser rather than against the store.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-scroll"

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
  var lines = [];
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function note(s) { lines.push('     ' + s); }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'scrollResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'SCROLL FAILURES' : 'SCROLL ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function y() { return window.scrollY || document.documentElement.scrollTop || 0; }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.render && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the leads screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;

    // Enough rows that there is somewhere to scroll to.
    var batch = [];
    for (var i = 0; i < 600; i++) {
      batch.push({
        name: 'Realtor ' + i, contactName: 'Realtor ' + i, contactTitle: 'Realtor',
        email: 'r' + i + '@example.com', phone: '(555) 555-' + (1000 + i),
        website: '', instagram: '', tiktok: '', facebook: '',
        address: 'Somewhere', industry: 'Real Estate', source: 'Realtor List',
        estValue: 0, leadStatus: 'new', rating: 'cold', ownerId: S.me().id,
        nextFollowUp: '', lastContactedAt: '', tags: ['realtor'],
        convertedCustomerId: '', convertedAt: ''
      });
    }
    S.insertMany('leads', batch, 'l', 'scroll fixture');
    window.render();

    var tall = document.body.scrollHeight > window.innerHeight + 400;
    say('the page is long enough to scroll', tall, document.body.scrollHeight + 'px');
    if (!tall) return finish();

    window.scrollTo(0, 900);
    var parked = y();
    say('we are scrolled down', parked > 400, parked);

    // A repaint on the same screen - what a realtime event triggers.
    window.render();
    say('a repaint leaves the scroll position alone', Math.abs(y() - parked) < 5,
        'was ' + parked + ', now ' + y());

    // And again, a few times, the way a burst of events would.
    for (var k = 0; k < 5; k++) window.render();
    say('so does a burst of them', Math.abs(y() - parked) < 5, y());

    // Editing a lead repaints too, and must not move the page either.
    var first = S.all('leads')[0];
    S.update('leads', first.id, { rating: 'warm' }, 'test');
    window.render();
    say('an edit repaint holds position too', Math.abs(y() - parked) < 5, y());

    // Navigating, on the other hand, SHOULD go to the top.
    location.hash = '#/accounts';
    setTimeout(function () {
      say('changing screen scrolls to the top', y() === 0, y());

      // ...and coming back to a screen also starts at the top.
      window.scrollTo(0, 300);
      location.hash = '#/leads';
      setTimeout(function () {
        say('and so does coming back', y() === 0, y());
        finish();
      }, 60);
    }, 60);
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-scroll-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --window-size=1280,900 --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --window-size=1280,900 --virtual-time-budget=30000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="scrollResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the page did not finish booting"
exit 1
