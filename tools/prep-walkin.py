"""Turn a walk-in prospect list into CSV the importer reads without mapping.

    python tools/prep-walkin.py standby/walkin-raw.csv --out standby/walkin-leads.csv

Input is the shape these lists arrive in: a business name, one or two links,
and a sentence of description. No phone, no email, no contact name - which is
the point. You do not ring a pousada, you walk in with a mockup.

That absence is also the hazard. With no email the CRM's dedupe key falls
back to the website's host, and a social profile used as a website makes
every business on that platform the same lead. So a link is sorted by what
it actually is: a profile goes in its own column where the handle is the
identity, and only a real domain goes in Website.
"""
import argparse
import csv
import io
import os
import re
import sys

COLUMNS = ['Company', 'Contact', 'Title', 'Email', 'Phone', 'Website',
           'Location', 'Industry', 'Source', 'Est. Value',
           'Instagram', 'TikTok', 'Facebook', 'Rating', 'Tags', 'Note']

# Coarse buckets, matched against the description in order. First hit wins,
# so the more specific patterns come first. This drives nothing but the
# Industry column, which is what makes a walk-in route plannable - you do
# the four architects on one street together, not scattered through a week.
INDUSTRY = [
    ('Coworking',          r'cowork|shared workspace|workspace|coliving|office provider|professional hub'),
    ('Hospitality',        r'pousada|hotel|hostel|hospitality|lodging|lodge|guest (house|inn|lodge)|resort|accommodation|flat|rental'),
    ('Architecture',       r'architect|arquitet|interior design|design studio|design-forward|remodel'),
    ('Construction',       r'contractor|marcenaria|stonework|stone contractor|marble|granite|quartz|joinery|woodwork|solar|electrical|surveillance|wall-coating|finishing'),
    ('Legal',              r'legal|advogad|law'),
    ('Real Estate',        r'real estate|property (broker|firm|assets)|realty|imobili|developer|property allocations'),
    ('Food & Drink',       r'restaurant|eatery|dining|bakery|padaria|pastry|caf|coffee|bistro|pizzeria|food|meal prep|delivery|emporium|buffet|vegan|culinary|gastronom'),
    ('Tourism',            r'tour|travel|excursion|charter|yacht|dive|diving|transport|van|receptive|relocation|concierge'),
    ('Sports & Wellness',  r'yoga|wellness|surf|kite|paddle|fitness|sports|beach tennis|aesthetic|clinic|sa[uú]de'),
    ('Education',          r'language school|english|teacher|academy|institute'),
    ('Automotive',         r'automotive|auto service'),
    ('Retail',             r'retail|boutique fashion|vintage|brech|apparel|fitnesswear|biquinis|shopping|commercial center'),
    ('Telecom',            r'telecom|fiber|internet provider'),
]

SOCIAL = {
    'Instagram': r'(?:^|\.)instagram\.com/',
    'Facebook': r'(?:^|\.)facebook\.com/',
    'TikTok': r'(?:^|\.)tiktok\.com/',
}
# instagram.com/p/... is a post, not a profile. Treated as a handle it would
# read as "@p" and, worse, collide with every other post link.
POST = re.compile(r'(?:^|\.)(?:instagram|facebook)\.com/(p|reel|share|posts)/', re.I)

# Ways these sheets write "there isn't one". Any of them taken literally
# becomes a website, and a website is an identity.
NOTHING = re.compile(r'^\s*(not found|none|n/?a|unknown|tbd|-+)\b', re.I)


def bare(url):
    return re.sub(r'^https?://(www\.)?', '', (url or '').strip(), flags=re.I)


def industry_of(text):
    low = (text or '').lower()
    for label, pattern in INDUSTRY:
        if re.search(pattern, low):
            return label
    return ''


def contact_bits(row):
    """A phone and an email, where the sheet has them.

    The first of these lists had neither - you do not ring a pousada, you
    walk in - so this used to take neither, and a later sheet with 68
    WhatsApp numbers on it had every one of them dropped on the floor.

    "Not found" is the sheet's way of writing nothing, but it is sometimes
    "Not found (booking by email only: mussel@numerologo.com.br)", so the
    address is taken out before the rest is discarded. The same goes for an
    email written into the description."""
    raw = (row.get('WhatsApp / Phone') or '').strip()
    email = ''
    hunt = ' '.join([raw, (row.get('Description / Niche') or ''),
                     (row.get('Website / Link') or '')])
    m = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', hunt)
    if m:
        email = m.group(0).rstrip('.')

    phone = ''
    if raw and not raw.lower().startswith('not found'):
        # One row carries two numbers: "48 99114-5800 / 48 99619-2923".
        first = re.split(r'\s*/\s*', raw)[0].strip()
        if sum(c.isdigit() for c in first) >= 8:
            phone = first
    return phone, email


