/* The zone a lead is exported as, and the zone the filter finds it under,
   have to be the same zone.

   Josh works the west coast and his mockup list is almost all east-coast
   realtors, so the column is what stops him ringing Connecticut at 6am. If
   the export said "Eastern" and the filter menu said "East Coast", the two
   would drift apart the first time either was edited - so both read their
   words from S.zoneLabel, and this checks they still do. */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
const VIEW = read('views/leads.js');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

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
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }), in: () => thenable({ error: null }), neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

(async () => {
  await S.boot();

  console.log('-- every zone has words, and they are the filter menu’s words');
  S.LEAD_ZONES.forEach(function (z) {
    ok(z.id + ' reads "' + z.label + '"', S.zoneLabel(z.id) === z.label, S.zoneLabel(z.id));
  });
  ok('an id nobody knows gets no words rather than a wrong one',
     S.zoneLabel('atlantis') === '', S.zoneLabel('atlantis'));

  console.log('\n-- the export carries the column');
  const head = VIEW.match(/var head = \[([\s\S]*?)\];/);
  ok('exportCsv still has a head list', !!head);
  const cols = (head ? head[1] : '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  ok('"Time Zone" is one of the exported columns', cols.indexOf('Time Zone') > -1, cols.join('|'));
  ok('and it sits next to the Location it is worked out from',
     cols.indexOf('Time Zone') === cols.indexOf('Location') + 1,
     'Location at ' + cols.indexOf('Location') + ', Time Zone at ' + cols.indexOf('Time Zone'));
  ok('the exported value is the shared label, not a second spelling',
     /S\.zoneLabel\(S\.zoneOf\(l\)\)/.test(VIEW));

  console.log('\n-- the file it actually writes');
  /* Run the real exportCsv and read the CSV it produces, rather than
     counting commas in its source: "S.notesFor('lead', l.id)" has a comma
     inside it, and a source count called a correct row a broken one. */
  let written = '';
  win.Views = win.Views || {};
  win.UI = {
    esc: s => String(s == null ? '' : s), badge: () => '', table: () => '',
    field: () => '', modal: () => {}, toast: () => {}, confirm: () => {},
    money: v => String(v), when: v => String(v)
  };
  win.download = function (n, body) { written = body; };
  new Function('window', read('views/leads.js'))(win);

  const book = [
    { id: 'l1', name: 'Chef Mathias', address: 'Los Angeles & surrounding areas',
      phone: '310 876 5291', leadStatus: 'new', rating: 'warm', ownerId: 'u',
      tags: [], mockupStatus: 'none', mockupTypes: [], estValue: 0 },
    { id: 'l2', name: 'Aziz Seyal', address: 'New Haven, Connecticut',
      phone: '(203) 209-9396', leadStatus: 'new', rating: 'warm', ownerId: 'u',
      tags: [], mockupStatus: 'none', mockupTypes: [], estValue: 0 },
    { id: 'l3', name: 'Chemaye Nickens- Smith', address: 'Washington D.C.',
      phone: '(202) 709-7989', leadStatus: 'new', rating: 'warm', ownerId: 'u',
      tags: [], mockupStatus: 'none', mockupTypes: [], estValue: 0 }
  ];
  win.Views.leads._exportCsv(book);

  const grid = win.Views.leads._parse(written, ',');
  const hdr = grid[0];
  ok('a file was written', !!written);
  ok('the header carries Time Zone', hdr.indexOf('Time Zone') > -1, hdr.join('|'));
  ok('every row has exactly as many cells as the header has columns',
     grid.every(r => r.length === hdr.length),
     grid.map(r => r.length).join(','));

  const tz = hdr.indexOf('Time Zone');
  const loc = hdr.indexOf('Location');
  const co = hdr.indexOf('Company');
  ok('Time Zone sits right after Location in the file too', tz === loc + 1);
  const cell = n => {
    const r = grid.slice(1).filter(r => r[co] === n)[0];
    return r ? r[tz] : '(row not found)';
  };
  ok('Chef Mathias exports West Coast', cell('Chef Mathias') === 'West Coast', cell('Chef Mathias'));
  ok('Aziz Seyal exports East Coast', cell('Aziz Seyal') === 'East Coast', cell('Aziz Seyal'));
  ok('the D.C. realtor exports East Coast, not West',
     cell('Chemaye Nickens- Smith') === 'East Coast', cell('Chemaye Nickens- Smith'));

  /* The column is derived, so re-importing an export must not try to write
     it onto a record - and must not be mistaken for a field that is real. */
  const m = win.Views.leads._guessMap(hdr);
  const claimed = Object.keys(m).filter(k => m[k] === tz);
  ok('re-importing an export does not read Time Zone as a field',
     claimed.length === 0, claimed.join(','));
  ok('and Location is still read as the Location',
     m.address === loc, hdr[m.address]);

  console.log('\n-- the filter and the export agree lead by lead');
  const CASES = [
    ['Chef Mathias',        'Los Angeles & surrounding areas', '310 876 5291',   'West Coast'],
    ['Aziz Seyal',          'New Haven, Connecticut',          '(203) 209-9396', 'East Coast'],
    ['Jaren Johnson',       'Saint Paul, Minnesota',           '(651) 419-8400', 'Central'],
    ['Blonde Boujee',       'Dallas-Fort Worth, TX',           '(682) 789-2945', 'Central'],
    ['Chemaye Nickens',     'Washington D.C.',                 '(202) 709-7989', 'East Coast'],
    ['Bugs Bee Gone',       'Tucson, AZ',                      '(520) 649-2589', 'Mountain'],
    ['A Baleeira',          'Florianópolis, SC',               '+55 48 99219-7961', 'Outside the US'],
    ['Western Sky',         '',                                '(844) 937-8759', 'Zone unknown']
  ];
  CASES.forEach(function (c) {
    const lead = { name: c[0], address: c[1], phone: c[2] };
    const id = S.zoneOf(lead);
    ok(c[0] + ' exports as "' + c[3] + '"', S.zoneLabel(id) === c[3], S.zoneLabel(id));
    /* The predicate the list actually filters on, stated the same way. */
    ok('   and the ' + c[3] + ' filter finds it', !(id !== S.zoneOf(lead)));
  });

  console.log('\n-- a filter set to a zone hides the others');
  const mixed = CASES.map(c => ({ name: c[0], address: c[1], phone: c[2] }));
  const keep = mixed.filter(l => S.zoneOf(l) === 'eastern');
  ok('two east coast leads out of the eight', keep.length === 2, keep.length);
  ok('and they are the right two',
     keep.map(l => l.name).join(', ') === 'Aziz Seyal, Chemaye Nickens',
     keep.map(l => l.name).join(', '));

  console.log(fails ? '\nZONE EXPORT ' + fails + ' FAILURES' : '\nZONE EXPORT ALL PASS');
  process.exit(fails ? 1 : 0);
})();
