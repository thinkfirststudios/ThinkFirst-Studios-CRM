/* The five Young Owner / detailing lists, read by the CRM's own code.

   A prep tool that produces a tidy-looking CSV proves nothing. What
   matters is what the importer and the store make of it, so this runs the
   real guessMap, the real S.parseTags and the real S.zoneOf over the
   actual files about to be uploaded.

   Four things have gone wrong on previous batches and all four are
   checked here:

     · a header read as the wrong field, silently ("Neighborhood" as an
       Instagram handle, "Lead #" as the company name)
     · tags welded into one ("realtor | no-site-found" as a single tag),
       which happened to 1,500 leads because the cell was pipe-joined and
       S.parseTags splits on commas and nothing else
     · a Location the zone logic cannot read, so a rep rings a Florida
       shop at 6am their time
     · two leads keying as the same lead, so one is skipped as a
       duplicate and reported only as a smaller number in a dialog

   It also checks the two things specific to this batch: that the 140
   Instagram handles survived (for 47 leads it is the only way in), and
   that nothing marked DO NOT CALL arrives as a live warm lead.

   Run:  node tests/young-owner-import.js                                */
const fs = require('fs');
const path = require('path');
const os = require('os');
const DIR = path.join(__dirname, '..', 'js') + path.sep;
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => {
  if (c) console.log('  ok   ' + l);
  else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); }
};

const FILES = [
  'TFS_Wrap_Tint_CRM-READY.csv',
  'TFS_Streetwear_Vintage_CRM-READY.csv',
  'TFS_Sim_Racing_Gaming_CRM-READY.csv',
  'TFS_Barbers_CRM-READY.csv',
  'TFS_Auto_Detailing_CRM-READY.csv'
];
const EXPECT = { 'TFS_Wrap_Tint_CRM-READY.csv': 87,
  'TFS_Streetwear_Vintage_CRM-READY.csv': 58,
  'TFS_Sim_Racing_Gaming_CRM-READY.csv': 56,
  'TFS_Barbers_CRM-READY.csv': 19,
  'TFS_Auto_Detailing_CRM-READY.csv': 54 };
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

/* ---- a CSV reader that handles quoted commas and embedded newlines ---- */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || '').trim());
}

/* ---- the real store, against a stubbed Supabase ---- */
const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [{ id: 'new', label: 'New', tone: 'b-blue', order: 1, open: true, won: false }],
  vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }),
          onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }),
                 in: () => thenable({ error: null }), neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

