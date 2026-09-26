// 錄收集類畫面：徽章牆、我的角色、商店軍團、排行榜，慢慢捲
import { launch, register } from './common.mjs'
const [OUT = '/tmp/claude-0/intro/vid'] = process.argv.slice(2)
const { b, ctx } = await launch({ recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('ERR', e.message))
await register(page, { nick: '小勇者', job: 1, av: 2, cleared: 85 })
const t0 = Date.now(); const mark = (m) => console.log('MARK', m, ((Date.now() - t0) / 1000).toFixed(1))
const slowScroll = async (px, steps = 10) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await page.waitForTimeout(160) } }
for (const [name, sel] of [['徽章', null], ['我的角色', null], ['商店', null], ['排行榜', null]]) {
  mark(name)
  await page.getByRole('button', { name, exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `/tmp/claude-0/intro/shots/tour-${name}.png` })
  await slowScroll(700); await page.waitForTimeout(1200)
  await page.screenshot({ path: `/tmp/claude-0/intro/shots/tour-${name}-2.png` })
  await page.keyboard.press('Escape').catch(() => {})
  const back = page.getByRole('button', { name: /^回去$|返回/ }).first()
  if (await back.count()) await back.click().catch(() => {})
  await page.waitForTimeout(800)
  await page.evaluate(() => window.scrollTo(0, 0))
}
mark('end')
await page.close(); console.log('VIDEO', await page.video().path())
await ctx.close(); await b.close()
