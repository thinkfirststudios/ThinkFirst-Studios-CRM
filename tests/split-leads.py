"""Splitting a call list between reps.

    python tests/split-leads.py

The failures worth catching here are all silent. A rep who was given a
trial batch and then a full share ends up with a bigger book than everyone
else and nobody notices until the numbers are compared at the end of the
month. A block-dealt list gives one person a whole coast, so their day has
three good calling hours in it and somebody else's has nine. And a lead in
two files means two people ring the same realtor, which the person on the
other end certainly notices.
"""
import collections
import csv
import io
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(HERE, 'tools', 'split-leads.py')

fails = []


def ok(label, cond, extra=None):
    if cond:
        print('  ok   ' + label)
    else:
        fails.append(label)
        print('  FAIL ' + label + ('' if extra is None else ' -> ' + str(extra)))


FIELDS = ['name', 'contactName', 'contactTitle', 'email', 'phone', 'website',
          'industry', 'address', 'rating', 'source', 'tags', 'notes',
          'areaCode', 'timeZone', 'siteEra', 'siteCurrent', 'siteRaw']

# Deliberately lopsided by zone: 60 Eastern, 30 Central, 10 Pacific. Dealt in
# blocks, one rep would get nothing but Eastern.
ZONES = [('Eastern', 60), ('Central', 30), ('Pacific', 10)]


def make_source(path, with_phone=True):
    rows, n = [], 0
    for zone, count in ZONES:
        for _ in range(count):
            n += 1
            rows.append(dict.fromkeys(FIELDS, ''))
            rows[-1].update({
                'name': 'Lead %d' % n,
                'contactName': 'Person %d' % n,
                'email': 'lead%d@example.com' % n,
                'phone': '(555) 555-%04d' % n if with_phone else '',
                'timeZone': zone,
                'tags': 'realtor|own-site' if n % 10 else 'realtor|not-a-realtor',
                'address': 'Town, State',
            })
    write(path, rows)
    return rows


def write(path, rows):
    with io.open(path, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)


def read(path):
    return list(csv.DictReader(io.open(path, encoding='utf-8')))


def run(*args):
    r = subprocess.run([sys.executable, TOOL] + list(args),
                       capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        raise SystemExit('splitter exited %d' % r.returncode)
    return r.stdout


def main():
    tmp = tempfile.mkdtemp(prefix='tfs-split-')
    src = os.path.join(tmp, 'source.csv')
    out = os.path.join(tmp, 'out')
    rows = make_source(src)

    print('\n-- an even three-way deal, balanced by time zone')
    run('--src', src, '--phone', '--balance-by', 'timeZone',
        '--deal', 'Ann,Bob,Cat', '--out-dir', out)
    got = dict((n, read(os.path.join(out, n + '.csv'))) for n in ('ann', 'bob', 'cat'))

    sizes = sorted(len(v) for v in got.values())
    ok('every rep gets the same number, give or take one',
       sizes[-1] - sizes[0] <= 1, sizes)
    ok('and all hundred are handed out', sum(sizes) == 100, sum(sizes))

    for zone, count in ZONES:
        per = sorted(sum(1 for r in v if r['timeZone'] == zone) for v in got.values())
        ok('%s is shared out evenly too' % zone, per[-1] - per[0] <= 1, per)

    seen = collections.Counter(r['email'] for v in got.values() for r in v)
    ok('nobody appears in two files', not [e for e, c in seen.items() if c > 1],
       [e for e, c in seen.items() if c > 1][:3])

    print('\n-- a trial batch already handed out counts against that share')
    # Ann was given ten leads last week. Without --credit she keeps those AND
    # a full third of the rest, and ends up with ten more than everybody else.
    trial = os.path.join(tmp, 'ann-trial.csv')
    write(trial, rows[:10])
    out2 = os.path.join(tmp, 'out2')
    log = run('--src', src, '--phone', '--balance-by', 'timeZone',
              '--deal', 'Ann,Bob,Cat', '--credit', 'Ann=' + trial,
              '--out-dir', out2)
    ok('the credit is reported', 'credited 10 already with Ann' in log, log.strip().split('\n')[0])

    got2 = dict((n, read(os.path.join(out2, n + '.csv'))) for n in ('ann', 'bob', 'cat'))
    sizes2 = sorted(len(v) for v in got2.values())
    ok('the totals are still level', sizes2[-1] - sizes2[0] <= 1, sizes2)
    ok('and still add up to a hundred', sum(sizes2) == 100, sum(sizes2))

    trial_emails = set(r['email'] for r in rows[:10])
    ann = set(r['email'] for r in got2['ann'])
    ok('Ann keeps every lead she already had', trial_emails <= ann,
       len(trial_emails & ann))
    others = set(r['email'] for n in ('bob', 'cat') for r in got2[n])
    ok('and none of them was handed to anybody else', not (trial_emails & others),
       sorted(trial_emails & others)[:3])

    print('\n-- a call sheet should be callable')
    out3 = os.path.join(tmp, 'out3')
    run('--src', src, '--phone', '--not-segment', 'not-a-realtor',
        '--deal', 'Ann,Bob', '--out-dir', out3)
    kept = [r for n in ('ann', 'bob') for r in read(os.path.join(out3, n + '.csv'))]
    ok('the ten flagged rows are gone', len(kept) == 90, len(kept))
    ok('and none of them slipped through',
       not [r for r in kept if 'not-a-realtor' in r['tags']])

    print('\n-- and the files are importable as they stand')
    ok('columns match the source exactly',
       list(read(os.path.join(out2, 'ann.csv'))[0].keys()) == FIELDS)
    ok('every row has the phone the filter promised',
       all(r['phone'].strip() for r in got2['ann']))

    print('\n' + ('FAILURES: %d' % len(fails) if fails else 'ALL PASS'))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
