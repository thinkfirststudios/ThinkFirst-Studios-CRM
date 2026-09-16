/* The dashboard shows you your own plate, and the app says so itself.

   The lead screens have always filtered in the app as well as in the
   database. The dashboard did not: its follow-up queue, its counters and the
   mockup cards read the whole lead table. In the hosted CRM that is already
   safe - the database only ever hands a rep their own leads - so the screen
   looked right. It was one lock on the door instead of two, and it would
   have started leaking the day a policy was loosened.

   These run in local mode, where there is no database filtering at all, so
   they fail against the old code and only pass if the app is doing it. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const mem = {};
const win = {
  localStorage: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  },
  CRM_CONFIG: { supabase: { url: '', anonKey: '' } }, console
};
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

(async () => {
  await S.boot();
  S.removeMany('leads', S.all('leads').map(l => l.id));
  [{ id: 'alex', name: 'Alex Herrman', role: 'admin', active: true, branch: '' },
   { id: 'josh', name: 'Josh Martinez', role: 'rep', active: true, branch: '' },
   { id: 'frank', name: 'Frank Stewart', role: 'rep', active: true, branch: '' },
   { id: 'cassius', name: 'Cassius Lee Hall', role: 'manager', active: true, branch: 'Brazil' },
   { id: 'bruna', name: 'Bruna Lima', role: 'rep', active: true, branch: 'Brazil' }]
    .forEach(u => { if (!S.find('users', u.id)) S.insert('users', u, 'u', u.name); });

  const mk = (name, owner, branch, extra) => S.insert('leads', Object.assign({
    name, leadStatus: 'working', rating: 'warm', ownerId: owner, branch: branch, tags: [],
    nextFollowUp: S.shift(-1), mockupStatus: 'none', mockupTypes: []
  }, extra || {}), 'l', name);

  const joshs = mk('Laura Zafonte', 'josh', '');
  const franks = mk('Barbara Montone', 'frank', '');
  const brunas = mk('Boni Restaurante', 'bruna', 'Brazil');
  /* Booked ahead, so these sit on the mockup cards without also being in
     the follow-up queue - the two lists are being checked separately. */
  mk('Mary Ann DeAlto', 'josh', '', { mockupStatus: 'ready', mockupReadyAt: S.shift(-2), nextFollowUp: S.shift(5) });
  mk('Cris Hotel', 'bruna', 'Brazil', { mockupStatus: 'ready', mockupReadyAt: S.shift(-2), nextFollowUp: S.shift(5) });
  mk('Derek Quarles', 'frank', '', { mockupStatus: 'hold', mockupReadyAt: S.shift(-3), nextFollowUp: S.shift(5) });

  const names = list => list.map(l => l.name).sort().join(', ');

  console.log('\n-- a rep');
  S.setMe('josh');
  ok('the follow-up queue is his own leads only',
     names(S.leadsNeedingAttention()) === 'Laura Zafonte', names(S.leadsNeedingAttention()));
  ok('  not Frank\'s', !S.leadsNeedingAttention().some(l => l.id === franks.id));
  ok('  and not another branch\'s', !S.leadsNeedingAttention().some(l => l.id === brunas.id));
  ok('the counters count his book', S.leadStats().open === 2, S.leadStats().open);
  ok('mockups ready to send are his', names(S.mockupsReadyToSend()) === 'Mary Ann DeAlto',
     names(S.mockupsReadyToSend()));
  ok('and so is the on-hold pile', !S.mockupsOnHold().length, names(S.mockupsOnHold()));

  console.log('\n-- a branch manager');
  S.setMe('cassius');
  ok('sees his branch, including his rep\'s',
     names(S.leadsNeedingAttention()) === 'Boni Restaurante', names(S.leadsNeedingAttention()));
  ok('and no US lead at all', !S.leadsNeedingAttention().some(l => (l.branch || '') === ''));
  ok('the mockup card is his branch too', names(S.mockupsReadyToSend()) === 'Cris Hotel',
     names(S.mockupsReadyToSend()));

  console.log('\n-- an admin');
  S.setMe('alex');
  ok('sees everyone, which is the job', S.leadsNeedingAttention().length === 3,
     names(S.leadsNeedingAttention()));
  ok('counts every open lead', S.leadStats().open === 6, S.leadStats().open);
  ok('and every mockup waiting to go out', S.mockupsReadyToSend().length === 2,
     names(S.mockupsReadyToSend()));
  ok('including the held one', S.mockupsOnHold().length === 1, names(S.mockupsOnHold()));

  console.log('\n-- asking for one person still works');
  ok('narrowing to a rep by hand', names(S.leadsNeedingAttention('josh')) === 'Laura Zafonte',
     names(S.leadsNeedingAttention('josh')));
  ok('and it is the same lead the rep saw', S.leadsNeedingAttention('josh')[0].id === joshs.id);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
