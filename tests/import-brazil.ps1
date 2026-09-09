# Imports the generated Brazil CSV and checks every field survives.
#
#   powershell -File tests\import-brazil.ps1
#
# import-real.ps1 does this for the US list. This one exists because the
# Brazil file is different in the ways that break importers: accented names
# and companies, social profiles instead of websites, and pipe-separated
# tags. A column that silently fails to map, or an accent mangled on the way
# in, shows up here as a named failure rather than as "some fields look odd".
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$csv   = Join-Path $src 'standby\brazil-leads.csv'
$stage = "$env:TEMP\tfs-crm-brazil"

if (-not (Test-Path $csv)) {
  Write-Output "no standby/brazil-leads.csv - run tools/parse-blocks.py first"
  exit 1
}

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($item in @('index.html', 'css', 'js', 'assets')) {
  Copy-Item -Recurse -Force (Join-Path $src $item) $stage
}
Set-Content -Encoding utf8 (Join-Path $stage 'js\config.js') @'
window.CRM_CONFIG = { supabase: { url: '', anonKey: '' } };
'@

# The whole file, header included, handed to the page as data so the driver
# reads exactly what the importer would.
$slice = (Get-Content -Path $csv -Encoding UTF8) -join "`n"
$json  = $slice | ConvertTo-Json -Compress
Set-Content -Encoding utf8 (Join-Path $stage 'js\csvdata.js') "window.__CSV = $json;"

$driver = @'
<script src="js/csvdata.js"></script>
<script>
(function () {
  var lines = [];
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function note(s) { lines.push('     ' + s); }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'brResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'BRAZIL CSV FAILURES' : 'BRAZIL CSV ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function until(get, label, then) {
    var n = 0;
    (function spin() {
      var got = get();
      if (got) { say(label, true); return then(got); }
      if (++n > 1000) { say(label, false, 'timed out'); return finish(); }
      setTimeout(spin, 20);
    })();
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && window.Views.leads.openImport
          && document.querySelector('#importBtn') && window.__CSV)) {
      if (++tries > 400) { say('the leads screen and the csv both loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;
    var before = S.all('leads').length;
    var rows = window.__CSV.split('\n').filter(function (l) { return l.trim(); });
    note('csv: ' + (rows.length - 1) + ' data rows');

    window.Views.leads.openImport(function () {});
    var box = document.querySelector('.modal-root');

    /* The branch has to be settable from the import dialog, or an admin
       importing on a branch manager's behalf files the whole list in their
       own branch and the manager never sees it. */
    var br = box.querySelector('[name=branch]');
    say('the import dialog carries a branch', !!br);
    if (br) { br.value = 'Brazil'; }

    var d = box.querySelector('[name=nextFollowUp]'); if (d) d.value = '';
    box.querySelector('[name=raw]').value = window.__CSV;
    box.querySelector('[data-ok]').click();

    until(function () { return document.querySelector('#impMap'); },
      'the mapping dialog opened', function () { mapped(S, before, rows.length - 1); });
  }

  function mapped(S, before, expected) {
    function picked(field) {
      var sel = document.querySelector('[data-field="' + field + '"]');
      if (!sel || sel.value === '') return '(not mapped)';
      return sel.options[sel.selectedIndex].text;
    }
    [['name', 'Company'], ['contactName', 'Contact'], ['email', 'Email'],
     ['phone', 'Phone'], ['website', 'Website'], ['address', 'Location'],
     ['industry', 'Industry'], ['source', 'Source'], ['tagsCol', 'Tags'],
     ['noteText', 'Note'], ['instagram', 'Instagram'], ['facebook', 'Facebook']
    ].forEach(function (p) {
      say(p[0] + ' -> ' + p[1], picked(p[0]) === p[1], picked(p[0]));
    });

    var oks = document.querySelectorAll('.modal-root [data-ok]');
    oks[oks.length - 1].click();
    until(function () { return S.all('leads').length > before || null; },
      'the import committed', function () { check(S, before, expected); });
  }

  function check(S, before, expected) {
    var added = S.all('leads').length - before;
    say('all one hundred rows landed', added === expected, added + ' of ' + expected);

    function by(name) {
      return S.all('leads').filter(function (l) { return l.contactName === name; })[0];
    }

    /* Accents are the thing most likely to arrive as mojibake, and the
       symptom is a mangled name on a call sheet - embarrassing in front of
       a prospect rather than merely wrong. */
    var e = by('\u00c9rico Leite Hatada');
    say('an accented contact name survived', !!e);
    if (e) {
      say('  with his company', e.name === 'Gralha Im\u00f3veis', e.name);
      say('  his email', e.email === 'erico.hatada@gralhavendas.com.br', e.email);
      say('  his phone', e.phone === '(48) 98847-7428', JSON.stringify(e.phone));
      say('  and both tags', S.hasTag(e, 'Florian\u00f3polis') && S.hasTag(e, 'Santa Catarina'),
          (e.tags || []).join('|'));
    }
    say('a c-cedilha survived', !!by('Luciano da Concei\u00e7\u00e3o'));
    say('and a tilde', !!by('C\u00e9lia de Oliveira Elias'));

    /* Social profiles are the only channel for a third of this list, so a
       dropped Instagram handle is a lead nobody can reach. */
    var i = by('Let\u00edcia Miranda');
    say('an Instagram-only lead imported', !!i);
    if (i) {
      say('  with her handle', /corretoraleticiamiranda/.test(i.instagram || ''),
          JSON.stringify(i.instagram));
      say('  and no fake website', !i.website, JSON.stringify(i.website));
    }
    var f = by('Gisele Porto');
    say('a Facebook page came through', f && /Giseleporto26/.test(f.facebook || ''),
        f && JSON.stringify(f.facebook));

    var ig = S.all('leads').filter(function (l) { return l.instagram; }).length;
    var fb = S.all('leads').filter(function (l) { return l.facebook; }).length;
    note('instagram on ' + ig + ' leads, facebook on ' + fb);
    say('the Instagram column was not silently dropped', ig >= 25, ig);

    /* A comma inside a quoted cell is the classic column-shift bug, and
       this file is full of them - every Location has one. */
    var k = by('Kleber Vinicius Kupas');
    say('a quoted comma did not shift the columns',
        k && k.address === 'Am\u00e9rica, Joinville, SC' && k.industry === 'Real Estate',
        k && (k.address + ' / ' + k.industry));

    var brazil = S.all('leads').filter(function (l) { return l.branch === 'Brazil'; }).length;
    say('every imported lead is in the Brazil branch', brazil === expected,
        brazil + ' of ' + expected);

    var withPhone = S.all('leads').filter(function (l) {
      return l.branch === 'Brazil' && l.phone;
    }).length;
    note('phones present on ' + withPhone + ' of ' + expected);
    say('the phone count matches what the parser reported', withPhone === 56, withPhone);

    say('every row got the industry', S.all('leads')
        .filter(function (l) { return l.branch === 'Brazil'; })
        .every(function (l) { return l.industry === 'Real Estate'; }));

    say('and every row has exactly two tags', S.all('leads')
        .filter(function (l) { return l.branch === 'Brazil'; })
        .every(function (l) { return (l.tags || []).length === 2; }));

    say('nobody landed without a next step being optional',
        S.all('leads').filter(function (l) { return l.branch === 'Brazil'; })
          .every(function (l) { return !l.nextFollowUp; }));

    finish();
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-brazil-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="brResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the import did not finish"
exit 1
