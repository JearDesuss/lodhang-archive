/** Ad-hoc DOM probe: node tools/probe.mjs "<js expression returning an object>" */
import { createRequire } from 'node:module'
import { globSync } from 'node:fs'
const require = createRequire(import.meta.url)
const pw = require(globSync('C:/Users/akbar/AppData/Local/npm-cache/_npx/*/node_modules/playwright/index.js')[0])
const exe = globSync('C:/Users/akbar/AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe').pop()

const expr = process.argv[2]
const url = process.argv[3] ?? 'http://127.0.0.1:8788/'
const browser = await pw.chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const msgs = []
page.on('console', (m) => msgs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message))
page.on('requestfailed', (r) => msgs.push(`failed: ${r.url()}`))
page.on('response', (r) => { if (r.status() >= 400) msgs.push(`${r.status()}: ${r.url()}`) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__ready === true, { timeout: 10000 }).catch(() => {})
await page.waitForTimeout(800)
const out = await page.evaluate(expr)
console.log(JSON.stringify({ out, msgs }, null, 2))
await browser.close()
