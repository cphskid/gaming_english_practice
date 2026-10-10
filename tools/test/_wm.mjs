import { chromium } from 'playwright'
const D = '/tmp/claude-0/-home-user/c9ab8db9-452e-549f-b475-db7c42933fd3/scratchpad/'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
for (const [w, h] of [[1280, 720], [844, 390], [390, 844]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } })
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
  const id = 'wm' + Math.random().toString(36).slice(2, 8)
  await page.goto(process.argv[2])
  await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123'); await page.fill('#nick', '地圖' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 30000 })
  await page.locator('.jobs .job').first().click(); await page.locator('.avatars .av').first().click(); await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 30000 }); await page.waitForTimeout(1500)
  await page.screenshot({ path: D + `wm-${w}.png` })
  await page.locator('.lv').first().click(); await page.waitForTimeout(400)
  await page.screenshot({ path: D + `wm-${w}-card.png` })
  await page.locator('.chhead').nth(1).click(); await page.waitForTimeout(1200)
  await page.screenshot({ path: D + `wm-${w}-ch2.png` })
  console.log(w, errors)
  await page.close()
}
await b.close()
