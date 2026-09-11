/* Matching published mockups back to the leads they were built for.

   The mockups live one folder per business, so the only link between a URL
   and a lead is the folder name against the company name - close, but not
   equal. The folder drops "&", drops a trailing "e Interiores", and twice
   the source list carries a typo the folder does not.

   Every assertion here is really the same one: a mockup must never land on
   the wrong business. That mistake is invisible in the CRM and discovered
   by the prospect, so the rule is that anything less than certain is
   reported rather than guessed. */
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

const BASE = 'https://thinkfirststudios.github.io/brazil-leads-mockups/';
const pool = [
  'Casa Maré Floripa', 'A Baleeira', 'Bollté Praia Boutique Pousada',
  'Anómada', 'Costão do Santinho Resort', 'Conceito Estética Avançada',
  'Cardoso & Advogados Associados', 'Global Travel & Corporate',
  'Max & Flora Professional Suites', 'FairyLand Bakery & May',
  'Delpizzo Arquitetura e Interiores', 'Kaza Arquitetura e Interiores',
  'Paradiso', 'Areis Campeche', 'Marmoria Sul da Ilha',
  'Sollar Sul', 'Zen Telecom'
].map((name, i) => ({ id: 'l' + i, name: name, mockupUrl: '' }));

const run = slugs => S.matchMockupUrls(slugs.map(s => BASE + s + '/'), pool);
const to = (r, slug) => {
  const m = r.matched.filter(x => x.slug === slug)[0];
  return m ? m.lead.name : '(unmatched)';
};

