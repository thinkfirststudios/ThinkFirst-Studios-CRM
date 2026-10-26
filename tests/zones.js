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
     z('', '(813) 555-0196') === 'eastern');
  ok('a toll-free number says nothing', z('', '(855) 555-0172') === 'unknown');

  console.log('\n-- a state that straddles a zone line defers to the number');
  ok('Houston is Central', z('Houston, Texas', '(713) 555-0100') === 'central');
  ok('El Paso is Mountain even though Texas is Central',
     z('El Paso, Texas', '(915) 555-0100') === 'mountain', z('El Paso, Texas', '(915) 555-0100'));
  ok('Knoxville is Eastern even though Tennessee is Central',
     z('Knoxville, Tennessee', '(865) 555-0100') === 'eastern');

  console.log('\n-- the business is where it says it is');
  ok('a Los Angeles agent holding a Washington DC mobile is still west coast',
     z('Los Angeles, California', '(202) 555-0131') === 'pacific',
     z('Los Angeles, California', '(202) 555-0131'));

  /* The capital is not the state of the same name. Two of Josh's realtors
     have their Location typed "Washington D.C." with full stops, and the
     stops were being replaced by spaces before anything looked at them -
     leaving the bare word "washington", which is a state. Both were filed
     on the west coast, three time zones from where they work. */
  console.log('\n-- Washington the city is not Washington the state');
  ['Washington D.C.', 'Washington, D.C.', 'Washington, DC', 'Washington DC',
   'Washington, D.C. 20001', 'Washington, District of Columbia'].forEach(function (loc) {
    ok('"' + loc + '" is east coast', z(loc, '(202) 555-0170') === 'eastern',
       z(loc, '(202) 555-0170'));
  });
  ok('and still east coast with no phone to fall back on',
     z('Washington D.C.', '') === 'eastern', z('Washington D.C.', ''));
  ok('the state of Washington is still the west coast',
     z('Seattle, Washington', '(206) 555-0100') === 'pacific');
  ok('and so is Washington spelled as a state abbreviation',
     z('Spokane, WA', '') === 'pacific');
  ok('St. Louis is not turned into a state by the full stop',
     z('St. Louis, Missouri', '(314) 555-0178') === 'central',
     z('St. Louis, Missouri', '(314) 555-0178'));

  console.log('\n-- outside the lower 48');
  /* A street can be named after anywhere. An Orange County realtor on
     Brazil Drive was being filed as outside the country, because the word
     Brazil appeared in his address - the same shape as Avenida Vista
     Montana being read as Montana. A printed zip is what settles it. */
  console.log('\n-- a street named after a country is still on that street');
  ok('Brazil Dr, Buena Park CA is Orange County, not Brazil',
     z('1400 Brazil Dr, Buena Park, CA 90620', '(714) 555-0135') === 'pacific',
     z('1400 Brazil Dr, Buena Park, CA 90620', '(714) 555-0135'));
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
  ok('Montreal is not the east coast', z('Montreal, Quebec', '(514) 555-0182') === 'outside');
  ok('Hawaii is neither coast', z('Honolulu, Hawaii', '(808) 555-0180') === 'akhi');

  /* Brazil Drive again, with a city instead of a street. A wrap shop in
     Ontario, California was filed in Canada, so no coast filter showed
     it. The pair that settles it is a US state at the very end of the
     line plus a ten digit area code belonging to a US state. */
  console.log('');
  ok('Ontario, CA is Ontario California',
     z('Ontario, CA', '(909) 555-0152') === 'pacific',
     z('Ontario, CA', '(909) 555-0152'));
  ok('  and Ontario the province still is not',
     z('Ontario, Canada', '(416) 555-0133') === 'outside');
  ok('  and the state alone is not enough without a US number',
     z('Ontario, CA', '+55 48 99219-7961') === 'outside');
  ok('Quebec City keeps its country', z('Quebec City, QC', '') === 'outside');

  /* A split state's area code is the tie-breaker only when the number is
     actually from that state. A Flower Mound tennis coach with a 480
     Arizona mobile was filed in Mountain time, an hour out and missing
     from the Central filter. El Paso must keep working, because that is
     what the tie-breaker is for. */
  console.log('');
  ok('a Texas lead with an out-of-state mobile stays on Texas time',
     z('Flower Mound, TX', '480-555-0119') === 'central',
     z('Flower Mound, TX', '480-555-0119'));
  ok('  and El Paso is still Mountain, which is the whole point of the split',
     z('El Paso, TX', '(915) 555-0170') === 'mountain',
     z('El Paso, TX', '(915) 555-0170'));
  ok('  and Houston is still Central', z('Houston, TX', '(713) 555-0144') === 'central');
  ok('  and a Texas lead with no phone falls back to Central',
     z('Dallas, TX', '') === 'central');
  ok('the other split states are untouched: Pensacola is Central',
     z('Pensacola, FL', '(850) 555-0123') === 'central');
  ok('  and Miami is Eastern', z('Miami, FL', '(305) 555-0123') === 'eastern');

  /* NH was simply missing from the abbreviation table. A lead with a
     phone was placed by its area code and so never showed the gap. */
  ok('New Hampshire is the east coast, abbreviated and with no phone',
     z('Exeter, NH', '') === 'eastern', z('Exeter, NH', ''));
  ok('  and spelled out', z('Rochester, New Hampshire', '') === 'eastern');
  ok('  and every other state resolves from its abbreviation alone',
     (function () {
       var miss = [];
       'al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sd tn tx ut vt va wa wv wi wy dc'
         .split(' ').forEach(function (s) {
           if (z('Somewhere, ' + s.toUpperCase(), '') === 'unknown') miss.push(s);
         });
       return !miss.length;
     })(),
     'unresolved: see the ZONE_STATE_ABBR comment for why SC is excluded');

  console.log('\n-- a split state only takes a zone it actually spans');
  /* From the Oct 23 lists: the researcher's TZ column disagreed. */
  ok('Portland, OR with an Ohio cell stays Pacific', z('Portland, OR', '216-555-0126') === 'pacific',
     z('Portland, OR', '216-555-0126'));
  ok('Salem, OR with a Maine cell stays Pacific', z('Salem, OR', '207-555-0165') === 'pacific',
     z('Salem, OR', '207-555-0165'));
  ok('El Paso, TX still reads Mountain from its 915', z('El Paso, TX', '(915) 555-0140') === 'mountain');
  ok("Coeur d'Alene, ID is Pacific", z("Coeur d'Alene, ID", '(208) 555-0198') === 'pacific',
     z("Coeur d'Alene, ID", '(208) 555-0198'));
  ok('Lewiston, ID is Pacific', z('Lewiston, ID', '(208) 555-0164') === 'pacific');
  ok('Boise, ID is still Mountain', z('Boise, ID', '(208) 555-0100') === 'mountain');
  ok('Ontario, OR is Mountain', z('Ontario, OR', '(541) 555-0100') === 'mountain',
     z('Ontario, OR', '(541) 555-0100'));
  ok('Boise, ID with a Las Vegas cell stays Mountain', z('Boise, ID', '(702) 555-0108') === 'mountain');
  ok('Bismarck, ND with a Tucson cell stays Central', z('Bismarck, ND', '(520) 555-0175') === 'central');
  ok('Elizabethtown, KY is Eastern despite its 270', z('Elizabethtown, KY', '(270) 555-0163') === 'eastern');
  ok('Tallahassee is Eastern despite its 850', z('Tallahassee, Florida', '(850) 555-0145') === 'eastern');
  ok('Pensacola is Central on its 850', z('Pensacola, FL', '(850) 555-0100') === 'central');
  ok('Detroit, MI with a Houston cell stays Eastern', z('Detroit, MI', '(281) 555-0137') === 'eastern');
  ok('Jackson, MI with a South Dakota cell stays Eastern', z('Jackson, MI', '(605) 555-0113') === 'eastern');
  ok('Grand Rapids, MI on its own 616 is Eastern', z('Grand Rapids, MI', '(616) 555-0119') === 'eastern');
  ok('but Ontario, CA is still Pacific', z('Ontario, CA', '(909) 555-0100') === 'pacific');

  console.log('\n-- nothing to go on');
  ok('no location and no phone is unknown, not guessed', z('', '') === 'unknown');
  ok('a street with no city or state is unknown', z('1317 Q St #120', '') === 'unknown');
  ok('every lead lands in exactly one of the listed zones',
     S.LEAD_ZONES.filter(function (o) { return o.id === z('', ''); }).length === 1);

  console.log(fails ? '\nZONES ' + fails + ' FAILURES' : '\nZONES ALL PASS');
  process.exit(fails ? 1 : 0);
})();
