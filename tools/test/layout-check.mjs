/**
 * 版面檢查：幾種常見的手機與桌機尺寸，量「上面那一條佔多少高」、
 * 「蓋塔面板有沒有壓到戰場」、「開戰前後畫布會不會跳大小」。
 *
 * 會這樣量是因為 Chuck 用手機回報的兩件事都是量得出來的：
 * 面板壓住塔位、上面兩條太肥。用眼睛看容易漏，量就不會。
 *
 *   node tools/test/layout-check.mjs [url]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173/'
const SIZES = [
  { w: 844, h: 390, name: 'iPhone 直機橫拿' },
  { w: 932, h: 430, name: 'iPhone Pro Max 橫拿' },
  { w: 667, h: 375, name: '小螢幕手機橫拿' },
  { w: 1024, h: 768, name: '平板橫拿' },
  { w: 1440, h: 900, name: '桌機' },
]
const ok = (m) => console.log('  ✓ ' + m)
const bad = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

for (const size of SIZES) {
  const page = await b.newPage({ viewport: { width: size.w, height: size.h } })
  page.on('pageerror', (e) => bad('畫面炸了：' + e.message))
  console.log(`── ${size.name}（${size.w}×${size.h}）`)
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '第一次來' }).click()
    const id = 'ui' + Date.now().toString().slice(-6) + size.w
    await page.fill('#cls', process.env.E2E_CLASS || 'TEST1'); await page.fill('#lid', id)
    await page.fill('#pw', 'abc123'); await page.fill('#nick', '版面')
    await page.locator('form button[type=submit]').click()
    await page.waitForSelector('.jobs .job')
    ok('登入畫面的分頁按得到，創角畫面出得來')
    await page.locator('.jobs .job').nth(0).click()
    await page.locator('.avatars .av').nth(2).click()
    await page.locator('button.btn.big').click()
    await page.waitForSelector('.levels')
    await page.locator('.lv').first().click()
    await page.waitForSelector('.td-cv')
    await page.locator('.rotate').click({ timeout: 1500 }).catch(() => {})
    await page.waitForTimeout(500)

    const box = async (sel) => await page.locator(sel).boundingBox()
    const [hud, bar, cv, tray] = await Promise.all(
      [box('.td-hud'), box('.leavebar'), box('.td-cv'), box('.td-tray')])
    const top = Math.max(hud.y + hud.height, bar.y + bar.height)
    top <= size.h * 0.18 ? ok(`上面那一條 ${Math.round(top)}px（螢幕高 ${size.h}）`)
      : bad(`上面那一條太肥：${Math.round(top)}px`)

    const overlap = tray.x < cv.x + cv.width && tray.x + tray.width > cv.x
    overlap ? bad('蓋塔面板壓在戰場上') : ok(`蓋塔面板在戰場旁邊（畫布 ${Math.round(cv.width)}×${Math.round(cv.height)}）`)

    cv.y + cv.height <= size.h + 1 ? ok('畫布沒有掉出畫面')
      : bad(`畫布超出畫面 ${Math.round(cv.y + cv.height - size.h)}px`)

    await page.evaluate(() => { window.__td?.tapSlot(0); window.__td?.startWave() })
    await page.waitForTimeout(700)
    const cv2 = await box('.td-cv')
    Math.abs(cv2.width - cv.width) < 2 ? ok('開戰前後畫布一樣大，怪不會跳位置')
      : bad(`開戰後畫布從 ${Math.round(cv.width)} 變成 ${Math.round(cv2.width)}`)
    // 道具生效時上面那一條會多一段倒數。它會不會把關卡名稱或水晶數擠出畫面，
    // 用眼睛看不準，量就準：HUD 捲不動才代表東西都還在裡面。
    await page.evaluate(() => { window.__td?.useItem('slow-30') })
    await page.waitForTimeout(400)
    const spill = await page.locator('.td-hud').evaluate((e) => e.scrollWidth - e.clientWidth)
    spill <= 1 ? ok('道具倒數擠進上面那一條還有空間')
      : bad(`道具倒數把上面那一條擠爆了 ${spill}px`)
    await page.screenshot({ path: `/tmp/layout-${size.w}x${size.h}.png` })
  } catch (e) {
    bad(String(e).split('\n')[0])
  }
  await page.close()
}
await b.close()
console.log('\n截圖在 /tmp/layout-*.png')
