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


def convert_brokerage(r, source):
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
    out['Tags'] = ' | '.join([t for t in [state, 'realtor', tier.lower()] if t])

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
    if not out['Phone'] and not out['Email']:
        note.append('CHECK: no phone and no email on the list - contact through the profile page')
    elif not out['Phone']:
        note.append('CHECK: no phone on the list - email only')
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
    ap.add_argument('--against', action='append', default=[],
                    help='CSV whose leads are already in the CRM; repeatable')
    ap.add_argument('--planned', action='append', default=[],
                    help='CSV of leads allocated to somebody but not imported; reported, not dropped')
    a = ap.parse_args()

    rows = read_rows(a.source_file)
    brokerage_shape = bool(rows) and 'Brokerage' in rows[0]
    taken_e, taken_p, who, taken_n = known_from(a.against)
    plan_e, plan_p, plan_who, plan_n = known_from(a.planned)

    out, seen_e, seen_p, seen_n = [], {}, {}, {}
    already, internal, planned_hits, namesakes = [], [], [], []

    for r in rows:
        name = (r.get('Full Name') or '').strip()
        if not name:
            continue
        e, ph = key_email(r), digits(r.get('Phone Number'))
        nk, st = key_name(name), state_of(r)

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

        rec = convert_brokerage(r, a.source) if brokerage_shape else convert(r, a.source, [])
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

    from collections import Counter
    print('read           %d rows' % len(rows))
    print('already in CRM %d  (dropped)' % len(already))
    for n, m, src in already:
        print('    %-28s already there as %s  [%s]' % (n, m, src))
    print('same person twice in the file %d  (merged)' % len(internal))
    for n, how in internal:
        print('    %-28s %s' % (n, how))
    print('written        %d' % len(out))
    print('  with a phone    %d' % len([r for r in out if r['Phone']]))
    print('  with an email   %d' % len([r for r in out if r['Email']]))
    print('  with neither    %d' % len([r for r in out if not r['Phone'] and not r['Email']]))
    print('  flagged to check %d' % len([r for r in out if 'CHECK:' in r['Note']]))
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
