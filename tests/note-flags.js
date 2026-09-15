/* The note icon on the leads list: only for notes a person left.

   Nearly every imported lead arrives with a note - "From the realtor contact
   list", a walk-in's description - so "has any note" would flag almost every
   row and tell nobody anything. Import notes are written in the same moment
   as the lead, so that is the line: a note within two minutes of the lead
   being created is part of the import, anything later is somebody's. */
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
const ago = mins => new Date(Date.now() - mins * 60000).toISOString();

(async () => {
  await S.boot();
  S.removeMany('leads', S.all('leads').map(l => l.id));
  const born = ago(60 * 24);
  const mk = name => S.insert('leads', { name, leadStatus: 'new', rating: 'warm', ownerId: S.me().id,
    branch: '', tags: [], createdAt: born }, 'l', name);

  const imported = mk('Imported only');
  const called = mk('Called twice');
  const silent = mk('No notes');

  S.insertMany('notes', [imported, called].map(l => ({
    entityType: 'lead', entityId: l.id, authorId: S.me().id, pinned: false,
    body: 'From the realtor contact list. No site listed.', createdAt: ago(60 * 24 - 0.5)
  })), 'n', 'import notes');
  S.insertMany('notes', [
    { entityType: 'lead', entityId: called.id, authorId: S.me().id, pinned: false,
      body: 'Left a voicemail.', createdAt: ago(60 * 5) },
    { entityType: 'lead', entityId: called.id, authorId: S.me().id, pinned: false,
      body: 'Spoke to her - wants a mockup of the listing page.', createdAt: ago(30) }
  ], 'n', 'call notes');

  const flags = S.leadNoteFlags();
  console.log('\n-- which leads get the icon');
  ok('a lead with only its import note gets none', !flags[imported.id], JSON.stringify(flags[imported.id]));
  ok('a lead with no notes gets none', !flags[silent.id]);
  ok('a lead someone wrote on gets one', !!flags[called.id]);
  ok('counting only the notes a person wrote', flags[called.id].count === 2, flags[called.id].count);
  ok('with the newest as the one to show', /wants a mockup/.test(flags[called.id].latest.body),
     flags[called.id].latest.body);

  console.log('\n-- a note added today, the ordinary way');
  S.addNote('lead', imported.id, 'Gatekeeper said call back after 2.');
  ok('flags a lead that only had its import note before', !!S.leadNoteFlags()[imported.id]);

  console.log('\n-- a lead with no creation time recorded');
  const old = S.insert('leads', { name: 'Old record', leadStatus: 'new', ownerId: S.me().id, tags: [], branch: '' }, 'l', 'Old');
  S.find('leads', old.id).createdAt = '';
  S.addNote('lead', old.id, 'Anything.');
  ok('is not hidden just because the time is unknown', !!S.leadNoteFlags()[old.id]);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
