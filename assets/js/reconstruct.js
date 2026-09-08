/**
 * Reconstructions.
 *
 * The archive has eleven catalogue entries and no image files. A blurred grey
 * rectangle stamped PLACEHOLDER is not a stand-in for a painting, it is an empty
 * room with the lights on — which is exactly what the archive looked like.
 *
 * So each work paints itself instead, from what the catalogue actually knows:
 * its palette, its aspect, and its motifs. `beast` puts an animal-headed figure
 * in it, `bird` opens a pair of wings, `glitch` cuts datamosh across it,
 * `old-master` sinks a framed panel into it, `barrier` runs safety tape over the
 * front. The result is a picture with the right colour, the right format and the
 * right furniture, made deterministically from the entry.
 *
 * It is NOT the painting and the interface never says it is. Every plate
 * carrying one says RECONSTRUCTION, and the moment a real file lands in works/
 * it replaces this entirely.
 */

import { makeRng, makeNoise, hashString } from './rng.js'
import { hexToOklch } from './color.js'
import {
  shape, rectPts, ellipsePts, glitchBars, drips, slab, rgba, shade, tornPath,
  setLastPolygon,
} from './paint.js'

// ------------------------------------------------------------ palette roles --
/**
 * The catalogue stores a flat list of swatches; painting needs to know which of
 * them is the sky and which is the horn. Roles are assigned by scoring each
 * swatch in OKLCH, so the mapping follows the actual colour rather than the
 * order somebody happened to type them in.
 */
function roles(palette) {
  const sw = palette.map((hex) => {
    const [L, C, h] = hexToOklch(hex)
    return { hex, L, C, h: (h + 360) % 360 }
  })
  const by = (score) => [...sw].sort((a, b) => score(b) - score(a))[0].hex
  const many = (score, n) => [...sw].sort((a, b) => score(b) - score(a)).slice(0, n).map((s) => s.hex)

  const isGreen = (s) => s.h > 90 && s.h < 190
  const isWarm = (s) => s.h < 75 || s.h > 330

  return {
    ground: by((s) => 1 - s.L),                       // darkest
    field: many((s) => s.C * 1.4 + s.L * 0.3, 4),     // the chromatic slabs
    sky: by((s) => s.C * 0.7 + s.L),                  // bright and coloured
    leaf: many((s) => (isGreen(s) ? 1 : 0) + s.C, 3),
    flesh: many((s) => (isWarm(s) ? 0.8 : 0) + s.L * 0.9 - s.C * 0.6, 2),
    metal: many((s) => (1 - s.C * 4) + s.L * 0.4, 2),
    wool: many((s) => s.L - s.C * 1.5, 2),
    cloth: many((s) => s.C, 3),
    fur: many((s) => s.C * 0.4 + (1 - Math.abs(s.L - 0.5)), 2),
    horn: by((s) => s.L - s.C),
    gold: by((s) => (s.h > 40 && s.h < 110 ? 1 : 0) + s.C + s.L * 0.5),
    all: palette,
  }
}

