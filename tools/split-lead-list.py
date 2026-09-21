"""Tier a staged lead list so a rep can work it in order.

    python tools/split-lead-list.py standby/texas-mortgage-raw.csv --out-dir standby/tiers
    python tools/prep-contact-list.py standby/tiers/kept.csv --source-from Tier ...

These lists arrive as one undifferentiated dump - 915 rows, every one titled
"Loan Officer", every one "Not contacted". Imported as a single list that is
915 identical-looking cold calls, and the rep meets the worst of them first
because nothing says which end to start.

The raw file does carry the signals; the prepared CSV just flattens them away.
Source Type names which list a row came from and when it was compiled, Area
Code says whether the number is local to the city claimed, Contactability
says whether the number reaches a person or a switchboard, and Brokerage
says whether the lead is an independent or an employee of a bank. This turns
those four into a tier, and the tier becomes the Source - which is the column
the CRM's list filter reads, so a rep can work one tier at a time.

The tier is written into a column, not into a separate file per tier. That
distinction cost me an hour: splitting the file first and preparing each
part separately means dedupe only ever runs within a part, and the six
people who appear on two of these lists - Rob LaTour and Robert La Tour, Eli
Perez and Eleazar Perez - come out as twelve leads for two reps to call.
One file through prep-contact-list.py --source-from Tier keeps dedupe whole
and still lands three separate lists in the CRM.

Output is raw-shaped, not import-shaped. prep-contact-list.py owns name
parsing, the office-line guard and dedupe. None of it is reimplemented here.

Dropped rows are written out too, not deleted. A judgement call that turns
out wrong should cost a re-import, not a list.
"""
import argparse
import csv
import io
import os
import re
import sys
from collections import Counter, OrderedDict

# Area codes that mean the number is local to the city on the row. A cell
# that kept its old area code is not evidence of anything - people move and
# keep their number - so this demotes a row, it never drops one. The one
# place it is decisive is a whole list where nothing matches (see EL_PASO).
LOCAL = {
    'Austin':  {'512', '737'},
    'Houston': {'713', '281', '832', '346', '409'},
    'El Paso': {'915'},
}

# Banks and direct-to-consumer lenders whose loan officers work off a
# corporate site and cannot commission their own. Deliberately narrower than
# "big lender": Fairway, Guild, Movement, CrossCountry and Guaranteed Rate
# officers brand themselves individually and are the buyer we want, so they
# are not on this list.
EMPLOYER = re.compile(
    r'\b(chase|jpmorgan|bank of america|wells fargo|u\.?s\.? bank|citibank|'
    r'citimortgage|pnc|truist|suntrust|bbva|regions bank|navy federal|usaa|'
    r'rocket mortgage|quicken loans|loandepot|nationstar|mr\.? cooper|'
    r'pennymac|freedom mortgage|carrington|lakeview|newrez|amerihome|'
    r'united wholesale|better\.com|sofi)\b', re.I)

# A name cell that swallowed the phone and the company:
#   "Chris Peterson(281) 405-2625Caltex Funding"
# The row reads as having no contact method and gets thrown away, when in
# fact it is a complete lead.
GLUED = re.compile(r'^(.*?)(\(?\d{3}\)?[\s.-]{0,2}\d{3}[\s.-]?\d{4})(.*)$')

TOLL_FREE = {'800', '833', '844', '855', '866', '877', '888'}


def rescue(row):
    """Pull a name, phone and company back out of a single mangled cell."""
    name = (row.get('Full Name') or '').strip()
    m = GLUED.match(name)
    if not m or not any(c.isdigit() for c in name):
        return row, False
    who, phone, rest = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
    if not who:
        return row, False
    row = dict(row)
    row['Full Name'] = who
    if not (row.get('Phone Number') or '').strip():
        row['Phone Number'] = phone
        row['Area Code'] = re.sub(r'\D', '', phone)[:3]
        row['Contactability'] = 'Phone only'
        row['Review Flag'] = ''
    if rest and not (row.get('Brokerage / Company') or '').strip():
        row['Brokerage / Company'] = rest
    return row, True


