/* Boot has to load a whole table, not the first page of one.

   Supabase caps an API response at the project's "Max rows" setting
   (1000 by default) and reports no error when it truncates. A CRM that
   reads select('*') once therefore starts silently losing records the
   moment a table crosses the cap — and the Admin backup, which
   serialises whatever boot loaded, would be short by exactly the rows
   you would most want back.

   These stubs enforce a cap the way the real server does, so a
   regression here fails instead of hiding. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const LEADS = 2431;              // comfortably past any sane cap
const bigLeads = Array.from({ length: LEADS }, (_, i) => ({
  id: 'l_' + i, name: 'Realtor ' + i, leadStatus: 'working', rating: 'warm',
  ownerId: 'u', estValue: 0, nextFollowUp: '', lastContactedAt: '', tags: [],
  convertedCustomerId: '', convertedAt: ''
}));

const base = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [], statuses: [], vendor_types: [],
  settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};

/* A server that refuses to return more than `cap` rows per request and
   says nothing about it — which is precisely the failure being guarded. */
function makeClient(cap, rows, log) {
  const thenable = v => ({ then: r => Promise.resolve(r(v)) });
  return {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
    from: t => {
      const all = rows[t] || [];
      const q = {
        _from: 0, _to: null,
        range(a, b) { this._from = a; this._to = b; return this; },
        limit(n) { this._from = 0; this._to = n - 1; return this; },
        select() { return this; },
        then(res) {
          const to = this._to === null ? all.length - 1 : this._to;
          const want = all.slice(this._from, to + 1);
          if (log) log.push({ table: t, from: this._from, asked: want.length });
          return Promise.resolve(res({ data: want.slice(0, cap), error: null }));
        },
        upsert: () => thenable({ error: null }),
        insert: () => thenable({ error: null }),
        delete: () => ({ eq: () => thenable({ error: null }),
                 in: () => thenable({ error: null }),
                 neq: () => thenable({ error: null }) })
      };
      return q;
    },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
  };
}

async function boot(cap, log) {
  const rows = Object.assign({}, base, { leads: bigLeads });
  const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
    supabase: { createClient: () => makeClient(cap, rows, log) }, console };
  global.localStorage = win.localStorage;
  new Function('window', read('backend.js'))(win);
  new Function('window', read('store.js'))(win);
  await win.Store.boot();
  return win.Store;
}

(async () => {
  console.log('\n-- the default 1000-row cap');
  let log = [];
  let S = await boot(1000, log);
  ok('every lead arrived, not just the first page',
     S.all('leads').length === LEADS, S.all('leads').length + ' of ' + LEADS);
  ok('it took more than one request',
     log.filter(r => r.table === 'leads').length > 1,
     log.filter(r => r.table === 'leads').length);
  ok('the last lead is present', !!S.find('leads', 'l_' + (LEADS - 1)));
  ok('no lead is duplicated',
     new Set(S.all('leads').map(l => l.id)).size === LEADS,
     new Set(S.all('leads').map(l => l.id)).size);
  ok('order is preserved', S.all('leads')[0].id === 'l_0' &&
     S.all('leads')[LEADS - 1].id === 'l_' + (LEADS - 1));

  console.log('\n-- a project with the cap lowered to 500');
  /* A short page must not be mistaken for the end of the table: at a cap
     of 500 every page is short, so only an empty page ends the read. */
  S = await boot(500);
  ok('still loads all of them', S.all('leads').length === LEADS, S.all('leads').length);

  console.log('\n-- an unusually low cap');
  S = await boot(97);
  ok('still loads all of them', S.all('leads').length === LEADS, S.all('leads').length);

  console.log('\n-- a table smaller than one page');
  S = await boot(1000);
  ok('small tables still load', S.all('users').length === 1, S.all('users').length);
  ok('empty tables stay empty', S.all('vendors').length === 0, S.all('vendors').length);

  console.log('\n-- the backup would carry the whole thing');
  const dump = JSON.parse(S.exportJSON());
  ok('the export holds every lead', dump.leads.length === LEADS, dump.leads.length);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
