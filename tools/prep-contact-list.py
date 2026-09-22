"""Turn a scraped contact list into CSV the importer reads without mapping.

    python tools/prep-contact-list.py standby/fl-ny-tx-ct-raw.csv \
      --out standby/us/josh-fl-ny-tx-ct.csv \
      --source "Realtor List - FL/NY/TX/CT" \
      --against standby/us/josh.csv --against standby/us/frank-stewart.csv

Two shapes of list arrive, and the file says which one it is:

  scraped     a name, a phone, an email, and columns about where the area
              code is and what the person probably does.

  researched  the same person found on a brokerage's own site: a Brokerage,
              a service area, a profile URL, and a paragraph of evidence.
              Recognised by a Brokerage column.

Either way the row is one person and the person IS the business, so the
company name and the contact name are the same, which is how the CRM already
holds the rest of the realtor leads. An agent at Compass is still a sole
trader as far as we are concerned: Compass will not buy a mockup, she will.
The brokerage goes in the title, where a rep reads it, not in the company
name, where it would collapse thirteen separate people into one account.

Two kinds of duplicate matter and they are not the same:

  --against   people already IN the CRM. The importer would skip these
              anyway, but skipped-on-import is discovered afterwards, in a
              number nobody reads. Better to know before.

  inside the file itself. Two rows for the same person, usually the same
  email with a second phone, or the same phone with a second email. The
  second row is dropped and what was different about it is kept in the note,
  so the number is not simply lost.

A researched list can leave half its rows with no email at all, so matching
on email and phone alone would miss a repeat. Names are matched too, but a
name is weak evidence - there is more than one Maria Garcia selling houses -
so a name match only drops the row when the state agrees as well. A name
that matches in a different state is reported and kept.
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

INDUSTRY = {'realtor': 'Real Estate', 'mortgage': 'Mortgage'}

STATES = {
    'alabama': 'AL', 'california': 'CA', 'connecticut': 'CT', 'florida': 'FL',
    'georgia': 'GA', 'louisiana': 'LA', 'new jersey': 'NJ', 'new york': 'NY',
    'north carolina': 'NC', 'south carolina': 'SC', 'texas': 'TX',
}
ABBREV = dict((v, k) for k, v in STATES.items())


def digits(s):
    return re.sub(r'\D', '', s or '')


def key_email(r):
    return (r.get('Email') or '').strip().lower()


def key_name(s):
    """A name reduced to the letters in it, so punctuation and spacing do not
    hide a repeat: 'Chemaye Nickens- Smith' and 'Chemaye Nickens-Smith'."""
    return re.sub(r'[^a-z]', '', (s or '').lower())


def read_rows(path):
    return list(csv.DictReader(io.open(path, encoding='utf-8-sig')))


def state_of(r):
    """The state a row is in, whichever shape the row is. Returned lowercase
    and spelled out, so CT and Connecticut compare equal."""
    for field in ('State', 'Location', 'address'):
        v = (r.get(field) or '').strip()
        if not v:
            continue
        low = v.lower()
        for full in STATES:
            if full in low:
                return full
        tail = v.rsplit(',', 1)[-1].strip().upper()
        if tail in ABBREV:
            return ABBREV[tail]
    for t in (r.get('tags') or r.get('Tags') or '').split('|'):
        t = t.strip().lower()
        if t in STATES:
            return t
    return ''


def known_from(paths):
    """Who is already spoken for, from files whose leads are in the CRM.
    Emails and phone numbers, because a list can carry the same person under
    a different address - and names with their state, because a researched
    list can arrive with no email at all."""
    emails, phones, names, who = set(), set(), {}, {}
    for p in paths:
        for r in read_rows(p):
            e = (r.get('email') or r.get('Email') or '').strip().lower()
            ph = digits(r.get('phone') or r.get('Phone') or '')
            name = (r.get('name') or r.get('Company') or '').strip()
            src = os.path.basename(p)
            if e:
                emails.add(e)
                who.setdefault(e, (name, src))
            if ph:
                phones.add(ph)
                who.setdefault(ph, (name, src))
            nk = key_name(name)
            if nk:
                names.setdefault(nk, []).append((state_of(r), name, src))
    return emails, phones, who, names


def city_of(r):
    """'San Diego; Southern California' -> 'San Diego, California'. The full
    service area is worth keeping, but not in a column a rep scans down, so
    the first place named becomes the location and the rest goes in the note."""
    area = (r.get('City / Service Area') or '').strip()
    state = (r.get('State') or '').strip()
    if not area:
        return state
    first = re.split(r'[;/]| and (?=[A-Z])', area)[0].strip()
    first = re.sub(r'\s*\((?:areas? served|areas)\)\s*$', '', first, flags=re.I).strip()
    # The area often already names the state, spelled out or abbreviated. The
    # leading \b matters: without it "CA" matches inside "Santa Monica".
    first = re.sub(r',?\s*\b(' + re.escape(state) + r'|' + STATES.get(state.lower(), 'ZZ') + r')\b',
                   '', first, flags=re.I).strip()
    # "Glastonbury and statewide", "San Antonio and surrounding communities",
    # "Killingly and northeastern" - the place is the part before the "and".
    first = re.split(r'\s+and\s+(?:statewide|surrounding|nearby|greater|listed|the\s|'
                     r'north|south|east|west|central)', first, flags=re.I)[0].strip()
    first = re.sub(r'\s+(?:office|offices|area|areas|region|market|markets|'
                   r'communities|county)\s*$', '', first, flags=re.I).strip()
    first = re.split(r',?\s+including\s+', first, flags=re.I)[0].strip()
    # Three or four neighbourhoods is a note, not a location column.
    parts = [p.strip() for p in first.split(',') if p.strip()]
    bare = ', '.join(parts[:2]).strip().rstrip(',').strip()
    # Taking the state out of "Southern California" leaves a compass point,
    # which is not a place. The state on its own says more.
    if re.match(r'^(southern|northern|eastern|western|central)$', bare, flags=re.I):
        return state
    return (bare + ', ' + state) if bare else state


# A brokerage that publishes a number which does not ring the agent.
# Redfin gives every agent their own tracking number - distinct from every
# other, with the right local area code - that routes to the tour-and-booking
# queue. Nothing about the number gives it away, so no amount of looking for
# repeated numbers finds it. What gives it away is the brokerage: every agent
# has a phone, not one has an email, and the research never once calls the
# number a cell. William Raveis looks identical on the first two counts and is
# the opposite case - fourteen agents, no emails, and every single write-up
# says "publishes her cell number" - so the third test is the one that matters.
CELL_SAID = re.compile(r'\b(cell|mobile)\b', re.I)


def routed_brokerages(rows):
    """Brokerages whose published number reaches the company, not the person."""
    by = {}
    for r in rows:
        b = (r.get('Brokerage') or '').strip()
        if b:
            by.setdefault(b, []).append(r)
    out = {}
    for b, group in by.items():
        # Under five people it is a coincidence, not a policy.
        if len(group) < 5:
            continue
        if any((r.get('Email') or '').strip() for r in group):
            continue
        if any(CELL_SAID.search((r.get('Evidence Summary') or '') + ' ' +
                                (r.get('Active Status') or '')) for r in group):
            continue
        if all((r.get('Phone Number') or '').strip() for r in group):
            out[b] = len(group)
    return out


def reach_of(r, routed):
    """How a rep can actually get hold of this person, best route first.

    This is the tag worth filtering a call list on. A lead is not dead
    because its phone is a switchboard; it is dead because the phone is a
    switchboard and there is no email behind it."""
    email = (r.get('Email') or '').strip()
    phone = (r.get('Phone Number') or '').strip()
    said = (r.get('Evidence Summary') or '') + ' ' + (r.get('Active Status') or '')
    brokerage = (r.get('Brokerage') or '').strip()
    if phone and CELL_SAID.search(said):
        return 'reach: cell', ''
    if email:
        if brokerage in routed:
            return 'reach: email', ('CHECK: the number is ' + brokerage +
                                    "'s booking line, not theirs - use the email")
        return 'reach: email', ''
    if phone and brokerage in routed:
        return 'reach: switchboard', (
            'CHECK: ' + brokerage + ' gives each agent their own number that routes to '
            'its booking line, and publishes no email - calling this reaches the '
            'company, not them')
    if phone:
        return 'reach: phone', ''
    return 'reach: none', ''


def convert_brokerage(r, source, routed=None):
    """The researched shape: found on a brokerage's own site, with a profile
    URL and a paragraph saying why we believe they are working."""
    name = (r.get('Full Name') or '').strip()
    brokerage = (r.get('Brokerage') or '').strip()
    state = (r.get('State') or '').strip()
    tier = (r.get('Tier') or '').strip()
    out = dict((c, '') for c in COLUMNS)
    out['Company'] = name
    out['Contact'] = name
    out['Title'] = ('Realtor, ' + brokerage) if brokerage else 'Realtor'
    out['Email'] = (r.get('Email') or '').strip()
    out['Phone'] = (r.get('Phone Number') or '').strip()
    out['Website'] = (r.get('Primary Contact URL') or '').strip()
    out['Location'] = city_of(r)
    out['Industry'] = 'Real Estate'
    out['Source'] = source
    reach, warn = reach_of(r, routed or {})
    out['Tags'] = ' | '.join([t for t in [state, 'realtor', tier.lower(), reach] if t])

    note = []
    if brokerage:
        note.append('Works at ' + brokerage)
    area = (r.get('City / Service Area') or '').strip()
    if area and area != out['Location']:
        note.append('Covers ' + area)
    if (r.get('Active Status') or '').strip():
        note.append('Still working: ' + r['Active Status'].strip())
    if (r.get('Evidence Summary') or '').strip():
        note.append(r['Evidence Summary'].strip())
    # The link is the brokerage's page about them, which is the opening: it is
    # the brokerage's site, not theirs, and it goes when they leave.
    if out['Website']:
        note.append('Link above is their ' + ('brokerage' if brokerage else 'public')
                    + ' profile page, not a site of their own')
    if warn:
        note.append(warn)
    if not out['Phone'] and not out['Email']:
        note.append('CHECK: no phone and no email on the list - contact through the profile page')
    elif not out['Phone']:
        note.append('CHECK: no phone on the list - email only')
    out['Note'] = '. '.join(n.rstrip('.') for n in note) + ('.' if note else '')
    return out


ROLE_WORDS = re.compile(r'\b(manager|mr|mrs|ms|jr|sr|ii|iii|iv)\b\.?', re.I)


def bare_name(s):
    """A name with the job word and the punctuation taken out, for deciding
    whether two rows on one office line are one person or two colleagues.
    'Danielle Wendeburg Manager' and 'Danielle Wendeburg' are one."""
    return re.sub(r'[^a-z]', '', ROLE_WORDS.sub('', (s or '').lower()))


def name_parts(s):
    """First and last, with job words and punctuation gone. 'Rob LaTour' and
    'Robert La Tour' both come back as ('rob', 'latour') / ('robert','latour')
    because the surname is joined up before comparing."""
    words = [w for w in re.split(r'[^A-Za-z]+', ROLE_WORDS.sub('', s or '')) if w]
    if not words:
        return '', ''
    first = words[0].lower()
    last = ''.join(words[1:]).lower()
    return first, last


# Short forms that a prefix test cannot see, because they are not prefixes.
# Only used once the surname already matches, so the risk is small and the
# payoff is the difference between one lead and two for the same person.
NICKNAMES = {
    'robert': ['rob', 'bob', 'bobby', 'bert'],
    'joseph': ['joe', 'joey'],
    'william': ['will', 'bill', 'billy'],
    'richard': ['rick', 'dick', 'richie', 'rich'],
    'michael': ['mike', 'mick'],
    'james': ['jim', 'jimmy'],
    'john': ['jack', 'johnny'],
    'charles': ['charlie', 'chuck'],
    'thomas': ['tom', 'tommy'],
    'anthony': ['tony'],
    'edward': ['ed', 'eddie', 'ted', 'teddy'],
    'margaret': ['peggy', 'maggie'],
    'elizabeth': ['liz', 'beth', 'betty'],
    'katherine': ['kate', 'kathy', 'katie'],
    'patricia': ['pat', 'patty', 'trish', 'trisha'],
    'lawrence': ['larry'],
    'francis': ['frank'],
    'eleazar': ['eli'],
    'susan': ['sue', 'suzy'],
    'theodore': ['ted'],
    'kenneth': ['ken', 'kenny'],
    'ronald': ['ron', 'ronnie'],
    'donald': ['don', 'donnie'],
    'gerald': ['jerry'],
    'raymond': ['ray'],
    'stephen': ['steve'],
    'daniel': ['dan', 'danny'],
    'david': ['dave'],
}
CANON = {}
for _full, _shorts in NICKNAMES.items():
    CANON[_full] = _full
    for _s in _shorts:
        CANON[_s] = _full


# A job title run onto the end of the name, with no separator:
#   "Danielle Wendeburg Manager", "Constantino Fernandez Manager"
# 50 rows of one list arrive this way. Left alone the title becomes part of
# the name, so the lead is filed as a company called "Danielle Wendeburg
# Manager" - and, worse, stops looking like the same person as the
# "Danielle Wendeburg" on the other list, because the surname now reads as
# "Manager". Two leads, one person, one of them addressed wrongly.
TITLE_TAIL = re.compile(
    r'\s+(sr\.?|senior|jr\.?|junior)?\s*'
    r'(branch\s+manager|loan\s+officer|loan\s+originator|vice\s+president|'
    r'president|manager|owner|broker|partner|vp)\s*$', re.I)


def split_title(name):
    """The name, and the title that was stuck to the end of it.

    Only strips when two words are left over, so a one-word row is never
    reduced to nothing, and only matches at the end, so a "Manager" in the
    middle of something is left where it is."""
    m = TITLE_TAIL.search(name or '')
    if not m:
        return name, ''
    rest = name[:m.start()].strip()
    if len(rest.split()) < 2:
        return name, ''
    return rest, ' '.join(m.group(0).split()).title()


def surnames_match(a, b):
    """Felicia Rhodes and Felicia Kimbrough-Rhodes share a surname; Amie
    Mccarver and Abraham Mendez do not. This is the first gate, and it is
    what keeps two colleagues on one switchboard apart."""
    la, lb = name_parts(a)[1], name_parts(b)[1]
    if not la or not lb:
        return False
    return la == lb or la.endswith(lb) or lb.endswith(la)


def same_person(a, b):
    """Strong evidence only, because the cost is asymmetric: a wrong merge
    deletes a lead silently, a missed merge leaves a duplicate somebody can
    see and fix.

    Surname first, then the given name has to be the same, a shortening, or
    a known nickname. A shortening is not enough on its own - Joe is not a
    prefix of Joseph, which is exactly the sort of thing a prefix rule looks
    like it handles and does not."""
    if bare_name(a) and bare_name(a) == bare_name(b):
        return True
    if not surnames_match(a, b):
        return False
    fa, fb = name_parts(a)[0], name_parts(b)[0]
    if fa == fb:
        return True
    if CANON.get(fa, fa) == CANON.get(fb, fb):
        return True
    short, long_ = (fa, fb) if len(fa) < len(fb) else (fb, fa)
    return len(short) >= 3 and long_.startswith(short)


def convert_roster(r, source):
    """A calling roster: a name, a phone, a city, and sometimes an employer.
    No email at all, which makes the phone the only way to reach anybody -
    and therefore the only thing dedupe can key on, which is exactly why the
    shared-office-line flag below matters so much."""
    name = (r.get('Full Name') or '').strip()
    company = (r.get('Brokerage / Company') or '').strip()
    city = (r.get('City / Service Area') or '').strip()
    state = (r.get('State') or '').strip()
    title = (r.get('Job Title (source)') or 'Loan Officer').strip()
    reach = (r.get('Contactability') or '').strip()

    out = dict((c, '') for c in COLUMNS)
    out['Company'] = name
    out['Contact'] = name
    out['Title'] = (title + ', ' + company) if company else title
    out['Phone'] = (r.get('Phone Number') or '').strip()
    out['Location'] = (city + ', ' + state) if city else state
    out['Industry'] = INDUSTRY.get((r.get('Likely Vertical') or '').strip().lower(), 'Mortgage')
    out['Source'] = source
    tags = [state, 'mortgage']
    if city:
        tags.append(city.lower())
    out['Tags'] = ' | '.join([t for t in tags if t])

    note = []
    if company:
        note.append('Works at ' + company)
    if (r.get('Alt Phone') or '').strip():
        note.append('Second number: ' + r['Alt Phone'].strip())
    if (r.get('Notes') or '').strip():
        note.append(r['Notes'].strip())
    if reach == 'Toll-free line':
        note.append('CHECK: the number is a toll-free company line, not a direct one')
    if (r.get('Review Flag') or '').strip():
        note.append('CHECK: ' + r['Review Flag'].strip())
    src = (r.get('Source Type') or '').strip()
    if src:
        note.append('From ' + src)
    out['Note'] = '. '.join(n.rstrip('.') for n in note) + ('.' if note else '')
    return out


def convert(r, source, extra_note):
    name = (r.get('Full Name') or '').strip()
    vertical = (r.get('Likely Vertical') or '').strip()
    state = (r.get('State') or '').strip()
    out = dict((c, '') for c in COLUMNS)
    out['Company'] = name
    out['Contact'] = name
    out['Title'] = (r.get('Job Title (source)') or '').strip()
    out['Email'] = (r.get('Email') or '').strip()
    out['Phone'] = (r.get('Phone Number') or '').strip()
    out['Location'] = (r.get('Area Code Location') or state).strip()
    out['Industry'] = INDUSTRY.get(vertical.lower(), vertical)
    out['Source'] = source
    tags = [t for t in [state, vertical.lower()] if t]
    out['Tags'] = ' | '.join(tags)

    note = []
    if (r.get('Alt Phone') or '').strip():
        note.append('Alt phone: ' + r['Alt Phone'].strip())
    if (r.get('Alt Email') or '').strip():
        note.append('Alt email: ' + r['Alt Email'].strip())
    if (r.get('Vertical Basis') or '').strip():
        note.append('Vertical: ' + vertical + ' - ' + r['Vertical Basis'].strip())
    if (r.get('Review Flag') or '').strip():
        note.append('CHECK: ' + r['Review Flag'].strip())
    note.extend(extra_note)
    out['Note'] = '. '.join(note)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source_file')
    ap.add_argument('--out', required=True)
    ap.add_argument('--source', default='Contact List')
    ap.add_argument('--source-from', default='',
                    help='column naming each row\'s list, instead of one --source '
                         'for the file. Lets a list be split into several CRM lists '
                         'without splitting the file first, which would break dedupe '
                         'across the split.')
    ap.add_argument('--against', action='append', default=[],
                    help='CSV whose leads are already in the CRM; repeatable')
    ap.add_argument('--planned', action='append', default=[],
                    help='CSV of leads allocated to somebody but not imported; reported, not dropped')
    a = ap.parse_args()

    rows = read_rows(a.source_file)
    brokerage_shape = bool(rows) and 'Brokerage' in rows[0]
    roster_shape = bool(rows) and 'Brokerage / Company' in rows[0]
    # Worked out over the whole file, not per row: a single agent with a
    # phone and no email says nothing, a brokerage where that is true of
    # everyone is a policy.
    routed = routed_brokerages(rows) if brokerage_shape else {}
    taken_e, taken_p, who, taken_n = known_from(a.against)
    plan_e, plan_p, plan_who, plan_n = known_from(a.planned)

    out, seen_e, seen_p, seen_n = [], {}, {}, {}
    already, internal, planned_hits, namesakes = [], [], [], []
    colleagues, unreachable, shared_lines = [], [], set()
    maybe_same = []

    titled = []
    for r in rows:
        name = (r.get('Full Name') or '').strip()
        if not name:
            continue
        # Done here rather than in the converter so that dedupe sees the
        # cleaned name too - the whole point is that "Danielle Wendeburg
        # Manager" and "Danielle Wendeburg" reach same_person as one person.
        name, tail = split_title(name)
        if tail:
            titled.append((r['Full Name'].strip(), name, tail))
            r['Full Name'] = name
            if tail.lower() not in (r.get('Job Title (source)') or '').lower():
                r['Job Title (source)'] = tail
        e, ph = key_email(r), digits(r.get('Phone Number'))

        # No phone and no address is not a lead, it is a name. Importing it
        # puts a row in front of a rep that they can do nothing with, and it
        # counts towards "never called" for ever. Kept in a file of its own
        # so the research is not thrown away.
        if not e and not ph:
            unreachable.append(r)
            continue
        nk, st = key_name(name), state_of(r)

        # A switchboard is not an identity. On a roster with no email at all
        # the phone is the only key there is, and four people answering one
        # company line would collapse into one lead - the same way a shared
        # website host once ate 45 of 100 Brazil leads. The list says which
        # numbers those are, so on a flagged number the name has to agree
        # too before two rows are treated as one person.
        office_line = 'shared phone' in (r.get('Review Flag') or '').lower() \
            or (r.get('Contactability') or '').strip() == 'Toll-free line'
        if office_line:
            shared_lines.add(ph)

        if (e and e in taken_e) or (ph and ph in taken_p):
            hit = who.get(e) or who.get(ph)
            already.append((name, hit[0] if hit else '?', hit[1] if hit else '?'))
            continue

        # A name is only evidence when the state agrees; otherwise it is two
        # different people who happen to share a name, and both get called.
        same_name = taken_n.get(nk) or []
        sure = [h for h in same_name if st and h[0] == st]
        if sure:
            already.append((name, sure[0][1] + ' (same name, same state)', sure[0][2]))
            continue
        if same_name:
            namesakes.append((name, same_name[0][0] or '?', same_name[0][2]))

        # Inside the file: the same person twice. Row 0 is a real answer here,
        # so every one of these has to be tested against None, not for truth.
        first = None
        if e and e in seen_e:
            first = seen_e[e]
        elif ph and ph in seen_p:
            first = seen_p[ph]
            if office_line and not same_person(name, out[first]['Contact']):
                other = out[first]['Contact']
                phone = (r.get('Phone Number') or '').strip()
                # A shared surname on a shared line is the one case worth a
                # person's attention: probably one lead, possibly a family
                # firm. Kept apart either way, because a duplicate can be
                # seen and a deletion cannot.
                (maybe_same if surnames_match(name, other) else colleagues).append(
                    (name, other, phone))
                first = None
        elif nk in seen_n and st and seen_n[nk][1] == st:
            first = seen_n[nk][0]
        if first is not None:
            kept = out[first]
            note = []
            if ph and digits(kept['Phone']) != ph:
                note.append('Second number on the source list: ' + (r.get('Phone Number') or '').strip())
            if e and kept['Email'].lower() != e:
                note.append('Second address on the source list: ' + (r.get('Email') or '').strip())
            if note:
                kept['Note'] = (kept['Note'] + '. ' if kept['Note'] else '') + '. '.join(note)
            internal.append((name, 'same email' if e and e in seen_e else 'same phone'))
            continue

        plan_name = [h for h in (plan_n.get(nk) or []) if st and h[0] == st]
        if (e and e in plan_e) or (ph and ph in plan_p) or plan_name:
            hit = plan_who.get(e) or plan_who.get(ph) or (None, plan_name[0][2])
            planned_hits.append((name, hit[1] if hit else '?'))

        src = (r.get(a.source_from) or '').strip() if a.source_from else ''
        src = src or a.source
        rec = (convert_roster(r, src) if roster_shape
               else convert_brokerage(r, src, routed) if brokerage_shape
               else convert(r, src, []))
        idx = len(out)
        out.append(rec)
        if e:
            seen_e[e] = idx
        if ph:
            seen_p[ph] = idx
        if nk and nk not in seen_n:
            seen_n[nk] = (idx, st)

    d = os.path.dirname(a.out)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(a.out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(out)

    if unreachable:
        side = re.sub(r'\.csv$', '', a.out) + '-unreachable.csv'
        with io.open(side, 'w', encoding='utf-8-sig', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(unreachable)

    from collections import Counter
    print('read           %d rows' % len(rows))
    print('already in CRM %d  (dropped)' % len(already))
    for n, m, src in already:
        print('    %-28s already there as %s  [%s]' % (n, m, src))
    print('same person twice in the file %d  (merged)' % len(internal))
    for n, how in internal:
        print('    %-28s %s' % (n, how))
    if maybe_same:
        print('SAME SURNAME on one office line %d  (kept apart - check these)' % len(maybe_same))
        for n, other, phone in maybe_same:
            print('    %-26s and %-24s both on %s' % (n, other, phone))
    if colleagues:
        print('different people sharing an office line, kept apart %d' % len(colleagues))
        for n, other, phone in colleagues[:12]:
            print('    %-26s and %-24s both on %s' % (n, other, phone))
        if len(colleagues) > 12:
            print('    ... and %d more' % (len(colleagues) - 12))
    if unreachable:
        print('no phone and no email %d  (left out)' % len(unreachable))
        for r in unreachable[:8]:
            print('    %s' % (r.get('Full Name') or '?'))
        if len(unreachable) > 8:
            print('    ... and %d more' % (len(unreachable) - 8))
    print('written        %d' % len(out))
    print('  with a phone    %d' % len([r for r in out if r['Phone']]))
    print('  with an email   %d' % len([r for r in out if r['Email']]))
    print('  with neither    %d' % len([r for r in out if not r['Phone'] and not r['Email']]))
    print('  flagged to check %d' % len([r for r in out if 'CHECK:' in r['Note']]))
    for b, n in sorted(routed.items(), key=lambda kv: -kv[1]):
        print('  %s publishes a routed number and no email for all %d of its agents'
              % (b, n))
    if titled:
        print('  job title taken out of the name: %d  e.g. %s'
              % (len(titled), '; '.join('%s -> %s + %s' % t for t in titled[:3])))
    if namesakes:
        print()
        print('same name as a lead in another state - kept, probably not the same person: %d'
              % len(namesakes))
        for n, other_state, src in namesakes:
            print('    %-28s there in %s  [%s]' % (n, other_state, src))
    print()
    for k, v in Counter(r['Tags'].split(' | ')[0] for r in out).most_common():
        print('  %-14s %4d' % (k, v))
    if planned_hits:
        print()
        print('also allocated to somebody else (not dropped): %d' % len(planned_hits))
        for n, src in planned_hits[:10]:
            print('    %-28s in %s' % (n, src))
        if len(planned_hits) > 10:
            print('    ... and %d more' % (len(planned_hits) - 10))
    return 0


if __name__ == '__main__':
    sys.exit(main())