// ------------------------------------------------------------------ pieces ---
function fields(ctx, W, H, p, rng, noise) {
  ctx.fillStyle = p.ground
  ctx.fillRect(0, 0, W, H)
  // Six, not eight. Every field is scumbled with strokes borrowed from the rest
  // of the palette, so each additional layer pulls the whole surface toward the
  // palette's mean — pile up eight and a work with a light palette averages out
  // into cream mush with no value structure at all.
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = rng.range(0.62, 1)
    shape(ctx, rectPts(
      rng.range(-0.2, 0.7) * W, rng.range(-0.2, 0.7) * H,
      rng.range(0.3, 1) * W, rng.range(0.2, 0.7) * H,
    ), rng.pick(p.field), p.all, rng, noise,
      { rough: rng.range(10, 28), seed: i * 13, strokes: 20, width: W * 0.05, alpha: 0.22 })
  }

  // Then put the shadow back. These paintings all have deep darks against the
  // high chroma, and without a pass that is allowed to be nearly black the
  // reconstruction has highlights and midtones and nothing else.
  for (let i = 0; i < rng.int(2, 4); i++) {
    ctx.globalAlpha = rng.range(0.55, 0.92)
    shape(ctx, rectPts(
      rng.range(-0.25, 0.8) * W, rng.range(-0.25, 0.8) * H,
      rng.range(0.18, 0.6) * W, rng.range(0.2, 0.75) * H,
    ), shade(p.ground, rng.range(-0.15, 0.12)), [p.ground, shade(p.ground, 0.2)],
      rng, noise, { rough: rng.range(12, 30), seed: 200 + i, strokes: 12, width: W * 0.05, alpha: 0.18 })
  }
  ctx.globalAlpha = 1
}

function skyBand(ctx, W, H, p, rng, noise) {
  ctx.globalAlpha = 0.92
  shape(ctx, rectPts(-40, rng.range(-0.05, 0.1) * H, W + 80, rng.range(0.16, 0.34) * H),
    p.sky, p.all, rng, noise, { rough: 18, seed: 91, strokes: 20, width: W * 0.06, alpha: 0.22 })
  ctx.globalAlpha = 1
}

