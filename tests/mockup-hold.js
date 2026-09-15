/* Holding a finished mockup back on purpose.

   "Mockups Ready To Send" is a nag, and it should be: a mockup built and
   never sent is an afternoon thrown away. But some are held deliberately -
   the wrong week, waiting on a decision, saved for a walk-in - and a nag
   about something you chose to wait on is noise that teaches people to stop
   reading the card. "On hold" takes a mockup off the card without losing
   anything about it, and puts it back just as easily. */
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
const URL = 'https://thinkfirststudios.github.io/brazil-leads-mockups/casa-mare-floripa/';

(async () => {
  await S.boot();
  S.removeMany('leads', S.all('leads').map(l => l.id));
  const mk = (name, extra) => S.insert('leads', Object.assign({
    name, leadStatus: 'contacted', rating: 'warm', ownerId: S.me().id, branch: '', tags: [],
    nextFollowUp: S.shift(3), mockupStatus: 'ready', mockupUrl: URL, mockupTypes: ['Website'],
    mockupReadyAt: S.shift(-6), mockupSentAt: ''
  }, extra || {}), 'l', name);

  const casa = mk('Casa Mare Floripa');
  const cris = mk('Cris Hotel');
  const dead = mk('A Baleeira', { leadStatus: 'dead', mockupStatus: 'hold' });

  console.log('\n-- it is a real status');
  ok('offered wherever mockup statuses are - the filter, the dialog',
     S.MOCKUP_STATUSES.some(x => x.id === 'hold' && x.label === 'On hold'));
  ok('counts as built, not sent', S.mockupStatus('hold').made && !S.mockupStatus('hold').sent);

  console.log('\n-- holding one');
  ok('both start on the ready card', S.mockupsReadyToSend().length === 2, S.mockupsReadyToSend().length);
  S.setMockup(casa.id, { mockupStatus: 'hold' });
  const held = S.find('leads', casa.id);
  ok('it leaves the ready card', !S.mockupsReadyToSend().some(l => l.id === casa.id));
  ok('the other stays', S.mockupsReadyToSend().some(l => l.id === cris.id));
  ok('and it is listed as on hold', S.mockupsOnHold().some(l => l.id === casa.id));
  ok('nothing about the mockup is lost: the link', held.mockupUrl === URL, held.mockupUrl);
  ok('  what was built', held.mockupTypes.join() === 'Website', held.mockupTypes.join());
  ok('  and when it was finished', held.mockupReadyAt === S.shift(-6), held.mockupReadyAt);
  ok('it does not nag as stale while held, however old',
     !S.mockupState(held).stale && S.mockupState(held).waiting === null);

  console.log('\n-- what it stays out of');
  ok('a held mockup on a dead lead is not listed at all', !S.mockupsOnHold().some(l => l.id === dead.id));
  S.setMockupsMany([{ id: casa.id, url: URL + '?v=2' }], 'reattached');
  ok('re-attaching a link does not quietly put it back on the ready card',
     S.find('leads', casa.id).mockupStatus === 'hold', S.find('leads', casa.id).mockupStatus);
  const stats = S.mockupStats();
  ok('the numbers count it', stats.hold === 1, stats.hold);
  ok('and still add up - nothing reads NaN', [stats.none, stats.inprogress, stats.ready, stats.hold, stats.sent]
       .every(n => typeof n === 'number' && !isNaN(n)), JSON.stringify(stats));

  console.log('\n-- taking it off hold');
  S.setMockup(casa.id, { mockupStatus: 'ready' });
  const back = S.find('leads', casa.id);
  ok('it is back on the ready card', S.mockupsReadyToSend().some(l => l.id === casa.id));
  ok('and off the hold list', !S.mockupsOnHold().some(l => l.id === casa.id));
  ok('its wait is still counted from when it was actually finished',
     back.mockupReadyAt === S.shift(-6) && S.mockupState(back).stale, back.mockupReadyAt);

  console.log('\n-- sending straight from hold');
  S.setMockup(cris.id, { mockupStatus: 'hold' });
  S.setMockup(cris.id, { mockupStatus: 'sent' });
  const sent = S.find('leads', cris.id);
  ok('works, and stamps the send', sent.mockupStatus === 'sent' && sent.mockupSentAt === S.today(),
     sent.mockupStatus + ' ' + sent.mockupSentAt);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
