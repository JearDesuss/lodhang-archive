/**
 * LODHANG — the archive.
 *
 * Structure: one store, one wall, three views (hall, ledger, study) and two
 * overlays (collation, import). The router is the hash.
 *
 * The rule that shapes most of this file: nothing in the interface has a colour
 * of its own. Whichever work is currently lit publishes its theme to the root
 * element, and every rule, numeral and label inherits from there.
 */

import { applyTheme, registerThemeProperties, theme, hexToOklch } from './color.js'
import { load, order, ORDERS, hueOf, dbPut, dbClear } from './store.js'
import { Wall } from './wall.js'
import { mountImport } from './import.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

const state = {
  works: [],
  motifs: {},
  archive: {},
  orderKey: 'plate',
  view: 'hall',
  lit: 0,
  wall: null,
  collating: false,
}

// ------------------------------------------------------------------ util ----
function status(msg, ms = 2400) {
  const el = $('#status')
  el.textContent = msg
  el.classList.add('is-on')
  clearTimeout(status._t)
  status._t = setTimeout(() => el.classList.remove('is-on'), ms)
}

function fmtInt(n) {
  return n == null ? '—' : new Intl.NumberFormat('en').format(n)
}

/** The measured reading for a colour, in the notation the plate uses. */
function oklchText(hex) {
  const [L, C, h] = hexToOklch(hex)
  return `OKLCH ${L.toFixed(3)} ${C.toFixed(3)} ${((h + 360) % 360).toFixed(0)}°`
}

// --------------------------------------------------------------- the hall ---
function renderHall() {
  const host = $('#stations')
  const works = order(state.works, state.orderKey)
  host.innerHTML = ''

  for (const w of works) {
    const station = document.createElement('article')
    station.className = 'station'
    station.dataset.slug = w.slug
    station.dataset.lit = '0'
    station.id = `station-${w.slug}`

    const prov = w.titleProvisional
      ? '<span class="prov" title="A working title assigned by this archive, not the artist\'s">[ ]</span>'
      : ''

    station.innerHTML = `
      <div class="station-inner">
        <div class="canvas-hold">
          <button class="canvas-frame" type="button"
                  aria-label="Study ${w.title}">
            <img src="${w.src}" alt="${w.title} — ${w.description.slice(0, 120)}"
                 width="${w.width ?? ''}" height="${w.height ?? ''}"
                 loading="${w.index < 2 ? 'eager' : 'lazy'}" decoding="async">
          </button>
        </div>
        <div class="plate">
          <span class="plate-no mono">PL. ${w.plate}</span>
          <h2 class="plate-title">${w.title}${prov}</h2>
          <div class="swatches">
            ${w.palette.slice(0, 7).map((hex) =>
              `<button class="swatch" style="background:${hex}" data-hex="${hex}"
                       title="${hex}" aria-label="Light the room with ${hex}"></button>`).join('')}
          </div>
          <dl class="plate-rows">
            <div class="plate-row"><dt>Format</dt><dd>${w.orientation}</dd></div>
            <div class="plate-row"><dt>Ratio</dt><dd>${w.aspect.toFixed(3)}</dd></div>
            <div class="plate-row"><dt>Pixels</dt><dd>${
              w.width ? `${fmtInt(w.width)} × ${fmtInt(w.height)}` : '—'}</dd></div>
            <div class="plate-row"><dt>Light</dt><dd>${oklchText(w.glow)}</dd></div>
            <div class="plate-row"><dt>Motifs</dt><dd>${w.motifs.join(' · ')}</dd></div>
          </dl>
          ${w.placeholder ? `<p class="stand-in-note micro">STAND-IN. THE FILE FOR THIS
             PLATE IS NOT IN THE ARCHIVE YET.</p>` : ''}
        </div>
      </div>`

    station.querySelector('.canvas-frame').addEventListener('click', () => openStudy(w.slug))
    for (const sw of $$('.swatch', station)) {
      sw.addEventListener('click', (e) => {
        e.stopPropagation()
        applyTheme(theme(sw.dataset.hex))
        status(`${sw.dataset.hex} — ${oklchText(sw.dataset.hex)}`)
      })
    }
    host.appendChild(station)
  }

  buildHueRule(works)
  sizeStations()
  requestAnimationFrame(updateLighting)
}

