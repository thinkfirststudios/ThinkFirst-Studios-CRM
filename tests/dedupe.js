/* Import dedupe. A shared platform is not an identity: half these leads
   list "facebook.com/theirpage" as their website, and treating the bare
   domain as the key made every one of them the same lead. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [], vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const chain = v => ({ limit: () => thenable(v), then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => chain({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }), neq: () => thenable({ error: null }) }) }),
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
  const k = S.leadKey;

  console.log('\n-- the bug: two facebook pages are not the same business');
  const a = k({ name: 'Casillas Pool', website: 'facebook.com/casillaspools' });
  const b = k({ name: 'Blonde Boujee', website: 'facebook.com/blondeboujee' });
  ok('different keys', a !== b, a + ' vs ' + b);
  ok('the path is the identity', a === 's:facebook.com/casillaspools', a);
  ok('a bare platform domain is never the key', a.indexOf('d:facebook.com') < 0);

  console.log('\n-- same for the other platforms people use as a website');
  ['instagram.com', 'linktr.ee', 'yelp.com', 'wixsite.com', 'business.site'].forEach(h => {
    const x = k({ name: 'One', website: h + '/one' });
    const y = k({ name: 'Two', website: h + '/two' });
    ok(h + ' distinguishes two businesses', x !== y, x + ' vs ' + y);
  });

  console.log('\n-- a real domain is still the key');
  ok('own domain', k({ name: 'Chef', website: 'chef-mathias.com' }) === 'd:chef-mathias.com');
  ok('with https and www', k({ name: 'Chef', website: 'https://www.chef-mathias.com/' }) === 'd:chef-mathias.com');
  ok('a path on an own domain does not change identity',
     k({ name: 'Chef', website: 'chef-mathias.com/about' }) === 'd:chef-mathias.com');

  console.log('\n-- a social handle identifies a business with no website');
  ok('instagram handle used', k({ name: 'Gleam', instagram: 'hollywoodgleam' }) === 's:instagram/hollywoodgleam');
  ok('same handle pasted as a url matches',
     k({ name: 'Gleam', instagram: 'https://www.instagram.com/hollywoodgleam/' }) === 's:instagram/hollywoodgleam');
  ok('two different handles do not collide',
     k({ name: 'A', instagram: 'aaa' }) !== k({ name: 'B', instagram: 'bbb' }));
  ok('email still wins over everything',
     k({ name: 'X', email: 'a@b.com', instagram: 'zzz' }) === 'e:a@b.com');

  console.log('\n-- falling through to the name');
  ok('no contact details at all', k({ name: 'Studio ABM Builders' }) === 'n:studioabmbuilders');
  ok('a platform url with no path is not identity',
     k({ name: 'Studio ABM', website: 'facebook.com' }) === 'n:studioabm');
  ok('punctuation ignored',
     k({ name: "Guero's Auto Repair" }) === k({ name: 'gueros auto repair' }));

  console.log('\n-- the real batch: all ten must survive an import together');
  const batch = [
    { name: 'Studio ABM Builders' },
    { name: 'Chef Mathias', website: 'chef-mathias.com' },
    { name: 'Hollywood Gleam Co.', instagram: 'hollywoodgleam' },
    { name: 'Christina Fetterolf Adaptive', email: 'CFADAPTIVE@GMAIL.COM' },
    { name: 'Maravilla Tree Service', email: 'Maravillalandscape@gmail.com' },
    { name: 'Casillas Pool Remodeling', instagram: 'casillaspools', facebook: 'casillaspools' },
    { name: 'Handi Conkrete & Construction LLC', instagram: 'handi_conkretellc' },
    { name: 'Kitchen Remodeler Ithaca' },
    { name: 'Blonde Boujee Cleaning' },
    { name: 'Carlson Gracie Anaheim', website: 'carlsongraciebjj.club', instagram: 'carlsonanaheim' }
  ];
  const keys = batch.map(k);
  ok('ten distinct keys', new Set(keys).size === 10, new Set(keys).size + ' of 10: ' + keys.join(' '));

  console.log('\n-- and re-importing the same batch skips all ten');
  S.insertMany('leads', batch.map(x => Object.assign({ leadStatus: 'new', tags: [] }, x)), 'l', 'batch');
  const known = S.knownKeys();
  ok('every one is now recognised', batch.every(x => !!known[k(x)]));
  ok('a genuinely new one is not', !known[k({ name: 'Brand New Co' })]);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
