# Importing a real-sized list through the real dialog.
#
#   powershell -File tests\import-scale.ps1
#
# import-check.ps1 proves six rows map and land correctly. Six rows cannot
# show what this one is for: the import committing 2,526 rows, each carrying
# a note, without melting. Writing notes one at a time cost two requests and
# a whole-app re-render per row, so a file this size froze the tab for
# minutes and looked like nothing had happened.
#
# The budget below is deliberately far above what a batched import needs and
# far below what a per-row one takes, so it fails loudly if the loop ever
# comes back rather than merely getting slower.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-impscale"

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
  var N = 2526;
  var BUDGET_MS = 8000;
  var lines = [];
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function note(s) { lines.push('     ' + s); }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'impScaleResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'IMPORT SCALE FAILURES' : 'IMPORT SCALE ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function until(get, label, then) {
    var n = 0;
    (function spin() {
      var got = get();
      if (got) { say(label, true); return then(got); }
      if (++n > 2000) { say(label, false, 'timed out'); return finish(); }
      setTimeout(spin, 20);
    })();
  }

  // The real header row, and a note on every line - the shape of the file
  // that actually caused the trouble.
  function buildCsv() {
    var out = ['name,contactName,contactTitle,email,phone,website,industry,address,rating,source,tags,notes'];
    for (var i = 0; i < N; i++) {
      out.push('Realtor ' + i + ',Realtor ' + i + ',Realtor,realtor' + i +
        '@example.com,(555) 555-' + (1000 + (i % 9000)) + ',site' + i +
        '.com,Real Estate,Somewhere,cold,Realtor List,realtor|own-site,' +
        'From the realtor contact list. Site: site' + i + '.com. Up to date: Not yet checked.');
    }
    return out.join('\n');
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && window.Views.leads.openImport
          && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the leads screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;
    var before = S.all('leads').length;
    var notesBefore = S.all('notes').length;
    var actsBefore = S.all('activity').length;
    var CSV = buildCsv();
    note('csv is ' + (CSV.length / 1048576).toFixed(2) + ' MB, ' + N + ' rows');

    window.Views.leads.openImport(function () {});
    var box = document.querySelector('.modal-root');
    var d = box.querySelector('[name=nextFollowUp]'); if (d) d.value = '';
    box.querySelector('[name=raw]').value = CSV;

    var tParse = Date.now();
    box.querySelector('[data-ok]').click();

    until(function () { return document.querySelector('#impMap'); },
      'the mapping dialog opened', function () {
        note('parse + map took ' + (Date.now() - tParse) + 'ms');
        commit(S, before, notesBefore, actsBefore);
      });
  }

  function commit(S, before, notesBefore, actsBefore) {
    var oks = document.querySelectorAll('.modal-root [data-ok]');
    var t = Date.now();
    oks[oks.length - 1].click();

    until(function () { return S.all('leads').length > before || null; },
      'the import committed', function () {
        var ms = Date.now() - t;
        note('commit took ' + ms + 'ms');

        var added = S.all('leads').length - before;
        say('every row landed', added === N, added);
        say('a note came with each of them',
            S.all('notes').length - notesBefore === N, S.all('notes').length - notesBefore);

        // The real regression guard. One entry for the leads, one for the
        // notes - not one per row.
        var acts = S.all('activity').length - actsBefore;
        say('it logged 2 activity entries, not thousands', acts === 2, acts);

        say('it finished inside ' + BUDGET_MS + 'ms', ms < BUDGET_MS, ms + 'ms');

        var sample = S.all('leads').filter(function (l) { return l.email === 'realtor7@example.com'; })[0];
        say('a sampled lead kept its tags',
            sample && S.hasTag(sample, 'own-site'), sample && (sample.tags || []).join('|'));
        say('and its note is attached to it',
            sample && S.notesFor('lead', sample.id).length === 1,
            sample && S.notesFor('lead', sample.id).length);
        say('none of them got a follow-up date',
            S.all('leads').filter(function (l) { return l.source === 'Realtor List'; })
              .every(function (l) { return !l.nextFollowUp; }));
        // Only the imported ones - the seeded demo leads have their own
        // dates and are legitimately due.
        say('and none of them is in the follow-up queue',
            S.leadsNeedingAttention().filter(function (l) {
              return l.source === 'Realtor List';
            }).length === 0,
            S.leadsNeedingAttention().filter(function (l) {
              return l.source === 'Realtor List';
            }).length);

        var tR = Date.now();
        window.render();
        note('redrawing the full list took ' + (Date.now() - tR) + 'ms');
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
$profile = "$env:TEMP\tfs-crm-impscale-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=120000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="impScaleResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the import did not finish"
exit 1
