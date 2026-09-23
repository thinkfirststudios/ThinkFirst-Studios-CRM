# Numbers that ring a switchboard instead of a person.
#
#   powershell -File tests\company-line.ps1
#
# Josh rang a morning of Redfin agents and reached Redfin's tour-and-booking
# desk every time: the profile publishes the company number, not the agent's.
# Same again where one number is listed on several leads. Those calls cannot
# succeed, so they do not belong on a call list.
#
# This drives the real screens as Josh: the flagged leads drop out of Follow
# Up Now and Call Backs, stay visible in the table with a reason, and one
# click marks a switchboard he finds himself.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-companyline"

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
    pre.id = 'clResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'COMPANY LINE FAILURES' : 'COMPANY LINE ALL PASS') + '\n';
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
  function rowText() { return (document.querySelector('#view') || document.body).textContent; }
  /* The table only. The queue cards above it are a different question, and
     a lead can rightly be in one and not the other. */
  function tableText() {
    var b = document.querySelector('tbody');
    return b ? b.textContent : '';
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, redfin, compass, twinA, twinB, direct;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    if (!S.find('users', 'josh')) {
      S.insert('users', { id: 'josh', name: 'Josh Martinez', role: 'rep', active: true, branch: '' }, 'u', 'Josh');
    }
    S.setMe('josh');

    var due = S.today();
    function lead(o) {
      o.leadStatus = o.leadStatus || 'new'; o.rating = 'warm'; o.ownerId = 'josh';
      o.branch = ''; o.tags = o.tags || []; o.mockupStatus = 'none';
      o.nextFollowUp = due;            // every one of them is due today
      return S.insert('leads', o, 'l', o.name);
    }

    // A Redfin agent profile: the number on it is Redfin's booking desk.
    redfin = lead({ name: 'Anjely Bisai', contactName: 'Anjely Bisai', phone: '(516) 908-5526',
                    website: 'https://www.redfin.com/real-estate-agents/anjely-bisai' });
    // Compass does the same thing with a directory you work through by name.
    compass = lead({ name: 'Frank Dong', contactName: 'Frank Dong', phone: '(914) 313-3581',
                     website: 'https://www.compass.com/agents/frank-dong/' });
    // One number, two "different" agents - a front desk by another name.
    twinA = lead({ name: 'Isaac Winkles', contactName: 'Isaac Winkles', phone: '(256) 683-4210' });
    twinB = lead({ name: 'Winkles Team', contactName: 'Ruth Winkles', phone: '256-683-4210' });
    // And an ordinary lead with a number that reaches the person.
    direct = lead({ name: 'Laura Zafonte', contactName: 'Laura Zafonte', phone: '(201) 788-1519' });

    var idx = S.companyLineIndex();
    say('the Redfin profile is a company line', !!idx[redfin.id], idx[redfin.id] || 'not flagged');
    say('  and it says why', /Redfin/.test(idx[redfin.id] || ''), idx[redfin.id]);
    say('a Compass profile is one too', !!idx[compass.id], idx[compass.id] || 'not flagged');
    say('  naming the directory', /directory/.test(idx[compass.id] || ''), idx[compass.id]);
    say('a number on two leads is a company line', !!idx[twinA.id] && !!idx[twinB.id],
        (idx[twinA.id] || 'no') + ' / ' + (idx[twinB.id] || 'no'));
    say('  counting the other lead, not itself', /1 other lead/.test(idx[twinA.id] || ''), idx[twinA.id]);
    say('an ordinary number is left alone', !idx[direct.id], idx[direct.id] || '');
    say('the same number written two ways still matches',
        !!idx[twinB.id] && /Same number/.test(idx[twinB.id]), idx[twinB.id]);

    // The queues are what Josh works from, so that is where it has to count.
    var queue = S.leadsNeedingAttention().map(function (l) { return l.id; });
    say('Follow Up Now keeps the lead worth ringing', queue.indexOf(direct.id) > -1);
    say('  and drops the switchboards', queue.indexOf(redfin.id) < 0 && queue.indexOf(twinA.id) < 0,
        queue.length + ' in the queue');
    say('the count beside it agrees', S.leadStats().attention === queue.length,
        S.leadStats().attention + ' vs ' + queue.length);

    S.scheduleCallback(direct.id, { date: due });
    S.scheduleCallback(redfin.id, { date: due });
    var cbs = S.callbacks().map(function (c) { return c.lead.id; });
    say('a call back to a person stands', cbs.indexOf(direct.id) > -1);
    say('  a call back to a booking desk does not', cbs.indexOf(redfin.id) < 0, cbs.length + ' booked');

    /* The leads screen was already drawn at boot, with the demo data that
       has since been cleared. Setting the hash it is already on fires no
       hashchange, so ask for the repaint directly. */
    location.hash = '#/leads';
    window.render();
    until(function () { return document.querySelector('#freach'); }, 'the leads table drew', filters);
  }

  function filters(sel) {
    // Nothing is hidden by default: the record is still the record.
    say('the table still lists the flagged leads', tableText().indexOf('Anjely Bisai') > -1);
    say('  marked as a company line', tableText().indexOf('company line') > -1);

    function pick(v, then) {
      sel = document.querySelector('#freach');
      sel.value = v;
      sel.onchange();
      setTimeout(then, 60);
    }
    pick('direct', function () {
      var t = tableText();
      say('"Direct number" shows the leads worth ringing',
          t.indexOf('Laura Zafonte') > -1 && t.indexOf('Anjely Bisai') < 0);
      pick('company', function () {
        var t2 = tableText();
        say('"Company line" gathers the rest for somebody to chase',
            t2.indexOf('Anjely Bisai') > -1 && t2.indexOf('Isaac Winkles') > -1 &&
            t2.indexOf('Frank Dong') > -1 && t2.indexOf('Laura Zafonte') < 0, t2.slice(0, 120));
        pick('', function () { marking(); });
      });
    });
  }

  // The switchboard Josh finds himself, in one click, from the queue.
  function marking() {
    location.hash = '#/leads/' + direct.id;
    until(function () { return document.querySelector('#lineOn'); },
      'a lead record offers "Company line"', function (btn) {
        btn.click();
        setTimeout(function () {
          var l = S.find('leads', direct.id);
          say('the mark sticks to the lead', S.hasTag(l, S.COMPANY_LINE_TAG), (l.tags || []).join(','));
          say('  the follow-up goes with it', !l.nextFollowUp, l.nextFollowUp);
          say('  so does the call back',
              S.callbacks().filter(function (c) { return c.lead.id === direct.id; }).length === 0);
          say('  it leaves the call queue',
              S.leadsNeedingAttention().map(function (x) { return x.id; }).indexOf(direct.id) < 0);
          say('  the lead stays open, not dead', S.isLeadOpen(l), l.leadStatus);
          say('  and why is written on the record',
              S.notesFor('lead', direct.id).some(function (n) {
                return /company line/i.test(n.body || '');
              }));
          undoing();
        }, 80);
      });
  }

  function undoing() {
    location.hash = '#/leads/' + direct.id;
    until(function () { return document.querySelector('#lineOff'); },
      'and "Direct number" to take it back off', function (btn) {
        btn.click();
        setTimeout(function () {
          var l = S.find('leads', direct.id);
          say('the mark comes off again', !S.hasTag(l, S.COMPANY_LINE_TAG), (l.tags || []).join(','));
          say('  and the lead is ringable again', !S.companyLineIndex()[direct.id]);

          // A Redfin lead is judged from its record, so the button must not
          // pretend it can be argued with - correct the record instead.
          location.hash = '#/leads/' + redfin.id;
          setTimeout(function () {
            var off = document.querySelector('#lineOff');
            say('a lead flagged by its record says so rather than a mark', !!off);
            if (off) {
              off.click();
              setTimeout(function () {
                say('  and clicking it changes nothing', !!S.companyLineIndex()[redfin.id]);
                // Fixing the number is the way back.
                S.update('leads', redfin.id, { website: 'anjelysellshomes.com' }, 'test');
                say('  correcting the record is what clears it', !S.companyLineIndex()[redfin.id]);
                finish();
              }, 80);
            } else { finish(); }
          }, 120);
        }, 80);
      });
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-companyline-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="clResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
