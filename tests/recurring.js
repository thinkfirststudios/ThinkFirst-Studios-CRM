/* What an account bills. Stripe where it exists, the typed contract
   otherwise, and the two added together for the total — not one of them
   thrown away because the other exists. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const acct = (id, extra) => Object.assign({
  id: id, name: id, accountType: 'customer', billingType: 'paid',
  value: 0, billingCycle: '', billingDate: '', services: [], ownerId: 'u',
  tags: [], status: 'active', stripeCustomerId: ''
}, extra || {});

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  customers: [
    // Billed by Stripe. Nobody typed a contract value — this is the case
    // that showed an empty Contract column.
    acct('guero', { name: "Guero's Auto Repair", stripeCustomerId: 'cus_g' }),
    acct('pawz',  { name: 'Pawz Riverside', stripeCustomerId: 'cus_p' }),
    // Billed by hand.
    acct('manual', { name: 'Halstead Legal', value: 1450, billingCycle: 'Monthly' }),
    acct('annual', { name: 'Northline', value: 1200, billingCycle: 'Annual' }),
    acct('quarter', { name: 'Quarterly Co', value: 900, billingCycle: 'Quarterly' }),
    acct('onetime', { name: 'One Off Co', value: 5000, billingCycle: 'One-Time' }),
    // Pro bono: has a number on the record but bills nothing.
    acct('free', { name: 'Community Garden', billingType: 'probono', value: 800, billingCycle: 'Monthly' }),
    // A prospect is not recurring revenue yet.
    acct('prospect', { name: 'Prospect Co', accountType: 'prospect', value: 700, billingCycle: 'Monthly' })
  ],
  stripe_subscriptions: [
    { id: 's1', customerId: 'guero', stripeCustomerId: 'cus_g', status: 'active',
      amountCents: 9900, interval: 'month', intervalCount: 1, currentPeriodEnd: '2026-09-01' },
    { id: 's2', customerId: 'pawz', stripeCustomerId: 'cus_p', status: 'active',
      amountCents: 7100, interval: 'month', intervalCount: 1, currentPeriodEnd: '2026-09-05' },
    // cancelled — not money
    { id: 's3', customerId: 'guero', stripeCustomerId: 'cus_g', status: 'canceled',
      amountCents: 5000, interval: 'month', intervalCount: 1, currentPeriodEnd: '2026-08-01' },
    // charging, but pointing at no account in the CRM
    { id: 's4', customerId: '', stripeCustomerId: 'cus_ghost', status: 'active',
      amountCents: 2500, interval: 'month', intervalCount: 1, currentPeriodEnd: '2026-09-09' }
  ],
  contacts: [], opportunities: [], tasks: [], leads: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [{ id: 'active', label: 'Active', tone: 'b-green', order: 4, open: false, won: true }],
  vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_sync_state: []
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
  const r = id => S.accountRecurring(S.account(id));

  console.log('\n-- a Stripe-billed account is no longer blank');
  ok('Guero shows a number', r('guero').amount === 99, r('guero').amount);
  ok('Pawz shows a number', r('pawz').amount === 71, r('pawz').amount);
  ok('marked as coming from Stripe', r('guero').source === 'stripe');
  ok('cycle named from the subscription', r('guero').cycle === 'Monthly', r('guero').cycle);
  ok('a cancelled subscription is not counted', r('guero').amount !== 149);
  ok('the typed value stays zero and is simply not used', S.account('guero').value === 0);

  console.log('\n-- hand-billed accounts still work');
  ok('monthly as typed', r('manual').amount === 1450 && r('manual').monthly === 1450);
  ok('marked manual', r('manual').source === 'manual');
  ok('annual spreads over 12', r('annual').monthly === 100, r('annual').monthly);
  ok('quarterly spreads over 3', r('quarter').monthly === 300, r('quarter').monthly);
  ok('one-time is not recurring', r('onetime').monthly === 0, r('onetime').monthly);
  ok('but its amount is still shown', r('onetime').amount === 5000);

  console.log('\n-- free work bills nothing whatever the record says');
  ok('pro bono monthly is zero', r('free').monthly === 0);
  ok('and its amount is zero, not 800', r('free').amount === 0, r('free').amount);
  ok('flagged free', r('free').source === 'free');

  console.log('\n-- the total counts BOTH sources');
  // stripe 99 + 71, manual 1450 + 100 + 300. Prospect and pro bono excluded.
  const expected = 99 + 71 + 1450 + 100 + 300;
  ok('mrr adds Stripe and manual together', S.mrr() === expected, S.mrr() + ' vs ' + expected);
  ok('a prospect is not counted', S.mrr() !== expected + 700);
  // This is the bug: the old code returned ONLY the Stripe figure.
  ok('manual contracts are not thrown away by Stripe existing', S.mrr() > 170);

  console.log('\n-- unlinked subscriptions are real money too');
  const un = S.unlinkedSubscriptions();
  ok('the orphan is found', un.length === 1 && un[0].id === 's4', un.map(x => x.id).join(','));
  const rec = S.recurringCents();
  ok('it is included in the total', rec.cents === Math.round(expected * 100) + 2500,
     rec.cents + ' vs ' + (Math.round(expected * 100) + 2500));
  ok('and reported separately so it can be linked', rec.unlinked === 2500, rec.unlinked);
  ok('the source says it is a mix', rec.source === 'mixed', rec.source);

  console.log('\n-- the goal tracker sees the same figure');
  S.setMrrGoal(5000);
  const g = S.goalProgress();
  ok('goal reads the combined total', g.current === rec.cents, g.current + ' vs ' + rec.cents);
  ok('not just the Stripe part', g.current !== 17000);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
