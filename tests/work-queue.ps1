# The work queue, through the real screens.
#
#   powershell -File tests\work-queue.ps1
#
# Rules live in tests/work-queue.js. This does the round trip: a rep asks for
# a mockup from a lead, and whoever builds the work sees it on the dashboard
# with the brief, who asked and how long it has waited - then picks it up and
# finishes it from that card.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-workqueue"

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
    pre.id = 'wqResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'WORK QUEUE FAILURES' : 'WORK QUEUE ALL PASS') + '\n';
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
  function topModal() { var m = document.querySelectorAll('.modal-root'); return m.length ? m[m.length - 1] : null; }
  function workCardEl() {
    return [].filter.call(document.querySelectorAll('.card'), function (c) {
      var t = c.querySelector('.card-title');
      return t && t.textContent === 'Work To Build';
    })[0] || null;
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, laura, older;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    if (!S.find('users', 'josh')) {
      S.insert('users', { id: 'josh', name: 'Josh Martinez', role: 'rep', active: true, branch: '' }, 'u', 'Josh');
    }
    S.setMe('josh');
    laura = S.insert('leads', { name: 'Laura Zafonte', contactTitle: 'Realtor', phone: '(201) 788-1519',
      leadStatus: 'contacted', rating: 'warm', ownerId: 'josh', branch: '', tags: [],
      nextFollowUp: S.shift(3), mockupStatus: 'none', mockupTypes: [], mockupRequestedAt: '' }, 'l', 'Laura');
    older = S.insert('leads', { name: 'Derek Quarles', leadStatus: 'contacted', rating: 'warm',
      ownerId: 'josh', branch: '', tags: [], nextFollowUp: S.shift(3), mockupStatus: 'requested',
      mockupTypes: ['Social Media'], mockupRequestedAt: S.shift(-6) }, 'l', 'Derek');

    location.hash = '#/leads/' + laura.id;
    until(function () { return document.querySelector('#mockupBtn'); }, 'a lead with no mockup offers a request', function (b) {
      say('  the button asks rather than starts', b.textContent.indexOf('Request') > -1, b.textContent);
      b.click();
      var m = topModal();
      say('the dialog opens on Requested', m && m.querySelector('[name=mockupStatus]').value === 'requested',
          m && m.querySelector('[name=mockupStatus]').value);
      say('  and asks what they want', m && m.textContent.indexOf('What do they want?') > -1);
      m.querySelector('[name=note]').value = 'Wants a one-page site and a logo. Surf school in Campeche.';
      [].forEach.call(m.querySelectorAll('[name=mockupTypes]'), function (cb) {
        if (cb.value === 'Website' || cb.value === 'Logo') cb.checked = true;
      });
      m.querySelector('[data-ok]').click();
      until(function () { return S.find('leads', laura.id).mockupStatus === 'requested'; },
        'asking records the request', function () {
          say('  with the day it was asked', S.find('leads', laura.id).mockupRequestedAt === S.today());
          repSees();
        });
    });
  }

  function repSees() {
    location.hash = '#/dashboard';
    until(function () { return document.querySelector('.page-title') ? true : null; }, 'the rep opens the dashboard', function () {
      say('  a rep does not get the build queue - their asks are on their leads', !workCardEl());
      S.setMe(S.all('users').filter(function (u) { return u.role === 'admin'; })[0].id);
      window.render();
      until(function () { return workCardEl(); }, 'whoever builds the work does get it', onCard);
    });
  }

  function onCard(card) {
    var rows = card.querySelectorAll('[data-workrow]');
    say('  both the new ask and the older one are on it', rows.length === 2, rows.length);
    say('  oldest ask first', rows[0].dataset.workrow === older.id);
    var mine = card.querySelector('[data-workrow="' + laura.id + '"]');
    say('  the brief the rep wrote is on the row', /one-page site/.test(mine.textContent), mine.textContent);
    say('  what they asked for is on it', /Website/.test(mine.textContent) && /Logo/.test(mine.textContent));
    say('  and who asked', /Josh/.test(mine.textContent));
    say('  the older one shows how long it has waited', /6d waiting/.test(rows[0].textContent), rows[0].textContent);

    rows[0].querySelector('[data-startwork]').click();
    until(function () { return S.find('leads', older.id).mockupStatus === 'inprogress'; },
      'Start picks it up', function () {
        until(function () {
          var c = workCardEl();
          var r = c && c.querySelector('[data-workrow="' + older.id + '"]');
          return r && /Mark ready/.test(r.textContent) ? r : null;
        }, '  and the row now offers Mark ready', function (r) {
          r.querySelector('[data-startwork]').click();
          until(function () { return S.find('leads', older.id).mockupStatus === 'ready'; },
            'finishing it takes it off the queue', function () {
              var c = workCardEl();
              say('  only the outstanding ask is left', c.querySelectorAll('[data-workrow]').length === 1);
              say('  and it is now waiting to be sent', S.mockupsReadyToSend().some(function (l) { return l.id === older.id; }));
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
$profile = "$env:TEMP\tfs-crm-workqueue-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1400,900 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="wqResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
