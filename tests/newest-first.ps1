# Newest leads first, and the choice sticking.
#
#   powershell -File tests\newest-first.ps1
#
# A batch gets imported and then worked, so the question on opening the list
# is "where is the lot I just added". The list now answers it by default.
# That changes an order people were used to, so the sort they pick has to be
# remembered - which means testing the reading back, not just the writing,
# and that needs a real second page load.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-newest"

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
  var PASS2 = 'tfs-newest-pass2';
  window.addEventListener('error', function (e) {
    errors.push(e.message + ' @' + (e.lineno || '?'));
    if (!finished) finish();
  });
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function carry() {
    try { sessionStorage.setItem('tfs-newest-lines', JSON.stringify(lines)); } catch (e) {}
  }
  function finish() {
    if (finished) return;
    finished = true;
    var earlier = [];
    try { earlier = JSON.parse(sessionStorage.getItem('tfs-newest-lines') || '[]'); } catch (e) {}
    var all = earlier.concat(lines);
    all.push((errors.length ? 'FAIL ' : 'ok   ') + 'no script errors along the way' +
             (errors.length ? ' -> ' + errors.join(' | ') : ''));
    var pre = document.createElement('pre');
    pre.id = 'nfResult';
    pre.textContent = '\n' + all.join('\n') + '\n' +
      (all.join('').indexOf('FAIL') > -1 ? 'NEWEST FAILURES' : 'NEWEST ALL PASS') + '\n';
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
  function headerNamed(text) {
    var th = document.querySelectorAll('.tbl thead th');
    for (var i = 0; i < th.length; i++) if (th[i].textContent.indexOf(text) > -1) return th[i];
    return null;
  }
  function colIndex(text) {
    var th = document.querySelectorAll('.tbl thead th');
    for (var i = 0; i < th.length; i++) if (th[i].textContent.indexOf(text) > -1) return i;
    return -1;
  }
  function names() {
    var out = [];
    document.querySelectorAll('.tbl tbody tr').forEach(function (tr) {
      out.push(tr.querySelectorAll('td')[1].textContent.trim().split('\n')[0]);
    });
    return out;
  }
  function iso(daysAgo) {
    var d = new Date(); d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && document.querySelector('#fq'))) {
      if (++tries > 400) { say('the leads screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    var second = false;
    try { second = sessionStorage.getItem(PASS2) === '1'; } catch (e) {}
    second ? afterReload() : run();
  })();

  var S;
  function seed() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    /* Deliberately inserted oldest-name-last so alphabetical order and
       newest-first order disagree - otherwise the test passes either way. */
    [['Aaron Oldest', 40], ['Mara Middle', 6], ['Zoe Newest', 0], ['Yara Yesterday', 1]]
      .forEach(function (p) {
        S.insert('leads', { name: p[0], leadStatus: 'working', rating: 'warm',
          ownerId: S.me().id, branch: '', tags: [], nextFollowUp: '',
          mockupStatus: 'none', createdAt: iso(p[1]) }, 'l', p[0]);
      });
    window.render();
  }

  function run() {
    try { localStorage.removeItem('crm:leadsort'); } catch (e) {}
    seed();
    until(function () { return document.querySelectorAll('.tbl tbody tr').length === 4 ? 1 : null; },
      'the list has the four leads', function () {
        say('there is an Added column', colIndex('Added') > -1);
        var n = names();
        say('newest is first by default', n[0] === 'Zoe Newest', n.join(' | '));
        say('  then yesterday', n[1] === 'Yara Yesterday', n[1]);
        say('  and the oldest is last', n[3] === 'Aaron Oldest', n[3]);

        var ci = colIndex('Added');
        var cells = [];
        document.querySelectorAll('.tbl tbody tr').forEach(function (tr) {
          cells.push(tr.querySelectorAll('td')[ci].textContent.trim());
        });
        say('  today says Today', cells[0] === 'Today', cells[0]);
        say('  yesterday says Yesterday', cells[1] === 'Yesterday', cells[1]);
        say('  a week back is counted in days', cells[2] === '6 days ago', cells[2]);
        say('  and further back is a date', /[A-Z][a-z]{2} \d/.test(cells[3]), cells[3]);
        flip();
      });
  }

  function flip() {
    headerNamed('Added').click();
    until(function () { return names()[0] === 'Aaron Oldest' ? 1 : null; },
      'clicking Added flips to oldest first', function () {
        headerNamed('Next Follow-Up').click();
        until(function () {
          var raw = null;
          try { raw = localStorage.getItem('crm:leadsort'); } catch (e) {}
          return raw && raw.indexOf('follow') === 0 ? raw : null;
        }, 'choosing another column is remembered', function (raw) {
          say('  stored as key and direction', raw === 'follow:1', raw);
          try {
            sessionStorage.setItem(PASS2, '1');
          } catch (e) {}
          carry();
          /* A real second load, because the reading back happens while
             leads.js is being parsed - before anything here could run. */
          location.reload();
        });
      });
  }

  function afterReload() {
    S = window.Store;
    seed();
    until(function () { return document.querySelectorAll('.tbl tbody tr').length === 4 ? 1 : null; },
      'after a reload the list is back', function () {
        var ind = headerNamed('Next Follow-Up');
        say('the remembered column is the one sorted on',
            ind && ind.querySelector('.sort-ind'),
            ind ? ind.textContent : 'no header');
        say('  and Added is no longer the sorted one',
            !headerNamed('Added').querySelector('.sort-ind'));
        /* Put it back to the default and confirm that sticks too. */
        headerNamed('Added').click();
        until(function () { return names()[0] === 'Aaron Oldest' ? 1 : null; },
          '  switching back works', function () {
            headerNamed('Added').click();
            until(function () { return names()[0] === 'Zoe Newest' ? 1 : null; },
              '  and clicking again returns to newest first', function () { finish(); });
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
$profile = "$env:TEMP\tfs-crm-newest-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1500,950 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="nfResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
