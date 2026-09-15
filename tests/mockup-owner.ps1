# Filtering "Mockups Ready To Send" by whose mockups they are.
#
#   powershell -File tests\mockup-owner.ps1
#
# A manager with two reps' mockups on one card - seventy walk-ins for one,
# fourteen realtor previews for the other - wanted to work one pile at a
# time. Each person with mockups waiting gets a button; picking one narrows
# both the ready rows and the On hold section, and All brings everyone back.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-mockowner"

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
    pre.id = 'moResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'MOCKUP OWNER FAILURES' : 'MOCKUP OWNER ALL PASS') + '\n';
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
  function card() {
    return [].filter.call(document.querySelectorAll('.card'), function (c) {
      var t = c.querySelector('.card-title');
      return t && t.textContent === 'Mockups Ready To Send';
    })[0] || null;
  }
  function readyRows() { var c = card(); return c ? c.querySelectorAll('[data-holdmockup]').length : -1; }
  function btn(id) { var c = card(); return c && c.querySelector('[data-mockupowner="' + id + '"]'); }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    [['cassius', 'Cassius Lee Hall', 'manager'], ['josh', 'Josh Martinez', 'rep']].forEach(function (u) {
      if (!S.find('users', u[0])) S.insert('users', { id: u[0], name: u[1], role: u[2], active: true, branch: '' }, 'u', u[1]);
    });
    var n = 0;
    function mk(owner, status) {
      n++;
      return S.insert('leads', { name: owner + ' lead ' + n, leadStatus: 'contacted', rating: 'warm',
        ownerId: owner, branch: '', tags: [], nextFollowUp: S.shift(3), mockupStatus: status,
        mockupUrl: 'https://example.com/m' + n + '/', mockupTypes: ['Website'],
        mockupReadyAt: S.shift(-2), mockupSentAt: '' }, 'l', 'lead ' + n);
    }
    mk('cassius', 'ready'); mk('cassius', 'ready'); mk('cassius', 'ready');
    mk('josh', 'ready'); mk('josh', 'ready'); mk('josh', 'hold');
    window.render();

    until(function () { return btn('') && btn('cassius') && btn('josh') ? true : null; },
      'the card offers All, Cassius and Josh', function () {
        say('  All counts every ready mockup', /5/.test(btn('').textContent), btn('').textContent);
        say('  Cassius counts his three', /3/.test(btn('cassius').textContent), btn('cassius').textContent);
        say('  Josh counts his two ready', /2/.test(btn('josh').textContent), btn('josh').textContent);
        say('  the busiest person comes first',
            card().querySelectorAll('[data-mockupowner]')[1].dataset.mockupowner === 'cassius');
        say('  starting on All, with all five rows', readyRows() === 5, readyRows());

        btn('josh').click();
        until(function () { return readyRows() === 2 ? true : null; }, 'Josh shows only his two', function () {
          say('  the header count follows', card().querySelector('.card-head .kcol-count').textContent === '2');
          say('  and his held one is under On hold', !!card().querySelector('[data-toggleheld]'));

          btn('cassius').click();
          until(function () { return readyRows() === 3 ? true : null; }, 'Cassius shows only his three', function () {
            say('  with no On hold section, since he has none held', !card().querySelector('[data-toggleheld]'));
            say('  and Josh\'s leads are nowhere on the card', card().textContent.indexOf('josh lead') < 0);

            btn('').click();
            until(function () { return readyRows() === 5 ? true : null; }, 'All brings everyone back', finish);
          });
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
$profile = "$env:TEMP\tfs-crm-mockowner-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="moResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
