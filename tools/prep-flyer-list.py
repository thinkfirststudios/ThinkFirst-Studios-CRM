# -*- coding: utf-8 -*-
"""Prepare a hand-extracted flyer lead list for the CRM importer.

    python tools/prep-flyer-list.py --in raw.csv --out ready.csv
                                    [--against .tmp/crm-export.csv]
                                    [--also standby/us/oc-home-services.csv]
                                    [--source "Facebook flyers"]

WHY THIS EXISTS

Two separate things go wrong with these lists, and both are silent.

1. The importer maps a column only when its header matches an alias it knows
   (ALIASES in js/views/leads.js). An unknown header is dropped without a
   word. West_Coast_Batch_1.csv arrived with `services` - the single most
   useful column in the file, what the business actually does - plus
   `has_website`, `social`, `city`, `state` and `duplicate_of_page`, none of
   which the CRM has ever heard of. Seven of fifteen columns would have gone
   in the bin and the dialog would have said nothing.

2. The importer's duplicate check is S.leadKey, which returns the FIRST
   thing it finds: email, then social handle, then domain, then name. It
   stops there. So the same business keys differently depending on which
   details the particular row happens to carry, and two rows for one
   business slide straight past each other:

     page 19  A&N Coastal Hauling  website www.anhauling.com  -> d:anhauling.com
     page 25  A&N Coastal Hauling  no website                 -> n:ancoastalhauling...

   Same business, same phone, two records. A flyer list hits this constantly,
   because whoever typed it up saw a website on one flyer and not the other.
   The phone is never in the key at all, which is the one thing every flyer
   does print.

   So this tool groups the rows itself - on phone, email, domain and name
   together rather than on the first one that answers - merges each group
   into the richest single row, and only then checks against the CRM the same
   four ways. What comes out the far side is one row per business.

Handles both header dialects seen so far: snake_case (`business_name`,
`contact_name`) and Title Case (`Business Name`, `Phone 2`, `Service Area`).

Python rather than the PowerShell it replaces: tools/ is Python by
convention, and the note in prep-flyer-list.ps1 saying no Python runtime was
installed is no longer true.
"""
import argparse
import csv
import io
import os
import re
import sys

OUT_COLS = ['Company', 'Contact', 'Title', 'Email', 'Phone', 'Website',
            'Location', 'Industry', 'Source', 'Est. Value', 'Instagram',
            'TikTok', 'Facebook', 'Rating', 'Tags', 'Note']

# The state a number sits in, for the Location the flyer did not print. The
# CRM derives the coast from the state in Location and falls back to the area
# code (S.zoneOf), so a row with neither is a row no coast filter can see.
AREA_STATE = {}
for _codes, _st in [
    ('209 213 279 310 323 341 350 408 415 424 442 510 530 559 562 619 626 628 '
     '650 657 661 669 707 714 747 760 805 818 820 831 840 858 859 909 916 925 '
     '935 949 951', 'CA'),
    ('480 520 602 623 928', 'AZ'),
    ('503 541 458 971', 'OR'),
    ('206 253 360 425 509 564', 'WA'),
    ('702 725 775', 'NV'),
    ('208 986', 'ID'),
    ('801 385 435', 'UT'),
    ('303 719 720 970', 'CO'),
    ('406', 'MT'), ('307', 'WY'), ('505 575', 'NM'),
    ('314 417 573 636 660 816', 'MO'),
    # Includes the newer overlays - 689 over Orlando, 656 over Tampa, 448
    # over the panhandle, 324 over Ocala, 645 over Miami, 728 over Palm
    # Beach. Leaving 689 out put a lead's Location at "Orlando" with no
    # state on it, which no state-matching in the CRM can read.
    ('239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 '
     '813 850 863 904 941 954', 'FL'),
    ('808', 'HI'), ('907', 'AK'),
]:
    for _c in _codes.split():
        AREA_STATE[_c] = _st

WEST = ('CA', 'OR', 'WA', 'NV')
TOLL_FREE = set('800 833 844 855 866 877 888'.split())

