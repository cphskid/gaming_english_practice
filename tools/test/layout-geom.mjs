/**
 * 佈局幾何檢查。
 *
 * 十四關各有一張自己的佈局之後，用眼睛一張一張看會漏。會漏掉的是這幾種：
 * 路走到海裡、塔蓋在路中間（塔會壓住怪和字牌）、塔位離所有路都太遠（等於白給）、
 * 路穿過高地（怪會從石壁上飛過去）、樹和石頭長在路上。
 *
 * 還有一件更重要的事：**難度是從佈局算出來的**（見 src/data/levels.ts）。
 * 路的長度決定每題有幾秒、塔的涵蓋數決定怪的血。所以換佈局＝換難度。
 * 這支工具把每張圖的「畫面內路長」和「齊射傷害」印出來，確認新的十四張
 * 沒有偏離原本驗證過的那三張太遠。
 *
 *   node tools/test/layout-geom.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

/** 引擎裡的常數，改了這裡也要跟著改（engine.ts 的 W/H/TILE） */
const TILE = 64
const W = 1088

function load() {
  const dir = mkdtempSync(join(tmpdir(), 'layout-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export * from '@/data/layouts'
    export * from '@/data/towers'
    export { LEVELS } from '@/data/levels'
  `)
  const out = join(dir, 'm.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const M = await load()
const { LAYOUTS, LEVELS, TOWERS, FOCUS_STEP, FOCUS_MAX } = M

const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function pathLength(pts) {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += hyp(pts[i], pts[i - 1])
  return L
}

function pointAtDist(pts, dist) {
  for (let i = 1; i < pts.length; i++) {
    const seg = hyp(pts[i], pts[i - 1])
    if (dist <= seg) {
      const t = seg ? dist / seg : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    dist -= seg
  }
  return pts[pts.length - 1]
}

/** 只取畫面內的點。畫面外那一段沒有塔打得到，算進去難度會算錯。 */
function visiblePoints(pts, step = 8) {
  const out = []
  const len = pathLength(pts)
  for (let d = 0; d < len; d += step) {
    const p = pointAtDist(pts, d)
    if (p.x >= 0) out.push(p)
  }
  return out
}

/** 跟 levels.ts 的 volleyOf 同一套算法。兩邊不一樣的話，量到的就不是遊戲裡的難度。 */
function volleyOf(layout) {
  const counts = []
  for (const pts of layout.paths) {
    for (const p of visiblePoints(pts, 20)) {
      let n = 0
      for (const s of layout.slots) {
        if (Math.hypot(s.x - p.x, s.y - 20 - (p.y - 22)) <= TOWERS.archery.range) n++
      }
      counts.push(n)
    }
  }
  counts.sort((a, b) => a - b)
  const median = counts[Math.floor(counts.length / 2)] || 1
  const focus = 1 + FOCUS_STEP * Math.min(FOCUS_MAX, Math.max(0, median - 1))
  return Math.max(TOWERS.archery.damage, Math.round(median * TOWERS.archery.damage * focus))
}

/** 點到線段的距離。用來判斷塔或裝飾物是不是壓在路上。 */
function distToPath(p, pts) {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const dx = b.x - a.x, dy = b.y - a.y
    const L2 = dx * dx + dy * dy
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)))
  }
  return best
}

const distToAnyPath = (p, layout) => Math.min(...layout.paths.map((pts) => distToPath(p, pts)))

function inPlateau(p, pl) {
  return p.x >= pl.c0 * TILE && p.x <= (pl.c1 + 1) * TILE
    && p.y >= pl.r0 * TILE && p.y <= (pl.r1 + 1) * TILE
}

let bad = 0
const fail = (name, m) => { console.error(`  ✗ [${name}] ${m}`); bad++ }

/**
 * 路面畫出來有 54px 寬，塔的底座大約 56px。兩者半徑加起來 55，
 * 所以塔位離路心 56px 以內就會壓到路面，怪走過去會被塔蓋住。
 */
const SLOT_CLEAR = 56
/** 裝飾物比塔小，但長在路上一樣難看 */
const DECOR_CLEAR = 44

for (const [name, L] of Object.entries(LAYOUTS)) {
  const top = L.land.r0 * TILE
  const bottom = (L.land.r1 + 1) * TILE

  for (const [i, pts] of L.paths.entries()) {
    if (pts[0].x >= 0) fail(name, `第 ${i + 1} 條路的起點在畫面內（x=${pts[0].x}），開場的怪會疊在一起`)
    for (const p of visiblePoints(pts, 8)) {
      if (p.y < top || p.y > bottom) { fail(name, `第 ${i + 1} 條路走出陸地（y=${Math.round(p.y)}，陸地是 ${top}~${bottom}）`); break }
      const hit = L.plateaus.find((pl) => inPlateau(p, pl))
      if (hit) { fail(name, `第 ${i + 1} 條路穿過高地（${Math.round(p.x)},${Math.round(p.y)}）`); break }
    }
    const end = pts[pts.length - 1]
    if (hyp(end, L.castle) > 80) fail(name, `第 ${i + 1} 條路的終點離城堡 ${Math.round(hyp(end, L.castle))}px，怪會走到旁邊`)
  }

  for (const [i, s] of L.slots.entries()) {
    const d = distToAnyPath(s, L)
    if (d < SLOT_CLEAR) fail(name, `第 ${i + 1} 個塔位壓在路上（離路心 ${Math.round(d)}px）`)
    if (d > TOWERS.archery.range) fail(name, `第 ${i + 1} 個塔位離每一條路都超過射程（${Math.round(d)}px > ${TOWERS.archery.range}）`)
    if (s.x < 40 || s.x > W - 40 || s.y < top || s.y > bottom) fail(name, `第 ${i + 1} 個塔位不在陸地上（${s.x},${s.y}）`)
    if (s.hi && !L.plateaus.some((pl) => inPlateau(s, pl))) fail(name, `第 ${i + 1} 個塔位標了高地，但不在任何高地上`)
    if (!s.hi && L.plateaus.some((pl) => inPlateau(s, pl))) fail(name, `第 ${i + 1} 個塔位站在高地上卻沒標 hi`)
    for (const [j, t] of L.slots.entries()) {
      if (j > i && hyp(s, t) < 72) fail(name, `第 ${i + 1} 與第 ${j + 1} 個塔位疊在一起（相距 ${Math.round(hyp(s, t))}px）`)
    }
  }

  for (const d of L.decor) {
    if (distToAnyPath(d, L) < DECOR_CLEAR) fail(name, `裝飾物 ${d.k} 長在路上（${d.x},${d.y}）`)
  }
}

/**
 * 路太長，怪就會跑太快。
 *
 * 怪速是 levels.ts 用「路長 ÷ 希望牠在畫面上待幾秒」回推的，所以路加倍＝怪在畫面上
 * 跑得快一倍。字牌是掛在怪身上跟著滑的，小朋友要點得到就不能讓牠飛過去。
 * 原本驗證過的三張圖最長 1536，這裡抓在 2700（約每秒 160px）。
 */
const MAX_VISIBLE = 2700

// ── 難度：換佈局就是換難度，所以要看得到每張圖落在哪
console.log('\n佈局         路數  畫面內最短路  齊射傷害  塔位  高地')
for (const [name, L] of Object.entries(LAYOUTS)) {
  const shortest = Math.min(...L.paths.map((p) => visiblePoints(p, 8).length * 8))
  const longest = Math.max(...L.paths.map((p) => visiblePoints(p, 8).length * 8))
  if (longest > MAX_VISIBLE) fail(name, `路太長（畫面內 ${longest}px > ${MAX_VISIBLE}），怪會跑太快，字牌點不到`)
  console.log(`  ${name.padEnd(12)} ${String(L.paths.length).padStart(3)} ${String(shortest).padStart(12)} ${String(volleyOf(L)).padStart(9)} ${String(L.slots.length).padStart(5)} ${String(L.plateaus.length).padStart(5)}`)
}

console.log('\n關卡        佈局           每分鐘目標題數  第一波血  怪速  魔王')
for (const lv of LEVELS) {
  const layoutName = Object.entries(LAYOUTS).find(([, L]) => L === lv.layout)?.[0] ?? '?'
  const w = lv.rules.waves[0]
  console.log(`  ${String(lv.no).padStart(2)} ${lv.name.padEnd(8)} ${layoutName.padEnd(14)} ${String(11 + lv.no).padStart(12)} ${String(w.hp).padStart(9)} ${String(w.speed).padStart(5)}  ${lv.isBoss ? '是' : ''}`)
}

const used = new Set(LEVELS.map((lv) => Object.entries(LAYOUTS).find(([, L]) => L === lv.layout)?.[0]))
if (used.size !== LEVELS.length) {
  console.error(`\n  ✗ 十四關只用到 ${used.size} 張佈局，目標是一關一張`)
  bad++
}

console.log(bad ? `\n✗ ${bad} 個問題` : '\n✓ 全部通過')
process.exit(bad ? 1 : 0)
