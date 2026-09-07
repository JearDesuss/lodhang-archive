# LODHANG — design contract

## north_star

A lightless plaster reserve underground, where eleven canvases are the only lamps in
the building, and the only proof the walls have any texture at all is the light each
painting throws across them.

## theme

dark — and never neutral. A real dark room next to a high-chroma painting is not black,
it is that painting's hue at four percent lightness, because paint bounces. Every
surface in this site is tinted by whichever work is currently lit. Pure `#000` appears
nowhere.

## industry

A private study archive for one artist's body of work. Not a shop, not a portfolio,
not a feed.

## description

Eleven collage-paintings by jaka lodhang, each one splicing Old Master figuration into
abstract paint, tropical foliage, animal heads, plate armour and datamosh. The work is
maximalist and violently chromatic, so the container is silent, dark and reverent: it
contributes no colour of its own. The single organising idea is **light**. Each work is
a lamp. It lights a procedurally rendered plaster wall in its own dominant colour, it
tints every rule, numeral and label near it, and where two works' light pools overlap
they mix in OKLCH and leave a visible seam. Colour is also the index: the archive can be
ordered by hue, and the empty arcs of the hue circle are left visibly dead, because that
says something true about the artist that a grid cannot.

## colors

The neutral ramp is a *warm* black. Every value below is the unlit resting state; at
runtime each is mixed toward the lit work's hue by the amount in `role`.

| hex | name | group | role |
|---|---|---|---|
| `#08080A` | Void | neutral | page ground; never mixed, the deepest value in the room |
| `#0C0C0E` | Pitch | neutral | the wall's unlit base, mixed 8% toward the lit hue |
| `#131315` | Cellar | neutral | recessed panels, the index ledger ground |
| `#1A1A1C` | Stone | neutral | raised surface, the label plate |
| `#23231F` | Hairline | neutral | every rule and border in the site, mixed 14% |
| `#3A3A36` | Iron | neutral | disabled type, inactive ticks |
| `#5B5B54` | Ash | neutral | mono metadata, plate numbers, mixed 20% |
| `#8C8C83` | Fog | neutral | secondary prose |
| `#BEBCB2` | Bone | neutral | body copy |
| `#EFEDE6` | Chalk | neutral | titles and the one bright type value |

Chromatic values are **never authored**. `--c-glow`, `--c-bloom`, `--c-wash`,
`--c-accent`, `--c-line`, `--c-ink*` are derived at runtime by `assets/js/color.js`
from the lit work's own pixels. There is no brand colour, and there must never be one.

## surfaces

| hex | name | level | purpose |
|---|---|---|---|
| `#08080A` | Void | 0 | the page itself |
| `#0C0C0E` | Pitch | 1 | the plaster wall canvas, which is the only thing that receives light |
| `#131315` | Cellar | 2 | the index ledger and the import panel |
| `#1A1A1C` | Stone | 3 | the label plate beside a lit work, and nothing else |

## typography

| family | substitute | weight | sizes | tracking | features | role |
|---|---|---|---|---|---|---|
| Newsreader | Georgia, 'Times New Roman', serif | 400, 500 | 20–72px | −0.022em at 48px+ | `ss01` | titles, the artist's name, pull quotes |
| Inter | -apple-system, 'Segoe UI', system-ui, sans-serif | 400, 500 | 13–19px | 0 | `cv05`, `ss03` | descriptions, fragment notes, all prose |
| JetBrains Mono | ui-monospace, Consolas, monospace | 400, 500 | 9–13px | +0.12em | `zero`, `tnum` | plate numbers, OKLCH readouts, dimensions, hue degrees, keys |

The mono has exactly one job: anything a machine measured. It is banned from titles,
prose and buttons. Weight stops at 500 — nothing in this system is bold.

## type_scale

| role | size | weight | line-height | tracking |
|---|---|---|---|---|
| display | 72px | 400 | 0.96 | −0.028em |
| title | 40px | 400 | 1.06 | −0.022em |
| work-title | 26px | 400 | 1.14 | −0.014em |
| lede | 19px | 400 | 1.55 | −0.006em |
| body | 15px | 400 | 1.62 | 0 |
| small | 13px | 400 | 1.5 | 0 |
| meta | 11px | 500 | 1.3 | +0.12em |
| micro | 9px | 500 | 1.2 | +0.16em |

## spacing

- base: 4px
- elementGap: 12px
- cardPadding: 28px
- sectionGap: 120px
- pageMaxWidth: 1320px
- radius: **three, total** — `2px` controls and plates, `0px` every image and every
  rule, `9999px` the hue ticks and the one round toggle. Images are never rounded: a
  rounded corner on a painting is a product thumbnail, and this is a reproduction.

