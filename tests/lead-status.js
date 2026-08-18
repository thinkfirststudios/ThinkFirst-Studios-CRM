/* Two ways to lose a lead: never a fit (Unqualified) vs was a fit and
   went nowhere (Dead). They must not be the same number. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const mk = (id, status, extra) => Object.assign({
  id: id, name: id, leadStatus: status, rating: 'warm', ownerId: 'u',
  estValue: 1000, nextFollowUp: '', lastContactedAt: '', tags: [],
  lostReason: '', convertedCustomerId: '', convertedAt: ''
}, extra || {});

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [
    mk('open1', 'working', { nextFollowUp: day(3) }),
    mk('open2', 'qualified', { nextFollowUp: day(2) }),
    mk('conv1', 'converted', { convertedCustomerId: 'a1' }),
    mk('conv2', 'converted', { convertedCustomerId: 'a2' }),
    mk('unq1', 'unqualified', { lostReason: 'Outside our service area' }),
    mk('unq2', 'unqualified', { lostReason: 'Wanted print only' }),
    mk('dead1', 'dead', { lostReason: 'Stopped replying after the quote' }),
    mk('dead2', 'dead', { lostReason: 'Went with a cheaper agency' })
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

  console.log('\n-- the status exists and is closed');
  const dead = S.leadStatus('dead');
  ok('Dead is a real status', dead.id === 'dead' && dead.label === 'Dead');
  ok('it is not an open lead', dead.open === false);
  ok('a dead lead is not in play', !S.isLeadOpen(S.find('leads', 'dead1')));
  ok('it is distinct from Unqualified', S.leadStatus('unqualified').id !== dead.id);
  ok('the red is on Dead, not Unqualified',
     dead.tone === 'b-red' && S.leadStatus('unqualified').tone === 'b-grey',
     dead.tone + ' / ' + S.leadStatus('unqualified').tone);

  console.log('\n-- dead leads leave the working queues');
  ok('excluded from open leads', !S.openLeads().some(l => l.leadStatus === 'dead'));
  ok('open count is only the live ones', S.openLeads().length === 2, S.openLeads().length);
  ok('never chased for a follow-up',
     !S.leadsNeedingAttention().some(l => l.leadStatus === 'dead'));
  ok('a dead lead with no date is not flagged unscheduled',
     S.followUpState(S.find('leads', 'dead1')).key === 'closed');

  console.log('\n-- the two losses are counted separately');
  const st = S.leadStats();
  ok('dead counted', st.dead === 2, st.dead);
  ok('unqualified counted', st.unqualified === 2, st.unqualified);
  ok('lost is the sum of both', st.lost === 4, st.lost);
  ok('converted unchanged', st.converted === 2);

  console.log('\n-- two rates, measuring different things');
  // Decided = 2 converted + 2 unqualified + 2 dead = 6 -> 33%
  ok('convRate counts every decided lead', st.convRate === 33, st.convRate);
  // Winnable = 2 converted + 2 dead = 4 -> 50%. Unqualified never winnable.
  ok('winRate excludes leads that were never a fit', st.winRate === 50, st.winRate);
  ok('the two rates genuinely differ here', st.convRate !== st.winRate);

  console.log('\n-- the reason is kept');
  ok('stored on the lead', S.find('leads', 'dead1').lostReason === 'Stopped replying after the quote');
  ok('unqualified carries its own reason',
     S.find('leads', 'unq1').lostReason === 'Outside our service area');

  console.log('\n-- closing through logContact records the reason');
  S.logContact('open1', { leadStatus: 'dead', lostReason: 'Three attempts, no reply', nextFollowUp: '' });
  const closed = S.find('leads', 'open1');
  ok('status moved to dead', closed.leadStatus === 'dead');
  ok('reason saved', closed.lostReason === 'Three attempts, no reply', closed.lostReason);
  ok('it drops out of the open count', S.openLeads().length === 1);

  console.log('\n-- a reason is never attached to a lead still in play');
  S.logContact('open2', { leadStatus: 'working', lostReason: 'should be ignored', nextFollowUp: day(4) });
  ok('open lead keeps an empty reason', S.find('leads', 'open2').lostReason === '',
     S.find('leads', 'open2').lostReason);

  console.log('\n-- reviving');
  const revived = S.reviveLead('dead2', day(2));
  ok('back to working', revived.leadStatus === 'working');
  ok('in play again', S.isLeadOpen(revived));
  ok('comes back with a date booked', revived.nextFollowUp === day(2), revived.nextFollowUp);
  ok('not immediately flagged as needing attention',
     S.followUpState(revived).key === 'soon', S.followUpState(revived).key);
  ok('why it died is kept as a note',
     S.notesFor('lead', 'dead2').some(n => n.body.indexOf('Went with a cheaper agency') > -1));
  ok('a revived lead with no date given still gets one',
     !!S.reviveLead('dead1').nextFollowUp);

  console.log('\n-- converted is still untouched by any of this');
  ok('converted stays converted', S.find('leads', 'conv1').leadStatus === 'converted');
  // By now: 2 unqualified, plus dead1/dead2 revived away and open1 newly
  // dead -> 1 dead. Converted is not in the number either way.
  ok('lost counts only unqualified + dead', S.leadStats().lost === 3, S.leadStats().lost);
  ok('and never the converted ones',
     S.leadStats().lost + S.leadStats().converted + S.leadStats().open === S.all('leads').length,
     S.leadStats().lost + '+' + S.leadStats().converted + '+' + S.leadStats().open +
     ' vs ' + S.all('leads').length);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
