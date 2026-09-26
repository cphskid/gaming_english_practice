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
/**
 * 每幾秒答一題。不給就是「能多快就多快」（驗接線用）。
 * 給了就是**慢慢答**，用來驗 Chuck 最在意的那件事：
 * 程度差一截的孩子會不會被打爆城堡然後就不玩了。
 *   node tools/test/play-tug.mjs http://localhost:5181/ 1 2 5
 * ＝每 5 秒答對一題（每分鐘 12 題）去打「隔壁班高手」。
 */
const PACE = process.argv[5] ? Number(process.argv[5]) : 0

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
  await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
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

  const out = await page.evaluate(async ({ accuracy, pace }) => {
    const g = window.__tug
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const log = { taps: 0, fronts: [], mySummons: 0 }

    // ---- 字牌會不會飄。Chuck 第一次試玩的第二個回報就是「一堆兵擠在一起字母會飄」。
    // 飄要量的是**方向翻轉**與**層數跳動**，不是移動量：牌子一路挪到新位子是對的，
    // 一下左一下右才是玩家抱怨的那個。順便盯住牌子數量沒有失控。
    const jit = { frames: 0, maxPlates: 0, tierFlips: 0, dirFlips: 0, overlaps: 0 }
    // ---- 城堡的血只能被「站在城堡前面的兵」啃掉。
    // 這是 Chuck 第一次試玩抓到的洞：答對那一槍會直接扣城堡，13 題就繞過整個兵推。
    // 所以每一格都檢查：血掉了的話，城堡門口一定要真的有敵兵。
    const cheat = { me: 0, foe: 0, minMe: 999, minFoe: 999 }
    let lastHp = null
    const seen = new Map()
    let stop = false
    const sample = () => {
      if (stop) return
      const list = [...g.S.targets.values()]
      jit.frames++
      const R = g.RULES, B = g.S.battle
      const hp = { me: B.castleHp.me, foe: B.castleHp.foe }
      if (lastHp) {
        for (const side of ['me', 'foe']) {
          if (hp[side] >= lastHp[side] - 1e-9) continue
          const home = side === 'me' ? R.homeMe : R.homeFoe
          const atGate = B.units.some((u) => u.side !== side && Math.abs(u.x - home) <= R.reach + 2)
          if (!atGate) cheat[side]++
        }
      }
      cheat.minMe = Math.min(cheat.minMe, hp.me); cheat.minFoe = Math.min(cheat.minFoe, hp.foe)
      lastHp = hp
      jit.maxPlates = Math.max(jit.maxPlates, list.length)
      // 疊不疊要比**畫出來的方框**，不是比層數：兩塊牌子層數一樣但本體高度
      // 差很多（城牆上的守衛 vs 地上的兵）並沒有蓋住彼此。
      const py = (t) => t.y + 4 + t.tier * g.PLATES.tierGap
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j]
          if (Math.abs(a.px - b.px) < (a.pw + b.pw) / 2 - 2 &&
              Math.abs(py(a) - py(b)) < g.PLATES.height - 2) { jit.overlaps++; i = 1e9; break }
        }
      }
      for (const t of list) {
        const prev = seen.get(t.id)
        const dir = Math.sign(Math.round((t.px - (prev?.px ?? t.px)) * 10))
        if (prev) {
          if (prev.tier !== t.tier) jit.tierFlips++
          if (dir !== 0 && prev.dir !== 0 && dir !== prev.dir) jit.dirFlips++
        }
        seen.set(t.id, { px: t.px, tier: t.tier, dir: dir || (prev?.dir ?? 0) })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

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
      await sleep(pace ? pace * 1000 : 400)
    }
    stop = true
    log.jit = jit
    log.cheat = cheat
    log.mySummons = g.S.battle.units.filter((u) => u.side === 'me').length
    log.final = {
      done: g.S.done, winner: g.S.battle.winner, reason: g.S.battle.reason,
      t: Math.round(g.S.battle.t), asked: g.S.asked, correct: g.S.correct,
      castle: { me: Math.round(g.S.battle.castleHp.me), foe: Math.round(g.S.battle.castleHp.foe) },
    }
    return log
  }, { accuracy: ACCURACY, pace: PACE })

  out.final.done ? ok(`打完了：${out.final.t} 秒、答對 ${out.final.correct}/${out.final.asked}、` +
    `城堡 ${out.final.castle.me} vs ${out.final.castle.foe}、結果 ${out.final.winner ?? '平手'}`)
    : fail('沒打完：' + JSON.stringify(out.final))

  out.final.asked > (PACE ? 8 : 20) ? ok(`題目一直出得出來（問了 ${out.final.asked} 題）`)
    : fail(`只問了 ${out.final.asked} 題，中間有卡住`)

  // 慢慢答的那一輪要驗的就這一條：程度差一截也不准被打爆城堡。
  if (PACE) {
    out.final.reason === 'time' && out.final.castle.me > 0
      ? ok(`慢慢答（每分鐘 ${Math.round(60 / PACE)} 題）也撐滿全場，城堡剩 ${out.final.castle.me}`)
      : fail(`慢慢答的孩子第 ${out.final.t} 秒就被打爆了（城堡 ${out.final.castle.me}）——他會直接不玩`)
  }

  // 前線要真的會動，不然「看著自己的兵推過去」這件事根本沒發生
  const span = Math.max(...out.fronts) - Math.min(...out.fronts)
  span > 120 ? ok(`前線真的在動（最多移動 ${span}px）`)
    : fail(`前線幾乎沒動（只有 ${span}px），推不動就不好玩`)

  // ---- 城堡的血只能被兵啃掉
  const ch = out.cheat
  ch.me + ch.foe === 0 ? ok('城堡的血只有在門口有兵的時候才掉')
    : fail(`有 ${ch.me + ch.foe} 格城堡門口沒有兵卻掉血——答對又在直接打城堡了`)

  // 「城堡的血會不會動」只有全速那一輪驗得到。慢慢答的時候前線停在中間，
  // 兩邊的兵本來就走不到對方城堡——那是對的，不是壞掉。
  if (!PACE) {
    const lowest = Math.min(ch.minMe, ch.minFoe)
    lowest < 100 ? ok(`城堡的血有在動（量到最低 ${Math.round(ch.minMe)} vs ${Math.round(ch.minFoe)}）`)
      : fail('城堡的血整場沒動過，HUD 上那兩個數字等於裝飾')
  }

  // ---- 字牌：數量要壓得住，而且不能飄
  const j = out.jit
  j.maxPlates <= 3 ? ok(`場上最多只有 ${j.maxPlates} 塊字牌`)
    : fail(`場上一度有 ${j.maxPlates} 塊字牌，會擠成一團`)
  j.overlaps === 0 ? ok('沒有兩塊字牌疊在一起過')
    : fail(`有 ${(j.overlaps / j.frames * 100).toFixed(1)}% 的畫面字牌互相蓋住`)
  const flip = (j.tierFlips + j.dirFlips) / Math.max(1, j.frames)
  flip < 0.05 ? ok(`字牌不飄（每格平均 ${flip.toFixed(3)} 次翻轉，量了 ${j.frames} 格）`)
    : fail(`字牌在飄：每格平均 ${flip.toFixed(3)} 次翻轉（層 ${j.tierFlips}／左右 ${j.dirFlips}）`)

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
