# Clearing thousands of follow-up dates at once, without touching the rest.
#
#   powershell -File tests\bulk-scale.ps1
#
# bulk-check.ps1 drives the same bar against the handful of seeded leads.
# This one seeds a realtor import on top of existing work and checks the
# thing that actually matters after that import: that filtering to the
# imported source and pressing select-all reaches every one of them, that
# Unschedule clears the lot in one go, and - the part with teeth - that the
# leads which were already there keep the follow-up dates somebody chose.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-scale"

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
  var N = 2526;                 // the real import size
  var lines = [], t0 = Date.now();
  function say(label, cond, extra) {
    lines.push((cond ? 'ok   ' : 'FAIL ') + label + (cond || extra === undefined ? '' : ' -> ' + extra));
  }
  function note(s) { lines.push('     ' + s); }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'scaleResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'SCALE FAILURES' : 'SCALE ALL PASS') + '\n';
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

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the leads screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;

    // The leads that were already there, with dates somebody chose.
    var existing = S.all('leads').slice();
    existing.forEach(function (l, i) {
      S.update('leads', l.id, { nextFollowUp: S.shift(i + 1) }, 'seed');
    });
    var existingDates = {};
    existing.forEach(function (l) { existingDates[l.id] = S.find('leads', l.id).nextFollowUp; });
    note('leads already present: ' + existing.length);

    // The import, every row stamped with the same date - the bug being undone.
    var stamped = S.shift(2), batch = [];
    for (var i = 0; i < N; i++) {
      batch.push({
        name: 'Realtor ' + i, contactName: 'Realtor ' + i, contactTitle: 'Realtor',
        email: 'realtor' + i + '@example.com',
        // Every third one has no number, mirroring the real list.
        phone: (i % 3 === 0) ? '' : '(555) 555-' + (1000 + (i % 9000)),
        website: '',
        instagram: '', tiktok: '', facebook: '',
        address: 'Somewhere', industry: 'Real Estate', source: 'Realtor List',
        estValue: 0, leadStatus: 'new', rating: 'cold',
        ownerId: S.me().id, nextFollowUp: stamped, lastContactedAt: '',
        tags: ['realtor', 'own-site'], convertedCustomerId: '', convertedAt: ''
      });
    }
    var t = Date.now();
    S.insertMany('leads', batch, 'l', N + ' realtors');
    note('seeded ' + N + ' in ' + (Date.now() - t) + 'ms');
    say('they are all in the store', S.all('leads').length === existing.length + N,
        S.all('leads').length);

    t = Date.now();
    window.render();
    note('rendered the full list in ' + (Date.now() - t) + 'ms');

    // Filter to the imported source, the way a person would.
    var sel = document.querySelector('#fsource');
    say('a source filter exists', !!sel);
    if (!sel) return finish();
    var has = false;
    for (var j = 0; j < sel.options.length; j++) {
      if (sel.options[j].value === 'Realtor List') has = true;
    }
    say('"Realtor List" is one of its options', has);
    sel.value = 'Realtor List';
    sel.onchange();

    until(function () { return document.querySelector('#pickAll'); },
      'the list redrew with the filter on', function () { afterFilter(S, existing, existingDates, stamped); });
  }

  function afterFilter(S, existing, existingDates, stamped) {
    var boxes = document.querySelectorAll('[data-pick]');
    say('only the imported leads are listed', boxes.length === 2526, boxes.length);

    var t = Date.now();
    var all = document.querySelector('#pickAll');
    all.checked = true;
    all.onclick();
    note('select-all took ' + (Date.now() - t) + 'ms');

    /* Read the count against the rows actually on screen, and let a
       pending repaint settle first - the bar re-syncs after one, so
       sampling the instant after the click can catch it mid-flight. */
    until(function () {
      var c = document.querySelector('#bulkCount');
      var n = document.querySelectorAll('[data-pick]').length;
      return (c && c.textContent === n + ' leads selected') ? c : null;
    }, 'the bar counts every row on screen', function () {
      var c = document.querySelector('#bulkCount');
      say('and that is all 2,526 of them',
          c.textContent === '2526 leads selected', c.textContent);
      afterSelectAll(S, existing, existingDates, stamped);
    });
  }

  function afterSelectAll(S, existing, existingDates, stamped) {
    var t = Date.now();

    document.querySelector('[data-bulk="none"]').click();
    note('unschedule took ' + (Date.now() - t) + 'ms');

    var imported = S.all('leads').filter(function (l) { return l.source === 'Realtor List'; });
    say('every imported lead lost its date',
        imported.length === 2526 && imported.every(function (l) { return !l.nextFollowUp; }),
        imported.filter(function (l) { return l.nextFollowUp; }).length + ' still dated');

    say('the leads that were already there kept theirs',
        existing.every(function (l) {
          var now = S.find('leads', l.id);
          return now && now.nextFollowUp === existingDates[l.id];
        }),
        existing.filter(function (l) {
          var now = S.find('leads', l.id);
          return !now || now.nextFollowUp !== existingDates[l.id];
        }).length + ' were changed');

    say('none of them is still holding the stamped date',
        !S.all('leads').some(function (l) {
          return l.source === 'Realtor List' && l.nextFollowUp === stamped;
        }));

    var acts = S.all('activity').filter(function (e) {
      return /follow-up/i.test(String(e.detail || '')) && /cleared/i.test(String(e.detail || ''));
    });
    say('it logged one line, not 2,526', acts.length === 1, acts.length);

    assignThenDelete(S);
  }

  /* Handing the list out, the way three people sharing it would: select
     everything, open Assign, tick the team, confirm. */
  function assignThenDelete(S) {
    var users = S.activeUsers();
    note('active users: ' + users.length);

    var all = document.querySelector('#pickAll');
    all.checked = true; all.onclick();

    var btn = document.querySelector('#bulkAssign');
    say('there is an Assign action', !!btn);
    if (!btn || users.length < 2) {
      note('fewer than two active users - skipping the split');
      return deleteNoPhone(S);
    }
    btn.click();

    var boxes = document.querySelectorAll('.assignUser');
    say('the dialog lists everyone', boxes.length === users.length, boxes.length);

    // Tick all of them and read the previewed shares.
    boxes.forEach(function (b) { if (!b.checked) { b.checked = true; b.onchange(); } });
    var shares = [].map.call(document.querySelectorAll('[data-share]'), function (s) {
      return parseInt(s.textContent, 10) || 0;
    }).filter(function (n) { return n > 0; });
    var total = shares.reduce(function (a, b) { return a + b; }, 0);
    say('the preview accounts for every selected lead', total === 2526, total);
    say('and splits them evenly', Math.max.apply(null, shares) - Math.min.apply(null, shares) <= 1,
        shares.join('/'));

    var t = Date.now();
    var oks = document.querySelectorAll('.modal-root [data-ok]');
    oks[oks.length - 1].click();
    note('assign took ' + (Date.now() - t) + 'ms');

    var counts = {};
    S.all('leads').filter(function (l) { return l.source === 'Realtor List'; })
      .forEach(function (l) { counts[l.ownerId] = (counts[l.ownerId] || 0) + 1; });
    var owners = Object.keys(counts);
    say('the leads are spread across the team', owners.length === users.length,
        owners.map(function (o) { return S.user(o).name + '=' + counts[o]; }).join(' '));
    say('and every one of them still has an owner',
        S.all('leads').every(function (l) { return !!l.ownerId; }));

    deleteNoPhone(S);
  }

  /* The delete path, driven the way a person would: filter to the ones with
     no number, select all, press Delete, confirm. */
  function deleteNoPhone(S) {
    var sel = document.querySelector('#freach');
    say('a contact filter exists', !!sel);
    if (!sel) { finish(); return; }
    sel.value = 'nophone';
    sel.onchange();

    var boxes = document.querySelectorAll('[data-pick]');
    var expected = S.all('leads').filter(function (l) { return !l.phone; }).length;
    say('the filter shows exactly the ones with no phone',
        boxes.length === expected, boxes.length + ' of ' + expected);
    say('and every row on screen really has none',
        [].every.call(boxes, function (b) {
          return !S.find('leads', b.dataset.pick).phone;
        }));

    var all = document.querySelector('#pickAll');
    all.checked = true; all.onclick();

    var leadsBefore = S.all('leads').length;
    var withPhone = S.all('leads').filter(function (l) { return l.phone; }).length;

    var t = Date.now();
    document.querySelector('#bulkDelete').click();

    // A confirmation stands between the click and the deletion.
    var dialog = document.querySelector('.modal-root [data-ok]');
    say('it asks before deleting', !!dialog);
    if (!dialog) { finish(); return; }
    say('nothing is deleted until you confirm',
        S.all('leads').length === leadsBefore, S.all('leads').length);
    dialog.click();
    note('delete took ' + (Date.now() - t) + 'ms');

    say('the ones with no phone are gone',
        S.all('leads').filter(function (l) { return !l.phone; }).length === 0,
        S.all('leads').filter(function (l) { return !l.phone; }).length);
    say('and every lead with a phone survived',
        S.all('leads').filter(function (l) { return l.phone; }).length === withPhone,
        S.all('leads').filter(function (l) { return l.phone; }).length + ' of ' + withPhone);
    say('no orphaned notes were left',
        S.all('notes').every(function (n) {
          return n.entityType !== 'lead' || !!S.find('leads', n.entityId);
        }));

    note('total ' + (Date.now() - t0) + 'ms end to end');
    finish();
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-scale-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

& $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=8000 --dump-dom "$base#/dashboard" 2>$null | Out-Null

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="scaleResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported - the page did not finish booting"
exit 1
