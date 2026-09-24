/**
 * 成就第二版的畫面實測：分階徽章、名牌、徽章詳情、排行榜上的主徽章。
 *
 * 跑在 localStorage 版（不填 Supabase 金鑰就是本地版）。答題紀錄直接塞進本地存檔，
 * 不用真的打幾百題。畫面固定 390×844——Chuck 都是手機直拿。
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5174 &
 *   node tools/test/ach-e2e.mjs http://localhost:5174/
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5174/'
const SHOT = '/tmp/ach-e2e'
mkdirSync(SHOT, { recursive: true })

const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))

const noSideScroll = async (where) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  wide <= 390 ? ok(where + '沒有橫向捲動') : fail(`${where}往右多出 ${wide - 390}px`)
}

try {
  console.log('── 註冊一個新學生')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '第一次來' }).click()
  const id = 'ac' + Date.now().toString().slice(-6)
  await page.fill('#cls', 'TEST1')
  await page.fill('#lid', id)
  await page.fill('#pw', 'abc123')
  await page.fill('#nick', '小徽' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 10000 })
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 10000 })

  console.log('── 塞答題紀錄：三天、每天 300 字各答對一次＋同一個字狂刷 50 次')
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const sid = key.split('.').pop()
    const ev = []
    const day = 86400000
    for (let d = 0; d < 3; d++) {
      for (let w = 1; w <= 300; w++) {
        ev.push({ studentId: sid, gameId: 'test', levelId: null, sessionId: 's' + d, ord: w,
          wordId: w, skill: 'recognize', correct: true, ms: 900, combo: Math.min(w, 23),
          at: Date.now() - d * day })
      }
    }
    for (let i = 0; i < 50; i++) {
      ev.push({ studentId: sid, gameId: 'test', levelId: null, sessionId: 'x', ord: 1000 + i,
        wordId: 1, skill: 'recognize', correct: true, ms: 900, combo: 0, at: Date.now() })
    }
    localStorage.setItem('gep.v1.events.' + sid, JSON.stringify(ev))
  })
  await page.reload({ waitUntil: 'networkidle' })

  console.log('── 徽章牆')
  await page.getByRole('button', { name: '徽章' }).click()
  await page.waitForSelector('.achgrid .achcell')
  await page.waitForTimeout(300)
  const hundred = await page.locator('.achcell', { hasText: '萬題' }).innerText()
  // 904 次有效答對（第一個字今天刷的 51 次只算 5 次）：過 500（銀），還沒到 1,000
  hundred.includes('萬題·銀') ? ok('904 題有效答對＝萬題銀階') : fail('萬題階級不對：' + hundred)
  hundred.includes('904 / 1,000') ? ok('看得到「904 / 1,000」') : fail('萬題進度不對：' + hundred)
  const lit = await page.locator('.achcell', { hasText: '識字者' }).innerText()
  lit.includes('識字者·鑽石') ? ok('三百字全答對過＝識字者鑽石') : fail('識字者不對：' + lit)
  ;(await page.locator('.nearest').count()) ? ok('最上面有「再幾題就升階」') : fail('沒有最接近的那一條')
  await page.screenshot({ path: SHOT + '/1-wall.png' })
  await noSideScroll('徽章牆')

  console.log('── 點徽章看詳情，設成主徽章')
  await page.locator('.achcell', { hasText: '萬題' }).click()
  await page.waitForSelector('.sheet')
  const sheet = await page.locator('.sheet').innerText()
  sheet.includes('還差 96') ? ok('詳情寫著下一階還差 96') : fail('詳情不對：' + sheet)
  sheet.includes('全班') ? ok('詳情有全班幾人') : fail('詳情沒有全班幾人')
  await page.screenshot({ path: SHOT + '/2-sheet.png' })
  await page.getByRole('button', { name: '設成主徽章' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '關掉' }).click()
  for (const name of ['識字者', '連對']) {
    await page.locator('.achcell', { hasText: name }).first().click()
    await page.getByRole('button', { name: '別在旁邊' }).click()
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: '關掉' }).click()
  }
  const plates = await page.locator('.profile-head .plate').allInnerTexts()
  plates.length === 3 ? ok('名字旁邊別了三個') : fail('別了 ' + plates.length + ' 個')
  plates[0]?.startsWith('萬題·銀') ? ok('第一個是主徽章萬題·銀') : fail('主徽章不對：' + plates[0])
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: SHOT + '/3-pinned.png' })

  console.log('── 排行榜上只有主徽章')
  await page.getByRole('button', { name: '回去' }).click()
  await page.getByRole('button', { name: '排行榜' }).click()
  await page.waitForSelector('.rank .plate')
  const row = await page.locator('.rank.me').innerText()
  row.includes('萬題·銀') ? ok('排行榜上看得到主徽章的名字和階級') : fail('排行榜那一列：' + row)
  !row.includes('識字者') ? ok('排行榜只放主徽章，副徽章不出現') : fail('排行榜出現了副徽章：' + row)
  row.includes('全班') ? ok('主徽章旁邊有全班幾人') : fail('主徽章旁邊沒有全班幾人')
  await page.screenshot({ path: SHOT + '/4-board.png' })
  await noSideScroll('排行榜')
} catch (e) {
  fail(e.message)
  await page.screenshot({ path: SHOT + '/error.png' })
} finally {
  await b.close()
}
