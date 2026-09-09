# Carve the realtor CSV into per-rep files.
#
#   # everything callable in the Eastern zone, dealt between three reps
#   python tools/split-leads.py --phone --tz Eastern --deal Frank,Sam,Jo
#
#   # one file, first 50 leads that own their site
#   python tools/split-leads.py --phone --segment own-site --limit 50 --out frank
#
#   # see what a filter would select without writing anything
#   python tools/split-leads.py --phone --state California --count
#
# Each output file is importable as-is: pick the rep in the import dialog's
# "Owner for imported leads" and every row lands owned by them.
#
# --deal writes one file per name and hands the leads out one at a time
# rather than in blocks, matching what the in-app Assign action does and for
# the same reason: the source list is ordered by region, so blocks would give
# one person a whole coast.
#
# Files never overlap. A lead appears in exactly one output of a given run,
# and --exclude keeps later runs clear of earlier ones.
import argparse, csv, io, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(HERE, 'Realtor-Contact-List.csv')
OUT_DIR = os.path.join(HERE, '.tmp', 'leads', 'split')

ap = argparse.ArgumentParser(description='Split the realtor CSV into per-rep files.')
ap.add_argument('--src', default=DEFAULT_SRC)
ap.add_argument('--phone', action='store_true', help='only leads with a phone number')
ap.add_argument('--no-phone', action='store_true', help='only leads without one')
ap.add_argument('--tz', help='time zone: Eastern, Central, Mountain, Pacific, Hawaii, Alaska')
ap.add_argument('--state', help='state or region as it appears in the address '
                                'column; comma separated for a territory')
ap.add_argument('--area', help='comma separated area codes')
ap.add_argument('--segment', help='own-site, brokerage-page, no-site-found, not-a-realtor')
ap.add_argument('--not-segment', help='comma separated segments to leave out')
ap.add_argument('--rating', help='hot, warm or cold')
ap.add_argument('--skip', type=int, default=0, help='drop this many from the front')
ap.add_argument('--limit', type=int, help='take at most this many')
ap.add_argument('--deal', help='comma separated names; one file each, dealt round-robin')
ap.add_argument('--out', help='basename for a single output file')
ap.add_argument('--exclude', action='append', default=[],
                help='a CSV whose leads must not appear; repeatable')
ap.add_argument('--count', action='store_true', help='report the selection, write nothing')
ap.add_argument('--out-dir', help='where to write; defaults to .tmp/leads/split')
ap.add_argument('--balance-by',
                help='column to deal within, e.g. timeZone, so every rep gets '
                     'the same mix rather than one of them getting a whole coast')
ap.add_argument('--credit', action='append', default=[],
                help='NAME=file.csv - leads already handed to that person. They '
                     'go in their file and count against their share, so the '
                     'totals still come out even. Repeatable.')
a = ap.parse_args()

if a.out_dir:
    OUT_DIR = a.out_dir if os.path.isabs(a.out_dir) else os.path.join(HERE, a.out_dir)

rows = list(csv.DictReader(io.open(a.src, encoding='utf-8')))
FIELDS = list(rows[0].keys())
total = len(rows)


def seg_of(r):
    return next((t for t in r['tags'].split('|') if t != 'realtor'), '')


def state_of(r):
    parts = r['address'].rsplit(',', 1)
    return (parts[1] if len(parts) > 1 else parts[0]).strip()


sel = rows
if a.phone:
    sel = [r for r in sel if r['phone'].strip()]
if a.no_phone:
    sel = [r for r in sel if not r['phone'].strip()]
if a.tz:
    want = a.tz.strip().lower()
    sel = [r for r in sel if r['timeZone'].strip().lower() == want]
if a.state:
    # Comma separated, because a territory is a handful of states and
    # running the tool once per state would need each run excluded from the
    # next - which is exactly the bookkeeping that gets forgotten.
    want = {x.strip().lower() for x in a.state.split(',') if x.strip()}
    sel = [r for r in sel if state_of(r).lower() in want]
if a.area:
    want = {x.strip() for x in a.area.split(',') if x.strip()}
    sel = [r for r in sel if r['areaCode'] in want]
if a.segment:
    want = a.segment.strip().lower()
    sel = [r for r in sel if seg_of(r).lower() == want]
if a.not_segment:
    # A call sheet should be callable. The parser tags what it could not
    # confirm as a realtor, and handing those to somebody on their first
    # morning wastes the part of the day they are freshest.
    drop = {x.strip().lower() for x in a.not_segment.split(',') if x.strip()}
    before = len(sel)
    sel = [r for r in sel if seg_of(r).lower() not in drop]
    if before != len(sel):
        print('left out %d in: %s' % (before - len(sel), ', '.join(sorted(drop))))
if a.rating:
    want = a.rating.strip().lower()
    sel = [r for r in sel if r['rating'].strip().lower() == want]

