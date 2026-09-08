/**
 * Determinism.
 *
 * The whole promise of this site is that a name always produces the same beast:
 * you can send someone a link and they see exactly what you saw. That means
 * every random decision in the generator has to come from one seeded stream, and
 * `Math.random` must never appear anywhere in the drawing code.
 */

/** FNV-1a. Small, fast, and well-spread for short strings like a name. */
export function hashString(str) {
  let h = 0x811c9dc5
  const s = String(str).normalize('NFKC').trim().toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * The seed a name resolves to, as the 8-digit number shown on the plate.
 * Names are normalised first so "Ada Lovelace", "ada  lovelace" and
 * "ADA LOVELACE" are one beast rather than three.
 */
export function seedFromName(name) {
  const cleaned = String(name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!cleaned) return 0
  return hashString(cleaned) % 100000000
}

/** mulberry32 — a small, well-distributed PRNG with a single 32-bit state. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng = {
    /** float in [0,1) */
    next,
    /** float in [lo,hi) */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** integer in [lo,hi] inclusive */
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    /** true with probability p */
    chance: (p) => next() < p,
    /** uniform pick */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** weighted pick: items are [value, weight] pairs */
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + w, 0)
      let r = next() * total
      for (const [v, w] of pairs) {
        r -= w
        if (r <= 0) return v
      }
      return pairs[pairs.length - 1][0]
    },
    /** n distinct picks, order preserved */
    sample(arr, n) {
      const pool = [...arr]
      const out = []
      while (out.length < Math.min(n, pool.length)) {
        out.push(pool.splice(Math.floor(next() * pool.length), 1)[0])
      }
      return out
    },
    /** Fisher-Yates, seeded */
    shuffle(arr) {
      const a2 = [...arr]
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[a2[i], a2[j]] = [a2[j], a2[i]]
      }
      return a2
    },
    /**
     * A fresh independent stream, derived from this one. Used so that adding a
     * decision to one part of the beast does not shift every later part of it —
     * without this, changing the head code would silently change every palette.
     */
    fork: (salt) => makeRng(hashString(String(salt) + ':' + Math.floor(next() * 2 ** 32))),
  }
  return rng
}

/** Deterministic 1-D value noise, for wobbling an edge without it looking random. */
export function makeNoise(rng) {
  const table = Array.from({ length: 256 }, () => rng.next())
  return (x) => {
    const i = Math.floor(x)
    const f = x - i
    const s = f * f * (3 - 2 * f)
    const a = table[((i % 256) + 256) % 256]
    const b = table[(((i + 1) % 256) + 256) % 256]
    return a + (b - a) * s
  }
}
