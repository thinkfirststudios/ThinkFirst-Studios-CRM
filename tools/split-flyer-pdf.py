# -*- coding: utf-8 -*-
"""Turn a batch of flyer screenshots into labelled sheets that can be read.

    python tools/split-flyer-pdf.py --in "batch.pdf" --out .tmp/miami-tampa
                                    [--per 4] [--cell 1400] [--quality 85]

WHY THIS EXISTS

The lead batches arrive as a Google Doc holding one screenshot per lead -
no text at all, just a numbered list of images - and the only way out is
File > Print > Save as PDF, which lands at 400MB and up because every page
is a full-resolution phone screenshot. Nothing will read that.

So each page's image comes out, gets scaled to where the phone number is
still legible, and several are tiled onto one sheet with their item number
burnt into the corner.

THE NUMBER IS THE POINT. The `page` column in the prepared CSV refers to
the item number in the doc, and that is what lets a lead be traced back to
the flyer it came from when something looks wrong. Assuming page N of the
PDF is item N of the doc is wrong - in the Miami/Tampa batch the print
spilled and page 59 is item 60, page 69 is item 70. So the number is read
off each page's own text, gaps where the text did not render are filled
from the pages either side, and it is drawn onto the tile. Transcribing
four flyers off one sheet is only safe if each one is carrying its number.

Items whose entry in the doc is empty are reported rather than passed over,
because a gap in the numbering is usually a screenshot somebody meant to
paste and did not.
"""
import argparse
import io
import json
import os
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit('pypdf is needed: python -m pip install pypdf')
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit('Pillow is needed: python -m pip install pillow')


def biggest_image(page):
    """The screenshot on this page - the largest image, ignoring bullets."""
    try:
        imgs = list(page.images)
    except Exception:
        return None
    best, best_n = None, -1
    for im in imgs:
        try:
            data = im.data
        except Exception:
            continue
        if len(data) > best_n:
            best, best_n = data, len(data)
    if best is None:
        return None
    try:
        return Image.open(io.BytesIO(best))
    except Exception:
        return None


def font(size):
    for name in ('arialbd.ttf', 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def read_pages(path):
    """(item number, image) for every page, with the numbering repaired."""
    reader = PdfReader(path)
    rows = []
    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or '').strip()
        m = re.match(r'^(\d+)\s*\.', text)
        rows.append({'page': i + 1,
                     'item': int(m.group(1)) if m else None,
                     'img': biggest_image(page)})

    # A page whose number did not render sits between two that did, so it
    # takes the number that follows the one before it.
    for i, r in enumerate(rows):
        if r['item'] is not None:
            continue
        before = next((rows[j]['item'] for j in range(i - 1, -1, -1)
                       if rows[j]['item'] is not None), None)
        after = next((rows[j]['item'] for j in range(i + 1, len(rows))
                      if rows[j]['item'] is not None), None)
        if before is not None and after is not None and after - before == 2:
            r['item'] = before + 1
            r['guessed'] = True
        elif before is not None:
            r['item'] = before + 1
            r['guessed'] = True
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', dest='out', required=True)
    ap.add_argument('--per', type=int, default=4, help='flyers per sheet')
    ap.add_argument('--cell', type=int, default=1400)
    ap.add_argument('--quality', type=int, default=85)
    a = ap.parse_args()

    if not os.path.isdir(a.out):
        os.makedirs(a.out)

    src_mb = os.path.getsize(a.inp) / 1048576.0
    rows = read_pages(a.inp)
    print('%s  -  %d pages, %.0fMB' % (os.path.basename(a.inp), len(rows), src_mb))

    usable = [r for r in rows if r['img'] is not None and r['item'] is not None]
    blank = [r for r in rows if r['img'] is None]
    guessed = [r for r in rows if r.get('guessed')]

    nums = sorted(r['item'] for r in usable)
    gaps = [n for n in range(nums[0], nums[-1] + 1)
            if n not in set(nums)] if nums else []

    cols = 2 if a.per > 1 else 1
    sheets, manifest = [], []
    batch = []
    for r in usable:
        batch.append(r)
        if len(batch) == a.per:
            sheets.append(batch); batch = []
    if batch:
        sheets.append(batch)

    f = font(max(40, a.cell // 18))
    for idx, batch in enumerate(sheets):
        rows_n = (len(batch) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * a.cell, rows_n * a.cell), 'white')
        draw = ImageDraw.Draw(sheet)
        for k, r in enumerate(batch):
            im = r['img']
            if im.mode not in ('RGB', 'L'):
                im = im.convert('RGB')
            im = im.copy()
            im.thumbnail((a.cell - 8, a.cell - 8), Image.LANCZOS)
            ox = (k % cols) * a.cell
            oy = (k // cols) * a.cell
            sheet.paste(im, (ox + (a.cell - im.size[0]) // 2,
                             oy + (a.cell - im.size[1]) // 2))
            # The item number, burnt on so a tile cannot be read as its
            # neighbour when four of them share one sheet.
            tag = '#%d' % r['item']
            pad = 10
            try:
                box = draw.textbbox((0, 0), tag, font=f)
                tw, th = box[2] - box[0], box[3] - box[1]
            except Exception:
                tw, th = len(tag) * 24, 40
            draw.rectangle([ox + 4, oy + 4, ox + 4 + tw + pad * 2,
                            oy + 4 + th + pad * 2], fill='#111111')
            draw.text((ox + 4 + pad, oy + 4 + pad - 2), tag, fill='#ffffff', font=f)
            draw.rectangle([ox + 2, oy + 2, ox + a.cell - 2, oy + a.cell - 2],
                           outline='#cccccc', width=3)

        name = 'sheet-%03d.jpg' % (idx + 1)
        sheet.save(os.path.join(a.out, name), 'JPEG', quality=a.quality)
        items = [r['item'] for r in batch]
        manifest.append({'sheet': name, 'items': items})
        print('   %-16s items %s' % (name, ', '.join('#%d' % i for i in items)))

    with io.open(os.path.join(a.out, 'manifest.json'), 'w', encoding='utf-8') as fh:
        fh.write(json.dumps({'source': os.path.basename(a.inp),
                             'sheets': manifest,
                             'blank_items': [r['item'] for r in blank],
                             'missing_items': gaps}, indent=1))

    mb = sum(os.path.getsize(os.path.join(a.out, s['sheet']))
             for s in manifest) / 1048576.0
    print('')
    print('%d flyers -> %d sheets, %.1fMB total (was %.0fMB)'
          % (len(usable), len(sheets), mb, src_mb))
    if guessed:
        print('   numbering repaired on %d pages: %s'
              % (len(guessed), ', '.join('p%d=#%s' % (r['page'], r['item'])
                                         for r in guessed)))
    empty = sorted(set([r['item'] for r in blank if r['item']]) | set(gaps))
    if empty:
        print('')
        print('NO SCREENSHOT FOR %d ITEMS: %s'
              % (len(empty), ', '.join('#%d' % i for i in empty)))
        print('(empty entries in the doc - worth checking nothing was missed)')


if __name__ == '__main__':
    main()
