/* A rep may not hand a record to somebody else.

   Reps got their own name instead of a picker on the leads form, but every
   other object - accounts, contacts, opportunities, vendors, outreach - had
   a free <select> listing the whole team. This suite covers the shared
   field they all go through now, and the last assertion is the one that
   matters longest: it reads the source and fails if a new screen grows an
   owner <select> of its own. */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'js') + '/';
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
  CRM_CONFIG: { supabase: { url: '', anonKey: '' } },
  console, document: { createElement: () => ({ style: {} }) }
};
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
new Function('window', read('ui.js'))(win);
const S = win.Store, U = win.UI;

const team = [
  { id: 'alex',    name: 'Alex Herrman',  role: 'admin',   active: true, branch: '' },
  { id: 'frank',   name: 'Frank Stewart', role: 'rep',     active: true, branch: '' },
  { id: 'jason',   name: 'Jason Beckman', role: 'rep',     active: true, branch: '' },
  { id: 'cassius', name: 'Cassius Alves', role: 'manager', active: true, branch: 'Brazil' },
  { id: 'bruna',   name: 'Bruna Lima',    role: 'rep',     active: true, branch: 'Brazil' }
];

const ownerOf = html => (html.match(/name="ownerId" value="([^"]*)"/) || [])[1];
const picks = html => (html.match(/<option value="([^"]*)"/g) || []).map(m => m.slice(15, -1));

(async () => {
  await S.boot();
  team.forEach(u => { if (!S.find('users', u.id)) S.insert('users', u, 'u', u.name); });

  console.log('\n-- an admin still picks anybody');
  S.setMe('alex');
  let h = U.ownerField('Owner', 'frank');
  ok('gets a select', h.indexOf('<select') > -1);
  ok('with the whole team in it',
     ['alex', 'frank', 'jason', 'cassius', 'bruna'].every(id => picks(h).indexOf(id) > -1),
     picks(h).join(','));
  ok('and the record’s owner preselected', h.indexOf('value="frank" selected') > -1);

  console.log('\n-- a rep gets a name, not a picker');
  S.setMe('frank');
  h = U.ownerField('Owner', 'frank');
  ok('no select at all', h.indexOf('<select') < 0);
  ok('the value is himself', ownerOf(h) === 'frank', ownerOf(h));
  ok('and it says so', h.indexOf('stay yours') > -1);

  console.log('\n-- and a new record defaults to him');
  h = U.ownerField('Owner', '');
  ok('owner is the rep', ownerOf(h) === 'frank', ownerOf(h));

  console.log('\n-- a rep opening somebody else’s record does not take it over');
  /* The hidden field carries the CURRENT owner. Sending his own id here
     would mean a rep reassigns a teammate's account by pressing Save on a
     form they only opened to read. */
  h = U.ownerField('Account Owner', 'jason');
  ok('the hidden value is still Jason', ownerOf(h) === 'jason', ownerOf(h));
  ok('and it is shown as Jason’s', h.indexOf('Jason Beckman') > -1);
  ok('with no way to change it', h.indexOf('<select') < 0);

  console.log('\n-- a manager is held to their branch');
  S.setMe('cassius');
  h = U.ownerField('Owner', 'bruna');
  ok('offers his own branch', picks(h).indexOf('bruna') > -1);
  ok('and nobody from the US', !picks(h).some(id => ['frank', 'jason'].indexOf(id) > -1),
     picks(h).join(','));

  console.log('\n-- but an out-of-branch owner is never dropped silently');
  /* A name missing from the <select> is a reassignment on the next save:
     the browser would post whichever option happened to be first. */
  h = U.ownerField('Owner', 'jason');
  ok('Jason is added back', picks(h).indexOf('jason') > -1, picks(h).join(','));
  ok('and stays selected', h.indexOf('value="jason" selected') > -1);

  console.log('\n-- every owner picker goes through the shared field');
  const views = fs.readdirSync(DIR + 'views');
  const stray = [];
  views.forEach(f => {
    const src = fs.readFileSync(DIR + 'views/' + f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/<select[^>]*name="ownerId"/.test(line)) stray.push(f + ':' + (i + 1));
    });
  });
  ok('no view builds its own owner select', stray.length === 0, stray.join(', '));

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
