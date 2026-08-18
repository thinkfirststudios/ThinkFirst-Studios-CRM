/* The queues on the Leads screen page in place rather than telling you
   how many rows they are refusing to show. */
const fs = require('fs');
const APP = require('path').join(__dirname, '..') + '/';
const read = f => fs.readFileSync(APP + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 10 leads all needing a follow-up, 9 of them with a mockup ready to send.
const leads = [];
for (let i = 1; i <= 10; i++) {
  leads.push({
    id: 'l' + i, name: 'Lead ' + i, leadStatus: 'working', rating: 'warm', ownerId: 'u',
    estValue: 100 * i, nextFollowUp: day(-i), lastContactedAt: '', tags: [],
    mockupStatus: i <= 9 ? 'ready' : 'none',
    mockupTypes: ['Website'], mockupUrl: 'figma.com/' + i,
    mockupReadyAt: day(-i), mockupSentAt: '',
    instagram: '', tiktok: '', facebook: '', lostReason: '',
    convertedCustomerId: '', convertedAt: ''
  });
}

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: leads,
  customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [{ id: 'new', label: 'New', tone: 'b-blue', order: 1, open: true, won: false }],
  vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};

const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const chain = v => ({ limit: () => thenable(v), then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => chain({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }), neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};

/* Enough of a DOM for the view to render into, and to collect the
   handlers it binds so the buttons can actually be clicked. */
const handlers = {};
function stubEl(html) {
  return {
    innerHTML: html || '',
    dataset: {},
    querySelector: () => ({ onclick: null, onchange: null, oninput: null }),
    querySelectorAll: function (sel) {
      const m = /\[data-(more|less)\]/.exec(sel);
      if (!m) return [];
      const kind = m[1];
      // Return one handle per key present in the rendered markup.
      return ['mockup', 'attention'].filter(k =>
        this.innerHTML.indexOf('data-' + kind + '="' + k + '"') > -1
      ).map(k => {
        const node = { dataset: {}, set onclick(fn) { handlers[kind + ':' + k] = fn; }, get onclick() { return null; } };
        node.dataset[kind] = k;
        return node;
      });
    }
  };
}

const win = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console,
  document: { getElementById: () => null, createElement: () => ({ style: {} }), addEventListener: () => {} }
};
global.localStorage = win.localStorage;
new Function('window', read('js/backend.js'))(win);
new Function('window', read('js/store.js'))(win);
new Function('window', read('js/ui.js'))(win);
new Function('window', read('js/views/leads.js'))(win);
const S = win.Store;

const el = stubEl();
function paint() {
  for (const k in handlers) delete handlers[k];
  win.Views.leads(el, {});
  return el.innerHTML;
}
win.render = paint;

(async () => {
  await S.boot();
  let html = paint();

  console.log('\n-- it offers to show them instead of just counting them');
  ok('a Show more button is rendered', html.indexOf('data-more="mockup"') > -1);
  ok('it says how many that reveals', /Show \d+ more/.test(html), /Show \d+ more/.exec(html));
  ok('and how many remain hidden', html.indexOf('still hidden') > -1);
  ok('the old dead-end wording is gone', html.indexOf('more waiting.') < 0);

  console.log('\n-- first page');
  const count = h => (h.match(/data-marksent="/g) || []).length;
  ok('six mockup rows shown', count(html) === 6, count(html));
  ok('nine are ready in total', S.mockupsReadyToSend().length === 9);
  ok('three reported hidden', html.indexOf('3 still hidden') > -1);
  ok('no Show less yet', html.indexOf('data-less="mockup"') < 0);

  console.log('\n-- clicking Show more');
  ok('the handler was bound', typeof handlers['more:mockup'] === 'function');
  handlers['more:mockup']({ stopPropagation() {} });
  html = el.innerHTML;
  ok('all nine now shown', count(html) === 9, count(html));
  ok('it says it is showing all of them', html.indexOf('Showing all 9') > -1);
  ok('a Show less appears once expanded', html.indexOf('data-less="mockup"') > -1);
  ok('no more Show more', html.indexOf('data-more="mockup"') < 0);

  console.log('\n-- Show less collapses it again');
  ok('that handler bound too', typeof handlers['less:mockup'] === 'function');
  handlers['less:mockup']({ stopPropagation() {} });
  html = el.innerHTML;
  ok('back to six', count(html) === 6, count(html));
  ok('and offering more again', html.indexOf('data-more="mockup"') > -1);

  console.log('\n-- the follow-up queue pages the same way');
  ok('it has its own button', html.indexOf('data-more="attention"') > -1);
  ok('ten leads need attention', S.leadsNeedingAttention().length === 10);
  handlers['more:attention']({ stopPropagation() {} });
  html = el.innerHTML;
  ok('expanding one queue does not collapse the other', count(html) === 6, count(html));
  ok('the follow-up queue grew', html.indexOf('4 still hidden') < 0);

  console.log('\n-- a queue that fits shows no controls at all');
  S.removeMany('leads', ['l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10']);
  html = paint();
  ok('three ready, no paging offered', S.mockupsReadyToSend().length === 3);
  ok('no Show more', html.indexOf('data-more="mockup"') < 0);
  ok('no leftover count', html.indexOf('still hidden') < 0);

  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
