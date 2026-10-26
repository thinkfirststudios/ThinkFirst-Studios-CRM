# -*- coding: utf-8 -*-
"""Fold a researched lead sheet into the shape the flyer prep tool reads.

    python tools/prep-research-list.py --in TFS_Airsoft_Leads_East_Coast.csv \
                                       --in TFS_Airsoft_Leads_West_Coast.csv \
                                       --out .tmp/airsoft-raw.csv

WHY THIS IS SEPARATE

A flyer list is a photograph and whatever could be read off it. A
researched list is the opposite: somebody has already visited every site,
judged the fit, written the pitch and in places made the call. The columns
are different and so is the value in them.

The flyer tool is still what runs afterwards, because the merging, the
de-duplication against the book and the Location work are the same job. All
this does is translate - and it refuses to throw away the columns that
make a researched list worth more than a scraped one:

  Fit                       High/Medium/Low. This is a human's judgement of
                            whether the lead is worth a call, so it becomes
                            the CRM's own rating rather than a tag nobody
                            filters on. High -> hot, Medium -> warm,
                            Low -> cold.

  What is weak (pitch       The reason to ring them, in a sentence, written
  angle)                    by whoever looked. It goes first in the note
                            because it is the first thing a rep needs.

  Active in 2026? /         Whether the business is actually still trading.
  Activity evidence         A field with a dead domain and no dated activity
                            since 2022 is a different call from one running
                            events next weekend, and nothing else on the
                            record carries that.

  Call status               What happened when somebody already rang. Most
                            are "VM" or "Called", which is a warning. A few
                            are refusals, and those must not come back as
                            live leads - see DISQUALIFY.

TWO SHAPES

The airsoft and detailing lists carry Lead ID, Industry, Niche / type,
Platform and Booking / waiver tool. The Young Owner tabs carry none of
those: no Industry column at all (the tab name is the industry), Niche
instead of Niche / type, one merged "Platform / store / booking", and a
"Web presence" column that states the qualifier outright. Both are read
here, because the alternative is a second tool that drifts from this one.

The Website column says "none" for 59 of 220 on the Young Owner tabs.
That is a statement, not a URL, and clean_site below refuses it - which
is the whole point, because "no website" is the reason any of these is a
lead. What clean_site also does is rescue the opposite case: two barbers
whose Website reads "https://realsite.com [old: something.wixsite.com]"
really do have a site, and the annotation alone was enough to make the
flyer tool's looks_like_site call it no site at all.
"""
import argparse
import collections
import csv
import io
import os
import re

OUT_COLS = ['business_name', 'contact_name', 'contact_title', 'category',
            'services', 'phone', 'email', 'website', 'has_website', 'social',
            'address', 'city', 'state', 'duplicate_of_page', 'notes',
            'fit_rating', 'extra_tags', 'page']

FIT_TO_RATING = {'high': 'hot', 'medium': 'warm', 'low': 'cold'}

# A Call status that means "do not ring this again". The researcher writes
# these in their own words, so match on meaning rather than on a code:
# "Dont bother they havent posted in 2+ yeasrs" and "Someone else already
# doing site" are both refusals, and importing either as a live warm lead
# puts a rep on a call that was already lost.
DISQUALIFY = re.compile(
    r"don'?t bother|do ?not call|dnc\b|not interested"
    r"|someone else|already (doing|got|have|has|working)"
    r"|no longer|out of business|closed (down|permanently)"
    r"|wrong number|disconnected",
    re.I)

# Values in a Website column that are somebody describing the absence of a
# website rather than naming one.
NOT_A_SITE = re.compile(r'^\s*(none|n/?a|no|nope|unknown|\(not\s|not\s)', re.I)