# The part of the state a number dials into, for the two thirds of these
# flyers that print a phone and no address at all. "FL" on its own is not a
# Location - a rep opening the record learns nothing from it and cannot tell
# a Jacksonville lead from a Naples one, three hundred miles apart. The area
# code does tell them, and it is on every single flyer.
#
# Written as the region rather than one city, because that is what the code
# actually evidences: 352 is Ocala AND Gainesville, and claiming either one
# specifically would be inventing detail the flyer never carried. Where this
# is used the Note says so, so nobody mistakes it for a printed address.
AREA_METRO = {}
for _codes, _metro in [
    ('305 786 645', 'Miami-Dade'),
    ('954 754', 'Fort Lauderdale / Broward'),
    ('561 728', 'Palm Beach County'),
    ('772', 'Treasure Coast (Port St Lucie / Stuart / Vero Beach)'),
    ('321', 'Space Coast / Orlando'),
    ('407 689', 'Orlando'),
    ('352 324', 'Ocala / Gainesville'),
    ('386', 'Daytona Beach / Palatka'),
    ('904', 'Jacksonville / St Augustine'),
    ('813 656', 'Tampa'),
    ('727', 'St Petersburg / Clearwater'),
    ('941', 'Sarasota / Bradenton / Port Charlotte'),
    ('239', 'Fort Myers / Naples / Cape Coral'),
    ('863', 'Lakeland / Winter Haven / Sebring'),
    ('850 448', 'Florida Panhandle'),
]:
    for _c in _codes.split():
        AREA_METRO[_c] = _metro


def looks_like_site(v):
    """Is this a website, or somebody describing one?

    The Facebook-group exports put a site, a social handle and a plain
    English note in one "Website / Social" column, and 41 of 77 rows in
    one batch simply said "Facebook page". Taking that as a website would
    have marked 41 businesses as HAVING a site when the column was saying
    the opposite - and "no website" is the whole reason any of them is a
    lead. So a value only counts as a site if it actually looks like a
    host: a dot, a plausible TLD, and no spaces in the domain part.
    """
    v = (v or '').strip()
    if not v:
        return False
    v = re.split(r'[;,]', v)[0].strip()
    host = re.sub(r'^https?://', '', v, flags=re.I)
    host = re.sub(r'^www\.', '', host, flags=re.I).split('/')[0]
    if ' ' in host or '.' not in host:
        return False
    # A page on a social platform is not a website. These are the hosts a
    # lead would point at INSTEAD of having a site, which is the opposite
    # of what this column is being read for.
    if re.match(r'^(m\.)?(facebook|fb|instagram|tiktok|twitter|x|linkedin|'
                r'youtube|linktr|beacons|change|yelp|nextdoor)\.',
                host, re.I):
        return False
    return bool(re.match(r'^[a-z0-9.-]+\.[a-z]{2,}$', host, re.I))


def pick(row, *names):
    """The first of these headers the file actually has, case/underscore blind."""
    for n in names:
        for k in row:
            if k is None:
                continue
            a = re.sub(r'[^a-z0-9]', '', k.lower())
            b = re.sub(r'[^a-z0-9]', '', n.lower())
            if a == b:
                return (row[k] or '').strip()
    return ''


def digits(s):
    d = re.sub(r'\D', '', s or '')
    if len(d) == 11 and d.startswith('1'):
        d = d[1:]
    return d if len(d) == 10 else ''


def all_phones(cell):
    """A flyer prints two numbers in one cell more often than not."""
    out = []
    for part in re.split(r'[/;,|]|\bor\b|\band\b', cell or ''):
        d = digits(part)
        if d and d not in out:
            out.append(d)
    if not out:
        # One run of digits with no separator we recognise.
        d = digits(cell)
        if d:
            out = [d]
    if not out:
        # Not a North American number, so digits() rejected it - a Botswana
        # WhatsApp number is still the only way to reach that business, and
        # dropping it left a lead with no phone at all.
        d = re.sub(r'\D', '', cell or '')
        if len(d) >= 7:
            out = [d]
    return out


def tel(d):
    return '(%s) %s-%s' % (d[:3], d[3:6], d[6:]) if len(d) == 10 else d


STATES = set((
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS '
    'MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV '
    'WI WY DC'
).split())


