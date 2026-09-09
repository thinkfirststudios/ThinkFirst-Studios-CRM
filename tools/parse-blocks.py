"""Turn a labelled-block lead list into CSV the importer reads without mapping.

The block format is what the "convert my spreadsheet" prompt asks Claude for:
one record per block, one labelled field per line. PDFs lose columns, so the
format deliberately has none - a wrapped table cell silently shifts every
later column, and you find out months later when somebody calls the wrong
number.

  --- 1 ---
  Company: Imobiliaria Invista
  Contact: Anderson Coutinho
  Phone: (48) 99677-3723

Output headers match the importer's own aliases (Company, Contact, Email,
Phone, Website, Location, Source, Tags, Note...), so an import lands with
nothing to configure by hand.

  python tools/parse-blocks.py standby/brazil-raw.txt --out standby/brazil.csv
  python tools/parse-blocks.py standby/brazil-raw.txt --out standby/brazil.csv \
      --split-by Tags --split-dir standby/split --industry "Real Estate"
"""
import argparse
import csv
import io
import os
import re
import sys

# Every field the importer maps, in the order it lists them.
COLUMNS = ['Company', 'Contact', 'Title', 'Email', 'Phone', 'Website',
           'Location', 'Industry', 'Source', 'Est. Value',
           'Instagram', 'TikTok', 'Facebook', 'Rating', 'Tags', 'Note']

BLOCK = re.compile(r'^-{2,}\s*(\S+)\s*-{2,}\s*$')
FIELD = re.compile(r'^([A-Za-z][A-Za-z .\']*):\s*(.*)$')


def parse(text):
    """Blocks to dicts. A field line starts a value; anything else continues
    the previous one, because a long Note wraps and a wrapped line is still
    part of the note - not a record of its own."""
    records, cur, last = [], None, None
    for raw in text.replace('\r\n', '\n').split('\n'):
        line = raw.rstrip()
        m = BLOCK.match(line.strip())
        if m:
            if cur:
                records.append(cur)
            cur, last = {'_id': m.group(1)}, None
            continue
        if cur is None:
            continue                      # preamble, e.g. TOTAL RECORDS: 100
        if not line.strip():
            continue
        f = FIELD.match(line.strip())
        if f and f.group(1) in COLUMNS:
            last = f.group(1)
            cur[last] = f.group(2).strip()
        elif last:
            cur[last] = (cur[last] + ' ' + line.strip()).strip()
    if cur:
        records.append(cur)
    return records


def clean(rec, industry):
    """Fill in what the source implies but does not spell out, and nothing
    else. A URL sitting in the Website column that is plainly an Instagram
    or Facebook profile belongs in its own column, where the CRM can render
    it as a handle and a rep can open it in one tap."""
    out = dict((c, '') for c in COLUMNS)
    for c in COLUMNS:
        if rec.get(c):
            out[c] = rec[c]

    for url in [u.strip() for u in out['Website'].split('|') if u.strip()]:
        low = url.lower()
        if 'instagram.com' in low and not out['Instagram']:
            out['Instagram'] = url
        elif 'facebook.com' in low and not out['Facebook']:
            out['Facebook'] = url
        elif 'wa.me' in low or 'api.whatsapp' in low:
            continue                      # the number is already in Phone
        else:
            out['Website'] = url
    if 'instagram.com' in out['Website'].lower() or 'facebook.com' in out['Website'].lower():
        out['Website'] = ''
    if not out['Industry']:
        out['Industry'] = industry

    # Tags: pipes, because a CSV cell holding commas has to be quoted and
    # plenty of exports get that wrong.
    tags = [t.strip() for t in re.split(r'[,|]', out['Tags']) if t.strip()]
    out['Tags'] = ' | '.join(tags)
    return out


def reachable(r):
    """Somebody a rep can actually contact today: a phone or an email. A
    profile URL is a lead, but it is not a call list."""
    return bool(r['Phone'] or r['Email'])


def slug(s):
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    return s or 'other'


def write(path, rows):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction='ignore')
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('--out', required=True)
    ap.add_argument('--industry', default='')
    ap.add_argument('--expect', type=int, default=0,
                    help='record count the source claims; mismatch is an error')
    ap.add_argument('--split-by', default='',
                    help='column to split on; for Tags the FIRST tag is used')
    ap.add_argument('--split-dir', default='')
    args = ap.parse_args()

    with io.open(args.source, encoding='utf-8') as fh:
        text = fh.read()

    claimed = re.search(r'TOTAL RECORDS:\s*(\d+)', text)
    records = [clean(r, args.industry) for r in parse(text)]

    # A silent short read is the failure that matters here: nobody notices
    # 80 of 100 leads until the 20 never get called.
    expected = args.expect or (int(claimed.group(1)) if claimed else 0)
    if expected and len(records) != expected:
        sys.stderr.write('MISMATCH: parsed %d, source claims %d\n'
                         % (len(records), expected))
        return 1

    seen, rows, dupes = {}, [], []
    for r in records:
        key = (r['Email'].lower().strip() or
               re.sub(r'\D', '', r['Phone']) or
               (r['Company'] + '/' + r['Contact']).lower())
        if key in seen:
            dupes.append(r['Contact'] or r['Company'])
            continue
        seen[key] = 1
        rows.append(r)

    write(args.out, rows)

    groups = {}
    if args.split_by:
        for r in rows:
            v = r.get(args.split_by, '')
            if args.split_by == 'Tags':
                v = v.split('|')[0].strip()
            groups.setdefault(v or 'unsorted', []).append(r)
        base = args.split_dir or os.path.dirname(args.out) or '.'
        for name in sorted(groups):
            write(os.path.join(base, slug(name) + '.csv'), groups[name])

    call = [r for r in rows if reachable(r)]
    out = sys.stdout
    out.write('parsed        %d records\n' % len(records))
    out.write('written       %d (%d duplicates dropped)\n' % (len(rows), len(dupes)))
    out.write('with a phone  %d\n' % len([r for r in rows if r['Phone']]))
    out.write('with an email %d\n' % len([r for r in rows if r['Email']]))
    out.write('contactable   %d (phone or email)\n' % len(call))
    out.write('profile only  %d (website, Instagram or LinkedIn)\n'
              % (len(rows) - len(call)))
    if dupes:
        out.write('dropped       %s\n' % ', '.join(dupes))
    for name in sorted(groups):
        g = groups[name]
        out.write('  %-28s %3d  (%d contactable)\n'
                  % (name, len(g), len([r for r in g if reachable(r)])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
