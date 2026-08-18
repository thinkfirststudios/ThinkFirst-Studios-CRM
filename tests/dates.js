/* Date keys must follow the user's calendar, not UTC. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [], activity: [],
  outreach: [], outreach_groups: [],
  statuses: [], vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
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

  console.log('\n-- the evening off-by-one (this is the reported bug)');
  // 6:30pm local. UTC has already rolled over to the next day at UTC-7.
  const evening = new Date(2026, 7, 17, 18, 30, 0);
  ok('dateKey follows the wall clock', S.dateKey(evening) === '2026-08-17', S.dateKey(evening));
  const utcWay = evening.toISOString().slice(0, 10);
  if (utcWay !== '2026-08-17') {
    ok('and it disagrees with the old UTC method, as it must', S.dateKey(evening) !== utcWay);
  } else {
    console.log('  --   (machine is at/east of UTC; the divergence case cannot be shown here)');
  }

  console.log('\n-- boundaries through a whole local day');
  [[0, 0], [0, 1], [12, 0], [16, 59], [17, 0], [23, 59]].forEach(([h, m]) => {
    const d = new Date(2026, 7, 17, h, m, 0);
    ok('at ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' it is still Aug 17',
       S.dateKey(d) === '2026-08-17', S.dateKey(d));
  });
  ok('one minute past midnight is the next day',
     S.dateKey(new Date(2026, 7, 18, 0, 1, 0)) === '2026-08-18');

  console.log('\n-- today() and shift() agree with each other');
  const t = S.today();
  ok('today() is a local date key', t === S.dateKey(new Date()), t);
  ok('shift(0) equals today()', S.shift(0) === t);
  ok('shift(1) is one day on', S.daysUntil(S.shift(1)) === 1, S.daysUntil(S.shift(1)));
  ok('shift(-1) is one day back', S.daysUntil(S.shift(-1)) === -1);
  ok('shift(7) is seven days on', S.daysUntil(S.shift(7)) === 7);

  console.log('\n-- a follow-up set to today is NOT overdue');
  const lead = S.insert('leads', {
    name: 'Test Co', leadStatus: 'working', rating: 'warm', ownerId: 'u',
    estValue: 0, nextFollowUp: S.today(), lastContactedAt: '', tags: [],
    convertedCustomerId: '', convertedAt: ''
  }, 'l', 'Test Co');
  ok('due today, not overdue', S.followUpState(lead).key === 'today', S.followUpState(lead).key);
  ok('daysUntil today is 0', S.daysUntil(S.today()) === 0);

  console.log('\n-- updating the date clears the overdue state');
  S.update('leads', lead.id, { nextFollowUp: S.shift(-3) }, 'back-date it');
  ok('a past date is overdue', S.followUpState(S.find('leads', lead.id)).key === 'overdue');
  S.logContact(lead.id, { date: S.today(), nextFollowUp: S.shift(5) });
  const after = S.find('leads', lead.id);
  ok('the new date was stored', after.nextFollowUp === S.shift(5), after.nextFollowUp);
  ok('it is no longer overdue', S.followUpState(after).key === 'soon', S.followUpState(after).key);
  ok('the badge would read "in 5 days"', S.daysUntil(after.nextFollowUp) === 5);
  S.update('leads', lead.id, { nextFollowUp: S.shift(30) }, 'push it out');
  ok('a far date reads as scheduled', S.followUpState(S.find('leads', lead.id)).key === 'scheduled');

  console.log('\n-- work orders and tasks use the same clock');
  ok('a task due today is not overdue',
     S.taskState({ status: 'open', dueDate: S.today() }).key === 'today');
  ok('a work order due today is not overdue',
     S.isOverdue({ status: 'notstarted', dueDate: S.today() }) === false);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
