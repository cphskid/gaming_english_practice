/**
 * 分身挑戰：小甲打一場 → 小乙在同一班看得到小甲的分身 → 挑下去，戰場上真的在重播。
 *
 * 本機版就驗得了（同一個瀏覽器的 localStorage 裡兩個學生同一班）：
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5177
 *   node tools/test/ghost-e2e.mjs http://localhost:5177/ [截圖資料夾]
 *
 * 一場三分鐘太久，所以答個二十秒就把時鐘撥到最後一秒讓它結束——
 * 答題串只錄到那二十秒，剛好也驗到「分身打完了就不動」。
 * 選對手那頁用手機直式（390×844）看，戰場照遊戲本來的設計橫拿。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5177/'
const SHOTS = process.argv[3] || ''

let bad = 0
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.log('  ✗ ' + m); bad = 1; process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

async function signUp(nick) {
  const id = 'zz' + Math.random().toString(36).slice(2, 8)
  await page.goto(BASE)
  await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', nick)
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 30000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').nth(nick === '小甲' ? 1 : 3).click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 30000 })
}

/** 答 secs 秒（全對、一秒多一題），然後把時鐘撥到最後讓它結束。回傳戰場上看到的東西。 */
async function playFor(secs) {
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  if (await page.locator('.rotate').isVisible()) await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(400)
  return page.evaluate(async (secs) => {
    const g = window.__tug
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const seen = { foeMax: 0, foeUnits: 0, foeTier: 1, foeLabel: '' }
    const ids0 = new Set(g.S.battle.units.map((u) => u.id))
    const t0 = Date.now()
    let n = 0
    while (Date.now() - t0 < secs * 1000) {
      if (g.S.target && g.ids().length) { g.tapId(g.S.target); n++ }
      if (n === 6) g.setLine('listen')
      if (n === 12) g.buyTier()
      for (const u of g.S.battle.units) if (u.side === 'foe' && !ids0.has(u.id)) { ids0.add(u.id); seen.foeUnits++; seen.foeMax = Math.max(seen.foeMax, u.rank) }
      seen.foeTier = g.S.battle.tier.foe
      await sleep(350)
    }
    seen.foeLabel = document.querySelector('.tw-foe')?.textContent ?? ''
    seen.rec = g.S.rec.length
    seen.recKinds = [...new Set(g.S.rec.map((m) => m.act))].sort().join(',')
    g.S.battle.t = g.RULES.seconds - 0.05
    return seen
  }, secs)
}

try {
  // ---- 小甲打一場電腦，錄下分身
  await signUp('小甲')
  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-foe', { timeout: 15000 })
  const empty = await page.locator('.vs-ghosts').innerText()
  empty.includes('還沒有人打過') ? ok('班上沒人打過時，提示先打電腦') : fail('空名單沒提示：' + empty)
  await page.locator('.vs-foe').first().click()
  const a = await playFor(20)
  a.rec > 10 && a.recKinds === 'answer,summon,up'
    ? ok(`小甲這一場錄下 ${a.rec} 步（答題、出兵、升階都有）`)
    : fail(`錄下來的不對：${a.rec} 步、種類 ${a.recKinds}`)
  await page.waitForSelector('.result', { timeout: 30000 })
  const mine = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('.ghost.')).length)
  mine === 1 ? ok('打完存了一份分身') : fail(`存了 ${mine} 份分身`)

  // ---- 小乙同一班，挑戰小甲的分身
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.endsWith('.session')) localStorage.removeItem(k)
    sessionStorage.clear()   // 每個分頁自己記的登入（見 net/local.ts 的 sessionOf）
  })
  await signUp('小乙')
  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-ghost', { timeout: 15000 })
  const list = (await page.locator('.vs-ghosts').innerText()).replace(/\s+/g, ' ')
  list.includes('小甲的分身') ? ok('小乙看得到：' + list.slice(0, 50)) : fail('名單上沒有小甲：' + list)
  await shot('01-選對手')
  // 戰場要橫拿（直拿會跳「轉過來」的提示），選對手那頁是直的
  await page.setViewportSize({ width: 844, height: 390 })
  await page.locator('.vs-ghost').first().click()
  const c = await playFor(24)
  await shot('02-戰場')
  await page.setViewportSize({ width: 390, height: 844 })
  c.foeLabel.includes('小甲的分身') ? ok('戰場上寫著「小甲的分身」') : fail('對手標示不對：' + c.foeLabel)
  c.foeUnits >= 5 ? ok(`分身照著重播派兵（新出 ${c.foeUnits} 隻，最高 ${c.foeMax} 階）`)
    : fail(`分身幾乎沒出兵：${c.foeUnits} 隻`)
  c.foeTier === 2 ? ok('分身在同一個時間點升了階') : fail('分身沒升階：' + c.foeTier)
  await page.waitForSelector('.result', { timeout: 30000 })
  const rec = await page.evaluate(() => {
    const k = Object.keys(localStorage).filter((k) => k.includes('.versus.'))
    return k.flatMap((x) => JSON.parse(localStorage.getItem(x))).map((m) => m.opponentKind)
  })
  rec.includes('ghost') && rec.includes('cpu') ? ok('戰績記成：' + rec.join('、')) : fail('戰績不對：' + rec)
  await shot('03-結算')

  // ---- 小乙打完也有了分身；小乙自己的名單不會有自己
  // 解到新徽章會先蓋一張蓋章動畫，點掉它
  for (let i = 0; i < 5 && await page.locator('.stamp-back').count(); i++) {
    await page.locator('.stamp-back').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(300)
  }
  await page.getByRole('button', { name: '再來一場' }).click()
  await page.waitForSelector('.vs-ghost', { timeout: 15000 })
  const again = (await page.locator('.vs-ghosts').innerText()).replace(/\s+/g, ' ')
  !again.includes('小乙的分身') ? ok('自己不會出現在自己的名單上') : fail('名單上有自己：' + again)

  errors.length ? fail('畫面有錯誤：' + errors.join(' / ')) : ok('沒有畫面錯誤')
} catch (e) {
  fail('測試自己炸了：' + (e?.message ?? e))
  await shot('xx-炸了').catch(() => {})
} finally {
  await b.close()
}
if (!bad) console.log('分身挑戰：全部通過')
