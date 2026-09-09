/* A lead has to carry its branch out of the form.

   branches.sql put a branch on every lead, and the leads form set one on
   its default object — but the form had no branch input, and UI.values()
   only collects named inputs. So a lead added by hand saved with no branch
   at all, which reads as the blank branch: the US. A manager in Brazil
   would file a lead in the office they cannot see, and never find it.

   The field is on the form now even where nobody may change it, hidden for
   anyone but an admin. These assertions are mostly about that: the value
   travels whether or not there is anything on screen. */
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
  { id: 'cassius', name: 'Cassius Alves', role: 'manager', active: true, branch: 'Brazil' },
  { id: 'bruna',   name: 'Bruna Lima',    role: 'rep',     active: true, branch: 'Brazil' }
];

/* What UI.values() would collect: every [name] in the markup. Hidden
   inputs count, which is the whole point of the fix. */
const valueOf = html => (html.match(/name="branch" value="([^"]*)"/) || [])[1];

(async () => {
  await S.boot();
  team.forEach(u => { if (!S.find('users', u.id)) S.insert('users', u, 'u', u.name); });

  console.log('\n-- the field is always on the form, visible or not');
  S.setMe('cassius');
  let h = U.branchField('Branch', 'Brazil');
  ok('a manager gets a named input', h.indexOf('name="branch"') > -1);
  ok('carrying his own branch', valueOf(h) === 'Brazil', valueOf(h));
  ok('with nothing to decide on screen', h.indexOf('<label') < 0);

  S.setMe('bruna');
  h = U.branchField('Branch', '');
  ok('a rep carries hers too', valueOf(h) === 'Brazil', valueOf(h));

  S.setMe('frank');
  h = U.branchField('Branch', '');
  ok('and a US rep carries the blank branch', valueOf(h) === '', JSON.stringify(valueOf(h)));

  console.log('\n-- an admin chooses, because they have no branch to inherit');
  S.setMe('alex');
  h = U.branchField('Branch', '');
  ok('gets a real field', h.indexOf('<label>Branch</label>') > -1);
  ok('offering the branches in use', h.indexOf('<option value="Brazil">') > -1, h.indexOf('Brazil'));
  ok('and may still leave it blank', h.indexOf('value=""') > -1);
  h = U.branchField('Branch', 'Brazil');
  ok('an existing branch is preselected', h.indexOf('name="branch" list="branchPickOptions" value="Brazil"') > -1);

  console.log('\n-- one spelling per branch');
  /* Two spellings are two territories that cannot see each other, and the
     symptom is a manager staring at an empty list. */
  ok('brazil becomes Brazil', S.normalizeBranch('brazil') === 'Brazil', S.normalizeBranch('brazil'));
  ok('BRAZIL too', S.normalizeBranch('BRAZIL') === 'Brazil', S.normalizeBranch('BRAZIL'));
  ok('and stray spacing is trimmed', S.normalizeBranch('  Brazil ') === 'Brazil', JSON.stringify(S.normalizeBranch('  Brazil ')));
  ok('a genuinely new branch is kept as typed', S.normalizeBranch('Portugal') === 'Portugal');
  ok('blank stays blank', S.normalizeBranch('') === '' && S.normalizeBranch(null) === '');

  console.log('\n-- the form actually includes it');
  /* The bug was not in the helper, it was that no form called one. */
  const leads = read('views/leads.js');
  ok('the lead form has a branch field',
     (leads.match(/U\.branchField\('Branch',/g) || []).length === 2,
     (leads.match(/U\.branchField\('Branch',/g) || []).length);
  ok('so does the importer', leads.indexOf("U.branchField('Branch for imported leads')") > -1);
  ok('and the import uses what was chosen', leads.indexOf('branch: opts.branch,') > -1);
  ok('the lead form settles the spelling', leads.indexOf('v.branch = S.normalizeBranch(v.branch);') > -1);
  ok('the importer settles it too',
     (leads.match(/normalizeBranch\(v\.branch\)/g) || []).length === 2,
     (leads.match(/normalizeBranch\(v\.branch\)/g) || []).length);
  ok('and so does the user form',
     read('views/admin.js').indexOf('S.normalizeBranch(v.branch)') > -1);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
