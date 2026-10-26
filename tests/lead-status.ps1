# The call-outcome statuses on the real leads screen.
#
#   powershell -File tests\lead-status.ps1
#
# Log contact with No answer hands the lead to someone else for a
# second call booked tomorrow; Pitch no sale will not save without a
# reason; Pitch and sale opens the conversion instead of claiming a
# sale.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-status"

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
    pre.id = 'lsResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'STATUS FAILURES' : 'STATUS ALL PASS') + '\n';
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
  function day(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function modalBox() { var all = document.querySelectorAll('.modal-root'); return all[all.length - 1]; }
  function pick(box, value) {
    var sel = box.querySelector('[name=leadStatus]');
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function logFor(id) {
    document.querySelector('[data-logcontact="' + id + '"]').click();
    return modalBox();
  }
  var ids;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    ids = ['Rang Out', 'Said No', 'Bought It'].map(function (n) {
      return S.insert('leads', { name: n, source: 'Test', ownerId: S.me().id, phone: '',
        lastContactedAt: '', nextFollowUp: day(-3), leadStatus: 'new', branch: S.me().branch || '',
        tags: [], rating: 'warm', mockupStatus: 'none', createdAt: day(-9) + 'T09:00:00.000Z' }, 'l', 'L').id;
    });
    window.render();
    until(function () { return document.querySelector('[data-logcontact="' + ids[0] + '"]'); }, 'the leads screen has the new tabs', function () {
      var tabs = document.body.textContent;
      say('  Pitch no sale, Do not call and Pitch and sale tabs',
          /Pitch no sale/.test(tabs) && /Do not call/.test(tabs) && /Pitch and sale/.test(tabs));
      say('  and a Call Again card', /Call Again/.test(tabs));
      noAnswer();
    });
  }
  function noAnswer() {
    var box = logFor(ids[0]);
    pick(box, 'noanswer');
    var hint = box.querySelector('#logStatusHint').textContent;
    say('choosing No answer says who gets the second call', /^Goes to .+ for the second call/.test(hint), hint);
    say('  and books it for tomorrow', box.querySelector('[name=nextFollowUp]').value === day(1),
        box.querySelector('[name=nextFollowUp]').value);
    box.querySelector('[data-ok]').click();
    until(function () { return S.find('leads', ids[0]).leadStatus === 'noanswer' ? 1 : null; }, 'saving marks it No answer', function () {
      say('  and hands it to somebody else', S.find('leads', ids[0]).ownerId !== S.me().id,
          S.find('leads', ids[0]).ownerId);
      noSale();
    });
  }
  function noSale() {
    var box = logFor(ids[1]);
    pick(box, 'nosale');
    say('Pitch no sale asks why', box.querySelector('#logReason').style.display !== 'none' &&
        /Why no sale/.test(box.querySelector('#logReasonLabel').textContent));
    box.querySelector('[data-ok]').click();
    setTimeout(function () {
      say('  and will not save without a reason', S.find('leads', ids[1]).leadStatus === 'new' && !!modalBox());
      modalBox().querySelector('[name=lostReason]').value = 'Happy with their site';
      modalBox().querySelector('[data-ok]').click();
      until(function () { return S.find('leads', ids[1]).leadStatus === 'nosale' ? 1 : null; }, '  but does with one', function () {
        say('  keeping the reason', S.find('leads', ids[1]).lostReason === 'Happy with their site');
        sale();
      });
    }, 200);
  }
  function sale() {
    var box = logFor(ids[2]);
    pick(box, 'converted');
    box.querySelector('[data-ok]').click();
    until(function () {
      var m = modalBox();
      return m && /Convert Bought It/.test(m.textContent) ? m : null;
    }, 'Pitch and sale opens the conversion to a customer', function () {
      say('  without claiming the sale before it is converted', S.find('leads', ids[2]).leadStatus === 'new');
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
$profile = "$env:TEMP\tfs-crm-status-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1500,950 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="lsResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
