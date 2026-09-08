/**
 * The instrument.
 *
 * Hold E and move the cursor across a painting: the whole room re-lights from
 * the single square inch of paint under the pointer, with the measured value
 * printed beside it. Let go and the room returns to the work's own light.
 *
 * This is the one place the archive stops being reverent and becomes a tool. It
 * is also the only honest way to answer "what colour is that, actually" — the
 * plate can only ever state one dominant, and these paintings have forty.
 *
 * Pixels are read from an offscreen copy of the image. Reading through a canvas
 * means same-origin only: the placeholders, the ingested files under works/ and
 * the object URLs from a browser drop all qualify, but a hotlinked image would
 * taint the canvas and throw. That is caught and reported rather than crashing
 * the interaction.
 */

import { theme, applyTheme, hexToOklch, rgbToHex } from './color.js'

const MAX_SAMPLE_EDGE = 1600 // enough to sample accurately, cheap to hold in memory

/**
 * @param {object} o
 * @param {() => object} o.getLitTheme  the theme to restore on release
 * @param {(t: object) => void} o.onSample  re-light the room from a sampled theme.
 *   Required: applyTheme only writes CSS custom properties, which drive type and
 *   rules. The wall is a canvas fed its own light list, so without this hook the
 *   readout changes colour and the room it is describing does not.
 * @param {() => void} o.onRestore  put the room back
 */
export function mountSampler({ getWorks, getLitTheme, onSample, onRestore, onStatus }) {
  const cache = new Map()
  let active = false
  let readout = null
  let lastHex = null

  /** An offscreen copy of the image, so individual pixels can be read. */
  function surfaceFor(img) {
    const key = img.currentSrc || img.src
    if (cache.has(key)) return cache.get(key)
    if (!img.complete || !img.naturalWidth) return null

    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const k = Math.min(1, MAX_SAMPLE_EDGE / Math.max(nw, nh))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(nw * k))
    cv.height = Math.max(1, Math.round(nh * k))
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    try {
      ctx.drawImage(img, 0, 0, cv.width, cv.height)
      // Force the security error now rather than on the first mousemove.
      ctx.getImageData(0, 0, 1, 1)
    } catch {
      cache.set(key, null)
      return null
    }
    const surface = { cv, ctx }
    cache.set(key, surface)
    return surface
  }

  function sampleAt(img, clientX, clientY) {
    const surface = surfaceFor(img)
    if (!surface) return null
    // getBoundingClientRect already accounts for any transform on the element,
    // and the image always fills its box, so a plain u/v mapping is correct in
    // the hall and inside the zoomed study view alike.
    const r = img.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    const u = (clientX - r.left) / r.width
    const v = (clientY - r.top) / r.height
    if (u < 0 || u > 1 || v < 0 || v > 1) return null

    const x = Math.min(surface.cv.width - 1, Math.max(0, Math.floor(u * surface.cv.width)))
    const y = Math.min(surface.cv.height - 1, Math.max(0, Math.floor(v * surface.cv.height)))
    const d = surface.ctx.getImageData(x, y, 1, 1).data
    if (d[3] < 8) return null
    return rgbToHex([d[0], d[1], d[2]])
  }

  function ensureReadout() {
    if (readout) return readout
    readout = document.createElement('div')
    readout.id = 'sampler-readout'
    readout.setAttribute('aria-hidden', 'true')
    document.body.appendChild(readout)
    return readout
  }

  function move(e) {
    if (!active) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const img = el?.tagName === 'IMG' ? el : el?.querySelector?.('img')
    if (!img || !img.closest('.canvas-frame, .study-stage')) return

    const hex = sampleAt(img, e.clientX, e.clientY)
    if (!hex || hex === lastHex) return
    lastHex = hex

    const t = theme(hex)
    applyTheme(t)
    onSample?.(t)
    const [L, C, h] = hexToOklch(hex)
    const r = ensureReadout()
    r.innerHTML =
      `<span class="swatch-chip" style="background:${hex}"></span>` +
      `<span>${hex}</span>` +
      `<span class="sampler-oklch">OKLCH ${L.toFixed(3)} ${C.toFixed(3)} ${((h + 360) % 360).toFixed(0)}&deg;</span>`
    r.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 18}px)`
    r.classList.add('is-on')
  }

  function start() {
    if (active) return
    active = true
    document.body.classList.add('is-sampling')
    addEventListener('mousemove', move)
    onStatus?.('Sampling. Move over a painting; release E to restore the light.')
  }

  function stop() {
    if (!active) return
    active = false
    lastHex = null
    document.body.classList.remove('is-sampling')
    removeEventListener('mousemove', move)
    readout?.classList.remove('is-on')
    const t = getLitTheme?.()
    if (t) applyTheme(t)
    onRestore?.()
  }

  addEventListener('keydown', (e) => {
    if (e.key !== 'e' && e.key !== 'E') return
    if (e.repeat) return
    if (e.target.matches?.('input, textarea')) return
    start()
  })
  addEventListener('keyup', (e) => {
    if (e.key === 'e' || e.key === 'E') stop()
  })
  // Holding a key while the window loses focus would otherwise strand the room
  // on whatever colour was last under the cursor.
  addEventListener('blur', stop)

  return { stop, isActive: () => active }
}
