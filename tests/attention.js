/* What counts as needing attention.

   "Follow Up Now" means a commitment you made and have not kept: overdue,
   or due today. A lead nobody has scheduled is not that. It used to count,
   which was fair when leads arrived one at a time and a missing date really
   was an oversight — and became wrong the moment 2,526 were imported on
   purpose with no dates, because then every lead in the database is in
   today's work and the number says nothing.

   The risk in narrowing it is hiding real work, so the cases that must
   still show up are checked here alongside the ones that must not. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true },
             { id: 'u2', name: 'Sam', role: 'rep', active: true }],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [], activity: [],
  outreach: [], outreach_groups: [], statuses: [], vendor_types: [],
  settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
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

const mk = (name, due, extra) => S.insert('leads', Object.assign({
  name, leadStatus: 'working', rating: 'warm', ownerId: 'u', estValue: 0,
  nextFollowUp: due, lastContactedAt: '', tags: [],
  convertedCustomerId: '', convertedAt: ''
}, extra || {}), 'l', name);

(async () => {
  await S.boot();

  const late = mk('Late Co', S.shift(-19));      // the Aug 20 batch, in effect
  const today = mk('Today Co', S.today());
  const soon = mk('Soon Co', S.shift(3));
  const later = mk('Later Co', S.shift(40));
  const none = mk('Unscheduled Co', '');
  const dead = mk('Dead Co', S.shift(-30), { leadStatus: 'dead' });
  const conv = mk('Converted Co', S.shift(-30), { leadStatus: 'converted' });

  console.log('\n-- what belongs in the queue');
  const ids = S.leadsNeedingAttention().map(l => l.id);
  ok('an overdue lead is in it', ids.indexOf(late.id) > -1);
  ok('a lead due today is in it', ids.indexOf(today.id) > -1);
  ok('a lead due this week is not', ids.indexOf(soon.id) < 0);
  ok('a lead due later is not', ids.indexOf(later.id) < 0);
  ok('an unscheduled lead is NOT', ids.indexOf(none.id) < 0);
  ok('a dead lead is not, however overdue', ids.indexOf(dead.id) < 0);
  ok('a converted lead is not either', ids.indexOf(conv.id) < 0);
  ok('so the queue holds exactly two', ids.length === 2, ids.length);
  ok('overdue sorts above due today', ids[0] === late.id);

  console.log('\n-- the KPI agrees with the queue');
  ok('leadStats.attention matches', S.leadStats().attention === 2, S.leadStats().attention);

  console.log('\n-- an unscheduled lead is still visible, just not urgent');
  ok('it still reads as unscheduled',
     S.followUpState(S.find('leads', none.id)).key === 'unscheduled');
  ok('and still carries its own badge',
     S.followUpState(S.find('leads', none.id)).label === 'No follow-up set',
     S.followUpState(S.find('leads', none.id)).label);

  console.log('\n-- an import of undated leads no longer drowns the queue');
  const bulk = [];
  for (let i = 0; i < 2526; i++) {
    bulk.push({ name: 'Realtor ' + i, leadStatus: 'new', rating: 'cold', ownerId: 'u',
      estValue: 0, nextFollowUp: '', lastContactedAt: '', tags: ['realtor'],
      source: 'Realtor List', convertedCustomerId: '', convertedAt: '' });
  }
  S.insertMany('leads', bulk, 'l', 'realtors');
  ok('2,526 undated leads are in the database', S.all('leads').length === 2533, S.all('leads').length);
  ok('and the queue is still just the two',
     S.leadsNeedingAttention().length === 2, S.leadsNeedingAttention().length);
  ok('the KPI is still two', S.leadStats().attention === 2, S.leadStats().attention);

  console.log('\n-- clearing a stamped date takes it out of the queue for good');
  /* The whole point: a batch imported with one date, all now overdue,
     should leave the queue when the date is cleared - not come back as
     "unscheduled", which is what used to happen. */
  const stamped = [];
  for (let i = 0; i < 47; i++) stamped.push(mk('Aug20 ' + i, S.shift(-19)));
  ok('the stamped batch is in the queue',
     S.leadsNeedingAttention().length === 49, S.leadsNeedingAttention().length);
  S.updateMany('leads', stamped.map(l => l.id), { nextFollowUp: '' }, 'cleared');
  ok('clearing the dates removes them', S.leadsNeedingAttention().length === 2,
     S.leadsNeedingAttention().length);
  ok('they are still open leads, not hidden',
     stamped.every(l => S.isLeadOpen(S.find('leads', l.id))));

  console.log('\n-- per-owner still works');
  ok('another owner sees none of them',
     S.leadsNeedingAttention('u2').length === 0, S.leadsNeedingAttention('u2').length);
  ok('the owner sees both', S.leadsNeedingAttention('u').length === 2);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