def state_of(m, loc):
    """The state, only where something actually said so.

    Never guessed from a city: taking the first two letters of "Woodland
    Hills" gave WO, which is in no list of states, so a Los Angeles
    electrician was tagged as not being on the west coast.
    """
    if m['state'] and m['state'].strip().upper()[:2] in STATES:
        return m['state'].strip().upper()[:2]
    # "City, ST" or "City, ST 92841" at the end of a printed address.
    tail = re.findall(r'\b([A-Z]{2})\b(?:\s+\d{5})?\s*$', (loc or '').upper())
    if tail and tail[-1] in STATES:
        return tail[-1]
    for d in m['phones']:
        st = AREA_STATE.get(d[:3])
        if st:
            return st
    return ''


def site(s):
    v = re.sub(r'^https?://', '', (s or '').strip(), flags=re.I)
    v = re.sub(r'^www\.', '', v, flags=re.I)
    return v.rstrip('/').strip()


# Hosts where the PATH is the business and the domain is shared by
# everyone on it. Keying on the domain made "Nick Allen Plumbing" at
# sites.google.com/view/nick-allen-plumbing and "Xtreme Paintball" at
# sites.google.com/view/xtreme-paintball-and-laser-tag the same lead, so a
# real paintball park was held back as a duplicate of a plumber. This is
# the same rule js/store.js already applies in SHARED_HOSTS; the tool was
# missing it.
SHARED_HOST = re.compile(
    r'^(m\.)?('
    # Only hosts where the PATH is the business and the bare domain is
    # shared by everyone. A builder that gives each customer their own
    # SUBDOMAIN - cqb-city.square.site, vaultlegacy.wixsite.com - is NOT
    # one of these: the host already identifies the business, and treating
    # it as shared would send a lead with a path and the same lead without
    # one down two different rungs, which is the bug this is meant to stop.
    r'sites\.google\.com|'
    r'facebook\.com|fb\.com|fb\.me|instagram\.com|tiktok\.com|'
    r'linkedin\.com|twitter\.com|x\.com|youtube\.com|'
    r'linktr\.ee|beacons\.ai|carrd\.co|yelp\.com|nextdoor\.com|'
    r'redfin\.com|coldwellbanker\.com|compass\.com|har\.com|'
    r'zillow\.com|realtor\.com|century21\.com|sevengables\.com|'
    r'designatedlocalexpert\.com|'
    # Booking and marketplace pages, where a trainer with no site of their
    # own sends people instead. PerfectFiit at vagaro.com/perfectfiit was
    # held back as a duplicate of a hair salon elsewhere on vagaro.com.
    # Kept in step with SHARED_HOSTS in js/store.js.
    r'vagaro\.com|mysite\.vagaro\.com|calendly\.com|book\.squareup\.com|'
    r'setmore\.com|acuityscheduling\.com|booksy\.com|skillest\.com|'
    r'thumbtack\.com'
    r')$', re.I)


def site_key(u):
    """The key that identifies the BUSINESS behind a URL.

    A page on a shared platform is identified by its path; anywhere else,
    by its domain. With no path on a shared host there is nothing to
    identify, so the caller falls through to the name.
    """
    raw = site(u).lower()
    if not raw:
        return ''
    h = raw.split('/')[0]
    path = raw[len(h):].strip('/').split('?')[0].split('#')[0]
    if SHARED_HOST.match(h):
        return 's:' + h + '/' + path if path else ''
    return 'd:' + h


def host(s):
    return re.split(r'[/?#]', site(s))[0].lower()


def nm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def good_email(e):
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', (e or '').strip(), re.I))


def handle(s):
    """"IG @jq_poop_patrol", a bare handle, or a full URL."""
    v = re.sub(r'(?i)^\s*(ig|insta|instagram|fb|facebook|tiktok|tt)\b[:\s@]*', '', (s or '').strip())
    v = re.sub(r'(?i)^https?://', '', v)
    v = re.sub(r'(?i)^www\.', '', v)
    v = re.sub(r'(?i)^(instagram|facebook|tiktok)\.com/', '', v)
    v = v.split('?')[0].strip().lstrip('@').rstrip('/').strip()
    # "@banfieldsbarbershop (unconfirmed)" is a handle and a doubt.
    # Keep the handle; the doubt is already in the note.
    v = re.sub(r'\s*\([^)]*\)\s*$', '', v).strip()
    # Free text like "Facebook and Instagram icons" is not a handle.
    return v if re.match(r'^[A-Za-z0-9._-]{2,40}$', v) else ''


