/**
 * 真人即時對戰：兩個學生、兩個分頁（＝兩支手機），在本機版真的打一場。
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5177
 *   node tools/test/live-e2e.mjs http://localhost:5177/ [截圖資料夾]
 *
 * 本機版的「伺服器」是同一個瀏覽器的 localStorage，所以兩個分頁一定要在同一個 context；
 * 每個分頁登入誰記在自己的 sessionStorage（見 net/local.ts 的 sessionOf）。
 *
 * 驗的事：
 *   1. 邀請：小乙在「在線同學」看到小甲、按邀請，小甲那邊跳出邀請、按接受，兩邊同時開打
 *   2. 打完整整三分鐘，兩個分頁的戰場**每一秒都一模一樣**，結算的輸贏剛好相反
 *   3. 戰績兩邊都記成真人（student）
 *   4. 隨機對戰：兩個人都按隨機對戰就配在一起
 *   5. 中途有人離開：另一邊改打分身、這場不算真人
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5177/'
const SHOTS = process.argv[3] || ''

let bad = 0
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.log('  ✗ ' + m); bad = 1; process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const A = await ctx.newPage()
const B = await ctx.newPage()
const errors = []
for (const p of [A, B]) p.on('pageerror', (e) => errors.push(String(e)))
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }) }

async function signUp(page, nick, avatar) {
  const id = 'zz' + Math.random().toString(36).slice(2, 8)
  // 別的分頁登入的人記在共用的那一格，這個分頁要當另一個人，先把它清掉
  await page.goto(BASE)
  await page.evaluate(() => localStorage.removeItem('gep.v1.session'))
  await page.goto(BASE)
  await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', nick)
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 30000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').nth(avatar).click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 30000 })
}

async function toVersus(page) {
  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-seek', { timeout: 15000 })
}

async function toField(page) {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  if (await page.locator('.rotate').isVisible()) await page.locator('.rotate').click().catch(() => {})
}

/** 在這個分頁一直答題，直到打完或 secs 秒到。acc＝點對的機率。 */
function play(page, secs, acc) {
  return page.evaluate(async ({ secs, acc }) => {
    const g = window.__tug
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const t0 = Date.now()
    let n = 0
    let spelled = 0
    let label = ''
    while (Date.now() - t0 < secs * 1000 && !g.S.done) {
      if (!label && Date.now() - t0 > 3000) label = document.querySelector('.tw-foe')?.textContent ?? ''
      const sp = g.S.spell
      if (g.S.line === 'spell' && sp.word) {
        // 拼字線：照順序點字母磚把字拼完
        const need = sp.word.word.toLowerCase()
        const i = sp.bank.findIndex((t) => !t.used && t.ch === need[sp.filled])
        if (i >= 0) g.tapLetter(i)
        if (sp.filled === 0 && ++spelled > 2) g.setLine('recognize')
        await sleep(250)
        continue
      }
      const ids = g.ids()
      if (g.S.target && ids.length) {
        const wrong = ids.find((x) => x !== g.S.target)
        g.tapId(Math.random() < acc || !wrong ? g.S.target : wrong)
        n++
        if (n === 8) g.setLine('spell')
        if (n % 15 === 0) g.buyTier()
      }
      await sleep(700 + Math.random() * 500)
    }
    return { n, spelled, done: g.S.done, t: Math.round(g.S.battle.t), vis: document.visibilityState, label, tier: g.S.battle.tier.me }
  }, { secs, acc })
}

async function dismissStamps(page) {
  for (let i = 0; i < 5 && await page.locator('.stamp-back').count(); i++) {
    await page.locator('.stamp-back').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(300)
  }
}

