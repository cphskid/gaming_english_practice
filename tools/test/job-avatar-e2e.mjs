/**
 * 職業與頭像改版（2026-09-25）的畫面實測：
 * 創角每個職業四張頭像 → 「我的角色」換職業、頭像跟著換 → 商店買頭像、換職業也留著
 * → 守塔與對戰裡英雄有出手。
 *
 * 跑在 localStorage 版（不填 Supabase 金鑰），畫面 390×844（Chuck 手機直拿）。
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5174 &
 *   node tools/test/job-avatar-e2e.mjs http://localhost:5174/
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5174/'
const SHOT = process.env.SHOT || '/tmp/job-avatar-e2e'
mkdirSync(SHOT, { recursive: true })

const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))
const avatarsNow = () => page.locator('.avatars').first().locator('.av img')
  .evaluateAll((els) => els.map((e) => e.getAttribute('src').split('/').pop()))
const myMug = () => page.locator('.hero .mugbox img').getAttribute('src').then((s) => s.split('/').pop())
const noSideScroll = async (where) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  wide <= 390 ? ok(where + '沒有橫向捲動') : fail(`${where}往右多出 ${wide - 390}px`)
}

try {
  console.log('── 註冊、創角')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '第一次來' }).click()
  const id = 'ja' + Date.now().toString().slice(-6)
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', '職業' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 15000 })

  const knightAv = await avatarsNow()
  knightAv.length === 4 && knightAv.every((s) => /^av-(warrior|soldier)-[mf]\.png$/.test(s))
    ? ok('騎士有四張：' + knightAv.join(' ')) : fail('騎士的頭像不對：' + knightAv.join(' '))
  if (await page.locator('.jobs .job .job-icon svg path').count() >= 2) ok('兩張職業卡都有圖示')
  else fail('職業卡沒有圖示')
  await page.waitForTimeout(600)
  await page.screenshot({ path: SHOT + '/1-create-knight.png', fullPage: true })

  await page.locator('.jobs .job').nth(1).click()
  const mageAv = await avatarsNow()
  mageAv.length === 4 && mageAv.every((s) => /^av-(magician|healer)-[mf]\.png$/.test(s))
    ? ok('點法師就換成法師那四張') : fail('法師的頭像不對：' + mageAv.join(' '))
  await page.locator('.avatars .av').nth(3).click()
  await page.screenshot({ path: SHOT + '/2-create-mage.png', fullPage: true })
  await noSideScroll('創角')
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 10000 })

  console.log('── 我的角色：換職業')
  await page.getByRole('button', { name: '我的角色' }).click()
  await page.waitForSelector('.hero')
  ;(await myMug()) === 'av-healer-f.png' ? ok('創角選的頭像有存到') : fail('創角選的頭像沒存到：' + await myMug())
  if (await page.locator('.shopwrap .jobs .job').count() === 2) ok('「我的角色」看得到職業')
  else fail('「我的角色」沒有職業')
  await page.waitForTimeout(600)
  await page.screenshot({ path: SHOT + '/3-mychar.png', fullPage: true })
  await noSideScroll('我的角色')

  await page.locator('.shopwrap .jobs .job').nth(0).click()
  await page.waitForSelector('.note')
  ;(await myMug()) === 'av-warrior-m.png' ? ok('換騎士，頭像跟著換成騎士的第一張')
    : fail('換職業之後頭像是 ' + await myMug())
  const now = await avatarsNow()
  now[0] === 'av-warrior-m.png' ? ok('頭像那一排也換成騎士的') : fail('頭像那一排沒換：' + now.join(' '))

  console.log('── 商店買頭像')
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const c = JSON.parse(localStorage.getItem(key)); c.coins = 3000; c.exp = 2000
    localStorage.setItem(key, JSON.stringify(c))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '商店' }).click()
  await page.waitForSelector('.items .item')
  const shelves = await page.locator('h2.sec').allInnerTexts()
  ;['普通頭像', '稀有頭像', '傳說頭像'].every((t) => shelves.some((s) => s.includes(t)))
    ? ok('商店有三層頭像') : fail('商店的頭像架子不對：' + shelves.join('／'))
  await page.locator('.item', { hasText: '忍者（女）' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: SHOT + '/4-shop.png' })
  const before = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  await page.locator('.item', { hasText: '忍者（女）' }).locator('button.btn').click()
  await page.waitForSelector('.note')
  const after = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
  before - after === 300 ? ok(`買了忍者頭像，金幣 ${before} → ${after}`) : fail(`金幣扣錯：${before} → ${after}`)
  await page.locator('.item', { hasText: '忍者（女）' }).locator('.i-go').click()
  await page.waitForSelector('.hero')
  await page.locator('.av-shelf .av[aria-label="忍者（女）"]').click()
  await page.waitForSelector('.note')
  ;(await myMug()) === 'av-ninja-f.png' ? ok('戴上買來的頭像') : fail('沒戴上：' + await myMug())
  await page.locator('.shopwrap .jobs .job').nth(1).click()
  await page.waitForSelector('.note:has-text("法師")')
  ;(await myMug()) === 'av-ninja-f.png' ? ok('買來的頭像換職業也留著') : fail('換職業被換掉了：' + await myMug())

  console.log('── 守塔：英雄出手（打仗是橫拿的）')
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: '回去' }).click()
  await page.waitForSelector('.levels')
  await page.locator('.lv').first().click()
  await page.waitForSelector('.td-cv')
  await page.waitForTimeout(800)
  const td = await page.evaluate(async () => {
    const g = window.__td, S = g.S
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 3 && S.crystals >= 40; i++) g.tapSlot(i)
    g.startWave()
    const t0 = Date.now()
    let hits = 0
    while (Date.now() - t0 < 20000 && hits < 2) {
      if (S.target && S.target.entered) { g.tapEnemy(S.target); hits++; return { hits } }
      await sleep(100)
    }
    return { hits }
  })
  td.hits ? ok('守塔答對了一題') : fail('守塔沒等到題目')
  for (const ms of [120, 150, 200]) {
    await page.waitForTimeout(ms)
    await page.screenshot({ path: SHOT + `/5-td-mage-${ms}.png`, clip: { x: 380, y: 120, width: 330, height: 200 } })
  }

  console.log('── 對戰：換回騎士，看他衝出去砍')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '我的角色' }).click()
  await page.locator('.shopwrap .jobs .job').nth(0).click()
  await page.waitForSelector('.note:has-text("騎士")')
  await page.getByRole('button', { name: '回去' }).click()
  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-foe', { timeout: 15000 })
  await page.locator('.vs-foe').first().click()
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  await page.waitForTimeout(3000)
  const tug = await page.evaluate(async () => {
    const g = window.__tug
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 100; i++) {
      if (g.S.target && g.ids().length) { g.tapId(g.S.target); return true }
      await sleep(100)
    }
    return false
  })
  tug ? ok('對戰答對了一題') : fail('對戰沒等到題目')
  for (const ms of [60, 90, 150, 250]) {
    await page.waitForTimeout(ms)
    await page.screenshot({ path: SHOT + `/7-tug-knight-${ms}.png` })
  }
} catch (e) {
  fail(String(e))
  await page.screenshot({ path: SHOT + '/error.png', fullPage: true }).catch(() => {})
} finally {
  await b.close()
}
