# Picking a list to work, through the real leads screen.
#
#   powershell -File tests\lead-lists.ps1
#
# Counts live in tests/lead-lists.js. This checks the bar is actually on the
# page, that clicking a list narrows the table to it, that the chip and the
# old source dropdown never disagree about what is showing, and that the bar
# stays out of the way when there is only one list to pick.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-lists"

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
    pre.id = 'llResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'LIST FAILURES' : 'LIST ALL PASS') + '\n';
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
  function seed(many) {
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    function mk(source, called, added) {
      S.insert('leads', { name: 'L' + Math.random().toString(36).slice(2, 7), source: source,
        ownerId: S.me().id, lastContactedAt: called || '', nextFollowUp: '',
        leadStatus: 'working', branch: '', tags: [], rating: 'warm', mockupStatus: 'none',
        createdAt: (added || day(-5)) + 'T09:00:00.000Z' }, 'l', 'L');
    }
    mk('Texas Mortgage LOs', '', day(0));
    mk('Texas Mortgage LOs', '', day(0));
    mk('Texas Mortgage LOs', '', day(0));
    if (many) {
      mk('Realtor List', day(-2), day(-30));
      mk('Realtor List', '', day(-30));
    }
    window.render();
  }

  function run() {
    S = window.Store;
    seed(true);
    until(function () { return document.querySelector('#listBar'); }, 'the leads screen has a list bar', function () {
      say('  with a chip per list plus All',
          document.querySelectorAll('#listBar [data-list]').length === 3,
          document.querySelectorAll('#listBar [data-list]').length);
      var tx = chipFor('Texas Mortgage LOs');
      say('  the list is named on its chip', !!tx);
      say('  and says how many are left to call',
          tx && tx.textContent.indexOf('3 left') > -1, tx ? tx.textContent : '');
      var rl = chipFor('Realtor List');
      say('  a part-worked list counts only what is left',
          rl && rl.textContent.indexOf('1 left') > -1, rl ? rl.textContent : '');
      say('All is the one selected to start with',
          chipFor('').className.indexOf('btn-primary') > -1, chipFor('').className);
      say('  and the table shows everything', bodyRows() === 5, bodyRows());
      pick();
    });
  }

  function pick() {
    chipFor('Texas Mortgage LOs').click();
    until(function () { return bodyRows() === 3 ? 1 : null; },
      'clicking a list narrows the table to it', function () {
        say('  the chip is now the selected one',
            chipFor('Texas Mortgage LOs').className.indexOf('btn-primary') > -1);
        say('  and All is not', chipFor('').className.indexOf('btn-primary') === -1);
        /* The old dropdown drives the same filter - if they disagreed, the
           screen would be showing one thing and reporting another. */
        var sel = document.querySelector('#fsource');
        say('  the source dropdown agrees', sel && sel.value === 'Texas Mortgage LOs',
            sel ? sel.value : 'no dropdown');
        back();
      });
  }

  function back() {
    chipFor('').click();
    until(function () { return bodyRows() === 5 ? 1 : null; }, 'All puts everything back', function () {
      var sel = document.querySelector('#fsource');
      say('  and clears the dropdown with it', sel && sel.value === '', sel ? sel.value : '?');
      /* Going the other way round has to work too. */
      sel.value = 'Realtor List';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      until(function () { return bodyRows() === 2 ? 1 : null; },
        'choosing from the dropdown narrows it as well', function () {
          say('  and lights the matching chip',
              chipFor('Realtor List').className.indexOf('btn-primary') > -1);
          single();
        });
    });
  }

  function single() {
    /* Still filtered to Realtor List from the step before, and that list is
       about to stop existing. A filter nobody can see is the worst kind:
       the table is empty and nothing on screen says why. */
    seed(false);
    until(function () { return document.querySelector('.tbl tbody tr'); },
      'a list that no longer exists stops filtering', function () {
        say('  the leads are listed rather than an empty table', bodyRows() === 3, bodyRows());
        var sel = document.querySelector('#fsource');
        say('  and the dropdown is back to All sources', !sel || sel.value === '',
            sel ? sel.value : 'no dropdown');
        /* One list is not a choice, so the bar should not take up the room. */
        say('with only one list the bar is not shown', !document.querySelector('#listBar'),
            document.querySelector('#listBar') ? 'still there' : '');
        finish();
      });
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-lists-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1500,950 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="llResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
