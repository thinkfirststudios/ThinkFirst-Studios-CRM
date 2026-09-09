# Where a sales rep goes to see their own leads.
#
#   powershell -File tests\my-leads.ps1
#
# With one list split between three people, landing on "All owners" means a
# rep scrolls past two thirds of a list that is not theirs. The leads screen
# has a My leads / Everyone switcher, and reps start on their own.
#
# Only a browser can show which view actually rendered, so this drives it.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-mine"

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
    pre.id = 'mineResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'MY LEADS FAILURES' : 'MY LEADS ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function rows() { return document.querySelectorAll('[data-pick]').length; }

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

    // Two reps and the admin, with a list split between them.
    var frank = S.insert('users', { name: 'Frank Doyle', role: 'rep', active: true,
      email: 'frank@example.com', title: 'Sales' }, 'u', 'Frank Doyle');
    var admin = S.me();

    var batch = [];
    for (var i = 0; i < 300; i++) {
      batch.push({
        name: 'Realtor ' + i, contactName: 'Realtor ' + i, contactTitle: 'Realtor',
        email: 'r' + i + '@example.com', phone: '(555) 555-' + (1000 + i),
        website: '', instagram: '', tiktok: '', facebook: '',
        address: 'Somewhere', industry: 'Real Estate', source: 'Realtor List',
        estValue: 0, leadStatus: 'new', rating: 'cold',
        ownerId: (i % 3 === 0) ? frank.id : admin.id,
        nextFollowUp: '', lastContactedAt: '', tags: ['realtor'],
        convertedCustomerId: '', convertedAt: ''
      });
    }
    S.insertMany('leads', batch, 'l', 'fixture');

    /* Counted per owner rather than by subtraction: the seeded demo data
       has leads belonging to other people, so "everyone minus Frank" is
       not the admin's share. */
    function openFor(uid) {
      return S.all('leads').filter(function (l) {
        return S.isLeadOpen(l) && l.ownerId === uid;
      }).length;
    }
    var franksLeads = openFor(frank.id);
    var adminLeads = openFor(admin.id);
    var everyone = S.all('leads').filter(S.isLeadOpen).length;
    note('frank owns ' + franksLeads + ', the admin ' + adminLeads +
         ', of ' + everyone + ' open leads');

    window.render();

    say('there is a My leads / Everyone switcher', !!document.querySelector('#scopeNav'));
    var btns = document.querySelectorAll('#scopeNav button');
    say('with both views offered', btns.length === 2, btns.length);

    // The admin is looking at the whole team, which is their job.
    say('an admin starts on Everyone',
        document.querySelector('[data-scope="all"]').className.indexOf('on') > -1);
    say('and sees the whole list', rows() === everyone, rows() + ' of ' + everyone);

    // The counts on the buttons have to be honest before anything is clicked.
    var mineBadge = parseInt(document.querySelector('[data-scope="mine"] .seg-count').textContent, 10);
    say('the My leads count is the admin\u2019s own', mineBadge === adminLeads,
        mineBadge + ' vs ' + adminLeads);

    document.querySelector('[data-scope="mine"]').click();
    say('switching to My leads narrows the list', rows() === adminLeads,
        rows() + ' of ' + adminLeads);
    say('and every row on screen is theirs',
        [].every.call(document.querySelectorAll('[data-pick]'), function (b) {
          return S.find('leads', b.dataset.pick).ownerId === admin.id;
        }));

    // Clearing the filters must not quietly move you to the whole team.
    document.querySelector('#clear').click();
    say('Clear leaves the view alone', rows() === adminLeads, rows());

    document.querySelector('[data-scope="all"]').click();
    say('switching back shows everyone again', rows() === everyone, rows());

    // Now as the rep. Signing in as somebody else is what the user chip does.
    S.setMe(frank.id);
    window.render();

    say('a rep lands on their own leads',
        document.querySelector('[data-scope="mine"]').className.indexOf('on') > -1);
    say('and sees only those', rows() === franksLeads, rows() + ' of ' + franksLeads);
    say('every one of which is theirs',
        [].every.call(document.querySelectorAll('[data-pick]'), function (b) {
          return S.find('leads', b.dataset.pick).ownerId === frank.id;
        }));

    document.querySelector('[data-scope="all"]').click();
    say('a rep can still look at the whole team', rows() === everyone, rows());

    finish();
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-mine-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=30000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="mineResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&#39;', "'"
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the page did not finish booting"
exit 1
