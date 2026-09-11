# Searching inside notes, and exporting what was said.
#
#   powershell -File tests\note-search.ps1
#
# "Which of these asked for a mockup?" was unanswerable without opening every
# lead in turn: the search box covered the contact fields but not the note
# bodies, and the CSV export carried twenty-four columns of contact detail
# and none of the conversation. What a rep learns on a call lives only in
# the note, so both of those made the most valuable field in the CRM the one
# nobody could get at.
#
# The scale check at the end matters as much as the feature. Asking
# notesFor() inside the row filter would be a scan of every note for every
# lead - a thousand by a thousand, on every keystroke.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-notesearch"

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
    pre.id = 'nsResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'NOTE SEARCH FAILURES' : 'NOTE SEARCH ALL PASS') + '\n';
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
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#fq'))) {
      if (++tries > 400) { say('the leads screen loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  function rowNames() {
    return [].map.call(document.querySelectorAll('.tbl tbody tr td:nth-child(2) span.link'),
                       function (s) { return s.textContent.trim(); });
  }

  function run() {
    var S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));

    var cast = [
      ['Pousada Ilha da Magia', 'Spoke to the owner, wants to see a mockup before deciding.'],
      ['Cris Hotel',            'Asked for a mockup of the booking page. Send Thursday.'],
      ['A Baleeira',            'Not interested, they have an agency already.'],
      ['Cool Office Lagoa',     'Left a voicemail, nobody picked up.'],
      ['Zen Telecom',           'Gatekeeper took a message.']
    ];
    var made = {};
    cast.forEach(function (pair) {
      var l = S.insert('leads', { name: pair[0], leadStatus: 'new', rating: 'warm',
        ownerId: S.me().id, branch: '', tags: [], mockupStatus: 'none', mockupUrl: '',
        mockupTypes: [], nextFollowUp: '' }, 'l', pair[0]);
      made[pair[0]] = l;
      S.addNote('lead', l.id, pair[1]);
    });
    say('five leads, each with a note', S.all('leads').length === 5 && S.all('notes').length >= 5,
        S.all('leads').length + ' leads, ' + S.all('notes').length + ' notes');

    /* The index the list builds once per render. */
    var idx = S.noteIndex('lead');
    say('the note index finds a lead by its note',
        (idx[made['Cris Hotel'].id] || '').indexOf('booking page') > -1,
        idx[made['Cris Hotel'].id]);
    say('and holds nothing for a lead with no note',
        !idx['nope'], idx['nope']);

    window.render();
    say('all five are listed to begin with', rowNames().length === 5, rowNames().join(', '));

    var q = document.querySelector('#fq');
    q.value = 'mockup';
    q.dispatchEvent(new Event('input', { bubbles: true }));

    until(function () { return rowNames().length === 2 ? rowNames() : null; },
      'searching notes for "mockup" narrows to two', function (names) { after(S, made, names); });
  }

  function after(S, made, names) {
    say('  the one who asked outright is there', names.indexOf('Cris Hotel') > -1, names.join(', '));
    say('  and the one who wants to see one first', names.indexOf('Pousada Ilha da Magia') > -1, names.join(', '));
    say('  the lead that said no is not', names.indexOf('A Baleeira') < 0);
    say('  nor is the voicemail', names.indexOf('Cool Office Lagoa') < 0);

    /* A word in a note that is in no other field - proof the note is really
       what matched, not the company name happening to contain it. */
    /* The box debounces at 220ms, so every check below waits for the list
       to actually change rather than for a fixed moment. */
    var q = document.querySelector('#fq');
    q.value = 'gatekeeper';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    until(function () {
      var n = rowNames();
      return (n.length === 1 && n[0] === 'Zen Telecom') ? n : null;
    }, 'a word that appears only in a note still finds its lead', function () {
      q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      until(function () { return rowNames().length === 5 ? true : null; },
        'clearing the box brings them all back', function () { scale(S); });
    });
  }

  function scale(S) {
    /* A thousand leads with a note each. If the filter asked notesFor() per
       row this would be a million comparisons per keystroke. */
    var extra = [];
    for (var i = 0; i < 1000; i++) {
      extra.push({ name: 'Filler ' + i, leadStatus: 'new', rating: 'cold', ownerId: S.me().id,
                   branch: '', tags: [], mockupStatus: 'none', mockupUrl: '', mockupTypes: [],
                   nextFollowUp: '' });
    }
    var made = S.insertMany('leads', extra, 'l', '1000 filler leads');
    S.insertMany('notes', made.map(function (l) {
      return { entityType: 'lead', entityId: l.id, authorId: S.me().id,
               body: 'Imported from the list. Nothing said yet.', pinned: false };
    }), 'n', '1000 notes');
    note('now ' + S.all('leads').length + ' leads and ' + S.all('notes').length + ' notes');

    var q = document.querySelector('#fq');
    var t = performance.now();
    q.value = 'mockup';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    until(function () { return rowNames().length === 2 ? true : null; },
      'still finds exactly the two at that size', function () {
        /* Includes the 220ms the box deliberately waits before searching,
           so anything near that number is the debounce, not the work. */
        var ms = performance.now() - t;
        note('typed to redrawn: ' + ms.toFixed(0) + 'ms, of which 220 is the debounce');
        say('searching a thousand notes is not what makes it wait', ms < 1200, ms.toFixed(0) + 'ms');
        exportCheck(S);
      });
  }

  function exportCheck(S) {
    /* The export is how this leaves the building - for a spreadsheet, or to
       hand to somebody who cannot open the CRM at all. */
    var captured = null;
    var real = window.download;
    window.download = function (name, body) { captured = body; };
    var q = document.querySelector('#fq');
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    /* Export writes the rows currently on screen, so the filter has to have
       actually cleared before this means anything. */
    until(function () { return rowNames().length > 5 ? true : null; },
      'the filter cleared before exporting', function () {
      var btn = document.querySelector('#exportBtn') ||
        [].filter.call(document.querySelectorAll('button'), function (b) {
          return /export/i.test(b.textContent);
        })[0];
      say('there is an export button', !!btn);
      if (btn) btn.click();
      window.download = real;

      say('the export ran', !!captured);
      if (captured) {
        var head = captured.split('\n')[0];
        say('it has a Notes column', head.indexOf('"Notes"') > -1 || head.indexOf('Notes') > -1, head.slice(-60));
        say('and the note text is actually in it',
            captured.indexOf('booking page') > -1);
        say('including the one that said no',
            captured.indexOf('they have an agency already') > -1);
      }
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
$profile = "$env:TEMP\tfs-crm-notesearch-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=90000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="nsResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
