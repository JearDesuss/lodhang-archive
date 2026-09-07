/**
 * The archive's data layer.
 *
 * Three sources, merged in this order of authority:
 *   1. data/catalog.json   the writing — titles, descriptions, fragments, motifs.
 *                          Authored by hand, never overwritten by tooling.
 *   2. data/manifest.json  what tools/ingest.py measured off the real files.
 *   3. IndexedDB           anything dropped straight into the browser, which
 *                          beats the manifest so the site can be filled with no
 *                          tooling at all.
 *
 * Keeping the writing and the measurements in separate files is deliberate:
 * re-running ingest must never be able to destroy the catalogue text.
 */

import { theme } from './color.js'

const DB_NAME = 'lodhang'
const DB_STORE = 'drops'

// ------------------------------------------------------------ indexeddb ----
function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return resolve(null)
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'slug' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null) // private mode etc — degrade, never throw
  })
}

async function dbAll() {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const req = tx.objectStore(DB_STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
}

export async function dbPut(record) {
  const db = await openDb()
  if (!db) return false
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(record)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

export async function dbClear() {
  const db = await openDb()
  if (!db) return false
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).clear()
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

// ----------------------------------------------------------------- load ----
async function getJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

/**
 * @returns {Promise<{works:Array, motifs:Object, archive:Object, resolved:number,
 *                    hasManifest:boolean}>}
 */
/** Object URLs handed out for dropped Blobs, so they can be released on reload. */
let objectUrls = []

function revokeDropUrls() {
  for (const u of objectUrls) URL.revokeObjectURL(u)
  objectUrls = []
}

export async function load() {
  revokeDropUrls()
  const [catalog, manifest, drops] = await Promise.all([
    getJson('data/catalog.json'),
    getJson('data/manifest.json'),
    dbAll(),
  ])
  if (!catalog) throw new Error('data/catalog.json could not be loaded')

  const byId = new Map((manifest?.entries ?? []).map((e) => [e.slug, e]))
  const byDrop = new Map(drops.map((d) => [d.slug, d]))

  const works = catalog.works.map((w, i) => {
    const m = byId.get(w.slug) ?? {}
    const d = byDrop.get(w.slug)

    // A dropped file always wins: the visitor put it there on purpose.
    // Dropped files are Blobs, so they need an object URL. These are revoked in
    // revokeDropUrls() before any reload of the store, or they leak on every
    // re-render.
    let src = m.src ?? `assets/placeholder/${w.slug}.jpg`
    if (d?.blob) {
      src = URL.createObjectURL(d.blob)
      objectUrls.push(src)
    }
    const placeholder = d ? false : (m.placeholder ?? true)
    const palette = d?.palette ?? (m.palette?.length ? m.palette : w.palette.map((p) => p.hex))
    const glow = d?.glow ?? m.glow ?? w.glow
    const aspect = d?.aspect ?? m.aspect ?? w.aspect

    return {
      ...w,
      index: i,
      plate: String(i + 1).padStart(2, '0'),
      src,
      placeholder,
      source: d ? 'drop' : (m.placeholder === false ? 'file' : 'stand-in'),
      width: d?.width ?? m.width ?? null,
      height: d?.height ?? m.height ?? null,
      bytes: m.bytes ?? d?.bytes ?? null,
      lqip: d?.lqip ?? m.lqip ?? null,
      aspect,
      palette,
      // Keep the authored palette names — the measured palette has none.
      paletteNames: w.palette,
      glow,
      theme: theme(glow),
    }
  })

  return {
    works,
    motifs: catalog.motifs ?? {},
    archive: catalog.archive ?? {},
    resolved: works.filter((w) => !w.placeholder).length,
    hasManifest: !!manifest,
  }
}

// ------------------------------------------------------------- ordering ----
/** Hue in degrees, 0-360, of a work's glow. The archive's second index. */
export function hueOf(work) {
  return (work.theme.hue + 360) % 360
}

export const ORDERS = {
  plate: {
    label: 'Plate',
    hint: 'the order they were catalogued',
    sort: (a, b) => a.index - b.index,
  },
  hue: {
    label: 'Hue',
    hint: '0 to 360 degrees, with the dead arcs left empty',
    sort: (a, b) => hueOf(a) - hueOf(b),
  },
  aspect: {
    label: 'Format',
    hint: 'widest to tallest',
    sort: (a, b) => b.aspect - a.aspect,
  },
}

export function order(works, key) {
  return [...works].sort((ORDERS[key] ?? ORDERS.plate).sort)
}

/**
 * The gaps in the hue circle, as arcs the artist never went near. Reported so
 * the interface can leave them visibly dead instead of quietly closing them up.
 */
export function deadArcs(works, minWidth = 28) {
  const hues = works.map(hueOf).sort((a, b) => a - b)
  const arcs = []
  for (let i = 0; i < hues.length; i++) {
    const from = hues[i]
    const to = i === hues.length - 1 ? hues[0] + 360 : hues[i + 1]
    if (to - from >= minWidth) arcs.push({ from, to: to % 360 === to ? to : to - 360, width: to - from })
  }
  return arcs.sort((a, b) => b.width - a.width)
}