/**
 * Constant-area sizing.
 *
 * Capping every work at the same HEIGHT makes the 1.68 panorama roughly twice
 * the visual mass of the 0.71 stele, and the hang stops reading as one wall.
 * Giving every work the same AREA instead — width = sqrt(A*ar), height =
 * sqrt(A/ar) — makes them equal-weight objects, and the eleven aspect ratios
 * then produce a ragged silhouette against a dead-straight plumb rule, which is
 * the composition the hall is actually built on.
 */
function sizeStations() {
  const A = 0.28 * innerWidth * innerHeight
  for (const st of $$('.station')) {
    const work = state.works.find((w) => w.slug === st.dataset.slug)
    const img = $('img', st)
    if (!work || !img) continue
    const ar = work.aspect || 1
    let w = Math.sqrt(A * ar)
    let h = Math.sqrt(A / ar)
    // Clamps so a very wide or very tall work cannot run off the viewport.
    const maxH = innerHeight * 0.78
    const maxW = innerWidth * 0.62
    const k = Math.min(1, maxH / h, maxW / w)
    w *= k
    h *= k
    img.style.width = `${Math.round(w)}px`
    img.style.height = `${Math.round(h)}px`
    img.style.maxHeight = 'none'
  }
}

/**
 * Decide which work is lit, publish its theme, and hand the wall the light
 * sources. Called on scroll — everything visual in the hall follows from here.
 */
function updateLighting() {
  if (state.view !== 'hall') return
  const stations = $$('.station')
  if (!stations.length) return

  const mid = innerHeight / 2
  const lights = []
  let best = null
  let bestDist = Infinity

  for (const st of stations) {
    const frame = $('.canvas-frame', st)
    const r = frame.getBoundingClientRect()
    const centre = r.top + r.height / 2
    const dist = Math.abs(centre - mid)

    // Falls off over one viewport height: two adjacent works both contribute
    // near the boundary, which is what produces a visible seam between them.
    const intensity = Math.max(0, 1 - dist / (innerHeight * 0.78))
    const work = state.works.find((w) => w.slug === st.dataset.slug)
    if (!work) continue

    if (intensity > 0.001 && r.bottom > -200 && r.top < innerHeight + 200) {
      lights.push({
        x: r.left, y: r.top, w: r.width, h: r.height,
        color: work.theme.glow,
        intensity: intensity ** 1.35,
      })
    }
    if (dist < bestDist) { bestDist = dist; best = { st, work } }
    st.dataset.lit = intensity > 0.55 ? '1' : '0'
  }

  state.wall?.setLights(lights)

  if (best && best.work.index !== state.lit) {
    state.lit = best.work.index
    applyTheme(best.work.theme)
    markHueTick(best.work.slug)
    history.replaceState(null, '', `#/${best.work.slug}`)
  }
}

// ----------------------------------------------------------- the hue rule ---
function buildHueRule(works) {
  const rule = $('#huerule')
  rule.innerHTML = ''
  const H = rule.clientHeight || 520

  // The dead arcs are drawn first, as the visible background of the rule: the
  // gaps in the artist's colour range are information, not something to close up.
  const arc = document.createElement('div')
  arc.className = 'arc'
  arc.style.top = '0'
  arc.style.height = '100%'
  rule.appendChild(arc)

  for (const w of works) {
    const h = hueOf(w)
    const tick = document.createElement('button')
    tick.className = 'tick'
    tick.dataset.slug = w.slug
    tick.style.top = `${(h / 360) * 100}%`
    tick.style.background = w.theme.glow
    tick.title = `${w.title} — ${h.toFixed(0)}°`
    tick.setAttribute('aria-label', `Go to ${w.title}, hue ${h.toFixed(0)} degrees`)
    tick.addEventListener('click', () => gotoWork(w.slug))
    rule.appendChild(tick)
  }
}

