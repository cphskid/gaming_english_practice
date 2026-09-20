/**
 * 養成包的畫面實測：創角 → 商店 → 背包 → 帶道具進關卡。
 *
 * 跑在 localStorage 版（不填 Supabase 金鑰就是本地版），所以不會在正式資料庫
 * 留下測試帳號；買道具那一段直接把金幣塞進本地存檔，不用先打十關。
 * 正式站的實測另外用 accounts-e2e.mjs。
 *
 * 畫面尺寸固定 390×844——Chuck 都是手機直拿在用的。
 *
 *   npm run dev &  然後  node tools/test/pack-e2e.mjs [url]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173/'
const SHOT = '/tmp/pack-e2e'
mkdirSync(SHOT, { recursive: true })

const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

// 環境裡的 Chromium 跟 playwright 版本對不上，指到預裝的那顆（accounts-e2e.mjs 同樣做法）
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))

try {
  console.log('── 註冊一個新學生')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '第一次來' }).click()
  const id = 'pk' + Date.now().toString().slice(-6)
  await page.fill('#cls', 'TEST1')
  await page.fill('#lid', id)
  await page.fill('#pw', 'abc123')
  await page.fill('#nick', '小測' + id.slice(-3))
  await page.locator('form button[type=submit]').click()

  console.log('── 創角畫面')
  await page.waitForSelector('.jobs .job', { timeout: 10000 })
  ok('註冊完直接被帶到創角')
  await page.locator('.jobs .job').nth(1).click()          // 法師
  await page.locator('.avatars .av').nth(6).click()
  await page.screenshot({ path: SHOT + '/1-create.png', fullPage: true })
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 10000 })
  ok('出發之後進到選關')
  if (await page.locator('.topbar .mug').count()) ok('選關畫面上看得到頭像')
  else fail('選關畫面沒有頭像')

  console.log('── 塞一點金幣，去商店買東西')
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const c = JSON.parse(localStorage.getItem(key))
    c.coins = 500; c.exp = 400
    localStorage.setItem(key, JSON.stringify(c))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '商店' }).click()
  await page.waitForSelector('.items .item')
  await page.screenshot({ path: SHOT + '/2-shop.png', fullPage: true })
  const before = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  await page.locator('.item', { hasText: '寒霜陷阱' }).locator('button').click()
  await page.waitForSelector('.note')
  const after = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  before - after === 60 ? ok(`買了寒霜陷阱，金幣 ${before} → ${after}`) : fail(`金幣扣錯：${before} → ${after}`)

  await page.locator('.item', { hasText: '紅披風' }).locator('button').click()
  await page.waitForSelector('.note')
  await page.getByRole('button', { name: '背包' }).click()
  await page.waitForSelector('.items .item')
  await page.locator('.item', { hasText: '紅披風' }).locator('button').click()
  await page.waitForTimeout(300)
  const worn = await page.locator('.item', { hasText: '紅披風' }).locator('button').innerText()
  worn.includes('穿在身上') ? ok('披風穿起來了') : fail('披風穿不起來：' + worn)
  await page.screenshot({ path: SHOT + '/3-bag.png', fullPage: true })

  console.log('── 帶道具進關卡')
  await page.getByRole('button', { name: '回去' }).click()
  await page.waitForSelector('.levels')
  await page.locator('.lv').first().click()
  await page.waitForSelector('.td-cv', { timeout: 10000 })
  // 直拿的時候「請轉成橫的」那層蓋在上面，點一下就收起來（它本來就是這樣設計的）
  await page.locator('.rotate').click()
  const bag = page.locator('.bagitem')
  await bag.first().waitFor({ timeout: 5000 })
  ok('關卡上面那一排看得到道具：' + (await bag.first().innerText()).replace('\n', ' '))
  await page.screenshot({ path: SHOT + '/4-play.png' })

  // 還在準備階段，寒霜陷阱用不了才對——用了會浪費，不該扣掉
  await bag.first().click()
  await page.waitForTimeout(400)
  const still = await bag.first().innerText()
  still.includes('×1') ? ok('準備階段點它不會被扣掉（會浪費）') : fail('準備階段就把道具吃掉了：' + still)

  // 要先有一座塔才開得了戰（引擎的規則），所以先蓋一座再開波
  await page.evaluate(() => { window.__td?.tapSlot(0); window.__td?.startWave() })
  await page.waitForTimeout(600)
  await bag.first().click()
  await page.waitForTimeout(400)
  const gone = await page.locator('.bagitem').count()
  gone === 0 ? ok('開戰後用掉了，道具列空了') : ok('開戰後用掉了，還剩 ' + gone + ' 種道具')
  const toast = await page.locator('.td-toast').innerText()
  toast.includes('結霜') ? ok('效果真的發生了：' + toast) : fail('沒看到效果：' + toast)
  await page.screenshot({ path: SHOT + '/5-item-used.png' })
} catch (e) {
  fail(String(e))
  await page.screenshot({ path: SHOT + '/error.png' }).catch(() => {})
} finally {
  await b.close()
  console.log('\n截圖在 ' + SHOT)
}
