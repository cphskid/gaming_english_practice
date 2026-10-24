/**
 * 新怪、新塔、塔升級之後的難度量測（2026-10-24，「讓守護異世界玩法更有變化」串）。
 *
 * 跟 job-balance.mjs 同一個做法：把 engine.ts 的戰鬥規則搬成無畫面的模型，
 * 讓一個「每分鐘答對 N 題、正確率 85%」的假想玩家跑八十五關，量「通關門檻」。
 * 這一支多模擬了 data/enemies.ts 的六種怪與魔王招式、data/towers.ts 的新塔與升級。
 *
 * 比三種玩家（都不職業，跟 levels.ts 當初設計的基準比）：
 *   只蓋箭塔   ＝完全不理新東西的玩家：新怪會讓他變難多少
 *   箭塔＋升級 ＝塔位蓋滿之後把水晶拿去升級
 *   全部       ＝升級＋照關卡解鎖的新塔（每三座換一座新塔）
 *
 *   node tools/test/variety-balance.mjs              八十五關三種玩家
 *   node tools/test/variety-balance.mjs --base FILE   跟舊版 job-balance.mjs 的輸出比（第一欄「基準」）
 *
 * levels.ts 的 VARIETY_HP 就是拿這支調的：目標是「箭塔＋升級」貼著舊基準，
 * 「只蓋箭塔」不要比舊基準難太多。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

function loadData() {
  const dir = mkdtempSync(join(tmpdir(), 'variety-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export { LEVELS } from '@/data/levels'
    export * from '@/data/towers'
    export * from '@/data/enemies'
  `)
  const out = join(dir, 'data.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const D = await loadData()
const { LEVELS, TOWERS, CRYSTAL, FOCUS_STEP, FOCUS_MAX, HERO, UPGRADE, ENEMIES, SHAMAN, SLIME_CHILD_HP, SLIME_CHILD_SPEED, BOSS_SKILL } = D

const ENTER_X = 40
const LINE_SPACING = 95
const SOLO_GRACE = 0.4
const ANSWER_COOLDOWN = 0.3
const DT = 1 / 30

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
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function rankSlots(layout) {
  const pts = []
  for (const p of layout.paths) {
    const len = pathLength(p)
    for (let d = 0; d < len; d += 20) { const q = pointAt(p, d); if (q.x >= 0) pts.push(q) }
  }
  return layout.slots
    .map((s, i) => ({ i, cover: pts.reduce((n, q) => n + (Math.hypot(s.x - q.x, s.y - 20 - (q.y - 22)) <= TOWERS.archery.range ? 1 : 0), 0) }))
    .sort((a, b) => b.cover - a.cover).map((x) => x.i)
}
const upCost = (kind, lv) => lv >= 3 ? 0 : Math.round(TOWERS[kind].cost * UPGRADE.cost[lv - 1] / 5) * 5

/**
 * strategy: 'old'＝舊規則（沒有特殊怪，用來確認模型跟 job-balance 對得上）
 *           'arch'＝只蓋箭塔，'up'＝箭塔＋升級，'all'＝升級＋新塔
 */
