/**
 * 魔王團戰平衡量測。
 *
 * 目標（2026-09-24 定案）：**四個同程度的人打一隻魔王，大約六成勝率。**
 * 另外要看的：
 *   - 兩個人、六個人打的時候勝率不能差太多（魔王血量照人數調，但人多時小兵也多）
 *   - 程度差大的一起打自然比較難，但不能是零
 *   - 城倒了（被壓制）的人要修得回來，不能整場都在修城
 *   - 有人斷線、電腦接手，勝率不能掉到谷底
 *
 * 假想的孩子照 src/games/boss-raid/engine.ts 的作答方式打：答對開一槍、拿水晶、
 * 累積滿兵階出一隻兵，答錯把累積的結算出去，有錢就升階；三條線照時間輪流。
 *
 *   node tools/test/raid-balance.mjs              跑一輪對照表並檢查
 *   node tools/test/raid-balance.mjs --tune       掃魔王血量
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

function load() {
  const dir = mkdtempSync(join(tmpdir(), 'raid-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export * from '@/games/boss-raid/raid'
    export { LINE_IDS, LINE_COST } from '@/games/tug-of-war/battle'
    export { seeded } from '@/core/opponent'
  `)
  const out = join(dir, 'm.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const M = await load()
const DT = 1 / 30

/**
 * 打一場。rates＝每個人每分鐘答對幾題（這裡是「花一題的時間」的節奏，跟 tug-balance 一樣）。
 * dropAt：某個座位在第幾秒斷線、由電腦接手。
 */
export function raid(rates, seed, rules = {}, dropAt = null) {
  const r = { ...M.RAID, ...rules }
  const n = rates.length
  const s = M.newRaid(rates, seed, r)
  const rnd = rates.map((_, i) => M.seeded(seed * 31 + i * 7919))
  const next = rates.map((rt, i) => (60 / rt) * rnd[i]())
  const pending = rates.map(() => 0)
  const credit = rates.map(() => 0)
  const lineOf = (i, t) => M.LINE_IDS[Math.floor(t / 45 + i) % M.LINE_IDS.length]
  let downTime = 0
  while (!s.over) {
    for (let i = 0; i < n; i++) {
      if (s.seats[i].botFrom !== null) continue
      if (dropAt && dropAt.seat === i && s.t >= dropAt.t) { M.botTakeOver(s, i); continue }
      if (s.t < next[i]) continue
      next[i] += 60 / rates[i]
      const line = lineOf(i, s.t)
      credit[i] += 1
      if (credit[i] < M.LINE_COST[line]) continue
      credit[i] -= M.LINE_COST[line]
      const ok = rnd[i]() < 0.85
      const me = s.seats[i]
      if (!ok) {
        M.answer(s, i, false, -1, r)
        if (pending[i] > 0 && !me.down) M.summon(s, i, line, pending[i], r)
        pending[i] = 0
        continue
      }
      // 點三塊木牌之一：前面三隻小兵，不夠三隻的位置是魔王本人
      const front = M.frontMinions(s, 3)
      const pick = Math.floor(rnd[i]() * 3)
      const wasDown = me.down
      M.answer(s, i, true, front[pick]?.id ?? -1, r)
      if (wasDown) { pending[i] = 0; continue }
      pending[i]++
      if (pending[i] >= me.tier) { M.summon(s, i, line, me.tier, r); pending[i] = 0 }
      M.upgrade(s, i)
    }
    M.step(s, DT, r)
    downTime += s.seats.filter((x) => x.down).length * DT
  }
  return { win: s.win, reason: s.reason, t: s.t, bossLeft: s.bossHp / s.bossMax, downTime: downTime / n }
}

function many(rates, rules, N = 400, dropAt = null) {
  let win = 0, t = 0, left = 0, down = 0, castles = 0
  for (let k = 0; k < N; k++) {
    const m = raid(rates, 1000 + k, rules, dropAt)
    if (m.win) { win++; t += m.t } else left += m.bossLeft
    if (m.reason === 'castles') castles++
    down += m.downTime
  }
  return {
    win: win / N, winT: win ? t / win : 0, left: N - win ? left / (N - win) : 0,
    down: down / N, castles: castles / N,
  }
}