function markHueTick(slug) {
  for (const t of $$('#huerule .tick')) t.classList.toggle('is-on', t.dataset.slug === slug)
}

function gotoWork(slug) {
  const el = $(`#station-${CSS.escape(slug)}`)
  if (!el) return
  showView('hall')
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
}

// ------------------------------------------------------------- the ledger ---
function renderLedger() {
  const works = order(state.works, state.orderKey)
  const host = $('#ledger')
  host.innerHTML = `
    <div class="ledger-wrap">
      <div class="ledger-head">
        <div>
          <h2>The index</h2>
          <p>${state.archive.titleNote ?? ''}</p>
        </div>
        <p class="mono">${state.works.length} PLATES ·
           ${state.works.filter((w) => !w.placeholder).length} WITH FILES</p>
      </div>
      <table class="ledger">
        <caption>Ordered by ${ORDERS[state.orderKey].label.toLowerCase()} — ${ORDERS[state.orderKey].hint}</caption>
        <thead><tr>
          <th scope="col">Light</th><th scope="col">Pl.</th><th scope="col"></th>
          <th scope="col">Title</th><th scope="col">Format</th>
          <th scope="col">Hue</th><th scope="col">Motifs</th>
        </tr></thead>
        <tbody>${works.map((w) => `
          <tr data-slug="${w.slug}" tabindex="0">
            <td><span class="led-dot" style="background:${w.theme.glow}"></span></td>
            <td class="mono">${w.plate}</td>
            <td><img class="led-thumb" src="${w.src}" alt="" loading="lazy" decoding="async"></td>
            <td><span class="led-title">${w.title}</span>${
              w.placeholder ? ' <span class="micro">STAND-IN</span>' : ''}</td>
            <td class="mono">${w.orientation.toUpperCase()} ${w.aspect.toFixed(2)}</td>
            <td class="mono">${hueOf(w).toFixed(0)}°</td>
            <td><div class="motif-tags">${w.motifs.map((m) =>
              `<span class="motif" title="${state.motifs[m] ?? ''}">${m}</span>`).join('')}</div></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`

  for (const tr of $$('#ledger tbody tr')) {
    const go = () => openStudy(tr.dataset.slug)
    tr.addEventListener('click', go)
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
  }
}

// -------------------------------------------------------------- the study ---
const zoom = { scale: 1, min: 1, max: 8, tx: 0, ty: 0, work: null, vx: 0, vy: 0 }

function openStudy(slug) {
  const w = state.works.find((x) => x.slug === slug)
  if (!w) return
  zoom.work = w
  applyTheme(w.theme)
  showView('study')
  history.replaceState(null, '', `#/${w.slug}/study`)

  $('#study').innerHTML = `
    <div class="study-stage" id="stage">
      <img class="study-img" id="studyimg" src="${w.src}" alt="${w.title}">
    </div>
    <div class="zoomhud mono">
      <button class="btn" id="zoomout" aria-label="Zoom out">−</button>
      <span id="zoomval">100%</span>
      <button class="btn" id="zoomin" aria-label="Zoom in">+</button>
      <button class="btn" id="fragtoggle">Fragments</button>
      <button class="btn" id="backbtn">Back to hall</button>
    </div>
    <div class="study-panel">
      <span class="plate-no mono">PL. ${w.plate}</span>
      <h2>${w.title}</h2>
      <p class="study-desc">${w.description}</p>
      <div class="swatches">${w.palette.slice(0, 7).map((hex) =>
        `<button class="swatch" style="background:${hex}" data-hex="${hex}" title="${hex}"></button>`).join('')}</div>
      <p class="micro" style="color:var(--c-ink-faint)">${oklchText(w.glow)}</p>
      <ul class="frag-list">${w.fragments.map((f, i) =>
        `<li class="frag-item" data-i="${i}">${f.note}</li>`).join('')}</ul>
      ${w.placeholder ? '<p class="stand-in-note micro">STAND-IN. NOT THE WORK.</p>' : ''}
    </div>`

  const img = $('#studyimg')
  const stage = $('#stage')
  img.addEventListener('load', () => { fitStudy(); placeHotspots() }, { once: true })
  if (img.complete) { fitStudy(); placeHotspots() }

  wireZoom(stage, img)
  $('#backbtn').addEventListener('click', () => { showView('hall'); gotoWork(w.slug) })
  $('#zoomin').addEventListener('click', () => zoomBy(1.4))
  $('#zoomout').addEventListener('click', () => zoomBy(1 / 1.4))
  $('#fragtoggle').addEventListener('click', () => {
    stage.classList.toggle('show-frag')
    for (const h of $$('.hotspot')) h.hidden = !stage.classList.contains('show-frag')
  })
  for (const sw of $$('#study .swatch')) {
    sw.addEventListener('click', () => applyTheme(theme(sw.dataset.hex)))
  }
  for (const li of $$('.frag-item')) {
    li.addEventListener('click', () => focusFragment(Number(li.dataset.i)))
  }

  // The study is one lamp at the centre of the room. Held well below full: the
  // stage is nearly the whole viewport, so at intensity 1 the pool covers the
  // page and the metadata loses its contrast against the wall it sits on.
  const r = stage.getBoundingClientRect()
  state.wall?.setLights([
    { x: r.left, y: r.top, w: r.width, h: r.height, color: w.theme.glow, intensity: 0.42 },
  ])
}