def clean(row, location, source, tags):
    out = dict((c, '') for c in COLUMNS)
    out['Company'] = (row.get('Business Name') or '').strip()
    desc = (row.get('Description / Niche') or '').strip()
    out['Note'] = desc
    out['Location'] = location
    out['Source'] = source
    out['Tags'] = tags
    out['Phone'], out['Email'] = contact_bits(row)

    links = [row.get('Website / Link'), row.get('Social Media')]
    for raw in links:
        url = (raw or '').strip()
        if not url or NOTHING.match(url):
            # "Not found" is how this sheet writes an empty cell. Taken as a
            # URL it becomes the website, and the CRM keys a lead with no
            # email on its website host - so all 45 businesses with no site
            # got the identical key "d:not found" and 44 of them would have
            # been skipped on import as duplicates of the first.
            continue
        host_path = bare(url)
        if POST.search(host_path):
            # Keep it - it is the only link there is - but as a link, not a
            # handle, so it never becomes an identity.
            if not out['Website']:
                out['Website'] = url
            continue
        placed = False
        for col, pattern in SOCIAL.items():
            if re.search(pattern, host_path, re.I):
                if not out[col]:
                    out[col] = url
                placed = True
                break
        if not placed and not out['Website']:
            out['Website'] = url

    # The description decides, and only a row that has none falls back to
    # its own name and handle. Mixing them lets a name outvote the sentence
    # written about the business: "Costa Solar Lagoa" is a pousada - solar
    # is a manor house in Portuguese - and matching the name first filed it
    # as a solar panel contractor.
    out['Industry'] = (industry_of(desc) or
                       industry_of(' '.join([out['Company'], out['Instagram'], out['Website']])))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('--out', required=True)
    ap.add_argument('--location', default='Florianópolis, SC')
    ap.add_argument('--source-label', default='Walk-In Presentation')
    ap.add_argument('--tags', default='walk-in | Florianópolis')
    a = ap.parse_args()

    rows = list(csv.DictReader(io.open(a.source, encoding='utf-8-sig')))

    # These sheets are organised into sections, and a section heading is a
    # row like any other: a name in the first column and nothing else on it.
    # Imported as written they become leads called "PRIORITY" and
    # "REAL ESTATE AGENCIES - SOUTH FLORIANOPOLIS ISLAND", which a rep then
    # has to work out how to delete.
    def is_heading(r):
        name = (r.get('Business Name') or '').strip()
        if not name:
            return False
        rest = [(r.get(k) or '').strip() for k in r if k != 'Business Name']
        return not any(rest)

    # A business listed under two sections is one business. The sheet says
    # so itself - "(See also PRIORITY section.)" - and importing both makes
    # two leads that two people can call.
    kept, seen, headings, repeats = [], {}, [], []
    for r in rows:
        name = (r.get('Business Name') or '').strip()
        if not name:
            continue
        if is_heading(r):
            headings.append(name)
            continue
        key = re.sub(r'[^a-z0-9]+', '', name.lower())
        if key in seen:
            repeats.append(name)
            continue
        seen[key] = 1
        kept.append(r)

    out = [clean(r, a.location, a.source_label, a.tags) for r in kept]

    d = os.path.dirname(a.out)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(a.out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(out)

    from collections import Counter
    print('read      %d rows' % len(rows))
    if headings:
        print('headings  %d  (dropped) %s' % (len(headings), ' | '.join(headings)))
    if repeats:
        print('repeated  %d  (dropped) %s' % (len(repeats), ' | '.join(repeats)))
    print('written   %d' % len(out))
    print('website   %d' % len([r for r in out if r['Website']]))
    print('instagram %d' % len([r for r in out if r['Instagram']]))
    print('neither   %d' % len([r for r in out if not r['Website'] and not r['Instagram']]))
    print('no industry matched: %s'
          % (', '.join(r['Company'] for r in out if not r['Industry']) or 'none'))
    print()
    for k, v in Counter(r['Industry'] or '(none)' for r in out).most_common():
        print('  %-18s %3d' % (k, v))
    return 0


if __name__ == '__main__':
    sys.exit(main())
