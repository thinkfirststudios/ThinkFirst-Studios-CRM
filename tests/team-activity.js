/* Per-person activity, from the admin side.
 *
 *   node tests/team-activity.js
 *
 * The audit log answers "what happened". This answers "how is each person
 * doing", and the two halves of that answer are not equally reliable: what
 * is counted off the leads is exact however old it is, what is counted off
 * the activity log only reaches as far back as the log still goes. The
 * screen has to be able to tell the difference, so teamActivity() reports
 * it rather than leaving the reader to assume.
 */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [
    { id: 'u1', name: 'Alex', role: 'admin', active: true, branch: '' },
    { id: 'u2', name: 'Josh', role: 'rep', active: true, branch: '' },
    { id: 'u3', name: 'Cassius', role: 'manager', active: true, branch: 'Brazil' },
    { id: 'u4', name: 'Frank', role: 'rep', active: false, branch: '' }
  ],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [], vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const chain = v => ({ limit: () => thenable(v), then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => chain({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }), in: () => thenable({ error: null }),
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

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  await S.boot();
  const db = S.db();

  /* Leads: Josh has four, Cassius one. Two of Josh's were called this
     week, one a long time ago, one never. */
  db.leads.length = 0;
  const mk = (id, owner, last, next, status) => db.leads.push({
    id, name: 'Lead ' + id, ownerId: owner, lastContactedAt: last || '',
    nextFollowUp: next || '', leadStatus: status || 'working', branch: '',
    tags: [], rating: 'warm', mockupStatus: 'none'
  });
  mk('l1', 'u2', day(-1), day(-3));          // called, and overdue
  mk('l2', 'u2', day(-2), day(+4));          // called, not due yet
  mk('l3', 'u2', day(-200), '');             // called, but long ago
  mk('l4', 'u2', '', day(-9));               // never called, overdue
  mk('l5', 'u3', day(-1), '');

  /* The log: Josh made two calls and a note in the last few days, plus one
     call outside a 7-day window. Frank is inactive and must not appear. */
  db.activity.length = 0;
  const act = (userId, action, detail, dayOffset) => db.activity.push({
    id: 'a' + db.activity.length, userId, action, detail,
    entityType: 'lead', entityId: 'l1',
    ts: day(dayOffset) + 'T12:00:00.000Z'
  });
  act('u2', 'updated', 'contacted Lead l1', -1);
  act('u2', 'updated', 'contacted Lead l2', -2);
  act('u2', 'noted', 'left a voicemail', -2);
  act('u2', 'mockup', 'requested a mockup', -3);
  act('u2', 'updated', 'renamed Lead l3', -3);
  act('u2', 'updated', 'contacted Lead l3', -20);
  act('u3', 'created', 'added Lead l5', -1);
  act('u4', 'updated', 'contacted something', -1);
  db.activity.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  console.log('\nwho appears');
  let t = S.teamActivity(7);
  const by = n => t.rows.filter(r => r.user.name === n)[0];
  ok('every active person has a row', t.rows.length === 3, t.rows.length);
  ok('somebody who has left is not on the list', !by('Frank'));
  ok('busiest person first', t.rows[0].user.name === 'Josh', t.rows[0].user.name);

  console.log('\ncounted off the records - exact whatever the log says');
  ok('leads owned', by('Josh').leads === 4, by('Josh').leads);
  ok('contacted inside the window', by('Josh').contacted === 2, by('Josh').contacted);
  ok('  a lead called 200 days ago is not "contacted this week"',
     by('Josh').contacted !== 3, by('Josh').contacted);
  ok('overdue', by('Josh').overdue === 2, by('Josh').overdue);
  ok('never called at all', by('Josh').neverContacted === 1, by('Josh').neverContacted);
  ok('somebody with one lead reads one', by('Cassius').leads === 1, by('Cassius').leads);

  console.log('\ncounted off the log');
  ok('calls are updates that say "contacted"', by('Josh').calls === 2, by('Josh').calls);
  ok('  an edit that is not a call is not counted as one', by('Josh').edits === 1, by('Josh').edits);
  ok('notes', by('Josh').notes === 1, by('Josh').notes);
  ok('mockups', by('Josh').mockups === 1, by('Josh').mockups);
  ok('creations belong to whoever made them', by('Cassius').created === 1, by('Cassius').created);
  ok('a call outside the window is left out', by('Josh').actions === 5, by('Josh').actions);
  ok('last action is the newest one', by('Josh').lastSeen.indexOf(day(-1)) === 0, by('Josh').lastSeen);

  console.log('\nthe window');
  const all = S.teamActivity(0);
  ok('all time picks up the older call', all.rows.filter(r => r.user.name === 'Josh')[0].calls === 3,
     all.rows.filter(r => r.user.name === 'Josh')[0].calls);
  ok('  and all time is always complete', all.complete);
  const today = S.teamActivity(1);
  ok('today is narrower than the week', today.rows.filter(r => r.user.name === 'Josh')[0].calls === 1,
     today.rows.filter(r => r.user.name === 'Josh')[0].calls);
  ok('  but the durable counts do not shrink to nothing',
     today.rows.filter(r => r.user.name === 'Josh')[0].leads === 4);

  console.log('\nsaying so when the log does not reach back far enough');
  ok('a log older than the window is complete', S.teamActivity(7).complete);
  ok('  and covers says how far back it goes',
     t.covers === day(-20), t.covers);
  /* Now throw away everything but the last two days, as the cap does once
     the team has been working a while. */
  db.activity = db.activity.filter(a => a.ts.slice(0, 10) >= day(-2));
  S.db().activity = db.activity;
  const clipped = S.teamActivity(30);
  ok('a log that starts inside the window is NOT complete', !clipped.complete,
     'covers ' + clipped.covers);
  ok('  which is what stops a week being read as a month', clipped.covers === day(-2), clipped.covers);

  console.log('\none person drilled into');
  S.db().activity = db.activity;
  ok('their entries only', S.activityBy('u2', 30).every(a => a.userId === 'u2'));
  ok('newest first', (function () {
    const l = S.activityBy('u2', 30);
    for (let i = 1; i < l.length; i++) if (l[i - 1].ts < l[i].ts) return false;
    return true;
  })());
  ok('somebody with nothing logged reads empty, not everybody',
     S.activityBy('nobody', 30).length === 0);

  console.log('\nthe log holds more than it used to');
  for (let i = 0; i < 900; i++) S.insert('leads', { name: 'Bulk ' + i, ownerId: 'u2', tags: [] }, 'l', 'b');
  ok('900 actions are not truncated to the old cap of 500',
     S.db().activity.length > 500, S.db().activity.length);
  ok('  every one of them is still there', S.db().activity.length >= 900, S.db().activity.length);

  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