function fitStudy() {
  const stage = $('#stage')
  const img = $('#studyimg')
  if (!stage || !img) return
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  const nw = img.naturalWidth || 1000
  const nh = img.naturalHeight || 1000
  const fit = Math.min(sw / nw, sh / nh)
  zoom.min = fit
  zoom.scale = fit
  zoom.tx = (sw - nw * fit) / 2
  zoom.ty = (sh - nh * fit) / 2
  applyZoom()
}

function applyZoom() {
  const img = $('#studyimg')
  if (!img) return
  const stage = $('#stage')
  const nw = img.naturalWidth || 1000
  const nh = img.naturalHeight || 1000

  // Clamp so the picture can never be dragged out of the frame.
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  const w = nw * zoom.scale
  const h = nh * zoom.scale
  zoom.tx = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, zoom.tx))
  zoom.ty = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, zoom.ty))

  img.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`
  img.style.width = nw + 'px'
  img.style.height = nh + 'px'
  const val = $('#zoomval')
  if (val) val.textContent = `${Math.round((zoom.scale / zoom.min) * 100)}%`
  placeHotspots()
}

function zoomAt(px, py, k) {
  const next = Math.max(zoom.min, Math.min(zoom.max * zoom.min, zoom.scale * k))
  const actual = next / zoom.scale
  // Keep the point under the cursor fixed: the only zoom that feels like looking.
  zoom.tx = px - (px - zoom.tx) * actual
  zoom.ty = py - (py - zoom.ty) * actual
  zoom.scale = next
  applyZoom()
}

function zoomBy(k) {
  const stage = $('#stage')
  if (!stage) return
  zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, k)
}

function wireZoom(stage, img) {
  const pointers = new Map()
  let last = null
  let pinchDist = 0

  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = stage.getBoundingClientRect()
    // A trackpad pinch arrives as a wheel event with ctrlKey set; it needs a
    // gentler factor than a mouse wheel notch or it overshoots wildly.
    const k = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : Math.exp(-e.deltaY * 0.0016)
    zoomAt(e.clientX - r.left, e.clientY - r.top, k)
  }, { passive: false })

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, e)
    stage.classList.add('is-drag')
    last = { x: e.clientX, y: e.clientY }
  })

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, e)

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      if (pinchDist) {
        const r = stage.getBoundingClientRect()
        zoomAt((a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top, d / pinchDist)
      }
      pinchDist = d
      return
    }
    if (!last) return
    zoom.tx += e.clientX - last.x
    zoom.ty += e.clientY - last.y
    zoom.vx = e.clientX - last.x
    zoom.vy = e.clientY - last.y
    last = { x: e.clientX, y: e.clientY }
    applyZoom()
  })

  const end = (e) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchDist = 0
    if (!pointers.size) {
      stage.classList.remove('is-drag')
      last = null
      glide()
    }
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)

  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect()
    zoomAt(e.clientX - r.left, e.clientY - r.top, zoom.scale > zoom.min * 1.6 ? zoom.min / zoom.scale : 2.6)
  })
}

/** Momentum after a drag. Weighted, and it stops — nothing here drifts forever. */
function glide() {
  if (reduced) { zoom.vx = zoom.vy = 0; return }
  let vx = zoom.vx
  let vy = zoom.vy
  const step = () => {
    vx *= 0.92
    vy *= 0.92
    if (Math.abs(vx) < 0.2 && Math.abs(vy) < 0.2) return
    zoom.tx += vx
    zoom.ty += vy
    applyZoom()
    requestAnimationFrame(step)
  }
  step()
}

function placeHotspots() {
  const stage = $('#stage')
  const img = $('#studyimg')
  if (!stage || !img || !zoom.work) return
  for (const h of $$('.hotspot', stage)) h.remove()
  const nw = img.naturalWidth || 1000
  const nh = img.naturalHeight || 1000
  zoom.work.fragments.forEach((f, i) => {
    const el = document.createElement('button')
    el.className = 'hotspot'
    el.dataset.i = String(i)
    el.hidden = !stage.classList.contains('show-frag')
    el.style.left = `${zoom.tx + f.x * nw * zoom.scale}px`
    el.style.top = `${zoom.ty + f.y * nh * zoom.scale}px`
    el.title = f.note
    el.setAttribute('aria-label', f.note)
    el.addEventListener('click', () => focusFragment(i))
    stage.appendChild(el)
  })
}

function focusFragment(i) {
  const f = zoom.work?.fragments[i]
  if (!f) return
  const stage = $('#stage')
  const img = $('#studyimg')
  stage.classList.add('show-frag')
  const nw = img.naturalWidth || 1000
  const nh = img.naturalHeight || 1000
  zoom.scale = Math.min(zoom.min * 3.2, zoom.max * zoom.min)
  zoom.tx = stage.clientWidth / 2 - f.x * nw * zoom.scale
  zoom.ty = stage.clientHeight / 2 - f.y * nh * zoom.scale
  applyZoom()
  for (const li of $$('.frag-item')) li.classList.toggle('is-on', Number(li.dataset.i) === i)
  status(f.note, 5200)
}

// ----------------------------------------------------------- the collation --
function showCollation(on) {
  if (state.collating === on) return
  state.collating = on
  const el = $('#collation')
  el.hidden = !on
  el.setAttribute('aria-hidden', String(!on))
  if (!on) return

  // True relative scale: every plate at the same height means the panorama
  // really is six times the width of the tall portrait, which is the point.
  const works = order(state.works, state.orderKey)
  el.innerHTML = `
    <div class="collation-rows">
      ${works.map((w) => `
        <div class="collation-plate">
          <sup>${w.plate}</sup>
          <img src="${w.src}" alt="${w.title}" style="aspect-ratio:${w.aspect}">
        </div>`).join('')}
    </div>
    <p class="collation-cap micro">ELEVEN PLATES AT TRUE RELATIVE SCALE — HOLD C</p>`
}

// --------------------------------------------------------------- plumbing ---
function showView(name) {
  state.view = name
  for (const v of $$('.view')) {
    const on = v.id === name
    v.classList.toggle('is-on', on)
    v.hidden = !on
  }
  for (const b of $$('.viewbtn')) b.classList.toggle('is-on', b.dataset.view === name)
  if (name === 'ledger') renderLedger()
  if (name === 'hall') requestAnimationFrame(updateLighting)
  document.body.dataset.view = name
}

function buildOrderButtons() {
  const host = $('#orders')
  host.innerHTML = ''
  for (const [key, o] of Object.entries(ORDERS)) {
    const b = document.createElement('button')
    b.className = 'orderbtn' + (key === state.orderKey ? ' is-on' : '')
    b.type = 'button'
    b.textContent = o.label
    b.title = o.hint
    b.addEventListener('click', () => {
      state.orderKey = key
      buildOrderButtons()
      renderHall()
      if (state.view === 'ledger') renderLedger()
      status(`Ordered by ${o.label.toLowerCase()} — ${o.hint}`)
    })
    host.appendChild(b)
  }
}

function wireKeys() {
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return
    const works = order(state.works, state.orderKey)
    const at = works.findIndex((w) => w.index === state.lit)

    if (e.key === 'c' || e.key === 'C') { if (!e.repeat) showCollation(true); return }
    if (e.key === 'Escape') {
      if (!$('#import').hidden) return $('#import').dispatchEvent(new CustomEvent('close'))
      if (state.view !== 'hall') showView('hall')
      return
    }
    if (e.key === 'i' || e.key === 'I') return showView(state.view === 'ledger' ? 'hall' : 'ledger')
    if (e.key === 'Enter' && state.view === 'hall') {
      return openStudy(state.works[state.lit].slug)
    }
    if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
      e.preventDefault()
      return gotoWork(works[Math.min(works.length - 1, at + 1)].slug)
    }
    if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
      e.preventDefault()
      return gotoWork(works[Math.max(0, at - 1)].slug)
    }
    if (state.view === 'study') {
      if (e.key === '+' || e.key === '=') zoomBy(1.4)
      if (e.key === '-') zoomBy(1 / 1.4)
      if (e.key === '0') fitStudy()
    }
  })
  addEventListener('keyup', (e) => {
    if (e.key === 'c' || e.key === 'C') showCollation(false)
  })
  // Holding a key while the window loses focus would otherwise leave the
  // collation stuck open forever.
  addEventListener('blur', () => showCollation(false))
}

// ------------------------------------------------------------------- boot ---
async function boot() {
  registerThemeProperties()

  let data
  try {
    data = await load()
  } catch (err) {
    document.body.innerHTML = `<div class="noscript"><h1>LODHANG</h1>
      <p>The catalogue could not be loaded: ${err.message}</p>
      <p>Serve this folder over http rather than opening the file directly —
      <code>python tools/serve.py</code>.</p></div>`
    return
  }

  Object.assign(state, data)
  applyTheme(state.works[0].theme)

  state.wall = new Wall($('#wall'), { reducedMotion: reduced })

  $('#attrib').textContent =
    `${state.archive.subtitle} by ${state.archive.artist}. ${state.archive.source}`

  buildOrderButtons()
  renderHall()
  wireKeys()
  mountImport({
    root: $('#import'),
    button: $('#importbtn'),
    works: state.works,
    onSaved: async () => { const fresh = await load(); Object.assign(state, fresh); renderHall(); status('Imported.') },
    dbPut,
    dbClear,
    status,
  })

  for (const b of $$('.viewbtn')) b.addEventListener('click', () => showView(b.dataset.view))
  $('#brand').addEventListener('click', () => showView('hall'))

  let ticking = false
  addEventListener('scroll', () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => { updateLighting(); ticking = false })
  }, { passive: true })
  addEventListener('resize', () => {
    sizeStations()
    updateLighting()
    if (state.view === 'study') fitStudy()
  })

  // Deep link: #/slug or #/slug/study
  const m = location.hash.match(/^#\/([a-z0-9-]+)(\/study)?$/)
  if (m) {
    const w = state.works.find((x) => x.slug === m[1])
    if (w) m[2] ? openStudy(w.slug) : gotoWork(w.slug)
  }

  // Diagnostics for the screenshot harness.
  window.__diag = {
    get view() { return state.view },
    get works() { return state.works.length },
    get focus() { return state.works[state.lit]?.slug },
    get resolved() { return state.works.filter((w) => !w.placeholder).length },
    webgl: false,
  }
  window.__ready = true
}

boot()
