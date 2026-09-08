/**
 * Paint primitives.
 *
 * Everything in this site is drawn with code and nothing is an image file, so
 * these functions carry the whole visual argument: whether a generated beast
 * reads as a torn, over-painted collage or as vector clip-art comes down to
 * what is in here.
 *
 * Four things do most of that work, and none of them are optional:
 *   - no edge is ever straight or clean. Every boundary is subdivided and
 *     jittered along its normal, the way torn paper is.
 *   - no area is ever one flat colour. Fills are scumbled with broken strokes
 *     of neighbouring palette colours, so the surface has tooth.
 *   - the seams between elements are left visible rather than blended.
 *   - hard, mechanical intrusions — glitch bars, flat rectangles — are cut
 *     straight across the organic shapes without apology.
 */

// -------------------------------------------------------------- colour ------
export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/** Shift a colour toward black or white without leaving its hue. */
export function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex)
  const t = amount < 0 ? 0 : 255
  const k = Math.abs(amount)
  const m = (v) => Math.round(v + (t - v) * k)
  return `rgb(${m(r)},${m(g)},${m(b)})`
}

// ---------------------------------------------------------------- edges -----
/**
 * Subdivide a closed polygon and push every new point along the local normal by
 * a noisy amount. `rough` is in pixels; 1-2 reads as a cut edge, 6-14 as torn
 * paper, 20+ as something that was ripped in a hurry.
 */
export function tornPath(ctx, pts, rough = 6, rng, noise, seedOffset = 0) {
  const out = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    // More subdivisions on longer edges, so roughness reads at a constant scale.
    const steps = Math.max(2, Math.round(len / 11))
    const nx = -dy / len
    const ny = dx / len
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const px = a[0] + dx * t
      const py = a[1] + dy * t
      const k = noise(seedOffset + i * 7.3 + t * steps * 0.9) - 0.5
      const k2 = noise(seedOffset * 1.7 + i * 3.1 + t * steps * 2.7) - 0.5
      const push = (k * 1.6 + k2 * 0.7) * rough
      out.push([px + nx * push, py + ny * push])
    }
  }
  ctx.beginPath()
  ctx.moveTo(out[0][0], out[0][1])
  for (let i = 1; i < out.length; i++) ctx.lineTo(out[i][0], out[i][1])
  ctx.closePath()
  return out
}

/** A rectangle as four corners, for feeding to tornPath. */
export const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

/** An ellipse as a polygon, for feeding to tornPath. */
export function ellipsePts(cx, cy, rx, ry, steps = 26, rot = 0) {
  const pts = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * ry
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])
  }
  return pts
}

// ---------------------------------------------------------------- fills -----
/**
 * Fill the current path with a colour that has been broken up: a base, then
 * short strokes of neighbouring palette colours laid across it. A flat fill is
 * the single biggest tell of generated art, and this is the antidote.
 */
export function scumble(ctx, base, others, rng, noise, opts = {}) {
  const { strokes = 26, alpha = 0.30, width = 16, angle = null } = opts
  ctx.save()
  ctx.clip()

  const { x, y, w, h } = pathBox(ctx)
  ctx.fillStyle = base
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8)

  const theta = angle ?? rng.range(-0.5, 0.5)
  const span = Math.hypot(w, h)
  ctx.lineCap = 'round'
  for (let i = 0; i < strokes; i++) {
    const c = others.length ? rng.pick(others) : base
    ctx.strokeStyle = rgba(typeof c === 'string' && c.startsWith('#') ? c : '#ffffff',
      alpha * rng.range(0.35, 1))
    ctx.lineWidth = width * rng.range(0.25, 1.25)
    const cx = x + rng.next() * w
    const cy = y + rng.next() * h
    const len = span * rng.range(0.12, 0.55)
    const a = theta + rng.range(-0.28, 0.28)
    ctx.beginPath()
    // A slight bow, so a stroke reads as a loaded blade dragged across, not a ruler.
    const mx = cx + Math.cos(a) * len * 0.5 - Math.sin(a) * rng.range(-8, 8)
    const my = cy + Math.sin(a) * len * 0.5 + Math.cos(a) * rng.range(-8, 8)
    ctx.moveTo(cx - Math.cos(a) * len * 0.5, cy - Math.sin(a) * len * 0.5)
    ctx.quadraticCurveTo(mx, my, cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5)
    ctx.stroke()
  }
  ctx.restore()
}

