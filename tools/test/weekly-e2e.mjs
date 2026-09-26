/**
 * 排行榜「本週之星」（2026-09-26）的畫面實測：本地版塞三位同學的本週答題與徽章，
 * 看五格是不是各放一個人、沒人的格子寫「等你來拿」、手機直拿不會橫向捲動、
 * 金幣分頁已經拿掉。
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5174
 *   node tools/test/weekly-e2e.mjs http://localhost:5174/
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5174/'
const SHOT = process.argv[3] || '/tmp/weekly-e2e'
mkdirSync(SHOT, { recursive: true })

const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))

try {
  console.log('── 註冊')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
  const id = 'wk' + Date.now().toString().slice(-6)
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', '我' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 10000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 10000 })

  console.log('── 塞三位同學：答題王、進步王、拿到稀有徽章的；我自己拼字幾題')
  await page.evaluate(() => {
    const NS = 'gep.v1'
    const mineKey = Object.keys(localStorage).find((k) => k.startsWith(NS + '.character.'))
    const meId = mineKey.slice((NS + '.character.').length)
    const me = JSON.parse(localStorage.getItem(NS + '.student.' + meId))
    const code = me.classCode
    const now = Date.now()
    const ev = (sid, n, at, skill = 'recognize') => Array.from({ length: n }, (_, i) => ({
      studentId: sid, wordId: i + 1, skill, correct: true, ms: 900, combo: 0,
      gameId: 'test', levelId: null, sessionId: 'x', ord: i, at,
    }))
    const kids = [
      { id: 'wk-kid-1', nick: '答題王小明', ev: ev('wk-kid-1', 80, now - 1000), frame: ['frame-crown'] },
      { id: 'wk-kid-2', nick: '進步很多的小華', ev: ev('wk-kid-2', 40, now - 1000), frame: [] },
      { id: 'wk-kid-3', nick: '小美', ev: ev('wk-kid-3', 3, now - 1000), frame: ['frame-rainbow'],
        ach: [{ id: 'hundred', at: now - 2000, tier: 4, tierAt: now - 2000 }] },
    ]
    const roster = JSON.parse(localStorage.getItem(NS + '.roster.' + code) || '[]')
    const myChar = JSON.parse(localStorage.getItem(mineKey))
    for (const k of kids) {
      localStorage.setItem(NS + '.student.' + k.id, JSON.stringify({ ...me, id: k.id, nickname: k.nick, loginId: k.id }))
      localStorage.setItem(NS + '.character.' + k.id,
        JSON.stringify({ ...myChar, studentId: k.id, equipped: k.frame, exp: 3000 }))
      localStorage.setItem(NS + '.events.' + k.id, JSON.stringify(k.ev))
      localStorage.setItem(NS + '.ach.' + k.id, JSON.stringify(k.ach ?? []))
      if (!roster.includes(k.id)) roster.push(k.id)
    }
    localStorage.setItem(NS + '.roster.' + code, JSON.stringify(roster))
    const myEv = [...ev(meId, 12, now - 1000, 'spell'), ...ev(meId, 12, now - 1000, 'listen')]
    localStorage.setItem(NS + '.events.' + meId, JSON.stringify(myEv))
  })
  await page.reload({ waitUntil: 'networkidle' })

  console.log('── 排行榜')
  await page.getByRole('button', { name: '排行榜' }).click()
  await page.waitForSelector('.wk-card')
  const cards = await page.locator('.wk-card').evaluateAll((els) => els.map((e) => ({
    name: e.querySelector('.wk-name')?.textContent ?? '', who: e.querySelector('.wk-who')?.textContent ?? '',
    val: e.querySelector('.wk-val')?.textContent ?? '', empty: e.classList.contains('empty'),
  })))
  console.log('    ' + cards.map((c) => `${c.name}：${c.who} ${c.val}`).join('\n    '))
  cards.length === 5 ? ok('五格都畫出來了') : fail('格數不對：' + cards.length)
  const who = (slot) => cards[slot]?.who ?? ''
  who(0).startsWith('答題王小明') ? ok('答對最多是小明（80 題）') : fail('答對最多：' + who(0))
  who(1).startsWith('進步很多的小華') ? ok('進步最多是小華（小明已經上過了，換下一位）') : fail('進步最多：' + who(1))
  who(2).startsWith('小美') && cards[2].val.includes('全班只有 1 人') ? ok('稀有徽章是小美，寫全班只有 1 人') : fail('稀有徽章：' + who(2) + cards[2].val)
  cards[3].empty && who(3) === '等你來拿' ? ok('本地版沒有魔王紀錄，那格寫「等你來拿」') : fail('魔王格：' + who(3))
  who(4).includes('（你）') ? ok('神祕格輪到我（其他人都上過了）') : fail('神祕格：' + who(4))
  const tabs = await page.locator('.tabs button').allInnerTexts()
  tabs.join() === '經驗,星星' ? ok('分頁剩經驗、星星，金幣拿掉了') : fail('分頁：' + tabs)
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  wide <= 390 ? ok('手機直拿沒有橫向捲動') : fail(`往右多出 ${wide - 390}px`)
  await page.screenshot({ path: SHOT + '/1-board.png' })
  await page.locator('.wk-strip').evaluate((e) => { e.scrollLeft = 9999 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: SHOT + '/2-board-scrolled.png' })
  await page.locator('.wk-card', { hasText: '答題王小明' }).click()
  await page.waitForTimeout(500)
  ;(await page.locator('text=答題王小明').count()) ? ok('點小卡進得去他的徽章牆') : fail('點小卡沒反應')
} catch (e) {
  fail(e.message)
} finally {
  await b.close()
}
console.log(process.exitCode ? '有東西壞了' : '\n截圖在 ' + SHOT)
