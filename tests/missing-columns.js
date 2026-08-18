/* A column the database has not got yet must cost you that one field —
   never the whole record. This is the bug where a mockup marked "ready"
   looked saved and was gone on reload, because the same row carried an
   instagram field the database did not have. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

// The live database as it actually was: mockup columns present, socials absent.
const ABSENT = { 'leads.instagram': 1, 'leads.tiktok': 1, 'leads.facebook': 1 };

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [{
    id: 'l1', name: 'Handi Conkrete', leadStatus: 'working', rating: 'warm', ownerId: 'u',
    estValue: 0, nextFollowUp: '', lastContactedAt: '', tags: [],
    mockupStatus: 'none', mockupTypes: [], mockupUrl: '', mockupReadyAt: '', mockupSentAt: '',
    instagram: '', tiktok: '', facebook: '', lostReason: '',
    convertedCustomerId: '', convertedAt: ''
  }],
  customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [], vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};

const writes = [];
const thenable = v => ({ then: (res) => Promise.resolve(res(v)) });

function selectResult(table, cols) {
  const asked = String(cols || '*').split(',').map(c => c.trim()).filter(c => c && c !== '*');
  const bad = asked.find(c => ABSENT[table + '.' + c]);
  if (bad) return { data: null, error: { message: 'column ' + table + '.' + bad + ' does not exist' } };
  return { data: rows[table] || [], error: null };
}

const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({
    select: (cols) => {
      const r = selectResult(t, cols);
      const chain = { limit: () => thenable(r), then: (res) => Promise.resolve(res(r)) };
      return chain;
    },
    upsert: payload => {
      const list = Array.isArray(payload) ? payload : [payload];
      // A real PostgREST rejects the whole row if any key is an unknown column.
      const offending = list.map(p => Object.keys(p).find(k => ABSENT[t + '.' + k])).find(Boolean);
      writes.push({ table: t, keys: Object.keys(list[0]), rejected: !!offending });
      return thenable(offending
        ? { error: { message: 'column ' + t + '.' + offending + ' does not exist' } }
        : { error: null });
    },
    insert: () => thenable({ error: null }),
    delete: () => ({ eq: () => thenable({ error: null }), neq: () => thenable({ error: null }) })
  }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};

const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store, B = win.Backend;

(async () => {
  await S.boot();

  console.log('\n-- the missing columns are found at boot');
  const mc = S.missingColumns();
  ok('leads flagged', !!mc.leads, JSON.stringify(mc));
  ok('all three named', (mc.leads || []).sort().join(',') === 'facebook,instagram,tiktok',
     (mc.leads || []).join(','));
  ok('columns that DO exist are not flagged',
     (mc.leads || []).indexOf('mockupStatus') < 0);
  ok('tables with nothing missing are absent from the map', !mc.customers);

  console.log('\n-- the app still booted');
  ok('leads loaded', S.all('leads').length === 1);
  ok('no missing TABLES', S.missingTables().length === 0);

  console.log('\n-- a mockup save must survive the missing social columns');
  writes.length = 0;
  S.setMockup('l1', { mockupStatus: 'ready', mockupUrl: 'figma.com/handi', mockupTypes: ['Website'] });
  await new Promise(r => setTimeout(r, 10));

  const w = writes.filter(x => x.table === 'leads')[0];
  ok('a write was attempted', !!w);
  ok('THE WRITE WAS ACCEPTED', w && w.rejected === false,
     w ? 'rejected=' + w.rejected : 'no write');
  ok('the missing columns were stripped out',
     w && !w.keys.some(k => ['instagram', 'tiktok', 'facebook'].indexOf(k) > -1),
     w ? w.keys.join(',') : '');
  ok('the mockup fields were still sent',
     w && w.keys.indexOf('mockupStatus') > -1 && w.keys.indexOf('mockupUrl') > -1);
  ok('and unrelated fields too', w && w.keys.indexOf('name') > -1);

  console.log('\n-- the value is in the cache as well');
  const l = S.find('leads', 'l1');
  ok('status set', l.mockupStatus === 'ready');
  ok('link set', l.mockupUrl === 'figma.com/handi');
  ok('ready date stamped', !!l.mockupReadyAt);
  ok('it shows in the ready-to-send queue', S.mockupsReadyToSend().length === 1);

  console.log('\n-- without the fix the whole row would have failed');
  // Same payload, but with the socials left in, is what used to be sent.
  const withSocials = Object.assign({}, l);
  const before = writes.length;
  client.from('leads').upsert(withSocials);
  await new Promise(r => setTimeout(r, 10));
  ok('proving the rejection is real', writes[writes.length - 1].rejected === true);
  ok('(and that is what used to eat the mockup)', writes.length === before + 1);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