try {
  await signUp(A, '小甲', 3)
  await signUp(B, '小乙', 3)
  const who = await Promise.all([A, B].map((p) => p.evaluate(() => sessionStorage.getItem('gep.v1.session'))))
  who[0] && who[1] && who[0] !== who[1] ? ok('兩個分頁各自登入不同的學生') : fail('兩個分頁是同一個人：' + who)

  // ---- 1. 邀請
  await toVersus(A)
  await toVersus(B)
  await B.waitForSelector('.vs-person', { timeout: 10000 })
  const seen = (await B.locator('.vs-live').innerText()).replace(/\s+/g, ' ')
  seen.includes('小甲') ? ok('小乙在「在線同學」看得到小甲') : fail('看不到小甲：' + seen)
  await shot(B, '01-在線同學')
  await B.locator('.vs-person', { hasText: '小甲' }).getByRole('button', { name: '邀請' }).click()
  await A.waitForSelector('.vs-invite', { timeout: 8000 })
  ;(await A.locator('.vs-invite').innerText()).includes('小乙') ? ok('小甲那邊跳出「小乙邀你對戰」') : fail('邀請沒顯示')
  await shot(A, '02-收到邀請')
  await A.locator('.vs-invite').getByRole('button', { name: '接受' }).click()
  await Promise.all([toField(A), toField(B)])
  ok('按接受之後兩邊都進了戰場')

  const seats = await Promise.all([A, B].map((p) => p.evaluate(() => window.__tug.liveOn())))
  seats.every(Boolean) ? ok('兩邊都是真人對戰模式') : fail('不是真人對戰：' + seats)

  // ---- 2. 打滿三分鐘，兩邊同一格的戰場要一模一樣
  const [ra, rb] = await Promise.all([play(A, 200, 0.9), play(B, 200, 0.7),
    A.waitForTimeout(40000).then(() => shot(A, '03-戰場-小甲')),
    B.waitForTimeout(41000).then(() => shot(B, '03-戰場-小乙'))])
  console.log(`    小甲答了 ${ra.n} 題、拼了 ${ra.spelled} 字、升到 ${ra.tier} 階；小乙 ${rb.n} 題、${rb.spelled} 字、${rb.tier} 階（${ra.vis}/${rb.vis}）`)
  ra.n > 60 && rb.n > 60 ? ok('兩邊整場都一直在答題') : fail('答題數太少')
  ra.done && rb.done ? ok(`兩邊都打到結束（第 ${ra.t}／${rb.t} 秒）`) : fail(`沒打完：${ra.done}/${rb.done}`)
  ra.label.includes('小乙・真人') && rb.label.includes('小甲・真人')
    ? ok('戰場上寫著對手名字和「真人」') : fail('對手標示：' + ra.label + ' / ' + rb.label)
  const [la, lb] = await Promise.all([A, B].map((p) => p.evaluate(() => window.__tug.truthLog())))
  const common = Object.keys(la).filter((k) => k in lb)
  const diff = common.filter((k) => la[k] !== lb[k])
  common.length > 150 && !diff.length
    ? ok(`兩個分頁的戰場 ${common.length} 秒全部一模一樣`)
    : fail(`比了 ${common.length} 秒，有 ${diff.length} 秒不一樣（第一個在第 ${diff[0]} 格）`)

  await Promise.all([A, B].map((p) => p.waitForSelector('.result', { timeout: 30000 })))
  const recs = await A.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('.versus.'))
    .map((k) => JSON.parse(localStorage.getItem(k))).flat().map((m) => [m.opponentKind, m.won, m.opponentName]))
  const live = recs.filter((r) => r[0] === 'student')
  live.length === 2 && !(live[0][1] && live[1][1])
    ? ok(`戰績兩邊都記成真人，輸贏：${live.map((r) => (r[1] ? '贏' : '沒贏')).join('／')}`)
    : fail('戰績不對：' + JSON.stringify(recs))
  await shot(A, '04-結算')

  // ---- 4. 隨機對戰
  for (const p of [A, B]) {
    await dismissStamps(p)
    await p.setViewportSize({ width: 390, height: 844 })
    await p.getByRole('button', { name: '再來一場' }).click()
    await p.waitForSelector('.vs-seek', { timeout: 15000 })
  }
  await A.locator('.vs-seek').click()
  await A.waitForTimeout(300)
  await shot(A, '05-配對中')
  ;(await A.locator('.vs-seek').innerText()).includes('配對中') ? ok('按了隨機對戰：顯示配對中和倒數') : fail('沒顯示配對中')
  await B.locator('.vs-seek').click()
  await Promise.all([toField(A), toField(B)])
  ok('兩個人都按隨機對戰，配在一起開打')

  // ---- 5. 打一下小甲就離開，小乙那邊改打分身
  await Promise.all([play(A, 8, 0.9), play(B, 8, 0.8)])
  await A.locator('.leave').click()
  await A.getByRole('button', { name: '離開', exact: true }).click()
  await A.waitForSelector('.levels', { timeout: 20000 })
  await B.waitForFunction(() => !window.__tug.liveOn(), null, { timeout: 10000 })
  const lab = await B.evaluate(() => document.querySelector('.tw-foe')?.textContent ?? '')
  lab.includes('小甲的分身') ? ok('小甲離開，小乙那邊改打小甲的分身：' + lab) : fail('沒改打分身：' + lab)
  await shot(B, '06-斷線接手')
  await B.evaluate(() => { window.__tug.S.battle.t = window.__tug.RULES.seconds - 0.05 })
  await B.waitForSelector('.result', { timeout: 30000 })
  const last = await B.evaluate(() => {
    const me = sessionStorage.getItem('gep.v1.session').replace(/"/g, '')
    return JSON.parse(localStorage.getItem('gep.v1.versus.' + me)).at(-1).opponentKind
  })
  last === 'ghost' ? ok('那一場記成打分身，不算真人戰旗') : fail('記成了 ' + last)

  errors.length ? fail('畫面有錯誤：' + errors.join(' / ')) : ok('沒有畫面錯誤')
} catch (e) {
  fail('測試自己炸了：' + (e?.message ?? e))
  await shot(A, 'xx-A').catch(() => {})
  await shot(B, 'xx-B').catch(() => {})
} finally {
  await b.close()
}
if (!bad) console.log('真人對戰：全部通過')
