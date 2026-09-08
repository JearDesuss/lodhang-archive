/**
 * What each side of a painting throws onto the wall.
 *
 * A single radial glow says "this picture is roughly yellow". But a canvas whose
 * sky is acid yellow and whose foliage is near-black does not light a wall
 * evenly — it floods the wall above it and barely touches the floor beneath. So
 * each edge is measured separately and spills its own colour in its own
 * direction. It is the difference between a halo and actual light.
 *
 * The measurement, per edge:
 *   - take the outer 8% strip
 *   - discard the darkest quarter of the pixels, because the dark passages of a
 *     painting emit nothing and would only drag every edge toward grey
 *   - average what is left in OKLab, where averaging does not produce mud
 *   - clamp lightness into a readable band and cap chroma, so eleven works light
 *     the room to a comparable degree rather than one blowing out the others
 *   - leave hue completely alone; hue is the whole point
 */

import { rgbToOklab, oklabToRgb, rgbToHex, hexToOklch, oklchToHex } from './color.js'

const SAMPLE_EDGE = 220     // the analysis is coarse; this is plenty
const STRIP = 0.08          // outer 8%
const DISCARD_DARKEST = 0.25
const L_MIN = 0.42
const L_MAX = 0.78
const C_MIN = 0.05
const C_MAX = 0.20

const cache = new Map()

function surfaceFor(img) {
  const key = img.currentSrc || img.src
  if (cache.has(key)) return cache.get(key)
  if (!img.complete || !img.naturalWidth) return null

  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const k = Math.min(1, SAMPLE_EDGE / Math.max(nw, nh))
  const cv = document.createElement('canvas')
  cv.width = Math.max(2, Math.round(nw * k))
  cv.height = Math.max(2, Math.round(nh * k))
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  let data = null
  try {
    ctx.drawImage(img, 0, 0, cv.width, cv.height)
    data = ctx.getImageData(0, 0, cv.width, cv.height)
  } catch {
    cache.set(key, null) // tainted (cross-origin); fall back to the work's glow
    return null
  }
  const surface = { w: cv.width, h: cv.height, data: data.data }
  cache.set(key, surface)
  return surface
}

function averageStrip(surface, side) {
  const { w, h, data } = surface
  const sw = Math.max(1, Math.round(w * STRIP))
  const sh = Math.max(1, Math.round(h * STRIP))
  let x0 = 0, y0 = 0, x1 = w, y1 = h
  if (side === 'top') y1 = sh
  else if (side === 'bottom') y0 = h - sh
  else if (side === 'left') x1 = sw
  else if (side === 'right') x0 = w - sw

  const px = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      if (data[i + 3] < 8) continue
      const rgb = [data[i], data[i + 1], data[i + 2]]
      const lab = rgbToOklab(rgb)
      px.push(lab)
    }
  }
  if (!px.length) return null

  // Drop the darkest quarter: unlit paint emits nothing.
  px.sort((a, b) => a[0] - b[0])
  const keep = px.slice(Math.floor(px.length * DISCARD_DARKEST))
  const n = keep.length || 1
  let L = 0, a = 0, b = 0
  for (const p of keep) { L += p[0]; a += p[1]; b += p[2] }
  const mean = [L / n, a / n, b / n]

  // Normalise into the lighting rig, keeping hue exactly.
  const [ml, mc, mh] = hexToOklch(rgbToHex(oklabToRgb(mean)))
  return oklchToHex([
    Math.min(L_MAX, Math.max(L_MIN, ml)),
    Math.min(C_MAX, Math.max(C_MIN, mc)),
    mh,
  ])
}

/**
 * @returns {{top,right,bottom,left}|null} per-edge hex, or null if the image
 * cannot be read — callers fall back to the work's single glow colour.
 */
export function edgesOf(img) {
  const surface = surfaceFor(img)
  if (!surface) return null
  const out = {}
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const hex = averageStrip(surface, side)
    if (!hex) return null
    out[side] = hex
  }
  return out
}
