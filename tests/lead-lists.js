/* Lists of leads, and how far through each one you are.
 *
 *   node tests/lead-lists.js
 *
 * A batch arrives, gets imported under a name, and then has to be found
 * again. The source has always been on the lead; what was missing was any
 * way to see that you HAVE four lists, that one is finished and another has
 * not been started. The counts are the whole point, so they have to be
 * right - and right per person, because a rep must never be shown the
 * team's progress as though it were their own.
 *
 * Local mode, like dashboard-scope.js: there is no database filtering here,
 * so anything that comes out scoped was scoped by the code being tested
 * rather than by RLS doing it invisibly.
 */
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

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  await S.boot();
  S.removeMany('leads', S.all('leads').map(l => l.id));
  [{ id: 'alex', name: 'Alex Herrman', role: 'admin', active: true, branch: '' },
   { id: 'josh', name: 'Josh', role: 'rep', active: true, branch: '' },
   { id: 'cass', name: 'Cassius', role: 'rep', active: true, branch: '' }]
    .forEach(u => { if (!S.find('users', u.id)) S.insert('users', u, 'u', u.name); });

  const mk = (source, owner, o) => {
    o = o || {};
    return S.insert('leads', {
      name: 'Lead ' + Math.random().toString(36).slice(2, 8), source: source, ownerId: owner,
      lastContactedAt: o.called || '', nextFollowUp: o.due || '',
      leadStatus: o.status || 'working', branch: '', tags: [], rating: 'warm',
      mockupStatus: 'none', createdAt: (o.added || day(-5)) + 'T09:00:00.000Z'
    }, 'l', 'seed');
  };

  /* Two lists for Josh. The mortgage one arrived today and is untouched;
     the realtor one is older and half worked, with one overdue. */
  mk('Texas Mortgage LOs', 'josh', { added: day(0) });
  mk('Texas Mortgage LOs', 'josh', { added: day(0) });
  mk('Texas Mortgage LOs', 'josh', { added: day(0) });
  mk('Realtor List', 'josh', { added: day(-30), called: day(-2) });
  mk('Realtor List', 'josh', { added: day(-30), called: day(-3), due: day(-1) });
  mk('Realtor List', 'josh', { added: day(-30) });
  /* A closed lead with an old due date must not count as overdue - nobody
     is waiting on it. */
  mk('Realtor List', 'josh', { added: day(-30), due: day(-9), status: 'converted' });
  /* Somebody else's list entirely. */
  mk('Walk-ins', 'cass', { added: day(-10) });
  /* And one imported with no source at all. */
  mk('', 'josh', { added: day(-40) });

  S.setMe('alex');
  console.log('\nas an admin, who sees everyone');
  let lists = S.leadLists();
  let byName = s => lists.filter(l => l.source === s)[0];
  ok('every list appears', lists.length === 4, lists.map(l => l.source).join(' | '));
  ok('the newest list is first', lists[0].source === 'Texas Mortgage LOs', lists[0].source);
  ok('a lead with no source is still findable', !!byName('No list'));
  ok('  and is not counted under a real list', byName('No list').total === 1);

  console.log('\nthe counts');
  ok('total', byName('Realtor List').total === 4, byName('Realtor List').total);
  ok('called', byName('Realtor List').called === 2, byName('Realtor List').called);
  ok('left to call', byName('Realtor List').uncalled === 2, byName('Realtor List').uncalled);
  ok('overdue', byName('Realtor List').overdue === 1, byName('Realtor List').overdue);
  ok('  a converted lead with an old date is not overdue',
     byName('Realtor List').overdue !== 2, byName('Realtor List').overdue);
  ok('a fresh list is all still to call',
     byName('Texas Mortgage LOs').uncalled === 3 && byName('Texas Mortgage LOs').called === 0,
     byName('Texas Mortgage LOs').uncalled + '/' + byName('Texas Mortgage LOs').called);
  ok("another rep's list is visible to an admin", !!byName('Walk-ins'));
  ok('  which the admin does not own', byName('Walk-ins').mine === 0, byName('Walk-ins').mine);

  console.log('\nas the rep, who sees only their own');
  S.setMe('josh');
  lists = S.leadLists();
  ok("somebody else's list is gone", !byName('Walk-ins'), lists.map(l => l.source).join(' | '));
  ok('their own lists remain', lists.length === 3, lists.length);
  ok('the numbers are unchanged', byName('Realtor List').total === 4);
  ok('  and mine matches total, because a rep owns all they see',
     byName('Realtor List').mine === 4, byName('Realtor List').mine);

  console.log('\nthe other rep');
  S.setMe('cass');
  lists = S.leadLists();
  ok('sees only their own list', lists.length === 1 && lists[0].source === 'Walk-ins',
     lists.map(l => l.source).join(' | '));

  console.log('\nnothing to choose between');
  S.setMe('alex');
  S.removeMany('leads', S.all('leads').map(l => l.id));
  mk('Only List', 'josh', {});
  ok('one list is still reported', S.leadLists().length === 1);
  S.removeMany('leads', S.all('leads').map(l => l.id));
  ok('no leads means no lists', S.leadLists().length === 0);

  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
