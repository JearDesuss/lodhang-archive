/** Generic page capture, for looking at reference sites.
 *  node tools/capture.mjs <url> <out.png> [--w 1600] [--h 1000] [--wait 6000] [--dump]
 */
import { createRequire } from 'node:module'
import { globSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const pw = require(globSync('C:/Users/akbar/AppData/Local/npm-cache/_npx/*/node_modules/playwright/index.js')[0])
const exe = globSync('C:/Users/akbar/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe').pop()

const [url, out = 'shots/ref.png'] = process.argv.slice(2)
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : process.argv[i + 1] }
const wait = Number(arg('wait', 6000))

const browser = await pw.chromium.launch({ executablePath: exe })
const page = await browser.newPage({
  viewport: { width: Number(arg('w', 1600)), height: Number(arg('h', 1000)) },
  deviceScaleFactor: 2,
})
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push(e.message))
await page.waitForTimeout(wait)
mkdirSync(dirname(resolve(out)), { recursive: true })
await page.screenshot({ path: resolve(out) })

const info = await page.evaluate(() => {
  const text = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 60)
  return {
    title: document.title,
    canvases: [...document.querySelectorAll('canvas')].map((c) => ({
      w: c.width, h: c.height,
      ctx: ['webgl2', 'webgl', '2d'].find((t) => { try { return c.getContext(t) } catch { return false } }) ?? '?',
    })),
    scripts: [...document.querySelectorAll('script[src]')].map((s) => s.src).slice(0, 30),
    globals: ['THREE', 'p5', 'PIXI', 'BABYLON', 'regl', 'gsap', 'lil', 'dat']
      .filter((g) => g in window),
    headings: text('h1,h2,h3'),
    buttons: text('button,[role=button],a'),
    labels: text('label,.label,legend'),
    inputs: [...document.querySelectorAll('input,select')].map((i) => ({
      type: i.type, name: i.name || i.id, min: i.min, max: i.max, value: i.value,
    })),
    bodyText: document.body.innerText.slice(0, 2500),
    bg: getComputedStyle(document.body).backgroundColor,
    fonts: [...new Set([...document.querySelectorAll('body *')].slice(0, 400)
      .map((e) => getComputedStyle(e).fontFamily))].slice(0, 8),
  }
})
writeFileSync(resolve(out).replace(/\.png$/, '.json'), JSON.stringify({ info, errors }, null, 2))
console.log(JSON.stringify({ info, errors }, null, 2).slice(0, 4000))
await browser.close()
