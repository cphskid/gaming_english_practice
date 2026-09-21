/**
 * 自動打一場兵推。
 *
 * 這支驗的是**畫面上那一套真的接得起來**：出題出得出來、點得到、兵真的出去、
 * 前線會動、結算寫得對、金幣有進去。
 *
 * **它不是拿來量平衡的**：裡面的假想玩家直接讀 S.target，答得比任何小孩都快
 * （一秒兩題半），所以它每次都會把見習兵打爆。平衡是 tools/test/tug-balance.mjs
 * 的事，那支不開瀏覽器，跑的是真的每分鐘十幾題的速度。
 *
 * 本機版的 dev server 就夠了（對戰第一版不碰後端）：
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5177
 *   node tools/test/play-tug.mjs http://localhost:5177/ 0.85
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5177/'
const ACCURACY = Number(process.argv[3] ?? 0.85)
const FOE = Number(process.argv[4] ?? 0)          // 0 見習兵 / 1 同班 / 2 高手

let bad = 0
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.log('  ✗ ' + m); bad = 1; process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 844, height: 390 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  const id = 'zz' + Math.random().toString(36).slice(2, 8)
  await page.goto(BASE)
  await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', '兵推' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 30000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 30000 })
  ok('學生準備好了')

  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-foe', { timeout: 15000 })
  const menu = (await page.locator('.vs-foes').innerText()).replace(/\s+/g, ' ')
  menu.includes('電腦對手') ? ok('對手有老實寫出來是電腦：' + menu.slice(0, 40) + '…')
    : fail('沒有寫出來那是電腦：' + menu)

  await page.locator('.vs-foe').nth(FOE).click()
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(500)
  ok('進到戰場了')

  const out = await page.evaluate(async (accuracy) => {
    const g = window.__tug
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const log = { taps: 0, fronts: [], mySummons: 0 }
    const t0 = Date.now()
    while (!g.S.done && Date.now() - t0 < 210000) {
      const ids = g.ids()
      if (g.S.target && ids.length) {
        const wrong = Math.random() > accuracy
        const pick = wrong ? (ids.find((i) => i !== g.S.target) ?? g.S.target) : g.S.target
        g.tapId(pick)
        log.taps++
      }
      if (log.fronts.length < 400) log.fronts.push(Math.round(g.S.battle.front))
      await sleep(400)
    }
    log.mySummons = g.S.battle.units.filter((u) => u.side === 'me').length
    log.final = {
      done: g.S.done, winner: g.S.battle.winner, reason: g.S.battle.reason,
      t: Math.round(g.S.battle.t), asked: g.S.asked, correct: g.S.correct,
      castle: { me: Math.round(g.S.battle.castleHp.me), foe: Math.round(g.S.battle.castleHp.foe) },
    }
    return log
  }, ACCURACY)

  out.final.done ? ok(`打完了：${out.final.t} 秒、答對 ${out.final.correct}/${out.final.asked}、` +
    `城堡 ${out.final.castle.me} vs ${out.final.castle.foe}、結果 ${out.final.winner ?? '平手'}`)
    : fail('沒打完：' + JSON.stringify(out.final))

  out.final.asked > 20 ? ok(`題目一直出得出來（問了 ${out.final.asked} 題）`)
    : fail(`只問了 ${out.final.asked} 題，中間有卡住`)

  // 前線要真的會動，不然「看著自己的兵推過去」這件事根本沒發生
  const span = Math.max(...out.fronts) - Math.min(...out.fronts)
  span > 120 ? ok(`前線真的在動（最多移動 ${span}px）`)
    : fail(`前線幾乎沒動（只有 ${span}px），推不動就不好玩`)

  await page.waitForSelector('.result', { timeout: 30000 })
  const rows = (await page.locator('.result').innerText()).replace(/\s+/g, ' ')
  const has = (re) => re.test(rows)
  if (rows.includes('★')) fail('對戰不該出現星星：' + rows.slice(0, 60))
  else ok('對戰沒有星星')
  if (has(/前線推到 \d+%/)) ok('結算寫得出前線推到哪')
  else fail('結算沒寫前線：' + rows.slice(0, 80))
  if (has(/獲得銅幣\D*[1-9]/)) ok('對戰照樣拿得到金幣')
  else fail('對戰沒拿到金幣：' + rows.slice(0, 90))

  errors.length ? fail('畫面有錯誤：' + errors.join(' / ')) : ok('沒有畫面錯誤')
} catch (e) {
  fail('測試自己炸了：' + (e?.message ?? e))
} finally {
  await b.close()
  console.log(bad ? '\n有項目沒過' : '\n兵推這一輪全過')
}
