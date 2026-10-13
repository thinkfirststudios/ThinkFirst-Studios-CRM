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
this does is translate - and it refuses to throw away the three columns
that make a researched list worth more than a scraped one:

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

The Website column says "none" for 23 of 175. That is a statement, not a
URL, and the flyer tool's looks_like_site already refuses it - which is the
whole point, because "no website" is the reason any of these is a lead.
"""
import argparse
import csv
import io
import os

OUT_COLS = ['business_name', 'contact_name', 'contact_title', 'category',
            'services', 'phone', 'email', 'website', 'has_website', 'social',
            'address', 'city', 'state', 'duplicate_of_page', 'notes',
            'fit_rating', 'page']

FIT_TO_RATING = {'high': 'hot', 'medium': 'warm', 'low': 'cold'}


def g(row, *names):
    for n in names:
        for k in row:
            if k and k.strip().lower() == n.lower():
                v = (row[k] or '').strip()
                if v:
                    return v
    return ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', action='append', required=True)
    ap.add_argument('--out', dest='out', required=True)
    a = ap.parse_args()

    out = []
    for path in a.inp:
        if not os.path.exists(path):
            print('   (not found, skipped: %s)' % path)
            continue
        rows = list(csv.DictReader(io.open(path, encoding='utf-8-sig')))
        print('   read %3d rows from %s' % (len(rows), os.path.basename(path)))
        for r in rows:
            name = g(r, 'Name', 'Business Name', 'Company')
            if not name:
                continue

            # The pitch first - it is why a rep is ringing at all.
            note = []
            weak = g(r, 'What is weak (pitch angle)', 'What is weak')
            if weak:
                note.append('PITCH: ' + weak)

            active = g(r, 'Active in 2026?', 'Active in 2026')
            evid = g(r, 'Activity evidence')
            if active or evid:
                note.append('Still trading? ' + (active or 'unknown')
                            + (' - ' + evid if evid else ''))

            for label, col in [('Site built on', 'Platform'),
                               ('Booking/waiver', 'Booking / waiver tool'),
                               ('Online store', 'Online store?'),
                               ('Accounts', 'Account status'),
                               ('Type', 'Niche / type'),
                               ('Owner signals', 'Young-owner signals')]:
                v = g(r, col)
                if v:
                    note.append(label + ': ' + v)

            call = g(r, 'Call status')
            if call:
                note.append('ALREADY ' + call.upper()
                            + ' before import - check the record before ringing again')

            for col in ['Notes', 'Next step', 'Last contact']:
                v = g(r, col)
                if v:
                    note.append(v)

            lid = g(r, 'Lead ID')
            src = g(r, 'Source list(s)')
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

            site = g(r, 'Website', 'Link page')
            out.append({
                'business_name': name,
                'contact_name': g(r, 'Owner / contact', 'Owner', 'Contact'),
                'contact_title': '',
                'category': g(r, 'Industry') + (
                    ' - ' + g(r, 'Niche / type') if g(r, 'Niche / type') else ''),
                'services': '',
                'phone': g(r, 'Phone'),
                'email': g(r, 'Email'),
                'website': site,
                'has_website': 'No' if site.lower() in ('', 'none') else 'Yes',
                'social': g(r, 'Instagram'),
                'address': '',
                'city': g(r, 'City'),
                'state': g(r, 'State'),
                'duplicate_of_page': '',
                'notes': '. '.join(x.rstrip('.') for x in note if x) + '.',
                'fit_rating': FIT_TO_RATING.get(g(r, 'Fit').lower(), ''),
                'page': lid or str(len(out) + 1),
            })

    with io.open(a.out, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=OUT_COLS)
        w.writeheader()
        for x in out:
            w.writerow(x)

    print('')
    print('%d leads -> %s' % (len(out), a.out))
    import collections
    fit = collections.Counter(x['fit_rating'] or '(none)' for x in out)
    print('   rating from Fit : ' + ', '.join('%s %d' % (k, v) for k, v in fit.most_common()))
    print('   with a website  : %d' % len([x for x in out if x['has_website'] == 'Yes']))
    print('   NO website      : %d' % len([x for x in out if x['has_website'] == 'No']))
    print('   already called  : %d' % len([x for x in out if 'ALREADY CALLED' in x['notes']]))


if __name__ == '__main__':
    main()
