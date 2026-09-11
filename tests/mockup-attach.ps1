# Attaching a batch of published mockups, through the real dialog.
#
#   powershell -File tests\mockup-attach.ps1
#
# The matching rules are covered by tests/mockup-match.js. This drives the
# screen: paste links, read the preview, confirm, and check the leads came
# out of it marked ready to send with the right link on each.
#
# Literals here are \uXXXX escapes - PowerShell 5.1 reads a BOM-less .ps1 as
# ANSI, so an accented character in the driver arrives mangled and the test
# then fails on its own encoding rather than on the app.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-mockup"

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
    pre.id = 'mkResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'MOCKUP ATTACH FAILURES' : 'MOCKUP ATTACH ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function until(get, label, then) {
    var n = 0;
    (function spin() {
      var got = get();
      if (got) { say(label, true); return then(got); }
      if (++n > 600) { say(label, false, 'timed out'); return finish(); }
      setTimeout(spin, 20);
    })();
  }

  var BASE = 'https://thinkfirststudios.github.io/brazil-leads-mockups/';
  var NAMES = ['Casa Mar\u00e9 Floripa', 'A Baleeira', 'Cardoso & Advogados Associados',
               'Kaza Arquitetura e Interiores', 'Paradiso', 'Zen Telecom'];

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#mockupsBtn'))) {
      if (++tries > 400) { say('the leads screen has an Attach mockups button', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    NAMES.forEach(function (n) {
      S.insert('leads', { name: n, leadStatus: 'new', rating: 'warm', ownerId: S.me().id,
                          branch: '', tags: [], mockupStatus: 'none', mockupUrl: '',
                          mockupTypes: [], nextFollowUp: '' }, 'l', n);
    });
    say('six leads seeded', S.all('leads').length === 6, S.all('leads').length);

    document.querySelector('#mockupsBtn').click();
    var box = document.querySelector('.modal-root');
    say('the attach dialog opened', !!box && !!box.querySelector('[name=urls]'));
    if (!box) return finish();

    box.querySelector('[name=urls]').value = [
      BASE + 'casa-mare-floripa/',
      BASE + 'a-baleeira/',
      BASE + 'cardoso-advogados-associados/',
      BASE + 'kaza-arquitetura-interiores/',
      BASE + 'paradiso-mercato-e-caffe/',
      BASE + 'a-business-that-does-not-exist/'
    ].join('\n');
    box.querySelector('[data-ok]').click();

    until(function () {
      var m = document.querySelectorAll('.modal-root');
      return m.length && m[m.length - 1].textContent.indexOf('matched') > -1 ? m[m.length - 1] : null;
    }, 'the preview opened', function (prev) { preview(S, prev); });
  }

  function preview(S, prev) {
    var txt = prev.textContent;
    say('it counted five matches', txt.indexOf('5 matched') > -1, txt.slice(0, 140));
    say('and one it could not place', txt.indexOf('1 not matched') > -1);
    say('naming the folder it could not place',
        txt.indexOf('a-business-that-does-not-exist') > -1);

    /* Every pairing is on screen before anything is written. That preview
       is the whole safeguard against a mockup landing on the wrong
       business, which nobody catches until it is presented to them. */
    NAMES.slice(0, 5).forEach(function (n) {
      say('  shows ' + n, txt.indexOf(n) > -1);
    });
    say('and does not claim the lead with no mockup', txt.indexOf('Zen Telecom') < 0);

    var oks = prev.querySelectorAll('[data-ok]');
    oks[oks.length - 1].click();

    until(function () {
      return S.all('leads').filter(function (l) { return l.mockupUrl; }).length === 5 || null;
    }, 'the attach committed', function () { check(S); });
  }

  function check(S) {
    function by(n) { return S.all('leads').filter(function (l) { return l.name === n; })[0]; }

    var casa = by('Casa Mar\u00e9 Floripa');
    say('an accented name got its link',
        casa.mockupUrl === BASE + 'casa-mare-floripa/', casa.mockupUrl);
    say('and counts as ready to send', casa.mockupStatus === 'ready', casa.mockupStatus);
    say('with the day it was finished', !!casa.mockupReadyAt, casa.mockupReadyAt);

    var card = by('Cardoso & Advogados Associados');
    say('the ampersand name got its link', /cardoso-advogados-associados/.test(card.mockupUrl || ''),
        card.mockupUrl);
    var kaza = by('Kaza Arquitetura e Interiores');
    say('the dropped joining word got its link', /kaza-arquitetura-interiores/.test(kaza.mockupUrl || ''),
        kaza.mockupUrl);
    var par = by('Paradiso');
    say('the longer folder got its link', /paradiso-mercato-e-caffe/.test(par.mockupUrl || ''),
        par.mockupUrl);

    var zen = by('Zen Telecom');
    say('the lead with no mockup was left alone', !zen.mockupUrl && zen.mockupStatus === 'none',
        zen.mockupStatus + ' / ' + zen.mockupUrl);

    say('five leads are now on the ready-to-send card',
        S.mockupsReadyToSend().length === 5, S.mockupsReadyToSend().length);

    var logged = S.all('activity').filter(function (a) { return a.action === 'mockup'; }).length;
    note('activity lines for the batch: ' + logged);
    say('the whole batch logged once, not five times', logged === 1, logged);

    finish();
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-mockup-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="mkResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