function simulate(level, strategy, { rate, acc, seed }) {
  const rand = rng(seed)
  const layout = level.layout, rules = level.rules, paths = layout.paths
  const pathLen = paths.map(pathLength)
  const order = rankSlots(layout)
  const special = strategy !== 'old'
  const newTowers = ['frost', 'mage', 'cannon'].filter((k) => (TOWERS[k].from ?? 0) <= level.no)

  let hp = rules.castleHp, crystals = rules.startCoins, wave = 1
  const towers = []
  let enemies = [], queue = []
  let spawnGap = 0, spawnTimer = 0
  let target = null, idle = 0, cooldown = 0, answerTimer = 0
  const period = 60 / rate
  let t = 0

  const range = (tw) => TOWERS[tw.kind].range + UPGRADE.range[tw.lv - 1]
  const dmg = (tw) => TOWERS[tw.kind].damage * UPGRADE.damage[tw.lv - 1]
  const inRange = (tw, e) => { const s = layout.slots[tw.slot]; return Math.hypot(s.x - e.x, s.y - 20 - (e.y - 22)) <= range(tw) }

  const build = () => {
    for (const slot of order) {
      if (towers.some((x) => x.slot === slot)) continue
      // 「全部」：每三座換一座新塔（輪流用解鎖的種類）
      const n = towers.length
      const kind = strategy === 'all' && newTowers.length && n % 3 === 2 ? newTowers[Math.floor(n / 3) % newTowers.length] : 'archery'
      if (crystals < TOWERS[kind].cost) break
      crystals -= TOWERS[kind].cost
      towers.push({ slot, kind, lv: 1 })
    }
    if (strategy === 'up' || strategy === 'all') {
      // 塔位蓋滿了（或錢不夠蓋下一座）就升級最便宜的那座
      for (;;) {
        const full = towers.length >= layout.slots.length
        const nextCost = full ? Infinity : TOWERS.archery.cost
        const cand = towers.filter((x) => upCost(x.kind, x.lv)).sort((a, b) => upCost(a.kind, a.lv) - upCost(b.kind, b.lv))[0]
        if (!cand) break
        const c = upCost(cand.kind, cand.lv)
        if (!full && crystals >= nextCost) break
        if (crystals < c) break
        crystals -= c; cand.lv++
      }
    }
  }

  const add = (o) => {
    const p = pointAt(paths[o.path], o.dist)
    const e = { chill: 0, chillF: 1, tick: 0, tick2: 0, charging: 0, shieldUsed: false, child: false, ...o, maxHp: o.hp, x: p.x, y: p.y, entered: false }
    e.shield = e.kind === 'shield'
    enemies.push(e)
    return e
  }
  const spawnNext = (headStart = 0) => {
    const s = queue.shift()
    if (!s) return
    const k = s.kind ? ENEMIES[s.kind] : null
    add({ ...s, dist: headStart, hp: Math.max(1, Math.round(s.hp * (k?.hpMul ?? 1))), speed: s.speed * (k?.speedMul ?? 1) })
  }
  const startWave = () => {
    const spec = rules.waves[Math.min(wave - 1, rules.waves.length - 1)]
    queue = []
    for (let i = 0; i < spec.count; i++)
      queue.push({ hp: spec.hp, speed: spec.speed, path: i % paths.length, boss: false, kind: special ? (spec.kinds?.[i] ?? '') : '' })
    if (rules.boss && wave === rules.waves.length)
      queue.push({ hp: rules.boss.hp, speed: rules.boss.speed, path: 0, boss: true, kind: '' })
    spawnGap = spec.gap; spawnTimer = 0
    const lead = new Map()
    for (let i = 0; i < 3; i++) {
      const path = queue[0]?.path ?? 0
      const n = lead.get(path) ?? 0
      lead.set(path, n + 1)
      spawnNext(Math.max(0, (2 - n) * LINE_SPACING))
    }
  }

  const gx = paths.reduce((n, p) => n + p[p.length - 1].x, 0) / paths.length
  const gy = paths.reduce((n, p) => n + p[p.length - 1].y, 0) / paths.length - 22
  const heroReaches = (e) => Math.hypot(gx - e.x, gy - (e.y - 22)) <= HERO.reach
  const towerCovers = (e) => towers.some((tw) => inRange(tw, e))
  const remove = (d) => { const i = enemies.indexOf(d); if (i >= 0) enemies.splice(i, 1); if (target === d) target = null }

  const volley = (e) => {
    const hits = towers.filter((tw) => inRange(tw, e))
    let base = hits.reduce((n, tw) => n + dmg(tw) * (e.boss && TOWERS[tw.kind].bossMul ? TOWERS[tw.kind].bossMul : 1), 0)
    const guard = !hits.length && heroReaches(e)
    if (guard) base += HERO.damage
    const shooters = hits.length + (guard ? 1 : 0)
    if (!shooters) return
    if (e.shield) {
      e.shield = false
      if (!(shooters >= 2 || hits.some((tw) => TOWERS[tw.kind].breaksShield))) return
    }
    const mult = 1 + FOCUS_STEP * Math.min(FOCUS_MAX, shooters - 1)
    const total = Math.round(base * mult)
    const dead = new Set()
    e.hp -= Math.max(1, total)
    if (e.hp <= 0) dead.add(e)
    for (const tw of hits) { const ch = TOWERS[tw.kind].chill; if (ch) { e.chill = ch.seconds; e.chillF = ch.factor } }
    const mages = hits.filter((tw) => TOWERS[tw.kind].splash)
    if (mages.length) {
      const sp = TOWERS.mage.splash
      const d2 = Math.max(1, Math.round(mages.reduce((n, tw) => n + dmg(tw) * sp.share, 0) * mult))
      enemies.filter((o) => o !== e && o.entered).map((o) => ({ o, d: Math.hypot(o.x - e.x, o.y - e.y) }))
        .filter((x) => x.d <= sp.radius).sort((a, b) => a.d - b.d).slice(0, sp.max)
        .forEach(({ o }) => { o.hp -= d2; if (o.hp <= 0) dead.add(o) })
    }
    for (const d of dead) {
      crystals += d.boss ? CRYSTAL.perKill * 5 : CRYSTAL.perKill
      remove(d)
      if (d.kind === 'slime' && !d.child) {
        for (const off of [14, -20]) {
          const c = add({ kind: 'slime', hp: Math.max(1, Math.round(d.maxHp * SLIME_CHILD_HP)), speed: d.speed * SLIME_CHILD_SPEED, path: d.path, boss: false, dist: Math.max(0, d.dist + off) })
          c.child = true; c.shield = false
        }
      }
    }
  }

  const bossSkills = (b) => {
    const sk = rules.boss?.skills ?? []
    if (!special || !b.entered) return
    if (sk.includes('summon') && (b.tick += DT) >= BOSS_SKILL.summonEvery && enemies.length < 9) {
      b.tick = 0
      const spec = rules.waves[Math.min(wave - 1, rules.waves.length - 1)]
      for (let i = 0; i < 2; i++) add({ kind: 'wolf', hp: Math.max(1, Math.round(spec.hp * ENEMIES.wolf.hpMul)), speed: spec.speed * ENEMIES.wolf.speedMul, path: b.path, boss: false, dist: Math.max(0, b.dist - 40 - i * 45) })
    }
    if (sk.includes('charge')) {
      if (b.charging > 0) b.charging -= DT
      else if ((b.tick2 += DT) >= BOSS_SKILL.chargeEvery) { b.tick2 = 0; b.charging = BOSS_SKILL.chargeSeconds }
    }
    if (sk.includes('shield') && !b.shieldUsed && b.hp <= b.maxHp / 2) { b.shieldUsed = true; b.shield = true }
  }

  build(); startWave()
  while (t < 25 * 60) {
    t += DT
    if (cooldown > 0) cooldown -= DT
    if (queue.length) {
      spawnTimer -= DT
      if (spawnTimer <= 0) { spawnNext(); spawnTimer = enemies.length < 2 ? Math.min(spawnGap, 0.8) : spawnGap }
    }
    for (const e of [...enemies]) {
      if (e.chill > 0) e.chill -= DT
      if (special && e.kind === 'shaman' && e.entered && (e.tick += DT) >= SHAMAN.every) {
        e.tick = 0
        for (const o of enemies) if (o !== e && Math.hypot(o.x - e.x, o.y - e.y) <= SHAMAN.radius) o.hp = Math.min(o.maxHp, o.hp + Math.max(1, Math.round(o.maxHp * SHAMAN.heal)))
      }
      if (e.boss) bossSkills(e)
      e.dist += e.speed * (e.chill > 0 ? e.chillF : 1) * (e.charging > 0 ? BOSS_SKILL.chargeSpeed : 1) * DT
      const p = pointAt(paths[e.path], e.dist)
      e.x = p.x; e.y = p.y
      if (!e.entered && e.x > ENTER_X) e.entered = true
      if (e.dist >= pathLen[e.path]) { hp -= e.boss ? 3 : 1; remove(e) }
    }
    if (!target) {
      idle += DT
      const ready = enemies.filter((e) => e.entered)
      if (ready.length && (ready.length >= 2 || idle >= SOLO_GRACE)) {
        const danger = ready.filter((e) => heroReaches(e) && !towerCovers(e))
        // 聰明一點的玩家：有狼或巫師先打牠們（題目是系統出的，這裡只模擬「出題優先順序」不變，所以照舊亂數）
        target = danger.length
          ? danger.reduce((a, b) => (Math.hypot(gx - a.x, gy - a.y) <= Math.hypot(gx - b.x, gy - b.y) ? a : b))
          : ready[(rand() * ready.length) | 0]
        idle = 0
      }
    }
    answerTimer += DT
    if (target && cooldown <= 0 && answerTimer >= period) {
      answerTimer = 0; cooldown = ANSWER_COOLDOWN
      if (rand() < acc) { crystals += CRYSTAL.perCorrect; volley(target) }
      target = null
    }
    if (hp <= 0) return { win: false }
    if (!queue.length && !enemies.length) {
      if (wave >= rules.waves.length) return { win: true, hp }
      wave++; crystals += CRYSTAL.perWave; target = null
      build(); startWave()
    }
  }
  return { win: false, stalled: true }
}