def judge(row, dead_list):
    """Why this row should not be called, or None to keep it.

    Order matters only for reporting - a row is reported under the first
    reason that applies, so the counts add up to the number of rows rather
    than to the number of problems."""
    if row['Source Type'] in dead_list:
        return 'dead list'
    if (row.get('Contactability') or '').strip() == 'No contact method':
        return 'no contact method'
    if (row.get('Area Code') or '').strip() in TOLL_FREE:
        return 'toll-free only'
    if (row.get('Contactability') or '').strip() == 'Toll-free line':
        return 'toll-free only'
    if EMPLOYER.search(row.get('Brokerage / Company') or ''):
        return 'bank employee'
    return None


def dead_lists(rows):
    """Whole source lists that are not what they say they are.

    A single row with an out-of-area number is a cell phone. A hundred rows
    labelled El Paso with not one 915 number between them is a mislabelled
    file - and this one is a third national banks, from a list compiled in
    2022. There is no version of that list worth a rep's morning."""
    dead = OrderedDict()
    by_list = {}
    for r in rows:
        by_list.setdefault(r['Source Type'], []).append(r)
    for name, group in by_list.items():
        city = group[0]['City / Service Area']
        local = LOCAL.get(city)
        if not local:
            continue
        hits = len([r for r in group if (r.get('Area Code') or '').strip() in local])
        if len(group) >= 25 and hits == 0:
            dead[name] = 'not one %s number in %d rows' % (city, len(group))
    return dead


def tier_of(row):
    """The list a rep should see this row in, best first.

    The label becomes the Source column, which is what the CRM's list filter
    reads, so it has to say enough on its own: a rep picking "Houston 2022"
    from a dropdown should already know why those calls are colder."""
    src = row['Source Type']
    city = row['City / Service Area']
    stale = re.search(r'dated\s+(\d{2})-(\d{2})-(\d{4})', src)
    label = 'Texas Mortgage - ' + city
    if stale:
        label += ' ' + stale.group(3)
    return label


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('--out-dir', required=True)
    a = ap.parse_args()

    rows = list(csv.DictReader(io.open(a.source, encoding='utf-8-sig')))
    cols = list(rows[0].keys())

    fixed = []
    rescued = []
    for r in rows:
        r, did = rescue(r)
        if did:
            rescued.append(r['Full Name'])
        fixed.append(r)

    dead = dead_lists(fixed)

    kept, dropped = [], []
    for r in fixed:
        why = judge(r, dead)
        r = dict(r)
        if why:
            r['Review Flag'] = ('dropped: %s. %s' % (why, r.get('Review Flag') or '')).strip()
            dropped.append(r)
        else:
            r['Tier'] = tier_of(r)
            kept.append(r)

    if not os.path.isdir(a.out_dir):
        os.makedirs(a.out_dir)

    def write(path, data, fields):
        with io.open(path, 'w', encoding='utf-8-sig', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            w.writerows(data)

    print('read      %d rows' % len(rows))
    if rescued:
        print('rescued   %d  (name cell held the phone) %s' % (len(rescued), ' | '.join(rescued)))
    for name, why in dead.items():
        print('dead list %s  - %s' % (name, why))
    print()

    keep_path = os.path.join(a.out_dir, 'kept.csv')
    write(keep_path, kept, cols + ['Tier'])
    for tier, n in sorted(Counter(r['Tier'] for r in kept).items(),
                          key=lambda kv: (bool(re.search(r'\d{4}$', kv[0])), kv[0])):
        print('  %-34s %4d' % (tier, n))
    print('  %-34s %4d  -> %s' % ('all kept, one file', len(kept), keep_path))
    print()

    park_path = os.path.join(a.out_dir, 'parked.csv')
    write(park_path, dropped, cols)
    print('  %-34s %4d  -> %s' % ('(parked, not imported)', len(dropped), park_path))
    for why, n in Counter(r['Review Flag'].split('.')[0].replace('dropped: ', '')
                          for r in dropped).most_common():
        print('      %-24s %4d' % (why, n))

    total = len(kept) + len(dropped)
    print()
    print('accounted for: %d of %d' % (total, len(rows)))
    return 0 if total == len(rows) else 1


if __name__ == '__main__':
    sys.exit(main())
