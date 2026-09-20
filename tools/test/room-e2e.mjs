/**
 * 房間走一遍真的 Supabase：老師開一場 → 兩個小朋友進來 → 老師按開始 →
 * 兩邊都自己進到關卡裡 → 老師看得到誰在打 → 有人中途離開就從名單上消失。
 *
 * 房間是整個專案第一個「同一時間有兩個人」的功能，本機的 localStorage 版
 * 永遠只有一個人，所以這件事非得打真的資料庫不可。三個瀏覽器分頁各自是
 * 一個乾淨的 context，等於三台裝置。
 *
 * 跑之前要有一個測試老師與一個測試班級（見 tools/test/prod-fixture.sql），
 * 跑完記得把測試資料刪掉。
 *
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_KEY=... npx vite --port 5175 &
 *   node tools/test/room-e2e.mjs http://localhost:5175/ ZZ9ROOM \
 *        roomtest@zztest.local roomtest1234
 */
import { chromium } from 'playwright'

const [BASE = 'http://localhost:5175/', CLASS = 'ZZ9ROOM',
       TEACHER = 'roomtest@zztest.local', TEACHER_PW = 'roomtest1234'] = process.argv.slice(2)

const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }
const PHONE = { width: 390, height: 844 }

/** 輪詢是每三秒一次，所以等待的上限要抓得比它寬一點。 */
const waitFor = async (page, sel, label, ms = 25000) => {
  try { await page.waitForSelector(sel, { timeout: ms }); ok(label); return true }
  catch { fail(label + '（等不到 ' + sel + '）'); return false }
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

/** 註冊一個新學生並創好角，回到選關畫面。 */
async function newKid(who) {
  const id = 'zz' + Math.random().toString(36).slice(2, 8)
  // 暱稱同班不能重複，所以每一次跑都給不一樣的後綴，這支才重跑得了。
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
  return page
}

try {
  // ── 老師：開一場
  console.log('── 老師開一場')
  const t = await b.newPage({ viewport: { width: 1280, height: 900 } })
  t.on('pageerror', (e) => fail('老師那台畫面炸了：' + e.message))
  await t.goto(BASE, { waitUntil: 'networkidle' })
  await t.getByRole('button', { name: '我是老師' }).click()
  await t.fill('#em', TEACHER)
  await t.fill('#spw', TEACHER_PW)
  await t.locator('form button[type=submit]').click()
  await t.waitForSelector('.teacher', { timeout: 30000 })
  ok('老師登入進得了後台')

  // 這位老師可能帶不只一班，先點到測試班。
  const chip = t.locator('.chips button').filter({ hasText: /測試/ }).first()
  if (await chip.count()) await chip.click()
  await t.waitForSelector(`.codebox .code:has-text("${CLASS}")`, { timeout: 20000 })

  const pick = t.locator('.row select')
  await pick.selectOption({ index: 0 })
  await t.getByRole('button', { name: '開一場' }).click()
  await waitFor(t, 'text=在等你按開始', '開好了，在等人進來')

  // ── 兩個小朋友
  console.log('── 兩個小朋友進來')
  const a = await newKid('房測甲')
  const c = await newKid('房測乙')

  if (await waitFor(a, '.roomcall', '甲的選關畫面上出現「老師開了一場」')) {
    const txt = await a.locator('.roomcall').innerText()
    txt.includes('老師開了一場') ? ok('寫的是「老師開了一場」：' + txt.split('\n')[0])
      : fail('那一條寫的不對：' + txt)
  }
  // Chuck 都用手機直拿，所以這兩個畫面都要在 390 寬下確認沒有橫向捲動。
  const wide = await a.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  wide ? fail('選關畫面被那一條撐出橫向捲動') : ok('手機直拿沒有被撐寬')
  await a.screenshot({ path: '/tmp/room-banner.png' })

  await a.locator('.roomcall').click()
  await waitFor(a, 'text=等老師按開始', '甲進到等待室')

  await waitFor(c, '.roomcall', '乙也看得到那一條')
  await c.locator('.roomcall').click()
  await waitFor(c, 'text=等老師按開始', '乙也進到等待室')

  await waitFor(a, '.board .rank:nth-child(2)', '甲在等待室看得到乙也在')
  const mine = await a.locator('.board .rank.me').count()
  mine === 1 ? ok('自己那一行有標出來') : fail('自己那一行沒標出來（' + mine + '）')
  const wide2 = await a.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  wide2 ? fail('等待室被撐出橫向捲動') : ok('等待室在手機上也沒有被撐寬')
  await a.screenshot({ path: '/tmp/room-lobby.png' })

  // ── 老師看得到人到了
  await waitFor(t, 'text=2 個人進來了', '老師看得到兩個人都到了')
  await t.screenshot({ path: '/tmp/room-teacher.png', fullPage: true })

  // ── 按開始，兩邊自己進關卡
  console.log('── 老師按開始')
  await t.getByRole('button', { name: '大家一起開始' }).click()
  await waitFor(a, '.play canvas', '甲自己被帶進關卡了（沒有再按任何按鈕）')
  await waitFor(c, '.play canvas', '乙也是')
  // 手機直拿會蓋一張「請轉成橫的」，點掉才碰得到底下的東西。
  for (const pg of [a, c]) await pg.locator('.rotate').click().catch(() => {})

  await waitFor(t, 'text=/開打了.*個人打完/', '老師那邊變成「開打了」')
  await t.waitForTimeout(4000)
  const states = await t.locator('.board .rank .sc b').allInnerTexts()
  states.filter((s) => s.includes('進行中')).length === 2
    ? ok('老師看得到兩個人都在打：' + states.join('、'))
    : fail('老師看到的狀態不對：' + states.join('、'))

  // ── 中途離開就從名單上消失，老師不會一直等他
  console.log('── 甲中途離開')
  await a.locator('.leavebar button.leave').click()
  await a.locator('.confirm-btns button', { hasText: '離開' }).click()
  await waitFor(a, '.levels', '甲回到選關畫面')
  await t.waitForTimeout(5000)
  const left = await t.locator('.board .rank').count()
  left === 1 ? ok('離開的人從老師的名單上消失了，只剩 1 個')
    : fail('老師的名單上還有 ' + left + ' 個人')

  // ── 收掉
  await t.getByRole('button', { name: '結束這一場' }).click()
  await waitFor(t, '.row select', '收掉之後老師又可以開新的一場')
  await a.waitForTimeout(5000)
  const banner = await a.locator('.roomcall').count()
  banner === 0 ? ok('收掉之後學生那邊的那一條也不見了')
    : fail('那一條還掛在學生的選關畫面上')
} finally {
  await b.close()
  console.log(process.exitCode ? '\n有項目沒過' : '\n房間這一輪全過')
}