# An aside that says the domain is not serving the business's own site.
# "Dead" is the easy half. The other half is a domain that resolves
# perfectly well and serves somebody else's casino: three of these lists
# have a kids' swim school and a ballet school whose addresses now load
# Indonesian gambling pages. A parent who searches them finds a betting
# site, which is a stronger reason to call than any of the dead ones.
IS_DEAD = re.compile(
    r'\b(dead|down|expired|parked|404|gone|broken|lost|lapsed|repointed'
    r'|disconnected|hijack(ed)?|compromised|hacked|spam|gambling|casino'
    r'|betting|slot|nxdomain)\b'
    r'|does not resolve|no longer exists|taken over|redirects to'
    r'|under construction',
    re.I)

# A domain serving somebody else's spam, as opposed to merely not
# resolving. Worth its own tag: it is both the most urgent pitch on the
# list and a thing the owner may not know is happening.
#
# "redirects to" is deliberately NOT here, though it is in IS_DEAD. A
# domain that "redirects to a parked /lander page" has merely lapsed,
# which is the ordinary case, and tagging that as hijacked would empty
# the tag of the meaning that makes it worth sorting by. The gambling
# redirects are caught by the word gambling.
IS_HIJACKED = re.compile(
    r'hijack|gambling|casino|betting|slot machine|spam|taken over', re.I)


def g(row, *names):
    for n in names:
        for k in row:
            if k and k.strip().lower() == n.lower():
                v = (row[k] or '').strip()
                if v:
                    return v
    return ''


