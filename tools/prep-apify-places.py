# -*- coding: utf-8 -*-
"""Turn an Apify Google-Maps export into a list the CRM importer reads without
being told anything.

The raw export is 300-400 columns wide and none of them are named the way the
importer expects. Left alone it guesses "additionalInfo/From the business/0/
Identifies as women-owned" for the company name, because that header contains
the word "business", and drops 85% of the rows for having no name. It also
picks "url" for the website, which is the Google Maps link rather than the
business's own site - so every lead arrives looking like it already has a
website, which is the one thing we most need to be right about.

Usage:
    python tools/prep-apify-places.py IN.csv OUT.csv --source "Apify: OC Home Services"
"""
import csv, io, os, re, sys, collections

# A page on one of these is not a website. It is somebody else's platform with
# the business's name on it, which is the pitch rather than the obstacle.
FREE_HOSTS = set("""
facebook.com fb.com fb.me instagram.com tiktok.com linktr.ee beacons.ai
carrd.co business.site sites.google.com wixsite.com squarespace.com
godaddysites.com weebly.com wordpress.com blogspot.com myshopify.com
github.io netlify.app vercel.app wa.me wa.link yelp.com nextdoor.com
goomer.app negocio.site systeme.io hotplate.com
""".split())

SOCIAL_COL = {'facebook.com': 'Facebook', 'fb.com': 'Facebook', 'fb.me': 'Facebook',
              'instagram.com': 'Instagram', 'tiktok.com': 'TikTok'}

# A Facebook link is only a page if it points at one. Half of these are a
# marketplace ad or a group post, and "facebook.com/marketplace/item/435..."
# read as a social handle would show up on the lead as @marketplace.
NOT_A_PAGE = ('marketplace/', 'groups/', 'events/', 'watch/', 'posts/',
              'share/', 'story.php', 'permalink.php', 'photo')


def looks_like_page(url):
    tail = (url or '').strip().lower()
    tail = re.sub(r'^https?://', '', tail)
    tail = re.sub(r'^www\.', '', tail)
    tail = tail.split('/', 1)[1] if '/' in tail else ''
    if not tail.strip('/'):
        return False
    return not any(tail.startswith(x) for x in NOT_A_PAGE)


TOLL_FREE = {'800', '833', '844', '855', '866', '877', '888'}

OUT_COLUMNS = ['Company', 'Contact', 'Title', 'Email', 'Phone', 'Website',
               'Location', 'Industry', 'Source', 'Est. Value', 'Instagram',
               'TikTok', 'Facebook', 'Rating', 'Tags', 'Note']


def host_of(url):
    u = (url or '').strip().lower()
    u = re.sub(r'^https?://', '', u)
    u = re.sub(r'^www\.', '', u)
    return u.split('/')[0].split('?')[0]


def is_free_host(h):
    return any(h == f or h.endswith('.' + f) for f in FREE_HOSTS)


def digits(s):
    d = re.sub(r'[^0-9]', '', s or '')
    if len(d) == 11 and d.startswith('1'):
        d = d[1:]
    return d if len(d) == 10 else ''


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')


def hours_line(row):
    """Mon-Fri 8 AM to 5 PM, Sat closed - said in one line, not seven."""
    days, seen = [], []
    for i in range(7):
        d = (row.get('openingHours/%d/day' % i) or '').strip()
        h = (row.get('openingHours/%d/hours' % i) or '').strip()
        if d and h:
            days.append((d[:3], h))
            seen.append(h)
    if not days:
        return ''
    if len(set(seen)) == 1:
        return 'Open %s every day' % seen[0]
    runs, start, cur = [], days[0], days[0][1]
    for i in range(1, len(days)):
        if days[i][1] != cur:
            runs.append((start[0], days[i - 1][0], cur))
            start, cur = days[i], days[i][1]
    runs.append((start[0], days[-1][0], cur))
    out = []
    for a, b, h in runs:
        out.append(('%s' % a if a == b else '%s-%s' % (a, b)) + ' ' + h)
    return ', '.join(out)


