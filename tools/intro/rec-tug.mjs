// 錄一段兵推（打電腦）：認字 → 聽音 → 拼字，各打一陣子，中間買一次升階
import { launch, register } from './common.mjs'
const [OUT = '/tmp/claude-0/intro/vid'] = process.argv.slice(2)
const { b, ctx } = await launch({ recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
const t0 = Date.now()
page.on('pageerror', (e) => console.log('ERR', e.message))
page.on('console', (m) => { if (m.text().startsWith('MARK')) console.log(m.text().replace('@', ''), Date.now() - t0) })
await register(page, { nick: '小勇者', job: 0, cleared: 14 })
await page.getByRole('button', { name: '對戰' }).click()
await page.waitForSelector('.vs-foe', { timeout: 15000 })
await page.waitForTimeout(1200)
console.log('MARK menu', Date.now() - t0)
await page.locator('.vs-foe').nth(1).click()
await page.waitForSelector('.td-cv', { timeout: 20000 })
await page.locator('.rotate').click().catch(() => {})
await page.waitForTimeout(600)
console.log('MARK battle', Date.now() - t0)
await page.evaluate(async () => {
  const g = window.__tug
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const cv = document.querySelector('.td-cv')
  const ripple = (x, y) => {
    const r = cv.getBoundingClientRect()
    const d = document.createElement('div')
    d.style.cssText = `position:fixed;left:${r.left + x * r.width / cv.width - 22}px;top:${r.top + y * r.height / cv.height - 22}px;width:44px;height:44px;border-radius:50%;border:4px solid #fff;box-shadow:0 0 12px #ffe27a;pointer-events:none;z-index:9999;transition:all .45s ease-out`
    document.body.appendChild(d)
    requestAnimationFrame(() => { d.style.transform = 'scale(1.8)'; d.style.opacity = '0' })
    setTimeout(() => d.remove(), 600)
  }
  const S = g.S
  const tapBoard = () => {
    const t = S.targets.get(S.target)
    if (t) ripple(t.px ?? t.x, (t.y ?? 0) + 12)
    g.tapId(S.target)
  }
  const spellOne = async () => {
    const need = () => S.spell.word.word.toLowerCase()
    for (let guard = 0; guard < 20 && S.spell.word && S.spell.filled < need().length; guard++) {
      const k = S.spell.bank.findIndex((t) => !t.used && t.ch === need()[S.spell.filled])
      if (k < 0) break
      const n = S.spell.bank.length, W = cv.width
      const x = (W - (n * g.SPELL.bankW + (n - 1) * g.SPELL.bankGap)) / 2 + k * (g.SPELL.bankW + g.SPELL.bankGap) + g.SPELL.bankW / 2
      ripple(x, g.SPELL.bankY + g.SPELL.bankH / 2)
      g.tapLetter(k)
      await sleep(380)
    }
    await sleep(700)
  }
  const plan = [['recognize', 14], ['listen', 10], ['spell', 16]]
  for (const [line, secs] of plan) {
    g.setLine(line); console.log('MARK@' + line)
    await sleep(500)
    const end = Date.now() + secs * 1000
    while (Date.now() < end && !S.done) {
      if (line === 'spell') { await spellOne(); continue }
      if (S.target && g.ids().length) tapBoard()
      await sleep(1200)
      if (line === 'listen' && S.crystals >= 30 && !window.__up) { window.__up = 1; g.buyTier() }
    }
  }
  console.log('MARK@end')
})
await page.waitForTimeout(800)
await page.close(); console.log('VIDEO', await page.video().path())
await ctx.close(); await b.close()
