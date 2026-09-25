/**
 * 真人對戰的同步測試：兩支「手機」各跑一份 lockstep，中間隔著一段會延遲、會抖的網路，
 * 打完一整場之後兩份戰場必須**一模一樣**（每一隻兵的位置、血量，城堡，輸贏）。
 *
 * 兩支手機的畫面更新率也故意不一樣（一支 60fps 一支忽快忽慢），因為真的教室裡
 * 就是一台新 iPhone 對一台舊平板。
 *
 *   node tools/test/lockstep-sync.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

function load() {
  const dir = mkdtempSync(join(tmpdir(), 'lock-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export * from '@/games/tug-of-war/battle'
    export * from '@/games/tug-of-war/lockstep'
    export * from '@/core/opponent'
  `)
  const out = join(dir, 'm.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const M = await load()

/**
 * 一支手機。rate＝每分鐘答對幾題；lag＝網路單程延遲的範圍（秒）。
 * 送出去的東西照「每半秒同步一次」打包，跟 net/live.ts 一樣。
 */
function phone(seat, rate, rnd) {
  const ls = new M.Lockstep()
  const side = M.SEAT_SIDE[seat]
  return {
    seat, ls, side, rnd,
    mine: [], mark: -1,
    theirs: [], theirMark: -1,
    acc: 0, nextAnswer: 1 + rnd() * 2, pending: 0, clock: 0, stalledFor: 0,
    rate,
  }
}

function view(p) {
  return p.side === 'me' ? p.ls.truth : M.mirror(p.ls.truth, null)
}

/** 這支手機的小朋友答了一題（照他畫面上看到的戰場決定打誰、要不要升階） */
function act(p) {
  const v = view(p)
  const k = p.ls.tick + 1
  const correct = p.rnd() < 0.85
  const foes = v.units.filter((u) => u.side === 'foe').sort((a, b) => a.x - b.x).slice(0, 3)
  const target = correct && foes.length ? foes[(p.rnd() * foes.length) | 0].id : -1
  p.mine.push({ k, act: 'answer', correct, target })
  const lines = ['recognize', 'listen', 'spell']
  const line = lines[Math.floor(p.clock / 40) % 3]
  if (correct) {
    p.pending++
    if (p.pending >= v.tier.me) { p.mine.push({ k, act: 'summon', line, rank: p.pending }); p.pending = 0 }
  } else if (p.pending > 0) {
    p.mine.push({ k, act: 'summon', line, rank: p.pending }); p.pending = 0
  }
  const cost = M.nextCost(v, 'me')
  if (cost !== null && v.crystal.me >= cost && p.rnd() < 0.3) p.mine.push({ k, act: 'up' })
}

function run(seed, { lagMin = 0.15, lagMax = 0.7, outage = null } = {}) {
  const rnd = M.seeded(seed)
  const A = phone(1, 14 + rnd() * 10, M.seeded(seed * 7 + 1))
  const B = phone(2, 14 + rnd() * 10, M.seeded(seed * 13 + 5))
  /** 網路上飛的包：{ at, to, moves, mark } */
  let air = []
  let now = 0
  const sent = new Map([[A, 0], [B, 0]])
  let nextSync = { A: 0.5, B: 0.73 }
  let maxStall = 0
  while (!(A.ls.truth.over && B.ls.truth.over) && now < 400) {
    // 兩支手機一幀的長度不一樣
    const dtA = 1 / 60
    const dtB = 0.01 + rnd() * 0.04
    const dt = Math.min(dtA, dtB)
    now += dt
    for (const [p, frame, key] of [[A, dtA, 'A'], [B, dtB, 'B']]) {
      if (rnd() > dt / frame) continue      // 這一格這支手機沒有畫面
      const other = p === A ? B : A
      // 收包
      for (const pk of air) if (pk.to === p && pk.at <= now) {
        for (let i = p.theirs.length; i < pk.moves.length; i++) p.theirs.push(pk.moves[i])
        p.theirMark = Math.max(p.theirMark, pk.mark)
      }
      air = air.filter((pk) => !(pk.to === p && pk.at <= now))
      // 答題
      p.clock += frame
      if (!p.ls.truth.over && p.clock >= p.nextAnswer) {
        act(p)
        p.nextAnswer = p.clock + (60 / p.rate) * (0.6 + p.rnd() * 0.8)
      }
      // 算格子
      p.ls.feed(p.side, p.mine)
      p.ls.feed(M.OTHER[p.side], p.theirs)
      p.acc = Math.min(p.acc + frame, 0.5)
      let stalled = false
      while (p.acc >= M.TICK) {
        if (!p.ls.canStep(p.theirMark)) { stalled = true; break }
        p.acc -= M.TICK
        p.ls.step()
      }
      p.mark = p.ls.tick
      p.stalledFor = stalled ? p.stalledFor + frame : 0
      maxStall = Math.max(maxStall, p.stalledFor)
      // 每半秒同步一次：把我的整串和 mark 丟上網路
      if (now >= nextSync[key]) {
        nextSync[key] = now + 0.5
        const down = outage && now > outage[0] && now < outage[1]
        if (!down) {
          const lag = lagMin + rnd() * (lagMax - lagMin)
          air.push({ at: now + lag, to: other, moves: [...p.mine], mark: p.mark })
          sent.set(p, p.mine.length)
        }
      }
    }
  }
  const snap = (p) => JSON.stringify({
    t: p.ls.truth.t, castle: p.ls.truth.castleHp, winner: p.ls.truth.winner, reason: p.ls.truth.reason,
    units: p.ls.truth.units.map((u) => [u.id, u.side, u.x, u.hp]),
  })
  return { same: snap(A) === snap(B), a: A.ls.truth, b: B.ls.truth, maxStall, movesA: A.mine.length, movesB: B.mine.length }
}

