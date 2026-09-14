/* Call backs: a rep's list of calls they have booked, with what to say.

   Asked for by a rep who books people a few days out and wanted one place
   to see them. The follow-up date already says when; the call back adds the
   time agreed and the reminder, and a list that shows everything booked
   rather than only what is due today.

   The rules that matter are the ones that stop the list lying: one call back
   per lead, so booking again moves it instead of stacking a second reminder
   to ring the same person; logging the call clears it; and a rep sees their
   own calls and nobody else's. */
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
   { id: 'frank', name: 'Frank Stewart', role: 'rep', active: true, branch: '' }]
    .forEach(u => { if (!S.find('users', u.id)) S.insert('users', u, 'u', u.name); });

  const mk = (name, owner) => S.insert('leads', {
    name, contactName: name, phone: '(201) 555-0100', leadStatus: 'contacted', rating: 'warm',
    ownerId: owner, branch: '', tags: [], nextFollowUp: '', mockupStatus: 'none'
  }, 'l', name);
  const laura = mk('Laura Zafonte', 'josh');
  const derek = mk('Derek Quarles', 'josh');
  const fran = mk('Frances Kosier', 'frank');

  console.log('\n-- booking a call back');
  S.setMe('josh');
  const t = S.scheduleCallback(laura.id, { date: S.shift(3), time: '15:00',
    reminder: 'Wants pricing on the 3-bed. Call after 3.' });
  ok('it is a task linked to the lead', t && t.entityType === 'lead' && t.entityId === laura.id);
  ok('of its own kind, not a logged call', t.kind === 'callback', t.kind);
  ok('and it is still to do', t.status === 'open', t.status);
  ok('with the time', t.startTime === '15:00', t.startTime);
  ok('and the reminder', t.description.indexOf('3-bed') > -1, t.description);
  ok('the follow-up date moves to match', S.find('leads', laura.id).nextFollowUp === S.shift(3),
     S.find('leads', laura.id).nextFollowUp);
  ok('it reads as "Call back" in Activities, not "Task"', S.taskKind('callback').label === 'Call back',
     S.taskKind('callback').label);
  ok('without adding a "new call back" button there, where it would have no lead',
     !S.TASK_KINDS.some(k => k.id === 'callback'));

  console.log('\n-- one per lead');
  S.scheduleCallback(laura.id, { date: S.shift(5), time: '10:30', reminder: 'Moved to Monday.' });
  const lauras = S.all('tasks').filter(x => x.kind === 'callback' && x.entityId === laura.id && x.status === 'open');
  ok('booking again moves it rather than adding a second', lauras.length === 1, lauras.length);
  ok('to the new day', lauras[0].dueDate === S.shift(5), lauras[0].dueDate);
  ok('with the new time and reminder', lauras[0].startTime === '10:30' && /Monday/.test(lauras[0].description));

  console.log('\n-- the list');
  S.scheduleCallback(derek.id, { date: S.shift(1), reminder: 'Left a voicemail, try the office line.' });
  let list = S.callbacks();
  ok('soonest first', list.map(c => c.lead.name).join(',') === 'Derek Quarles,Laura Zafonte',
     list.map(c => c.lead.name).join(','));
  ok('each row carries its lead', list.every(c => c.lead && c.lead.phone));

  S.setMe('frank');
  S.scheduleCallback(fran.id, { date: S.shift(2) });
  ok('Frank sees only his own', S.callbacks().map(c => c.lead.name).join(',') === 'Frances Kosier',
     S.callbacks().map(c => c.lead.name).join(','));
  S.setMe('josh');
  ok('and Josh never sees Frank\'s', !S.callbacks().some(c => c.lead.id === fran.id));
  S.setMe('alex');
  ok('an admin sees everyone\'s', S.callbacks().length === 3, S.callbacks().length);

  S.setMe('alex');
  S.scheduleCallback(derek.id, { date: S.shift(1), reminder: 'Booked by Alex for Josh.' });
  const dk = S.callbackFor(derek.id);
  ok('booked by an admin, it lands on the lead owner\'s list', dk.assigneeId === 'josh', dk.assigneeId);

  console.log('\n-- logging the call clears it');
  S.setMe('josh');
  /* Due tomorrow, called today: not due yet, so the booking stands. */
  S.logContact(derek.id, { note: 'Picked up early, still wants the call tomorrow.', date: S.today(),
                           nextFollowUp: S.shift(1) });
  ok('a call back not yet due survives an early contact', !!S.callbackFor(derek.id));

  /* Due today, called today: that was the call. */
  S.scheduleCallback(derek.id, { date: S.today(), reminder: 'Today.' });
  S.logContact(derek.id, { note: 'Spoke to Derek, sending the mockup.', date: S.today(),
                           nextFollowUp: S.shift(7) });
  ok('a call back that was due is cleared by logging the call', !S.callbackFor(derek.id));
  ok('and leaves the list', !S.callbacks().some(c => c.lead.id === derek.id));
  const done = S.all('tasks').filter(x => x.kind === 'callback' && x.entityId === derek.id && x.status === 'completed');
  ok('kept as done, not deleted', done.length === 1, done.length);

  console.log('\n-- booking a new one on that same call');
  /* The view calls logContact first and scheduleCallback second. The other
     order would clear the one just booked. */
  S.scheduleCallback(derek.id, { date: S.today(), reminder: 'old' });
  S.logContact(derek.id, { note: 'Call me Thursday', date: S.today(), nextFollowUp: S.shift(3) });
  S.scheduleCallback(derek.id, { date: S.shift(3), time: '09:00', reminder: 'Thursday, 9am.' });
  const next = S.callbackFor(derek.id);
  ok('the new booking stands', next && next.dueDate === S.shift(3) && next.startTime === '09:00',
     next && next.dueDate);

  console.log('\n-- clearing one by hand');
  S.completeTask(S.callbackFor(laura.id).id, true);
  ok('Done takes it off the list', !S.callbacks().some(c => c.lead.id === laura.id));

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
