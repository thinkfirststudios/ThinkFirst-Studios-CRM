# Drives the bulk follow-up flow in headless Edge with real clicks.
#
# render-check.ps1 only proves a route draws without throwing. This proves
# the checkboxes, the action bar and the date actually work together, which
# is where a select-all that quietly selects nothing would hide.
#
#   powershell -File tests\bulk-check.ps1
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-bulk"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($item in @('index.html', 'css', 'js', 'assets')) {
  Copy-Item -Recurse -Force (Join-Path $src $item) $stage
}
Set-Content -Encoding utf8 (Join-Path $stage 'js\config.js') @'
window.CRM_CONFIG = { supabase: { url: '', anonKey: '' } };
'@

# The app scripts are injected into <head> at parse time and finish loading
# after any inline script in <body>, so the driver has to wait for the table
# rather than assume it is there.
$driver = @'
<script>
(function () {
  var lines = [];
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'bulkResult';
    pre.textContent = '\n' + lines.join('\n') +
      '\n' + (lines.join('').indexOf('FAIL') > -1 ? 'BULK FAILURES' : 'BULK ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  var tries = 0;
  (function wait() {
    var boxes = document.querySelectorAll('[data-pick]');
    if (!(window.Store && boxes.length > 1 && document.getElementById('bulkBar'))) {
      if (++tries > 400) { say('the leads table ever rendered', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run(boxes);
    finish();
  })();

  function run(boxes) {
    var S = window.Store;
    var bar = document.getElementById('bulkBar');
    var count = document.getElementById('bulkCount');
    var all = document.getElementById('pickAll');
    var total = boxes.length;

    say('the bar starts hidden', bar.hidden === true, bar.hidden);
    say('there is a select-all box', !!all);

    var id1 = boxes[0].dataset.pick, id2 = boxes[1].dataset.pick;
    boxes[0].click();
    say('one tick shows the bar', bar.hidden === false, bar.hidden);
    say('and it counts one', count.textContent === '1 lead selected', count.textContent);
    boxes[1].click();
    say('two ticks count two', count.textContent === '2 leads selected', count.textContent);
    say('select-all goes indeterminate on a partial pick',
        total === 2 ? all.checked === true : all.indeterminate === true,
        'checked=' + all.checked + ' indet=' + all.indeterminate);

    // Untick and retick so the bar has to hide and come back.
    boxes[1].click();
    say('unticking drops the count', count.textContent === '1 lead selected', count.textContent);
    boxes[0].click();
    say('unticking the last one hides the bar', bar.hidden === true, bar.hidden);
    boxes[0].click(); boxes[1].click();

    var want = S.shift(7);
    document.querySelector('[data-bulk="week"]').click();

    var a = S.find('leads', id1), b = S.find('leads', id2);
    say('the first lead moved to next week', a.nextFollowUp === want, a.nextFollowUp);
    say('the second lead moved to next week', b.nextFollowUp === want, b.nextFollowUp);
    say('neither reads as overdue',
        S.followUpState(a).key !== 'overdue' && S.followUpState(b).key !== 'overdue',
        S.followUpState(a).key);

    // The page re-rendered, so everything has to be looked up again.
    bar = document.getElementById('bulkBar');
    say('the bar cleared itself after acting', bar.hidden === true, bar.hidden);
    say('and no row is left ticked',
        [].slice.call(document.querySelectorAll('[data-pick]')).every(function (c) { return !c.checked; }));

    var act = S.all('activity').filter(function (e) {
      return String(e.detail || '').indexOf('follow-up set to') > -1;
    });
    say('it logged one line for the batch, not two', act.length === 1, act.length);

    // Select-all, then unschedule the lot.
    all = document.getElementById('pickAll');
    all.click();
    var rows = document.querySelectorAll('[data-pick]').length;
    count = document.getElementById('bulkCount');
    say('select-all takes every visible row',
        count.textContent === rows + ' lead' + (rows === 1 ? '' : 's') + ' selected',
        count.textContent + ' of ' + rows);
    document.querySelector('[data-bulk="none"]').click();
    say('unscheduling cleared every date',
        S.all('leads').filter(window.Store.isLeadOpen).every(function (l) { return !l.nextFollowUp; }));
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-bulk-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=20000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="bulkResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the page did not finish booting"
exit 1