let fail = 0
const winners = { me: 0, foe: 0, null: 0 }
let worstStall = 0
for (let seed = 1; seed <= 40; seed++) {
  const r = run(seed)
  winners[String(r.a.winner)]++
  worstStall = Math.max(worstStall, r.maxStall)
  if (!r.same) { fail++; console.log(`✗ seed ${seed} 兩支手機算出來不一樣`) }
}
console.log(`一般網路 40 場：${40 - fail} 場一模一樣；勝負分布 第一位 ${winners.me}／第二位 ${winners.foe}／平手 ${winners.null}；最久停 ${worstStall.toFixed(2)} 秒`)

// 很爛的網路（單程最多 1.4 秒）與中途斷 6 秒又接回來：一樣要一模一樣，只是會停下來等
let bad = 0
for (let seed = 41; seed <= 50; seed++) {
  const r = run(seed, { lagMin: 0.3, lagMax: 1.4 })
  const r2 = run(seed + 100, { outage: [60, 66] })
  if (!r.same) { bad++; console.log(`✗ seed ${seed} 爛網路算歪了`) }
  if (!r2.same) { bad++; console.log(`✗ seed ${seed + 100} 斷線又接回來算歪了`) }
  if (seed === 41) console.log(`爛網路最久停 ${r.maxStall.toFixed(2)} 秒；斷 6 秒那場最久停 ${r2.maxStall.toFixed(2)} 秒`)
}
console.log(`爛網路／斷線 20 場：${20 - bad} 場一模一樣`)

// 對照組：不等對方（照收到的時間直接用），兩邊一定會歪——證明上面的測試抓得到歪掉
{
  const ls1 = new M.Lockstep(), ls2 = new M.Lockstep()
  ls1.feed('me', [{ k: 1, act: 'answer', correct: true, target: -1 }, { k: 1, act: 'summon', line: 'spell', rank: 1 }])
  for (let i = 0; i < 200; i++) ls1.step()
  for (let i = 0; i < 200; i++) ls2.step()
  if (JSON.stringify(ls1.truth.units) === JSON.stringify(ls2.truth.units)) { console.log('✗ 對照組沒有差別，測試抓不到歪掉'); fail++ }
}

// 作弊：沒答對就出兵、出超過上限的階，兩邊都不認
{
  const ls = new M.Lockstep()
  ls.feed('foe', [{ k: 1, act: 'summon', line: 'spell', rank: 3 }, { k: 2, act: 'answer', correct: true, target: -1 },
    { k: 2, act: 'summon', line: 'spell', rank: 3 }])
  for (let i = 0; i < 60; i++) ls.step()
  const spells = ls.truth.units.filter((u) => u.side === 'foe' && u.line === 'spell')
  if (spells.length !== 1 || spells[0].rank !== 1) { console.log('✗ 作弊的兵被收了', spells); fail++ }
  else console.log('作弊擋住：沒答對的兵不出、三階被壓回一階')
}

if (fail || bad) { console.log('失敗'); process.exit(1) }
console.log('全部通過')