/** Bounding box of the current path, via a cheap re-walk of the last polygon. */
let lastPolygon = null
export function setLastPolygon(pts) { lastPolygon = pts }
function pathBox() {
  if (!lastPolygon || !lastPolygon.length) return { x: -2000, y: -2000, w: 4000, h: 4000 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of lastPolygon) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Draw a torn shape, filled and scumbled, in one call. */
export function shape(ctx, pts, fill, others, rng, noise, opts = {}) {
  const poly = tornPath(ctx, pts, opts.rough ?? 6, rng, noise, opts.seed ?? 0)
  setLastPolygon(poly)
  scumble(ctx, fill, others, rng, noise, opts)
  if (opts.edge) {
    tornPath(ctx, pts, opts.rough ?? 6, rng, noise, opts.seed ?? 0)
    ctx.strokeStyle = rgba(opts.edge, opts.edgeAlpha ?? 0.5)
    ctx.lineWidth = opts.edgeWidth ?? 1.4
    ctx.stroke()
  }
  return poly
}

// ------------------------------------------------------------ intrusions ----
/**
 * Datamosh bars. Hard-edged, mechanical, cut straight across whatever is under
 * them — in the source work these never respect the figure, and neither do these.
 */
export function glitchBars(ctx, x, y, w, h, palette, rng, count = 7) {
  ctx.save()
  for (let i = 0; i < count; i++) {
    const vertical = rng.chance(0.45)
    const c = rng.pick(palette)
    ctx.fillStyle = rgba(c, rng.range(0.22, 0.72))
    if (vertical) {
      const bx = x + rng.next() * w
      ctx.fillRect(bx, y + rng.range(-0.1, 0.4) * h, rng.range(2, 0.045 * w), h * rng.range(0.3, 1.1))
    } else {
      const by = y + rng.next() * h
      ctx.fillRect(x + rng.range(-0.1, 0.3) * w, by, w * rng.range(0.3, 1.15), rng.range(2, 0.035 * h))
    }
  }
  ctx.restore()
}

/** Paint running down off a wet edge. */
export function drips(ctx, x, y, w, color, rng, count = 5) {
  ctx.save()
  ctx.fillStyle = rgba(color, 0.55)
  for (let i = 0; i < count; i++) {
    const dx = x + rng.next() * w
    const len = rng.range(12, 90)
    const wid = rng.range(1.5, 5)
    ctx.fillRect(dx, y, wid, len)
    ctx.beginPath()
    ctx.arc(dx + wid / 2, y + len, wid * 0.8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** A loaded palette-knife stroke: thick, tapered, slightly bowed. */
export function slab(ctx, x0, y0, x1, y1, width, color, rng) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const steps = 14
  const top = []
  const bot = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Fat in the middle, thin at both ends — how a blade unloads.
    const taper = Math.sin(t * Math.PI) ** 0.6
    const wob = rng.range(0.82, 1.18)
    const wHalf = (width / 2) * taper * wob
    const px = x0 + dx * t
    const py = y0 + dy * t
    top.push([px + nx * wHalf, py + ny * wHalf])
    bot.push([px - nx * wHalf, py - ny * wHalf])
  }
  ctx.beginPath()
  ctx.moveTo(top[0][0], top[0][1])
  for (const p of top) ctx.lineTo(p[0], p[1])
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1])
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

// ----------------------------------------------------------------- grain ----
/** Film grain over the whole frame. Cheap, and it is what unifies the layers. */
export function grain(ctx, w, h, rng, amount = 0.055) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 255 * amount
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
}
