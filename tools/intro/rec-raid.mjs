// 錄魔王團戰（本機版）：選魔王 → 等待室 → 開打 → 神話半血變身 → 結算
import { launch, register } from './common.mjs'
const [OUT = '/tmp/claude-0/intro/vid', BOSS = 'golem'] = process.argv.slice(2)
const { b, ctx } = await launch({ recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('ERR', e.message))
await register(page, { nick: '小勇者', job: 1, cleared: 85 })
await page.getByRole('button', { name: '魔王團戰' }).click()
await page.waitForSelector('.bossgrid')
await page.waitForTimeout(1500)
await page.mouse.wheel(0, 500); await page.waitForTimeout(1200)
await page.locator('.bosspick', { has: page.locator(`img[src$="/${BOSS}/face.png"]`) }).scrollIntoViewIfNeeded()
await page.waitForTimeout(600)
await page.locator('.bosspick', { has: page.locator(`img[src$="/${BOSS}/face.png"]`) }).click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: /開一場打/ }).click()
await page.waitForSelector('.bosscard')
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /大家一起開打/ }).click()
await page.waitForSelector('.td-cv', { timeout: 15000 })
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  while (!window.__raid) await sleep(100)
  const r = window.__raid
  const cv = document.querySelector('.td-cv')
  const ripple = (x, y) => {
    const q = cv.getBoundingClientRect()
    const d = document.createElement('div')
    d.style.cssText = `position:fixed;left:${q.left + x * q.width / cv.width - 22}px;top:${q.top + y * q.height / cv.height - 22}px;width:44px;height:44px;border-radius:50%;border:4px solid #fff;box-shadow:0 0 12px #ffe27a;pointer-events:none;z-index:9999;transition:all .45s ease-out`
    document.body.appendChild(d)
    requestAnimationFrame(() => { d.style.transform = 'scale(1.8)'; d.style.opacity = '0' })
    setTimeout(() => d.remove(), 600)
  }
  const t0 = Date.now()
  while (Date.now() - t0 < 300000) {
    const tr = r.truth()
    if (tr.over) break
    const tg = r.target()
    if (tg) {
      const t = r.S.targets.get(tg)
      if (t) ripple(t.px ?? t.x, (t.y ?? 0) + 12)
      r.tapId(tg)
    }
    await sleep(900)
  }
})
await page.waitForSelector('.result', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(3000)
await page.close(); console.log('VIDEO', await page.video().path())
await ctx.close(); await b.close()