(async () => {
  console.log('\n-- the plain case');
  let r = run(['a-baleeira', 'cool-office-lagoa']);
  ok('a name that matches exactly', to(r, 'a-baleeira') === 'A Baleeira', to(r, 'a-baleeira'));
  ok('and a folder with no lead is reported, not forced',
     r.unmatched.length === 1 && r.unmatched[0].slug === 'cool-office-lagoa',
     JSON.stringify(r.unmatched));

  console.log('\n-- accents, which the folder cannot carry');
  r = run(['casa-mare-floripa', 'bollte-praia-boutique-pousada', 'anomada',
           'costao-do-santinho-resort', 'conceito-estetica-avancada']);
  ok('é', to(r, 'casa-mare-floripa') === 'Casa Maré Floripa');
  ok('é again, mid-word', to(r, 'bollte-praia-boutique-pousada') === 'Bollté Praia Boutique Pousada');
  ok('ó', to(r, 'anomada') === 'Anómada');
  ok('ã', to(r, 'costao-do-santinho-resort') === 'Costão do Santinho Resort');
  ok('ç and ç again', to(r, 'conceito-estetica-avancada') === 'Conceito Estética Avançada');
  ok('all five, none left over', r.matched.length === 5 && !r.unmatched.length);

  console.log('\n-- an ampersand the folder had to drop');
  r = run(['cardoso-advogados-associados', 'global-travel-corporate',
           'max-flora-professional-suites']);
  ok('Cardoso & Advogados', to(r, 'cardoso-advogados-associados') === 'Cardoso & Advogados Associados');
  ok('Global Travel & Corporate', to(r, 'global-travel-corporate') === 'Global Travel & Corporate');
  ok('Max & Flora', to(r, 'max-flora-professional-suites') === 'Max & Flora Professional Suites');

  console.log('\n-- a folder shorter than the name, or longer');
  r = run(['fairyland-bakery', 'delpizzo-arquitetura', 'paradiso-mercato-e-caffe']);
  ok('the folder stops early', to(r, 'fairyland-bakery') === 'FairyLand Bakery & May');
  ok('and again', to(r, 'delpizzo-arquitetura') === 'Delpizzo Arquitetura e Interiores');
  ok('the folder is the more specific one', to(r, 'paradiso-mercato-e-caffe') === 'Paradiso');

  console.log('\n-- a joining word the folder left out');
  r = run(['kaza-arquitetura-interiores']);
  ok('every word still present', to(r, 'kaza-arquitetura-interiores') === 'Kaza Arquitetura e Interiores');

  console.log('\n-- a typo in the list the folder does not share');
  /* "Areis" for Areias and "Marmoria" for Marmoraria are wrong in the
     source spreadsheet. Refusing these would mean two mockups quietly
     never recorded, so they are matched - but only because nothing else
     comes close, and the screen says they were matched on similarity. */
  r = run(['areias-campeche', 'marmoraria-sul-da-ilha']);
  ok('one letter out', to(r, 'areias-campeche') === 'Areis Campeche');
  ok('two letters out', to(r, 'marmoraria-sul-da-ilha') === 'Marmoria Sul da Ilha');
  ok('and both are labelled as a close match, not an exact one',
     r.matched.every(m => m.how.indexOf('close') === 0),
     r.matched.map(m => m.how).join(', '));

  console.log('\n-- a folder that simply says more than the lead name');
  /* The same rule that lets paradiso-mercato-e-caffe find Paradiso: if one
     is the other plus a suffix, it is the same business described at more
     length, not a different one. */
  r = run(['sollar-sul-eletrica-e-solar-instalacoes-residenciais']);
  ok('is still that business',
     to(r, 'sollar-sul-eletrica-e-solar-instalacoes-residenciais') === 'Sollar Sul',
     to(r, 'sollar-sul-eletrica-e-solar-instalacoes-residenciais'));

  console.log('\n-- what it refuses to do');
  r = run(['padaria-do-centro-ltda']);
  ok('a folder nothing resembles is left unmatched', r.unmatched.length === 1,
     JSON.stringify(r.matched.map(m => m.lead.name)));

  /* A fragment two leads both begin with is exactly where guessing would be
     most tempting and most wrong. */
  const studios = [{ id: 'a', name: 'Studio Arch\u00ec', mockupUrl: '' },
                   { id: 'b', name: 'Studio Hall Arquitetura e Interiores', mockupUrl: '' }];
  const frag = S.matchMockupUrls([BASE + 'studio/'], studios);
  ok('and a fragment two leads share is left alone',
     !frag.matched.length && frag.unmatched.length === 1,
     JSON.stringify(frag.matched.map(m => m.lead.name)));

  console.log('\n-- one mockup cannot land on two leads');
  r = run(['a-baleeira', 'a-baleeira']);
  ok('the second copy finds nothing left to take',
     r.matched.length === 1 && r.unmatched.length === 1,
     r.matched.length + ' matched, ' + r.unmatched.length + ' unmatched');

  console.log('\n-- two leads with the same name are never guessed between');
  const twins = [{ id: 'a', name: 'Cris Hotel', mockupUrl: '' },
                 { id: 'b', name: 'Cris Hotel', mockupUrl: '' }];
  const amb = S.matchMockupUrls([BASE + 'cris-hotel/'], twins);
  ok('reported as ambiguous', amb.ambiguous.length === 1, JSON.stringify(amb));
  ok('and nothing was attached', !amb.matched.length);

  console.log('\n-- attaching, once the matches are agreed');
  await S.boot();
  const made = S.insert('leads', {
    name: 'Casa Maré Floripa', leadStatus: 'new', rating: 'warm', ownerId: S.me().id,
    branch: '', tags: [], mockupStatus: 'none', mockupUrl: '', mockupTypes: []
  }, 'l', 'Casa Maré Floripa');
  const sent = S.insert('leads', {
    name: 'A Baleeira', leadStatus: 'new', rating: 'warm', ownerId: S.me().id,
    branch: '', tags: [], mockupStatus: 'sent', mockupUrl: 'old.example.com',
    mockupSentAt: S.today(), mockupTypes: []
  }, 'l', 'A Baleeira');

  const before = S.all('activity').length;
  S.setMockupsMany([{ id: made.id, url: BASE + 'casa-mare-floripa/' },
                    { id: sent.id, url: BASE + 'a-baleeira/' }], '2 mockups attached');

  ok('the link is on the lead', made.mockupUrl === BASE + 'casa-mare-floripa/', made.mockupUrl);
  ok('and it counts as ready to send', made.mockupStatus === 'ready', made.mockupStatus);
  ok('with the day it was finished', made.mockupReadyAt === S.today(), made.mockupReadyAt);
  ok('it shows on the ready-to-send card',
     S.mockupsReadyToSend().some(l => l.id === made.id));

  /* Re-attaching a link to something already delivered must not quietly
     un-send it - that would put it back on somebody's to-do list. */
  ok('a mockup already sent stays sent', sent.mockupStatus === 'sent', sent.mockupStatus);
  ok('but its link was still updated', sent.mockupUrl === BASE + 'a-baleeira/', sent.mockupUrl);

  ok('the batch is one line in the log, not one per mockup',
     S.all('activity').length === before + 1, S.all('activity').length - before);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
