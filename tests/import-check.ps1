# Drives a real lead import in headless Edge: paste, map, import.
#
#   powershell -File tests\import-check.ps1
#
# The node suites check the store and the column rules. This checks the part
# only a browser has - the two modals, the mapping dialog's guesses, and
# whether per-row rating and tags actually reach the saved lead. Worth having
# before pushing a few thousand rows through it by hand.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-import"

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
  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'importResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'IMPORT FAILURES' : 'IMPORT ALL PASS') + '\n';
    document.body.appendChild(pre);
  }

  // Same shape as the realtor CSV: header names, pipe-separated tags, a
  // rating per row, and one deliberately bad rating.
  var CSV = [
    'name,contactName,contactTitle,email,phone,website,industry,address,rating,source,tags,notes',
    'Erin Fuller,Erin Fuller,Realtor,erin@fullerhomes.example,(310) 555-0139,fullerhomes.example,Real Estate,"Los Angeles, California",hot,Realtor List,realtor|own-site|site-broken,Site replaced.',
    'Belinda Marchant,Belinda Marchant,Realtor,bmarchant@example.com,(201) 555-0140,dianeturton.com,Real Estate,"Jersey City, New Jersey",warm,Realtor List,realtor|own-site,Not yet checked.',
    'Gabe Lowe,Gabe Lowe,Realtor,g.lowe@kw.com,(201) 555-0195,kw.com,Real Estate,"Jersey City, New Jersey",cold,Realtor List,realtor|brokerage-page,Brokerage page.',
    'Jane Sutter,Jane Sutter,Realtor,jsutter@example.com,(201) 555-0168,,Real Estate,"Jersey City, New Jersey",cold,Realtor List,realtor|no-site-found,No site listed.',
    'Sasha Hart,Sasha Hart,Realtor,shart@lender.example,(215) 555-0190,lender.example,Real Estate,"Philadelphia, Pennsylvania",cold,Realtor List,realtor|not-a-realtor,Lending.',
    'Bogus Rating,Bogus Rating,Realtor,bogus@example.com,(555) 555-0000,example.com,Real Estate,Nowhere,scorching,Realtor List,realtor|own-site,Bad rating on purpose.'
  ].join('\n');

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && window.Views.leads.openImport
          && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the leads screen ever loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;
    var before = S.all('leads').length;

    window.Views.leads.openImport(function () {});
    var box = document.querySelector('.modal-root');
    var area = box.querySelector('[name=raw]');
    say('the import dialog opened', !!area);
    say('it offers a file picker', !!box.querySelector('#impFile'));

    var dateField = box.querySelector('[name=nextFollowUp]');
    say('a first follow-up date is prefilled', !!dateField && !!dateField.value,
        dateField && dateField.value);
    // The chosen import wants these blank, so clear it the way a person would.
    if (dateField) dateField.value = '';

    area.value = CSV;
    box.querySelector('[data-ok]').click();

    until(function () { return document.querySelector('#impMap'); }, 'the mapping dialog opened',
      function (map) { afterMap(map, S, before); });
  }

  // Poll for something the previous click is expected to mount.
  function until(get, label, then) {
    var n = 0;
    (function spin() {
      var got = get();
      if (got) { say(label, true); return then(got); }
      if (++n > 300) { say(label, false, 'timed out'); return finish(); }
      setTimeout(spin, 20);
    })();
  }

  function afterMap(map, S, before) {

    function picked(field) {
      var sel = document.querySelector('[data-field="' + field + '"]');
      if (!sel || sel.value === '') return '(none)';
      return sel.options[sel.selectedIndex].text;
    }
    say('name column guessed',      picked('name') === 'name', picked('name'));
    say('email column guessed',     picked('email') === 'email', picked('email'));
    say('phone column guessed',     picked('phone') === 'phone', picked('phone'));
    say('website column guessed',   picked('website') === 'website', picked('website'));
    say('rating column guessed',    picked('rating') === 'rating', picked('rating'));
    say('tags column guessed',      picked('tagsCol') === 'tags', picked('tagsCol'));
    say('note column guessed',      picked('noteText') === 'notes', picked('noteText'));

    var modal = document.querySelectorAll('.modal-root [data-ok]');
    modal[modal.length - 1].click();

    until(function () { return S.all('leads').length > before || null; },
      'the import ran', function () { afterImport(S, before); });
  }

  function afterImport(S, before) {
    var added = S.all('leads').length - before;
    say('all six rows imported', added === 6, added);

    function find(email) {
      return S.all('leads').filter(function (l) { return l.email === email; })[0];
    }
    var erik = find('erin@fullerhomes.example');
    say('the hot lead kept its rating', erik && erik.rating === 'hot', erik && erik.rating);
    /* own-site and site-broken arrive in their current spelling; realtor
       is a trade, and the Industry column already says so. */
    say('and its website tags, in the current spelling',
        erik && S.hasTag(erik, 'has own site') && S.hasTag(erik, 'old site') && !S.hasTag(erik, 'realtor'),
        erik && (erik.tags || []).join('|'));
    say('its source came through', erik && erik.source === 'Realtor List', erik && erik.source);
    say('its location came through', erik && /Los Angeles/.test(erik.address || ''), erik && erik.address);

    var kw = find('g.lowe@kw.com');
    say('the brokerage lead is cold', kw && kw.rating === 'cold', kw && kw.rating);
    say('and tagged brokerage page', kw && S.hasTag(kw, 'brokerage page'), kw && (kw.tags || []).join('|'));

    var bogus = find('bogus@example.com');
    say('an unknown rating fell back to warm', bogus && bogus.rating === 'warm', bogus && bogus.rating);

    say('nothing got a follow-up date',
        S.all('leads').filter(function (l) { return l.source === 'Realtor List'; })
          .every(function (l) { return !l.nextFollowUp; }));

    /* not-a-realtor is outside the lead tag list, so it is dropped. */
    var offered = S.leadTagCounts().map(function (c) { return c.tag; });
    say('every website segment is a filterable tag',
        ['has own site', 'brokerage page', 'no website']
          .every(function (t) { return offered.indexOf(t) > -1; }) &&
        offered.indexOf('not-a-realtor') === -1,
        offered.join(','));

    // Re-importing the identical rows must add nothing.
    var beforeAgain = S.all('leads').length;
    window.Views.leads.openImport(function () {});
    var box2 = document.querySelector('.modal-root');
    box2.querySelector('[name=raw]').value = CSV;
    var d2 = box2.querySelector('[name=nextFollowUp]'); if (d2) d2.value = '';
    box2.querySelector('[data-ok]').click();
    until(function () { return document.querySelector('#impMap'); },
      'the mapping dialog opened again', function () {
        var oks = document.querySelectorAll('.modal-root [data-ok]');
        oks[oks.length - 1].click();
        setTimeout(function () {
          say('re-importing the same file adds nobody',
              S.all('leads').length === beforeAgain, S.all('leads').length - beforeAgain);
          finish();
        }, 200);
      });
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-import-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=20000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="importResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the page did not finish booting"
exit 1
