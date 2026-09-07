# Turn the realtor contact-list PDF into a CRM import CSV.
#
#   python tools/parse-realtor-pdf.py "<the pdf>" .tmp/leads/realtors.csv
#
# The PDF is a run of bordered tables under headings ("Mountain Time Zone",
# "Area Code 480 - Scottsdale, Arizona"). The headings are page text, not
# table rows, so each table is bound to the nearest heading above it and the
# section carries across page breaks.
#
# Two things the raw cells need fixing for:
#   - long emails and URLs are wrapped mid-token, which inserts a space
#     ("realtorchemayesmith@gmail. com"). Whitespace is stripped from the
#     email column outright, since an address cannot contain any.
#   - a wrap can also split a cell across the page boundary, leaving the
#     tail (".com") as its own fragment. Those are rejoined.
import csv, re, sys, unicodedata
import pdfplumber

SRC = sys.argv[1]
OUT = sys.argv[2]

HEAD_AREA = re.compile(r'^Area Code\s+(\S+)\s*[-–]\s*(.+?)\s*$')
HEAD_ZONE = re.compile(r'^([A-Za-z/ ]+?)\s+Time Zone\s*$')
HEAD_NOPH = re.compile(r'^No Phone Number on File\s*$')
HEADER_ROW = ('full name', 'phone number', 'email')

# The PDF's own verdict on the site. These phrases mean the agent cannot buy
# a website from anyone: the page belongs to their brokerage.
CORPORATE = re.compile(
    r'corporately maintained|franchise site|brokerage site|listing portal', re.I)
# ...and these mean the site they DO control is in trouble, which is the
# whole pitch. "Unclear" is deliberately NOT here: it means the researcher
# could not tell, not that anything is wrong, and it lands almost entirely
# on lender and brokerage domains.
AILING = re.compile(r'^no\b|site is down|replaced by', re.I)

# Not realtors. The list asserts every contact is a Realtor; the email
# domains say otherwise for a few hundred of them. No word boundary before
# "bank"/"loans" on purpose - corebank.com and awmloan.com have none.
LENDER = re.compile(
    r'mortgag|loans?\b|lending|lender|funding|financial|finance|bancorp|'
    r'bank|capital|escrow|lend|\bmtg\b|getarate|preferredrate|firstrate', re.I)

NOT_A_SITE = re.compile(r'not yet checked|^n/?a$|no valid email|^\s*$', re.I)


def clean(s):
    if not s:
        return ''
    s = unicodedata.normalize('NFKC', s)
    return re.sub(r'\s+', ' ', s.replace('\n', ' ')).strip()


def tidy_email(s):
    """An address never contains whitespace, so any is a wrap artefact."""
    s = re.sub(r'\s+', '', clean(s))
    return '' if NOT_A_SITE.match(s) or '@' not in s else s


def tidy_site(s):
    """Keep the parenthetical notes, but heal tokens split across a wrap."""
    s = clean(s)
    if NOT_A_SITE.search(s):
        return ''
    s = re.sub(r'(?<=[\w/-])\s+(?=(com|net|org|us|co|io|biz|realtor|mortgage)\b)', '', s)
    s = re.sub(r'\s*\.\s*(?=(com|net|org|us|co|io|biz))', '.', s)
    return s


def first_domain(site):
    m = re.search(r'([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)', site.lower())
    return m.group(1) if m else ''


rows, section, zone = [], '', ''
with pdfplumber.open(SRC) as pdf:
    for page in pdf.pages:
        lines = page.extract_text_lines() or []
        marks = []
        for ln in lines:
            t = clean(ln['text'])
            if HEAD_ZONE.match(t) and 'Job Title' not in t:
                marks.append((ln['top'], 'zone', HEAD_ZONE.match(t).group(1)))
            elif HEAD_AREA.match(t):
                marks.append((ln['top'], 'area', t))
            elif HEAD_NOPH.match(t):
                marks.append((ln['top'], 'area', 'No Phone Number on File'))

        for tbl in page.find_tables():
            top = tbl.bbox[1]
            for mtop, kind, val in marks:
                if mtop < top:
                    if kind == 'zone':
                        zone = val
                    else:
                        section = val
            for r in tbl.extract():
                cells = [clean(c) for c in r] + [''] * 6
                name = cells[0]
                if not name or name.lower() in HEADER_ROW:
                    continue
                if name.lower().startswith('job title'):
                    continue
                rows.append({
                    'name': name,
                    'phone': clean(cells[1]),
                    'email': tidy_email(cells[2]),
                    'website': tidy_site(cells[3]),
                    'era': clean(cells[4]),
                    'current': clean(cells[5]),
                    'section': section,
                    'zone': zone,
                })

