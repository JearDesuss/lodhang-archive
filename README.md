# LODHANG

A private study archive for eleven collage-paintings by **jaka lodhang**.

> A lightless plaster reserve underground, where eleven canvases are the only lamps
> in the building, and the only proof the walls have any texture at all is the light
> each painting throws across them.

The work is maximalist and violently chromatic, so the container is silent, dark and
reverent and contributes no colour of its own. Every chromatic value on screen —
every rule, numeral, glow and label — is derived at runtime from the pixels of
whichever work is currently lit. There is no brand colour and there must never be one.

---

## Put the artwork in

**The images are not in this repository.** Until they are, every work **paints
itself**: `assets/js/reconstruct.js` builds a collage-painting for each entry out of
what the catalogue actually knows — its palette, its aspect and its motifs. `beast`
puts an animal-headed figure in it, `bird` opens a pair of wings, `glitch` cuts
datamosh across it, `old-master` sinks a framed panel into it, `barrier` runs safety
tape over the front.

These are reconstructions, not reproductions, and the interface never pretends
otherwise — every one is labelled `RECON` on the wall and `RECONSTRUCTION. PAINTED
FROM THIS CATALOGUE ENTRY. NOT THE WORK.` on its plate. The moment a real file lands
in `works/` it replaces the reconstruction entirely.

There are two ways to fill it, and neither needs you to rename anything.

### 1. Drop them in the browser (no tooling)

Open the site, press **Import**, drag the files onto the panel. Each file is decoded,
measured, its palette extracted in OKLab, and stored in IndexedDB. Nothing is
uploaded and nothing leaves the browser. Good for looking; it lives in one browser.

### 2. Run the ingest (permanent)

```sh
cp /wherever/*.jpg works/          # any filenames
python tools/ingest.py             # needs Pillow
```

This writes `data/manifest.json` with true pixel dimensions, an OKLab palette taken
from the actual paint, a glow colour, and a tiny base64 LQIP for each work.

**Matching.** A filename containing a plate id (`w06`) or a slug
(`bull-dove-blade`) wins outright. Everything else is matched on aspect ratio, by an
exact order-preserving DP over the two sorted lists — not greedily. In testing this
placed all eleven correctly from `IMG_7052.jpg`-style names with no hints at all. A
name-matched file whose aspect disagrees with the catalogue is flagged rather than
silently accepted.

---

## Run it

```sh
python tools/serve.py            # http://127.0.0.1:8788
```

It is a static site — plain HTML, CSS and ES modules, no build step, no bundler, no
framework, no npm install. A server is needed only because the catalogue is fetched
as JSON.

## Look at it

```sh
node tools/shot.mjs --out shots/hall.png
node tools/shot.mjs --out shots/study.png --do "click .canvas-frame; wait 900"
node tools/shot.mjs --out shots/collate.png --do "down c; wait 800"
node tools/shot.mjs --out shots/reduced.png --reduced-motion
```

`--do` takes a small action language: `click`, `hover`, `key`, `down`, `up`, `wait`,
`wheel`, `eval`. Use `down c` rather than `key c` for the hold-to-reveal overlay —
`key` releases immediately and closes it again.

## Test it

```sh
node --test "tests/*.test.mjs"
```

Ten checks on the colour engine. The load-bearing ones: every work's derived theme
clears WCAG AA against the wall, the glow keeps the hue it came from, glow lightness
is normalised into one lighting rig so eleven works light the room comparably, and
mixing two saturated colours does not pass through grey.

---

## How it works

| File | What it is |
|---|---|
| `data/catalog.json` | The writing. Titles, descriptions, motifs, and 56 annotated fragments. Authored by hand; tooling never overwrites it. |
| `data/manifest.json` | What `ingest.py` measured. Regenerating it can never destroy the catalogue text — that is why they are separate files. |
| `assets/js/color.js` | OKLab/OKLCH, gamut mapping by chroma reduction, contrast enforcement, and `theme()` — the room's lighting derived from one colour off a painting. |
| `assets/js/wall.js` | The plaster. Generated once as a height field; lit per frame by additive radial pools, then multiplied by the plaster so its tooth can only appear where light falls. |
| `assets/js/store.js` | Merges catalogue + manifest + browser drops, in that order of authority. |
| `assets/js/import.js` | Browser-side ingest. Same palette maths and the same matching DP as `ingest.py`, so both agree. |
| `DESIGN.md` | The contract. Tokens, elevation philosophy, and seven don'ts with their reasons. |

**Views.** *Hall* — a salon hang, the whole archive on one wall with several works
lit at once and their light pools mixing on the plaster. Every work is sized to
constant area, so the 1.68 panorama and the 0.71 stele are equal-weight objects. *Study* — deep zoom with momentum, cursor-anchored, plus the annotated
fragments. *Index* — a real sortable table, by plate, hue or format. *Collation* —
hold **C** for all eleven plates at true relative scale, set like lines of type.

**Keys.** `J`/`K` move · `Enter` study · `C` hold to collate · `I` index · `Esc` back.

---

## Credit

The paintings are by **jaka lodhang** and were collected from the artist's social
media. This is a private study archive, not a publication. The artist's own titles
are unknown — every title here is a working title assigned by this archive and is
marked with a bracket. If you are the artist and want this taken down or corrected,
that is entirely your call.
