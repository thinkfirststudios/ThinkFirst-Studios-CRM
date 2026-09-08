# Imports the real generated CSV and checks every field survives.
#
#   powershell -File tests\import-real.ps1
#
# import-scale.ps1 uses rows this script generates, which proves the machinery
# but not the file. This one takes the actual Realtor-Contact-List.csv off
# disk, feeds a slice of it through the real dialog, and reads named people
# back out - so a column that silently fails to map, or a value mangled on the
# way in, shows up as a named failure rather than as "some fields look empty".
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$csv   = Join-Path $src 'Realtor-Contact-List.csv'
$stage = "$env:TEMP\tfs-crm-real"

if (-not (Test-Path $csv)) {
  Write-Output "no Realtor-Contact-List.csv in the project root - run tools/parse-realtor-pdf.py first"
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

# A slice of the real file, header included, handed to the page as data so
# the driver reads exactly what the importer would.
$slice = (Get-Content -Path $csv -TotalCount 201) -join "`n"
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
    pre.id = 'realResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'REAL CSV FAILURES' : 'REAL CSV ALL PASS') + '\n';
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
    note('csv slice: ' + (rows.length - 1) + ' data rows');
    note('header: ' + rows[0]);

    window.Views.leads.openImport(function () {});
    var box = document.querySelector('.modal-root');
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
    // Every column the file actually carries, named, so a mis-map is obvious.
    [['name', 'name'], ['contactName', 'contactName'], ['contactTitle', 'contactTitle'],
     ['email', 'email'], ['phone', 'phone'], ['website', 'website'],
     ['industry', 'industry'], ['address', 'address'], ['source', 'source'],
     ['rating', 'rating'], ['tagsCol', 'tags'], ['noteText', 'notes']
    ].forEach(function (p) {
      say(p[0] + ' -> ' + p[1], picked(p[0]) === p[1], picked(p[0]));
    });

    var oks = document.querySelectorAll('.modal-root [data-ok]');
    oks[oks.length - 1].click();
    until(function () { return S.all('leads').length > before || null; },
      'the import committed', function () { check(S, before, expected); });
  }

  function check(S, before, expected) {
    /* The real file contains a couple of people listed twice under two
       addresses, and dedupe correctly keeps one. So the check is that
       nothing was dropped beyond those, not that the counts match. */
    var added = S.all('leads').length - before;
    say('essentially every row landed', added >= expected - 3 && added <= expected,
        added + ' of ' + expected);

    /* Phone on the row itself - this is a calling list, and having to open
       each lead to find the number is the difference between working it
       and not. */
    // Phone has its own column now: pick, lead, phone -> the third cell.
    var heads = [].map.call(document.querySelectorAll('.tbl thead th'),
                            function (h) { return h.textContent.replace(/[^A-Za-z ]/g, '').trim(); });
    say('there is a Phone column', heads.indexOf('Phone') === 2, heads.join(' | '));

    var cells = document.querySelectorAll('.tbl tbody tr td:nth-child(3)');
    var withTel = 0, dashes = 0;
    cells.forEach(function (c) {
      if (c.querySelector('a[href^="tel:"]')) withTel++;
      else if (c.textContent.trim() === '—') dashes++;
    });
    say('the column shows dialable numbers', withTel > 0, withTel + ' rows');
    // Every row accounted for: a number, or an honest dash. The realtor list
    // has 277 people with no phone at all, and a blank cell would read as a
    // bug rather than as missing source data.
    say('and a dash wherever there is none', withTel + dashes === cells.length,
        withTel + ' dialable + ' + dashes + ' dashes of ' + cells.length);
    say('and does not print the same name twice',
        !Array.prototype.some.call(cells, function (c) {
          var link = c.querySelector('span.link');
          var muted = c.querySelector('div.muted');
          return link && muted && muted.textContent.indexOf(link.textContent) === 0;
        }));

    function byEmail(e) {
      return S.all('leads').filter(function (l) { return l.email === e; })[0];
    }

    // Named people from the top of the real file.
    var a = byEmail('asculco.realtor@gmail.com');
    say('Andreina Sculco imported', !!a);
    if (a) {
      say('  her phone came through', a.phone === '(201) 321-1051', JSON.stringify(a.phone));
      say('  her name came through', a.name === 'Andreina Sculco', a.name);
      say('  her title came through', a.contactTitle === 'Realtor', a.contactTitle);
      say('  her website came through', a.website === 'century21.com', a.website);
      say('  her location came through', a.address === 'Jersey City, New Jersey', a.address);
      say('  her industry came through', a.industry === 'Real Estate', a.industry);
      say('  her source came through', a.source === 'Realtor List', a.source);
      say('  her rating came through', a.rating === 'cold', a.rating);
      say('  her tags came through', S.hasTag(a, 'brokerage-page'), (a.tags || []).join('|'));
      say('  her note came through', S.notesFor('lead', a.id).length === 1,
          S.notesFor('lead', a.id).length);
    }

    var b = byEmail('bmontone@dianeturton.com');
    say('Barbara Montone kept her phone', b && b.phone === '(201) 404-6101', b && JSON.stringify(b.phone));
    say('and her warm rating', b && b.rating === 'warm', b && b.rating);

    // The row whose location contains a comma - the classic column-shift bug.
    say('a quoted comma did not shift the columns',
        b && b.address === 'Jersey City, New Jersey' && b.website === 'dianeturton.com',
        b && (b.address + ' / ' + b.website));

    var withPhone = S.all('leads').filter(function (l) {
      return l.source === 'Realtor List' && l.phone;
    }).length;
    var imported = S.all('leads').filter(function (l) { return l.source === 'Realtor List'; }).length;
    note('phones present on ' + withPhone + ' of ' + imported + ' imported leads');
    say('most imported leads have a phone', withPhone > imported * 0.7,
        withPhone + '/' + imported);

    say('every phone that arrived looks like a phone number',
        S.all('leads').filter(function (l) { return l.source === 'Realtor List' && l.phone; })
          .every(function (l) { return /^\(\d{3}\) \d{3}-\d{4}$/.test(l.phone); }),
        (S.all('leads').filter(function (l) {
          return l.source === 'Realtor List' && l.phone && !/^\(\d{3}\) \d{3}-\d{4}$/.test(l.phone);
        })[0] || {}).phone);

    finish();
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-real-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="realResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the import did not finish"
exit 1