## elevation

Hairline borders and light. There are **no drop shadows anywhere in this site.** A
surface is distinguished by a 1px `Hairline` rule, by its level in the ramp, and by how
much of the lit work's glow falls on it. Depth comes from the light field on the plaster,
which is real rendered shading, not a `box-shadow` pretending to be one. A `filter:
drop-shadow` is permitted in exactly one place: under a lit canvas, tinted with that
work's own `--c-bloom`, because a lamp does cast a shadow.

## layout

One vertical descent. The hall is a single column of works falling down the wall, each
held at 78vh maximum so no work is ever cropped and the panorama and the tall portrait
both sit on the same floor line. A 1px plumb rule in `--c-line` runs dead straight down
the centre of the viewport through everything, so the wildly different aspect ratios read
as hung on one wall rather than as a ragged grid. Metadata sits in a 200px right-hand
margin in mono, never over the picture. The index is a real `<table>` on a 12-column grid
at 1320px. Nothing is centred except the work itself.

## imagery

Reproductions are the only images. They sit flush, unrounded, with a 1px `Hairline`
frame that lifts to `--c-glow` at 20% when lit — a frame, not a card. No masks, no
overlays, no gradient scrims on top of a painting, no hover-zoom, no filters. The image
is never tinted, blurred or dimmed except during a deliberate transition. A work with no
file yet shows its stand-in *and says so on the plate* — the archive never implies it is
showing a painting it does not have.

## components

| name | role |
|---|---|
| Wall | canvas 2D. A procedurally generated plaster height field, lit per frame by the works currently on screen. The signature surface. |
| Station | one work on the wall: reproduction, hairline frame, plumb rule, plate. |
| Plate | the label beside a lit work — number, title, dimensions, dominant in OKLCH, medium. Mono. |
| Seam | where two adjacent works' light pools overlap, mixed in OKLCH, with the mixed band visible on the plaster. |
| Collation | held-key overlay: all eleven plates at true relative scale, set like lines of type. |
| Study | the single-work view: deep zoom, annotated fragments, full palette. |
| Ledger | the index — a real table, sortable by plate, hue, chroma, aspect and motif. |
| HueRule | the 0–360° axis with a tick per work and the dead arcs left visible. |
| Import | drag-and-drop panel that reads dropped files, extracts palettes in-browser and stores them, so the archive can be filled with no tooling. |

## dos

1. **Derive every chromatic value from the artwork at runtime.** A hardcoded accent is
   the site asserting a taste of its own, and it has none.
2. **Keep the plumb rule dead straight through every view.** It is the one thing that
   makes eleven aspect ratios read as one hang.
3. **Let the dead arcs of the hue circle stay empty.** The gaps are information about the
   artist; filling them for visual balance is a lie.
4. **Put the mono only on measured quantities.** Plate numbers, pixels, degrees, OKLCH.
   The moment mono appears in a sentence, the catalogue voice collapses into a tech demo.
5. **Give every work its full 78vh.** Cropping a collage to fit a grid destroys the one
   thing the work is about, which is what is next to what.
6. **Say when a reproduction is a stand-in.** An archive that quietly shows a placeholder
   as the work is worthless as an archive.
7. **Make the light do the work of the shadow.** If a surface needs separating, light it
   or rule it; never float it.

## donts

1. **No drop shadows on cards or images.** They are the universal tell of an unplanned
   UI, and here they would simulate the one effect the site actually renders for real.
2. **No rounded corners on any reproduction.** Rounding a painting turns it into a
   product thumbnail and quietly says this is content, not work.
3. **No purple-to-blue gradient, no glassmorphism, no blurred floating blobs.** These are
   the exact vocabulary of the generic dark portfolio the artist would be embarrassed by.
4. **No colour of the site's own — no logo colour, no brand accent, no coloured button.**
   Eleven paintings are already fighting; a twelfth voice makes it noise.
5. **Never put type on top of a painting.** Not a title, not a caption, not a gradient
   scrim. The margin exists precisely so this is never necessary.
6. **No autoplaying motion that the visitor did not cause.** Nothing drifts, floats,
   pulses or breathes on its own; every movement is the consequence of an input. Ambient
   motion next to work this loud is unbearable within ten seconds.
7. **No infinite scroll and no lazy mystery.** Eleven is a knowable number. The visitor
   should always be able to see how many there are and where they are in them.
