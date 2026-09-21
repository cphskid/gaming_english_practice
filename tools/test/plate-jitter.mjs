/**
 * 字牌會不會飄，量出來。
 *
 * 為什麼需要這支：第 14 關三條路在轉角會合，一堆怪擠進很窄的一段 x 裡。
 * 舊的排版每一格畫面都從頭算一次，層數又是照前後順序推的，怪一超車層數就翻，
 * 牌子看起來整片在飄——而那正是玩家最需要點得到的時候。「有沒有比較穩」
 * 不該用眼睛看，所以把 plates.ts 拆成純幾何，這裡直接餵它一段轉角的軌跡。
 *
 * 做法：照 data/layouts.ts 的 triple 三條路和 data/levels.ts 第 14 關的
 * 出怪速度，讓怪走完整條路，每一格畫面各跑一次新舊兩套排版，量四件事：
 *   飄動   牌子自己移動的量，扣掉本體移動的量（本體在走，牌子跟著走不算飄）
 *   翻層   每隻怪每秒換幾次層
 *   疊到   有多少比例的畫面上有兩塊牌子蓋在一起（蓋住就點不到）
 *   偏離   牌子離本體最遠多少
 *
 *   node tools/test/plate-jitter.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

function load() {
  const dir = mkdtempSync(join(tmpdir(), 'plate-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export { LAYOUTS } from '@/data/layouts'
    export { LEVELS } from '@/data/levels'
    export { WORDS } from '@/data/words'
    export { layoutPlates, PLATE_RULES, tierY } from '@/games/tower-defense/plates'
  `)
  const out = join(dir, 'data.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node', '--loader:.json=json',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const { LAYOUTS, LEVELS, WORDS, layoutPlates, PLATE_RULES, tierY } = await load()

const R = PLATE_RULES
const ENTER_X = 40           // engine.ts：怪要完全走進畫面才算數
const LINE_SPACING = 95      // engine.ts：開場小隊的間隔
const DT = 1 / 60

const seg = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const pathLength = (pts) => pts.slice(1).reduce((n, p, i) => n + seg(pts[i], p), 0)
function pointAt(pts, dist) {
  for (let i = 1; i < pts.length; i++) {
    const s = seg(pts[i - 1], pts[i])
    if (dist <= s) {
      const t = s ? dist / s : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
               y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    dist -= s
  }
  return pts[pts.length - 1]
}

// 字牌寬度：畫布量不到，照 engine.ts 的式子用等寬近似（17px bold 約 10px 一個字母）
const plateWidth = (w) => Math.max(58, w.length * 10 + 24)

/**
 * 舊版本的排版，**只為了比較**，不要拿去用。
 * 照 git 上那一版抄：每格重算、分路線各排各的、層數照前後順序推。
 */
function layoutOld(list, paths) {
  for (const e of list) { e.px = e.x; e.tier = 0 }
  for (let lane = 0; lane < paths; lane++) {
    const lst = list.filter((e) => e.path === lane).sort((a, b) => a.x - b.x)
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < lst.length; i++) {
        const a = lst[i - 1], b = lst[i]
        const need = (a.pw + b.pw) / 2 + 6
        const gap = b.px - a.px
        if (gap < need) { const push = (need - gap) / 2; a.px -= push; b.px += push }
      }
      for (const e of lst) {
        e.px = Math.max(e.pw / 2 + 3, Math.min(R.width - e.pw / 2 - 3, e.px))
        e.px = Math.max(e.x - R.reach, Math.min(e.x + R.reach, e.px))
      }
    }
    for (let j = 1; j < lst.length; j++) {
      const p = lst[j - 1], q = lst[j]
      if (q.px - p.px < (p.pw + q.pw) / 2) q.tier = (p.tier + 1) % 3
    }
  }
}

function overlapping(list) {
  let n = 0
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (Math.abs(a.px - b.px) < (a.pw + b.pw) / 2 - 2 &&
          Math.abs(tierY(a, a.tier, R) - tierY(b, b.tier, R)) < R.height - 2) n++
    }
  }
  return n
}

/**
 * 跑一個情境，回傳四個數字。
 *
 * 情境是照引擎真的會發生的事擺的：
 *   開場小隊  三條路同時放一隊出來（engine.ts 的 LINE_SPACING 95px）
 *   轉角塞車  五隻怪還活著、前後腳走到會合處——這就是 Chuck 看到字在飄的那一幕
 *   整波      最後一波從頭跑到尾
 */
