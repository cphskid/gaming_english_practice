/**
 * 魔王團戰的同步測試：四支「手機」各跑一份 RaidLockstep，中間隔著會延遲、會抖的網路，
 * 還有一台假伺服器照 schema.sql 的 raid_sync 規則收發、判斷線。
 * 打完之後還在場上的每一份戰場必須**一模一樣**（魔王血量、每一隻兵、每座城、輸贏）。
 *
 * 情境：
 *   1. 四個人好好打完
 *   2. 第 2 號第 50 秒 wifi 斷掉再也沒回來 → 伺服器 12 秒後判出局、電腦接手，另外三份一樣
 *   3. 第 1 號第 30 秒按離開 → 同上，但不用等 12 秒
 *   4. 第 3 號斷線 20 秒後又連回來 → 他看到自己出局、自己結束；另外三份一樣
 *
 *   node tools/test/raid-sync.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

function load() {
  const dir = mkdtempSync(join(tmpdir(), 'rsync-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export * from '@/games/boss-raid/raid'
    export * from '@/games/boss-raid/lockstep'
    export { seeded, packLive, unpackLive } from '@/core/opponent'
  `)
  const out = join(dir, 'm.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const M = await load()

/** 假伺服器：跟 raid_sync 一樣，出局的座位 mark 凍住、不再收動作 */
function server(n) {
  const seats = Array.from({ length: n }, () => ({ moves: [], mark: -1, seen: 0, final: null }))
  return {
    seats,
    sync(seat, base, batch, mark, now, left) {
      const me = seats[seat]
      if (me.final === null) {
        if (base === me.moves.length) {
          me.moves.push(...batch)
          me.mark = Math.max(me.mark, mark)
        }
        me.seen = now
        if (left) me.final = me.mark
      }
      for (const s of seats) {
        if (s.final === null && s.mark < M.DONE_MARK && now - s.seen > M.RAID_GONE_S) s.final = s.mark
      }
      return {
        mine: me.moves.length,
        gone: me.final !== null,
        seats: seats.map((s) => ({ moves: s.moves.slice(), mark: s.final ?? s.mark, final: s.final })),
      }
    },
  }
}

function phone(seat, rates, seed, rnd) {
  return {
    seat, ls: new M.RaidLockstep(rates, seed), rnd,
    mine: [], serverHas: 0, mark: -1, pendingNet: [], nextSync: 0,
    nextAnswer: 1 + rnd() * 2, pending: 0, clock: 0, out: false, left: false,
    rate: rates[seat],
  }
}

/** 這支手機的小朋友答一題 */
function act(p) {
  const s = p.ls.truth
  const me = s.seats[p.seat]
  const k = p.ls.tick + 1
  const correct = p.rnd() < 0.85
  const front = M.frontMinions(s, 3)
  const pick = front[Math.floor(p.rnd() * 3)]
  const push = (m) => p.mine.push(M.packLive(m))
  push({ k, act: 'answer', correct, target: pick ? pick.id : -1 })
  if (!correct) {
    if (p.pending > 0) push({ k, act: 'summon', line: 'recognize', rank: p.pending })
    p.pending = 0
    return
  }
  if (me.down) return
  p.pending++
  if (p.pending >= me.tier) {
    push({ k, act: 'summon', line: ['recognize', 'listen', 'spell'][Math.floor(p.rnd() * 3)], rank: me.tier })
    p.pending = 0
  }
  if (me.crystal >= 30) push({ k, act: 'up' })
}

