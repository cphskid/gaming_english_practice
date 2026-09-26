// 真的開瀏覽器（手機橫拿 844×390，守塔要橫拿）進守塔，逐格記下每塊字牌跟怪物本體的相對位置。
// 模擬器看不出來的東西（開場出怪、真正的字寬、真正的每格節奏）要用這支看。只打 dev server（要 window.__td）。
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173'
const LEVEL = Number(process.argv[3] || 8)
const OUT = process.argv[4] || '/tmp/plate-probe'
mkdirSync(OUT, { recursive: true })
const CLASS = 'TEST1'

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await page.addInitScript((code) => {
  const ids = Array.from({ length: 85 }, (_, i) => `td-${String(i + 1).padStart(2, '0')}`)
  try {
    localStorage.setItem(`gep.v1.teacherOpen.${code}`, JSON.stringify(ids))
    localStorage.setItem('gep.v1.classes', JSON.stringify([{ code, name: '測試班', open: true }]))
  } catch {}
}, CLASS)
await page.goto(BASE)
const BOT = 'bot' + Math.random().toString(36).slice(2, 8)
await page.locator('.start-btn').click({ force: true }); await page.click('.tabs button:nth-child(2)')
await page.fill('#cls', CLASS); await page.fill('#lid', BOT); await page.fill('#pw', 'robot42'); await page.fill('#nick', '機器人')
await page.click('button[type=submit]')
await page.waitForSelector('.jobs .job, .levels', { timeout: 20000 })
if (await page.locator('.jobs .job').count()) {
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
}
await page.waitForSelector('.levels', { timeout: 20000 })
const chIdx = LEVEL <= 14 ? 0 : LEVEL <= 52 ? 1 : 2
const head = page.locator('.chhead').nth(chIdx)
if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
await page.locator('.lv', { hasText: `第 ${LEVEL} 關` }).first().click()
await page.waitForSelector('.td-cv')
await page.waitForTimeout(4000)

await page.evaluate(() => {
  const td = window.__td
  td.S.hp = 1e9
  td.tapSlot(0)
  window.__trace = []
  td.startWave()
  const tick = () => {
    const t = performance.now()
    for (const e of td.S.enemies) if (e.entered) window.__trace.push([t, e.id ?? td.S.enemies.indexOf(e), e.word.word, e.x, e.y, e.px, e.tier, e.dist, e.ty ?? e.tier * 32])
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, '0')}.png` })
}
const trace = await page.evaluate(() => window.__trace)
writeFileSync(`${OUT}/trace.json`, JSON.stringify(trace))
console.log('frames', trace.length)
await browser.close()
