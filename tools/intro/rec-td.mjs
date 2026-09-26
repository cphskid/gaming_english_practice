// 錄一段守塔：蓋塔、開波、照人的速度點對的怪（點的地方畫一圈漣漪）
import { launch, register } from './common.mjs'
const [LEVEL = '20', OUT = '/tmp/claude-0/intro/vid', SECS = '45'] = process.argv.slice(2)
const { b, ctx } = await launch({ recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
const t0 = Date.now()
page.on('pageerror', (e) => console.log('ERR', e.message))
await register(page, { cleared: 84 })
const L = Number(LEVEL)
const chIdx = L <= 14 ? 0 : L <= 52 ? 1 : 2
const head = page.locator('.chhead').nth(chIdx)
if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
await page.locator('.lv', { hasText: `第 ${L} 關` }).first().click()
await page.waitForSelector('.td-cv')
await page.waitForTimeout(600)
console.log('MARK start', Date.now() - t0)
await page.evaluate(async (secs) => {
  const td = window.__td, S = td.S
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const cv = document.querySelector('.td-cv')
  const ripple = (x, y) => {
    const r = cv.getBoundingClientRect()
    const d = document.createElement('div')
    d.style.cssText = `position:fixed;left:${r.left + x * r.width / cv.width - 22}px;top:${r.top + y * r.height / cv.height - 22}px;width:44px;height:44px;border-radius:50%;border:4px solid #fff;box-shadow:0 0 12px #ffe27a;pointer-events:none;z-index:9999;transition:all .45s ease-out;opacity:1`
    document.body.appendChild(d)
    requestAnimationFrame(() => { d.style.transform = 'scale(1.8)'; d.style.opacity = '0' })
    setTimeout(() => d.remove(), 600)
  }
  const slotTap = async (i) => { const s = td.SLOTS[i]; if (s) ripple(s.x, s.y); td.tapSlot(i); await sleep(350) }
  S.crystals = Math.max(S.crystals, 240)  // 介紹片：一開場多蓋幾座，畫面才熱鬧
  for (let i = 0; i < td.SLOTS.length && S.crystals >= 40; i++) await slotTap(i)
  await sleep(500)
  td.startWave()
  const end = Date.now() + secs * 1000
  let lastTap = 0
  while (S.phase !== 'done' && Date.now() < end) {
    if (S.phase === 'build') {
      for (let i = 0; i < td.SLOTS.length && S.crystals >= 40; i++)
        if (!S.towers.some((t) => t.slot === i)) await slotTap(i)
      await sleep(600); td.startWave(); continue
    }
    const inRange = (e) => S.towers.some((t) => { const s = td.SLOTS[t.slot]; return Math.hypot(s.x - e.x, s.y - e.y) < 160 })
    if (S.target && S.target.entered && inRange(S.target) && Date.now() - lastTap > 1300) {
      ripple(S.target.x, S.target.y); td.tapEnemy(S.target); lastTap = Date.now()
    }
    await sleep(80)
  }
}, Number(SECS))
console.log('MARK end', Date.now() - t0)
await page.waitForTimeout(1500)
await page.close(); console.log('VIDEO', await page.video().path())
await ctx.close(); await b.close()
