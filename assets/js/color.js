/**
 * Colour engine.
 *
 * Everything perceptual happens in OKLab/OKLCH. Averaging or interpolating in
 * sRGB is what makes palettes go muddy and makes a cross-fade between two
 * saturated colours pass through grey; OKLab does not do that.
 *
 * The archive's whole visual premise is that a work throws light onto a black
 * wall, so the important export here is `theme()`: given one colour off a
 * painting, produce a small, self-consistent set of values that stay legible
 * against near-black no matter how odd the source colour is.
 */

// ---------------------------------------------------------------- basics ---
export function hexToRgb(hex) {
  const h = hex.trim().replace('#', '')
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

const toLinear = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const toSrgb = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

// --------------------------------------------------------------- oklab -----
export function rgbToOklab([r, g, b]) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

export const oklabToOklch = ([L, a, b]) => [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI]
export const oklchToOklab = ([L, C, h]) => {
  const r = (h * Math.PI) / 180
  return [L, C * Math.cos(r), C * Math.sin(r)]
}

export const hexToOklch = (hex) => oklabToOklch(rgbToOklab(hexToRgb(hex)))
export const oklchToHex = (lch) => rgbToHex(oklabToRgb(oklchToOklab(lch)))

// ------------------------------------------------------------ gamut map ----
/**
 * Linear-light RGB *before* clamping. `oklabToRgb` clamps on the way out, so a
 * gamut test built on its output can never see a clipped channel — it has to be
 * done on the raw values.
 */
function oklabToLinearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/**
 * True if every channel lands inside [0,1] in linear light. Out-of-gamut values
 * that get clamped come back as a different hue, which is exactly the silent
 * failure this guards against. The epsilon absorbs float error at the boundary.
 */
function inGamut([L, C, h]) {
  const E = 1e-4
  return oklabToLinearRgb(oklchToOklab([L, C, h])).every((v) => v >= -E && v <= 1 + E)
}

/** Reduce chroma until the colour is representable, keeping L and hue. */
export function clampToGamut([L, C, h]) {
  if (inGamut([L, C, h])) return [L, C, h]
  let lo = 0, hi = C
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (inGamut([L, mid, h])) lo = mid
    else hi = mid
  }
  return [L, lo, h]
}

// ----------------------------------------------------------- contrast ------
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Raise L until `hex` clears `ratio` against `bg`, preserving hue and chroma. */
export function ensureContrast(hex, bg, ratio = 4.5) {
  let [L, C, h] = hexToOklch(hex)
  if (contrastRatio(hex, bg) >= ratio) return hex
  const bgLum = relativeLuminance(bg)
  const step = bgLum < 0.18 ? 0.02 : -0.02
  for (let i = 0; i < 50; i++) {
    L = Math.max(0, Math.min(1, L + step))
    const candidate = oklchToHex(clampToGamut([L, C, h]))
    if (contrastRatio(candidate, bg) >= ratio) return candidate
    if (L <= 0 || L >= 1) break
  }
  return bgLum < 0.18 ? '#F2F0EC' : '#111111'
}

// --------------------------------------------------------------- mixing ----
export function mixOklab(hexA, hexB, t) {
  const a = rgbToOklab(hexToRgb(hexA))
  const b = rgbToOklab(hexToRgb(hexB))
  return rgbToHex(oklabToRgb([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]))
}

// ---------------------------------------------------------------- theme ----
/**
 * Derive the room's lighting from one colour taken off a painting.
 *
 * Rules that matter, learned the hard way:
 *  - Do not use the raw colour for the glow. Source colours vary from L 0.35 to
 *    L 0.95; used directly, half the works light the room and half do nothing.
 *    Normalising L into a narrow band is what makes eleven works feel like one
 *    lighting rig.
 *  - Cap chroma. Fully saturated light on near-black vibrates, and on an OLED
 *    panel it smears. 0.16 is about the ceiling before it stops reading as light
 *    and starts reading as a colour swatch.
 *  - Text tinted toward the work must still clear 4.5:1 on the wall, always.
 */
export function theme(sourceHex, { wall = '#08080A' } = {}) {
  const [L0, C0, h] = hexToOklch(sourceHex)

  const glowL = 0.62 + (L0 - 0.5) * 0.22          // 0.55-0.72, a narrow band
  const glowC = Math.min(0.16, Math.max(0.055, C0 * 0.92))
  const glow = oklchToHex(clampToGamut([glowL, glowC, h]))

  // The light falling on the wall away from the canvas: same hue, much dimmer.
  const bloom = oklchToHex(clampToGamut([0.30 + L0 * 0.10, Math.min(0.09, C0 * 0.55), h]))
  const wash = oklchToHex(clampToGamut([0.16, Math.min(0.045, C0 * 0.32), h]))

  // Type. Primary stays near-white with only a breath of the hue in it, or the
  // page starts to look tinted rather than lit.
  const ink = oklchToHex(clampToGamut([0.955, Math.min(0.018, C0 * 0.10), h]))
  const inkDim = ensureContrast(oklchToHex(clampToGamut([0.70, Math.min(0.03, C0 * 0.16), h])), wall, 4.5)
  const inkFaint = ensureContrast(oklchToHex(clampToGamut([0.55, Math.min(0.03, C0 * 0.16), h])), wall, 3.0)
  const accent = ensureContrast(oklchToHex(clampToGamut([Math.max(0.72, glowL + 0.08), glowC, h])), wall, 4.5)

  const line = oklchToHex(clampToGamut([0.26, Math.min(0.03, C0 * 0.2), h]))

  return { source: sourceHex, glow, bloom, wash, ink, inkDim, inkFaint, accent, line, hue: h }
}

// --------------------------------------------------- applying to the DOM ----
/**
 * A plain custom property cannot be transitioned — it flips at the halfway
 * point. Registering each one with a <color> syntax is what makes the whole
 * room fade from one work's light to the next instead of cutting.
 */
const REGISTERED = ['glow', 'bloom', 'wash', 'ink', 'ink-dim', 'ink-faint', 'accent', 'line']
let registered = false

export function registerThemeProperties() {
  if (registered || typeof CSS === 'undefined' || !CSS.registerProperty) return
  registered = true
  for (const name of REGISTERED) {
    try {
      CSS.registerProperty({
        name: `--c-${name}`,
        syntax: '<color>',
        inherits: true,
        initialValue: '#808080',
      })
    } catch {
      /* already registered by a previous module instance; harmless */
    }
  }
}

export function applyTheme(t, el = document.documentElement) {
  el.style.setProperty('--c-glow', t.glow)
  el.style.setProperty('--c-bloom', t.bloom)
  el.style.setProperty('--c-wash', t.wash)
  el.style.setProperty('--c-ink', t.ink)
  el.style.setProperty('--c-ink-dim', t.inkDim)
  el.style.setProperty('--c-ink-faint', t.inkFaint)
  el.style.setProperty('--c-accent', t.accent)
  el.style.setProperty('--c-line', t.line)
  el.style.setProperty('--c-hue', String(Math.round(t.hue)))
}
