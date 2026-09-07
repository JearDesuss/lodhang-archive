/**
 * Drag-and-drop ingest.
 *
 * The archive can be filled without running anything: drop the image files onto
 * this panel and the browser does what tools/ingest.py does — reads the true
 * dimensions, extracts a palette in OKLab, picks the glow, and stores the file
 * in IndexedDB so it survives a reload.
 *
 * Files are stored as Blobs rather than data URLs. A data URL is base64, which
 * is a third larger than the bytes it carries, and eleven multi-megabyte
 * paintings inflated by a third is how you hit a storage quota for no reason.
 */

import { rgbToOklab, oklabToRgb, rgbToHex } from './color.js'

// ------------------------------------------------------------- measuring ---
async function decode(file) {
  const bitmap = await createImageBitmap(file)
  return bitmap
}

function sampleCanvas(bitmap, edge = 96) {
  const c = document.createElement('canvas')
  c.width = edge
  c.height = edge
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, edge, edge)
  return ctx.getImageData(0, 0, edge, edge).data
}

const chroma = (lab) => Math.hypot(lab[1], lab[2])

/** k-means in OKLab. Deterministic seeding so the same file always agrees. */
function palette(data, k = 7, iters = 18) {
  const labs = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    labs.push(rgbToOklab([data[i], data[i + 1], data[i + 2]]))
  }
  if (!labs.length) return []

  const cents = [labs.reduce((a, b) => (chroma(b) > chroma(a) ? b : a))]
  while (cents.length < k) {
    let far = null
    let farD = -1
    for (const p of labs) {
      let d = Infinity
      for (const c of cents) d = Math.min(d, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2)
      if (d > farD) { farD = d; far = p }
    }
    if (!far || farD <= 0) break
    cents.push(far)
  }

  let buckets = []
  for (let it = 0; it < iters; it++) {
    buckets = cents.map(() => [])
    for (const p of labs) {
      let bi = 0
      let bd = Infinity
      for (let j = 0; j < cents.length; j++) {
        const c = cents[j]
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
        if (d < bd) { bd = d; bi = j }
      }
      buckets[bi].push(p)
    }
    let moved = false
    for (let j = 0; j < cents.length; j++) {
      const b = buckets[j]
      if (!b.length) continue
      const n = [0, 0, 0]
      for (const p of b) { n[0] += p[0]; n[1] += p[1]; n[2] += p[2] }
      const next = [n[0] / b.length, n[1] / b.length, n[2] / b.length]
      if (next.some((v, d) => Math.abs(v - cents[j][d]) > 1e-5)) moved = true
      cents[j] = next
    }
    if (!moved) break
  }

  const total = labs.length
  return cents
    .map((lab, j) => ({ lab, weight: (buckets[j]?.length ?? 0) / total }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((c) => ({ hex: rgbToHex(oklabToRgb(c.lab)), weight: c.weight, L: c.lab[0], C: chroma(c.lab) }))
}

/** Same scoring as tools/ingest.py, so browser and CLI agree on the light. */
function pickGlow(pal) {
  let best = null
  let score = -1
  for (const p of pal) {
    const s = p.C ** 0.85 * Math.max(p.L, 0) ** 0.55 * Math.max(p.weight, 1e-6) ** 0.22
    if (s > score) { score = s; best = p }
  }
  return best?.hex ?? '#8C8C83'
}

async function lqip(bitmap) {
  const edge = 20
  const w = bitmap.width >= bitmap.height ? edge : Math.max(1, Math.round((edge * bitmap.width) / bitmap.height))
  const h = bitmap.width >= bitmap.height ? Math.max(1, Math.round((edge * bitmap.height) / bitmap.width)) : edge
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  return c.toDataURL('image/jpeg', 0.4)
}

// -------------------------------------------------------------- matching ---
/**
 * The same order-preserving DP as tools/ingest.py: aspect ratio is
 * one-dimensional and the cost convex, so the best matching never crosses.
 */
function assign(files, works) {
  const taken = new Set()
  const pairs = new Map()
  for (const f of files) {
    const stem = f.name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-')
    for (const w of works) {
      if (taken.has(w.slug)) continue
      if (stem.includes(w.slug) || new RegExp(`\\b${w.id}\\b`).test(stem)) {
        pairs.set(w.slug, f)
        taken.add(w.slug)
        f._claimed = true
        break
      }
    }
  }
  const fs = files.filter((f) => !f._claimed).sort((a, b) => a.aspect - b.aspect)
  const ws = works.filter((w) => !taken.has(w.slug)).sort((a, b) => a.aspect - b.aspect)
  const err = (f, w) => (Math.log(f.aspect) - Math.log(w.aspect)) ** 2

  const n = fs.length
  const m = ws.length
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity))
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null))
  for (let i = 0; i <= n; i++) cost[i][0] = 0
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= Math.min(i, m); j++) {
      const skip = cost[i - 1][j]
      const take = cost[i - 1][j - 1] + err(fs[i - 1], ws[j - 1])
      if (take <= skip) { cost[i][j] = take; back[i][j] = 'take' }
      else { cost[i][j] = skip; back[i][j] = 'skip' }
    }
  }
  let i = n
  let j = Math.min(n, m)
  const leftover = []
  while (i > 0) {
    if (j > 0 && back[i][j] === 'take') { pairs.set(ws[j - 1].slug, fs[i - 1]); j-- }
    else leftover.push(fs[i - 1])
    i--
  }
  return { pairs, leftover }
}

