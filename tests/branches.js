/* Branches: a manager runs one, and sees only its leads.

   "Manager" used to mean "sees everything", which is the wrong shape for
   somebody running a second office — it would hand them the whole of the
   other one. Roles say what you may do; the branch says where.

   A blank branch is a branch, not "unset". Everything that predates this
   has one, so nothing moves until a value is actually set — and the
   assertions below lean on that, because a special case for "unset" is the
   thing that would quietly leak one office into the other. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [
    { id: 'alex',    name: 'Alex Herrman',  role: 'admin',   active: true, branch: '' },
    { id: 'frank',   name: 'Frank Doyle',   role: 'rep',     active: true, branch: '' },
    { id: 'cassius', name: 'Cassius Alves', role: 'manager', active: true, branch: 'Brazil' },
    { id: 'bruna',   name: 'Bruna Lima',    role: 'rep',     active: true, branch: 'Brazil' },
    { id: 'usmgr',   name: 'Dana Ruiz',     role: 'manager', active: true, branch: '' }
  ],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [], activity: [],
  outreach: [], outreach_groups: [], statuses: [], vendor_types: [],
  settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'alex' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }),
                                 in: () => thenable({ error: null }),
                                 neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
/* Local mode on purpose: setMe() is how this suite changes who is acting,
   and it only works there — in the hosted build who you are comes from the
   session, which a test cannot forge. The rules under test live in the
   store either way. */
const mem = {};
const win = {
  localStorage: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  },
  CRM_CONFIG: { supabase: { url: '', anonKey: '' } },
  supabase: { createClient: () => client }, console
};
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

const mk = (name, ownerId, branch) => S.insert('leads', {
  name, ownerId, branch, leadStatus: 'new', rating: 'cold', estValue: 0,
  nextFollowUp: '', lastContactedAt: '', tags: [], source: 'Realtor List',
  convertedCustomerId: '', convertedAt: ''
}, 'l', name);

const names = list => list.map(l => l.name).sort().join(', ');

(async () => {
  await S.boot();

  /* Local mode seeds a demo team and demo leads. Clear the leads so the
     counts below are about this suite's cast, and add that cast. */
  S.removeMany('leads', S.all('leads').map(l => l.id));
  rows.profiles.forEach(u => {
    if (!S.find('users', u.id)) S.insert('users', u, 'u', u.name);
  });

  const usFrank = mk('US Frank Lead', 'frank', '');
  const usDana  = mk('US Dana Lead', 'usmgr', '');
  const brCass  = mk('BR Cassius Lead', 'cassius', 'Brazil');
  const brBruna = mk('BR Bruna Lead', 'bruna', 'Brazil');

  console.log('\n-- the admin is above branches');
  S.setMe('alex');
  ok('sees all four', S.visibleLeads().length === 4, S.visibleLeads().length);

  console.log('\n-- Cassius runs Brazil');
  S.setMe('cassius');
  ok('sees both Brazil leads, including his rep’s',
     names(S.visibleLeads()) === 'BR Bruna Lead, BR Cassius Lead', names(S.visibleLeads()));
  ok('and no US lead at all',
     !S.visibleLeads().some(l => (l.branch || '') === ''), names(S.visibleLeads()));
  ok('which is the whole point of the change',
     S.visibleLeads().indexOf(usFrank) < 0 && S.visibleLeads().indexOf(usDana) < 0);

  console.log('\n-- the US manager is unaffected by any of it');
  /* Blank is a branch. A manager who had no branch set sees exactly what
     they saw before branches existed, which is what makes this safe to
     deploy before anybody is configured. */
  S.setMe('usmgr');
  ok('sees both US leads', names(S.visibleLeads()) === 'US Dana Lead, US Frank Lead',
     names(S.visibleLeads()));
  ok('and neither Brazil lead', S.visibleLeads().length === 2, S.visibleLeads().length);

  console.log('\n-- a rep sees their own, branch or no branch');
  S.setMe('frank');
  ok('Frank sees only his', names(S.visibleLeads()) === 'US Frank Lead', names(S.visibleLeads()));
  S.setMe('bruna');
  ok('Bruna sees only hers', names(S.visibleLeads()) === 'BR Bruna Lead', names(S.visibleLeads()));
  ok('not her own manager’s', S.visibleLeads().indexOf(brCass) < 0);

  console.log('\n-- who you may hand a lead to');
  S.setMe('alex');
  /* The seeded demo team is here too, so this is "everybody active",
     not a fixed number. */
  const activeCount = S.all('users').filter(u => u.active).length;
  ok('an admin may pick anybody', S.assignableUsers().length === activeCount,
     S.assignableUsers().length + ' of ' + activeCount);
  S.setMe('cassius');
  const his = S.assignableUsers().map(u => u.name).sort().join(', ');
  ok('Cassius may pick only his own branch', his === 'Bruna Lima, Cassius Alves', his);
  ok('so he cannot hand a lead to a US rep',
     !S.assignableUsers().some(u => u.id === 'frank'));
  S.setMe('usmgr');
  /* Blank is a branch, so the US manager gets everybody in it - including
     the seeded team, who have no branch either. The assertion that matters
     is that nobody from Brazil is in the list. */
  ok('the US manager gets everybody in the blank branch',
     S.assignableUsers().every(u => (u.branch || '') === ''),
     S.assignableUsers().map(u => u.name + '/' + (u.branch || '-')).join(', '));
  ok('and nobody from Brazil',
     !S.assignableUsers().some(u => u.id === 'cassius' || u.id === 'bruna'));
  ok('but does include the US rep',
     S.assignableUsers().some(u => u.id === 'frank'));

  console.log('\n-- new leads inherit the maker’s branch');
  S.setMe('cassius');
  ok('myBranch reports Brazil', S.myBranch() === 'Brazil', S.myBranch());
  const fresh = mk('BR New Lead', 'cassius', S.myBranch());
  ok('a lead Cassius adds is in Brazil', fresh.branch === 'Brazil', fresh.branch);
  ok('and he can see it', S.visibleLeads().indexOf(fresh) > -1);
  S.setMe('usmgr');
  ok('the US manager still cannot', S.visibleLeads().indexOf(fresh) < 0);

  console.log('\n-- the branch list for the picker');
  S.setMe('alex');
  ok('offers the branches in use', S.allBranches().join(',') === 'Brazil', S.allBranches().join(','));

  console.log('\n-- assigning across a branch is refused by construction');
  /* assignMany does not police the branch itself - the database does, and
     the UI only offers assignable people. What matters here is that the
     list handed to the dialog cannot contain somebody out of branch. */
  S.setMe('cassius');
  ok('every assignable person shares his branch',
     S.assignableUsers().every(u => (u.branch || '') === 'Brazil'));

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
