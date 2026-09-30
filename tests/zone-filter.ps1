# Filtering the lead list by time zone, clicked in a real browser.
#
#   powershell -File tests\zone-filter.ps1
#
# Josh works the west coast and almost every realtor he has a mockup for is
# on the east coast, so he was ringing Connecticut at 6am their time. He
# asked for a way to see one coast at a time. The zone is never stored - it
# is read off the state in the Location, falling back to the area code - so
# this drives what he will actually do: open the list, pick a coast, and
# check the leads that are left are the ones that are awake.
#
# It also exports from the filtered screen, because the column in the CSV
# and the menu in the filter bar have to agree, and a rep who exports "East
# Coast" and filters "Eastern" has two different answers to one question.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-zone"

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
  var lines = [], errors = [];
  window.addEventListener('error', function (e) { errors.push(e.message); });
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function finish() {
    say('no script errors along the way', !errors.length, errors.join(' | '));
    var pre = document.createElement('pre');
    pre.id = 'zoneResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'ZONE FILTER FAILURES' : 'ZONE FILTER ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function tableText() {
    var b = document.querySelector('tbody');
    return b ? b.textContent : '';
  }
  function pick(sel, value) {
    var node = document.querySelector(sel);
    if (!node) { say('the control ' + sel + ' exists', false); finish(); return false; }
    node.value = value;
    node.onchange();
    return true;
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S;
  function run() {
    S = window.Store;
    try { localStorage.removeItem('crm:leadviews'); } catch (e) {}
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));

    function lead(name, where, phone) {
      return S.insert('leads', {
        name: name, contactName: '', phone: phone, address: where,
        leadStatus: 'working', rating: 'warm', ownerId: S.me().id,
        branch: '', tags: [], mockupStatus: 'none'
      }, 'l', name);
    }

    // The real spread off Josh's mockup sheet, one per zone.
    lead('Chef Mathias', 'Los Angeles & surrounding areas', '310 876 5291');
    lead('Casillas Pool', '10058 Sunland Blvd, Los Angeles, CA', '(818) 288-7546');
    lead('Aziz Seyal', 'New Haven, Connecticut', '(203) 209-9396');
    lead('Laura Zafonte', 'Jersey City, New Jersey', '(201) 788-1519');
    lead('Jaren Johnson', 'Saint Paul, Minnesota', '(651) 419-8400');
    lead('Bugs Bee Gone', 'Tucson, AZ', '(520) 649-2589');
    // The capital is not the state of the same name, and this one is typed
    // with full stops, which is how it sits in the book.
    lead('Chemaye Nickens', 'Washington D.C.', '(202) 709-7989');
    // No location at all - placed by its area code and nothing else.
    lead('SD Prodigy', '', '6195478214');

    location.hash = '#/leads';
    window.render();
    setTimeout(start, 80);
  }

  function start() {
    var sel = document.querySelector('#fzone');
    say('the lead list has a time zone filter', !!sel);
    if (!sel) return finish();

    var opts = [].map.call(sel.options, function (o) { return o.text; });
    say('  it offers West Coast and East Coast by name',
        opts.indexOf('West Coast') > -1 && opts.indexOf('East Coast') > -1, opts.join(', '));
    say('  and starts on Any zone, showing everybody',
        sel.value === '' && tableText().indexOf('Aziz Seyal') > -1);

    if (!pick('#fzone', 'pacific')) return;
    setTimeout(westCoast, 80);
  }

  function westCoast() {
    var t = tableText();
    say('West Coast keeps the Los Angeles leads',
        t.indexOf('Chef Mathias') > -1 && t.indexOf('Casillas Pool') > -1);
    say('  and the San Diego lead placed by its area code alone',
        t.indexOf('SD Prodigy') > -1);
    say('  and drops Connecticut', t.indexOf('Aziz Seyal') < 0);
    say('  and drops Arizona', t.indexOf('Bugs Bee Gone') < 0);
    say('  and does not claim the Washington D.C. realtor',
        t.indexOf('Chemaye Nickens') < 0, t.slice(0, 160));

    if (!pick('#fzone', 'eastern')) return;
    setTimeout(eastCoast, 80);
  }

  function eastCoast() {
    var t = tableText();
    say('East Coast gives Connecticut and New Jersey',
        t.indexOf('Aziz Seyal') > -1 && t.indexOf('Laura Zafonte') > -1);
    say('  and Washington D.C. with it', t.indexOf('Chemaye Nickens') > -1, t.slice(0, 160));
    say('  and nothing from the west coast', t.indexOf('Chef Mathias') < 0);
    say('  and not Minnesota either', t.indexOf('Jaren Johnson') < 0);

    if (!pick('#fzone', 'central')) return;
    setTimeout(central, 80);
  }

  function central() {
    var t = tableText();
    say('Central gives Saint Paul on its own',
        t.indexOf('Jaren Johnson') > -1 && t.indexOf('Aziz Seyal') < 0, t.slice(0, 160));
    if (!pick('#fzone', 'mountain')) return;
    setTimeout(function () {
      say('Mountain gives Tucson on its own',
          tableText().indexOf('Bugs Bee Gone') > -1 && tableText().indexOf('Chef Mathias') < 0);
      exported();
    }, 80);
  }

  // The column in the file has to say what the menu says.
  function exported() {
    var grabbed = '';
    var realDownload = window.download;
    window.download = function (name, body) { grabbed = body; };
    try {
      window.Views.leads._exportCsv(S.all('leads'));
    } catch (e) {
      say('the export ran', false, e.message);
      window.download = realDownload;
      return finish();
    }
    window.download = realDownload;

    var grid = window.Views.leads._parse(grabbed, ',');
    var head = grid[0];
    var tz = head.indexOf('Time Zone');
    var co = head.indexOf('Company');
    say('the exported file has a Time Zone column', tz > -1, head.join('|'));
    if (tz < 0) return finish();
    say('  sitting next to the Location it comes from', tz === head.indexOf('Location') + 1);
    say('  and every row lines up with the header',
        grid.every(function (r) { return r.length === head.length; }));

    function zoneOf(name) {
      var row = grid.slice(1).filter(function (r) { return r[co] === name; })[0];
      return row ? row[tz] : '(missing)';
    }
    say('  Chef Mathias exports as West Coast', zoneOf('Chef Mathias') === 'West Coast',
        zoneOf('Chef Mathias'));
    say('  Aziz Seyal exports as East Coast', zoneOf('Aziz Seyal') === 'East Coast',
        zoneOf('Aziz Seyal'));
    say('  the D.C. realtor exports as East Coast, not West',
        zoneOf('Chemaye Nickens') === 'East Coast', zoneOf('Chemaye Nickens'));
    say('  Jaren Johnson exports as Central', zoneOf('Jaren Johnson') === 'Central',
        zoneOf('Jaren Johnson'));

    // The words in the file are the words in the menu.
    var menu = [].map.call(document.querySelector('#fzone').options, function (o) { return o.text; });
    var used = grid.slice(1).map(function (r) { return r[tz]; });
    var strays = used.filter(function (v) { return v && menu.indexOf(v) < 0; });
    say('  every exported zone is a zone the filter offers', !strays.length, strays.join(','));
    cleared();
  }

  function cleared() {
    var clear = document.querySelector('#clear');
    if (clear) {
      clear.click();
      setTimeout(function () {
        var sel = document.querySelector('#fzone');
        say('Clear puts the zone filter back to Any zone', sel && sel.value === '',
            sel ? sel.value : '(gone)');
        say('  and everybody is back', tableText().indexOf('Aziz Seyal') > -1 &&
            tableText().indexOf('Chef Mathias') > -1);
        finish();
      }, 90);
    } else {
      say('there is a Clear control', false);
      finish();
    }
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-zone-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="zoneResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
