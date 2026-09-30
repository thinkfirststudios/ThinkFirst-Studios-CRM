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
    # Free text like "Facebook and Instagram icons" is not a handle.
    return v if re.match(r'^[A-Za-z0-9._-]{2,40}$', v) else ''


class Lead(object):
    """One row as read, before any merging."""

    def __init__(self, row, n):
        self.src = n
        self.page = pick(row, 'page', 'screenshot', 'screenshot #', 'flyer', 'row') or str(n)
        self.name = pick(row, 'business_name', 'business name', 'company', 'company name')
        self.contact = pick(row, 'contact_name', 'contact name', 'contact', 'owner name')
        self.title = pick(row, 'contact_title', 'title', 'role')
        self.email = pick(row, 'email', 'e-mail', 'email address')
        self.website = pick(row, 'website', 'url', 'site')
        self.industry = pick(row, 'category', 'industry', 'trade', 'niche')
        self.services = pick(row, 'services', 'service', 'what they do')
        self.notes = pick(row, 'notes', 'note', 'comments')
        self.social = pick(row, 'social', 'social media', 'instagram', 'ig')
        self.address = pick(row, 'address', 'street', 'full address')
        self.city = pick(row, 'city', 'town')
        self.state = pick(row, 'state', 'st')
        self.area = pick(row, 'service_area', 'service area', 'serves')
        self.licence = pick(row, 'license', 'license #', 'licence', 'dre')
        self.has_site = pick(row, 'has_website', 'has website')
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
        h = host(self.website)
        if h:
            ks.append('d:' + h)
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
        'has_site': take('has_site'),
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


def location(m):
    if m['address']:
        a = m['address']
        if m['city'] and nm(m['city']) not in nm(a):
            a += ', ' + m['city']
        if m['state'] and (' ' + m['state'].upper()) not in a.upper():
            a += ', ' + m['state'].upper()
        return a
    if m['city']:
        # No state is added to a bare city. One flyer printed "Mexico City"
        # against two 714 numbers; writing "Mexico City, CA" onto the record
        # would be a plain untruth, and it is not needed - S.zoneOf finds no
        # state, falls back to the area code and places the lead correctly.
        return m['city'] + (', ' + m['state'].upper() if m['state'] else '')
    if m['area']:
        a = m['area']
        if m['state'] and (' ' + m['state'].upper()) not in a.upper():
            a += ', ' + m['state'].upper()
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
    for path in [a.against] + a.also:
        if not os.path.exists(path):
            print('   (not found, skipped: %s)' % path)
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
            h = host(pick(c, 'website'))
            if h:
                known.setdefault('d:' + h, comp)
            for d in all_phones(pick(c, 'phone')):
                known.setdefault('p:' + d, comp)
            known.setdefault('n:' + nm(comp), comp)
        print('   already known: %d records from %s' % (n, path))

    ready, held = [], []
    for m in merged:
        hit = ''
        for k in (['e:' + m['email'].lower()] if good_email(m['email']) else []) + \
                 (['d:' + host(m['website'])] if host(m['website']) else []) + \
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
        if 'NAME UNKNOWN' in ' '.join(m['notes']):
            tags.append('name unknown')

        rec = {
            'Company': m['name'], 'Contact': m['contact'], 'Title': m['title'],
            'Email': m['email'] if good_email(m['email']) else '',
            'Phone': tel(m['phones'][0]) if m['phones'] else '',
            'Website': site(m['website']), 'Location': loc,
            'Industry': m['industry'], 'Source': a.source, 'Est. Value': '',
            'Instagram': handle(m['social']) if re.search(r'(?i)insta|^ig\b', m['social']) else '',
            'TikTok': '', 'Facebook': '',
            'Rating': '', 'Tags': ' | '.join(tags),
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
