/* Any batch of CRM-READY files, read by the CRM's own code before upload.
 *
 *   node tests/pre-upload.js --ready A.csv B.csv --sources sheetA.csv sheetB.csv
 *
 * Paths are taken as given, or looked for in ~/Downloads.
 *
 * `young-owner-import.js` is the Oct 16 batch pinned with its own counts.
 * This is the same checks with nothing batch-specific in them, because
 * every list since has arrived in a different column shape and the
 * failures keep being the same four:
 *
 *   · a header read as the wrong field, silently
 *   · tags welded into one, because S.parseTags splits on commas only
 *   · a Location the zone logic cannot read, so a rep rings at 6am
 *   · two leads keying as the same lead, so one is dropped as a duplicate
 *
 * With --sources it also does the one check the prep tools cannot do for
 * themselves: the researcher wrote a TZ column by hand, so the zone the
 * CRM derives from the Location can be compared against what a human
 * said. Two independent signals disagreeing is the cheapest bug detector
 * available here, and it needs no live data.
 */
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

/* ---- argv ---- */
const argv = process.argv.slice(2);
const bag = { ready: [], sources: [] };
let cur = null;
argv.forEach(a => {
  if (a === '--ready' || a === '--sources') cur = a.slice(2);
  else if (cur) bag[cur].push(a);
});
if (!bag.ready.length) {
  console.log('usage: node tests/pre-upload.js --ready A.csv [B.csv] '
    + '[--sources sheetA.csv ...]');
  process.exit(2);
}
const find = f => {
  for (const p of [f, path.join(os.homedir(), 'Downloads', f)]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

/* ---- CSV with quoted commas and embedded newlines ---- */
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
const asObjects = grid => {
  const h = grid[0];
  return grid.slice(1).map(r => {
    const o = {};
    h.forEach((k, i) => { o[k] = (r[i] || '').trim(); });
    return o;
  });
};

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

const WANT = { name: 'Company', phone: 'Phone', email: 'Email',
               website: 'Website', address: 'Location', industry: 'Industry',
               source: 'Source', rating: 'Rating', tagsCol: 'Tags',
               instagram: 'Instagram', noteText: 'Note', contactName: 'Contact' };

/* The researcher's words for a zone, against the CRM's ids. */
const TZ_TO_ZONE = { pacific: 'pacific', mountain: 'mountain', central: 'central',
                     eastern: 'eastern', alaska: 'akhi', hawaii: 'akhi' };
const normName = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

(async () => {
  await S.boot();

  const all = [];
  for (const f of bag.ready) {
    const p = find(f);
    console.log('\n-- ' + f);
    if (!p) { ok('the file exists', false, f + ' (not in . or ~/Downloads)'); continue; }
    const grid = parseCsv(fs.readFileSync(p, 'utf8'));
    const headers = grid[0];
    const body = grid.slice(1);
    console.log('       ' + body.length + ' rows');

    const map = guessMap(headers);
    const bad = [];
    Object.keys(WANT).forEach(k => {
      const got = map[k] === undefined ? null : headers[map[k]];
      if (got !== WANT[k]) bad.push(k + '=' + got + ' (wanted ' + WANT[k] + ')');
    });
    ok('every column maps to the field it is named for', !bad.length, bad.join('; '));
    ok('Company is read as the business name', headers[map.name] === 'Company',
       headers[map.name]);

    /* Each record built the way the importer would build it. */
    body.forEach(r => {
      const rec = { _file: f };
      Object.keys(map).forEach(k => { rec[k] = (r[map[k]] || '').trim(); });
      all.push(rec);
    });

    const srcs = new Set(body.map(r => (r[map.source] || '').trim()).filter(Boolean));
    ok('the whole file carries one Source, so it lands on one list',
       srcs.size === 1, [...srcs].join(' | '));
    ok('every row has a company name',
       body.every(r => (r[map.name] || '').trim()),
       body.filter(r => !(r[map.name] || '').trim()).length + ' blank');
  }

  console.log('\n-- tags survive S.parseTags');
  const welded = [];
  all.forEach(l => {
    S.parseTags(l.tagsCol || '').forEach(t => {
      if (/\||;/.test(t) || t.length > 40) welded.push(l.name + ': ' + t);
    });
  });
  ok('no tag arrives welded to another or over 40 characters', !welded.length,
     welded.slice(0, 3).join(' / '));
  ok('every lead carries at least one tag',
     all.every(l => S.parseTags(l.tagsCol || '').length),
     all.filter(l => !S.parseTags(l.tagsCol || '').length).length + ' with none');

  console.log('\n-- ratings are ones the CRM can draw');
  const rates = {};
  all.forEach(l => { rates[l.rating || '(blank)'] = (rates[l.rating || '(blank)'] || 0) + 1; });
  console.log('       ' + Object.keys(rates).map(k => k + ' ' + rates[k]).join(', '));
  ok('no rating outside hot/warm/cold/blank',
     all.every(l => ['hot', 'warm', 'cold', ''].indexOf(l.rating) > -1),
     [...new Set(all.map(l => l.rating))].join(','));

  console.log('\n-- S.zoneOf can place every lead');
  const zones = {}, unplaced = [], blind = [];
  all.forEach(l => {
    const z = S.zoneOf(l);
    zones[z] = (zones[z] || 0) + 1;
    if (!z || z === 'unknown') (l.address || l.phone ? unplaced : blind).push(
      l.name + ' @ "' + l.address + '"');
  });
  console.log('       ' + Object.keys(zones).sort()
    .map(k => k + ' ' + zones[k] + ' (' + S.zoneLabel(k) + ')').join(', '));
  ok('every lead with a location or a phone gets placed', !unplaced.length,
     unplaced.slice(0, 5).join(' / '));
  if (blind.length) {
    console.log('       nothing to place them by, so correctly unplaced: '
      + blind.join(', '));
  }
  const foreign = all.filter(l => S.zoneOf(l) === 'outside');
  ok('none reads as outside the US', !foreign.length,
     foreign.map(l => l.name + ' @ ' + l.address + ' ph ' + l.phone).join(' / '));

  console.log('\n-- no two leads key as the same lead');
  const keys = {}, clash = [];
  all.forEach(l => {
    const k = S.leadKey(l);
    if (keys[k]) clash.push(k + ': ' + keys[k] + ' <-> ' + l.name);
    else keys[k] = l.name;
  });
  ok('every lead has its own leadKey', !clash.length, clash.slice(0, 4).join(' / '));
  ok(all.length + ' leads in, ' + all.length + ' distinct keys',
     Object.keys(keys).length === all.length,
     Object.keys(keys).length + ' keys for ' + all.length + ' leads');

  /* ---- the cross-check against what a human wrote ---- */
  if (bag.sources.length) {
    console.log('\n-- the zone the CRM derives vs the TZ the researcher wrote');
    const stated = {};
    let withTz = 0;
    bag.sources.forEach(f => {
      const p = find(f);
      if (!p) { ok('source sheet ' + f + ' exists', false); return; }
      asObjects(parseCsv(fs.readFileSync(p, 'utf8'))).forEach(r => {
        const nm = normName(r.Name || r['Business Name'] || r.Company);
        const tz = (r.TZ || r['Time zone'] || '').trim().toLowerCase();
        if (nm && tz) { stated[nm] = tz; withTz++; }
      });
    });
    console.log('       ' + withTz + ' rows on the source sheets state a TZ');
    const disagree = [], unmatched = [];
    all.forEach(l => {
      const tz = stated[normName(l.name)];
      if (!tz) { unmatched.push(l.name); return; }
      const wantZone = TZ_TO_ZONE[tz];
      if (!wantZone) return;
      const got = S.zoneOf(l);
      if (got !== wantZone) {
        disagree.push(l.name + ' @ "' + l.address + '": sheet says ' + tz
                      + ', CRM says ' + got);
      }
    });
    ok('every lead matched back to its source row', !unmatched.length,
       unmatched.slice(0, 4).join(', '));
    ok('the CRM agrees with the researcher on every time zone', !disagree.length,
       disagree.slice(0, 6).join(' / '));
  }

  console.log('');
  console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
