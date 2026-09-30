/* Which demo page a lead's industry sends the prospect to.

   A rep on a call says "let me send you something" and clicks once. The
   prospect gets whatever this picks, so picking wrong is worse than
   picking nothing: the rep has already promised it, and what lands is a
   different trade's work.

   Matching an alias ANYWHERE in the industry sent a carpet cleaner the
   car-detailing demos, because 'car' is inside carPET - and carpentry,
   cargo and caregiver. These are the real Industry values off the flyer
   batches, so a change to the alias table has to keep them landing where
   they land now. */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'pitch.js'), 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

/* The real tables and the real matcher, lifted rather than restated. */
function lift(startRe, endStr, label) {
  const i = SRC.search(startRe);
  if (i < 0) throw new Error('cannot find ' + label + ' in pitch.js');
  const j = SRC.indexOf(endStr, i);
  if (j < 0) throw new Error('cannot find the end of ' + label);
  return SRC.slice(i, j + endStr.length);
}
const mod = new Function(
  lift(/var PAGES = \{/, '\n  };', 'PAGES') + '\n' +
  lift(/var ALIASES = \[/, '\n  ];', 'ALIASES') + '\n' +
  lift(/function categoryFor\(industry\)/, '\n  }', 'categoryFor') + '\n' +
  'return {PAGES: PAGES, ALIASES: ALIASES, categoryFor: categoryFor};')();
const cat = mod.categoryFor;

console.log('-- an alias cannot match inside a longer word');
[['Carpet Cleaning', 'Home Services'], ['Carpentry', 'Construction'],
 ['Cargo / Delivery', ''], ['Caregiver / Home Health', ''],
 ['Spacious Storage', '']].forEach(function (p) {
  ok('"' + p[0] + '" is not Automotive', cat(p[0]) !== 'Automotive', cat(p[0]));
  ok('   it lands on ' + (p[1] || 'nothing'), cat(p[0]) === p[1], cat(p[0]));
});

console.log('\n-- the six new pages are wired up');
[['Electrical', 'Electrical'], ['Electrical / Fire Alarm', 'Electrical'],
 ['HVAC', 'HVAC'], ['HVAC / Insulation', 'HVAC'], ['Air Conditioning & Heating', 'HVAC'],
 ['Handyman', 'Handyman'], ['Handyman / Home Repair', 'Handyman'],
 ['Pest control', 'Pest Control'], ['Pest Control', 'Pest Control'],
 ['Pet Grooming', 'Pet Services'], ['Mobile pet grooming', 'Pet Services'],
 ['Dog Waste Removal', 'Pet Services'],
 ['Event & Party Rentals', 'Events'], ['Events', 'Events']].forEach(function (p) {
  ok('"' + p[0] + '" -> ' + p[1], cat(p[0]) === p[1], cat(p[0]));
});

console.log('\n-- a trade with its own page beats the Home Services catch-all');
ok('HVAC is not swallowed by Home Services', cat('HVAC') === 'HVAC');
ok('Electrical is not swallowed either', cat('Electrical') === 'Electrical');
ok('Pest control is not swallowed either', cat('Pest control') === 'Pest Control');
ok('but Plumbing still is', cat('Plumbing') === 'Home Services', cat('Plumbing'));
ok('and so is Pressure Washing', cat('Pressure Washing / Landscaping') === 'Home Services',
   cat('Pressure Washing / Landscaping'));

console.log('\n-- the trades that were already right stay right');
[['Real Estate', 'Real Estate'], ['Mobile Auto Repair', 'Automotive'],
 ['Collision Repair / Auto Body', 'Automotive'], ['Roofing', 'Construction'],
 ['Siding / Roofing', 'Construction'], ['Hair salon', 'Health & Beauty'],
 ['Music Lessons', 'Music'], ['Landscaping', 'Home Services'],
 ['Cleaning', 'Home Services']].forEach(function (p) {
  ok('"' + p[0] + '" -> ' + p[1], cat(p[0]) === p[1], cat(p[0]));
});

console.log('\n-- an industry with no page gets nothing, not a wrong one');
['Bookkeeping', 'Mortgage / HELOC', 'Junk removal', 'Moving',
 'Life insurance', 'Law Firm'].forEach(function (i) {
  const got = cat(i);
  ok('"' + i + '" -> ' + (got || 'no page'),
     got === '' || !!mod.PAGES[got], got);
});
ok('Bookkeeping does not land on a page at all', cat('Bookkeeping') === '', cat('Bookkeeping'));

console.log('\n-- every alias points at a page that exists');
const orphans = mod.ALIASES.filter(a => !mod.PAGES[a[1]]).map(a => a[0] + '->' + a[1]);
ok('no alias points at a missing page', !orphans.length, orphans.join(', '));

console.log('\n-- every page is reachable by its own name');
const unreachable = Object.keys(mod.PAGES).filter(k => cat(k) !== k);
ok('each category resolves to itself', !unreachable.length, unreachable.join(', '));

console.log('\n-- the slugs look like the category they serve');
const wrong = Object.keys(mod.PAGES).filter(function (k) {
  const slug = mod.PAGES[k].replace(/^\/p\/[0-9a-f]+-/, '').replace(/\/$/, '');
  return slug.replace(/-/g, '') !== k.toLowerCase().replace(/[^a-z0-9]/g, '');
});
ok('no page is pointed at another trade’s slug', !wrong.length, wrong.join(', '));

console.log(fails ? '\nPITCH LINKS ' + fails + ' FAILURES' : '\nPITCH LINKS ALL PASS');
process.exit(fails ? 1 : 0);
