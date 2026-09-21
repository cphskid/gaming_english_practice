// 軍營診斷：每個塔位放軍營，士兵會站在哪、那一點有幾座箭塔罩得到。
// 這支是用來證明「士兵挑有火力罩得到的點」真的解決了原本的洞。
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../../src/data/layouts.ts', import.meta.url), 'utf8')
const ARCHERY_RANGE = 170
const SOLDIER_REACH = 170

// 從 layouts.ts 直接取出三份佈局的 paths 與 slots（不想為了一支診斷工具拉進 TS 編譯）
function grab(name) {
  const i = src.indexOf(`export const ${name}: Layout = {`)
  const body = src.slice(i, src.indexOf('\n}', i))
  const ENTRY = -300, TOP_Y = 230, BOT_Y = 424
  const num = (t) => Number(t.replace('ENTRY', ENTRY).replace('TOP_Y', TOP_Y).replace('BOT_Y', BOT_Y))
  const pts = (blk) => [...blk.matchAll(/\{\s*x:\s*([^,]+),\s*y:\s*([^,}]+)/g)]
    .map((m) => ({ x: num(m[1].trim()), y: num(m[2].trim()) }))
  const pathBlk = body.slice(body.indexOf('paths: ['), body.indexOf('castle:'))
  const paths = pathBlk.split('\n').filter((l) => l.includes('{ x:')).map((l) => pts(l))
  const slotBlk = body.slice(body.indexOf('slots: ['))
  return { paths, slots: pts(slotBlk.slice(0, slotBlk.indexOf(']'))) }
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
function walk(pts, step = 6) {
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    for (let d = 0; d < seg; d += step) out.push(lerp(pts[i], pts[i + 1], d / seg))
  }
  return out
}
const covers = (slots, p) =>
  slots.filter((s) => Math.hypot(s.x - p.x, s.y - 20 - (p.y - 22)) <= ARCHERY_RANGE).length

for (const name of ['twinLanes', 'longRoad', 'triple']) {
  let L
  try { L = grab(name) } catch { continue }
  if (!L.paths.length || !L.slots.length) continue
  const pathPts = L.paths.flatMap((p) => walk(p))
  let oldDead = 0, newDead = 0
  const rows = []
  L.slots.forEach((s, i) => {
    // 其他七個塔位都當成箭塔（玩家實際上會蓋滿）
    const archers = L.slots.filter((_, j) => j !== i)
    const withD = pathPts.map((p) => ({ p, d: Math.hypot(p.x - s.x, p.y - s.y), c: covers(archers, p) }))
    const nearest = withD.reduce((a, c) => (c.d < a.d ? c : a))
    const reach = withD.filter((x) => x.d <= SOLDIER_REACH && x.c > 0)
    const picked = reach.length
      ? reach.reduce((a, c) => (c.c > a.c || (c.c === a.c && c.d < a.d) ? c : a))
      : nearest
    if (nearest.c === 0) oldDead++
    if (picked.c === 0) newDead++
    rows.push(`  塔位${i}: 舊=${nearest.c}座罩得到  新=${picked.c}座`)
  })
  console.log(`\n【${name}】共 ${L.slots.length} 個塔位`)
  rows.forEach((r) => console.log(r))
  console.log(`  >> 完全沒火力罩到的塔位：舊 ${oldDead} 個 → 新 ${newDead} 個`)
}
