/**
 * 轉彎、交叉的時候字牌會不會飄——十四張地圖全部跑一次。
 *
 * plate-jitter.mjs 只看第 14 關會合處、只量左右。Chuck 2026-09-26 又回報「怪走彎路時字牌會飄」，
 * 用手機實際跑（tools/test/plate-probe.mjs）才看到另外兩種飄法：
 *   S 形路（第 3 關）  路的上一段和下一段 y 差不多，牌子被「另一段路上」的怪推去旁邊掛著，
 *                      一換搭檔就甩到另一邊。
 *   X 形交叉（第 8 關） 兩隻怪 x 一樣、y 交錯，牌子先被拖著往反方向換層，再一口氣彈回來。
 * 所以這支除了左右，也量上下（換層），而且每張地圖都跑。
 *
 * 做法照 engine.ts：開場一次放三隻（同一條路前後差 95px），之後照間隔出怪，路線輪流；
 * 沒有人答題，怪走到城堡才消失（最擠的情況）。每張地圖跑第一波和最後一波。
 *
 *   node tools/test/plate-corners.mjs            用現在的 plates.ts
 *   PLATES=某個檔案.ts node tools/test/plate-corners.mjs   拿別版來比
 *   OLD_SPAWN=1 node tools/test/plate-corners.mjs          模擬開場第四隻疊在第三隻身上的舊行為
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const PLATES = resolve(process.env.PLATES || join(ROOT, 'src/games/tower-defense/plates.ts'))

async function load() {
  const dir = mkdtempSync(join(tmpdir(), 'plate-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export { LEVELS } from '@/data/levels'
    export { WORDS } from '@/data/words'
    export * as P from ${JSON.stringify(PLATES)}
  `)
  const out = join(dir, 'data.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node', '--loader:.json=json',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`, '--log-level=error',
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}
const { LEVELS, WORDS, P } = await load()
const R = P.PLATE_RULES
const DT = 1 / 60, ENTER_X = 40, LINE_SPACING = 95

const seg = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const pathLength = (pts) => pts.slice(1).reduce((n, p, i) => n + seg(pts[i], p), 0)
function pointAt(pts, dist) {
  for (let i = 1; i < pts.length; i++) {
    const s = seg(pts[i - 1], pts[i])
    if (dist <= s) { const t = s ? dist / s : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t } }
    dist -= s
  }
  return pts[pts.length - 1]
}
const plateWidth = (w) => Math.max(58, w.length * 10 + 24)
// 牌子畫在哪個高度：新版有 ty（換層用滑的），舊版直接用層數
const drawnY = (e) => ('ty' in e && P.plateY.length <= 1) ? P.plateY(e) : P.tierY(e, e.tier, R)

function run(level, waveIdx, words) {
  const paths = level.layout.paths
  const lens = paths.map(pathLength)
  const spec = level.rules.waves[waveIdx]
  const queue = Array.from({ length: spec.count }, (_, i) => i % paths.length)
  const live = []
  let wi = 0
  const spawn = (head = 0) => {
    const path = queue.shift(); if (path === undefined) return
    const w = words[wi++ % words.length]
    live.push({ path, dist: head, x: -300, y: 0, pw: plateWidth(w), px: 0, ptx: 0, ox: 0, ty: 0,
                tier: 0, laid: false, hold: 0, prev: null, dir: 0, acc: 0 })
  }
  const lead = new Map()
  for (let i = 0; i < 3; i++) { const p = queue[0] ?? 0; const n = lead.get(p) ?? 0; lead.set(p, n + 1); spawn(Math.max(0, (2 - n) * LINE_SPACING)) }
  // 開場小隊之後，下一隻要等小隊最後一隻走開 95px 才出來（engine.ts startWave）。
  // OLD_SPAWN=1 模擬修之前：計時器是 0，第四隻跟第三隻同一格出生，一條路的地圖上兩隻怪整路疊在一起。
  let timer = process.env.OLD_SPAWN ? 0 : LINE_SPACING / spec.speed
  const st = { seen: 0, swings: 0, jumps: 0, vmove: 0, hang: 0, ovf: 0, frames: 0 }
  for (let t = 0; (live.length || queue.length) && t < 300; t += DT) {
    timer -= DT
    if (queue.length && (timer <= 0 || live.length < 2)) { spawn(); timer = live.length < 2 ? Math.min(spec.gap, 0.8) : spec.gap }
    for (const e of live) { e.dist += spec.speed * DT; const p = pointAt(paths[e.path], e.dist); e.x = p.x; e.y = p.y }
    for (let i = live.length - 1; i >= 0; i--) if (live[i].dist >= lens[live[i].path]) live.splice(i, 1)
    const shown = live.filter((e) => e.x > ENTER_X)
    if (!shown.length) continue
    P.layoutPlates(shown, R)
    st.frames++
    let ov = false
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i], b = shown[j]
      if (Math.abs(a.px - b.px) < (a.pw + b.pw) / 2 - 2 && Math.abs(drawnY(a) - drawnY(b)) < R.height - 2) ov = true
    }
    if (ov) st.ovf++
    for (const e of shown) {
      st.seen++
      const rx = e.px - e.x, ry = drawnY(e) - e.y
      st.hang += Math.abs(rx)
      if (e.prev) {
        const dx = rx - e.prev[0], dy = ry - e.prev[1]
        st.vmove += Math.abs(dy)
        if (Math.abs(dy) > 12) st.jumps++
        // 來回：往一邊挪了 8px 以上又往回走，才算一次（慢慢挪到新位子不算）
        if (Math.abs(dx) > 0.3) {
          const s = Math.sign(dx)
          if (s === e.dir) e.acc += Math.abs(dx)
          else { if (e.dir && e.acc > 8) st.swings++; e.dir = s; e.acc = Math.abs(dx) }
        }
      }
      e.prev = [rx, ry]
    }
  }
  const sec = st.seen * DT
  return { swings: st.swings / sec * 60, jumps: st.jumps / sec * 60, vmove: st.vmove / sec, hang: st.hang / st.seen, overlap: st.ovf / Math.max(1, st.frames) }
}

// 固定一組字，每版都用同一份
const words = WORDS.filter((_, i) => i % 5 === 0).slice(0, 40).map((w) => w.word)
const rows = []
const tot = { swings: 0, jumps: 0, vmove: 0, hang: 0, overlap: 0 }
for (const level of LEVELS.filter((l) => l.no <= 14)) {
  for (const wi of [0, level.rules.waves.length - 1]) {
    const r = run(level, wi, words)
    rows.push(`${String(level.no).padStart(2)} 關 第${wi + 1}波  來回 ${r.swings.toFixed(1).padStart(4)}  瞬跳 ${r.jumps.toFixed(1).padStart(4)}  上下挪 ${r.vmove.toFixed(1).padStart(5)}px/s  平均離本體 ${r.hang.toFixed(1).padStart(4)}px  疊到 ${(r.overlap * 100).toFixed(1).padStart(4)}%`)
    for (const k in tot) tot[k] = Math.max(tot[k], r[k])
  }
}
console.log('（來回、瞬跳：每隻怪每分鐘幾次）')
console.log(rows.join('\n'))
console.log(`最差　來回 ${tot.swings.toFixed(1)}  瞬跳 ${tot.jumps.toFixed(1)}  上下挪 ${tot.vmove.toFixed(1)}  離本體 ${tot.hang.toFixed(1)}  疊到 ${(tot.overlap * 100).toFixed(1)}%`)
