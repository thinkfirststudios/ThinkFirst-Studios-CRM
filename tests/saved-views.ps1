# A filter set kept under a name, per person.
#
#   powershell -File tests\saved-views.ps1
#
# Johnathan asked for Josh's follow-ups and his sent mockups as "a new list
# just for me - keep them in his". A lead has one owner, so nothing is
# copied and nothing changes hands: the question is saved and asked again
# fresh. This drives what he will actually do - filter to Josh's queue, save
# it, come back to it - and checks the leads are untouched afterwards and
# that Josh cannot see views that are not his.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-views"

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
    pre.id = 'viewResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'SAVED VIEW FAILURES' : 'SAVED VIEW ALL PASS') + '\n';
    document.body.appendChild(pre);
  }
  function until(get, label, then) {
    var n = 0;
    (function spin() {
      var got;
      try { got = get(); } catch (e) { got = null; }
      if (got) { say(label, true); return then(got); }
      if (++n > 400) { say(label, false, 'timed out'); return finish(); }
      setTimeout(spin, 20);
    })();
  }
  function topModal() {
    var m = document.querySelectorAll('.modal-root');
    return m.length ? m[m.length - 1] : null;
  }
  function tableText() {
    var b = document.querySelector('tbody');
    return b ? b.textContent : '';
  }
  function pick(sel, value) {
    var node = document.querySelector(sel);
    node.value = value;
    node.onchange();
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, chase, sent, other;
  function run() {
    S = window.Store;
    try { localStorage.removeItem('crm:leadviews'); } catch (e) {}
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    if (!S.find('users', 'josh')) {
      S.insert('users', { id: 'josh', name: 'Josh Martinez', role: 'rep', active: true, branch: '' }, 'u', 'Josh');
    }
    if (!S.find('users', 'jdlg')) {
      S.insert('users', { id: 'jdlg', name: 'Johnathan De La Garza', role: 'admin', active: true, branch: '' }, 'u', 'Johnathan');
    }

    function lead(o) {
      o.leadStatus = o.leadStatus || 'working'; o.rating = 'warm';
      o.branch = ''; o.tags = []; o.mockupStatus = o.mockupStatus || 'none';
      return S.insert('leads', o, 'l', o.name);
    }
    var today = S.today();
    // Josh's follow-up queue: due today.
    chase = lead({ name: 'Marisol Vega', contactName: 'Marisol Vega', phone: '(714) 555-0101',
                   ownerId: 'josh', nextFollowUp: today });
    // Josh's sent mockups, with the follow-up already out of the way, so
    // the two views cannot pass by accident on the same row.
    sent = lead({ name: 'Delgado Roofing', contactName: 'Ana Delgado', phone: '(714) 555-0102',
                  ownerId: 'josh', nextFollowUp: '', mockupStatus: 'sent' });
    // Somebody else's lead, due today, which must never appear in a view
    // of Josh's book.
    other = lead({ name: 'Frank Lead Co', contactName: 'Pat Frank', phone: '(714) 555-0103',
                   ownerId: 'jdlg', nextFollowUp: today });

    S.setMe('jdlg');
    location.hash = '#/leads';
    window.render();
    until(function () { return document.querySelector('#fowner'); },
      'an admin gets the owner filter', filterToJosh);
  }

  // What Johnathan does by hand the first time.
  function filterToJosh() {
    pick('#fowner', 'josh');
    setTimeout(function () {
      pick('#fdue', 'attention');
      setTimeout(function () {
        var t = tableText();
        say('filtering gives Josh\u2019s follow-ups', t.indexOf('Marisol Vega') > -1);
        say('  without his sent mockups', t.indexOf('Delgado Roofing') < 0);
        say('  and without anybody else\u2019s leads', t.indexOf('Frank Lead Co') < 0, t.slice(0, 120));
        saveIt('Josh - follow ups', mockupView);
      }, 60);
    }, 60);
  }

  function saveIt(name, then) {
    var btn = document.querySelector('#viewSave');
    if (!btn) { say('a filtered screen offers to save the view', false); return finish(); }
    btn.click();
    setTimeout(function () {
      var m = topModal();
      if (!m) { say('the save dialog opened', false); return finish(); }
      m.querySelector('[name=name]').value = name;
      m.querySelector('[data-ok]').click();
      setTimeout(function () { then(); }, 80);
    }, 60);
  }

  function mockupView() {
    say('the view is saved under its name', /Josh - follow ups/.test(
      (document.querySelector('#viewBar') || {}).textContent || ''));
    pick('#fdue', '');
    setTimeout(function () {
      pick('#fmockup', 'sent');
      setTimeout(function () {
        var t = tableText();
        say('the second filter gives the sent mockups', t.indexOf('Delgado Roofing') > -1);
        say('  and not the follow-up', t.indexOf('Marisol Vega') < 0);
        saveIt('Josh - mockups sent', reopen);
      }, 60);
    }, 60);
  }

  // The point of the whole thing: come back later, one click.
  function reopen() {
    var bar = document.querySelector('#viewBar');
    say('both views are on the bar', (bar.textContent.match(/Josh -/g) || []).length === 2,
        bar.textContent);

    // Clear everything, the way a fresh visit starts.
    pick('#fmockup', '');
    setTimeout(function () {
      pick('#fowner', '');
      setTimeout(function () {
        var chips = document.querySelectorAll('#viewBar [data-view]');
        say('the saved views survive the filters being cleared', chips.length === 2, chips.length);
        chips[0].click();
        setTimeout(function () {
          var t = tableText();
          say('one click brings back Josh\u2019s follow-ups',
              t.indexOf('Marisol Vega') > -1 && t.indexOf('Delgado Roofing') < 0 &&
              t.indexOf('Frank Lead Co') < 0, t.slice(0, 120));
          var second = document.querySelectorAll('#viewBar [data-view]')[1];
          second.click();
          setTimeout(function () {
            var t2 = tableText();
            say('and the other brings back the sent mockups',
                t2.indexOf('Delgado Roofing') > -1 && t2.indexOf('Marisol Vega') < 0, t2.slice(0, 120));
            untouched();
          }, 80);
        }, 80);
      }, 60);
    }, 60);
  }

  // Nothing was copied and nothing changed hands.
  function untouched() {
    say('the leads still belong to Josh',
        S.find('leads', chase.id).ownerId === 'josh' && S.find('leads', sent.id).ownerId === 'josh');
    say('  and there are still three of them, not five', S.all('leads').length === 3,
        S.all('leads').length);
    say('  Josh\u2019s own queue is unchanged',
        S.leadsNeedingAttention('josh').length === 1, S.leadsNeedingAttention('josh').length);
    perPerson();
  }

  // "Just for me" - Josh signing in must not find Johnathan's views.
  function perPerson() {
    S.setMe('josh');
    window.render();
    setTimeout(function () {
      var bar = document.querySelector('#viewBar');
      say('a view named for somebody\u2019s book stays with its owner',
          !bar || bar.textContent.indexOf('Josh -') < 0, bar ? bar.textContent : 'no bar');
      S.setMe('jdlg');
      window.render();
      setTimeout(forgetting, 60);
    }, 80);
  }

  function forgetting() {
    var x = document.querySelector('#viewBar [data-viewdel]');
    if (!x) { say('a view can be forgotten', false); return finish(); }
    x.click();
    setTimeout(function () {
      var chips = document.querySelectorAll('#viewBar [data-view]');
      say('a view can be forgotten', chips.length === 1, chips.length);
      say('  and forgetting it leaves the leads alone', S.all('leads').length === 3,
          S.all('leads').length);
      finish();
    }, 80);
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-views-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="viewResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
