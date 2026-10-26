# The lead tag list, through the real leads screen.
#
#   powershell -File tests\lead-tags.ps1
#
# Leads keep to a fixed tag list (S.LEAD_TAGS). This checks that old
# spellings are converted and everything else dropped, that customer tag
# suggestions no longer fill up with lead tags, and that the tag filter
# offers only list tags, with how many leads carry each.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-tags"

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
    pre.id = 'ltResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'TAGS FAILURES' : 'TAGS ALL PASS') + '\n';
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
  function run() {
    S = window.Store;
    say('old spellings become the current tag',
        JSON.stringify(S.cleanLeadTags(['no-site-found', 'Brokerage-Page', 'reach: switchboard'])) ===
        JSON.stringify(['no website', 'brokerage page', 'company-line']),
        JSON.stringify(S.cleanLeadTags(['no-site-found', 'Brokerage-Page', 'reach: switchboard'])));
    say('  trade, city and source tags are dropped',
        S.cleanLeadTags(['plumber', 'texas', 'chamber of commerce', 'la county']).length === 0,
        JSON.stringify(S.cleanLeadTags(['plumber', 'texas', 'chamber of commerce', 'la county'])));
    say('  and duplicates collapse', S.cleanLeadTags(['no website', 'no-site-found', 'no website listed']).length === 1);
    say('customer tags no longer include lead tags', S.allTags().indexOf('no website') === -1,
        S.allTags().join(','));

    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    function mk(tags) {
      S.insert('leads', { name: 'L' + Math.random().toString(36).slice(2, 7), source: 'Test',
        ownerId: S.me().id, lastContactedAt: '', nextFollowUp: '', leadStatus: 'working',
        branch: '', tags: tags, rating: 'warm', mockupStatus: 'none',
        createdAt: new Date().toISOString() }, 'l', 'L');
    }
    mk(['no website', 'plumber']); mk(['no website']); mk(['old site', 'texas']);
    window.render();
    until(function () { return document.querySelector('#ftag'); }, 'the leads screen has a tag filter', function (sel) {
      var opts = [].slice.call(sel.options).map(function (o) { return o.textContent; });
      say('  it offers only list tags, with counts',
          JSON.stringify(opts) === JSON.stringify(['All tags', 'no website (2)', 'old site (1)']),
          JSON.stringify(opts));
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
$profile = "$env:TEMP\tfs-crm-tags-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1500,950 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="ltResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
