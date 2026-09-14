# Call backs, through the real screens, as a rep.
#
#   powershell -File tests\callbacks.ps1
#
# The rules live in tests/callbacks.js. This drives what Josh will actually
# do: log a contact and tick "Add to my call backs", find it on the Call
# backs tab with the time and the reminder on the row, move it, clear it,
# and get back to his leads table afterwards.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-callbacks"

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
    pre.id = 'cbResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'CALLBACKS FAILURES' : 'CALLBACKS ALL PASS') + '\n';
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
  function topModal() {
    var m = document.querySelectorAll('.modal-root');
    return m.length ? m[m.length - 1] : null;
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, laura;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    if (!S.find('users', 'josh')) {
      S.insert('users', { id: 'josh', name: 'Josh Martinez', role: 'rep', active: true, branch: '' }, 'u', 'Josh');
    }
    S.setMe('josh');
    laura = S.insert('leads', { name: 'Laura Zafonte', contactName: 'Laura Zafonte',
      phone: '(201) 788-1519', leadStatus: 'contacted', rating: 'warm', ownerId: 'josh',
      branch: '', tags: [], nextFollowUp: '', mockupStatus: 'none' }, 'l', 'Laura Zafonte');
    S.insert('leads', { name: 'Derek Quarles', contactName: 'Derek Quarles',
      phone: '(203) 572-7881', leadStatus: 'new', rating: 'cold', ownerId: 'josh',
      branch: '', tags: [], nextFollowUp: '', mockupStatus: 'none' }, 'l', 'Derek Quarles');

    location.hash = '#/leads';
    until(function () { return document.querySelector('#segNav [data-seg="callbacks"]'); },
      'the leads page has a Call backs tab', function (tab) {
        say('  starting at zero', /0/.test(tab.textContent), tab.textContent);
        location.hash = '#/leads/' + laura.id;
        until(function () { return document.querySelector('#logBtn'); },
          'the lead record has Log contact', logIt);
      });
  }

  function logIt(btn) {
    say('  and a Call back button beside it', !!document.querySelector('#cbBtn'));
    btn.click();
    var m = topModal();
    say('Log contact offers "Add to my call backs"', !!(m && m.querySelector('#cbToggle')));
    m.querySelector('[name=note]').value = 'Spoke to Laura, wants pricing.';
    m.querySelector('[name=nextFollowUp]').value = S.shift(2);
    say('  the time and reminder stay hidden until it is ticked',
        m.querySelector('#cbTimeWrap').style.display === 'none');
    m.querySelector('#cbToggle').click();
    say('  and appear once it is', m.querySelector('#cbTimeWrap').style.display === '' &&
        m.querySelector('#cbNoteWrap').style.display === '');
    m.querySelector('[name=cbTime]').value = '15:00';
    m.querySelector('[name=cbReminder]').value = 'Wants pricing on the 3-bed. Call after 3.';
    m.querySelector('[data-ok]').click();

    until(function () { return S.callbacks().length === 1; }, 'saving books the call back', function () {
      var t = S.callbackFor(laura.id);
      say('  on the follow-up day', t.dueDate === S.shift(2), t.dueDate);
      say('  at the time', t.startTime === '15:00', t.startTime);
      until(function () {
        var b = document.querySelector('#cbBtn');
        return b && b.textContent.indexOf('3:00 PM') > -1 ? b : null;
      }, 'the record button now says when', function () {
        location.hash = '#/leads';
        until(function () { return document.querySelector('#segNav [data-seg="callbacks"]'); },
          'back on the leads list', function (tab) {
            say('  the tab counts one', /1/.test(tab.textContent), tab.textContent);
            tab.click();
            until(function () {
              var h = [].filter.call(document.querySelectorAll('.card-title'), function (x) {
                return x.textContent === 'Call Backs';
              })[0];
              return h && document.querySelector('[data-cbrow]') ? true : null;
            }, 'the Call backs tab lists it', onTab);
          });
      });
    });
  }

  function onTab() {
    var row = document.querySelector('[data-cbrow]');
    var txt = row.textContent;
    say('  the reminder is on the row', txt.indexOf('3-bed') > -1, txt);
    say('  with the time', txt.indexOf('3:00 PM') > -1, txt);
    say('  and a number to dial', !!row.querySelector('a[href^="tel:"]'));
    say('  and Log call right there', !!row.querySelector('[data-logcontact]'));
    say('  the leads table and its filters are out of the way', !document.querySelector('#fq'));

    row.querySelector('[data-cbmove]').click();
    var m = topModal();
    say('Reschedule opens with the current time filled in',
        m && m.querySelector('[name=time]').value === '15:00',
        m && m.querySelector('[name=time]').value);
    m.querySelector('[name=time]').value = '10:30';
    m.querySelector('[data-ok]').click();
    until(function () {
      var r = document.querySelector('[data-cbrow]');
      return r && r.textContent.indexOf('10:30 AM') > -1 ? r : null;
    }, 'the row shows the new time', function (r) {
      say('  still one call back, moved not duplicated', document.querySelectorAll('[data-cbrow]').length === 1);
      r.querySelector('[data-cbdone]').click();
      until(function () { return !document.querySelector('[data-cbrow]') ? true : null; },
        'Done clears it', function () {
          say('  and the list says so', document.body.textContent.indexOf('No call backs booked') > -1);
          document.querySelector('#segNav [data-seg="open"]').click();
          until(function () { return document.querySelector('#fq'); },
            'switching back to Active brings the table back', function () {
              say('  with both leads in it',
                  document.querySelectorAll('.tbl tbody tr').length === 2,
                  document.querySelectorAll('.tbl tbody tr').length);
              finish();
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
$profile = "$env:TEMP\tfs-crm-callbacks-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="cbResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
