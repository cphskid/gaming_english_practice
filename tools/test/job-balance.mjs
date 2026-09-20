/**
 * 職業平衡量測。
 *
 * 為什麼需要這支：十四關的血量與出怪間隔是用「每分鐘要答對幾題」回推的
 * （見 data/levels.ts），基準是「一發齊射打一隻」。職業改變那一發的分配，
 * 等於動到那個基準。所以 data/jobs.ts 的倍率不能憑手感訂，要量。
 *
 * 做法：把引擎的戰鬥規則搬成無畫面的模型（移動、出怪、齊射、集火、濺射、
 * 城堡扣血完全照 engine.ts），讓一個「每分鐘答對 N 題、正確率 P」的假想玩家
 * 去跑十四關，兩個職業用同一份蓋塔策略、同一組亂數種子，比較：
 *   1. 每一關要多快才打得過（通關門檻）
 *   2. 打得過的時候城堡還剩幾滴血（餘裕）
 *
 * 目標不是兩欄數字一樣，是兩個職業的**門檻差距夠小**（全關卡平均一題以內），
 * 而且各自要有自己明顯占優的關卡——不然選職業就沒有意義了。
 *
 *   node tools/test/job-balance.mjs          兩個職業跑完十四關
 *   node tools/test/job-balance.mjs --tune   掃描倍率，找門檻最接近的組合
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

// --- 把 TS 的資料檔搬進 node（只是為了讀數值，不想為此加一套建置流程）------
function loadData() {
  const dir = mkdtempSync(join(tmpdir(), 'jobbal-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export { LEVELS } from '@/data/levels'
    export { JOB_EFFECT } from '@/data/jobs'
    export { TOWERS, CRYSTAL, FOCUS_STEP, FOCUS_MAX, SOLDIER_SLOW } from '@/data/towers'
  `)
  const out = join(dir, 'data.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const { LEVELS, JOB_EFFECT, TOWERS, CRYSTAL, FOCUS_STEP, FOCUS_MAX } = await loadData()

// --- 引擎裡的常數（engine.ts 頂端）-----------------------------------------
const ENTER_X = 40
const LINE_SPACING = 95
const SOLO_GRACE = 0.4
const ANSWER_COOLDOWN = 0.3
const DT = 1 / 30

// --- 路徑 -------------------------------------------------------------------
function pathLength(pts) {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return n
}
function pointAt(pts, dist) {
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (dist <= seg) {
      const t = seg ? dist / seg : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    dist -= seg
  }
  return pts[pts.length - 1]
}

/** 亂數要可重現，不然兩個職業比的是運氣 */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 蓋塔策略：照「這個塔位沿路罩得到幾個取樣點」排序，由多到少蓋箭塔。
 * 兩個職業共用同一份排序與同一筆預算，職業才是唯一的變因。
 */
function rankSlots(layout) {
  const pts = []
  for (const p of layout.paths) {
    const len = pathLength(p)
    for (let d = 0; d < len; d += 20) {
      const q = pointAt(p, d)
      if (q.x >= 0) pts.push(q)
    }
  }
  return layout.slots
    .map((s, i) => ({
      i,
      cover: pts.reduce((n, q) => n + (Math.hypot(s.x - q.x, s.y - 20 - (q.y - 22)) <= TOWERS.archery.range ? 1 : 0), 0),
    }))
    .sort((a, b) => b.cover - a.cover)
    .map((x) => x.i)
}

/**
 * 跑一關。rate＝每分鐘答題數，acc＝正確率。
 * 回傳 { win, hp, waves, asked, correct }。
 */
