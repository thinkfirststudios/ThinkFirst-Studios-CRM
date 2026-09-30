/* ═══════════════════════════════════════════════════════════════════
   pitch.js — the "copy the pitch link" panel on a lead record.

   A rep is on a cold call and says "let me send you something". This
   turns that into one click: it resolves the lead's industry to the
   matching private portfolio page on the website, builds the URL with a
   tracking token for this lead, and puts it on the clipboard.

   TWO VOCABULARIES. The CRM's `industry` is a free-text field filled in
   by whoever added the lead ('Food & Bev', 'Legal', 'Fitness'). The
   website's pitch pages are keyed on work.html's `category` ('Real
   Estate', 'Construction', 'Music'). They were never the same list and
   there is no reason they would be, so ALIASES does the translating and
   anything it cannot translate is reported honestly rather than
   silently sending a restaurant owner a set of real estate sites.

   PAGES is generated — run `node tools/build-pitch-pages.mjs` in the
   website repo and paste what it prints. It changes only when a new
   industry gains its first demo.
   ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SITE = 'https://thinkfirststudios.com';

  /* ── generated: paste from tools/build-pitch-pages.mjs ───────────── */
  var PAGES = {
    'Automotive':     '/p/bba4663362-automotive/',
    'Construction':   '/p/b1b6015af7-construction/',
    'Education':      '/p/85702d9411-education/',
    'Electrical':     '/p/4fe014e15a-electrical/',
    'Events':         '/p/b547a6b2d2-events/',
    'Handyman':       '/p/84aaf88f97-handyman/',
    'Health & Beauty': '/p/8333ce3ef9-health-beauty/',
    'Home Services':  '/p/695128ac1b-home-services/',
    'HVAC':           '/p/74b9c2751b-hvac/',
    'Music':          '/p/016e2a43d9-music/',
    'Pest Control':   '/p/2a1e85e9d4-pest-control/',
    'Pet Services':   '/p/9510476410-pet-services/',
    'Real Estate':    '/p/3febac3af9-real-estate/',
    'Recreation':     '/p/8f6ebbf37b-recreation/',
    'Retail':         '/p/a3daf060ca-retail/'
  };

  /* ── CRM industry → website category ─────────────────────────────
     Keys are matched at the START OF A WORD, so 'landscap' still catches
     both Landscaping and Landscaper without needing an entry each, but
     'pet' no longer catches carPET and 'spa' no longer catches sPAcious.

     Matching anywhere in the string sent a carpet cleaner a page of car
     detailing demos, because 'car' is inside carpet - and carpentry, and
     cargo, and caregiver. Same shape as the bug where 'ig' inside
     Neighborhood was read as an Instagram handle. A wrong page here is
     worse than no page: the rep has already told the prospect it is
     coming, and what arrives is somebody else's trade.

     ORDER MATTERS - first hit wins, so a trade with its own demo page is
     asked about before the general Home Services one that would otherwise
     swallow it. */
  var ALIASES = [
    ['real estate', 'Real Estate'], ['realtor', 'Real Estate'], ['property', 'Real Estate'],
    ['broker', 'Real Estate'], ['mortgage', 'Real Estate'],
    /* 'car' is deliberately absent - see above. These cover it safely. */
    ['auto', 'Automotive'], ['vehicle', 'Automotive'], ['mechanic', 'Automotive'],
    ['detailing', 'Automotive'], ['collision', 'Automotive'], ['tire', 'Automotive'],
    ['dent', 'Automotive'], ['windshield', 'Automotive'],
    ['construct', 'Construction'], ['contractor', 'Construction'], ['builder', 'Construction'],
    ['roof', 'Construction'], ['concrete', 'Construction'], ['remodel', 'Construction'],
    ['renovat', 'Construction'], ['carpentry', 'Construction'], ['fenc', 'Construction'],
    /* The trades that now have a page of their own, before the catch-all. */
    ['hvac', 'HVAC'], ['air condition', 'HVAC'], ['heating', 'HVAC'], ['cooling', 'HVAC'],
    ['electric', 'Electrical'],
    ['pest', 'Pest Control'], ['exterminat', 'Pest Control'],
    ['handyman', 'Handyman'], ['home repair', 'Handyman'],
    ['pet groom', 'Pet Services'], ['pet serv', 'Pet Services'], ['pet sitting', 'Pet Services'],
    ['grooming', 'Pet Services'], ['veterinar', 'Pet Services'], ['kennel', 'Pet Services'],
    ['dog', 'Pet Services'],
    ['event', 'Events'], ['party rental', 'Events'], ['catering', 'Events'],
    ['wedding', 'Events'], ['banquet', 'Events'],
    ['plumb', 'Home Services'], ['clean', 'Home Services'], ['landscap', 'Home Services'],
    ['lawn', 'Home Services'], ['pressure wash', 'Home Services'], ['home service', 'Home Services'],
    ['salon', 'Health & Beauty'], ['beauty', 'Health & Beauty'], ['hair', 'Health & Beauty'],
    ['spa', 'Health & Beauty'], ['barber', 'Health & Beauty'], ['fitness', 'Health & Beauty'],
    ['gym', 'Health & Beauty'],
    ['music', 'Music'], ['artist', 'Music'], ['band', 'Music'], ['dj', 'Music'],
    ['retail', 'Retail'], ['shop', 'Retail'], ['boutique', 'Retail'], ['store', 'Retail'],
    ['school', 'Education'], ['tutor', 'Education'], ['academy', 'Education'], ['educat', 'Education'],
    ['golf', 'Recreation'], ['recreation', 'Recreation'], ['venue', 'Recreation'], ['tour', 'Recreation']
  ];

  /* Industries we know come up on calls and have NO demos behind them.
     Naming them is the point — "no page" with a reason beats a rep
     hunting for a button that was never going to be there. */
  var KNOWN_GAPS = ['Food & Bev', 'Legal', 'Healthcare', 'Insurance', 'Finance',
                    'Bookkeeping', 'Moving', 'Junk Removal'];

  function categoryFor(industry) {
    var s = String(industry || '').trim();
    if (!s) return '';
    if (PAGES[s]) return s;                       // already a website category
    /* Punctuation to spaces so 'Electrical / Fire Alarm' and 'Pest control'
       both present their words plainly, then each alias is looked for at
       the start of a word rather than anywhere at all. */
    var low = ' ' + s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    for (var i = 0; i < ALIASES.length; i++) {
      var a = ALIASES[i][0];
      /* The longer aliases are stems on purpose - 'landscap' has to catch
         Landscaping and Landscaper both - so they match the start of a
         word. A very short one cannot be trusted that far: 'spa' is the
         first three letters of spacious, and 'dog' and 'dj' are whole
         words in every industry that means them. So three letters or
         fewer must match a whole word. */
      var hit = a.length <= 3
        ? low.indexOf(' ' + a + ' ') > -1
        : low.indexOf(' ' + a) > -1;
      if (hit && PAGES[ALIASES[i][1]]) return ALIASES[i][1];
    }
    return '';
  }

  /* The page is identical for every prospect in an industry, so the ?r=
     token is the only thing that can attribute an open back to a lead.
     It carries no name and nothing on the page reads it — it exists
     purely so the view beacon can say which lead it was. */
  function linkFor(lead) {
    var cat = categoryFor(lead && lead.industry);
    if (!cat) return '';
    return SITE + PAGES[cat] + '?r=' + encodeURIComponent(lead.id);
  }

  function copy(text, okMsg) {
    var U = root.UI;
    function done() { if (U && U.toast) U.toast(okMsg, 'ok'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this link:', text); });
    } else {
      window.prompt('Copy this link:', text);
    }
  }

  /* ── the card ────────────────────────────────────────────────────
     Sits beside the Mockup card but is deliberately separate: a mockup
     is built for THIS business, the pitch link is the industry
     portfolio anyone in that trade gets. Conflating them is how a rep
     ends up telling a prospect "we made this for you" about a page that
     has nine other companies on it. */
  function panel(lead) {
    var S = root.Store, U = root.UI;
    var cat = categoryFor(lead.industry);
    var industry = lead.industry || '';
    var body;

    if (cat) {
      var viewsReady = S.columnReady && S.columnReady('leads', 'pitchViews');
      var views = Number(lead.pitchViews || 0);

      body =
        '<div class="split" style="margin-bottom:10px">' +
          U.badge(cat, 'b-grey') +
          (industry && industry !== cat
            ? '<span class="muted" style="font-size:11.5px">from “' + U.esc(industry) + '”</span>'
            : '') +
        '</div>' +
        '<div class="muted" style="font-size:12.5px;margin-bottom:10px">' +
          'A private page of ' + U.esc(cat.toLowerCase()) + ' concepts. Not indexed and linked from ' +
          'nowhere — but anyone it is forwarded to can open it.' +
        '</div>' +
        (viewsReady
          ? '<div class="muted" style="font-size:11.5px;margin-bottom:10px">' +
              (views
                ? '<strong>' + views + '</strong> view' + (views === 1 ? '' : 's') +
                  (lead.pitchViewedAt ? ' · last ' + U.fmtDateShort(lead.pitchViewedAt) : '')
                : 'Not opened yet.') +
            '</div>'
          : '') +
        '<button class="btn btn-primary btn-sm" data-pitch-copy="' + U.esc(lead.id) + '" ' +
          'style="width:100%">Copy pitch link</button>' +
        '<a class="btn btn-ghost btn-sm" href="' + U.esc(SITE + PAGES[cat]) + '" target="_blank" ' +
          'rel="noopener" style="width:100%;margin-top:8px">Preview it ↗</a>';
    } else {
      var known = industry && KNOWN_GAPS.some(function (g) { return g.toLowerCase() === industry.toLowerCase(); });
      body =
        '<div class="hint" style="margin-bottom:12px">' +
          (!industry
            ? 'This lead has no industry set, so there is nothing to match a page to.'
            : known
              ? 'No page for <strong>' + U.esc(industry) + '</strong> — the portfolio has no demos in that ' +
                'trade yet. Build one and it appears here automatically.'
              : 'No page matches <strong>' + U.esc(industry) + '</strong>.') +
        '</div>' +
        '<div class="muted" style="font-size:12px;margin-bottom:8px">Send a different industry instead:</div>' +
        '<select class="input" data-pitch-pick="' + U.esc(lead.id) + '">' +
          '<option value="">Choose…</option>' +
          Object.keys(PAGES).sort().map(function (c) {
            return '<option value="' + U.esc(c) + '">' + U.esc(c) + '</option>';
          }).join('') +
        '</select>';
    }

    return '<div class="card"><div class="card-head"><span class="card-title">Pitch Link</span>' +
      (cat ? '' : U.badge('No page', 'b-grey')) + '</div>' +
      '<div class="card-body">' + body + '</div></div>';
  }

  /* Delegated so the record view does not have to bind anything after
     each render — it only has to include panel(lead) in its markup. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-pitch-copy]');
    if (!btn) return;
    var lead = root.Store.find('leads', btn.getAttribute('data-pitch-copy'));
    if (!lead) return;
    var url = linkFor(lead);
    if (!url) return;
    copy(url, 'Pitch link copied — ' + categoryFor(lead.industry) + '.');
  });

  document.addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('[data-pitch-pick]');
    if (!sel || !sel.value) return;
    var lead = root.Store.find('leads', sel.getAttribute('data-pitch-pick'));
    if (!lead || !PAGES[sel.value]) return;
    copy(SITE + PAGES[sel.value] + '?r=' + encodeURIComponent(lead.id),
      'Pitch link copied — ' + sel.value + '.');
    sel.value = '';
  });

  root.Pitch = {
    panel: panel,
    linkFor: linkFor,
    categoryFor: categoryFor,
    pages: function () { return PAGES; },
    /* Which industries in the current data have no page — the report
       that tells you what to build next. */
    gaps: function () {
      var counts = {};
      root.Store.db().leads.forEach(function (l) {
        if (categoryFor(l.industry)) return;
        var k = l.industry || '(no industry set)';
        counts[k] = (counts[k] || 0) + 1;
      });
      return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })
        .map(function (k) { return { industry: k, leads: counts[k] }; });
    }
  };
})(window);
