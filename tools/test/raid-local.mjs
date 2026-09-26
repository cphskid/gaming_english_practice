/**
 * 魔王團戰在本機（沒有後端、localStorage 版）走一遍：
 * 註冊 → 魔王團戰那一頁（手機直拿 390×844 截圖）→ 開一場私人房 → 等待室截圖 →
 * 開打（本機版有一位「練習夥伴」一開場就斷線、由電腦接手）→ 橫拿截圖戰場 →
 * 用開發掛勾答題直到打完 → 結算。
 *
 *   npx vite --port 5181 &      （不要設 VITE_SUPABASE_*，才會是本機版）
 *   node tools/test/raid-local.mjs http://localhost:5181/ /tmp/shots
 *   BOSS=golem node tools/test/raid-local.mjs …   打指定的魔王（先把三章都標成通關，稀有以上才開得了）
 */
import { chromium } from 'playwright'

const [BASE = 'http://localhost:5181/', OUT = '/tmp'] = process.argv.slice(2)
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))
page.on('response', (r) => { if (r.status() >= 400) console.log('    ' + r.status(), r.url()) })

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', 'LOCAL1')
  await page.fill('#lid', 'raidkid')
  await page.fill('#pw', 'abc123')
  await page.fill('#nick', '小勇者')
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 20000 })
  await page.locator('.jobs .job').nth(0).click()
  await page.locator('.avatars .av').nth(3).click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 20000 })
  ok('註冊好了')

  const BOSS = process.env.BOSS
  if (BOSS) {
    // 本機版的進度存在 localStorage：85 關全部標成通關，重新整理讓畫面讀進去
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((x) => x.startsWith('gep.v1.student.'))
      const id = key.slice('gep.v1.student.'.length)
      const all = Array.from({ length: 85 }, (_, i) => ({
        levelId: 'td-' + String(i + 1).padStart(2, '0'), stars: 3, bestCorrect: 20, clearedAt: Date.now(),
      }))
      localStorage.setItem('gep.v1.progress.' + id, JSON.stringify(all))
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.levels', { timeout: 20000 })
  }

  await page.getByRole('button', { name: '魔王團戰' }).click()
  await page.waitForSelector('.bossgrid')
  await page.waitForTimeout(800)
  const locked = await page.locator('.bosspick.locked').count()
  if (BOSS ? locked === 0 : locked === 15) ok(`鎖住的魔王 ${locked} 隻`)
  else fail(`鎖住的魔王 ${locked} 隻，不對`)
  const faces = await page.evaluate(() => [...document.querySelectorAll('.bossface img')]
    .map((i) => [i.getAttribute('src'), i.naturalWidth]))
  if (faces.length && faces.every(([, w]) => w > 0)) ok('魔王頭像都載得到')
  else fail('魔王頭像載不到：' + JSON.stringify(faces.slice(0, 2)))
  await page.screenshot({ path: `${OUT}/raid-list.png`, fullPage: true })
  ok('魔王團戰那一頁出來了（raid-list.png）')

  if (BOSS) await page.locator('.bosspick', { has: page.locator(`img[src$="/${BOSS}/face.png"]`) }).click()
  else await page.locator('.bosspick').nth(1).click()
  await page.getByRole('button', { name: '🔒 私人房' }).click()
  await page.fill('input.pin', '0427')
  await page.getByRole('button', { name: /開一場打/ }).click()
  await page.waitForSelector('.bosscard')
  await page.waitForSelector('text=0427')
  await page.screenshot({ path: `${OUT}/raid-lobby.png`, fullPage: true })
  ok('等待室出來了，看得到密碼（raid-lobby.png）')

  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: /大家一起開打/ }).click()
  await page.waitForSelector('.td-cv', { timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/raid-intro.png` })
  await page.waitForTimeout(3500)
  ok('進到戰場了')

  // 答題：九成答對，照畫面上正在問的那一塊點
  let shots = 0
  const t0 = Date.now()
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => {
      const r = window.__raid
      if (!r) return null
      const tr = r.truth()
      return { over: tr.over, t: tr.t, target: r.target(), ids: r.ids(), line: r.S.line, boss: tr.bossHp }
    })
    if (!st) { await page.waitForTimeout(300); continue }
    if (st.over) break
    if (st.target) {
      const right = Math.random() < 0.9
      const id = right ? st.target : st.ids.find((x) => x !== st.target) ?? st.target
      await page.evaluate((x) => window.__raid.tapId(x), id)
    }
    if (st.t > 25 && shots === 0) { shots++; await page.screenshot({ path: `${OUT}/raid-fight.png` }) }
    if (shots < 9 && await page.evaluate(() => window.__raid.truth().enraged)) {
      shots = 9
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/raid-enraged.png` })
      ok('神話魔王半血變身了（raid-enraged.png）')
    }
    if (st.t > 70 && shots === 1) {
      shots++
      await page.evaluate(() => window.__raid.setLine('spell'))
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/raid-spell.png` })
      await page.evaluate(() => window.__raid.setLine('recognize'))
    }
    await page.waitForTimeout(350)
  }
  const end = await page.evaluate(() => window.__raid?.truth())
  console.log('    結果：', JSON.stringify({ win: end?.win, t: Math.round(end?.t ?? 0), boss: end?.bossHp }))
  await page.waitForSelector('.result', { timeout: 30000 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${OUT}/raid-result.png`, fullPage: true })
  ok('結算畫面出來了（raid-result.png）')
} catch (e) {
  fail(String(e))
  await page.screenshot({ path: `${OUT}/raid-error.png` }).catch(() => {})
} finally {
  await b.close()
}