def is_ig_value(s):
    """Does this social value name an Instagram account?

    "IG @x" and an instagram.com URL say so. So does a bare
    "@x" - nothing but a handle is written that way, and the
    researched lists put one in every row of a column headed
    Instagram. Without the last case all 140 were dropped.
    """
    s = (s or '').strip()
    return bool(s.startswith('@')
                or re.search(r'(?i)insta|^ig\b', s))


class Lead(object):
    """One row as read, before any merging."""

    def __init__(self, row, n):
        self.src = n
        self.page = pick(row, 'page', 'screenshot', 'screenshot #', 'flyer', 'row') or str(n)
        self.name = pick(row, 'business_name', 'business name', 'company', 'company name')
        self.contact = pick(row, 'contact_name', 'contact name', 'contact', 'owner name')
        self.title = pick(row, 'contact_title', 'title', 'role')
        self.email = pick(row, 'email', 'e-mail', 'email address')
        # 'Website / Social' is one column on the Facebook-group exports -
        # a site for some, a Facebook page or an IG handle for others. It
        # normalises to 'websitesocial', which matched none of the aliases,
        # so every website in a 77-row batch was being dropped in silence.
        raw_site = pick(row, 'website', 'url', 'site',
                        'website social', 'website / social', 'web social')
        # A social URL in this column is a social handle, not a website -
        # see looks_like_site. Anything that is neither is kept as a note
        # rather than thrown away, because "Facebook page" is telling us
        # something true about the lead even though it is not a website.
        self.website = raw_site if looks_like_site(raw_site) else ''
        self.site_note = '' if self.website else raw_site
        self.industry = pick(row, 'category', 'industry', 'trade', 'niche')
        self.services = pick(row, 'services', 'service', 'what they do')
        self.notes = pick(row, 'notes', 'note', 'comments')
        self.social = pick(row, 'social', 'social media', 'instagram', 'ig')
        if not self.social and not self.website:
            self.social = raw_site
        # Same shape: 'Street Address' normalises to 'streetaddress'.
        self.address = pick(row, 'address', 'street', 'full address',
                            'street address', 'mailing address')
        self.city = pick(row, 'city', 'town')
        self.state = pick(row, 'state', 'st')
        self.area = pick(row, 'service_area', 'service area', 'serves')
        self.licence = pick(row, 'license', 'license #', 'licence', 'dre')
        # A researched list has already judged the lead. That judgement is
        # worth more as the CRM's own rating, which the list filters on,
        # than as a tag nobody looks at. Only the three the CRM knows are
        # accepted - anything else falls through to the import default
        # rather than inventing a fourth rating no badge can draw.
        rat = pick(row, 'rating', 'fit_rating', 'fit').strip().lower()
        self.rating = rat if rat in ('hot', 'warm', 'cold') else ''
        self.has_site = pick(row, 'has_website', 'has website')
        # Tags the upstream adapter worked out and this tool cannot:
        # that a lead has already said no, and that there is no way to
        # reach it at all. Split on commas because that is what
        # S.parseTags does, so a welded tag never gets built here.
        self.extra_tags = [t.strip() for t in
                           pick(row, 'extra_tags', 'extra tags').split(',')
                           if t.strip()]
        self.dup_of = pick(row, 'duplicate_of_page', 'duplicate of page', 'duplicate of')
        self.phones = all_phones(pick(row, 'phone', 'phone number', 'telephone', 'mobile'))
        p2 = all_phones(pick(row, 'phone_2', 'phone 2', 'second phone', 'alt phone'))
        for d in p2:
            if d not in self.phones:
                self.phones.append(d)

    def filled(self):
        """How much this row actually carries - the richest one wins a merge."""
        return sum(1 for v in (self.name, self.contact, self.email, self.website,
                               self.services, self.notes, self.address, self.city,
                               self.social, self.title, self.licence) if v) + len(self.phones)

    def keys(self):
        """Every way this row could be the same business as another one."""
        ks = []
        if good_email(self.email):
            ks.append('e:' + self.email.lower())
        k = site_key(self.website)
        if k:
            ks.append(k)
        for d in self.phones:
            ks.append('p:' + d)
        if self.name:
            ks.append('n:' + nm(self.name))
        return ks


