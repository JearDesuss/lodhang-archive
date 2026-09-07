/**
 * The wall.
 *
 * A fixed, full-viewport canvas behind everything. It renders a procedurally
 * generated plaster surface that is *invisible in the dark* and only becomes
 * visible where a painting throws light on it. That is the whole premise of the
 * site, so it is rendered rather than faked with box-shadow.
 *
 * How it works, and why this way:
 *
 *  1. The plaster is generated ONCE into an offscreen canvas as a grey height
 *     field — value noise at four octaves, plus directional trowel streaks.
 *     Regenerating per frame would be pointless and slow; plaster does not move.
 *
 *  2. Each frame the main canvas is cleared to Void, then every light draws an
 *     additive radial gradient in its own colour. Additive is not a stylistic
 *     choice: real light adds, which is what makes two overlapping pools mix
 *     into a third colour at the seam without any special-casing.
 *
 *  3. The plaster is then composited over the light with 'multiply', so its
 *     tooth darkens the lit areas and does nothing at all to the unlit ones.
 *     Multiply against black is black — the texture cannot show where there is
 *     no light, which is exactly the effect wanted and costs nothing to enforce.
 *
 * Lights are elongated vertically and biased upward because a canvas hung on a
 * wall spills more light above it than below, where its own bottom edge is dark.
 */

const PLASTER_SCALE = 0.5 // the texture is soft; half resolution is free quality

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Value noise with bilinear interpolation — smooth, cheap, and deterministic. */
function valueNoise(w, h, cells, rand) {
  const gw = Math.max(2, Math.ceil(w / cells) + 2)
  const gh = Math.max(2, Math.ceil(h / cells) + 2)
  const grid = new Float32Array(gw * gh)
  for (let i = 0; i < grid.length; i++) grid[i] = rand()
  const out = new Float32Array(w * h)
  const smooth = (t) => t * t * (3 - 2 * t)
  for (let y = 0; y < h; y++) {
    const gy = y / cells
    const y0 = Math.floor(gy)
    const fy = smooth(gy - y0)
    for (let x = 0; x < w; x++) {
      const gx = x / cells
      const x0 = Math.floor(gx)
      const fx = smooth(gx - x0)
      const a = grid[y0 * gw + x0]
      const b = grid[y0 * gw + x0 + 1]
      const c = grid[(y0 + 1) * gw + x0]
      const d = grid[(y0 + 1) * gw + x0 + 1]
      out[y * w + x] = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy
    }
  }
  return out
}

