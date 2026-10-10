// 量進關卡要等多久才看得到地圖（模擬學校網路：10Mbps、延遲 60ms、沒快取）
import { chromium } from 'playwright'
const BASE = process.argv[2]; const NEWUI = process.argv[3] === 'new'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 2e6 / 8, uploadThroughput: 4e6 / 8 })
const all = []
page.on('requestfinished', async (r) => { const z = await r.sizes().catch(() => null); all.push({ url: r.url(), t: Date.now(), size: z ? z.responseBodySize : 0 }) })
const tStart = Date.now()
const id = 'ld' + Math.random().toString(36).slice(2, 8)
await page.goto(BASE)
await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123'); await page.fill('#nick', '載圖' + id.slice(-3))
await page.locator('form button[type=submit]').click()
await page.waitForSelector('.jobs .job', { timeout: 60000 })
await page.locator('.jobs .job').first().click(); await page.locator('.avatars .av').first().click(); await page.locator('button.btn.big').click()
await page.waitForSelector('.levels', { timeout: 60000 })
await page.waitForTimeout(Number(process.env.IDLE || 500))
const reqs = []
page.on('requestfinished', async (r) => { const s = await r.sizes().catch(() => null); reqs.push({ url: r.url(), t: Date.now(), size: s ? s.responseBodySize : 0 }) })
const t0 = Date.now()
await page.locator('.lv').first().click()
if (NEWUI) await page.locator('.lvgo').click()
await page.waitForSelector('.td-cv', { timeout: 60000 })
const tCv = Date.now() - t0
let tMap = null
for (let i = 0; i < 600; i++) {
  const ok = await page.evaluate(() => {
    const ims = [...document.images]; return !!window.__tdMapReady
  }).catch(() => false)
  if (ok) { tMap = Date.now() - t0; break }
  // 沒有旗標就看地圖那張圖有沒有抓完
  if (reqs.some((r) => /maps\/islandTwin|p-ground/.test(r.url))) { tMap = Date.now() - t0; break }
  await page.waitForTimeout(100)
}
await page.waitForTimeout(15000)
const img = reqs.filter((r) => /\.(webp|png|jpg)/.test(r.url))
const before = img.filter((r) => r.t - t0 <= tMap)
console.log(JSON.stringify({ tCanvas: tCv, tMap, imgsBeforeMap: before.length, kbBeforeMap: Math.round(before.reduce((n, r) => n + r.size, 0) / 1024), imgsTotal15s: img.length, kbTotal15s: Math.round(img.reduce((n, r) => n + r.size, 0) / 1024) }))
console.log(before.slice(0, 200).map((r) => (r.t - t0) + 'ms ' + Math.round(r.size / 1024) + 'KB ' + r.url.replace(/.*dev\//, '')).join('\n'))
const im = all.filter((r) => /\.(webp|png|jpg)/.test(r.url)); console.log('since app start: imgs', im.length, 'KB', Math.round(im.reduce((n, r) => n + r.size, 0) / 1024), 'last img at', Math.max(...im.map((r) => r.t)) - tStart, 'ms; level clicked at', t0 - tStart)
const big = [...im].sort((a, b) => b.size - a.size).slice(0, 15).map((r) => Math.round(r.size / 1024) + 'KB ' + r.url.replace(/.*4181\//, '')); console.log(big.join('\n'))
await b.close()