def clean_site(raw):
    """The URL, and separately whatever was said about it.

    Researchers annotate this column. Three kinds turn up and they mean
    opposite things:

      "https://barbershopvienna.com [old: capitolbarber201.wixsite.com]"
          A real site, plus the history that IS the pitch. Keep both.
      "none (hideawaytexas.com unconfirmed)"
          No site. The domain is something for the rep to check.
      "hotcocoavintage.com (dead)"
          A domain that no longer resolves, which is no site either.

    Returns (url, aside). An empty url is what makes the flyer tool tag
    the lead "no website", so getting this wrong inverts the one field
    that decides whether the lead is a lead at all.
    """
    raw = (raw or '').strip()
    if not raw:
        return '', ''
    aside = ''
    m = re.search(r'[\[(]([^\])]*)[\])]\s*$', raw)
    if m:
        aside = m.group(1).strip()
        head = raw[:m.start()].strip()
    else:
        head = raw
    if not head or NOT_A_SITE.match(head):
        # A bare "none" has already been said by the empty website field
        # and by the "no website" tag. Repeating it as "Website note:
        # none." is a line of noise on every lead in the batch. Keep it
        # only when it carries something a rep can act on, like
        # "none (hideawaytexas.com unconfirmed)".
        if not aside and re.match(r'^\s*(none|n/?a|no|nope|unknown)\s*$', raw, re.I):
            return '', ''
        return '', raw
    if IS_DEAD.search(aside):
        return '', raw
    return head, aside


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', action='append', required=True)
    ap.add_argument('--out', dest='out', required=True)
    # The Young Owner tabs have no Industry column - the tab name is the
    # industry, and it survives in the filename after " - ". Passing it
    # explicitly wins; otherwise the filename is read; otherwise the row's
    # own Industry column, which is what the airsoft shape carries.
    ap.add_argument('--industry', dest='industry', action='append', default=[],
                    help='industry for the matching --in, or "-" to use its column')
    a = ap.parse_args()

    if a.industry and len(a.industry) != len(a.inp):
        ap.error('--industry must be given once per --in (use "-" to skip one)')

    out = []
    missing = []
    for i, path in enumerate(a.inp):
        if not os.path.exists(path):
            missing.append(path)
            continue
        rows = list(csv.DictReader(io.open(path, encoding='utf-8-sig')))
        base = os.path.basename(path)
        print('   read %3d rows from %s' % (len(rows), base))

        # Where this list's industry comes from, and the slug that keeps
        # its row numbers apart from the next list's. "#" restarts at 1 on
        # every tab, so four tabs share the numbers 1-19 and the page
        # column stops identifying anything.
        forced = ''
        if a.industry:
            forced = '' if a.industry[i] == '-' else a.industry[i]
        if not forced and ' - ' in base:
            forced = base.rsplit(' - ', 1)[1].rsplit('.', 1)[0].strip()
        slug = re.sub(r'[^a-z0-9]+', '-',
                      (forced or os.path.splitext(base)[0]).lower()).strip('-')

        for r in rows:
            name = g(r, 'Name', 'Business Name', 'Company')
            if not name:
                continue

            call = g(r, 'Call status')
            dead = bool(call and DISQUALIFY.search(call))

            note, tags = [], []

            # A refusal goes above the pitch, because the pitch is no
            # longer the point.
            if dead:
                note.append('DO NOT CALL - already answered: ' + call)
                tags.append('disqualified')

            weak = g(r, 'What is weak (pitch angle)', 'What is weak', 'Weak pitch')
            if weak:
                note.append('PITCH: ' + weak)

            web = g(r, 'Web presence')
            if web:
                note.append('Web presence: ' + web)

            active = g(r, 'Active in 2026?', 'Active in 2026', 'Active 2026')
            evid = g(r, 'Activity evidence')
            if active or evid:
                note.append('Still trading? ' + (active or 'unknown')
                            + (' - ' + evid if evid else ''))

            mkt = g(r, 'Market')
            if mkt:
                note.append('Market: ' + mkt)

            raw_site = g(r, 'Website')
            site, aside = clean_site(raw_site)

            # The researcher's own verdict outranks the Website column.
            # Northwest Studio for Ballet lists a clean, working URL -
            # https://www.northwestballet.net/ - and nothing in that cell
            # hints that the domain now serves a gambling page. Only the
            # Account status column says so, and it says it plainly. Where
            # it does, the lead has no website whatever the URL looks
            # like, because "no website" is the entire reason to call.
            acct = g(r, 'Account status')
            plat = g(r, 'Platform')
            if acct.strip().lower().startswith('no website'):
                if site:
                    note.append('Website note: ' + site
                                + ' is listed but is not their site - ' + acct)
                    aside = ''
                site = ''
            if IS_HIJACKED.search(acct) or IS_HIJACKED.search(plat) \
                    or IS_HIJACKED.search(aside) or IS_HIJACKED.search(raw_site):
                tags.append('domain hijacked')

            if aside:
                note.append('Website note: ' + aside)

            # Lists audited for site age (the Angi WordPress rounds) grade
            # every site A to D in the notes. Every one of those leads HAS a
            # site, so without this they would all land untagged and the
            # filter could not tell a 2013 build from last year's. A and B
            # are 2020 or earlier; C and D are undated or newer.
            if site:
                grade = re.search(r'\bWordPress tier ([A-D])\b', g(r, 'Notes'))
                if grade:
                    tags.append('old site' if grade.group(1) in 'AB' else 'has own site')

            # A link page is not a website - it is the thing they have
            # INSTEAD of one, so it belongs in the note where a rep can
            # open it, not in the Website field where it would cancel the
            # "no website" tag that makes this a lead.
            link = g(r, 'Link page')
            if link:
                note.append('Link page: ' + link)

            fol = g(r, 'Followers')
            if fol:
                note.append('Followers: ' + fol)

            for label, cols in [
                    ('Site built on', ('Platform',)),
                    ('Platform/store/booking', ('Platform / store / booking',)),
                    ('Booking/waiver', ('Booking / waiver tool', 'Booking tool')),
                    ('Online store', ('Online store?', 'Online store')),
                    ('Accounts', ('Account status',)),
                    ('Type', ('Niche / type', 'Niche')),
                    ('Owner signals', ('Young-owner signals',))]:
                v = g(r, *cols)
                if v:
                    note.append(label + ': ' + v)

            if call and not dead:
                # Shouting the researcher's own sentence back in capitals
                # gave "ALREADY NO VM BOX SET UP before import". Quote it
                # instead - the warning is that somebody already rang, and
                # the words are theirs.
                if call.strip().lower() in ('called', 'call', 'rung'):
                    note.append('ALREADY CALLED before import'
                                ' - check the record before ringing again')
                else:
                    note.append('ALREADY CALLED before import - outcome was "'
                                + call.strip().rstrip('.') + '"'
                                ' - check the record before ringing again')

            for col in ['Notes', 'Next step', 'Last contact']:
                v = g(r, col)
                if v:
                    note.append(v)

            lid = g(r, 'Lead ID', 'ID')
            src = g(r, 'Source list(s)', 'Source')
            res = g(r, 'Researched')
            tail = []
            if lid:
                tail.append(lid)
            if src:
                tail.append(src)
            if res:
                tail.append('researched ' + res)
            if tail:
                note.append('(' + ', '.join(tail) + ')')

            phone = g(r, 'Phone')
            email = g(r, 'Email')
            social = g(r, 'Instagram')

            # Nobody can work a lead with no phone, no email, no handle
            # and no link page. 32 of the 220 Young Owner rows are like
            # this. They are still worth importing - the research behind
            # them is real and somebody can find a number - but they must
            # not sit in a call queue looking callable.
            if not phone and not email and not social and not link:
                tags.append('no way in')

            out.append({
                'business_name': name,
                'contact_name': g(r, 'Owner / contact', 'Owner', 'Contact'),
                'contact_title': '',
                # The industry on its own, with no niche appended. The flyer
                # tool tags every lead with its industry, and a niche like
                # "tint, detailing, ceramic coating" turned that into one
                # 45-character tag with the commas flattened to spaces -
                # unfilterable, and seventeen variants of it across the wrap
                # list alone. The niche is already in the note as "Type:",
                # which is where a rep reads it.
                'category': forced or g(r, 'Industry'),
                'services': '',
                'phone': phone,
                'email': email,
                'website': site,
                'has_website': 'Yes' if site else 'No',
                'social': social,
                'address': '',
                'city': g(r, 'City'),
                'state': g(r, 'State'),
                'duplicate_of_page': '',
                'notes': '. '.join(x.rstrip('.') for x in note if x) + '.',
                # A lead that has already said no is cold whatever the
                # desk research rated it.
                'fit_rating': 'cold' if dead else FIT_TO_RATING.get(
                    g(r, 'Fit').lower(), ''),
                'extra_tags': ', '.join(tags),
                'page': lid or (slug + '-' + (g(r, '#') or str(len(out) + 1))),
            })

    # A list that silently did not arrive is how a de-duplication quietly
    # runs weaker than it reports. It is a hard stop, not a warning.
    if missing:
        raise SystemExit('STOPPED - these --in files do not exist:\n  '
                         + '\n  '.join(missing))

    with io.open(a.out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=OUT_COLS)
        w.writeheader()
        for x in out:
            w.writerow(x)

    print('')
    print('%d leads -> %s' % (len(out), a.out))
    fit = collections.Counter(x['fit_rating'] or '(none)' for x in out)
    print('   rating from Fit : '
          + ', '.join('%s %d' % (k, v) for k, v in fit.most_common()))
    print('   with a website  : %d' % len([x for x in out if x['has_website'] == 'Yes']))
    print('   NO website      : %d' % len([x for x in out if x['has_website'] == 'No']))
    print('   already called  : %d' % len([x for x in out if 'ALREADY ' in x['notes']]))
    print('   DO NOT CALL     : %d' % len([x for x in out if 'disqualified' in x['extra_tags']]))
    print('   no way to reach : %d' % len([x for x in out if 'no way in' in x['extra_tags']]))
    for x in out:
        if 'disqualified' in x['extra_tags']:
            print('      x %s' % x['business_name'])


if __name__ == '__main__':
    main()