def group(leads):
    """Union-find over every shared identifier, not just the first one."""
    parent = list(range(len(leads)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    first = {}
    for i, l in enumerate(leads):
        for k in l.keys():
            if k in first:
                union(first[k], i)
            else:
                first[k] = i

    out = {}
    for i in range(len(leads)):
        out.setdefault(find(i), []).append(leads[i])
    return [out[k] for k in sorted(out)]


def merge(grp):
    """One business out of however many rows mention it."""
    grp = sorted(grp, key=lambda l: (-l.filled(), l.src))
    best = grp[0]
    extra = grp[1:]

    def take(attr):
        for l in grp:
            v = getattr(l, attr)
            if v:
                return v
        return ''

    m = {
        'name': take('name'), 'contact': take('contact'), 'title': take('title'),
        'email': take('email'), 'website': take('website'),
        'industry': take('industry'), 'address': take('address'),
        'city': take('city'), 'state': take('state'), 'area': take('area'),
        'licence': take('licence'), 'social': take('social'),
        'rating': take('rating'),
        'has_site': take('has_site'),
        'extra_tags': sorted(set(t for l in grp for t in l.extra_tags)),
    }
    phones, svc, notes, pages = [], [], [], []
    for l in grp:
        for d in l.phones:
            if d not in phones:
                phones.append(d)
        for text, bag in ((l.services, svc), (l.notes, notes)):
            t = (text or '').strip()
            if t and t not in bag:
                bag.append(t)
        pages.append(l.page)
    m['phones'] = phones
    m['services'] = svc
    m['notes'] = notes
    m['pages'] = pages
    m['merged'] = len(extra)
    m['rows'] = grp
    return m


PLACEHOLDER = re.compile(
    r'^\s*[\[(]?\s*(not\s+(listed|found|given|available|checked|stated)'
    r'|none|n/?a|unknown|tbd|\?+)\s*[\])]?\s*$', re.I)


def place(v):
    """A place name, or nothing if somebody was describing its absence.

    "(not listed)" is a note about the research, not a city, and it was
    reaching the CRM's Location field as though it were one.
    """
    v = (v or '').strip()
    return '' if PLACEHOLDER.match(v) else v


# A state the CRM cannot read from its abbreviation, so spell it out. See
# the ZONE_STATE_ABBR comment in js/store.js for why SC is the only one.
SPELL_OUT = {'SC': 'South Carolina'}


def st_out(v):
    v = (v or '').strip().upper()
    return SPELL_OUT.get(v, v)


def location(m):
    city = place(m['city'])
    state = st_out(m['state'])
    addr = place(m['address'])
    if addr:
        a = addr
        if city and nm(city) not in nm(a):
            a += ', ' + city
        if state and (' ' + state.upper()) not in a.upper():
            a += ', ' + state
        return a
    if city:
        # No state is added to a bare city. One flyer printed "Mexico City"
        # against two 714 numbers; writing "Mexico City, CA" onto the record
        # would be a plain untruth, and it is not needed - S.zoneOf finds no
        # state, falls back to the area code and places the lead correctly.
        return city + (', ' + state if state else '')
    if m['area']:
        a = m['area']
        if state and (' ' + state.upper()) not in a.upper():
            a += ', ' + state
        return a
    # Nothing printed a location at all, which is two flyers in three. The
    # area code is the only evidence there is, and it is better evidence
    # than it looks: these are local trades advertising to a local group.
    # A toll-free number evidences nothing, so it is skipped rather than
    # guessed at.
    for d in m['phones']:
        if d[:3] in TOLL_FREE:
            continue
        metro = AREA_METRO.get(d[:3])
        st = AREA_STATE.get(d[:3])
        if metro:
            return metro + (', ' + st if st else '')
        if st:
            return st
    return ''


def location_printed(m):
    """Did the flyer actually say where they are, or did we work it out?"""
    return bool(m['address'] or m['city'] or m['area'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', dest='out', required=True)
    ap.add_argument('--against', default='.tmp/crm-export.csv')
    ap.add_argument('--also', action='append', default=[],
                    help='another list already imported, checked the same way')
    ap.add_argument('--source', default='')
    ap.add_argument('--allow-missing', dest='allow_missing', action='store_true',
                    help='proceed even if a named --also/--against file is absent')
    a = ap.parse_args()

    rows = list(csv.DictReader(io.open(a.inp, encoding='utf-8-sig')))
    leads = [Lead(r, i + 1) for i, r in enumerate(rows)]
    print('read %d rows from %s' % (len(leads), a.inp))

    # A row with no business name is still a business. Three of the four in
    # batch 1 printed the owner's name and nothing else - a sole trader IS
    # their name - and the importer would have dropped all four in silence.
    unnamed, from_owner = [], []
    for l in leads:
        if l.name:
            continue
        if l.contact:
            l.name = l.contact
            l.contact = ''
            l.notes = (l.notes + '; ' if l.notes else '') + 'Trades under the owner name'
            from_owner.append(l)
        else:
            trade = l.industry or 'Business'
            l.name = '%s - %s' % (trade, tel(l.phones[0]) if l.phones else 'no number')
            l.notes = (l.notes + '; ' if l.notes else '') + 'NAME UNKNOWN - flyer printed no business name'
        unnamed.append(l)

    groups = group(leads)
    merged = [merge(g) for g in groups]
    print('%d rows -> %d distinct businesses' % (len(leads), len(merged)))

    # What is already in the book, keyed every way rather than the first way.
    known = {}
    # A list that was named and did not arrive is the one failure here that
    # looks like success. The de-duplication simply runs against less, every
    # count in the summary stays plausible, and the duplicates ship.
    #
    # It has now happened twice. The first time, Airsoft_Leads_READY.csv had
    # been moved out of Downloads and the overlap was caught only because
    # the researcher happened to have flagged it. The second time, four of
    # the five Young Owner lists had been uploaded and tidied away, and the
    # run would have compared this batch against one industry out of five.
    #
    # So: named and missing is a hard stop. --allow-missing is there for the
    # case where a list is genuinely gone and the operator has decided to
    # proceed without it, which is a decision rather than an accident.
    gone = [p for p in [a.against] + a.also if not os.path.exists(p)]
    if gone and not a.allow_missing:
        raise SystemExit(
            'STOPPED - these lists were named for de-duplication but do not\n'
            'exist, so the run would quietly compare against less than you\n'
            'asked for:\n  ' + '\n  '.join(gone)
            + '\n\nFind them, or pass --allow-missing to proceed deliberately.')
    for path in [a.against] + a.also:
        if not os.path.exists(path):
            print('   (NOT FOUND, skipped by --allow-missing: %s)' % path)
            continue
        n = 0
        for c in csv.DictReader(io.open(path, encoding='utf-8-sig')):
            comp = pick(c, 'company', 'company name', 'business name')
            if not comp:
                continue
            n += 1
            em = pick(c, 'email')
            if good_email(em):
                known.setdefault('e:' + em.lower(), comp)
            k = site_key(pick(c, 'website'))
            if k:
                known.setdefault(k, comp)
            for d in all_phones(pick(c, 'phone')):
                known.setdefault('p:' + d, comp)
            known.setdefault('n:' + nm(comp), comp)
        print('   already known: %d records from %s' % (n, path))

    ready, held = [], []
    for m in merged:
        hit = ''
        for k in (['e:' + m['email'].lower()] if good_email(m['email']) else []) + \
                 ([site_key(m['website'])] if site_key(m['website']) else []) + \
                 ['p:' + d for d in m['phones']] + \
                 (['n:' + nm(m['name'])] if m['name'] else []):
            if k in known:
                hit = known[k]
                break

        note, tags = [], []
        if m['services']:
            note.append('Services: ' + '; '.join(m['services']))
        note.extend(m['notes'])
        if len(m['phones']) > 1:
            note.append('Other numbers: ' + ', '.join(tel(d) for d in m['phones'][1:]))
            tags.append('second number')
        if m['email'] and not good_email(m['email']):
            note.append('Email on the flyer is incomplete: ' + m['email'])
            tags.append('email incomplete')
        if m['social'] and not handle(m['social']):
            note.append('Social: ' + m['social'])
        if m['licence']:
            note.append('Licence ' + m['licence'])
        if m['area'] and m['address']:
            note.append('Serves ' + m['area'])
        if m['merged']:
            note.append('Appeared on %d flyers (pages %s)' % (len(m['pages']), ', '.join(m['pages'])))
        else:
            note.append('Flyer page ' + m['pages'][0])

        if m['industry']:
            tags.append(m['industry'].lower())
        loc = location(m)
        if loc and not location_printed(m):
            # Said out loud, so nobody reads a worked-out region as an
            # address the business actually printed.
            note.append('Location worked out from the ' + m['phones'][0][:3]
                        + ' area code - the flyer gave no address')
            tags.append('location from area code')
        st = state_of(m, loc)
        if st and st not in WEST:
            tags.append('not west coast')
        elif not st:
            tags.append('state unknown')
        if not m['phones']:
            tags.append('no phone')
        elif m['phones'][0][:3] in TOLL_FREE:
            tags.append('toll free')
        elif len(m['phones'][0]) != 10:
            # Not a North American number, so the business is not in North
            # America. S.zoneOf files it under "Zone unknown" rather than
            # "Outside the US" unless the Location names the country, so the
            # tag is what makes it findable.
            tags.append('outside the us')
        if not host(m['website']):
            tags.append('no website')
            if handle(m['social']):
                tags.append('social only')
        for t in m.get('extra_tags', []):
            if t not in tags:
                tags.insert(0, t)
        if 'NAME UNKNOWN' in ' '.join(m['notes']):
            tags.append('name unknown')

        rec = {
            'Company': m['name'], 'Contact': m['contact'], 'Title': m['title'],
            'Email': m['email'] if good_email(m['email']) else '',
            'Phone': tel(m['phones'][0]) if m['phones'] else '',
            'Website': site(m['website']), 'Location': loc,
            'Industry': m['industry'], 'Source': a.source, 'Est. Value': '',
            # A leading @ is a handle - see is_ig_value.
            'Instagram': handle(m['social']) if is_ig_value(m['social']) else '',
            'TikTok': '', 'Facebook': '',
            'Rating': m['rating'],
            # Commas, because S.parseTags splits on commas and nothing else.
            # A pipe-joined cell arrives as one long tag rather than several,
            # which is how 1,500 leads ended up carrying a single tag reading
            # "realtor | no-site-found".
            'Tags': ', '.join(t.replace(',', ' ').strip() for t in tags),
            'Note': '. '.join(x.rstrip('.') for x in note if x) + '.',
        }
        if hit:
            rec['_already'] = hit
            held.append(rec)
        else:
            ready.append(rec)

    with io.open(a.out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=OUT_COLS)
        w.writeheader()
        for r in ready:
            w.writerow(dict((k, r.get(k, '')) for k in OUT_COLS))

    print('')
    print('ready to import : %d  ->  %s' % (len(ready), a.out))
    print('already in book : %d (held back)' % len(held))
    for r in held:
        print('     %-38s already there as %s' % (r['Company'][:38], r['_already']))

    # Where the file's own duplicate column and this tool disagree, say so.
    flagged = set()
    for l in leads:
        if l.dup_of:
            flagged.add(l.page)
    if flagged:
        # A flagged row counts as handled when it ended up in the SAME group
        # as the page it points at - not when it is the row the merge happened
        # to keep, which is an accident of which flyer carried more detail.
        where = {}
        for i, m in enumerate(merged):
            for p in m['pages']:
                where[p] = i
        print('')
        missed = []
        for l in leads:
            if not l.dup_of:
                continue
            tgt = l.dup_of.strip()
            if where.get(l.page) != where.get(tgt):
                missed.append('%s -> %s' % (l.page, tgt))
        print('the file flagged %d rows as duplicates; all %d landed in the same '
              'record as the page they point at'
              % (len(flagged), len(flagged) - len(missed))
              if not missed else
              'the file flagged %d rows as duplicates; %d did NOT merge: %s'
              % (len(flagged), len(missed), ', '.join(missed)))

    print('')
    print('   merged from more than one flyer : %d' % len([m for m in merged if m['merged']]))
    print('   name taken from the owner       : %d' % len(from_owner))
    print('   no name on the flyer at all     : %d' % (len(unnamed) - len(from_owner)))
    print('   no website                      : %d' % len([r for r in ready if 'no website' in r['Tags']]))
    print('   not west coast                  : %d' % len([r for r in ready if 'not west coast' in r['Tags']]))
    print('   no Location the CRM can read    : %d' % len([r for r in ready if not r['Location']]))
    print('   no phone                        : %d' % len([r for r in ready if not r['Phone']]))


if __name__ == '__main__':
    main()