function threshold(level, strategy, acc = 0.85) {
  for (let rate = 8; rate <= 80; rate++) {
    let wins = 0
    for (let s = 0; s < 10; s++) if (simulate(level, strategy, { rate, acc, seed: 1000 + s * 7 }).win) wins++
    if (wins >= 8) return rate
  }
  return Infinity
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

// 舊版基準：job-balance.mjs 舊輸出的「基準」那一欄（關卡編號 → 門檻）
let oldBase = null
const bi = process.argv.indexOf('--base')
if (bi > 0) {
  oldBase = new Map()
  for (const line of readFileSync(process.argv[bi + 1], 'utf8').split('\n')) {
    const m = line.match(/^(\d+)\.\s.*?\s+(\d+)\s+\S+\s+\S+\s*$/)
    if (m) oldBase.set(Number(m[1]), Number(m[2]))
  }
}

// --only 24,25：只量這幾關；環境變數 OFF=slime,shield：把這幾種怪換回一般哥布林（找出哪一種讓關卡變難）
const oi = process.argv.indexOf('--only')
const only = oi > 0 ? new Set(process.argv[oi + 1].split(',').map(Number)) : null
const off = new Set((process.env.OFF || '').split(',').filter(Boolean))
if (off.size) for (const lv of LEVELS) for (const w of lv.rules.waves) if (w.kinds) w.kinds = w.kinds.map((k) => (off.has(k) ? '' : k))
if (off.has('boss')) for (const lv of LEVELS) if (lv.rules.boss) lv.rules.boss.skills = []
const cols = ['arch', 'up', 'all']
const rows = LEVELS.filter((lv) => !only || only.has(lv.no)).map((lv) => ({ lv, base: oldBase?.get(lv.no) ?? threshold(lv, 'old'), ...Object.fromEntries(cols.map((c) => [c, threshold(lv, c)])) }))
console.log('每一關要「每分鐘答對幾題」才打得過（正確率 85%，十次過八次）')
console.log('基準＝舊版（沒有新怪新塔）；只蓋箭塔／箭塔＋升級／全部＝新版三種玩家\n')
console.log('關卡                  基準  只箭塔  ＋升級    全部')
const f = (x) => (isFinite(x) ? String(x) : '打不過').padStart(7)
for (const r of rows) console.log((`${r.lv.no}. ${r.lv.name}${r.lv.isBoss ? ' 👑' : ''}`).padEnd(20, ' ') + String(r.base).padStart(5) + f(r.arch) + f(r.up) + f(r.all))
for (const ch of [1, 2, 3]) {
  const rs = rows.filter((r) => r.lv.chapter === ch)
  const d = (c) => { const xs = rs.map((r) => r[c] - r.base); return xs.every(isFinite) ? (mean(xs) >= 0 ? '+' : '') + mean(xs).toFixed(2) : '∞' }
  console.log(`第${ch}章 平均差：只箭塔 ${d('arch')}　＋升級 ${d('up')}　全部 ${d('all')}`)
}
const all = (c) => { const xs = rows.map((r) => r[c] - r.base); return xs.every(isFinite) ? mean(xs) : Infinity }
console.log(`\n全部平均差：只箭塔 ${all('arch').toFixed(2)}　＋升級 ${all('up').toFixed(2)}　全部 ${all('all').toFixed(2)} 題／分`)
console.log(`最難那關（跟基準比）：只箭塔 +${Math.max(...rows.map((r) => r.arch - r.base))}　＋升級 +${Math.max(...rows.map((r) => r.up - r.base))}`)
