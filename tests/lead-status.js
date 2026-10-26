/* The call-outcome statuses agreed Oct 2026:

     open    New lead · No answer · Left voicemail · Hung up
     closed  Do not call · Pitch no sale (with why) · Pitch and sale

   No answer is not dead - it is called again, by somebody else. This
   checks the list, that the old statuses still land in the right place
   before the SQL renames them, the numbers on the leads screen, closing
   with a reason, and the No answer hand-off as an admin (a direct save).
   The rep's hand-off, which goes through the database, is in
   tests/no-answer-handoff.js. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const mk = (id, status, extra) => Object.assign({
  id: id, name: id, leadStatus: status, rating: 'warm', ownerId: 'u', branch: '',
  estValue: 1000, nextFollowUp: '', lastContactedAt: '', tags: [],
  lostReason: '', convertedCustomerId: '', convertedAt: ''
}, extra || {});

const rows = {
  profiles: [
    { id: 'u', name: 'Alex', role: 'admin', active: true, branch: '' },
    { id: 'josh', name: 'Josh', role: 'rep', active: true, branch: '' },
    { id: 'jason', name: 'Jason', role: 'rep', active: true, branch: '' },
    { id: 'gone', name: 'Gone', role: 'rep', active: false, branch: '' },
    { id: 'br', name: 'Brazil', role: 'rep', active: true, branch: 'Brazil' }
  ],
  leads: [
    mk('new1', 'new', { nextFollowUp: day(3) }),
    mk('old-working', 'working', { nextFollowUp: day(2) }),
    mk('old-qualified', 'qualified', { nextFollowUp: day(2) }),
    mk('old-unq', 'unqualified', { lostReason: 'Outside our service area' }),
    mk('vm1', 'voicemail', { nextFollowUp: day(1) }),
    mk('hung1', 'hungup', { nextFollowUp: day(1) }),
    mk('dnc1', 'dead', { lostReason: 'Asked not to be called' }),
    mk('nosale1', 'nosale', { lostReason: 'Happy with their site' }),
    mk('sale1', 'converted', { convertedCustomerId: 'a1' }),
    // Josh already has a second call waiting, so the next one goes to Jason.
    mk('joshs', 'noanswer', { ownerId: 'josh', nextFollowUp: day(1) })
  ],
  customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [], vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
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
  rpc: () => { throw new Error('an admin hand-off must not need the database function'); },
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

  console.log('\n-- the list, in order');
  ok('seven statuses', S.LEAD_STATUSES.map(x => x.label).join(' | ') ===
     'New lead | No answer | Left voicemail | Hung up | Do not call | Pitch no sale | Pitch and sale',
     S.LEAD_STATUSES.map(x => x.label).join(' | '));
  ok('the first four are open', S.LEAD_STATUSES.filter(x => x.open).map(x => x.id).join() ===
     'new,noanswer,voicemail,hungup');
  ok('No answer is open - it is called again', S.leadStatus('noanswer').open === true);
  ok('Pitch no sale asks why', S.leadStatus('nosale').needsReason === true);
  ok('Do not call keeps the old Dead id', S.leadStatus('dead').label === 'Do not call');
  ok('Pitch and sale keeps the Converted id', S.leadStatus('converted').label === 'Pitch and sale');

  console.log('\n-- old statuses land where the SQL will put them');
  ok('Working reads as No answer', S.find('leads', 'old-working').leadStatus === 'noanswer',
     S.find('leads', 'old-working').leadStatus);
  ok('Qualified reads as No answer', S.find('leads', 'old-qualified').leadStatus === 'noanswer');
  ok('Unqualified reads as Do not call', S.find('leads', 'old-unq').leadStatus === 'dead');
  ok('  keeping its reason', S.find('leads', 'old-unq').lostReason === 'Outside our service area');
  ok('an unknown stored id is looked up by alias too', S.leadStatus('nurturing').id === 'noanswer');

  console.log('\n-- the numbers on the leads screen');
  const st = S.leadStats();
  ok('open = new + recall leads', st.open === 6, st.open);
  ok('call again counts no answer, voicemail and hung up', st.recall === 5, st.recall);
  ok('Do not call counted', st.dead === 2, st.dead);
  ok('Pitch no sale counted', st.nosale === 1, st.nosale);
  ok('sales counted', st.converted === 1);
  ok('win rate is sales over pitches, Do not call left out', st.winRate === 50, st.winRate);

  console.log('\n-- closing records the reason');
  S.logContact('vm1', { leadStatus: 'nosale', lostReason: 'Too expensive', nextFollowUp: '' });
  ok('status moved to Pitch no sale', S.find('leads', 'vm1').leadStatus === 'nosale');
  ok('reason saved', S.find('leads', 'vm1').lostReason === 'Too expensive');
  S.logContact('hung1', { leadStatus: 'voicemail', lostReason: 'ignored', nextFollowUp: day(1) });
  ok('an open status never carries a reason', S.find('leads', 'hung1').lostReason === '');

  console.log('\n-- No answer goes to somebody else');
  ok('the next caller is whoever has fewest second calls waiting',
     S.nextCaller(S.find('leads', 'new1')).id === 'jason', S.nextCaller(S.find('leads', 'new1')).id);
  S.logContact('new1', { leadStatus: 'noanswer', nextFollowUp: day(1) });
  const l = S.find('leads', 'new1');
  ok('logging No answer hands the lead over', l.ownerId === 'jason', l.ownerId);
  ok('  with the second call booked', l.nextFollowUp === day(1));
  ok('  and a note saying who had it',
     S.notesFor('lead', 'new1').some(n => /Handed from Alex to Jason/.test(n.body)));
  ok('never to an inactive person or another branch',
     ['gone', 'br'].indexOf(S.nextCaller(S.find('leads', 'old-working')).id) < 0);
  // Josh 1, Jason 1 now: the tie goes by name, and never back to the caller.
  ok('never to the person who just rang', S.nextCaller(S.find('leads', 'old-working')).id !== 'u');
  ok('another status does not hand anything over',
     (S.logContact('old-qualified', { leadStatus: 'voicemail', nextFollowUp: day(2) }),
      S.find('leads', 'old-qualified').ownerId === 'u'));

  console.log('\n-- reviving a closed lead');
  const revived = S.reviveLead('nosale1', day(2));
  ok('back to New lead', revived.leadStatus === 'new');
  ok('why it closed is kept as a note',
     S.notesFor('lead', 'nosale1').some(n => n.body.indexOf('Happy with their site') > -1));

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
