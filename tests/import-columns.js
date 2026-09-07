/* Per-row rating and tags surviving an import.

   A list that arrives already sorted into segments is only useful if the
   segments arrive with it. The import-wide tag box applies one set to every
   row, so without per-row tags a 2,500-line file lands as one undifferentiated
   heap and the sorting work is thrown away on the way in.

   This exercises the store and the column-matching rules rather than the
   modal: the mapping table and the tag/rating parsing are where a silent
   failure would actually live. */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'js') + '/';
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
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }), neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

/* The importer's column table and helpers, lifted out of the view so they
   can be checked without a DOM. If these drift from js/views/leads.js the
   header-matching assertions below stop meaning anything, so the source is
   scanned to confirm the new fields are still declared there. */
const leadsSrc = fs.readFileSync(path.join(DIR, 'views', 'leads.js'), 'utf8');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  await S.boot();

  console.log('\n-- the view still declares the columns');
  ok('rating is in ALIASES', /rating:\s*\['rating'/.test(leadsSrc));
  ok('tagsCol is in ALIASES', /tagsCol:\s*\['tags'/.test(leadsSrc));
  ok('both are offered in the mapping dialog',
     /\['rating', 'Rating'\]/.test(leadsSrc) && /\['tagsCol', 'Tags'\]/.test(leadsSrc));
  ok('per-row rating reaches the lead', /rating: rowRating \|\| 'warm'/.test(leadsSrc));
  ok('per-row tags are merged with the import-wide ones',
     /tags: S\.parseTags\(tags\.concat\(rowTags\)/.test(leadsSrc));
  ok('an unknown rating falls back instead of being written through',
     /RATING_IDS\[cell\('rating'\)\.toLowerCase\(\)\]/.test(leadsSrc));

  console.log('\n-- headers from the realtor CSV match the right fields');
  /* Mirrors guessMap: exact match first across every field, then substring. */
  const ALIASES = {
    name: ['company', 'company name', 'business', 'name', 'lead'],
    contactName: ['contact', 'contact name', 'full name', 'person'],
    contactTitle: ['title', 'job title', 'role', 'position'],
    email: ['email', 'e-mail', 'mail'],
    phone: ['phone', 'phone number', 'telephone'],
    website: ['website', 'url', 'site', 'web', 'domain'],
    address: ['address', 'city', 'location'],
    industry: ['industry', 'category', 'type'],
    source: ['source', 'lead source', 'channel'],
    rating: ['rating', 'lead rating', 'temperature', 'tier'],
    tagsCol: ['tags', 'tag', 'labels', 'segment'],
    noteText: ['notes', 'note', 'comment', 'description']
  };
  const headers = ['name', 'contactName', 'contactTitle', 'email', 'phone', 'website',
    'industry', 'address', 'rating', 'source', 'tags', 'notes',
    'areaCode', 'timeZone', 'siteEra', 'siteCurrent', 'siteRaw'];
  const map = {}, used = {};
  Object.keys(ALIASES).forEach(f => {
    for (let i = 0; i < headers.length; i++) {
      if (!used[i] && ALIASES[f].indexOf(norm(headers[i])) > -1) { map[f] = i; used[i] = 1; return; }
    }
    for (let j = 0; j < headers.length; j++) {
      if (used[j]) continue;
      const h = norm(headers[j]);
      for (const a of ALIASES[f]) if (h.indexOf(a) > -1) { map[f] = j; used[j] = 1; return; }
    }
  });
  const at = f => headers[map[f]];
  ok('rating -> rating', at('rating') === 'rating', at('rating'));
  ok('tags -> tags', at('tagsCol') === 'tags', at('tagsCol'));
  ok('notes -> notes', at('noteText') === 'notes', at('noteText'));
  ok('website -> website, not siteEra', at('website') === 'website', at('website'));
  ok('address -> address, not areaCode', at('address') === 'address', at('address'));
  ok('name -> name', at('name') === 'name', at('name'));

  console.log('\n-- tag cells split on pipes as well as commas');
  const parseRowTags = s => S.parseTags(String(s || '').replace(/\|/g, ','));
  ok('pipe separated', parseRowTags('realtor|own-site').join(',') === 'realtor,own-site',
     parseRowTags('realtor|own-site').join(','));
  ok('comma separated', parseRowTags('realtor, own-site').join(',') === 'realtor,own-site');
  ok('empty stays empty', parseRowTags('').length === 0);
  ok('duplicates collapse', parseRowTags('realtor|realtor').length === 1);

  console.log('\n-- the segments survive as real, filterable tags');
  const seg = ['own-site', 'brokerage-page', 'no-site-found', 'not-a-realtor'];
  seg.forEach((t, i) => {
    const lead = S.insert('leads', {
      name: 'Realtor ' + i, leadStatus: 'new', rating: i === 0 ? 'hot' : 'cold',
      ownerId: 'u', estValue: 0, nextFollowUp: '', lastContactedAt: '',
      tags: S.parseTags('realtor|'.replace(/\|/g, ',') + t),
      convertedCustomerId: '', convertedAt: ''
    }, 'l', 'Realtor ' + i);
    ok('tagged ' + t, S.hasTag(lead, t));
  });
  ok('every one is tagged realtor',
     S.all('leads').every(l => S.hasTag(l, 'realtor')));
  ok('the segments are all offered in the tag filter',
     seg.every(t => S.allTags().indexOf(t) > -1), S.allTags().join(','));

  console.log('\n-- a blank follow-up still reads as needing attention');
  /* The chosen import leaves the date blank, so this is expected, not a bug.
     Asserting it keeps the surprise out of the reader's day. */
  ok('unscheduled leads are in the attention queue',
     S.leadsNeedingAttention().length === seg.length,
     S.leadsNeedingAttention().length);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
