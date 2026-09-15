/* The work queue: what the reps have asked for, oldest ask first.

   Alex and Jason needed one place answering "what work is waiting on us",
   built out of what the reps already put in. The piece that was missing was
   the ask itself: "in progress" meant somebody was building it, so a request
   nobody had picked up looked identical to one half finished - and the one
   nobody has picked up is the one that quietly ages into a lost deal. */
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
   { id: 'cassius', name: 'Cassius Lee Hall', role: 'manager', active: true, branch: 'Brazil' },
   { id: 'bruna', name: 'Bruna Lima', role: 'rep', active: true, branch: 'Brazil' }]
    .forEach(u => { if (!S.find('users', u.id)) S.insert('users', u, 'u', u.name); });

  const mk = (name, owner, branch, extra) => S.insert('leads', Object.assign({
    name, leadStatus: 'contacted', rating: 'warm', ownerId: owner, branch: branch, tags: [],
    nextFollowUp: S.shift(3), mockupStatus: 'none', mockupTypes: [], mockupUrl: '',
    mockupDesignUrl: '', mockupRequestedAt: '', mockupReadyAt: '', mockupSentAt: ''
  }, extra || {}), 'l', name);

  console.log('\n-- a rep asks for work');
  S.setMe('josh');
  const laura = mk('Laura Zafonte', 'josh', '');
  S.setMockup(laura.id, { mockupStatus: 'requested', mockupTypes: ['Website', 'Logo'],
                          note: 'Wants a one-page site and a logo.' });
  let l = S.find('leads', laura.id);
  ok('the lead reads as Requested', l.mockupStatus === 'requested', l.mockupStatus);
  ok('stamped with the day it was asked', l.mockupRequestedAt === S.today(), l.mockupRequestedAt);
  ok('it is waiting on us, not built', !S.mockupStatus('requested').made);
  ok('the brief is kept as a note on the lead',
     S.notesFor('lead', laura.id).some(n => /one-page site/.test(n.body)));
  ok('and it is not on the ready-to-send card', !S.mockupsReadyToSend().some(x => x.id === laura.id));

  console.log('\n-- the queue');
  const derek = mk('Derek Quarles', 'josh', '', { mockupStatus: 'requested', mockupRequestedAt: S.shift(-4) });
  const aziz = mk('Aziz Seyal', 'josh', '', { mockupStatus: 'inprogress', mockupRequestedAt: S.shift(-9) });
  mk('Nobody Asked', 'josh', '');
  S.setMe('alex');
  let q = S.mockupQueue();
  ok('lists what was asked for and what is being built',
     q.map(x => x.name).join(', ') === 'Derek Quarles, Laura Zafonte, Aziz Seyal',
     q.map(x => x.name + '/' + x.mockupStatus).join(', '));
  ok('  requests come before work already under way', q[0].mockupStatus === 'requested');
  ok('  and the oldest ask is first', q[0].name === 'Derek Quarles');
  ok('  a lead nobody asked about is not on it', !q.some(x => x.name === 'Nobody Asked'));

  console.log('\n-- picking one up, and finishing it');
  S.setMockup(derek.id, { mockupStatus: 'inprogress' });
  ok('starting it moves it down the queue', S.mockupQueue()[0].name !== 'Derek Quarles');
  ok('  and the ask date is kept, so the wait is from the ask',
     S.find('leads', derek.id).mockupRequestedAt === S.shift(-4),
     S.find('leads', derek.id).mockupRequestedAt);
  S.setMockup(derek.id, { mockupStatus: 'ready', mockupUrl: 'https://example.com/derek/' });
  ok('marking it ready takes it off the queue', !S.mockupQueue().some(x => x.id === derek.id));
  ok('  and puts it on the ready-to-send card', S.mockupsReadyToSend().some(x => x.id === derek.id));

  console.log('\n-- who sees which queue');
  const bruna = mk('Pousada Ilha da Magia', 'bruna', 'Brazil', { mockupStatus: 'requested', mockupRequestedAt: S.today() });
  S.setMe('cassius');
  ok('a branch manager sees their own branch only',
     S.mockupQueue().map(x => x.name).join() === 'Pousada Ilha da Magia',
     S.mockupQueue().map(x => x.name).join());
  S.setMe('alex');
  ok('an admin sees every branch', S.mockupQueue().some(x => x.id === bruna.id) &&
     S.mockupQueue().some(x => x.id === laura.id));
  S.setMe('josh');
  ok('a rep sees only their own asks', !S.mockupQueue().some(x => x.id === bruna.id));

  console.log('\n-- a closed lead stops asking for work');
  S.setMe('alex');
  S.update('leads', laura.id, { leadStatus: 'dead' }, 'dead');
  ok('a dead lead drops off the queue', !S.mockupQueue().some(x => x.id === laura.id));

  console.log('\n-- the counts');
  const stats = S.mockupStats();
  ok('requested is counted', typeof stats.requested === 'number' && !isNaN(stats.requested), stats.requested);
  ok('and nothing reads NaN', [stats.none, stats.requested, stats.inprogress, stats.ready, stats.hold, stats.sent]
       .every(n => typeof n === 'number' && !isNaN(n)), JSON.stringify(stats));

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