# A row whose name is only a wrap fragment (".com", "search)") belongs to the
# row above it, not to a person.
merged = []
for r in rows:
    if re.fullmatch(r'[.\w-]{0,12}|search\)|com|m|om', r['name']) and merged:
        continue
    merged.append(r)
rows = merged

# A domain many different people share is a brokerage, not a personal site.
# kw.com appears 114 times; nobody is buying a redesign of that. Counting
# beats a hand-kept blocklist, which would go stale and miss regional firms.
from collections import Counter
dom_users = Counter()
for r in rows:
    d_ = first_domain(r['website'])
    if d_:
        dom_users[d_] += 1
SHARED = {d_ for d_, n in dom_users.items() if n >= 3}

out = []
for r in rows:
    site = r['website']
    dom = first_domain(site)
    verdict = r['current'] + ' ' + r['era']
    corporate = bool(CORPORATE.search(verdict))
    haystack = (r['email'] + ' ' + site).lower()
    lender = bool(LENDER.search(haystack))

    if lender:
        rating, bucket = 'cold', 'not-a-realtor'
    elif not dom:
        rating, bucket = 'cold', 'no-site-found'
    elif corporate or dom in SHARED:
        rating, bucket = 'cold', 'brokerage-page'
    elif AILING.search(r['current']):
        rating, bucket = 'hot', 'own-site'
    else:
        rating, bucket = 'warm', 'own-site'

    m = HEAD_AREA.match(r['section'])
    area, place = (m.group(1), m.group(2)) if m else ('', r['section'])

    tags = ['realtor', bucket]
    if AILING.search(r['current']):
        tags.append('site-broken')

    # What the source list actually knew, carried onto the lead, so nobody
    # has to reopen the PDF to find out whether the site was ever checked.
    note = 'From the realtor contact list. '
    note += ('Site: %s. ' % site) if site else 'No site listed. '
    if r['era'] and 'not yet checked' not in r['era'].lower():
        note += 'Built: %s. ' % r['era']
    note += 'Up to date: %s.' % (r['current'] or 'unknown')
    if bucket == 'brokerage-page':
        note += ' Brokerage page, not their own site.'
    if bucket == 'not-a-realtor':
        note += ' Address suggests mortgage/lending, not a realtor.'

    out.append({
        'name': r['name'],
        'contactName': r['name'],
        'contactTitle': 'Realtor',
        'email': r['email'],
        'phone': r['phone'],
        'website': dom,
        'industry': 'Real Estate',
        'address': place,
        'rating': rating,
        'source': 'Realtor List',
        'tags': '|'.join(tags),
        'notes': note,
        'areaCode': area,
        'timeZone': r['zone'],
        'siteEra': r['era'],
        'siteCurrent': r['current'],
        'siteRaw': site,
    })

with open(OUT, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)

print('rows extracted:', len(out))
for k in ('hot', 'warm', 'cold'):
    print('  %-5s %d' % (k, sum(1 for r in out if r['rating'] == k)))
print('  with email   ', sum(1 for r in out if r['email']))
print('  with phone   ', sum(1 for r in out if r['phone']))
print('  own site     ', sum(1 for r in out if 'own-site' in r['tags']))
print('  brokerage    ', sum(1 for r in out if 'brokerage-page' in r['tags']))
print('  no site found', sum(1 for r in out if 'no-site-found' in r['tags']))
print('  not realtors ', sum(1 for r in out if 'not-a-realtor' in r['tags']))
print('  site broken  ', sum(1 for r in out if 'site-broken' in r['tags']))
print('  sections     ', len({r['address'] for r in out}))
print('->', OUT)
