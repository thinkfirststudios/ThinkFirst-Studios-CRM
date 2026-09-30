/* Which side of the country a lead is on.

   Josh works from the west coast and rang a morning of east-coast agents
   before they were open. The zone is never stored - it is read off the
   state in the Location, falling back to the phone's area code - so these
   are the cases that decide whether a rep rings somebody at 6am. */
const fs = require('fs');
const DIR = require('path').join(__dirname, '..', 'js') + '/';
const read = f => fs.readFileSync(DIR + f, 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

const rows = {
  profiles: [{ id: 'u', name: 'Alex', role: 'admin', active: true }],
  leads: [], customers: [], contacts: [], opportunities: [], tasks: [], vendors: [],
  work_orders: [], notes: [], services: [], time_entries: [], daily_logs: [],
  activity: [], outreach: [], outreach_groups: [],
  statuses: [{ id: 'new', label: 'New', tone: 'b-blue', order: 1, open: true, won: false }],
  vendor_types: [], settings: [{ id: 'org', orgName: 'TFS', currency: 'USD' }],
  stripe_invoices: [], stripe_subscriptions: [], stripe_sync_state: []
};
const thenable = v => ({ then: r => Promise.resolve(r(v)) });
const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u' } } } }), onAuthStateChange: () => {} },
  from: t => ({ select: () => thenable({ data: rows[t] || [], error: null }),
                upsert: () => thenable({ error: null }), insert: () => thenable({ error: null }),
                delete: () => ({ eq: () => thenable({ error: null }),
                 in: () => thenable({ error: null }), neq: () => thenable({ error: null }) }) }),
  channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
};
const win = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  CRM_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'k' } },
  supabase: { createClient: () => client }, console };
global.localStorage = win.localStorage;
new Function('window', read('backend.js'))(win);
new Function('window', read('store.js'))(win);
const S = win.Store;

(async () => {
  await S.boot();
  const z = (address, phone) => S.zoneOf({ address: address, phone: phone });

  console.log('-- the state in the Location decides');
  ok('California is the west coast', z('San Diego, California', '') === 'pacific');
  ok('an abbreviation counts too', z('Tampa, FL 33629', '') === 'eastern');
  ok('a state on its own is enough', z('Maryland', '') === 'eastern');
  ok('Arizona is Mountain', z('Phoenix, Arizona', '') === 'mountain');

  console.log('\n-- a state name that contains another one');
  ok('West Virginia is not Virginia by accident',
     z('Charleston, West Virginia', '') === 'eastern');
  ok('North Hollywood is in California, not North Carolina',
     z('North Hollywood, CA', '') === 'pacific', z('North Hollywood, CA', ''));
  ok('New Mexico is Mountain, not Mexico or New York',
     z('Santa Fe, New Mexico', '') === 'mountain');

  console.log('\n-- the area code fills the gap');
  ok('a bare city with a 909 number is the west coast',
     z('Fontana', '9095593346') === 'pacific');
  ok('no location at all still resolves from the number',
     z('', '(813) 525-5596') === 'eastern');
  ok('a toll-free number says nothing', z('', '(855) 727-4255') === 'unknown');

  console.log('\n-- a state that straddles a zone line defers to the number');
  ok('Houston is Central', z('Houston, Texas', '(713) 555-0100') === 'central');
  ok('El Paso is Mountain even though Texas is Central',
     z('El Paso, Texas', '(915) 555-0100') === 'mountain', z('El Paso, Texas', '(915) 555-0100'));
  ok('Knoxville is Eastern even though Tennessee is Central',
     z('Knoxville, Tennessee', '(865) 555-0100') === 'eastern');

  console.log('\n-- the business is where it says it is');
  ok('a Los Angeles agent holding a Washington DC mobile is still west coast',
     z('Los Angeles, California', '(202) 316-5274') === 'pacific',
     z('Los Angeles, California', '(202) 316-5274'));

  /* The capital is not the state of the same name. Two of Josh's realtors
     have their Location typed "Washington D.C." with full stops, and the
     stops were being replaced by spaces before anything looked at them -
     leaving the bare word "washington", which is a state. Both were filed
     on the west coast, three time zones from where they work. */
  console.log('\n-- Washington the city is not Washington the state');
  ['Washington D.C.', 'Washington, D.C.', 'Washington, DC', 'Washington DC',
   'Washington, D.C. 20001', 'Washington, District of Columbia'].forEach(function (loc) {
    ok('"' + loc + '" is east coast', z(loc, '(202) 709-7989') === 'eastern',
       z(loc, '(202) 709-7989'));
  });
  ok('and still east coast with no phone to fall back on',
     z('Washington D.C.', '') === 'eastern', z('Washington D.C.', ''));
  ok('the state of Washington is still the west coast',
     z('Seattle, Washington', '(206) 555-0100') === 'pacific');
  ok('and so is Washington spelled as a state abbreviation',
     z('Spokane, WA', '') === 'pacific');
  ok('St. Louis is not turned into a state by the full stop',
     z('St. Louis, Missouri', '(314) 781-2944') === 'central',
     z('St. Louis, Missouri', '(314) 781-2944'));

  console.log('\n-- outside the lower 48');
  /* A street can be named after anywhere. An Orange County realtor on
     Brazil Drive was being filed as outside the country, because the word
     Brazil appeared in his address - the same shape as Avenida Vista
     Montana being read as Montana. A printed zip is what settles it. */
  console.log('\n-- a street named after a country is still on that street');
  ok('Brazil Dr, Buena Park CA is Orange County, not Brazil',
     z('5826 Brazil Dr, Buena Park, CA 90620', '(714) 356-2369') === 'pacific',
     z('5826 Brazil Dr, Buena Park, CA 90620', '(714) 356-2369'));
  ok('Toronto St, Denver CO is Colorado, not Canada',
     z('1234 Toronto St, Denver, CO 80220', '') === 'mountain',
     z('1234 Toronto St, Denver, CO 80220', ''));
  ok('Naples FL is Florida, and still east coast',
     z('850 5th Ave S, Naples, FL 34102', '') === 'eastern');
  ok('but a Brazilian address with no zip is still Brazil',
     z('Rua das Rendeiras, Florianopolis, SC', '') === 'outside',
     z('Rua das Rendeiras, Florianopolis, SC', ''));
  ok('and a foreign dialling code still wins where no US zip is printed',
     z('Campeche', '+55 48 99219-7961') === 'outside');

  console.log('');
  ok('Florianopolis is Brazil, not South Carolina',
     z('Florianópolis, SC', '+55 48 99219-7961') === 'outside',
     z('Florianópolis, SC', '+55 48 99219-7961'));
  ok('and stays outside even with no dialling code',
     z('Florianópolis, SC', '48992197961') === 'outside');
  ok('a real South Carolina lead is still the east coast',
     z('Charleston, South Carolina', '(843) 555-0100') === 'eastern');
  ok('Montreal is not the east coast', z('Montreal, Quebec', '(514) 821-8408') === 'outside');
  ok('Hawaii is neither coast', z('Honolulu, Hawaii', '(808) 683-8244') === 'akhi');

  console.log('\n-- nothing to go on');
  ok('no location and no phone is unknown, not guessed', z('', '') === 'unknown');
  ok('a street with no city or state is unknown', z('1317 Q St #120', '') === 'unknown');
  ok('every lead lands in exactly one of the listed zones',
     S.LEAD_ZONES.filter(function (o) { return o.id === z('', ''); }).length === 1);

  console.log(fails ? '\nZONES ' + fails + ' FAILURES' : '\nZONES ALL PASS');
  process.exit(fails ? 1 : 0);
})();
