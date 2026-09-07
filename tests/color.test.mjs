/**
 * Correctness checks for the colour engine.  node tools/../tests/color.test.mjs
 *
 * The promise this file enforces: whatever colour comes off a painting, the
 * derived theme is legible on the wall and does not shift hue on the way there.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  clampToGamut, contrastRatio, ensureContrast, hexToOklch, hexToRgb,
  mixOklab, oklchToHex, rgbToHex, rgbToOklab, oklabToRgb, theme,
} from '../assets/js/color.js'

const WALL = '#08080A'
/** Shortest angular distance between two hues, in degrees, always 0..180. */
const hueDelta = (a, b) => {
  const d = Math.abs((a - b) % 360)
  return d > 180 ? 360 - d : d
}

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'))
const glows = catalog.works.map((w) => ({ slug: w.slug, hex: w.glow }))
const allSwatches = catalog.works.flatMap((w) => w.palette.map((p) => p.hex))

test('hex round trips', () => {
  for (const hex of allSwatches) {
    assert.equal(rgbToHex(hexToRgb(hex)).toUpperCase(), hex.toUpperCase())
  }
})

test('oklab round trips within one 8-bit step', () => {
  for (const hex of allSwatches) {
    const back = rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))))
    const a = hexToRgb(hex), b = hexToRgb(back)
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(a[i] - b[i]) <= 1, `${hex} -> ${back} drifted on channel ${i}`)
    }
  }
})

test('clampToGamut returns a representable colour and keeps hue', () => {
  // Deliberately impossible: chroma far beyond what sRGB can hold at any hue.
  for (let h = 0; h < 360; h += 15) {
    const [L, C, hue] = clampToGamut([0.7, 0.4, h])
    const hex = oklchToHex([L, C, hue])
    const back = hexToOklch(hex)
    assert.ok(C <= 0.4, 'chroma should be reduced, never raised')
    assert.ok(hueDelta(back[2], h) < 2, `hue drifted at h=${h}: got ${back[2].toFixed(1)}`)
    assert.ok(Math.abs(back[0] - 0.7) < 0.02, `lightness drifted at h=${h}`)
  }
})

test('ensureContrast actually reaches the ratio it promises', () => {
  for (const hex of allSwatches) {
    const fixed = ensureContrast(hex, WALL, 4.5)
    assert.ok(
      contrastRatio(fixed, WALL) >= 4.49,
      `${hex} -> ${fixed} only reached ${contrastRatio(fixed, WALL).toFixed(2)}:1`
    )
  }
})

test('every work theme is legible on the wall', () => {
  for (const { slug, hex } of glows) {
    const t = theme(hex, { wall: WALL })
    assert.ok(contrastRatio(t.ink, WALL) >= 12, `${slug}: primary ink too dim`)
    assert.ok(contrastRatio(t.inkDim, WALL) >= 4.5, `${slug}: dim ink below 4.5:1`)
    assert.ok(contrastRatio(t.inkFaint, WALL) >= 3.0, `${slug}: faint ink below 3:1`)
    assert.ok(contrastRatio(t.accent, WALL) >= 4.5, `${slug}: accent below 4.5:1`)
  }
})

test('glow lightness is normalised into one lighting rig', () => {
  // The point of normalising: eleven works whose source colours span a wide
  // lightness range must still light the room to a comparable degree.
  const Ls = glows.map(({ hex }) => hexToOklch(theme(hex).glow)[0])
  const spread = Math.max(...Ls) - Math.min(...Ls)
  const sourceSpread = (() => {
    const s = glows.map(({ hex }) => hexToOklch(hex)[0])
    return Math.max(...s) - Math.min(...s)
  })()
  assert.ok(spread < 0.20, `glow lightness spread ${spread.toFixed(3)} is too wide`)
  assert.ok(spread < sourceSpread, 'normalising should narrow the spread, not widen it')
})

test('glow chroma is capped so it reads as light, not as a swatch', () => {
  for (const { slug, hex } of glows) {
    const [, C] = hexToOklch(theme(hex).glow)
    assert.ok(C <= 0.165, `${slug}: glow chroma ${C.toFixed(3)} exceeds the cap`)
  }
})

test('glow keeps the hue of the work it came from', () => {
  for (const { slug, hex } of glows) {
    const src = hexToOklch(hex)
    const out = hexToOklch(theme(hex).glow)
    if (src[1] < 0.03) continue // near-neutral sources have no meaningful hue
    const moved = hueDelta(out[2], src[2])
    assert.ok(moved < 8, `${slug}: hue moved by ${moved.toFixed(1)} degrees`)
  }
})

test('mixing two saturated colours does not pass through grey', () => {
  // The sRGB failure this exists to avoid: magenta to acid-yellow going via mud.
  const mid = mixOklab('#D42F7C', '#C6C123', 0.5)
  const [, C] = hexToOklch(mid)
  assert.ok(C > 0.06, `midpoint desaturated to chroma ${C.toFixed(3)}`)
})

test('themes are stable — same input, same output', () => {
  for (const { hex } of glows) {
    assert.deepEqual(theme(hex), theme(hex))
  }
})
