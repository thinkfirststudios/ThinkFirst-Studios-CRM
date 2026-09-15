# Three things that slowed down working a calling list, through the real page.
#
#   powershell -File tests\quickwins.ps1
#
#  1. changing a lead's status from the pill on the list, without opening it
#  2. a note icon on leads somebody has written on (rules: tests/note-flags.js)
#  3. going into a lead and coming back to where you were on the list, not
#     the top of it
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-quickwins"

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
    pre.id = 'qwResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'QUICKWINS FAILURES' : 'QUICKWINS ALL PASS') + '\n';
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
  function row(id) {
    var pick = document.querySelector('[data-statuspick="' + id + '"]');
    return pick ? pick.closest('tr') : document.querySelector('tr[data-id="' + id + '"]');
  }
  function hover(el) { el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, fresh, noted, closer;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    var born = new Date(Date.now() - 86400000).toISOString();
    function mk(name, status) {
      return S.insert('leads', { name: name, leadStatus: status, rating: 'warm', ownerId: S.me().id,
        branch: '', tags: [], nextFollowUp: S.shift(5), createdAt: born, mockupStatus: 'none' }, 'l', name);
    }
    fresh = mk('Aaron Fresh', 'new');
    noted = mk('Aaron Noted', 'working');
    closer = mk('Aaron Closer', 'new');
    S.insertMany('notes', [{ entityType: 'lead', entityId: fresh.id, authorId: S.me().id, pinned: false,
      body: 'From the realtor contact list.', createdAt: born }], 'n', 'import');
    S.addNote('lead', noted.id, 'Wants pricing on the 3-bed listing.');
    var filler = [];
    for (var i = 0; i < 90; i++) {
      filler.push({ name: 'Zed Filler ' + (100 + i), leadStatus: 'new', rating: 'cold', ownerId: S.me().id,
        branch: '', tags: [], nextFollowUp: S.shift(9), mockupStatus: 'none' });
    }
    S.insertMany('leads', filler, 'l', 'filler');
    st();
  }

  function st() {
    location.hash = '#/leads';
    window.render();
    until(function () { return document.querySelector('[data-statuspick="' + fresh.id + '"]'); },
      'an open lead\'s status pill is a picker', function (pick) {
        /* 2. note icon */
        var nf = row(noted.id).querySelector('[data-noteflag]');
        say('the lead someone wrote on shows a note icon', !!nf);
        say('  with the note in its tooltip', nf && /3-bed listing/.test(nf.getAttribute('title')), nf && nf.getAttribute('title'));
        say('the lead with only its import note does not', !row(fresh.id).querySelector('[data-noteflag]'));
        say('and a lead with no notes does not', !row(closer.id).querySelector('[data-noteflag]'));

        /* 1. status picker */
        hover(pick);
        var menu = document.getElementById('statusMenu');
        say('hovering the pill opens the status menu', menu && !menu.hidden);
        say('  offering the other statuses', menu && menu.querySelector('[data-setstatus="working"]') &&
            menu.querySelector('[data-setstatus="dead"]'));
        say('  but not Converted, which is its own step', menu && !menu.querySelector('[data-setstatus="converted"]'));
        say('  and marking the current one', menu && menu.querySelector('[data-setstatus="new"]').disabled);
        menu.querySelector('[data-setstatus="working"]').click();
        until(function () { return S.find('leads', fresh.id).leadStatus === 'working'; },
          'picking Working changes the lead', function () {
            say('  without opening the lead', location.hash === '#/leads', location.hash);
            until(function () {
              var p = document.querySelector('[data-statuspick="' + fresh.id + '"]');
              return p && p.textContent.indexOf('Working') > -1;
            }, '  and the pill says Working', closing);
          });
      });
  }

  function closing() {
    var pick = document.querySelector('[data-statuspick="' + closer.id + '"]');
    pick.click();
    var menu = document.getElementById('statusMenu');
    say('tapping the pill opens the menu too, for a phone', menu && !menu.hidden);
    say('  and does not open the lead', location.hash === '#/leads');
    menu.querySelector('[data-setstatus="dead"]').click();
    var m = document.querySelector('.modal-root');
    say('marking it Dead asks why first', m && !!m.querySelector('[name=lostReason]'));
    m.querySelector('[name=lostReason]').value = 'Stopped replying after three calls.';
    m.querySelector('[data-ok]').click();
    until(function () { return S.find('leads', closer.id).leadStatus === 'dead'; }, 'it is marked Dead', function () {
      say('  with the reason kept', S.find('leads', closer.id).lostReason === 'Stopped replying after three calls.');
      until(function () { return !document.querySelector('[data-statuspick="' + closer.id + '"]'); },
        '  and it leaves the Active list', scroll);
    });
  }

  function scroll() {
    /* 3. back to where you were */
    window.render();
    var target = Math.min(1600, document.documentElement.scrollHeight - window.innerHeight - 10);
    say('the list is long enough to scroll', target > 400, target);
    window.scrollTo(0, target);
    setTimeout(function () {
      var saved = window.scrollY;
      location.hash = '#/leads/' + noted.id;
      until(function () { return document.querySelector('#logBtn') ? true : null; }, 'opening a lead', function () {
        say('  starts that lead at the top', window.scrollY < 5, window.scrollY);
        location.hash = '#/leads';
        until(function () { return document.querySelector('[data-statuspick]') ? true : null; }, 'coming back to the list', function () {
          say('  lands where you were, not at the top', Math.abs(window.scrollY - saved) < 5,
              'was ' + saved + ', now ' + window.scrollY);
          setTimeout(function () {
            var kept = {};
            try { kept = JSON.parse(sessionStorage.getItem('crm:scroll') || '{}'); } catch (e) {}
            say('and it is kept for a reload of this tab', Math.abs((kept['leads/'] || 0) - saved) < 5,
                JSON.stringify(kept));
            finish();
          }, 400);
        });
      });
    }, 150);
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-quickwins-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1280,800 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="qwResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