function run(name, { seed, offline = {}, leaveAt = {} }) {
  const rates = [14, 10, 20, 16]
  const net = M.seeded(seed)
  const srv = server(rates.length)
  const phones = rates.map((_, i) => phone(i, rates, seed, M.seeded(seed * 7 + i)))
  const inflight = []   // {at, fn}
  let now = 0
  const dt = 1 / 60
  while (now < 260) {
    now += dt
    // 網路送到的
    for (let i = inflight.length - 1; i >= 0; i--) {
      if (inflight[i].at <= now) { inflight[i].fn(); inflight.splice(i, 1) }
    }
    for (const p of phones) {
      if (p.out || p.finished) continue
      const off = offline[p.seat]
      const isOff = off && now >= off[0] && now < off[1]
      if (leaveAt[p.seat] !== undefined && now >= leaveAt[p.seat] && !p.left) {
        p.left = true
        const base = p.serverHas, batch = p.mine.slice(base), mark = p.mark
        inflight.push({ at: now + 0.2, fn: () => srv.sync(p.seat, base, batch, mark, now, true) })
        p.out = true
        continue
      }
      // 畫面更新率不一樣：有的手機一格 1/60，有的忽快忽慢
      const fdt = p.seat % 2 ? dt * (0.5 + p.rnd() * 3) : dt
      p.clock += fdt
      // 答題：用自己的戰場時間
      if (!p.ls.truth.over && p.ls.truth.t >= p.nextAnswer) {
        p.nextAnswer += 60 / p.rate
        act(p)
      }
      // 打完了：最後送一次「我不會再有動作了」，別人就不用等我、也不會把我判斷線
      p.mark = p.ls.truth.over ? M.DONE_MARK : p.ls.tick
      if (p.ls.truth.over && p.serverHas === p.mine.length && p.acked) { p.finished = true; continue }
      p.ls.mine(p.seat, p.mine.map(M.unpackLive), p.mark)
      // 同步：每 0.4 秒，斷線的時候送不出去
      if (now >= p.nextSync && !p.syncing && !isOff) {
        p.nextSync = now + 0.4
        p.syncing = true
        const base = p.serverHas, batch = p.mine.slice(base), mark = p.mark
        const lag1 = 0.05 + net() * 0.6, lag2 = 0.05 + net() * 0.6
        inflight.push({ at: now + lag1, fn: () => {
          const r = srv.sync(p.seat, base, batch, mark, now, false)
          inflight.push({ at: now + lag2, fn: () => {
            p.syncing = false
            p.serverHas = Math.min(r.mine, p.mine.length)
            if (mark === M.DONE_MARK) p.acked = true
            if (r.gone) { p.out = true; return }
            r.seats.forEach((f, i) => {
              if (i !== p.seat) p.ls.feed(i, { moves: f.moves.map(M.unpackLive), mark: f.mark, final: f.final })
            })
          } })
        } })
      }
      // 戰場往前算，追上自己的時鐘
      while (p.ls.tick * M.TICK < p.clock && p.ls.canStep() && !p.ls.truth.over) p.ls.step()
    }
    if (phones.every((p) => p.out || p.finished)) break
  }
  // 被伺服器判出局的那一位（不管他知不知道）不算，他的戰場本來就跟大家不一樣
  const live = phones.filter((p) => !p.out && srv.seats[p.seat].final === null)
  const snap = (p) => JSON.stringify({ ...p.ls.truth, rng: p.ls.truth.rng })
  const ref = snap(live[0])
  const same = live.every((p) => snap(p) === ref)
  const s = live[0].ls.truth
  const ok = same && s.over && live.every((p) => p.ls.truth.over)
  const bots = s.seats.map((x, i) => (x.botFrom !== null ? `${i}號@${Math.round(x.botFrom)}s` : null)).filter(Boolean)
  console.log(`${ok ? '✓' : '✗'} ${name}：${live.length} 份戰場${same ? '一樣' : '不一樣！'}，` +
    `${s.win ? '打倒魔王' : '輸了（' + s.reason + '）'} ${Math.round(s.t)} 秒，電腦接手 ${bots.join('、') || '無'}`)
  return ok
}

let ok = true
for (const seed of [11, 12, 13]) {
  ok = run(`四人打完 seed ${seed}`, { seed }) && ok
  ok = run(`2 號第 50 秒斷線不回來 seed ${seed}`, { seed, offline: { 2: [50, 999] } }) && ok
  ok = run(`1 號第 30 秒按離開 seed ${seed}`, { seed, leaveAt: { 1: 30 } }) && ok
  ok = run(`3 號斷線 20 秒又回來 seed ${seed}`, { seed, offline: { 3: [40, 60] } }) && ok
}
if (!ok) { console.log('\n同步測試失敗'); process.exit(1) }
console.log('\n同步測試通過')
