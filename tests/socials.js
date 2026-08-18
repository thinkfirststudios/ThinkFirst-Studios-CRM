/* Social handles: any paste format reduces to one handle, and the
   handle survives lead conversion. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [{
    id: 'l1', name: 'Hollywood Gleam Co.', contactName: 'Miguel Soto', leadStatus: 'qualified',
    rating: 'hot', ownerId: 'u', estValue: 0, nextFollowUp: '', lastContactedAt: '', tags: ['Local'],
    email: '', phone: '(626) 234-7198', website: '', industry: 'Cleaning', address: 'West Hollywood',
    instagram: 'hollywoodgleam', tiktok: '', facebook: '',
    lostReason: '', convertedCustomerId: '', convertedAt: ''
  }],
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
  const h = S.socialHandle;

  console.log('\n-- every way a handle gets pasted lands on the same value');
  [
    ['hollywoodgleam', 'plain'],
    ['@hollywoodgleam', 'with @'],
    ['instagram.com/hollywoodgleam', 'bare host'],
    ['www.instagram.com/hollywoodgleam', 'with www'],
    ['https://instagram.com/hollywoodgleam', 'full url'],
    ['https://www.instagram.com/hollywoodgleam/', 'trailing slash'],
    ['https://www.instagram.com/hollywoodgleam/?hl=en', 'with tracking junk'],
    ['  @hollywoodgleam  ', 'padded']
  ].forEach(([input, label]) => {
    ok(label + ' -> hollywoodgleam', h(input) === 'hollywoodgleam', h(input));
  });

  console.log('\n-- tiktok keeps its @ in the URL but not in storage');
  ok('tiktok url strips to the handle', h('https://www.tiktok.com/@casillaspools') === 'casillaspools',
     h('https://www.tiktok.com/@casillaspools'));
  ok('and the link puts the @ back',
     S.social('tiktok').url('casillaspools') === 'https://tiktok.com/@casillaspools');
  ok('instagram link has no @', S.social('instagram').url('x') === 'https://instagram.com/x');

  console.log('\n-- facebook page urls');
  ok('page path', h('facebook.com/casillaspools') === 'casillaspools');
  ok('m. subdomain', h('https://m.facebook.com/casillaspools') === 'casillaspools');
  ok('fb.com short host', h('fb.com/casillaspools') === 'casillaspools');

  console.log('\n-- empty and junk are safe');
  ok('empty string', h('') === '');
  ok('null', h(null) === '');
  ok('undefined', h(undefined) === '');
  ok('just an @', h('@') === '');
  ok('just a slash', h('/') === '');

  console.log('\n-- socialsOf only returns what is set');
  const lead = S.find('leads', 'l1');
  let list = S.socialsOf(lead);
  ok('one handle on this lead', list.length === 1, list.length);
  ok('it is the instagram one', list[0].net.id === 'instagram');
  ok('with a working url', list[0].url === 'https://instagram.com/hollywoodgleam');
  ok('a record with none returns an empty list', S.socialsOf({}).length === 0);
  ok('null record is safe', S.socialsOf(null).length === 0);

  console.log('\n-- cleanSocials normalises on the way in');
  const v = S.cleanSocials({
    instagram: 'https://www.instagram.com/foo/',
    tiktok: '@bar',
    facebook: 'facebook.com/baz',
    name: 'untouched'
  });
  ok('instagram normalised', v.instagram === 'foo');
  ok('tiktok normalised', v.tiktok === 'bar');
  ok('facebook normalised', v.facebook === 'baz');
  ok('other fields untouched', v.name === 'untouched');
  const partial = S.cleanSocials({ instagram: '@only' });
  ok('absent fields are not invented',
     partial.tiktok === undefined && partial.facebook === undefined);

  console.log('\n-- handles are searchable');
  ok('search text includes the handle',
     S.socialSearchText(lead).indexOf('hollywoodgleam') > -1, S.socialSearchText(lead));
  ok('empty record gives empty text', S.socialSearchText({}) === '');

  console.log('\n-- conversion carries them to the account');
  S.update('leads', 'l1', { tiktok: 'gleamco', facebook: 'hollywoodgleamco' }, 'add handles');
  const out = S.convertLead('l1', { createOpportunity: false });
  ok('instagram carried', out.account.instagram === 'hollywoodgleam', out.account.instagram);
  ok('tiktok carried', out.account.tiktok === 'gleamco', out.account.tiktok);
  ok('facebook carried', out.account.facebook === 'hollywoodgleamco', out.account.facebook);
  ok('all three visible on the account', S.socialsOf(out.account).length === 3);
  // For a business with no website and no email this is the whole contact route.
  ok('the account is reachable despite having no website or email',
     !out.account.website && !out.account.email && S.socialsOf(out.account).length > 0);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
