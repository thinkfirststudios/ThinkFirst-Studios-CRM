/* Which column the importer reads as which field.

   Both of the imports that went wrong this week went wrong here, silently,
   and were reported only as a smaller number than expected in a dialog:

     - "Neighborhood" was read as an Instagram handle, because "ig" is an
       alias for instagram and the word ne-IG-hborhood contains it. A social
       handle outranks the website in leadKey, so 61 of 68 Tampa realtors
       keyed as the same lead and were skipped as duplicates.

     - "Lead #" was read as the company name, because it normalises to
       "lead" and sits in the first column. "Business Name" then matched
       nothing at all, and twenty businesses arrived in the CRM called 1
       through 20 with their names nowhere on the record.

   These are the headers of the real files, so a change to the alias table
   has to keep them landing where they land now. */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'leads.js'), 'utf8');
let fails = 0;
const ok = (l, c, x) => { if (c) console.log('  ok   ' + l); else { fails++; console.log('  FAIL ' + l + (x !== undefined ? ' -> ' + x : '')); } };

/* The real matching rules, lifted out of the view rather than restated, so
   this cannot quietly pass against a copy that has drifted. */
function lift(startRe, endStr, label) {
  const i = SRC.search(startRe);
  if (i < 0) throw new Error('cannot find ' + label + ' in leads.js');
  const j = SRC.indexOf(endStr, i);
  if (j < 0) throw new Error('cannot find the end of ' + label);
  return SRC.slice(i, j + endStr.length);
}
const guessMap = new Function(
  lift(/var ALIASES = \{/, '\n  };', 'ALIASES') + '\n' +
  lift(/function norm\(s\)/, '\n', 'norm') + '\n' +
  lift(/function isRowNumber\(h\)/, '\n  }', 'isRowNumber') + '\n' +
  lift(/function guessMap\(headers\)/, '\n  }', 'guessMap') + '\n' +
  'return guessMap;')();

const picks = (headers, field) => {
  const m = guessMap(headers);
  return m[field] === undefined ? null : headers[m[field]];
};

console.log('-- a row number is not a company name');
const fb = ['Lead #', 'Business Name', 'Contact Name', 'Contact Title',
            'Category', 'Phone', 'Website', 'Source', 'Notes'];
ok('"Lead #" does not take the company name', picks(fb, 'name') === 'Business Name',
   picks(fb, 'name'));
ok('and Business Name is not left unmapped', picks(fb, 'name') !== null);
ok('the contact still lands', picks(fb, 'contactName') === 'Contact Name');
ok('a file that is only a counter maps no name at all',
   picks(['Lead #', 'Phone', 'Category'], 'name') === null,
   picks(['Lead #', 'Phone', 'Category'], 'name'));
ok('an ID column is not a company name either',
   picks(['Lead ID', 'Business Name', 'Phone'], 'name') === 'Business Name');

console.log('\n-- the more specific header wins, whatever order it sits in');
ok('Business Name beats a bare Lead column',
   picks(['Lead', 'Business Name', 'Phone'], 'name') === 'Business Name',
   picks(['Lead', 'Business Name', 'Phone'], 'name'));
ok('and still wins when it comes second to Account',
   picks(['Account', 'Company Name', 'Phone'], 'name') === 'Company Name',
   picks(['Account', 'Company Name', 'Phone'], 'name'));

console.log('\n-- a two letter alias cannot match inside a longer word');
const tampa = ['Lead ID', 'Business Name', 'Phone', 'Phone (E.164)', 'Website',
               'Social Media', 'Lead Type', 'Priority', 'Category', 'Address',
               'Neighborhood', 'City', 'Market', 'Time Zone', 'Google Rating',
               'Google Reviews', 'Google Maps Link', 'Owner', 'Status',
               'Attempts', 'Last Outcome', 'Next Action Date', 'Source',
               'Suggested Opener', 'Notes'];
ok('Neighborhood is not an Instagram handle', picks(tampa, 'instagram') === null,
   picks(tampa, 'instagram'));
ok('Attempts is not a TikTok handle', picks(tampa, 'tiktok') === null,
   picks(tampa, 'tiktok'));
ok('the Tampa file still finds its company name',
   picks(tampa, 'name') === 'Business Name');
ok('and its website', picks(tampa, 'website') === 'Website');

console.log('\n-- the prepared lists are untouched');
const prepared = ['Company', 'Contact', 'Title', 'Email', 'Phone', 'Website',
                  'Location', 'Industry', 'Source', 'Est. Value', 'Instagram',
                  'TikTok', 'Facebook', 'Rating', 'Tags', 'Note'];
[['name', 'Company'], ['contactName', 'Contact'], ['contactTitle', 'Title'],
 ['email', 'Email'], ['phone', 'Phone'], ['website', 'Website'],
 ['address', 'Location'], ['industry', 'Industry'], ['source', 'Source'],
 ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'],
 ['tagsCol', 'Tags'], ['noteText', 'Note']].forEach(function (p) {
  ok(p[1] + ' -> ' + p[0], picks(prepared, p[0]) === p[1], picks(prepared, p[0]));
});

console.log('\n-- the contains fallback still does its job');
ok('"Business Email" is an email', picks(['Company', 'Business Email'], 'email') === 'Business Email');
ok('"Company URL" is a website', picks(['Company', 'Company URL'], 'website') === 'Company URL');

console.log(fails ? '\nIMPORT HEADER ' + fails + ' FAILURES' : '\nIMPORT HEADER ALL PASS');
process.exit(fails ? 1 : 0);
