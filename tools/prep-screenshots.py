"""Prepare screenshots so they can actually be read.

Images over 2000px on a side are rejected when several are sent at once,
which is how a batch of phone and desktop screenshots silently arrives as
nothing at all.

Two different problems need two different answers:

  * A wide desktop screenshot is mostly slack. Scaling it down to fit
    keeps every word legible.
  * A tall phone screenshot (a Nextdoor thread, say) is the opposite:
    scaling it to fit makes the text too small to read. Those are sliced
    into overlapping horizontal bands at full resolution instead, so the
    text stays the size it was and nothing is lost at a seam.

    Usage:  python tools/prep-screenshots.py [source-dir]
    Output: <source-dir>/ready/
"""
import os
import sys
from PIL import Image

MAX_EDGE = 1600      # comfortably under the limit
TALL_RATIO = 1.7     # taller than this and slicing beats shrinking
OVERLAP = 120        # px of repeat between slices, so no line is cut in half

def prep(path, outdir):
    img = Image.open(path)
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')
    w, h = img.size
    base = os.path.splitext(os.path.basename(path))[0]
    made = []

    if h > w * TALL_RATIO and h > MAX_EDGE:
        # Slice at full resolution; only narrow it if it is also too wide.
        if w > MAX_EDGE:
            scale = MAX_EDGE / w
            img = img.resize((MAX_EDGE, int(h * scale)), Image.LANCZOS)
            w, h = img.size
        step = MAX_EDGE - OVERLAP
        n, top = 1, 0
        while top < h:
            bottom = min(top + MAX_EDGE, h)
            out = os.path.join(outdir, '%s-part%d.png' % (base, n))
            img.crop((0, top, w, bottom)).save(out)
            made.append((out, '%dx%d' % (w, bottom - top)))
            if bottom >= h:
                break
            top += step
            n += 1
    else:
        if max(w, h) > MAX_EDGE:
            scale = MAX_EDGE / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        out = os.path.join(outdir, base + '.png')
        img.save(out)
        made.append((out, '%dx%d' % img.size))
    return made

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '.tmp/leads'
    if not os.path.isdir(src):
        print('No such folder: ' + src)
        return 1
    outdir = os.path.join(src, 'ready')
    os.makedirs(outdir, exist_ok=True)

    names = sorted(f for f in os.listdir(src)
                   if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')))
    if not names:
        print('No images in ' + src)
        return 1

    total = 0
    for name in names:
        srcpath = os.path.join(src, name)
        before = Image.open(srcpath).size
        for out, size in prep(srcpath, outdir):
            print('%-38s %-11s -> %-38s %s' % (name, '%dx%d' % before, os.path.basename(out), size))
            total += 1
    print('\n%d image(s) -> %d file(s) in %s' % (len(names), total, outdir))
    return 0

if __name__ == '__main__':
    sys.exit(main())
