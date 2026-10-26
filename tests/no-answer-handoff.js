/* A rep marking No answer, through the database function.

   A rep may only save leads they own, so the hand-off cannot be an
   ordinary save - it goes through hand_off_lead (supabase/lead-statuses.sql).
   The order matters: the rep's status change and the hand-off note have to
   reach the database while the lead is still theirs, so the function call
   must wait for those writes. This fakes a slow network to prove it does,
   and checks what happens when the function is missing. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const mk = (id, extra) => Object.assign({
  id: id, name: id, leadStatus: 'new', rating: 'warm', ownerId: 'rep', branch: '',
  estValue: 0, nextFollowUp: day(-1), lastContactedAt: '', tags: [],
  lostReason: '', convertedCustomerId: '', convertedAt: ''
}, extra || {});

const rows = {
  profiles: [
    { id: 'rep', name: 'Cass', role: 'rep', active: true, branch: '' },
    { id: 'josh', name: 'Josh', role: 'rep', active: true, branch: '' }
  ],
  leads: [mk('a'), mk('b')],
  customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [], vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};

/* Every write lands 60ms later; the order things land in is recorded. */
const landed = [];
let rpcFails = false;
const slow = (what, v) => ({
  then: (res, rej) => wait(60).then(() => { landed.push(what); return res ? res(v) : v; }, rej)
});
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'rep' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: rec => slow(t + ' ' + ((Array.isArray(rec) ? rec[0] : rec) || {}).id, { error: null }),
                insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }),
                 in: () => thenable({ error: null }),
                 neq: () => thenable({ error: null }) }) }),
  rpc: (name, args) => {
    landed.push('rpc ' + name + ' ' + args.p_lead + ' -> ' + args.p_to);
    return Promise.resolve(rpcFails
      ? { error: { message: 'Could not find the function public.hand_off_lead' } }
      : { data: null, error: null });
  },
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
const errors = [];
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console: { log() {}, warn() {}, error() {} } };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

(async () => {
  await S.boot();
  win.Backend.onError = (t, op, msg) => errors.push(op + ': ' + msg);

  console.log('\n-- a rep logs No answer');
  S.logContact('a', { leadStatus: 'noanswer', nextFollowUp: day(1), note: 'Rang twice' });
  ok('the screen moves on straight away - the lead is Josh\'s', S.find('leads', 'a').ownerId === 'josh');
  ok('  so it leaves the rep\'s own list', !S.visibleLeads().some(l => l.id === 'a'));
  await wait(300);
  const rpcAt = landed.findIndex(x => x.indexOf('rpc ') === 0);
  const leadAt = landed.indexOf('leads a');
  const noteAt = landed.findIndex(x => x.indexOf('notes ') === 0);
  ok('the database function was called once, for Josh',
     landed.filter(x => x === 'rpc hand_off_lead a -> josh').length === 1, landed.join(' | '));
  ok('  only after the status change had landed', leadAt > -1 && rpcAt > leadAt, landed.join(' | '));
  ok('  and after the notes had landed', noteAt > -1 && rpcAt > noteAt, landed.join(' | '));
  ok('no errors', !errors.length, errors.join(' | '));

  console.log('\n-- before the SQL has been run');
  rpcFails = true;
  S.logContact('b', { leadStatus: 'noanswer', nextFollowUp: day(1) });
  await wait(300);
  ok('the rep is told, in words that say what to do',
     errors.some(e => /hand off: .*not set up yet.*lead-statuses\.sql/.test(e)), errors.join(' | '));

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
