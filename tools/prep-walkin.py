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


def bare(url):
    return re.sub(r'^https?://(www\.)?', '', (url or '').strip(), flags=re.I)


def industry_of(text):
    low = (text or '').lower()
    for label, pattern in INDUSTRY:
        if re.search(pattern, low):
            return label
    return ''


def clean(row, location, source, tags):
    out = dict((c, '') for c in COLUMNS)
    out['Company'] = (row.get('Business Name') or '').strip()
    desc = (row.get('Description / Niche') or '').strip()
    out['Note'] = desc
    out['Location'] = location
    out['Source'] = source
    out['Tags'] = tags

    links = [row.get('Website / Link'), row.get('Social Media')]
    for raw in links:
        url = (raw or '').strip()
        if not url:
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
    out = [clean(r, a.location, a.source_label, a.tags) for r in rows if (r.get('Business Name') or '').strip()]

    d = os.path.dirname(a.out)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(a.out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(out)

    from collections import Counter
    print('read      %d rows' % len(rows))
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
