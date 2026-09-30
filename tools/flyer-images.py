# -*- coding: utf-8 -*-
"""Pull each flyer out of a batch PDF as its own image, named by item number.

    python tools/flyer-images.py --in batch.pdf --out .tmp/ocr --from 66

Feeds tools/ocr-flyers.ps1. The file name is the DOC item number, not the
PDF page - the print spills, so page 59 is item 60 - because that number is
what the prepared CSV's `page` column refers to and what lets a lead be
traced back to the flyer it came from.

Small screenshots are scaled UP rather than down: OCR reads a 1600px image
far better than the 640px one some of these were posted at, and there is
nothing to be gained by keeping them small here.
"""
import argparse
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image                                    # noqa: E402

try:
    import importlib
    split = importlib.import_module('split-flyer-pdf'.replace('-', '_'))
except Exception:
    split = None

if split is None:
    # Same numbering repair, kept here so this runs standalone.
    import re
    from pypdf import PdfReader

    def read_pages(path):
        reader = PdfReader(path)
        rows = []
        for i, page in enumerate(reader.pages):
            text = (page.extract_text() or '').strip()
            m = re.match(r'^(\d+)\s*\.', text)
            img = None
            try:
                imgs = list(page.images)
                if imgs:
                    best = max(imgs, key=lambda x: len(x.data)).data
                    img = Image.open(io.BytesIO(best))
            except Exception:
                img = None
            rows.append({'page': i + 1,
                         'item': int(m.group(1)) if m else None,
                         'img': img})
        for i, r in enumerate(rows):
            if r['item'] is not None:
                continue
            before = next((rows[j]['item'] for j in range(i - 1, -1, -1)
                           if rows[j]['item'] is not None), None)
            if before is not None:
                r['item'] = before + 1
        return rows
else:
    read_pages = split.read_pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True)
    ap.add_argument('--out', dest='out', required=True)
    ap.add_argument('--from', dest='start', type=int, default=1)
    ap.add_argument('--to', dest='end', type=int, default=10 ** 6)
    ap.add_argument('--target', type=int, default=1700,
                    help='long edge fed to the OCR engine')
    a = ap.parse_args()

    if not os.path.isdir(a.out):
        os.makedirs(a.out)

    rows = read_pages(a.inp)
    n = 0
    for r in rows:
        if r['img'] is None or r['item'] is None:
            continue
        if r['item'] < a.start or r['item'] > a.end:
            continue
        im = r['img']
        if im.mode not in ('RGB', 'L'):
            im = im.convert('RGB')
        else:
            im = im.copy()
        s = float(a.target) / max(im.size)
        im = im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))),
                       Image.LANCZOS)
        im.save(os.path.join(a.out, 'item-%03d.png' % r['item']))
        n += 1
    print('wrote %d flyer images to %s (items %d..%d)' % (n, a.out, a.start, a.end))


if __name__ == '__main__':
    main()