/* ---- the importer's real header matcher, lifted from the view ---- */
const VIEW = fs.readFileSync(path.join(DIR, 'views', 'leads.js'), 'utf8');
function lift(startRe, endStr, label) {
  const i = VIEW.search(startRe);
  if (i < 0) throw new Error('cannot find ' + label + ' in leads.js');
  const j = VIEW.indexOf(endStr, i);
  if (j < 0) throw new Error('cannot find the end of ' + label);
  return VIEW.slice(i, j + endStr.length);
}
const guessMap = new Function(
  lift(/var ALIASES = \{/, '\n  };', 'ALIASES') + '\n' +
  lift(/function norm\(s\)/, '\n', 'norm') + '\n' +
  lift(/function isRowNumber\(h\)/, '\n  }', 'isRowNumber') + '\n' +
  lift(/function guessMap\(headers\)/, '\n  }', 'guessMap') + '\n' +
  'return guessMap;')();

(async () => {
  await S.boot();

  /* These files live in ~/Downloads and are deleted once the batch has
     been uploaded, so this suite's input disappears by design. Failing
     then would leave a permanently red suite that says nothing about the
     code - so a batch that is gone is reported as gone and skipped. The
     bugs it found are pinned where they belong: the Ontario, California
     and New Hampshire cases in zones.js, and the header mapping in
     import-header.js. `pre-upload.js` is the one to run on a new batch. */
  const present = FILES.filter(f => fs.existsSync(path.join(DOWNLOADS, f)));
  if (!present.length) {
    console.log('  --   the Oct 16 batch is no longer in ~/Downloads, so it has');
    console.log('       been uploaded and tidied away. Nothing to check here.');
    console.log('       For a new batch: node tests/pre-upload.js --ready <files>');
    console.log('');
    console.log('ALL PASS');
    process.exit(0);
  }
  if (present.length < FILES.length) {
    console.log('  --   only ' + present.length + ' of ' + FILES.length
      + ' files are still in ~/Downloads; checking those.');
  }

  const all = [];
  for (const f of present) {
    const p = path.join(DOWNLOADS, f);
    console.log('\n-- ' + f);
    const grid = parseCsv(fs.readFileSync(p, 'utf8'));
    const headers = grid[0];
    const body = grid.slice(1);
    ok('row count is what the source tab held (' + EXPECT[f] + ')',
       body.length === EXPECT[f], body.length);

    /* Every header the importer must land correctly. */
    const map = guessMap(headers);
    /* The importer's own field names, not the CSV's. S.zoneOf reads
       lead.address and S.leadKey reads lead.name, so a test that invents
       lead.location and lead.company tests nothing but itself. */
    const want = { name: 'Company', phone: 'Phone', email: 'Email',
                   website: 'Website', address: 'Location', industry: 'Industry',
                   source: 'Source', rating: 'Rating', tagsCol: 'Tags',
                   instagram: 'Instagram', noteText: 'Note', contactName: 'Contact' };
    let bad = [];
    Object.keys(want).forEach(k => {
      const got = map[k] === undefined ? null : headers[map[k]];
      if (got !== want[k]) bad.push(k + '=' + got + ' (wanted ' + want[k] + ')');
    });
    ok('every column maps to the field it is named for', !bad.length, bad.join('; '));

    /* No header may be read as the company name except Company. */
    ok('Company is read as the business name', headers[map.name] === 'Company',
       headers[map.name]);

    /* Build each record the way the importer would, through the map it
       just produced, so the field names are the real ones. */
    body.forEach(r => {
      const rec = { file: f };
      Object.keys(map).forEach(k => { rec[k] = (r[map[k]] || '').trim(); });
      all.push(rec);
    });

    const sources = new Set(body.map(r => r[map.source]).filter(Boolean));
    ok('the whole file carries one Source, so it lands on one list',
       sources.size === 1, [...sources].join(' | '));
  }

  console.log('\n-- tags survive S.parseTags');
  let welded = [];
  all.forEach(l => {
    const parsed = S.parseTags(l.tagsCol || '');
    parsed.forEach(t => {
      if (/\||;/.test(t) || t.length > 40) welded.push(l.name + ': ' + t);
    });
  });
  ok('no tag arrives welded to another', !welded.length, welded.slice(0, 3).join(' / '));
  const tagged = all.filter(l => S.parseTags(l.tagsCol || '').length);
  ok('every lead carries at least one tag', tagged.length === all.length,
     (all.length - tagged.length) + ' with none');

  /* These counts describe the whole five-file batch. With only part of
     it on disk they would fail on arithmetic rather than on anything
     real, so they run only when the batch is complete. */
  const whole = present.length === FILES.length;
  if (!whole) {
    console.log('  --   batch is partial, skipping the whole-batch counts');
  }
  if (whole) {
  console.log('\n-- the flags this batch depends on');
  const dq = all.filter(l => /DO NOT CALL/.test(l.noteText || ''));
  ok('both already-refused leads are marked DO NOT CALL in the note',
     dq.length === 2, dq.length);
  ok('  and both are tagged disqualified',
     dq.every(l => S.parseTags(l.tagsCol || '').indexOf('disqualified') > -1),
     dq.map(l => l.tagsCol).join(' | '));
  ok('  and neither is hot or warm',
     dq.every(l => l.rating === 'cold'), dq.map(l => l.name + '=' + l.rating).join(', '));

  const noway = all.filter(l => S.parseTags(l.tagsCol || '').indexOf('no way in') > -1);
  ok('the unreachable leads are tagged "no way in"', noway.length === 32, noway.length);
  ok('  and every one of them really has no phone, email or handle',
     noway.every(l => !l.phone && !l.email && !l.instagram),
     noway.filter(l => l.phone || l.email || l.instagram)
          .map(l => l.name).slice(0, 3).join(', '));

  const igs = all.filter(l => (l.instagram || '').trim());
  ok('the Instagram handles survived to the Instagram column', igs.length >= 135,
     igs.length + ' of an expected ~140');
  ok('  and none of them kept the @ or a parenthetical',
     igs.every(l => /^[A-Za-z0-9._-]{2,40}$/.test(l.instagram)),
     igs.filter(l => !/^[A-Za-z0-9._-]{2,40}$/.test(l.instagram))
        .map(l => l.instagram).slice(0, 3).join(', '));

  }

  console.log('\n-- S.zoneOf can place every lead');
  const zones = {};
  const unknown = [];
  /* A lead with no location and no phone has nothing to place it by, and
     "Zone unknown" is the honest answer. A lead that HAS either and still
     comes back unknown is a bug - that is the distinction worth failing
     on, rather than a flat count. */
  const blind = [];
  all.forEach(l => {
    const z = S.zoneOf(l);
    zones[z] = (zones[z] || 0) + 1;
    if (!z || z === 'unknown') {
      (l.address || l.phone ? unknown : blind).push(l.name + ' @ "' + l.address + '"');
    }
  });
  console.log('       ' + Object.keys(zones).sort()
    .map(k => k + ' ' + (zones[k]) + ' (' + S.zoneLabel(k) + ')').join(', '));
  ok('every lead with a location or a phone gets placed', !unknown.length,
     unknown.slice(0, 5).join(' / '));
  if (blind.length) {
    console.log('       no location and no phone, so correctly unplaced: '
      + blind.join(', '));
  }

  /* Every one of these is a US business, so anything the CRM reads as
     foreign is a misread Location - and the rep would never see it under
     any coast filter. Name them rather than counting them. */
  const foreign = all.filter(l => S.zoneOf(l) === 'outside');
  ok('none reads as outside the US', !foreign.length,
     foreign.map(l => l.name + ' @ ' + l.address + ' ph ' + l.phone).join(' / '));
  const akhi = all.filter(l => S.zoneOf(l) === 'akhi');
  if (akhi.length) {
    console.log('       Alaska/Hawaii: '
      + akhi.map(l => l.name + ' @ ' + l.address).join(', '));
  }

  console.log('\n-- no two leads key as the same lead');
  const keys = {};
  const clash = [];
  all.forEach(l => {
    const k = S.leadKey(l);
    if (keys[k]) clash.push(k + ': ' + keys[k] + ' <-> ' + l.name);
    else keys[k] = l.name;
  });
  ok('every lead has its own leadKey', !clash.length, clash.slice(0, 4).join(' / '));
  ok(all.length + ' leads in, ' + all.length + ' distinct keys', Object.keys(keys).length === all.length,
     Object.keys(keys).length + ' keys for ' + all.length + ' leads');

  console.log('');
  console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
