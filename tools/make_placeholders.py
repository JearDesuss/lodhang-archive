"""Generate stand-in images for works that have no file yet.

These are NOT the artwork. They exist so the layout, the glow engine and the
transitions can be rendered and judged at the correct aspect ratio and palette
before the real files are dropped in. Each one is stamped PLACEHOLDER.

Usage:  python tools/make_placeholders.py
Output: assets/placeholder/<slug>.jpg
"""
import json
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "placeholder")
LONG_EDGE = 1400


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def font(size):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def build(work, rng):
    aspect = work["aspect"]
    if aspect >= 1:
        w, h = LONG_EDGE, int(round(LONG_EDGE / aspect))
    else:
        h, w = LONG_EDGE, int(round(LONG_EDGE * aspect))

    pal = [hex_rgb(p["hex"]) for p in work["palette"]]
    img = Image.new("RGB", (w, h), pal[0])
    d = ImageDraw.Draw(img, "RGBA")

    # Broad diagonal colour fields, in the spirit of the collage seams.
    for i in range(14):
        c = pal[rng.randrange(len(pal))]
        x0 = rng.uniform(-0.3, 1.0) * w
        y0 = rng.uniform(-0.3, 1.0) * h
        ww = rng.uniform(0.18, 0.75) * w
        hh = rng.uniform(0.18, 0.75) * h
        d.rectangle([x0, y0, x0 + ww, y0 + hh], fill=c + (rng.randrange(90, 200),))

    img = img.filter(ImageFilter.GaussianBlur(radius=w * 0.035))

    # Hard-edged strips, standing in for the glitch bars and paint slabs.
    d = ImageDraw.Draw(img, "RGBA")
    for i in range(7):
        c = pal[rng.randrange(len(pal))]
        if rng.random() < 0.5:
            x0 = rng.uniform(0, 0.9) * w
            d.rectangle([x0, 0, x0 + rng.uniform(0.01, 0.06) * w, h],
                        fill=c + (rng.randrange(70, 170),))
        else:
            y0 = rng.uniform(0, 0.9) * h
            d.rectangle([0, y0, w, y0 + rng.uniform(0.01, 0.05) * h],
                        fill=c + (rng.randrange(70, 170),))

    # A soft central mass so the composition has a focal weight, like the figures do.
    cx, cy = w * 0.5, h * 0.45
    r = min(w, h) * 0.34
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse([cx - r, cy - r * 1.25, cx + r, cy + r * 1.25], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=r * 0.42))
    img = Image.composite(Image.new("RGB", (w, h), pal[min(3, len(pal) - 1)]), img, mask)

    # Vignette.
    vig = Image.new("L", (w, h), 0)
    ImageDraw.Draw(vig).ellipse([-w * 0.25, -h * 0.25, w * 1.25, h * 1.25], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(radius=min(w, h) * 0.16))
    img = Image.composite(img, Image.new("RGB", (w, h), (10, 10, 12)), vig)

    # Grain.
    px = img.load()
    for _ in range(int(w * h * 0.03)):
        x, y = rng.randrange(w), rng.randrange(h)
        r0, g0, b0 = px[x, y]
        n = rng.randint(-16, 16)
        px[x, y] = (max(0, min(255, r0 + n)), max(0, min(255, g0 + n)), max(0, min(255, b0 + n)))

    # Stamp, so nobody ever mistakes this for the work.
    d = ImageDraw.Draw(img, "RGBA")
    f1, f2 = font(int(min(w, h) * 0.055)), font(int(min(w, h) * 0.026))
    label = work["id"].upper()
    d.text((w * 0.5, h * 0.5 - min(w, h) * 0.03), label, font=f1,
           fill=(255, 255, 255, 210), anchor="mm")
    d.text((w * 0.5, h * 0.5 + min(w, h) * 0.035), "PLACEHOLDER", font=f2,
           fill=(255, 255, 255, 130), anchor="mm")
    d.text((w * 0.5, h * 0.5 + min(w, h) * 0.075), f"{w} x {h}", font=f2,
           fill=(255, 255, 255, 90), anchor="mm")
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    catalog = json.load(open(os.path.join(ROOT, "data", "catalog.json"), encoding="utf-8"))
    for i, work in enumerate(catalog["works"]):
        rng = random.Random(1000 + i)  # deterministic, so reruns do not churn the repo
        img = build(work, rng)
        path = os.path.join(OUT, work["slug"] + ".jpg")
        img.save(path, "JPEG", quality=82, optimize=True)
        print(f"{work['id']}  {img.size[0]:>4}x{img.size[1]:<4}  "
              f"aspect {img.size[0] / img.size[1]:.3f}  {os.path.getsize(path) // 1024:>3}KB  {work['slug']}")


if __name__ == "__main__":
    main()