function foliage(ctx, W, H, p, rng) {
  const n = rng.int(14, 26)
  for (let i = 0; i < n; i++) {
    const bx = rng.range(-0.06, 1.06) * W
    const by = rng.range(0.35, 1.1) * H
    const len = rng.range(0.1, 0.36) * H
    const ang = rng.range(-Math.PI * 0.95, -Math.PI * 0.05)
    const col = rng.pick(p.leaf)
    ctx.globalAlpha = rng.range(0.5, 1)
    slab(ctx, bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len,
      rng.range(0.02, 0.075) * W, col, rng)
    ctx.globalAlpha = rng.range(0.2, 0.5)
    ctx.strokeStyle = shade(col, -0.4)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** A quoted painting sunk into the surface, with its own frame and darker key. */
function oldMasterPanel(ctx, W, H, p, rng, noise) {
  const pw = rng.range(0.42, 0.72) * W
  const ph = rng.range(0.34, 0.62) * H
  const px = rng.range(0.05, 0.95) * (W - pw)
  const py = rng.range(0.05, 0.9) * (H - ph)

  ctx.save()
  ctx.globalAlpha = 0.96
  shape(ctx, rectPts(px, py, pw, ph), shade(p.ground, 0.18), p.wool, rng, noise,
    { rough: 4, seed: 301, strokes: 26, width: pw * 0.14, alpha: 0.2 })
  // A dim interior: a warm pool with a couple of figures implied inside it.
  const g = ctx.createRadialGradient(px + pw * 0.5, py + ph * 0.45, 4,
    px + pw * 0.5, py + ph * 0.45, Math.max(pw, ph) * 0.7)
  g.addColorStop(0, rgba(p.gold, 0.34))
  g.addColorStop(1, rgba(p.gold, 0))
  ctx.fillStyle = g
  ctx.fillRect(px, py, pw, ph)
  for (let i = 0; i < rng.int(1, 3); i++) {
    ctx.globalAlpha = rng.range(0.5, 0.85)
    shape(ctx, ellipsePts(px + rng.range(0.25, 0.75) * pw, py + rng.range(0.4, 0.8) * ph,
      pw * rng.range(0.06, 0.13), ph * rng.range(0.12, 0.26), 18),
      rng.pick(p.cloth), p.all, rng, noise,
      { rough: 6, seed: 310 + i, strokes: 10, width: 18, alpha: 0.24 })
  }
  ctx.globalAlpha = 1
  // Gilt frame.
  ctx.strokeStyle = rgba(p.gold, 0.85)
  ctx.lineWidth = Math.max(3, W * 0.008)
  ctx.strokeRect(px, py, pw, ph)
  ctx.restore()
}

/** A standing figure: torso, limbs, and an animal head if the work has beasts. */
function figure(ctx, W, H, p, rng, noise, { beast, armour, scale = 1 }) {
  const fh = H * rng.range(0.5, 0.72) * scale
  const cx = W * rng.range(0.3, 0.7)
  const feet = H * rng.range(0.88, 1.02)
  const top = feet - fh
  const shoulder = top + fh * 0.3
  const hip = top + fh * 0.62
  const halfS = fh * 0.15
  const halfH = fh * 0.12

  // Legs
  for (const side of [-1, 1]) {
    const hx = cx + side * halfH * 0.55
    slab(ctx, hx, hip, hx + side * rng.range(-6, 22), feet, fh * 0.075, p.flesh[0], rng)
  }
  // Torso
  shape(ctx, [
    [cx - halfS * 0.8, shoulder - fh * 0.03],
    [cx - halfS, shoulder + fh * 0.04],
    [cx - halfH, hip],
    [cx + halfH, hip],
    [cx + halfS, shoulder + fh * 0.04],
    [cx + halfS * 0.8, shoulder - fh * 0.03],
  ], armour ? p.metal[0] : p.flesh[0], armour ? p.metal : p.flesh, rng, noise,
    { rough: armour ? 4 : 7, seed: 401, strokes: 26, width: fh * 0.07, alpha: 0.3 })

  // Drapery, nearly always — it is the one thing in every one of these works.
  ctx.globalAlpha = rng.range(0.8, 1)
  shape(ctx, [
    [cx - rng.range(0.5, 1.5) * halfS, shoulder + rng.range(-20, 20)],
    [cx + rng.range(0.5, 1.5) * halfS, shoulder + rng.range(-10, 30)],
    [cx + rng.range(0.7, 1.9) * halfS, hip + fh * rng.range(0.05, 0.3)],
    [cx - rng.range(0.7, 1.9) * halfS, hip + fh * rng.range(0.02, 0.26)],
  ], rng.pick(p.cloth), p.cloth, rng, noise,
    { rough: 15, seed: 402, strokes: 28, width: fh * 0.09, alpha: 0.3 })
  ctx.globalAlpha = 1

  // Arms
  for (const side of [-1, 1]) {
    const sx = cx + side * halfS * 0.9
    slab(ctx, sx, shoulder + fh * 0.03, sx + side * rng.range(10, 50),
      shoulder + fh * rng.range(0.26, 0.42), fh * 0.05, p.flesh[0], rng)
  }

  // Head
  const hr = fh * (beast ? 0.135 : 0.105)
  const hy = top + hr * 0.9
  slab(ctx, cx, hy + hr * 0.7, cx, shoulder, fh * 0.055, p.flesh[0], rng)
  shape(ctx, ellipsePts(cx, hy, hr, hr * 1.08, 24), beast ? p.fur[0] : p.flesh[0],
    beast ? p.fur : p.flesh, rng, noise,
    { rough: 5, seed: 403, strokes: 16, width: hr * 0.5, alpha: 0.28 })

  if (beast) {
    // A muzzle and a pair of horns: enough to read as an animal at plate size.
    const f = rng.chance(0.5) ? 1 : -1
    shape(ctx, [
      [cx, hy - hr * 0.3], [cx + f * hr * 1.15, hy - hr * 0.12],
      [cx + f * hr * 1.1, hy + hr * 0.34], [cx, hy + hr * 0.5],
    ], p.fur[1] ?? p.fur[0], p.fur, rng, noise,
      { rough: 4, seed: 404, strokes: 8, width: hr * 0.3, alpha: 0.26 })
    for (const side of [-1, 1]) {
      let x = cx + side * hr * 0.55
      let y = hy - hr * 0.6
      let a = -Math.PI / 2 + side * 0.5
      for (let i = 0; i < 9; i++) {
        const len = hr * 0.3
        const nx = x + Math.cos(a) * len
        const ny = y + Math.sin(a) * len
        slab(ctx, x, y, nx, ny, hr * (0.2 - i * 0.017), p.horn, rng)
        x = nx; y = ny; a += side * 0.22
      }
    }
  }
  // Eye — the mark that makes the whole thing look at you.
  ctx.fillStyle = '#f2ece0'
  ctx.beginPath()
  ctx.ellipse(cx + hr * 0.34, hy - hr * 0.12, hr * 0.15, hr * 0.11, 0, 0, 6.3)
  ctx.fill()
  ctx.fillStyle = '#0e0b09'
  ctx.beginPath()
  ctx.arc(cx + hr * 0.36, hy - hr * 0.12, hr * 0.07, 0, 6.3)
  ctx.fill()
}

function bigBird(ctx, W, H, p, rng) {
  const cx = W * rng.range(0.15, 0.85)
  const cy = H * rng.range(0.2, 0.6)
  const reach = Math.min(W, H) * rng.range(0.3, 0.52)
  for (const side of [-1, 1]) {
    const n = rng.int(9, 15)
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const ang = -0.9 + t * 1.7
      const len = reach * (0.5 + 0.5 * Math.sin(t * Math.PI))
      ctx.globalAlpha = rng.range(0.7, 1)
      slab(ctx, cx, cy, cx + side * Math.cos(ang) * len, cy + Math.sin(ang) * len,
        reach * rng.range(0.05, 0.11), rng.pick(p.wool), rng)
    }
  }
  ctx.globalAlpha = 1
  shape(ctx, ellipsePts(cx, cy + reach * 0.1, reach * 0.14, reach * 0.24, 18),
    p.wool[0], p.wool, rng, () => 0.5, { rough: 5, seed: 501, strokes: 8, width: 14, alpha: 0.2 })
}

function goldwork(ctx, W, H, p, rng, noise) {
  const cx = W * rng.range(0.25, 0.75)
  const cy = H * rng.range(0.1, 0.4)
  const s = Math.min(W, H) * rng.range(0.08, 0.16)
  const pts = [[cx - s, cy + s * 0.4]]
  const spikes = rng.int(4, 6)
  for (let i = 0; i <= spikes; i++) {
    pts.push([cx - s + (i / spikes) * s * 2, cy - s * (i % 2 ? 0.15 : 0.8)])
  }
  pts.push([cx + s, cy + s * 0.4])
  shape(ctx, pts, p.gold, [p.gold, shade(p.gold, 0.3), shade(p.gold, -0.3)], rng, noise,
    { rough: 3, seed: 601, strokes: 14, width: s * 0.3, alpha: 0.34 })
}

/** Red-and-white safety barrier, straight across the front of the picture. */
function barrier(ctx, W, H, p, rng) {
  const y = H * rng.range(0.55, 0.9)
  const th = H * rng.range(0.035, 0.075)
  const ang = rng.range(-0.06, 0.06)
  ctx.save()
  ctx.translate(0, y)
  ctx.rotate(ang)
  const red = p.field.find((c) => hexToOklch(c)[2] < 40 || hexToOklch(c)[2] > 340) ?? p.field[0]
  ctx.fillStyle = '#EFEDE6'
  ctx.fillRect(-W * 0.1, 0, W * 1.2, th)
  ctx.fillStyle = red
  for (let x = -W * 0.1; x < W * 1.1; x += th * 1.6) {
    ctx.beginPath()
    ctx.moveTo(x, th)
    ctx.lineTo(x + th * 0.8, 0)
    ctx.lineTo(x + th * 1.6, 0)
    ctx.lineTo(x + th * 0.8, th)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** Painted lettering, in the register of a word scrawled across a shoulder. */
function painted(ctx, W, H, p, rng, word) {
  ctx.save()
  ctx.translate(W * rng.range(0.1, 0.5), H * rng.range(0.4, 0.8))
  ctx.rotate(rng.range(-0.12, 0.12))
  ctx.fillStyle = rgba('#EFEDE6', 0.9)
  ctx.font = `700 ${Math.round(Math.min(W, H) * 0.11)}px ui-monospace, Consolas, monospace`
  ctx.fillText(word, 0, 0)
  ctx.restore()
}

// ------------------------------------------------------------------- main ----
/**
 * @param {object} work catalogue entry (palette, motifs, aspect, slug)
 * @param {number} longEdge pixel size of the long edge
 * @returns {HTMLCanvasElement}
 */
export function reconstruct(work, longEdge = 1400) {
  const ar = work.aspect || 1
  const W = ar >= 1 ? longEdge : Math.round(longEdge * ar)
  const H = ar >= 1 ? Math.round(longEdge / ar) : longEdge

  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')

  const seed = hashString(work.slug)
  const rng = makeRng(seed)
  const noise = makeNoise(makeRng(seed + 7))
  const p = roles(work.palette)
  const has = (m) => work.motifs.includes(m)

  fields(ctx, W, H, p, rng, noise)
  if (has('old-master')) oldMasterPanel(ctx, W, H, p, rng, noise)
  if (!has('old-master') || rng.chance(0.5)) skyBand(ctx, W, H, p, rng, noise)
  if (has('foliage')) foliage(ctx, W, H, p, rng)
  if (has('bird')) bigBird(ctx, W, H, p, rng)

  // A panorama gets a frieze of figures; everything else gets one or two.
  if (has('beast') || has('flesh') || has('armour')) {
    const n = ar > 1.4 ? rng.int(2, 3) : rng.int(1, 2)
    for (let i = 0; i < n; i++) {
      figure(ctx, W, H, p, rng, noise, {
        beast: has('beast'),
        armour: has('armour') && rng.chance(0.7),
        scale: n > 1 ? rng.range(0.7, 1) : 1,
      })
    }
  }

  if (has('gold')) goldwork(ctx, W, H, p, rng, noise)
  if (has('barrier')) barrier(ctx, W, H, p, rng)
  if (has('text')) painted(ctx, W, H, p, rng, 'NOTION')
  if (has('paint')) drips(ctx, rng.range(0, W * 0.6), H * rng.range(0.2, 0.6),
    W * rng.range(0.2, 0.5), rng.pick(p.field), rng, rng.int(5, 10))
  if (has('glitch')) glitchBars(ctx, -20, 0, W + 40, H, p.all, rng, rng.int(6, 12))
  if (has('collage')) {
    // The torn strip that admits the picture is made of other pictures.
    const x = rng.chance(0.5) ? 0 : W - rng.range(0.06, 0.16) * W
    ctx.globalAlpha = 0.94
    shape(ctx, rectPts(x, -20, rng.range(0.06, 0.16) * W, H + 40),
      rng.pick(p.field), p.all, rng, noise,
      { rough: 9, seed: 701, strokes: 24, width: W * 0.04, alpha: 0.3 })
    ctx.globalAlpha = 1
  }

  // Vignette, so it sits in a room rather than on a swatch.
  const vg = ctx.createRadialGradient(W / 2, H * 0.44, Math.min(W, H) * 0.16,
    W / 2, H * 0.5, Math.max(W, H) * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(4,4,6,0.74)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)

  // A floor shadow. Costs nothing and gives even the palest palette a bottom.
  const fl = ctx.createLinearGradient(0, H * 0.72, 0, H)
  fl.addColorStop(0, 'rgba(6,5,8,0)')
  fl.addColorStop(1, 'rgba(6,5,8,0.5)')
  ctx.fillStyle = fl
  ctx.fillRect(0, H * 0.72, W, H * 0.28)

  return cv
}
