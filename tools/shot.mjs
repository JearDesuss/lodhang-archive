/**
 * Screenshot harness. Playwright lives in the npx cache on this machine and the
 * bundled headless-shell build is missing, so it has to be imported by absolute
 * path as a CJS default and pointed at the installed chromium.
 *
 *   node tools/shot.mjs --out shots/hall.png
 *   node tools/shot.mjs --out shots/detail.png --w 1600 --h 1000 \
 *        --do "click .work[data-slug=crown-unworn]; wait 900"
 *   node tools/shot.mjs --out shots/reduced.png --reduced-motion
 *   node tools/shot.mjs --out shots/nogl.png --no-webgl
 *
 * Assumes a static server is already running (tools/serve.py).
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { globSync } from 'node:fs'

const require = createRequire(import.meta.url)

function findPlaywright() {
  const roots = globSync(
    'C:/Users/akbar/AppData/Local/npm-cache/_npx/*/node_modules/playwright/index.js'
  )
  if (!roots.length) throw new Error('playwright not found in the npx cache')
  return roots[0]
}
function findChromium() {
  const exes = globSync(
    'C:/Users/akbar/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe'
  )
  if (!exes.length) throw new Error('chromium not found under ms-playwright')
  return exes[exes.length - 1]
}

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf('--' + name)
  return i === -1 ? fallback : args[i + 1]
}
const has = (name) => args.includes('--' + name)

const url = flag('url', 'http://127.0.0.1:8788/')
const out = resolve(flag('out', 'shots/shot.png'))
const width = Number(flag('w', 1600))
const height = Number(flag('h', 1000))
const settle = Number(flag('settle', 1400))
const script = flag('do', '')
const full = has('full')

const pw = require(findPlaywright())

const run = async () => {
  mkdirSync(dirname(out), { recursive: true })
  const browser = await pw.chromium.launch({
    executablePath: findChromium(),
    args: has('no-webgl') ? ['--disable-webgl', '--disable-webgl2'] : [],
  })
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: Number(flag('dpr', 2)),
    reducedMotion: has('reduced-motion') ? 'reduce' : 'no-preference',
    colorScheme: 'dark',
  })
  const page = await context.newPage()

  const problems = []
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text())
  })
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) =>
    problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`)
  )

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

  // The app sets this once the catalog is loaded and the first paint is done.
  await page
    .waitForFunction(() => window.__ready === true, { timeout: 15000 })
    .catch(() => problems.push('timeout: window.__ready never became true'))

  // Mini action language, so a shot can capture a state rather than the entry screen.
  for (const step of script.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [verb, ...rest] = step.split(/\s+/)
    const arg = rest.join(' ')
    try {
      if (verb === 'click') await page.click(arg, { timeout: 5000 })
      else if (verb === 'hover') await page.hover(arg, { timeout: 5000 })
      else if (verb === 'key') await page.keyboard.press(arg)
      // 'down' without a matching 'up' is how a hold-to-reveal overlay gets
      // photographed; keyboard.press releases immediately and closes it again.
      else if (verb === 'down') await page.keyboard.down(arg)
      else if (verb === 'up') await page.keyboard.up(arg)
      else if (verb === 'wait') await page.waitForTimeout(Number(arg))
      else if (verb === 'wheel') await page.mouse.wheel(0, Number(arg))
      else if (verb === 'eval') await page.evaluate(arg)
      else problems.push('unknown step verb: ' + verb)
    } catch (e) {
      problems.push(`step "${step}" failed: ${e.message}`)
    }
  }

  await page.waitForTimeout(settle)
  await page.screenshot({ path: out, fullPage: full })

  const probe = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    webgl: window.__diag?.webgl ?? null,
    view: window.__diag?.view ?? null,
    works: window.__diag?.works ?? null,
    focus: window.__diag?.focus ?? null,
  }))

  console.log(JSON.stringify({ out, probe, problems }, null, 2))
  if (probe.scrollW > probe.clientW) {
    console.log(`!! horizontal overflow: ${probe.scrollW} > ${probe.clientW}`)
  }
  await browser.close()
  if (problems.length) process.exitCode = 1
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
