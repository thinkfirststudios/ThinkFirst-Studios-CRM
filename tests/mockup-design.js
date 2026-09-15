/* A second mockup link: website and graphic design, side by side.

   A lead held one mockup link, which was fine while every mockup was a
   website. Once design work is pitched too, the second link had nowhere to
   go but on top of the first. The rules that matter: each kind keeps its own
   link, a batch of one kind never overwrites the other, the "what did you
   build" ticks follow the links, and until the database can hold the design
   link nobody is offered a field that would silently not save. */
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

const SITE = 'https://thinkfirststudios.github.io/tfs-lead-previews/laura-zafonte/';
const DESIGN = 'https://www.canva.com/design/laura-zafonte-flyer/';

(async () => {
  await S.boot();
  S.removeMany('leads', S.all('leads').map(l => l.id));
  const mk = (name, extra) => S.insert('leads', Object.assign({
    name, leadStatus: 'contacted', rating: 'warm', ownerId: S.me().id, branch: '', tags: [],
    nextFollowUp: S.shift(3), mockupStatus: 'none', mockupUrl: '', mockupDesignUrl: '',
    mockupTypes: [], mockupReadyAt: '', mockupSentAt: ''
  }, extra || {}), 'l', name);

  console.log('\n-- two slots, one per kind');
  ok('website and graphic design each have a link slot',
     S.MOCKUP_LINKS.map(m => m.kind).join() === 'website,design', S.MOCKUP_LINKS.map(m => m.kind).join());
  ok('the website slot is the existing column, so no saved link moves',
     S.mockupLink('website').key === 'mockupUrl');
  ok('the design slot is its own column', S.mockupLink('design').key === 'mockupDesignUrl');

  console.log('\n-- saving both on one lead');
  const laura = mk('Laura Zafonte');
  S.setMockup(laura.id, { mockupStatus: 'ready', mockupUrl: SITE, mockupDesignUrl: DESIGN,
                          mockupTypes: ['Website', 'Graphic Design'] });
  let l = S.find('leads', laura.id);
  ok('the website link is kept', l.mockupUrl === SITE, l.mockupUrl);
  ok('and the design link beside it', l.mockupDesignUrl === DESIGN, l.mockupDesignUrl);
  const links = S.mockupLinksOf(l);
  ok('both are listed, website first, labelled by kind',
     links.map(x => x.label + '=' + x.url).join(' | ') === 'Website=' + SITE + ' | Design=' + DESIGN,
     links.map(x => x.label).join());
  ok('clearing just the design link leaves the website one',
     (S.setMockup(laura.id, { mockupDesignUrl: '' }), S.find('leads', laura.id).mockupUrl === SITE &&
      !S.find('leads', laura.id).mockupDesignUrl));

  console.log('\n-- attaching a batch of design mockups');
  const derek = mk('Derek Quarles', { mockupStatus: 'ready', mockupUrl: SITE, mockupTypes: ['Website'],
                                      mockupReadyAt: S.shift(-2) });
  const aziz = mk('Aziz Seyal');
  S.setMockupsMany([{ id: derek.id, url: DESIGN, kind: 'design' },
                    { id: aziz.id, url: DESIGN + 'aziz/', kind: 'design' }], '2 design mockups');
  const d = S.find('leads', derek.id), a = S.find('leads', aziz.id);
  ok('the design link lands in the design slot', d.mockupDesignUrl === DESIGN, d.mockupDesignUrl);
  ok('and never overwrites the website mockup already there', d.mockupUrl === SITE, d.mockupUrl);
  ok('"Graphic Design" is ticked to match', d.mockupTypes.indexOf('Graphic Design') > -1, d.mockupTypes.join());
  ok('without dropping "Website"', d.mockupTypes.indexOf('Website') > -1, d.mockupTypes.join());
  ok('a lead with no mockup before becomes ready to send', a.mockupStatus === 'ready', a.mockupStatus);
  ok('with only its design link', a.mockupDesignUrl && !a.mockupUrl);

  console.log('\n-- attaching website mockups still works as before');
  const tania = mk('Tania Novack', { mockupDesignUrl: DESIGN, mockupTypes: ['Graphic Design'] });
  S.setMockupsMany([{ id: tania.id, url: SITE }], '1 mockup');
  const t = S.find('leads', tania.id);
  ok('no kind given means website', t.mockupUrl === SITE, t.mockupUrl);
  ok('the design link is left alone', t.mockupDesignUrl === DESIGN, t.mockupDesignUrl);
  ok('and "Website" is ticked', t.mockupTypes.indexOf('Website') > -1, t.mockupTypes.join());

  console.log('\n-- before the database update has been run');
  ok('the column counts as ready when nothing is missing', S.columnReady('leads', 'mockupDesignUrl'));
  win.Backend.missingColumns = { leads: ['mockupDesignUrl'] };
  ok('and not ready once the probe reports it missing', !S.columnReady('leads', 'mockupDesignUrl'));
  ok('which says nothing about the website link', S.columnReady('leads', 'mockupUrl'));
  win.Backend.missingColumns = {};

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
