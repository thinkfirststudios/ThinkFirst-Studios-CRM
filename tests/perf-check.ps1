# Where does the time actually go?
#
#   powershell -File tests\perf-check.ps1
#
# A rep reported the page freezing "for a few mins at a time" when logging a
# note or pasting into the mockup tab. This runs the real screens against a
# realistic book - 1,200 leads, a note on each - in LOCAL mode, so there is
# no network in the measurement at all. Whatever it reports is pure client
# cost. If these numbers are small, the freeze is not in the browser and the
# next place to look is the database.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-perf"

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
  function ms(label, fn) {
    var t = performance.now();
    var out = fn();
    var d = performance.now() - t;
    lines.push((d > 1000 ? 'SLOW ' : 'ok   ') + label + ' -> ' + d.toFixed(0) + 'ms');
    return out;
  }
  function note(s) { lines.push('     ' + s); }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'perfResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('SLOW') > -1 ? 'PERF SLOW PATHS FOUND' : 'PERF ALL FAST') + '\n';
    document.body.appendChild(pre);
  }

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { lines.push('FAIL app never loaded'); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function run() {
    var S = window.Store;
    var me = S.me().id;

    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));

    var N = 1200;
    var leads = [];
    for (var i = 0; i < N; i++) {
      leads.push({
        name: 'Lead ' + i, contactName: 'Person ' + i, contactTitle: 'Realtor',
        email: 'lead' + i + '@example.com', phone: '(555) 555-' + ('0000' + i).slice(-4),
        website: 'lead' + i + '.example.com', industry: 'Real Estate',
        address: 'Town, State', leadStatus: 'new', rating: 'cold', estValue: 0,
        source: 'Realtor List', nextFollowUp: '', lastContactedAt: '',
        tags: ['realtor', 'own-site'], branch: '', ownerId: me,
        convertedCustomerId: '', convertedAt: ''
      });
    }
    ms('seed ' + N + ' leads', function () {
      return S.insertMany('leads', leads, 'l', N + ' leads');
    });
    var all = S.all('leads');
    note('leads in store: ' + all.length);

    ms('seed a note on every lead', function () {
      return S.insertMany('notes', all.map(function (l) {
        return { entityType: 'lead', entityId: l.id, authorId: me,
                 body: 'From the realtor contact list. Site listed.', pinned: false };
      }), 'n', all.length + ' notes');
    });
    note('notes in store: ' + S.all('notes').length);

    /* The list screen, which is what a rep sits on all day. */
    location.hash = '#/leads';
    ms('render the leads list', function () { window.render && window.render(); return 1; });

    /* Selectors the list and dashboard call per render. */
    ms('leadsNeedingAttention()', function () { return S.leadsNeedingAttention().length; });
    ms('mockupsReadyToSend()', function () { return S.mockupsReadyToSend().length; });
    ms('visibleLeads()', function () { return S.visibleLeads().length; });
    ms('knownKeys() over every lead', function () { return Object.keys(S.knownKeys()).length; });

    /* notesFor is called per lead on the record screen - and, if anything
       calls it per ROW, this is where a list turns quadratic. */
    var one = all[0];
    ms('notesFor() one lead', function () { return S.notesFor('lead', one.id).length; });
    ms('notesFor() for all 1200 leads', function () {
      var t = 0;
      all.forEach(function (l) { t += S.notesFor('lead', l.id).length; });
      return t;
    });

    /* Opening a record, then posting a note on it - the exact action that
       was reported as freezing. */
    location.hash = '#/leads/' + one.id;
    ms('open a lead record', function () { window.render && window.render(); return 1; });
    ms('addNote + repaint', function () {
      S.addNote('lead', one.id, 'Called, left a voicemail. Trying again Thursday.');
      return 1;
    });
    ms('a second note', function () {
      S.addNote('lead', one.id, 'Second note.');
      return 1;
    });

    /* Typing in the mockup URL field. */
    ms('update mockupUrl', function () {
      S.update('leads', one.id, { mockupUrl: 'https://example.com/mockups/lead-0.png',
                                  mockupStatus: 'ready' }, 'mockup');
      return 1;
    });

    note('activity rows: ' + S.all('activity').length);
    finish();
  }
})();
</script>
'@

$index = Join-Path $stage 'index.html'
$html = Get-Content -Raw $index
Set-Content -Encoding utf8 $index ($html -replace '</body>', ($driver + "`r`n</body>"))

$base = "file:///" + ($stage.Replace('\','/').Replace(' ','%20')) + "/index.html"
$profile = "$env:TEMP\tfs-crm-perf-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=120000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="perfResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  exit 0
}
Write-Output "the driver never reported"
exit 1
