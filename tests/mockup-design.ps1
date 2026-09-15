# Website and graphic design mockup links, through the real screens.
#
#   powershell -File tests\mockup-design.ps1
#
# Rules live in tests/mockup-design.js. This fills both links in the mockup
# dialog, checks both show on the record and as separate buttons on the ready
# card, attaches a batch of design mockups without touching a website link,
# and confirms the design field is switched off - not silently ignored -
# while the database cannot hold it yet.
#
# ASCII only - PowerShell 5.1 reads a BOM-less .ps1 as ANSI.
$edge  = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$src   = Split-Path -Parent $PSScriptRoot
$stage = "$env:TEMP\tfs-crm-design"

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
  /* An exception inside a step would otherwise end the run with nothing
     reported at all. Report it, and where it happened. */
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
    pre.id = 'dsResult';
    pre.textContent = '\n' + lines.join('\n') + '\n' +
      (lines.join('').indexOf('FAIL') > -1 ? 'DESIGN LINK FAILURES' : 'DESIGN LINK ALL PASS') + '\n';
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

  var SITE = 'https://thinkfirststudios.github.io/tfs-lead-previews/laura-zafonte/';
  var DESIGN = 'https://www.canva.com/design/laura-zafonte-flyer/';
  var DEREK_SITE = 'https://thinkfirststudios.github.io/tfs-lead-previews/derek-quarles/';
  var DEREK_DESIGN = 'https://thinkfirststudios.github.io/tfs-design-previews/derek-quarles/';

  var tries = 0;
  (function wait() {
    if (!(window.Store && window.Views && window.Views.leads && document.querySelector('#importBtn'))) {
      if (++tries > 400) { say('the app loaded', false); return finish(); }
      return setTimeout(wait, 25);
    }
    run();
  })();

  var S, laura, derek;
  function run() {
    S = window.Store;
    S.removeMany('leads', S.all('leads').map(function (l) { return l.id; }));
    laura = S.insert('leads', { name: 'Laura Zafonte', leadStatus: 'contacted', rating: 'warm', ownerId: S.me().id,
      branch: '', tags: [], nextFollowUp: S.shift(3), mockupStatus: 'none', mockupUrl: '', mockupDesignUrl: '',
      mockupTypes: [] }, 'l', 'Laura');
    derek = S.insert('leads', { name: 'Derek Quarles', leadStatus: 'contacted', rating: 'warm', ownerId: S.me().id,
      branch: '', tags: [], nextFollowUp: S.shift(3), mockupStatus: 'ready', mockupUrl: DEREK_SITE,
      mockupDesignUrl: '', mockupTypes: ['Website'], mockupReadyAt: S.shift(-1) }, 'l', 'Derek');

    location.hash = '#/leads/' + laura.id;
    until(function () { return document.querySelector('#mockupBtn'); }, 'the lead has a mockup button', function (b) {
      b.click();
      var m = topModal();
      var site = m && m.querySelector('[name=mockupUrl]');
      var design = m && m.querySelector('[name=mockupDesignUrl]');
      say('the mockup dialog has a website link field', !!site);
      say('and a separate graphic design link field', !!design);
      say('  labelled so you can tell them apart',
          m.textContent.indexOf('Website mockup link') > -1 && m.textContent.indexOf('Graphic design mockup link') > -1);
      say('  and the design field is usable', design && !design.disabled);
      m.querySelector('[name=mockupStatus]').value = 'ready';
      site.value = SITE;
      design.value = DESIGN;
      m.querySelector('[data-ok]').click();
      until(function () { var l = S.find('leads', laura.id); return l.mockupDesignUrl === DESIGN ? l : null; },
        'saving keeps both links', function (l) {
          say('  the website one too', l.mockupUrl === SITE, l.mockupUrl);
          say('  and ticks both kinds without being asked',
              l.mockupTypes.indexOf('Website') > -1 && l.mockupTypes.indexOf('Graphic Design') > -1,
              l.mockupTypes.join());
          until(function () {
            return document.body.textContent.indexOf('Design:') > -1 && document.body.textContent.indexOf('Website:') > -1;
          }, 'the record lists each link by kind', card);
        });
    });
  }

  function card() {
    location.hash = '#/leads';
    until(function () { return document.querySelector('[data-holdmockup="' + laura.id + '"]'); },
      'Laura is on the ready card', function (hold) {
        var side = hold.parentNode;
        say('  with a Website button', !!side.querySelector('a[data-mockuplink="website"][href*="laura-zafonte/"]'));
        say('  and a Design button', !!side.querySelector('a[data-mockuplink="design"][href*="canva"]'));
        var dside = document.querySelector('[data-holdmockup="' + derek.id + '"]').parentNode;
        say('a lead with only a website mockup shows only that button',
            dside.querySelectorAll('a[data-mockuplink]').length === 1);
        attach();
      });
  }

  function attach() {
    document.querySelector('#mockupsBtn').click();
    var m = topModal();
    var kind = m.querySelector('[name=kind]');
    say('Attach mockups asks what kind the batch is', !!kind);
    kind.value = 'design';
    m.querySelector('[name=urls]').value = DEREK_DESIGN;
    m.querySelector('[data-ok]').click();
    until(function () { var t = topModal(); return t && t.textContent.indexOf('Graphic Design mockups') > -1 ? t : null; },
      'the preview says it is attaching design mockups', function (prev) {
        var oks = prev.querySelectorAll('[data-ok]');
        oks[oks.length - 1].click();
        until(function () { var d = S.find('leads', derek.id); return d.mockupDesignUrl === DEREK_DESIGN ? d : null; },
          'Derek gets the design link', function (d) {
            say('  and keeps his website mockup', d.mockupUrl === DEREK_SITE, d.mockupUrl);
            guard();
          });
      });
  }

  function guard() {
    /* As if supabase/mockup-design-link.sql has not been run yet. */
    window.Backend.missingColumns = { leads: ['mockupDesignUrl'] };
    location.hash = '#/leads/' + laura.id;
    window.render();
    until(function () { return document.querySelector('#mockupBtn'); }, 'before the database update', function (b) {
      b.click();
      var m = topModal();
      var design = m.querySelector('[name=mockupDesignUrl]');
      say('  the design field is switched off, not silently ignored', design && design.disabled);
      say('  and says what turns it on', m.textContent.indexOf('mockup-design-link.sql') > -1);
      say('  the website field still works', !m.querySelector('[name=mockupUrl]').disabled);
      /* Cancel, the way a person would. Every dialog shares one container,
         so removing it from the page breaks the next dialog to open. */
      m.querySelector('[data-close]').click();
      location.hash = '#/leads';
      window.render();
      until(function () { return document.querySelector('#mockupsBtn'); }, 'on the leads list', function (btn) {
        btn.click();
        var opt = topModal().querySelector('[name=kind] option[value="design"]');
        say('  Attach mockups will not offer design links yet', opt && opt.disabled);
        window.Backend.missingColumns = {};
        finish();
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
$profile = "$env:TEMP\tfs-crm-design-profile"
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

$dom = & $edge --headless=new --disable-gpu --no-sandbox --user-data-dir=$profile `
  --virtual-time-budget=60000 --dump-dom "$base#/leads" 2>$null | Out-String

if ($dom -match '(?s)<pre id="dsResult">(.*?)</pre>') {
  $body = $matches[1] -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&' -replace '&quot;', '"'
  Write-Output $body.Trim()
  if ($body -match 'FAIL') { exit 1 }
  exit 0
}
Write-Output "the driver never reported"
exit 1
