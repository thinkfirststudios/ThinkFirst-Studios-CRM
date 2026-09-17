# Team Activity, through the real admin screen.
#
#   powershell -File tests\team-activity.ps1
#
# The rules live in tests/team-activity.js. This checks the panel is
# actually reachable and actually draws: that the tab exists, that a person
# with work shows their numbers, that clicking them opens their own feed and
# nobody else's, that changing the period changes what is counted, and that
# a rep who opens Admin is still told to go away.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-team"

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
    pre.id = 'tmResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'TEAM FAILURES' : 'TEAM ALL PASS') + '\n';
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
  function tabNamed(text) {
    var all = document.querySelectorAll('#adminTabs button');
    for (var i = 0; i < all.length; i++) {
      if (all[i].textContent.indexOf(text) > -1) return all[i];
    }
    return null;
  }
  function rowFor(name) {
    var trs = document.querySelectorAll('#adminBody .tbl tbody tr');
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].textContent.indexOf(name) > -1) return trs[i];
    }
    return null;
  }
  function day(n) {
    var d = new Date(); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.admin)) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, josh, cass;
  function run() {
    S = window.Store;
    var db = S.db();

    josh = S.insert('users', { name: 'Josh Test', email: 'josh@test', role: 'rep',
      active: true, branch: '' }, 'u', 'Josh');
    cass = S.insert('users', { name: 'Cassius Test', email: 'cass@test', role: 'manager',
      active: true, branch: 'Brazil' }, 'u', 'Cassius');

    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    function mk(owner, last, next) {
      return S.insert('leads', { name: 'L' + Math.random().toString(36).slice(2, 7),
        ownerId: owner, lastContactedAt: last || '', nextFollowUp: next || '',
        leadStatus: 'working', rating: 'warm', branch: '', tags: [], mockupStatus: 'none' }, 'l', 'L');
    }
    mk(josh.id, day(-1), day(-3));
    mk(josh.id, day(-2), day(4));
    mk(josh.id, '', day(-9));
    mk(cass.id, day(-1), '');

    /* Written straight in: insert() would log them all against whoever is
       signed in, and the point is that they are attributed per person. */
    db.activity.length = 0;
    function act(uid, action, detail, off) {
      db.activity.push({ id: 'a' + db.activity.length, userId: uid, action: action,
        detail: detail, entityType: 'lead', entityId: 'x',
        ts: day(off) + 'T12:00:00.000Z' });
    }
    act(josh.id, 'updated', 'contacted L one', -1);
    act(josh.id, 'updated', 'contacted L two', -2);
    act(josh.id, 'noted', 'left a voicemail', -2);
    act(josh.id, 'updated', 'contacted L three', -20);
    act(cass.id, 'created', 'added a lead', -1);
    db.activity.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });

    location.hash = '#/admin';
    window.render();
    until(function () { return tabNamed('Team Activity'); }, 'Admin has a Team Activity tab', function (tab) {
      tab.click();
      until(function () { return rowFor('Josh Test'); }, 'the panel lists the team', check);
    });
  }

  function check() {
    var r = rowFor('Josh Test');
    var cells = r.querySelectorAll('td');
    var txt = function (i) { return cells[i] ? cells[i].textContent.trim() : '?'; };
    say('  it says what they own', txt(1) === '3', txt(1));
    say('  how many they have spoken to lately', txt(2) === '2', txt(2));
    say('  how many calls they logged', txt(3) === '2', txt(3));
    say('  their notes', txt(4) === '1', txt(4));
    say('  what is overdue', txt(6).indexOf('2') > -1, txt(6));
    say('  and what has never been called at all', txt(7) === '1', txt(7));

    var c = rowFor('Cassius Test');
    say('a second person is counted separately', c && c.querySelectorAll('td')[1].textContent.trim() === '1',
        c ? c.querySelectorAll('td')[1].textContent.trim() : 'no row');
    say('  and their role and branch are shown', c.textContent.indexOf('Brazil') > -1);
    say('the busiest person is listed first',
        document.querySelectorAll('#adminBody .tbl tbody tr')[0].textContent.indexOf('Josh Test') > -1);
    drill();
  }

  /* Card titles, not document.body.textContent - the driver itself is a
     <script> inside the body, so body text contains every string in this
     file and matches phrases that are nowhere on the screen. */
  function cardTitles() {
    var out = [];
    document.querySelectorAll('#adminBody .card-title').forEach(function (t) {
      out.push(t.textContent);
    });
    return out;
  }
  function hasDrillFor(name) {
    return cardTitles().filter(function (t) {
      return t.indexOf(name) > -1 && t.indexOf('every action') > -1;
    }).length === 1;
  }

  function drill() {
    document.querySelector('[data-team="' + josh.id + '"]').click();
    until(function () {
      return hasDrillFor('Josh Test') ? 1 : null;
    }, 'clicking a person opens their own feed', function () {
      var feed = document.querySelectorAll('#adminBody .timeline .tl-item');
      var names = [];
      for (var i = 0; i < feed.length; i++) {
        var n = feed[i].querySelector('strong');
        if (n && names.indexOf(n.textContent) < 0) names.push(n.textContent);
      }
      say('  and it is only them in it', names.length === 1 && names[0] === 'Josh Test', names.join());
      say('  showing the entries from the period', feed.length === 3, feed.length);

      document.querySelector('#teamClose').click();
      until(function () {
        return (!hasDrillFor('Josh Test') && !document.querySelector('#teamClose')) ? 1 : null;
      }, '  and it closes again', period);
    });
  }

  function period() {
    var btns = document.querySelectorAll('#teamPeriod button');
    say('the period can be changed', btns.length === 4, btns.length);
    var all = null;
    for (var i = 0; i < btns.length; i++) if (btns[i].textContent.indexOf('All time') > -1) all = btns[i];
    all.click();
    until(function () {
      var r = rowFor('Josh Test');
      return r && r.querySelectorAll('td')[3].textContent.trim() === '3' ? r : null;
    }, 'All time picks up the call from three weeks ago', function () {
      var today = null;
      var b = document.querySelectorAll('#teamPeriod button');
      for (var i = 0; i < b.length; i++) if (b[i].textContent.indexOf('Today') > -1) today = b[i];
      today.click();
      until(function () {
        var r = rowFor('Josh Test');
        return r && r.querySelectorAll('td')[3].textContent.trim() === '1' ? r : null;
      }, 'Today narrows it to one', function (r) {
        say('  but what they own does not shrink with the window',
            r.querySelectorAll('td')[1].textContent.trim() === '3',
            r.querySelectorAll('td')[1].textContent.trim());
        locked();
      });
    });
  }

  function locked() {
    /* A rep must not be able to read the whole team's numbers. */
    S.setMe(josh.id);
    window.render();
    until(function () {
      var h = document.querySelector('#view .empty h4');
      return h && /Admin access required/i.test(h.textContent) ? h : null;
    }, 'a rep opening Admin is turned away', function () {
      say('  and the team table is not on the page for them',
          !document.querySelector('#adminTabs') && cardTitles().length === 0,
          cardTitles().join(' / '));
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
$profile = "$env:TEMP\tfs-crm-team-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --window-size=1500,950 --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/admin" 2>$null | Out-String

if ($dom -match '(?s)<pre id="tmResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
