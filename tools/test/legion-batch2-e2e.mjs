/**
 * 第二批免費軍團（2026-09-24）的畫面實測：炸彈海盜、寶藏海盜、怪物小隊、元素大師。
 * 四套都買下來，一套一套換上，兵推九格放上場截圖；兩套海盜要是船艙、另外兩套是草地。
 * 守塔各截一張看士兵。跑法同 legion-e2e.mjs（本地版）：
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5174
 *   node tools/test/legion-batch2-e2e.mjs http://localhost:5174/
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5174/'
const SHOT = process.argv[3] || '/tmp/legion-batch2'
mkdirSync(SHOT, { recursive: true })

const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))
const poke = (fn) => page.evaluate(fn)

const PACKS = [
  { name: '炸彈海盜', key: 'pb', hall: true },
  { name: '寶藏海盜', key: 'th', hall: true },
  { name: '怪物小隊', key: 'mc', hall: false },
  { name: '元素大師', key: 'el', hall: false },
]

try {
  console.log('── 註冊、塞金幣和等級（夠買傳說級）')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '第一次來' }).click()
  const id = 'lb' + Date.now().toString().slice(-6)
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', '二批' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 10000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 10000 })
  await poke(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const c = JSON.parse(localStorage.getItem(key))
    c.coins = 20000; c.exp = 20000
    localStorage.setItem(key, JSON.stringify(c))
  })
  await page.reload({ waitUntil: 'networkidle' })

  console.log('── 商店：四套都在架上、買得到')
  await page.getByRole('button', { name: '商店' }).click()
  await page.waitForSelector('.lg-shelf')
  let coins = 20000
  for (const p of PACKS) {
    const item = page.locator('.lg-item', { hasText: p.name })
    if (!(await item.count())) { fail(p.name + ' 沒上架'); continue }
    await item.locator('button.btn').click()
    await page.waitForTimeout(400)
    const c = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
    c < coins ? ok(`${p.name} 買到了（花 ${coins - c}）`) : fail(p.name + ' 沒買成：' + await page.locator('.error').innerText().catch(() => ''))
    coins = c
  }
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  wide <= 390 ? ok('商店沒有橫向捲動') : fail(`商店往右多出 ${wide - 390}px`)
  await page.screenshot({ path: SHOT + '/0-shop.png', fullPage: true })

  for (const [n, p] of PACKS.entries()) {
    console.log('── ' + p.name)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '我的角色', exact: true }).click()
    await page.waitForSelector('.hero')
    await page.locator('.pick', { hasText: p.name }).click()
    await page.waitForTimeout(300)
    ;(await page.locator('.pick', { hasText: p.name }).getAttribute('class')).includes(' on')
      ? ok('換上了') : fail('沒換上')
    if (n === 0) await page.screenshot({ path: SHOT + '/0-me.png', fullPage: true })
    await page.getByRole('button', { name: '回去' }).click()
    await page.setViewportSize({ width: 844, height: 390 })
    await page.getByRole('button', { name: '對戰' }).click()
    await page.waitForSelector('.vs-foe', { timeout: 15000 })
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
      for (const line of ['recognize', 'listen', 'spell']) { const u = g.summon('foe', line, 1); u.x = 880; u.id = 2 }
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SHOT}/${n + 1}-versus-${p.key}.png` })
    const green = await page.locator('.td-cv').evaluate((cv) => {
      const d = cv.getContext('2d').getImageData(0, 150, cv.width, 150).data
      let g = 0
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] + 15 && d[i + 1] > d[i + 2]) g++
      return g / (d.length / 4)
    })
    if (p.hall) green < 0.1 ? ok('戰場換成船艙') : fail(`戰場還是草地（綠 ${(green * 100).toFixed(0)}%）`)
    else green > 0.3 ? ok('戰場是草地') : fail(`戰場不是草地（綠 ${(green * 100).toFixed(0)}%）`)

    await page.locator('.leave').click()
    await page.locator('.confirm-btns .btn:not(.ghost)').click()
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.levels', { timeout: 10000 })
    await page.locator('.lv').first().click()
    await page.waitForSelector('.td-cv', { timeout: 10000 })
    await page.locator('.rotate').click({ timeout: 1500 }).catch(() => {})
    await page.waitForTimeout(1500)
    await poke(() => {
      const g = window.__td
      g.tapSlot(0)
      document.querySelector('.td-card[data-kind="barracks"]')?.click()
      g.tapSlot(1)
    })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOT}/${n + 1}-td-${p.key}.png` })
    await page.locator('.leave').click()
    await page.locator('.confirm-btns .btn:not(.ghost)').click()
    ok('截圖好了（看圖確認）')
  }
} catch (e) {
  fail(String(e))
  await page.screenshot({ path: SHOT + '/error.png' }).catch(() => {})
} finally {
  await b.close()
  console.log('\n截圖在 ' + SHOT)
}