# Anything already handed out. Matched on email, the same key the CRM
# dedupes on, so an excluded lead cannot slip back in under a new file.
seen = set()
for path in a.exclude:
    p = path if os.path.isabs(path) else os.path.join(HERE, path)
    if not os.path.exists(p):
        print('exclude file not found: ' + p)
        sys.exit(1)
    for r in csv.DictReader(io.open(p, encoding='utf-8')):
        if r.get('email'):
            seen.add(r['email'].strip().lower())
if seen:
    before = len(sel)
    sel = [r for r in sel if r['email'].strip().lower() not in seen]
    print('excluded %d already handed out' % (before - len(sel)))

# Leads somebody already has. Pulled out of the deal and put straight into
# their bucket, where they count against their share - otherwise the person
# who was given a trial batch quietly ends up with a bigger book than
# everyone else, which is the opposite of what splitting a list is for.
credited = {}
for spec in a.credit:
    if '=' not in spec:
        print('--credit wants NAME=file.csv, got: ' + spec)
        sys.exit(1)
    who, path = spec.split('=', 1)
    who = who.strip()
    p2 = path if os.path.isabs(path) else os.path.join(HERE, path)
    if not os.path.exists(p2):
        print('credit file not found: ' + p2)
        sys.exit(1)
    for r in csv.DictReader(io.open(p2, encoding='utf-8')):
        if r.get('email'):
            credited[r['email'].strip().lower()] = who

# The source list has a couple of people entered twice under two addresses.
# Left in, they would land in different reps' files and two people would ring
# the same person - and the second copy would be skipped on import anyway,
# since the CRM dedupes on email too.
by_email, deduped = set(), []
for r in sel:
    key = r['email'].strip().lower()
    if key and key in by_email:
        continue
    if key:
        by_email.add(key)
    deduped.append(r)
if len(deduped) != len(sel):
    print('dropped %d duplicate%s already present under another row'
          % (len(sel) - len(deduped), '' if len(sel) - len(deduped) == 1 else 's'))
sel = deduped

# Split the credited ones out of the pool, keeping the source row rather
# than the one in the credit file so every rep's file has identical columns.
already = {}
if credited:
    keep = []
    for r in sel:
        who = credited.get(r['email'].strip().lower())
        if who:
            already.setdefault(who, []).append(r)
        else:
            keep.append(r)
    sel = keep
    for who in sorted(already):
        print('credited %d already with %s' % (len(already[who]), who))

if a.skip:
    sel = sel[a.skip:]
if a.limit is not None:
    sel = sel[:a.limit]

print('source rows: %d' % total)
print('selected:    %d' % len(sel))
if sel:
    from collections import Counter
    print('  by time zone: ' + ', '.join(
        '%s %d' % (k or '?', v) for k, v in Counter(r['timeZone'] for r in sel).most_common()))
    print('  by segment:   ' + ', '.join(
        '%s %d' % (k or '?', v) for k, v in Counter(seg_of(r) for r in sel).most_common()))
    print('  with a phone: %d' % sum(1 for r in sel if r['phone'].strip()))

if a.count or not sel:
    if not sel:
        print('\nNothing matched, so nothing was written.')
    sys.exit(0)

os.makedirs(OUT_DIR, exist_ok=True)


excluded_paths = {os.path.abspath(p if os.path.isabs(p) else os.path.join(HERE, p))
                  for p in a.exclude}


def write(name, batch):
    path = os.path.join(OUT_DIR, name + '.csv')
    # Writing over a file that was just used as an exclude would destroy the
    # record of what had already been handed out, and the new file would look
    # complete while silently missing everything the old one held.
    if os.path.abspath(path) in excluded_paths:
        print('refusing to overwrite %s - it was passed as --exclude.' % (name + '.csv'))
        print('Give this batch a different name.')
        sys.exit(1)
    with io.open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(batch)
    print('  %-28s %4d leads  %s' % (name + '.csv', len(batch), path))
    return path


print()
if a.deal:
    names = [n.strip() for n in a.deal.split(',') if n.strip()]
    buckets = {n: [] for n in names}
    for who, got in already.items():
        if who not in buckets:
            print('--credit names %s, who is not in --deal' % who)
            sys.exit(1)
        buckets[who].extend(got)

    # Deal to whoever currently holds the fewest. With no strata that is
    # plain round-robin; within strata it evens out the mix as well as the
    # totals, because every bucket is level again when a stratum starts.
    order = {n: i for i, n in enumerate(names)}

    def strata_of(batch):
        if not a.balance_by:
            return [('', batch)]
        groups = {}
        for r in batch:
            groups.setdefault((r.get(a.balance_by) or '').strip(), []).append(r)
        # Biggest first: the long tail then fills the gaps it leaves behind.
        return sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))

    for key, batch in strata_of(sel):
        for r in batch:
            n = min(names, key=lambda x: (len(buckets[x]), order[x]))
            buckets[n].append(r)
    written = [write(n.lower().replace(' ', '-'), buckets[n]) for n in names]
    # A lead in two files would mean two people ringing the same person.
    emails = [r['email'].strip().lower() for n in names for r in buckets[n] if r['email'].strip()]
    assert len(emails) == len(set(emails)), 'a lead landed in more than one file'
    print('\nno lead appears in more than one file')
else:
    write(a.out or 'split', sel)