function simulate(level, jobKey, { rate, acc, seed }) {
  const rand = rng(seed)
  const job = JOB_EFFECT[jobKey]
  const layout = level.layout
  const rules = level.rules
  const paths = layout.paths
  const pathLen = paths.map(pathLength)
  const order = rankSlots(layout)

  let hp = rules.castleHp
  let crystals = rules.startCoins
  let wave = 1
  let phase = 'build'
  const towers = []
  let enemies = []
  let queue = []
  let spawnGap = 0, spawnTimer = 0
  let target = null, idle = 0, cooldown = 0, answerTimer = 0
  let asked = 0, correct = 0
  const period = 60 / rate
  let t = 0

  const build = () => {
    // 有錢就蓋，照涵蓋度排序。軍營先不蓋——兩個職業都不蓋才公平，
    // 而且軍營影響的是時間不是傷害分配，放進來只會蓋掉職業的差別。
    for (const slot of order) {
      if (towers.some((x) => x.slot === slot)) continue
      if (crystals < TOWERS.archery.cost) break
      crystals -= TOWERS.archery.cost
      towers.push({ slot })
    }
  }

  const spawnNext = (headStart = 0) => {
    const s = queue.shift()
    if (!s) return
    const p = pointAt(paths[s.path], headStart)
    enemies.push({ ...s, dist: headStart, maxHp: s.hp, x: p.x, y: p.y, entered: false })
  }

  const startWave = () => {
    const spec = rules.waves[Math.min(wave - 1, rules.waves.length - 1)]
    queue = []
    for (let i = 0; i < spec.count; i++)
      queue.push({ hp: spec.hp, speed: spec.speed, path: i % paths.length, boss: false })
    if (rules.boss && wave === rules.waves.length)
      queue.push({ hp: rules.boss.hp, speed: rules.boss.speed, path: 0, boss: true })
    spawnGap = spec.gap
    spawnTimer = 0
    phase = 'battle'
    const lead = new Map()
    for (let i = 0; i < 3; i++) {
      const path = queue[0]?.path ?? 0
      const n = lead.get(path) ?? 0
      lead.set(path, n + 1)
      spawnNext(Math.max(0, (2 - n) * LINE_SPACING))
    }
  }

  /** engine.ts 的 volley()，一行一行對過 */
  const volley = (e) => {
    let base = 0, hits = 0
    for (const tw of towers) {
      const s = layout.slots[tw.slot]
      if (Math.hypot(s.x - e.x, s.y - 20 - (e.y - 22)) > TOWERS.archery.range) continue
      hits++; base += TOWERS.archery.damage
    }
    if (!hits) return
    const mult = 1 + FOCUS_STEP * Math.min(FOCUS_MAX, hits - 1)
    const total = Math.round(base * mult)
    const dead = []
    e.hp -= Math.max(1, Math.round(total * job.focus * (e.boss ? job.bossBonus : 1)))
    if (e.hp <= 0) dead.push(e)
    if (job.splash > 0 && job.splashShare > 0) {
      const near = enemies
        .filter((o) => o !== e && o.entered)
        .map((o) => ({ o, d: Math.hypot(o.x - e.x, o.y - e.y) }))
        .filter((x) => x.d <= job.splash)
        .sort((a, b) => a.d - b.d)
        .slice(0, job.splashMax)
      const dmg = Math.max(1, Math.round(total * job.splashShare))
      for (const { o } of near) {
        o.hp -= dmg
        if (o.hp <= 0) dead.push(o)
      }
    }
    for (const d of dead) {
      crystals += d.boss ? CRYSTAL.perKill * 5 : CRYSTAL.perKill
      const i = enemies.indexOf(d)
      if (i >= 0) enemies.splice(i, 1)
      if (target === d) target = null
    }
  }

  build()
  startWave()

  // 上限：十四關最長的一關也跑不到 20 分鐘，跑到這裡代表模型壞了
  while (t < 20 * 60) {
    t += DT
    if (cooldown > 0) cooldown -= DT

    if (queue.length) {
      spawnTimer -= DT
      if (spawnTimer <= 0) {
        spawnNext()
        spawnTimer = enemies.length < 2 ? Math.min(spawnGap, 0.8) : spawnGap
      }
    }

    for (const e of [...enemies]) {
      e.dist += e.speed * DT
      const p = pointAt(paths[e.path], e.dist)
      e.x = p.x; e.y = p.y
      if (!e.entered && e.x > ENTER_X) e.entered = true
      if (e.dist >= pathLen[e.path]) {
        hp -= e.boss ? 3 : 1
        const i = enemies.indexOf(e)
        if (i >= 0) enemies.splice(i, 1)
        if (target === e) target = null
      }
    }

    // 出題：場上少於兩隻要等一下，等太久就照出（engine.ts 的 pickQuestion）
    if (!target) {
      idle += DT
      const ready = enemies.filter((e) => e.entered)
      if (ready.length && (ready.length >= 2 || idle >= SOLO_GRACE)) {
        target = ready[(rand() * ready.length) | 0]
        idle = 0
        asked++
      }
    }

    // 作答
    answerTimer += DT
    if (target && cooldown <= 0 && answerTimer >= period) {
      answerTimer = 0
      cooldown = ANSWER_COOLDOWN
      if (rand() < acc) { correct++; crystals += CRYSTAL.perCorrect; volley(target) }
      target = null
    }

    if (hp <= 0) return { win: false, hp: 0, waves: wave, asked, correct }
    if (!queue.length && !enemies.length) {
      if (wave >= rules.waves.length) return { win: true, hp, waves: wave, asked, correct }
      wave++
      crystals += CRYSTAL.perWave
      target = null
      build()
      startWave()
    }
  }
  return { win: false, hp, waves: wave, asked, correct, stalled: true }
}