function buildPlaster(w, h, seed = 7) {
  const rand = mulberry32(seed)
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.floor(w))
  cv.height = Math.max(1, Math.floor(h))
  const ctx = cv.getContext('2d', { willReadFrequently: false })
  const img = ctx.createImageData(cv.width, cv.height)
  const W = cv.width
  const H = cv.height

  // Four octaves of value noise: the broad undulation of a hand-floated wall,
  // down to the fine tooth that only shows under raking light.
  const o1 = valueNoise(W, H, 180, rand)
  const o2 = valueNoise(W, H, 64, rand)
  const o3 = valueNoise(W, H, 22, rand)
  const o4 = valueNoise(W, H, 7, rand)

  const d = img.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      let v = o1[i] * 0.46 + o2[i] * 0.28 + o3[i] * 0.17 + o4[i] * 0.09

      // Trowel streaks: long, shallow, roughly horizontal arcs, the mark of a
      // blade drawn across wet plaster. Without these it reads as noise, not
      // as a surface somebody made.
      const streak = Math.sin((y * 0.055) + Math.sin(x * 0.004) * 3.1 + o1[i] * 5.0)
      v += streak * 0.045

      // A few deep scars.
      const scar = Math.sin(x * 0.011 + y * 0.004) * Math.cos(y * 0.009 - x * 0.002)
      v += scar * 0.028

      // Contrast first, then lift into 0.58..1.0. The lift matters: this layer
      // is composited with 'multiply', so a plaster centred on mid-grey would
      // halve every light pool and the room would go dark. Lifted, it modulates
      // the light — the tooth shows, the brightness survives.
      const c = Math.max(0, Math.min(1, 0.5 + (v - 0.5) * 2.4))
      const g = 0.42 + c * 0.58
      // Slightly warm: cold grey plaster reads as concrete, not lime.
      const p = i * 4
      d[p] = Math.round(g * 255)
      d[p + 1] = Math.round(g * 252)
      d[p + 2] = Math.round(g * 244)
      d[p + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

export class Wall {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{reducedMotion?: boolean}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.lights = []
    this.plaster = null
    this.w = 0
    this.h = 0
    this.dpr = 1
    this.reduced = !!opts.reducedMotion
    this.dirty = true
    this.raf = 0
    this.enabled = !!this.ctx

    this._onResize = this._onResize.bind(this)
    this._tick = this._tick.bind(this)
    if (this.enabled) {
      this._onResize()
      addEventListener('resize', this._onResize, { passive: true })
      this.raf = requestAnimationFrame(this._tick)
    }
  }

  _onResize() {
    // The light field is soft, so it never needs full device resolution. Capping
    // at 1.5 keeps a 4K display from quadrupling the fill cost for no visible gain.
    this.dpr = Math.min(1.5, devicePixelRatio || 1)
    const w = innerWidth
    const h = innerHeight
    this.w = w
    this.h = h
    this.canvas.width = Math.floor(w * this.dpr)
    this.canvas.height = Math.floor(h * this.dpr)
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
    this.plaster = buildPlaster(w * PLASTER_SCALE, h * PLASTER_SCALE)
    this.dirty = true
  }

  /**
   * @param {{x:number,y:number,w:number,h:number,color:string,intensity:number}[]} lights
   * Positions are CSS pixels in viewport space — the rect of the work throwing
   * the light. Intensity 0..1 is how lit that work currently is.
   */
  setLights(lights) {
    this.lights = lights
    this.dirty = true
  }

  _tick() {
    this.raf = requestAnimationFrame(this._tick)
    if (!this.dirty) return
    this.dirty = false
    this._render()
  }

  _render() {
    const { ctx, w, h, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = '#08080A'
    ctx.fillRect(0, 0, w, h)

    if (!this.lights.length) return

    // 1. The light itself, additive so overlapping pools mix into a third colour.
    ctx.globalCompositeOperation = 'lighter'
    for (const L of this.lights) {
      const a = Math.max(0, Math.min(1, L.intensity))
      if (a <= 0.001) continue

      const cx = L.x + L.w / 2
      // Bias the source upward: a hung canvas spills more light above it than
      // below, where its own bottom edge is usually the darkest part.
      const cy = L.y + L.h * 0.42
      const radius = Math.max(L.w, L.h) * 1.5

      // Elongated vertically, wider at the top. Drawn as a scaled circle so the
      // gradient stays a real radial falloff rather than a stretched ellipse
      // with a visibly flat core.
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1, 1.22)
      const g = ctx.createRadialGradient(0, 0, radius * 0.06, 0, 0, radius)
      g.addColorStop(0, this._rgba(L.color, 0.82 * a))
      g.addColorStop(0.22, this._rgba(L.color, 0.44 * a))
      g.addColorStop(0.48, this._rgba(L.color, 0.17 * a))
      g.addColorStop(0.74, this._rgba(L.color, 0.05 * a))
      g.addColorStop(1, this._rgba(L.color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 2. The plaster, multiplied in. Against the unlit Void this is a no-op,
    //    so the texture can only ever appear inside a light pool.
    if (this.plaster) {
      ctx.globalCompositeOperation = 'multiply'
      ctx.globalAlpha = 1
      ctx.drawImage(this.plaster, 0, 0, w, h)
    }

    // 3. A soft floor gradient, so the room has a bottom.
    ctx.globalCompositeOperation = 'multiply'
    const floor = ctx.createLinearGradient(0, h * 0.72, 0, h)
    floor.addColorStop(0, 'rgba(255,255,255,1)')
    floor.addColorStop(1, 'rgba(90,90,96,1)')
    ctx.fillStyle = floor
    ctx.fillRect(0, h * 0.72, w, h * 0.28)
    ctx.globalCompositeOperation = 'source-over'
  }

  _rgba(hex, a) {
    const h = hex.replace('#', '')
    const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const n = parseInt(s, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    removeEventListener('resize', this._onResize)
  }
}
