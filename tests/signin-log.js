/* Sign-ins appearing in the activity log.

   The awkward part is timing: signing in happens before the store boots, so
   there is no database to write to and the page reloads immediately after.
   The sign-in screen leaves a mark on the tab and the entry is written on
   the way back up.

   The thing that would make this feature worse than useless is recording
   sign-ins nobody performed — every reload, every second tab, every
   restored session — so most of what follows checks it stays quiet. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [{ id: 'u', name: 'Alex Herrman', role: 'admin', active: true }],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [], activity: [],
  outreach: [], outreach_groups: [], statuses: [], vendor_types: [],
  settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const writes = [];
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: b => { writes.push({ table: t, row: [].concat(b)[0] }); return thenable({ error: null }); },
                insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }),
                                 in: () => thenable({ error: null }),
                                 neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};

/* A tab. sessionStorage is per-tab, which is exactly the scoping the
   feature relies on, so the fake has to behave that way too. */
function makeTab(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _raw: store
  };
}

async function bootWith(tab) {
  const win = {
    localStorage: makeTab(),
    sessionStorage: tab,
    CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
    supabase: { createClient: () => client }, console
  };
  global.localStorage = win.localStorage;
  global.sessionStorage = tab;
  new Function('window', read('backend.js'))(win);
  new Function('window', read('store.js'))(win);
  await win.Store.boot();
  return win.Store;
}

const signIns = S => S.all('activity').filter(a => /signed in|created their account/.test(a.action));

(async () => {
  console.log('\n-- a tab that just signed in');
  let tab = makeTab({ 'crm:signedIn': 'in' });
  let S = await bootWith(tab);
  let entries = signIns(S);
  ok('one entry was written', entries.length === 1, entries.length);
  ok('it reads "signed in"', entries[0] && entries[0].action === 'signed in',
     entries[0] && entries[0].action);
  ok('it is attributed to the person', entries[0] && entries[0].userId === 'u',
     entries[0] && entries[0].userId);
  ok('the name renders from that', S.user(entries[0].userId).name === 'Alex Herrman',
     S.user(entries[0].userId).name);
  ok('it carries a timestamp', !!(entries[0] && entries[0].ts));
  ok('and the mark is cleared so a reload does not repeat it',
     tab.getItem('crm:signedIn') === null, tab.getItem('crm:signedIn'));

  console.log('\n-- reloading that same tab');
  /* The mark is gone, so booting again on the same tab must stay quiet. */
  const S2 = await bootWith(tab);
  ok('records nothing further', signIns(S2).length === 0, signIns(S2).length);

  console.log('\n-- a tab that never signed in');
  const S3 = await bootWith(makeTab());
  ok('records nothing', signIns(S3).length === 0, signIns(S3).length);

  console.log('\n-- a second tab opened alongside a signed-in one');
  /* sessionStorage does not travel between tabs, which is the point: only
     the tab where somebody typed a password reports a sign-in. */
  const S4 = await bootWith(makeTab());
  ok('records nothing', signIns(S4).length === 0, signIns(S4).length);

  console.log('\n-- somebody creating their account');
  const S5 = await bootWith(makeTab({ 'crm:signedIn': 'up' }));
  const e5 = signIns(S5);
  ok('is recorded as that, not as a sign-in',
     e5.length === 1 && e5[0].action === 'created their account',
     e5[0] && e5[0].action);

  console.log('\n-- it reaches the database, not just this browser');
  const sent = writes.filter(w => w.table === 'activity' &&
    /signed in|created their account/.test(w.row.action));
  ok('the entry was written out', sent.length > 0, sent.length);

  console.log('\n-- storage being unavailable is survivable');
  /* Private windows throw on sessionStorage rather than returning null.
     Losing the sign-in note is acceptable; failing to boot is not. */
  const hostile = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); }
  };
  let booted = false;
  try { await bootWith(hostile); booted = true; } catch (e) { booted = false; }
  ok('the app still boots', booted);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