function run(which, scenario, layout, speed, seedWords) {
  const paths = layout.paths
  const lens = paths.map(pathLength)
  const live = []
  let wi = 0
  const mk = (path, dist) => {
    const w = seedWords[wi++ % seedWords.length]
    live.push({ path, dist, x: -300, y: 0, pw: plateWidth(w),
                px: 0, ptx: 0, tier: 0, laid: false, hold: 0,
                prevPx: null, prevX: null, prevTier: 0, prevDir: 0 })
  }

  let pending = []       // [時間, 路線] 還沒放出來的
  if (scenario === 'squad') {
    for (let i = 0; i < paths.length; i++) mk(i, Math.max(0, (paths.length - 1 - i) * LINE_SPACING))
  } else if (scenario === 'corner') {
    // 五隻怪前後腳走到會合處。dist 取路長減一小段，三條路都放。
    const back = [150, 190, 120, 230, 165]
    for (let i = 0; i < back.length; i++) mk(i % paths.length, lens[i % paths.length] - back[i])
  } else {
    for (let i = 0; i < 10; i++) pending.push([i * 7.2, i % paths.length])
  }

  const stat = { drift: 0, driftN: 0, flips: 0, shakes: 0, overlapFrames: 0, frames: 0, stray: 0, seen: 0 }
  let t = 0
  while ((live.length || pending.length) && t < 240) {
    while (pending.length && pending[0][0] <= t) mk(pending.shift()[1], 0)
    t += DT
    for (const e of live) {
      e.dist += speed * DT
      const p = pointAt(paths[e.path], e.dist)
      e.x = p.x; e.y = p.y
    }
    for (let i = live.length - 1; i >= 0; i--) if (live[i].dist >= lens[live[i].path]) live.splice(i, 1)

    const shown = live.filter((e) => e.x > ENTER_X)
    if (!shown.length) continue
    if (which === 'new') layoutPlates(shown, R)
    else layoutOld(shown, paths.length)

    stat.frames++
    stat.seen += shown.length
    if (overlapping(shown)) stat.overlapFrames++
    for (const e of shown) {
      stat.stray = Math.max(stat.stray, Math.abs(e.px - e.x))
      if (e.prevPx !== null) {
        // 本體自己在走，牌子跟著走不算飄。飄＝牌子相對本體的移動。
        const rel = (e.px - e.prevPx) - (e.x - e.prevX)
        stat.drift += Math.abs(rel)
        stat.driftN++
        // 「飄來飄去」講的是來回，不是移動。牌子一路挪到新位子是對的，
        // 一下左一下右才是玩家抱怨的那個。所以數的是方向翻轉幾次。
        if (Math.abs(rel) > 0.05) {
          const dir = Math.sign(rel)
          if (e.prevDir && dir !== e.prevDir) stat.shakes++
          e.prevDir = dir
        }
        if (e.tier !== e.prevTier) stat.flips++
      }
      e.prevPx = e.px; e.prevX = e.x; e.prevTier = e.tier
    }
  }
  // 每隻怪每秒幾次——不除以隻數的話，怪越多數字越大，比不出好壞
  const perEnemySec = (n) => (stat.seen ? n / (stat.seen * DT) : 0)
  return {
    drift: stat.driftN ? stat.drift / stat.driftN : 0,   // px／格
    shakes: perEnemySec(stat.shakes),
    flips: perEnemySec(stat.flips),
    overlap: stat.frames ? stat.overlapFrames / stat.frames : 0,
    stray: stat.stray,
  }
}

const level = LEVELS.find((l) => l.no === 14)
const layout = level.layout
const speed = level.rules.waves.at(-1).speed
// 固定一組字，新舊兩邊用同一份，不然比的是字長不是排版
const words = WORDS.filter((_, i) => i % 7 === 0).slice(0, 24).map((w) => w.word)

const pad = (c, n) => c + ' '.repeat(Math.max(0, n - [...c].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)))
console.log(`第 ${level.no} 關　${level.name}　三條路在 (948, 278) 附近會合，速度 ${speed}px/s`)
console.log('')
console.log('（來回、翻層都是「每隻怪每秒」）')
console.log('')
console.log(pad('情境', 12) + pad('', 6) + pad('疊到的畫面', 14) + pad('來回 次/秒', 14) +
  pad('翻層 次/秒', 14) + pad('相對移動 px/格', 18) + '最遠偏離 px')

const SCENES = [['squad', '開場小隊'], ['corner', '轉角塞車'], ['wave', '最後一波']]
const worst = { shakes: 0, flips: 0, overlap: 0 }
for (const [key, name] of SCENES) {
  for (const which of ['old', 'new']) {
    const r = run(which, key, layout, speed, words)
    console.log(pad(which === 'old' ? name : '', 12) + pad(which === 'old' ? '舊版' : '新版', 6) +
      pad((r.overlap * 100).toFixed(1) + '%', 14) + pad(r.shakes.toFixed(2), 14) +
      pad(r.flips.toFixed(2), 14) + pad(r.drift.toFixed(2), 18) + r.stray.toFixed(0))
    if (which === 'new') {
      worst.shakes = Math.max(worst.shakes, r.shakes)
      worst.flips = Math.max(worst.flips, r.flips)
      worst.overlap = Math.max(worst.overlap, r.overlap)
    }
  }
  console.log('')
}

// 門檻的意思：疊在一起是真的點不到，所以幾乎不能有；來回和翻層是「看起來在飄」，
// 一秒一次以內眼睛跟得上，手也點得到。
const fails = []
if (worst.overlap > 0.02) fails.push(`有 ${(worst.overlap * 100).toFixed(1)}% 的畫面牌子疊在一起，點不到`)
if (worst.shakes > 1.0) fails.push(`牌子每秒來回 ${worst.shakes.toFixed(2)} 次`)
if (worst.flips > 1.0) fails.push(`每隻怪每秒翻層 ${worst.flips.toFixed(2)} 次`)
if (fails.length) { for (const f of fails) console.log('✗ ' + f); process.exit(1) }
console.log('✓ 三個情境都不疊、不來回、不亂翻層')