/** 這一關要每分鐘答對幾題才過得去（十次有八次過就算過）。 */
function threshold(level, job, acc = 0.85) {
  for (let rate = 8; rate <= 80; rate++) {
    let wins = 0
    for (let s = 0; s < 10; s++) if (simulate(level, job, { rate, acc, seed: 1000 + s * 7 }).win) wins++
    if (wins >= 8) return rate
  }
  return Infinity
}

/**
 * 基準線：沒有職業的那一發（整發打在被點到的那一隻身上）。
 * 十四關的數值就是照這個算出來的，所以兩個職業都應該貼著它，
 * 不是互相貼著——不然兩個一起變強，十四關就一起變簡單了。
 */
JOB_EFFECT.plain = { focus: 1, splash: 0, splashShare: 0, splashMax: 0, bossBonus: 1 }

function thresholds(job) {
  return LEVELS.map((lv) => threshold(lv, job))
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length }

function report() {
  const base = thresholds('plain')
  const k = thresholds('knight')
  const m = thresholds('mage')
  console.log('每一關要「每分鐘答對幾題」才打得過（正確率 85%，十次過八次）')
  console.log('基準＝沒有職業效果，也就是 data/levels.ts 當初設計的難度\n')
  console.log('關卡                基準    騎士    法師')
  LEVELS.forEach((lv, i) => {
    const name = (`${lv.no}. ${lv.name}${lv.isBoss ? ' 👑' : ''}`).padEnd(18, ' ')
    const f = (x) => (isFinite(x) ? String(x) : '打不過').padStart(8)
    console.log(name + String(base[i]).padStart(4) + f(k[i]) + f(m[i]))
  })
  const dk = k.map((x, i) => x - base[i])
  const dm = m.map((x, i) => x - base[i])
  const fin = (xs) => xs.every(isFinite)
  console.log(`\n騎士與基準的平均差 ${fin(dk) ? mean(dk).toFixed(2) : '∞'} 題／分`)
  console.log(`法師與基準的平均差 ${fin(dm) ? mean(dm).toFixed(2) : '∞'} 題／分`)
  const bossK = LEVELS.map((l, i) => [l, dk[i], dm[i]]).filter(([l]) => l.isBoss)
  console.log('\n魔王關（騎士應該要比法師好打）：')
  for (const [l, a, b] of bossK) console.log(`  ${l.no}. ${l.name}  騎士 ${a >= 0 ? '+' : ''}${a}  法師 ${isFinite(b) ? (b >= 0 ? '+' : '') + b : '打不過'}`)
  const ok = fin(dk) && fin(dm) && Math.abs(mean(dk)) <= 1.5 && Math.abs(mean(dm)) <= 1.5
  console.log(ok ? '\n✅ 兩個職業都貼著基準，十四關的難度沒被職業改掉' : '\n❌ 偏離基準太多，回去調 data/jobs.ts')
  return ok
}

/** 掃描倍率組合，找兩個職業都貼著基準的那一組。調數值的時候用。 */
function tune() {
  const base = thresholds('plain')
  const score = (job) => {
    const t = thresholds(job)
    if (!t.every(isFinite)) return null
    return mean(t.map((x, i) => x - base[i]))
  }
  console.log('騎士 focus / 魔王加成：')
  for (const [f, bb] of [[1, 1.3], [1, 1.5], [1, 1.8], [0.98, 1.5], [1.02, 1.5]]) {
    JOB_EFFECT.knight = { focus: f, splash: 0, splashShare: 0, splashMax: 0, bossBonus: bb }
    const s = score('knight')
    console.log(`  ${f}  ${bb}  ${s === null ? '打不過' : (s >= 0 ? '+' : '') + s.toFixed(2)}`)
  }
  console.log('\n法師 focus / 濺射半徑 / 濺射倍率 / 最多幾隻：')
  const rows = []
  for (const f of [0.82, 0.85, 0.88]) {
    for (const r of [130, 140, 160]) {
      for (const sh of [0.25, 0.3]) {
        for (const mx of [3]) {
          JOB_EFFECT.mage = { focus: f, splash: r, splashShare: sh, splashMax: mx, bossBonus: 1 }
          const s = score('mage')
          if (s !== null) rows.push({ f, r, sh, mx, s })
        }
      }
    }
  }
  rows.sort((a, b) => Math.abs(a.s) - Math.abs(b.s))
  for (const x of rows.slice(0, 15))
    console.log(`  ${x.f}  ${String(x.r).padStart(4)}  ${x.sh}  ${x.mx}   ${(x.s >= 0 ? '+' : '') + x.s.toFixed(2)}`)
}

if (process.argv.includes('--tune')) tune()
else process.exit(report() ? 0 : 1)