def convert(path_in, path_out, source):
    rows = list(csv.DictReader(io.open(path_in, encoding='utf-8-sig')))
    out, skipped, seen_place = [], [], set()
    stats = collections.Counter()

    for r in rows:
        name = (r.get('title') or '').strip()
        if not name:
            skipped.append(('no company name', r.get('placeId', '')))
            continue
        pid = (r.get('placeId') or '').strip()
        if pid and pid in seen_place:
            skipped.append(('same Google listing twice', name))
            continue
        if pid:
            seen_place.add(pid)

        if (r.get('permanentlyClosed') or '').lower() == 'true':
            skipped.append(('permanently closed', name))
            continue

        website = (r.get('website') or '').strip()
        h = host_of(website)
        social = {'Instagram': '', 'TikTok': '', 'Facebook': ''}
        tags = []

        # A social page is not a website - it belongs in its own column, and
        # the lead still counts as having nowhere of their own.
        if h in SOCIAL_COL and looks_like_page(website):
            social[SOCIAL_COL[h]] = website
            website = ''
            tags.append('social only')
        elif h in SOCIAL_COL:
            # An ad or a group post, not a page. It is still the only thing
            # they have online, so it belongs in the note, not a handle field.
            website = ''
            tags.append('social only')
            tags.append('no real page')
        elif website and is_free_host(h):
            tags.append('weak site')

        trade = (r.get('searchString') or r.get('categoryName') or '').strip()
        city = (r.get('city') or '').strip()
        if trade:
            tags.append(slug(trade))
        if city:
            tags.append(slug(city))
        if not website:
            tags.append('no website')
        d = digits(r.get('phone'))
        if not d:
            tags.append('no phone')
        elif d[:3] in TOLL_FREE:
            tags.append('toll free')
        # An unclaimed Google profile means nobody is minding their web
        # presence at all, which is the easiest conversation to open.
        if (r.get('claimThisBusiness') or '').lower() == 'true':
            tags.append('unclaimed listing')

        bits = []
        cat = (r.get('categoryName') or '').strip()
        extra = [(r.get('categories/%d' % i) or '').strip() for i in range(1, 5)]
        extra = [e for e in extra if e and e != cat]
        if cat:
            bits.append(cat + (' (also ' + ', '.join(extra) + ')' if extra else '') + '.')
        score = (r.get('totalScore') or '').strip()
        cnt = (r.get('reviewsCount') or '').strip()
        if score and cnt:
            bits.append('%s stars from %s review%s.' % (score, cnt, '' if cnt == '1' else 's'))
        elif cnt:
            bits.append('%s reviews.' % cnt)
        hrs = hours_line(r)
        if hrs:
            bits.append(hrs + '.')
        if website:
            bits.append('Has a site at %s.' % host_of(website))
        elif social['Facebook'] or social['Instagram']:
            bits.append('No website - a social page is the whole web presence.')
        else:
            bits.append('No website at all - Google profile only.')
        if (r.get('claimThisBusiness') or '').lower() == 'true':
            bits.append('Google listing is unclaimed.')
        maps = (r.get('url') or '').strip()
        if maps:
            bits.append(maps)

        loc = (r.get('address') or '').strip()
        if not loc:
            loc = ', '.join(x for x in [city, (r.get('state') or '').strip()] if x)

        out.append({
            'Company': name, 'Contact': '', 'Title': '', 'Email': '',
            'Phone': (r.get('phone') or '').strip(),
            'Website': website, 'Location': loc, 'Industry': cat,
            'Source': source, 'Est. Value': '',
            'Instagram': social['Instagram'], 'TikTok': social['TikTok'],
            'Facebook': social['Facebook'], 'Rating': '',
            'Tags': '|'.join(tags), 'Note': ' '.join(bits),
        })
        stats['no website' if not website else 'has a website'] += 1

    d = os.path.dirname(path_out)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path_out, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=OUT_COLUMNS)
        w.writeheader()
        for o in out:
            w.writerow(o)

    print('read    %d rows' % len(rows))
    print('wrote   %d leads -> %s' % (len(out), path_out))
    print('        %d with a website, %d without'
          % (stats['has a website'], stats['no website']))
    if skipped:
        print('dropped %d:' % len(skipped))
        for why, who in skipped:
            print('        %-28s %s' % (why, who))
    return out


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    source = 'Apify import'
    if '--source' in sys.argv:
        source = sys.argv[sys.argv.index('--source') + 1]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    convert(args[0], args[1], source)