const pct = (x) => `${Math.round(x * 100)}%`
const CASES = [
  ['四人同程度 14', [14, 14, 14, 14]],
  ['兩人同程度 14', [14, 14]],
  ['六人同程度 14', [14, 14, 14, 14, 14, 14]],
  ['四人偏慢 10', [10, 10, 10, 10]],
  ['四人偏快 20', [20, 20, 20, 20]],
  ['四人程度差大 8/12/18/24', [8, 12, 18, 24]],
  ['兩人差大 8/20', [8, 20]],
]

if (process.argv.includes('--curve')) {
  // 每種速度要多少血，四個人才有六成勝率。newRaid 的 hpFor 照這張表內插。
  const n = Number(process.env.N ?? 4)
  for (const rate of (process.env.RATES ?? "6,8,10,14,20,26,32").split(",").map(Number)) {
    let lo = 20, hi = 9000, last = null
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2
      const m = many(Array(n).fill(rate), { ...JSON.parse(process.env.RULES ?? "{}"), hpTable: null, hpByN: [], bossHpPer: mid }, Number(process.env.SAMPLES ?? 60)); const w = m.win; last = m
      if (w > 0.6) lo = mid; else hi = mid
    }
    console.log(`rate ${rate}: ${Math.round((lo + hi) / 2)}  贏在 ${Math.round(last.winT)}s 壓制 ${Math.round(last.down)}s 全倒 ${pct(last.castles)}`)
  }
  process.exit(0)
}

if (process.argv.includes('--tune')) {
  for (const hp of (process.env.HPS ?? "1100,1300,1500").split(",").map(Number)) {
    const a = many([14, 14, 14, 14], { ...JSON.parse(process.env.RULES ?? "{}"), hpTable: null, bossHpPer: hp }, 60)
    const b = many([14, 14], { ...JSON.parse(process.env.RULES ?? "{}"), hpTable: null, bossHpPer: hp }, 60)
    const c = many([14, 14, 14, 14, 14, 14], { ...JSON.parse(process.env.RULES ?? "{}"), hpTable: null, bossHpPer: hp }, 60)
    console.log(`bossHpPer ${hp}: 四人 ${pct(a.win)} ${Math.round(a.winT)}s 剩${pct(a.left)} 壓制${Math.round(a.down)}  兩人 ${pct(b.win)} ${Math.round(b.winT)}s  六人 ${pct(c.win)} ${Math.round(c.winT)}s`)
  }
  process.exit(0)
}

const rows = {}
for (const [name, rates] of CASES) {
  const m = many(rates)
  rows[name] = m
  console.log(`${name.padEnd(22)} 勝率 ${pct(m.win).padStart(4)}  贏的時候 ${Math.round(m.winT)} 秒` +
    `  輸的時候魔王剩 ${pct(m.left)}  平均每人被壓制 ${Math.round(m.down)} 秒  全員城倒 ${pct(m.castles)}`)
}
const drop = many([14, 14, 14, 14], {}, 400, { seat: 0, t: 40 })
console.log(`四人、一人第 40 秒斷線電腦接手  勝率 ${pct(drop.win)}`)

const fails = []
const four = rows['四人同程度 14'].win
if (four < 0.5 || four > 0.7) fails.push(`四人同程度勝率 ${pct(four)}，目標六成（五成到七成）`)
for (const k of ['兩人同程度 14', '六人同程度 14']) {
  if (Math.abs(rows[k].win - four) > 0.2) fails.push(`${k} 勝率 ${pct(rows[k].win)}，跟四人差太多`)
}
// 快的一隊不能明顯比較難贏（差一成以內算量測誤差：勝負只差魔王最後幾滴血，很敏感）
if (rows['四人偏快 20'].win < four - 0.1) fails.push('快的一隊反而比較難贏')
if (rows['四人程度差大 8/12/18/24'].win < 0.15) fails.push('程度差大的一隊幾乎贏不了')
for (const [k, m] of Object.entries(rows)) {
  if (m.down > 60) fails.push(`${k}：平均每人被壓制 ${Math.round(m.down)} 秒，太久了`)
}
if (drop.win < four - 0.25) fails.push(`有人斷線勝率掉到 ${pct(drop.win)}`)
if (fails.length) {
  console.log('\n不合格：\n  ' + fails.join('\n  '))
  process.exit(1)
}
console.log('\n平衡檢查通過')
