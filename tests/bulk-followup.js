/* Resetting many follow-up dates at once.

   The thing worth testing is not that the dates change — it is that the
   batch stays a batch. A loop over update() would pass a naive "did the
   date change" test while writing one activity line and one network
   request per lead, which buries the day's history and is what the bulk
   action existed to avoid. */
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

/* Every call the store makes to the backend, so the test can count them. */
const calls = { upsert: [], update: [], insert: [] };
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({
    select: () => thenable({ data: rows[t] || [], error: null }),
    upsert: b => { calls.upsert.push({ table: t, rows: [].concat(b) }); return thenable({ error: null }); },
    update: b => { calls.update.push({ table: t, row: b }); return { eq: () => thenable({ error: null }) }; },
    insert: b => { calls.insert.push({ table: t, rows: [].concat(b) }); return thenable({ error: null }); },
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
const S = win.Store;

const reset = () => { calls.upsert = []; calls.update = []; calls.insert = []; };
/* The activity entry is itself a row, written to its own table. Counting
   raw upserts would score that as a second lead write. */
const leadWrites = () => calls.upsert.filter(c => c.table === 'leads');
const activityCount = () => S.all('activity').length;

(async () => {
  await S.boot();

  const mk = (name, due) => S.insert('leads', {
    name, leadStatus: 'working', rating: 'warm', ownerId: 'u', estValue: 0,
    nextFollowUp: due, lastContactedAt: '', tags: [],
    convertedCustomerId: '', convertedAt: ''
  }, 'l', name);

  /* Deliberately mixed starting dates: overdue, due today, far out, and
     one never scheduled. A bulk reset has to flatten all four. */
  const a = mk('Overdue Co', S.shift(-9));
  const b = mk('Due Today Co', S.today());
  const c = mk('Booked Co', S.shift(21));
  const d = mk('Unscheduled Co', '');
  const bystander = mk('Not Selected Co', S.shift(-4));

  console.log('\n-- one batch, not a loop');
  reset();
  const before = activityCount();
  const touched = S.updateMany('leads', [a.id, b.id, c.id, d.id],
    { nextFollowUp: S.shift(7) }, '4 leads · follow-up set to next week');
  ok('it reports the four it touched', touched.length === 4, touched.length);
  ok('exactly one activity entry for the batch',
     activityCount() - before === 1, activityCount() - before);
  ok('exactly one write to the backend',
     leadWrites().length === 1, leadWrites().length);
  ok('that write carried all four rows',
     leadWrites().length === 1 && leadWrites()[0].rows.length === 4,
     leadWrites().length && leadWrites()[0].rows.length);
  ok('and no per-record update calls', calls.update.length === 0, calls.update.length);

  console.log('\n-- the same day for every lead, whatever it was before');
  const want = S.shift(7);
  [a, b, c, d].forEach(l => {
    const now = S.find('leads', l.id);
    ok(l.name + ' lands on the batch date', now.nextFollowUp === want, now.nextFollowUp);
  });
  ok('all four read as scheduled, none overdue',
     [a, b, c, d].every(l => S.followUpState(S.find('leads', l.id)).key === 'soon'));
  ok('updatedAt was stamped', [a, b, c, d].every(l => !!S.find('leads', l.id).updatedAt));

  console.log('\n-- a lead that was not selected is untouched');
  const by = S.find('leads', bystander.id);
  ok('its date did not move', by.nextFollowUp === S.shift(-4), by.nextFollowUp);
  ok('it is still overdue', S.followUpState(by).key === 'overdue');

  console.log('\n-- "today" is today, not one day overdue');
  reset();
  S.updateMany('leads', [a.id, b.id], { nextFollowUp: S.today() }, 'due today');
  ok('both read as due today',
     [a, b].every(l => S.followUpState(S.find('leads', l.id)).key === 'today'),
     S.followUpState(S.find('leads', a.id)).key);

  console.log('\n-- unscheduling clears the date');
  reset();
  S.updateMany('leads', [a.id, b.id, c.id], { nextFollowUp: '' }, 'cleared');
  ok('the date is empty', S.find('leads', a.id).nextFollowUp === '');
  ok('and it reads as unscheduled',
     S.followUpState(S.find('leads', a.id)).key === 'unscheduled',
     S.followUpState(S.find('leads', a.id)).key);
  /* Clearing the date takes a lead OUT of the follow-up queue. It used to
     put it in, as "unscheduled" - which meant clearing a stamped date moved
     the noise rather than removing it. */
  ok('and it leaves the follow-up queue entirely',
     !S.leadsNeedingAttention().some(l => l.id === a.id));
  ok('while still being an open lead', S.isLeadOpen(S.find('leads', a.id)));

  console.log('\n-- ids that are not there');
  reset();
  const beforeGhost = activityCount();
  const ghost = S.updateMany('leads', ['nope-1', 'nope-2'], { nextFollowUp: S.today() }, 'ghosts');
  ok('nothing was touched', ghost.length === 0, ghost.length);
  ok('no activity entry', activityCount() === beforeGhost);
  ok('no write', leadWrites().length === 0, leadWrites().length);
  ok('and no phantom records were created',
     S.all('leads').length === 5, S.all('leads').length);

  console.log('\n-- a mix of real and missing ids still works');
  reset();
  const mixed = S.updateMany('leads', [a.id, 'nope-3', c.id], { nextFollowUp: S.shift(3) }, 'mixed');
  ok('only the real ones came back', mixed.length === 2, mixed.length);
  ok('they got the date', S.find('leads', a.id).nextFollowUp === S.shift(3));
  ok('still a single write', leadWrites().length === 1, leadWrites().length);

  console.log('\n-- an empty selection is a no-op');
  reset();
  const beforeNone = activityCount();
  ok('returns nothing', S.updateMany('leads', [], { nextFollowUp: S.today() }, 'none').length === 0);
  ok('writes nothing', leadWrites().length === 0, leadWrites().length);
  ok('logs nothing', activityCount() === beforeNone);

  console.log('\n-- the activity entry says what happened');
  const last = S.all('activity').slice().sort((x, y) =>
    String(y.at || y.createdAt || '').localeCompare(String(x.at || x.createdAt || '')))[0];
  ok('an entry exists', !!last);
  ok('it names the collection', !!last && last.entityType === 'leads', last && last.entityType);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
