/* Splitting a list between the people who will work it.

   Three reps sharing one undivided list means three people ringing the same
   person. The fix is the owner field every lead already has; what was
   missing was a way to set it on more than one lead at a time.

   The properties worth pinning: everyone gets a fair share, the split is
   dealt rather than sliced into blocks, nobody outside the selection is
   touched, and it stays one write and one activity entry however many
   leads are involved. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [
    { id: 'alex', name: 'Alex Herrman', role: 'admin', active: true },
    { id: 'sam', name: 'Sam Reyes', role: 'rep', active: true },
    { id: 'jo', name: 'Jo Blake', role: 'rep', active: true },
    { id: 'gone', name: 'Former Rep', role: 'rep', active: false }
  ],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [], activity: [],
  outreach: [], outreach_groups: [], statuses: [], vendor_types: [],
  settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const calls = { upserts: [] };
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'alex' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: b => { calls.upserts.push({ table: t, n: [].concat(b).length }); return thenable({ error: null }); },
                insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }),
                                 in: () => thenable({ error: null }),
                                 neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

const leadWrites = () => calls.upserts.filter(c => c.table === 'leads');
const ownerOf = id => S.find('leads', id).ownerId;
const countBy = ids => ids.reduce((m, id) => {
  const o = ownerOf(id); m[o] = (m[o] || 0) + 1; return m;
}, {});

(async () => {
  await S.boot();

  /* A list shaped like the realtor import: ordered by region, so a block
     split would hand out whole regions. */
  const REGIONS = ['East', 'Central', 'Mountain', 'Pacific'];
  const all = [];
  for (let i = 0; i < 2526; i++) {
    all.push(S.insert('leads', {
      name: 'Realtor ' + i, ownerId: 'alex', leadStatus: 'new', rating: 'cold',
      estValue: 0, nextFollowUp: '', lastContactedAt: '', tags: ['realtor'],
      source: 'Realtor List', address: REGIONS[Math.floor(i / 632)] || 'Pacific',
      convertedCustomerId: '', convertedAt: ''
    }, 'l', 'Realtor ' + i));
  }
  const untouched = S.insert('leads', {
    name: 'Not In The Selection', ownerId: 'alex', leadStatus: 'working',
    rating: 'hot', estValue: 0, nextFollowUp: '', lastContactedAt: '', tags: [],
    source: 'Screenshot', convertedCustomerId: '', convertedAt: ''
  }, 'l', 'Not In The Selection');

  const ids = all.map(l => l.id);

  console.log('\n-- splitting 2,526 between three people');
  calls.upserts = [];
  const before = S.all('activity').length;
  const counts = S.assignMany('leads', ids, ['alex', 'sam', 'jo'], '2526 leads assigned');

  ok('everybody got a share', Object.keys(counts).length === 3, Object.keys(counts).join(','));
  const got = countBy(ids);
  ok('alex has 842', got.alex === 842, got.alex);
  ok('sam has 842', got.sam === 842, got.sam);
  ok('jo has 842', got.jo === 842, got.jo);
  ok('and every lead has one of them',
     ids.every(id => ['alex', 'sam', 'jo'].indexOf(ownerOf(id)) > -1));
  ok('the returned counts match what was written',
     counts.alex === got.alex && counts.sam === got.sam && counts.jo === got.jo);

  console.log('\n-- dealt, not sliced into blocks');
  /* The point of dealing: each person ends up with leads from every region
     rather than one person owning the whole of the east. */
  const byRegionFor = who => {
    const seen = {};
    ids.filter(id => ownerOf(id) === who)
       .forEach(id => { const r = S.find('leads', id).address; seen[r] = (seen[r] || 0) + 1; });
    return seen;
  };
  ['alex', 'sam', 'jo'].forEach(who => {
    const spread = byRegionFor(who);
    ok(who + ' has leads in all four regions',
       Object.keys(spread).length === 4, Object.keys(spread).join(','));
  });
  ok('and the first three leads went to three different people',
     ownerOf(ids[0]) !== ownerOf(ids[1]) && ownerOf(ids[1]) !== ownerOf(ids[2]),
     [ownerOf(ids[0]), ownerOf(ids[1]), ownerOf(ids[2])].join(','));

  console.log('\n-- batched writes, one line in the history');
  /* writeMany chunks at 200 deliberately — one enormous request is the
     thing most likely to be rejected — so the check is that every row went
     out in a chunk, not that there was a single request. */
  const sent = leadWrites().reduce((s, c) => s + c.n, 0);
  ok('every row was written', sent === 2526, sent);
  ok('in chunks, not one request per row',
     leadWrites().length === Math.ceil(2526 / 200), leadWrites().length);
  ok('no chunk exceeds the limit',
     leadWrites().every(c => c.n <= 200), Math.max.apply(null, leadWrites().map(c => c.n)));

  /* The activity log is capped at 500 entries, and seeding 2,527 leads has
     already filled it, so counting the delta says nothing. What matters is
     that this produced one entry rather than a run of them. */
  const recent = S.all('activity').slice(0, 5);
  ok('the newest entry is the assignment',
     /2526 leads assigned/.test(recent[0].detail || ''),
     recent[0].action + ': ' + recent[0].detail);
  ok('and there is exactly one of them',
     S.all('activity').filter(e => /2526 leads assigned/.test(e.detail || '')).length === 1,
     S.all('activity').filter(e => /2526 leads assigned/.test(e.detail || '')).length);

  console.log('\n-- nothing outside the selection moved');
  ok('the lead that was not selected kept its owner',
     S.find('leads', untouched.id).ownerId === 'alex');
  ok('and its other fields are untouched',
     S.find('leads', untouched.id).rating === 'hot' &&
     S.find('leads', untouched.id).source === 'Screenshot');

  console.log('\n-- an uneven split gives the remainder to the first few');
  const five = ids.slice(0, 5);
  const c2 = S.assignMany('leads', five, ['sam', 'jo'], 'five');
  ok('sam gets 3, jo gets 2', c2.sam === 3 && c2.jo === 2, JSON.stringify(c2));

  console.log('\n-- assigning everything to one person');
  const c3 = S.assignMany('leads', ids, ['sam'], 'all to sam');
  ok('sam owns all of them', c3.sam === 2526, c3.sam);
  ok('and nobody else owns any',
     ids.every(id => ownerOf(id) === 'sam'));

  console.log('\n-- each person sees only their own follow-ups');
  /* What the split is for: the dashboard already scopes its queue by owner,
     so dealing the list out is what makes those queues mean anything. */
  S.assignMany('leads', ids.slice(0, 60), ['sam', 'jo'], 'sixty');
  S.updateMany('leads', ids.slice(0, 60), { nextFollowUp: S.shift(-1) }, 'overdue');
  const samQ = S.leadsNeedingAttention('sam').length;
  const joQ = S.leadsNeedingAttention('jo').length;
  ok('sam has 30 due', samQ === 30, samQ);
  ok('jo has 30 due', joQ === 30, joQ);
  ok('and alex has none of them', S.leadsNeedingAttention('alex').length === 0,
     S.leadsNeedingAttention('alex').length);

  console.log('\n-- edge cases');
  ok('no ids is a no-op', Object.keys(S.assignMany('leads', [], ['sam'])).length === 0);
  ok('no owners is a no-op', Object.keys(S.assignMany('leads', ids, [])).length === 0);
  ok('unknown ids change nothing',
     Object.keys(S.assignMany('leads', ['nope'], ['sam'])).length === 0);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
