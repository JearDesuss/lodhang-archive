"""Turn a folder of dropped image files into data/manifest.json.

Drop the eleven artwork files into works/ under any filenames you like, then run:

    python tools/ingest.py

For each catalog entry this writes the true pixel dimensions, a palette extracted
from the actual pixels in OKLab, a glow colour chosen for how it reads as light on
near-black, and a tiny base64 LQIP so nothing pops in. Works with no file fall back
to the stand-in in assets/placeholder/ and are flagged so the site can say so.

Matching, in order of preference:
  1. the file name contains the work id (w01) or the slug (crown-unworn)
  2. otherwise: a global best-fit assignment on aspect ratio, so the eleven files
     are matched to the eleven catalog aspects as a whole rather than greedily.

Only the standard library plus Pillow is required.
"""
import base64
import io
import json
import math
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  python -m pip install Pillow")

Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKS = os.path.join(ROOT, "works")
DATA = os.path.join(ROOT, "data")
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".tif", ".tiff", ".bmp"}
LQIP_EDGE = 20


# ---------------------------------------------------------------- colour ----
def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
    return max(0, min(255, round(c * 255)))


def rgb_to_oklab(rgb):
    r, g, b = (srgb_to_linear(v) for v in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (v ** (1 / 3) if v > 0 else -((-v) ** (1 / 3)) for v in (l, m, s))
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def oklab_to_rgb(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (linear_to_srgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            linear_to_srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            linear_to_srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))


def hexof(rgb):
    return "#%02X%02X%02X" % tuple(rgb)


def chroma(lab):
    return math.hypot(lab[1], lab[2])


def kmeans_oklab(pixels, k=7, iters=24):
    """k-means in OKLab. Averaging in OKLab is what stops the palette going muddy."""
    labs = [rgb_to_oklab(p) for p in pixels]
    if not labs:
        return []
    # k-means++ seeding, deterministically: farthest-point after a fixed first pick.
    cents = [max(labs, key=lambda p: chroma(p))]
    while len(cents) < k:
        far = max(labs, key=lambda p: min(sum((p[i] - c[i]) ** 2 for i in range(3)) for c in cents))
        if far in cents:
            break
        cents.append(far)
    for _ in range(iters):
        buckets = [[] for _ in cents]
        for p in labs:
            i = min(range(len(cents)),
                    key=lambda j: sum((p[d] - cents[j][d]) ** 2 for d in range(3)))
            buckets[i].append(p)
        moved = False
        for i, b in enumerate(buckets):
            if not b:
                continue
            new = tuple(sum(p[d] for p in b) / len(b) for d in range(3))
            if any(abs(new[d] - cents[i][d]) > 1e-5 for d in range(3)):
                moved = True
            cents[i] = new
        if not moved:
            break
    out = [(cents[i], len(b)) for i, b in enumerate(buckets) if b]
    out.sort(key=lambda t: -t[1])
    return out


def palette_of(im, k=7):
    small = im.convert("RGB").resize((96, 96), Image.LANCZOS)
    raw = small.tobytes()
    pixels = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    clusters = kmeans_oklab(pixels, k=k)
    total = sum(n for _, n in clusters) or 1
    pal = []
    for lab, n in clusters:
        pal.append({"hex": hexof(oklab_to_rgb(lab)),
                    "weight": round(n / total, 4),
                    "L": round(lab[0], 4),
                    "C": round(chroma(lab), 4)})
    return pal


def glow_of(pal):
    """The colour this work throws onto a black wall.

    Not the most common colour (usually a dark neutral) and not the most saturated
    (usually a tiny accent). Score on chroma, on having enough lightness to read as
    light, and on covering enough of the canvas to be honest about the work.
    """
    best, score = None, -1
    for p in pal:
        s = (p["C"] ** 0.85) * (p["L"] ** 0.55) * (p["weight"] ** 0.22)
        if s > score:
            best, score = p, s
    return (best or pal[0])["hex"] if pal else "#888888"


def lqip_of(im):
    small = im.convert("RGB")
    w, h = small.size
    if w >= h:
        size = (LQIP_EDGE, max(1, round(LQIP_EDGE * h / w)))
    else:
        size = (max(1, round(LQIP_EDGE * w / h)), LQIP_EDGE)
    small = small.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, "JPEG", quality=38, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# --------------------------------------------------------------- matching ----
def scan():
    if not os.path.isdir(WORKS):
        return []
    out = []
    for name in sorted(os.listdir(WORKS)):
        if os.path.splitext(name)[1].lower() not in EXTS:
            continue
        path = os.path.join(WORKS, name)
        try:
            with Image.open(path) as im:
                w, h = im.size
        except Exception as e:
            print(f"  ! skipping {name}: {e}")
            continue
        out.append({"name": name, "path": path, "w": w, "h": h, "aspect": w / h})
    return out


def assign(files, works):
    """Name matches win. The rest are assigned by best total aspect-ratio error."""
    taken, pairs = set(), {}
    for f in files:
        stem = re.sub(r"[^a-z0-9]+", "-", os.path.splitext(f["name"])[0].lower())
        for w in works:
            if w["slug"] in taken:
                continue
            if w["slug"] in stem or re.search(rf"\b{w['id']}\b", stem):
                pairs[w["slug"]] = f
                taken.add(w["slug"])
                f["claimed"] = True
                break

    rest_f = [f for f in files if not f.get("claimed")]
    rest_w = [w for w in works if w["slug"] not in taken]
    if not rest_f or not rest_w:
        return pairs, rest_f

    def err(f, w):
        return (math.log(f["aspect"]) - math.log(w["aspect"])) ** 2

    # Aspect ratio is one-dimensional and the cost is convex, so the optimal
    # assignment never crosses: sort both sides and the best matching is
    # order-preserving. That turns an intractable permutation search into an
    # exact O(n*m) DP over the two sorted lists.
    fs = sorted(rest_f, key=lambda f: f["aspect"])
    ws = sorted(rest_w, key=lambda w: w["aspect"])
    n, m = len(fs), len(ws)
    INF = float("inf")
    # cost[i][j] = best total error matching the first j works using the first i files
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        cost[i][0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, min(i, m) + 1):
            skip = cost[i - 1][j]                      # file i is left over
            take = cost[i - 1][j - 1] + err(fs[i - 1], ws[j - 1])
            if take <= skip:
                cost[i][j], back[i][j] = take, "take"
            else:
                cost[i][j], back[i][j] = skip, "skip"

    i, j, leftover = n, min(n, m), []
    while i > 0:
        if j > 0 and back[i][j] == "take":
            pairs[ws[j - 1]["slug"]] = fs[i - 1]
            j -= 1
        else:
            leftover.append(fs[i - 1])
        i -= 1
    leftover.reverse()
    return pairs, leftover


# ------------------------------------------------------------------- main ----
def main():
    catalog = json.load(open(os.path.join(DATA, "catalog.json"), encoding="utf-8"))
    works = catalog["works"]
    files = scan()
    print(f"works/ contains {len(files)} image file(s); catalog has {len(works)} work(s)\n")

    pairs, leftover = assign(files, works)
    entries, real = [], 0

    for w in works:
        f = pairs.get(w["slug"])
        e = {"id": w["id"], "slug": w["slug"]}
        if f:
            with Image.open(f["path"]) as im:
                im.load()
                pal = palette_of(im)
                e.update({
                    "src": "works/" + f["name"],
                    "width": f["w"], "height": f["h"],
                    "aspect": round(f["aspect"], 5),
                    "bytes": os.path.getsize(f["path"]),
                    "lqip": lqip_of(im),
                    "palette": [p["hex"] for p in pal],
                    "paletteDetail": pal,
                    "glow": glow_of(pal),
                    "placeholder": False,
                })
            real += 1
            drift = abs(math.log(f["aspect"]) - math.log(w["aspect"]))
            flag = "  <- aspect differs from catalog, check the match" if drift > 0.06 else ""
            print(f"  {w['id']}  {f['name'][:38]:38s} {f['w']}x{f['h']}  "
                  f"aspect {f['aspect']:.3f}  glow {e['glow']}{flag}")
        else:
            e.update({
                "src": f"assets/placeholder/{w['slug']}.jpg",
                "width": None, "height": None,
                "aspect": w["aspect"],
                "lqip": None,
                "palette": [p["hex"] for p in w["palette"]],
                "glow": w["glow"],
                "placeholder": True,
            })
            print(f"  {w['id']}  (no file) -> stand-in, catalog palette")
        entries.append(e)

    if leftover:
        print(f"\n  {len(leftover)} unmatched file(s): "
              + ", ".join(f["name"] for f in leftover))

    manifest = {"generated": "run tools/ingest.py to refresh",
                "resolved": real, "total": len(works), "entries": entries}
    with open(os.path.join(DATA, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"\nwrote data/manifest.json  --  {real}/{len(works)} works have real files")
    if real < len(works):
        print("Drop the remaining images into works/ and run this again.")


if __name__ == "__main__":
    main()
