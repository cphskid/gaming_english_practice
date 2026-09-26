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
  await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
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
  await page.locator('.avatars .av').nth(2).click()
  await page.screenshot({ path: SHOT + '/1-create.png', fullPage: true })
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 10000 })
  ok('出發之後進到選關')
  if (await page.locator('.topbar .mugbox').count()) ok('選關畫面上看得到頭像')
  else fail('選關畫面沒有頭像')
  // 上面那一條又多了一顆「排行榜」。手機直拿只有 390px 寬，擠不下就會橫向捲動，
  // 小朋友只會覺得「畫面壞了」，所以這裡量給它看。
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  wide <= 390 ? ok('選關畫面沒有橫向捲動') : fail(`選關畫面往右多出 ${wide - 390}px`)

  console.log('── 塞一點金幣，去商店買東西')
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const c = JSON.parse(localStorage.getItem(key))
    c.coins = 800; c.exp = 540
    localStorage.setItem(key, JSON.stringify(c))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '商店' }).click()
  await page.waitForSelector('.items .item')
  await page.screenshot({ path: SHOT + '/2-shop.png', fullPage: true })
  const before = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  await page.locator('.item', { hasText: '寒霜陷阱' }).locator('button.btn').click()
  await page.waitForSelector('.note')
  const after = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  before - after === 60 ? ok(`買了寒霜陷阱，金幣 ${before} → ${after}`) : fail(`金幣扣錯：${before} → ${after}`)

  console.log('── 買裝飾品，去「我的角色」穿起來')
  await page.locator('.item', { hasText: '金邊框' }).locator('button.btn').click()
  await page.waitForSelector('.note')
  // 陣營顏色 2026-09-24 起免費送，商店裡不賣了，下面直接在「我的角色」換
  if (await page.locator('.item', { hasText: '紅軍' }).count()) fail('商店還在賣顏色')
  else ok('商店不賣顏色了（送的）')

  // 「我的角色」搬出商店了，買到的裝飾品那行字就是捷徑
  await page.locator('.item', { hasText: '金邊框' }).locator('.i-go').click()
  await page.waitForSelector('.hero')
  await page.locator('.pick', { hasText: '金邊框' }).click()
  await page.waitForTimeout(300)
  const framed = await page.locator('.hero .mugbox').getAttribute('class')
  framed.includes('f-gold') ? ok('金邊框戴到頭像上了') : fail('外框沒戴上：' + framed)

  await page.locator('.pick', { hasText: '紅軍' }).click()
  await page.waitForTimeout(300)
  const redOn = await page.locator('.pick', { hasText: '紅軍' }).getAttribute('class')
  redOn.includes('on') ? ok('換成紅軍了') : fail('顏色沒換成功：' + redOn)
  await page.screenshot({ path: SHOT + '/3-me.png', fullPage: true })

  // 一個欄位只能穿一件：換成黃軍，紅軍要自己脫下來（規則在資料庫，這裡只是確認畫面跟得上）
  await page.locator('.pick', { hasText: '黃軍' }).click()
  await page.waitForTimeout(300)
  const stillRed = (await page.locator('.pick', { hasText: '紅軍' }).getAttribute('class')).includes(' on')
  stillRed ? fail('換了黃軍紅軍還穿著') : ok('換顏色會把原本那件脫掉')
  await page.locator('.pick', { hasText: '紅軍' }).click()
  await page.waitForTimeout(300)

  console.log('── 排行榜')
  await page.getByRole('button', { name: '回去' }).click()
  await page.waitForSelector('.levels')
  await page.getByRole('button', { name: '排行榜' }).click()
  await page.waitForSelector('.board .rank', { timeout: 10000 })
  const mine = page.locator('.rank.me')
  await mine.first().waitFor({ timeout: 5000 })
  ok('排行榜上找得到自己：' + (await mine.first().innerText()).replace(/\n/g, ' '))
  const myFrame = await mine.first().locator('.mugbox').getAttribute('class')
  if (myFrame.includes('f-gold')) ok('外框在排行榜上也看得到（同學看得到才叫收集）')
  else fail('排行榜上沒有外框：' + myFrame)
  await page.screenshot({ path: SHOT + '/4-board.png', fullPage: true })

  console.log('── 帶道具進關卡')
  await page.getByRole('button', { name: '回去' }).click()
  await page.waitForSelector('.levels')
  // 關卡本來就是橫著玩的，轉過來才量得準
  await page.setViewportSize({ width: 844, height: 390 })
  await page.locator('.lv').first().click()
  await page.waitForSelector('.td-cv', { timeout: 10000 })
  await page.locator('.rotate').click({ timeout: 1500 }).catch(() => {})
  await page.waitForTimeout(600)

  // 陣營顏色到底有沒有換，用眼睛看容易騙自己，量畫布的紅藍差就不會：
  // 紅軍的城堡、箭塔、士兵整套變紅，整張圖的紅就會比藍多出一截。
  // 整張圖的平均色沒有用——畫面九成是草地，城堡再紅也拉不動平均。
  // 改數「明顯偏紅的點有幾個」，紅軍的城堡、箭塔、士兵就藏不住了。
  const redBlue = () => page.locator('.td-cv').evaluate((cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    // 草地也是 R 比 B 大，所以紅要贏過綠才算紅
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] - d[i + 1] > 40 && d[i] - d[i + 2] > 40) n++
    }
    return (n / (d.length / 4)) * 100
  })
  const redness = await redBlue()
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

  // 道具有沒有在生效，要有一條看得到的狀態才算數
  const buff = page.locator('.td-buff')
  await buff.first().waitFor({ timeout: 3000 })
  const left = await buff.first().innerText()
  if (/\d+s/.test(left)) ok('上面那條在倒數：' + left.replace(/\n/g, ' '))
  else fail('狀態條沒有倒數：' + left)
  await page.screenshot({ path: SHOT + '/5-item-used.png' })

  console.log('── 換回藍軍，確認戰場真的跟著變')
  await page.locator('.leave').click()
  await page.locator('.confirm-btns .btn:not(.ghost)').click()
  await page.waitForSelector('.levels')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '我的角色', exact: true }).click()
  await page.waitForSelector('.hero')
  await page.locator('.pick', { hasText: '藍軍' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '回去' }).click()
  await page.waitForSelector('.levels')
  await page.setViewportSize({ width: 844, height: 390 })
  await page.locator('.lv').first().click()
  await page.waitForSelector('.td-cv', { timeout: 10000 })
  await page.locator('.rotate').click({ timeout: 1500 }).catch(() => {})
  await page.waitForTimeout(600)
  const blueness = await redBlue()
  redness > blueness * 2
    ? ok(`陣營顏色真的換了（偏紅的點 ${redness.toFixed(2)}% vs 藍軍的 ${blueness.toFixed(2)}%）`)
    : fail(`換了顏色但戰場看起來一樣（偏紅的點 ${redness.toFixed(2)}% vs ${blueness.toFixed(2)}%）`)
  await page.screenshot({ path: SHOT + '/6-blue.png' })
} catch (e) {
  fail(String(e))
  await page.screenshot({ path: SHOT + '/error.png' }).catch(() => {})
} finally {
  await b.close()
  console.log('\n截圖在 ' + SHOT)
}