// ----------------------------------------------------------------- panel ---
export function mountImport({ root, button, works, onSaved, dbPut, dbClear, status }) {
  const close = () => { root.hidden = true }
  const open = () => { root.hidden = false; render() }

  button.addEventListener('click', open)
  root.addEventListener('close', close)

  function render(log = []) {
    root.innerHTML = `
      <div class="import-card" role="dialog" aria-modal="true" aria-label="Import artwork files">
        <h2>Fill the archive</h2>
        <p>Drop the artwork files here. Nothing is uploaded — the files stay in this
           browser. Each one is measured, its palette read, and it is matched to a plate
           by filename, or failing that by aspect ratio. Name a file after its plate
           (<code>w06</code> or <code>bull-dove-blade</code>) to place it exactly.</p>
        <div class="dropzone" id="dz" tabindex="0" role="button">
          DROP ${works.length} IMAGE FILES — OR CLICK TO CHOOSE
          <input type="file" id="picker" accept="image/*" multiple hidden>
        </div>
        <div class="import-log" id="log">${log.map((l) => `<div>${l}</div>`).join('')}</div>
        <div class="import-actions">
          <button class="btn" id="clear">Clear stored</button>
          <button class="btn" id="done">Close</button>
        </div>
      </div>`

    const dz = root.querySelector('#dz')
    const picker = root.querySelector('#picker')
    root.querySelector('#done').addEventListener('click', close)
    root.querySelector('#clear').addEventListener('click', async () => {
      await dbClear()
      status('Stored files cleared.')
      await onSaved()
      render(['cleared'])
    })

    dz.addEventListener('click', () => picker.click())
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') picker.click() })
    picker.addEventListener('change', () => handle([...picker.files]))

    for (const ev of ['dragenter', 'dragover']) {
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over') })
    }
    for (const ev of ['dragleave', 'drop']) {
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over') })
    }
    dz.addEventListener('drop', (e) => handle([...(e.dataTransfer?.files ?? [])]))
  }

  async function handle(fileList) {
    const files = fileList.filter((f) => f.type.startsWith('image/'))
    if (!files.length) return status('Those were not image files.')

    const log = [`reading ${files.length} file(s)...`]
    render(log)

    const measured = []
    for (const file of files) {
      try {
        const bitmap = await decode(file)
        measured.push({
          file,
          name: file.name,
          width: bitmap.width,
          height: bitmap.height,
          aspect: bitmap.width / bitmap.height,
          bitmap,
        })
      } catch {
        log.push(`! could not decode ${file.name}`)
      }
    }

    const { pairs, leftover } = assign(measured, works)
    for (const [slug, f] of pairs) {
      const pal = palette(sampleCanvas(f.bitmap))
      const rec = {
        slug,
        blob: f.file,
        name: f.name,
        width: f.width,
        height: f.height,
        aspect: f.width / f.height,
        bytes: f.file.size,
        palette: pal.map((p) => p.hex),
        glow: pickGlow(pal),
        lqip: await lqip(f.bitmap),
      }
      const ok = await dbPut(rec)
      const w = works.find((x) => x.slug === slug)
      log.push(`${ok ? '' : '! failed '}${w.id} ${f.name} → ${w.title} · ${rec.glow}`)
      f.bitmap.close?.()
    }
    for (const f of leftover) log.push(`unmatched: ${f.name}`)

    render(log)
    await onSaved()
  }
}
