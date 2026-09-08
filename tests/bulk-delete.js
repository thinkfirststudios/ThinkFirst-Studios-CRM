/* Deleting leads in bulk, and taking their notes with them.

   This is the one action with no undo, so the things worth pinning are the
   ones that would be discovered too late: that the selection is respected
   exactly, that a lead's notes go with it rather than becoming orphans in
   the totals, and that nothing else in the database is touched. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [], activity: [],
  outreach: [], outreach_groups: [], statuses: [], vendor_types: [],
  settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};

/* Record what the backend is asked to do, so "one request per chunk" can be
   asserted rather than hoped for. */
const calls = { deletes: [], upserts: [] };
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({
    select: () => thenable({ data: rows[t] || [], error: null }),
    upsert: b => { calls.upserts.push({ table: t, n: [].concat(b).length }); return thenable({ error: null }); },
    insert: () => thenable({ error: null }),
    delete: () => ({
      eq: (col, v) => { calls.deletes.push({ table: t, kind: 'eq', ids: [v] }); return thenable({ error: null }); },
      in: (col, v) => { calls.deletes.push({ table: t, kind: 'in', ids: v }); return thenable({ error: null }); },
      neq: () => thenable({ error: null })
    })
  }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

const mk = (name, phone, email) => S.insert('leads', {
  name, contactName: name, contactTitle: 'Realtor', phone: phone, email: email,
  leadStatus: 'new', rating: 'cold', ownerId: 'u', estValue: 0,
  nextFollowUp: '', lastContactedAt: '', tags: ['realtor'], source: 'Realtor List',
  convertedCustomerId: '', convertedAt: ''
}, 'l', name);

(async () => {
  await S.boot();

  const keep = [], drop = [];
  for (let i = 0; i < 40; i++) {
    const l = mk('Has Phone ' + i, '(555) 555-' + (1000 + i), 'keep' + i + '@example.com');
    S.addNote('lead', l.id, 'note for ' + l.name);
    keep.push(l);
  }
  for (let i = 0; i < 25; i++) {
    const l = mk('No Phone ' + i, '', 'drop' + i + '@example.com');
    S.addNote('lead', l.id, 'note for ' + l.name);
    drop.push(l);
  }
  /* Somebody else's note, on a lead nobody is deleting. */
  const bystander = mk('Bystander', '(555) 999-0000', 'by@example.com');
  S.addNote('lead', bystander.id, 'must survive');

  console.log('\n-- finding the ones with no phone');
  const noPhone = S.all('leads').filter(l => !l.phone);
  ok('there are 25 of them', noPhone.length === 25, noPhone.length);
  ok('all of them still have an email', noPhone.every(l => l.email));

  console.log('\n-- a lead now declares its notes as children');
  const kids = S.childrenOf('leads', drop[0].id);
  const noteGroup = kids.filter(g => g.coll === 'notes')[0];
  ok('childrenOf reports the note', !!noteGroup && noteGroup.rows.length === 1,
     noteGroup && noteGroup.rows.length);

  console.log('\n-- deleting them');
  calls.deletes = [];
  const leadsBefore = S.all('leads').length;
  const notesBefore = S.all('notes').length;
  const actsBefore = S.all('activity').length;

  const removed = S.removeMany('leads', noPhone.map(l => l.id));

  ok('it reports 25 removed', removed === 25, removed);
  ok('the leads are gone', S.all('leads').length === leadsBefore - 25, S.all('leads').length);
  ok('their notes went with them', S.all('notes').length === notesBefore - 25,
     S.all('notes').length - (notesBefore - 25));
  ok('no orphaned notes were left behind',
     S.all('notes').every(n => n.entityType !== 'lead' || !!S.find('leads', n.entityId)),
     S.all('notes').filter(n => n.entityType === 'lead' && !S.find('leads', n.entityId)).length);

  console.log('\n-- and nothing else was touched');
  ok('every lead with a phone survives',
     keep.every(l => !!S.find('leads', l.id)),
     keep.filter(l => !S.find('leads', l.id)).length + ' lost');
  ok('their notes survive too',
     keep.every(l => S.notesFor('lead', l.id).length === 1));
  ok('the bystander is untouched', !!S.find('leads', bystander.id));
  ok('and keeps its note', S.notesFor('lead', bystander.id).length === 1);

  console.log('\n-- it batches, and logs once');
  ok('one activity entry, not 25', S.all('activity').length - actsBefore === 1,
     S.all('activity').length - actsBefore);
  const leadDeletes = calls.deletes.filter(c => c.table === 'leads');
  const noteDeletes = calls.deletes.filter(c => c.table === 'notes');
  ok('one request for the leads', leadDeletes.length === 1, leadDeletes.length);
  ok('carrying all 25 ids', leadDeletes[0] && leadDeletes[0].ids.length === 25,
     leadDeletes[0] && leadDeletes[0].ids.length);
  ok('one request for the notes', noteDeletes.length === 1, noteDeletes.length);
  ok('and it used a single "in" query, not 25 "eq" ones',
     calls.deletes.every(c => c.kind === 'in'),
     calls.deletes.filter(c => c.kind === 'eq').length + ' eq calls');

  console.log('\n-- the audit line says what went');
  const last = S.all('activity')[0];
  ok('it names the count', /25 records removed in bulk/.test(last.detail || ''), last.detail);
  ok('and mentions the notes', /notes/.test(last.detail || ''), last.detail);

  console.log('\n-- edge cases');
  ok('an empty selection deletes nothing', S.removeMany('leads', []) === 0);
  const before = S.all('leads').length;
  ok('unknown ids delete nothing', S.removeMany('leads', ['nope-1']) === 0);
  ok('and leave the database alone', S.all('leads').length === before, S.all('leads').length);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
