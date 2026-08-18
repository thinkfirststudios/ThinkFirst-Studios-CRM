/* Mockup tracking: made vs sent, and the "built but never sent" queue. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const mk = (id, extra) => Object.assign({
  id: id, name: id, leadStatus: 'working', rating: 'warm', ownerId: 'u',
  estValue: 0, nextFollowUp: day(3), lastContactedAt: '', tags: [],
  mockupStatus: 'none', mockupTypes: [], mockupUrl: '', mockupReadyAt: '', mockupSentAt: '',
  lostReason: '', convertedCustomerId: '', convertedAt: ''
}, extra || {});

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true },
             { id: 'u2', name: 'Sam', role: 'rep', active: true }],
  leads: [
    mk('nothing'),
    mk('building', { mockupStatus: 'inprogress', mockupTypes: ['Website'] }),
    // ready 5 days — the expensive one
    mk('waiting_long', { mockupStatus: 'ready', mockupReadyAt: day(-5),
                         mockupTypes: ['Website'], mockupUrl: 'figma.com/x' }),
    // ready today — fine, not stale
    mk('waiting_today', { mockupStatus: 'ready', mockupReadyAt: day(0) }),
    mk('sent_ok', { mockupStatus: 'sent', mockupReadyAt: day(-6), mockupSentAt: day(-2),
                    nextFollowUp: day(2) }),
    // sent with nothing booked after it
    mk('sent_orphan', { mockupStatus: 'sent', mockupReadyAt: day(-8), mockupSentAt: day(-4),
                        nextFollowUp: '' }),
    // ready, but the lead is dead — must not be chased
    mk('ready_dead', { mockupStatus: 'ready', mockupReadyAt: day(-9), leadStatus: 'dead' }),
    mk('other_owner', { mockupStatus: 'ready', mockupReadyAt: day(-3), ownerId: 'u2' })
  ],
  customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [{ id: 'new', label: 'New', tone: 'b-blue', order: 1, open: true, won: false }],
  vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
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
  const g = id => S.find('leads', id);
  const state = id => S.mockupState(g(id));

  console.log('\n-- made and sent are different facts');
  ok('none is neither', !state('nothing').made && !state('nothing').sent);
  ok('in progress is not yet made', !state('building').made);
  ok('ready IS made but NOT sent', state('waiting_long').made && !state('waiting_long').sent);
  ok('sent is both', state('sent_ok').made && state('sent_ok').sent);

  console.log('\n-- how long finished work has been sitting');
  ok('waiting counted in days', state('waiting_long').waiting === 5, state('waiting_long').waiting);
  ok('finished today is zero, not null', state('waiting_today').waiting === 0);
  ok('5 days unsent is flagged stale', state('waiting_long').stale === true);
  ok('finished today is not stale', state('waiting_today').stale === false);
  ok('a sent mockup is never stale', state('sent_ok').stale === false);
  ok('days since sending tracked', state('sent_ok').sinceSent === 2, state('sent_ok').sinceSent);

  console.log('\n-- the ready-to-send queue');
  const q = S.mockupsReadyToSend();
  ok('only ready ones', q.every(l => l.mockupStatus === 'ready'));
  ok('a dead lead is not chased', !q.some(l => l.id === 'ready_dead'));
  ok('longest wait first', q[0].id === 'waiting_long', q.map(l => l.id).join(','));
  ok('everyone included by default', q.length === 3, q.map(l => l.id).join(','));
  ok('can be scoped to one person', S.mockupsReadyToSend('u2').length === 1);

  console.log('\n-- sent with nothing booked after it');
  ok('flagged', state('sent_orphan').sentNoFollowUp === true);
  ok('not flagged when a date exists', state('sent_ok').sentNoFollowUp === false);
  ok('an unsent mockup is not flagged for it', state('waiting_long').sentNoFollowUp === false);

  console.log('\n-- stats');
  const st = S.mockupStats();
  ok('ready counted', st.ready === 3, st.ready);
  ok('sent counted', st.sent === 2, st.sent);
  ok('in progress counted', st.inprogress === 1);
  // 2 sent of 5 built -> 40%
  ok('send rate is sent over built', st.sendRate === 40, st.sendRate);
  ok('orphaned sends counted', st.sentNoFollowUp === 1);

  console.log('\n-- dates are stamped, not typed');
  S.setMockup('nothing', { mockupStatus: 'ready', mockupUrl: 'figma.com/new', mockupTypes: ['Logo'] });
  let n = g('nothing');
  ok('ready stamps the finish date', n.mockupReadyAt === day(0), n.mockupReadyAt);
  ok('not sent, so no send date', n.mockupSentAt === '');
  ok('link saved', n.mockupUrl === 'figma.com/new');
  ok('types saved', n.mockupTypes.join(',') === 'Logo');

  S.setMockup('nothing', { mockupStatus: 'sent', nextFollowUp: day(2) });
  n = g('nothing');
  ok('sent stamps the send date', n.mockupSentAt === day(0));
  ok('the original finish date is preserved', n.mockupReadyAt === day(0));
  ok('the follow-up came with it', n.nextFollowUp === day(2));

  console.log('\n-- pulling one back clears the claim it makes');
  S.setMockup('nothing', { mockupStatus: 'inprogress' });
  n = g('nothing');
  ok('no longer claims to be sent', n.mockupSentAt === '');
  ok('and no longer claims to be finished', n.mockupReadyAt === '');
  ok('state agrees', !S.mockupState(n).made && !S.mockupState(n).sent);

  console.log('\n-- editing a link does not reschedule the lead');
  const before = g('sent_ok').nextFollowUp;
  S.setMockup('sent_ok', { mockupUrl: 'figma.com/updated' });
  ok('follow-up untouched', g('sent_ok').nextFollowUp === before, g('sent_ok').nextFollowUp);
  ok('link updated', g('sent_ok').mockupUrl === 'figma.com/updated');
  ok('send date untouched', g('sent_ok').mockupSentAt === day(-2));

  console.log('\n-- the mockup follows the lead into the account');
  S.update('leads', 'waiting_long', { leadStatus: 'qualified' }, 'ready to convert');
  const out = S.convertLead('waiting_long', { createOpportunity: false });
  const notes = S.notesFor('customer', out.account.id);
  ok('the winning mockup is recorded on the account',
     notes.some(x => x.body.indexOf('figma.com/x') > -1),
     notes.map(x => x.body).join(' | '));

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
