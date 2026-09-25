/**
 * 魔王團戰走一遍真的 Supabase（三台手機）：
 *   甲開一場私人房 → 乙打錯密碼進不去、打對進得去 → 丙也進來 → 甲請丙離開、丙再也進不來 →
 *   甲按開打，甲乙兩台一起打（開發掛勾答題）→ 兩台算出來的戰場一模一樣 → 結算、打倒的話拿到外框。
 *
 * 跑之前開測試班 ZZ9TST（tools/test/prod-fixture.sql），跑完整班刪掉。
 * 要用開發模式（才有 window.__raid），但接正式資料庫：
 *
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_KEY=... npx vite --port 5185 &
 *   node tools/test/raid-e2e.mjs http://localhost:5185/ ZZ9TST /tmp/shots
 */
import { chromium } from 'playwright'

const [BASE = 'http://localhost:5185/', CLASS = 'ZZ9TST', OUT = '/tmp'] = process.argv.slice(2)
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }
const PHONE = { width: 390, height: 844 }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

const waitFor = async (page, sel, label, ms = 20000) => {
  try { await page.waitForSelector(sel, { timeout: ms }); ok(label); return true }
  catch { fail(label + '（等不到 ' + sel + '）'); return false }
}

async function newKid(who) {
  const id = 'zz' + Math.random().toString(36).slice(2, 8)
  const nick = who + id.slice(-3)
  const page = await b.newPage({ viewport: PHONE })
  page.on('pageerror', (e) => fail(nick + ' 那台畫面炸了：' + e.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', CLASS)
  await page.fill('#lid', id)
  await page.fill('#pw', 'abc123')
  await page.fill('#nick', nick)
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 30000 })
  await page.locator('.jobs .job').nth(0).click()
  await page.locator('.avatars .av').nth(3).click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 30000 })
  page.nick = nick
  return page
}

/** 在魔王團戰清單上，按那一場的按鈕；私人房就打密碼 */
async function join(page, pin) {
  await page.locator('.board .rank').first().locator('button').click()
  if (pin) {
    await page.fill('.pinask input', pin)
    await page.locator('.pinask button').click()
  }
}

async function play(page) {
  const t0 = Date.now()
  while (Date.now() - t0 < 260000) {
    const st = await page.evaluate(() => {
      const r = window.__raid
      if (!r) return null
      return { over: r.truth().over, target: r.target(), ids: r.ids() }
    }).catch(() => null)
    if (!st) { await page.waitForTimeout(300); continue }
    if (st.over) return
    if (st.target) {
      const id = Math.random() < 0.9 ? st.target : st.ids.find((x) => x !== st.target) ?? st.target
      await page.evaluate((x) => window.__raid.tapId(x), id).catch(() => {})
    }
    await page.waitForTimeout(300)
  }
}

try {
  console.log('── 三個小朋友')
  const [a, c, d] = [await newKid('團甲'), await newKid('團乙'), await newKid('團丙')]

  console.log('── 甲開私人房')
  await a.getByRole('button', { name: '魔王團戰' }).click()
  await a.waitForSelector('.bossgrid')
  await a.locator('.bosspick').nth(0).click()
  await a.getByRole('button', { name: '🔒 私人房' }).click()
  await a.fill('input.pin', '0427')
  await a.getByRole('button', { name: /開一場打/ }).click()
  await waitFor(a, 'text=0427', '甲的等待室看得到密碼')

  console.log('── 乙：打錯密碼、再打對')
  await c.getByRole('button', { name: '魔王團戰' }).click()
  await waitFor(c, '.board .rank', '乙的清單上看得到那一場')
  const row = await c.locator('.board .rank').first().innerText()
  row.includes('🔒') ? ok('清單上掛著鎖頭') : fail('清單上沒有鎖頭：' + row)
  row.includes('0427') ? fail('清單上竟然看得到密碼') : ok('清單上看不到密碼')
  await join(c, '1111')
  await waitFor(c, '.error', '打錯密碼進不去')
  await c.fill('.pinask input', '0427')
  await c.locator('.pinask button').click()
  await waitFor(c, 'text=先不玩了', '打對密碼進到等待室')

  console.log('── 丙進來、被請出去')
  await d.getByRole('button', { name: '魔王團戰' }).click()
  await d.waitForSelector('.board .rank')
  await join(d, '0427')
  await waitFor(d, 'text=先不玩了', '丙也進到等待室')
  await waitFor(a, `.board .rank:has-text("${d.nick}")`, '甲看得到丙')
  await a.locator(`.board .rank:has-text("${d.nick}") button`, { hasText: '請離開' }).click()
  try {
    await d.waitForSelector('text=先不玩了', { state: 'detached', timeout: 15000 })
    ok('丙被請出等待室')
  } catch { fail('丙還在等待室') }
  await d.waitForTimeout(2000)
  if (await d.locator('.board .rank button').count()) {
    await join(d, '0427')
    await waitFor(d, '.error', '丙再按一次也進不去')
  } else ok('丙的清單上已經沒有那一場')
  const inLobby = await a.locator('.board .rank').count()
  inLobby === 2 ? ok('甲的等待室剩兩個人') : fail(`甲的等待室有 ${inLobby} 行`)
  await a.screenshot({ path: `${OUT}/prod-lobby.png`, fullPage: true })

  console.log('── 開打')
  for (const p of [a, c]) await p.setViewportSize({ width: 844, height: 390 })
  await a.getByRole('button', { name: /大家一起開打/ }).click()
  await waitFor(a, '.td-cv', '甲進到戰場')
  await waitFor(c, '.td-cv', '乙自己被帶進戰場')
  await a.waitForTimeout(6000)
  await a.screenshot({ path: `${OUT}/prod-fight.png` })
  await Promise.all([play(a), play(c)])
  await a.waitForTimeout(3000)
  const [ta, tc] = [await a.evaluate(() => window.__raid?.truth()), await c.evaluate(() => window.__raid?.truth())]
  JSON.stringify(ta) === JSON.stringify(tc)
    ? ok(`兩台算出來的戰場一模一樣（${ta.win ? '打倒魔王' : '輸了'}，第 ${Math.round(ta.t)} 秒）`)
    : fail('兩台戰場不一樣')
  await waitFor(a, '.result', '甲看到結算', 40000)
  await waitFor(c, '.result', '乙看到結算', 40000)
  for (const p of [a, c]) await p.setViewportSize(PHONE)
  await a.waitForTimeout(1500)
  await a.screenshot({ path: `${OUT}/prod-result.png`, fullPage: true })
  if (ta?.win) {
    const txt = await a.locator('.result').innerText()
    txt.includes('外框') ? ok('結算寫著拿到外框') : fail('結算沒提到外框')
  }
} catch (e) {
  fail(String(e))
} finally {
  await b.close()
  console.log(process.exitCode ? '\n有項目沒過' : '\n魔王團戰這一輪全過')
}
