/**
 * 軍團包（2026-09-24）的畫面實測：商店四層架子 → 買哥布林 → 拿到「頂階降臨」才買得到豬 →
 * 「我的角色」換上豬、顏色變灰 → 兵推整套換（九格升階都放上場截圖）→ 守塔換士兵和箭塔。
 *
 * 跑在本地版（不填金鑰），金幣、等級、成就直接塞進 localStorage。
 * 畫面先用 390×844 直拿看商店和「我的角色」，戰場再轉成 844×390。
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5174
 *   node tools/test/legion-e2e.mjs http://localhost:5174/
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5174/'
const SHOT = process.argv[3] || '/tmp/legion-e2e'
mkdirSync(SHOT, { recursive: true })

const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))

const poke = (fn) => page.evaluate(fn)
const noHScroll = async (where) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  wide <= 390 ? ok(where + '沒有橫向捲動') : fail(`${where}往右多出 ${wide - 390}px`)
}

try {
  console.log('── 註冊、塞金幣和等級')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
  const id = 'lg' + Date.now().toString().slice(-6)
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', '軍團' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 10000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 10000 })
  await poke(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const c = JSON.parse(localStorage.getItem(key))
    c.coins = 5000; c.exp = 6000
    localStorage.setItem(key, JSON.stringify(c))
  })
  await page.reload({ waitUntil: 'networkidle' })

  console.log('── 商店：四層架子')
  await page.getByRole('button', { name: '商店' }).click()
  await page.waitForSelector('.lg-shelf')
  const shelves = await page.locator('.lg-head b').allInnerTexts()
  shelves.join() === '預設,普通,稀有,傳說' ? ok('四層架子：' + shelves.join('／')) : fail('架子不對：' + shelves)
  const pigBtn = page.locator('.lg-item', { hasText: '豬軍團' }).locator('button.btn')
  ;(await pigBtn.innerText()).includes('先拿成就') && await pigBtn.isDisabled()
    ? ok('沒拿到「頂階降臨」時豬軍團買不了') : fail('豬軍團按鈕：' + await pigBtn.innerText())
  if (await page.locator('.item', { hasText: '紅軍' }).count()) fail('商店還在賣顏色')
  else ok('顏色不上架了')
  await noHScroll('商店')
  await page.screenshot({ path: SHOT + '/1-shop.png', fullPage: true })

  await page.locator('.lg-item', { hasText: '哥布林軍團' }).locator('button.btn').click()
  await page.waitForSelector('.note, .error')
  const c1 = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  c1 === 3500 ? ok('哥布林軍團 1500 金買到了') : fail('金幣不對：' + c1)

  console.log('── 拿到「頂階降臨」之後豬軍團才開賣')
  await poke(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const sid = key.split('.').pop()
    localStorage.setItem('gep.v1.ach.' + sid, JSON.stringify([{ id: 'top-tier', at: Date.now(), tier: 1 }]))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '商店' }).click()
  await page.waitForSelector('.lg-shelf')
  await page.waitForTimeout(300)
  await page.locator('.lg-item', { hasText: '豬軍團' }).locator('button.btn').click()
  await page.waitForSelector('.note, .error')
  const c2 = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  c2 === 500 ? ok('豬軍團 3000 金買到了') : fail('金幣不對：' + c2 + ' ' + await page.locator('.error').innerText().catch(() => ''))

  console.log('── 我的角色：換上豬軍團，顏色變灰')
  await page.locator('.lg-item', { hasText: '豬軍團' }).locator('.i-go').click()
  await page.waitForSelector('.hero')
  await page.locator('.pick', { hasText: '紅軍' }).click()
  await page.waitForTimeout(300)
  await page.locator('.pick', { hasText: '豬軍團' }).click()
  await page.waitForTimeout(300)
  ;(await page.locator('.pick', { hasText: '豬軍團' }).getAttribute('class')).includes(' on')
    ? ok('換上豬軍團了') : fail('豬軍團沒換上')
  ;(await page.locator('.picks.off').count()) === 1 && await page.locator('.pick', { hasText: '黃軍' }).isDisabled()
    ? ok('顏色那排變灰、按不了') : fail('顏色沒變灰')
  await noHScroll('我的角色')
  await page.screenshot({ path: SHOT + '/2-me.png', fullPage: true })

  console.log('── 兵推：整套換成豬軍團')
  await page.getByRole('button', { name: '回去' }).click()
  await page.waitForSelector('.levels')
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-foe', { timeout: 15000 })
  await page.locator('.vs-foe').first().click()
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(2500)
  const foeTxt = await page.locator('.tw-foe').innerText()
  foeTxt.includes('電腦') ? ok('對手標示：' + foeTxt) : fail('沒標電腦對手：' + foeTxt)
  // 九格都放上場：我方三條線各一到三階，對面放三隻紅色王國軍
  await poke(() => {
    const g = window.__tug
    g.freeze(true)
    g.S.battle.units.length = 0
    const xs = [230, 330, 450, 580, 700, 820]
    let i = 0
    for (const line of ['recognize', 'listen', 'spell']) {
      for (const r of [1, 2, 3]) {
        const u = g.summon('me', line, r)
        u.x = 240 + i * 62; u.id = i % 3
        i++
      }
    }
    for (const line of ['recognize', 'listen', 'spell']) {
      const u = g.summon('foe', line, 1); u.x = 880 + xs.length * 0; u.id = 2
    }
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: SHOT + '/3-versus-pig.png' })
  // 戰場換成城堡室內：畫布上半部要是粉紅磚牆，不是草地的綠
  const wallish = await page.locator('.td-cv').evaluate((cv) => {
    const d = cv.getContext('2d').getImageData(0, 150, cv.width, 150).data
    let pink = 0, green = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 150 && d[i] > d[i + 1] + 20) pink++
      if (d[i + 1] > d[i] + 15 && d[i + 1] > d[i + 2]) green++
    }
    return { pink: pink / (d.length / 4), green: green / (d.length / 4) }
  })
  wallish.pink > 0.4 && wallish.green < 0.1
    ? ok(`戰場是城堡室內（粉紅磚 ${(wallish.pink * 100).toFixed(0)}%、綠 ${(wallish.green * 100).toFixed(0)}%）`)
    : fail('戰場沒換：' + JSON.stringify(wallish))

  console.log('── 守塔：士兵和箭塔換成豬，地圖不換')
  await page.locator('.leave').click()
  await page.locator('.confirm-btns .btn:not(.ghost)').click()
  await page.waitForSelector('.levels, .result, .vs-foe', { timeout: 10000 })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.levels', { timeout: 10000 })
  await page.locator('.lv').first().click()
  await page.waitForSelector('.td-cv', { timeout: 10000 })
  await page.locator('.rotate').click({ timeout: 1500 }).catch(() => {})
  await page.waitForTimeout(1500)
  await poke(() => {
    const g = window.__td
    g.tapSlot(0)
    const bar = document.querySelector('.td-card[data-kind="barracks"]'); bar?.click()
    g.tapSlot(1)
  })
  await page.waitForTimeout(800)
  await page.screenshot({ path: SHOT + '/4-td-pig.png' })
  ok('守塔截圖好了（看圖確認）')

  console.log('── 換成哥布林軍團，兵推還是草地')
  await page.locator('.leave').click()
  await page.locator('.confirm-btns .btn:not(.ghost)').click()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '我的角色', exact: true }).click()
  await page.waitForSelector('.hero')
  await page.locator('.pick', { hasText: '哥布林軍團' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '回去' }).click()
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: '對戰' }).click()
  await page.locator('.vs-foe').first().click()
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(2500)
  await poke(() => {
    const g = window.__tug
    g.freeze(true)
    g.S.battle.units.length = 0
    let i = 0
    for (const line of ['recognize', 'listen', 'spell']) {
      for (const r of [1, 2, 3]) { const u = g.summon('me', line, r); u.x = 240 + i * 62; u.id = i % 3; i++ }
    }
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: SHOT + '/5-versus-goblin.png' })
  ok('哥布林兵推截圖好了（看圖確認）')
} catch (e) {
  fail(String(e))
  await page.screenshot({ path: SHOT + '/error.png' }).catch(() => {})
} finally {
  await b.close()
  console.log('\n截圖在 ' + SHOT)
}
