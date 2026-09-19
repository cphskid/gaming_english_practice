import { FOCUS_MAX, FOCUS_STEP, TOWERS, refundOf } from '@/data/towers'
import type { GameContext, GameHandle, LevelData, Point, Word } from '@/core/types'
import { loadArt } from './art'

const W = 1088
const H = 576
const TILE = 64
const COLS = 17
const PLATE_FONT = 'bold 17px system-ui, "Segoe UI", sans-serif'
const PLATE_H = 28
const TIER_GAP = 32
const PRESS = 0.22

/** 怪要完全走進畫面才算數。這一條是第一次試玩那個「狂點就得分」漏洞的修法。 */
const ENTER_X = 40
/** 答完一題到下一題之間的冷卻，避免連點穿題 */
const ANSWER_COOLDOWN = 0.3
/**
 * 場上只剩一隻可點的怪時，等這麼久還是要出題。
 * 不等的話那隻怪永遠沒有人打得到，會直接走到城堡——高手打太快就會踩到。
 */
const SOLO_GRACE = 1.2

interface Enemy {
  word: Word
  path: number
  dist: number
  hp: number
  maxHp: number
  speed: number
  art: string
  scale: number
  boss: boolean
  frame: number
  blocked: boolean
  px: number
  pw: number
  tier: number
  press: number
  good: number
  bad: number
  shake: number
  x: number
  y: number
  /** 完全進場才可以被點、被出題 */
  entered: boolean
}

interface Soldier { x: number; y: number; path: number; dist: number; hp: number; respawn: number }
interface Tower { slot: number; kind: string; soldier: Soldier | null; builtAtWave: number }
interface Pop { x: number; y: number; text: string; color: string; life: number }
interface Ring { x: number; y: number; r: number; max: number; life: number; color: string }
interface Shot { x0: number; y0: number; x1: number; y1: number; life: number }
interface Spawn { hp: number; speed: number; art: string; path: number; boss: boolean; scale: number }

function pathLength(pts: Point[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return L
}

function pointAt(pts: Point[], dist: number): Point {
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

const SHELL = `
<div class="td-hud">
  <span class="td-stat td-hp">❤️ 20</span>
  <span class="td-stat td-coin">🪙 0</span>
  <span class="td-wave">第 1 波</span>
  <div class="td-quiz">
    <span class="td-qemoji">🛡️</span>
    <span class="td-qzh">準備防守</span>
    <span class="td-qhint">蓋好塔再開戰</span>
  </div>
  <button class="td-say" disabled aria-label="再念一次">🔊</button>
</div>
<div class="td-stage">
  <canvas class="td-cv" width="1088" height="576"></canvas>
  <div class="td-toast"></div>
  <div class="td-tray">
    <button class="td-card td-sel" data-kind="archery"><b>🏹 箭塔 <i>40</i></b><span>射程內的怪會被它射中</span></button>
    <button class="td-card" data-kind="barracks"><b>🛡️ 軍營 <i>30</i></b><span>派士兵擋路，替你爭取時間</span></button>
    <button class="td-btn td-sell" hidden>拆除</button>
    <button class="td-btn td-go">開始第 1 波</button>
  </div>
</div>`

export function mountTowerDefense(root: HTMLElement, ctx: GameContext): GameHandle {
  const level = ctx.level as LevelData
  const { layout, rules } = level
  const PATHS = layout.paths
  const PATH_LEN = PATHS.map(pathLength)
  const SLOTS = layout.slots

  root.innerHTML = SHELL
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T
  const cv = $<HTMLCanvasElement>('.td-cv')
  const c2d = cv.getContext('2d')!
  const elHp = $<HTMLElement>('.td-hp')
  const elCoin = $<HTMLElement>('.td-coin')
  const elWave = $<HTMLElement>('.td-wave')
  const elEmoji = $<HTMLElement>('.td-qemoji')
  const elZh = $<HTMLElement>('.td-qzh')
  const elHint = $<HTMLElement>('.td-qhint')
  const elSay = $<HTMLButtonElement>('.td-say')
  const elTray = $<HTMLElement>('.td-tray')
  const elGo = $<HTMLButtonElement>('.td-go')
  const elSell = $<HTMLButtonElement>('.td-sell')
  const elToast = $<HTMLElement>('.td-toast')

  let img: Record<string, HTMLImageElement> = {}
  let terrain: HTMLCanvasElement | null = null
  let raf = 0
  let dead = false

  const S = {
    phase: 'build' as 'build' | 'battle' | 'done',
    wave: 1,
    hp: rules.castleHp,
    coins: rules.startCoins,
    towers: [] as Tower[],
    enemies: [] as Enemy[],
    shots: [] as Shot[],
    pops: [] as Pop[],
    rings: [] as Ring[],
    target: null as Enemy | null,
    askedAt: 0,
    cooldown: 0,
    idle: 0,
    correct: 0,
    asked: 0,
    combo: 0,
    spawnQueue: [] as Spawn[],
    spawnTimer: 0,
    spawnGap: 3,
    picked: 'archery',
    selected: null as number | null,
    hinted: false,
    t: 0,
  }

  // ---------------------------------------------------------------- 工具
  function toast(msg: string) {
    elToast.textContent = msg
    elToast.classList.add('on')
    window.clearTimeout((elToast as HTMLElement & { _t?: number })._t)
    ;(elToast as HTMLElement & { _t?: number })._t = window.setTimeout(
      () => elToast.classList.remove('on'), 1600,
    )
  }
  function buzz(ms: number) { try { navigator.vibrate?.(ms) } catch { /* 有些瀏覽器沒有 */ } }
  function speak(t: string) {
    if (!('speechSynthesis' in window)) return
    try {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(t)
      u.lang = 'en-US'; u.rate = 0.85
      speechSynthesis.speak(u)
    } catch { /* 念不出來就算了 */ }
  }

  /** 拿一個目前畫面上還沒出現的字，避免兩隻怪同名沒辦法分辨 */
  function freshWord(): Word | null {
    const onScreen = new Set(S.enemies.map((e) => e.word.id))
    for (let i = 0; i < 8; i++) {
      const q = ctx.nextQuestion()
      if (!q) return null
      if (!onScreen.has(q.word.id)) return q.word
    }
    return ctx.nextQuestion()?.word ?? null
  }

  // ---------------------------------------------------------------- 波次
  function startWave() {
    if (S.phase !== 'build') return
    if (!S.towers.length) return toast('先蓋一座塔再開戰')

    const spec = rules.waves[Math.min(S.wave - 1, rules.waves.length - 1)]
    S.spawnQueue = []
    for (let i = 0; i < spec.count; i++) {
      S.spawnQueue.push({
        hp: spec.hp, speed: spec.speed,
        art: spec.art ?? (i % 2 ? 'goblinPurple' : 'goblinRed'),
        path: i % PATHS.length, boss: false, scale: 1,
      })
    }
    // 魔王在最後一波壓軸，單塔打不動，一定要集火
    if (rules.boss && S.wave === rules.waves.length) {
      S.spawnQueue.push({
        hp: rules.boss.hp, speed: rules.boss.speed, art: rules.boss.art,
        path: 0, boss: true, scale: rules.boss.scale,
      })
    }
    S.spawnGap = spec.gap
    S.spawnTimer = 0
    S.phase = 'battle'
    S.selected = null
    // 開頭一次放三隻，場上才有得選；只有一隻的話點哪裡都對
    for (let i = 0; i < 3; i++) spawnNext()
    ctx.audio.play('wave-start')
    if (!S.hinted) { S.hinted = true; toast('點怪物、或牠腳下的字牌，都算點到') }
    syncUI()
  }

  function spawnNext() {
    const s = S.spawnQueue.shift()
    if (!s) return
    const word = freshWord()
    if (!word) return
    const p = pointAt(PATHS[s.path], 0)
    S.enemies.push({
      word, path: s.path, dist: 0, hp: s.hp, maxHp: s.hp, speed: s.speed,
      art: s.art, scale: s.scale, boss: s.boss,
      frame: Math.random() * 7, blocked: false,
      px: 0, pw: 0, tier: 0, press: 0, good: 0, bad: 0, shake: 0,
      x: p.x, y: p.y, entered: false,
    })
  }

  /**
   * 出題。只從「完全走進畫面的怪」裡選，而且原則上要有兩隻以上可選——
   * 場上只有一隻時點哪裡都會對，那就不是在讀字了。
   *
   * 但不能無限等：等超過 SOLO_GRACE 還是只有一隻，就照樣出題，
   * 否則那隻怪沒有人打得到，會白白走到城堡。
   */
  function pickQuestion() {
    const ready = S.enemies.filter((e) => e.entered)
    if (!ready.length) { S.target = null; return syncQuiz() }
    if (ready.length < 2 && S.idle < SOLO_GRACE) {
      S.target = null
      return syncQuiz()
    }
    S.idle = 0
    S.target = ready[(Math.random() * ready.length) | 0]
    S.asked++
    S.askedAt = performance.now()
    syncQuiz()
  }

  // ---------------------------------------------------------------- 作答
  function tapEnemy(e: Enemy) {
    if (S.phase !== 'battle' || !S.target || S.cooldown > 0) return
    e.press = PRESS
    const ms = Math.round(performance.now() - S.askedAt)
    const correct = e === S.target
    S.cooldown = ANSWER_COOLDOWN

    // 遊戲只回報發生了什麼，不算錢也不算經驗——那是 core 的事
    ctx.report({ wordId: S.target.word.id, skill: 'recognize', correct, ms, combo: S.combo })

    if (correct) {
      S.correct++; S.combo++
      e.good = 0.45
      buzz(14)
      ctx.audio.play('answer-correct')
      S.rings.push({ x: e.x, y: e.y - 20, r: 16, max: 56, life: 0.42, color: '#ffe08a' })
      volley(e)
      speak(e.word.word)
    } else {
      S.combo = 0
      e.bad = 0.5; e.shake = 0.35
      buzz(55)
      ctx.audio.play('answer-wrong')
      S.pops.push({ x: e.x, y: e.y - 46, text: '✗', color: '#ffb4b0', life: 0.8 })
      pickQuestion()
    }
    syncUI()
  }

  /** 齊射：射程涵蓋到這隻怪的塔全部打它一次，同時開火的塔越多傷害越高 */
  function volley(e: Enemy) {
    const hits: Tower[] = []
    let base = 0
    for (const t of S.towers) {
      const spec = TOWERS[t.kind]
      if (!spec.damage) continue
      const s = SLOTS[t.slot]
      const ox = s.x, oy = s.y - 20
      if (Math.hypot(ox - e.x, oy - (e.y - 22)) > spec.range) continue
      hits.push(t); base += spec.damage
      S.shots.push({ x0: ox, y0: oy, x1: e.x, y1: e.y - 24, life: 0.22 })
    }

    if (!hits.length) {
      S.pops.push({ x: e.x, y: e.y - 40, text: '沒有塔打得到', color: '#ffd9a0', life: 1.2 })
      pickQuestion()
      return
    }

    ctx.audio.play('volley')
    const mult = 1 + FOCUS_STEP * Math.min(FOCUS_MAX, hits.length - 1)
    const total = Math.round(base * mult)
    e.hp -= total
    S.pops.push({ x: e.x + 18, y: e.y - 40, text: '-' + total, color: '#fff', life: 0.9 })
    if (hits.length > 1)
      S.pops.push({ x: e.x + 18, y: e.y - 22, text: '集火 ×' + mult.toFixed(1), color: '#ffd05a', life: 1 })
    if (e.hp <= 0) { ctx.audio.play('enemy-die'); killEnemy(e) }
    else ctx.audio.play('enemy-hit')
    pickQuestion()
  }

  function killEnemy(e: Enemy) {
    const i = S.enemies.indexOf(e)
    if (i >= 0) S.enemies.splice(i, 1)
    if (S.target === e) S.target = null
  }

  // ---------------------------------------------------------------- 蓋塔拆塔
  function tapSlot(idx: number) {
    if (S.phase !== 'build') return
    const existing = S.towers.find((t) => t.slot === idx)
    if (existing) {
      // 兩段式：先選取看射程，再按拆除，免得手滑就拆掉
      S.selected = S.selected === idx ? null : idx
      syncUI()
      return
    }
    S.selected = null
    const spec = TOWERS[S.picked]
    if (S.coins < spec.cost) return toast('銅幣不夠，還差 ' + (spec.cost - S.coins) + ' 枚')
    S.coins -= spec.cost
    const t: Tower = { slot: idx, kind: S.picked, soldier: null, builtAtWave: S.wave }
    if (S.picked === 'barracks') t.soldier = makeSoldier(idx)
    S.towers.push(t)
    ctx.audio.play('tower-build')
    syncUI()
  }

  function sellSelected() {
    if (S.phase !== 'build' || S.selected === null) return
    const i = S.towers.findIndex((t) => t.slot === S.selected)
    if (i < 0) return
    const t = S.towers[i]
    // 這一波還沒開打全額退，打過仗的退一半。小朋友需要能安心亂試。
    const back = refundOf(TOWERS[t.kind].cost, t.builtAtWave < S.wave)
    S.coins += back
    S.towers.splice(i, 1)
    S.selected = null
    ctx.audio.play('tower-sell')
    toast('拆掉了，退回 ' + back + ' 枚')
    syncUI()
  }

  function makeSoldier(slotIdx: number): Soldier {
    const s = SLOTS[slotIdx]
    let best: { d: number; x: number; y: number; path: number; dist: number } | null = null
    PATHS.forEach((pts, pi) => {
      for (let d = 0; d < PATH_LEN[pi]; d += 6) {
        const p = pointAt(pts, d)
        const dd = Math.hypot(p.x - s.x, p.y - s.y)
        if (!best || dd < best.d) best = { d: dd, x: p.x, y: p.y, path: pi, dist: d }
      }
    })
    const b = best!
    return { x: b.x, y: b.y, path: b.path, dist: b.dist, hp: TOWERS.barracks.soldierHp!, respawn: 0 }
  }

  // ---------------------------------------------------------------- 每幀
  function update(dt: number) {
    S.t += dt
    if (S.cooldown > 0) S.cooldown -= dt

    if (S.phase === 'battle') {
      S.spawnTimer -= dt
      if (S.spawnQueue.length && S.spawnTimer <= 0) { spawnNext(); S.spawnTimer = S.spawnGap }

      const soldiers = S.towers.map((t) => t.soldier).filter((s): s is Soldier => !!s && s.hp > 0)

      for (const e of [...S.enemies]) {
        e.frame = (e.frame + dt * 7) % 7
        for (const k of ['press', 'good', 'bad', 'shake'] as const) if (e[k] > 0) e[k] -= dt

        let blocker: Soldier | null = null
        for (const sd of soldiers) {
          if (sd.path !== e.path) continue
          const gap = sd.dist - e.dist
          if (gap >= -4 && gap < TOWERS.barracks.blockRadius!) blocker = sd
        }
        e.blocked = !!blocker
        if (blocker) blocker.hp -= dt * 9
        else e.dist += e.speed * dt

        const p = pointAt(PATHS[e.path], e.dist)
        e.x = p.x; e.y = p.y
        if (!e.entered && e.x > ENTER_X) e.entered = true

        if (e.dist >= PATH_LEN[e.path]) {
          S.hp -= e.boss ? 3 : 1
          ctx.audio.play('castle-hit')
          S.pops.push({ x: layout.castle.x - 40, y: layout.castle.y - 70, text: '-1 ❤️', color: '#ff9a94', life: 1.1 })
          killEnemy(e)
          syncUI()
        }
      }

      for (const t of S.towers) {
        if (t.kind !== 'barracks' || !t.soldier) continue
        if (t.soldier.hp <= 0) {
          t.soldier.respawn += dt
          if (t.soldier.respawn > 6) t.soldier = makeSoldier(t.slot)
        }
      }

      if (!S.target) { S.idle += dt; pickQuestion() }
      else S.idle = 0

      if (S.hp <= 0) return finish(false)
      if (!S.spawnQueue.length && !S.enemies.length) {
        if (S.wave >= rules.waves.length) return finish(true)
        S.wave++
        S.phase = 'build'
        S.target = null
        syncUI(); syncQuiz()
      }
    }

    S.shots = S.shots.filter((s) => (s.life -= dt) > 0)
    S.pops = S.pops.filter((p) => { p.life -= dt; p.y -= dt * 22; return p.life > 0 })
    S.rings = S.rings.filter((r) => (r.life -= dt) > 0)
  }

  function finish(win: boolean) {
    if (S.phase === 'done') return
    S.phase = 'done'
    elTray.hidden = true
    ctx.audio.play(win ? 'victory' : 'defeat')
    const acc = S.asked ? Math.round((S.correct / S.asked) * 100) : 0
    ctx.finish({
      win,
      survival: Math.max(0, S.hp) / rules.castleHp,
      detail: win
        ? `${rules.waves.length} 波全部擋下來，正確率 ${acc}%，城堡還剩 ${S.hp} 滴血。`
        : `撐到第 ${S.wave} 波，正確率 ${acc}%。塔集中一點，或用軍營把怪擋久一些。`,
    })
  }

  // ---------------------------------------------------------------- 字牌排版
  function layoutPlates() {
    c2d.font = PLATE_FONT
    for (const e of S.enemies) {
      e.pw = Math.max(58, c2d.measureText(e.word.word).width + 24)
      e.px = e.x
      e.tier = 0
    }
    for (let lane = 0; lane < PATHS.length; lane++) {
      const list = S.enemies.filter((e) => e.path === lane && e.entered).sort((a, b) => a.x - b.x)
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1], b = list[i]
          const need = (a.pw + b.pw) / 2 + 6
          const gap = b.px - a.px
          if (gap < need) { const push = (need - gap) / 2; a.px -= push; b.px += push }
        }
        for (const e of list) {
          // 不能離本體太遠，也不能超出畫布——兩個夾限的順序很重要，
          // 反過來的話牌子會被拉進畫面裡，變成本體還沒出現就看得到答案
          e.px = Math.max(e.pw / 2 + 3, Math.min(W - e.pw / 2 - 3, e.px))
          e.px = Math.max(e.x - 46, Math.min(e.x + 46, e.px))
        }
      }
      for (let j = 1; j < list.length; j++) {
        const p = list[j - 1], q = list[j]
        if (q.px - p.px < (p.pw + q.pw) / 2) q.tier = (p.tier + 1) % 3
      }
    }
  }
  const plateY = (e: Enemy) => e.y + 4 + e.tier * TIER_GAP

  // ---------------------------------------------------------------- 畫面
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    c2d.beginPath()
    c2d.moveTo(x + r, y)
    c2d.arcTo(x + w, y, x + w, y + h, r)
    c2d.arcTo(x + w, y + h, x, y + h, r)
    c2d.arcTo(x, y + h, x, y, r)
    c2d.arcTo(x, y, x + w, y, r)
    c2d.closePath()
  }

  function buildTerrain() {
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    if (img.water?.complete) {
      g.fillStyle = g.createPattern(img.water, 'repeat')!
      g.fillRect(0, 0, W, H)
    } else { g.fillStyle = '#2a5b8f'; g.fillRect(0, 0, W, H) }

    const tile = (sc: number, sr: number, dx: number, dy: number) => {
      if (img.tiles?.complete) g.drawImage(img.tiles, sc * 64, sr * 64, 64, 64, dx, dy, 64, 64)
    }

    // 圖塊是 4×4 的接邊組：欄 0/1/2/3 是左/中/右/單，列 0/1/2/3 是上/中/下/單。
    // 島的左右刻意都用「中」，讓陸地跑出畫面外，怪才有地方走進來。
    for (let r = layout.land.r0; r <= layout.land.r1; r++) {
      const sr = r === layout.land.r0 ? 0 : r === layout.land.r1 ? 2 : 1
      for (let c2 = 0; c2 < COLS; c2++) tile(1, sr, c2 * TILE, r * TILE)
    }
    // 高地用第二組（欄 5~8）：上排的草下緣就是石壁起點，下排接石壁底的崖腳
    for (const p of layout.plateaus) {
      for (let r = p.r0; r <= p.r1; r++) {
        const sr = r === p.r0 ? 3 : 5
        for (let c3 = p.c0; c3 <= p.c1; c3++) {
          const sc = p.c0 === p.c1 ? 8 : c3 === p.c0 ? 5 : c3 === p.c1 ? 7 : 6
          tile(sc, sr, c3 * TILE, r * TILE)
        }
      }
    }
    // 這套圖塊沒有土路磚，所以路用「被踩禿的草」表現
    g.lineCap = 'round'; g.lineJoin = 'round'
    for (const pts of PATHS) {
      for (const [w, color] of [[54, 'rgba(122,100,54,.45)'], [40, 'rgba(198,170,112,.55)'], [26, 'rgba(216,192,138,.45)']] as [number, string][]) {
        g.lineWidth = w; g.strokeStyle = color
        g.beginPath(); g.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
        g.stroke()
      }
    }
    terrain = c
  }

  function shadow(x: number, y: number, rx: number) {
    c2d.fillStyle = 'rgba(20,40,20,.22)'
    c2d.beginPath(); c2d.ellipse(x, y, rx, rx * 0.38, 0, 0, 7); c2d.fill()
  }

  function bar(x: number, y: number, w: number, h: number, pct: number, color: string) {
    c2d.fillStyle = 'rgba(0,0,0,.5)'; c2d.fillRect(x - 1, y - 1, w + 2, h + 2)
    c2d.fillStyle = color; c2d.fillRect(x, y, Math.max(0, w * pct), h)
  }

  function draw() {
    if (!terrain && img.tiles?.complete) buildTerrain()
    if (terrain) c2d.drawImage(terrain, 0, 0)
    else { c2d.fillStyle = '#6ea84f'; c2d.fillRect(0, 0, W, H) }

    if (S.phase === 'build') drawBuildHints()

    // 所有站在地上的東西照「腳下的 y」由遠到近排，遮擋關係才會對
    const scene: { y: number; f: () => void }[] = []
    for (const d of layout.decor) scene.push({ y: d.y, f: () => drawDecor(d) })
    scene.push({ y: layout.castle.y, f: drawCastle })
    for (const t of S.towers) { const s = SLOTS[t.slot]; scene.push({ y: s.y, f: () => drawTower(t, s) }) }
    for (const t of S.towers) { const sd = t.soldier; if (sd && sd.hp > 0) scene.push({ y: sd.y, f: () => drawSoldier(sd) }) }
    for (const e of S.enemies) scene.push({ y: e.y, f: () => drawEnemy(e) })
    scene.sort((a, b) => a.y - b.y)
    for (const o of scene) o.f()

    // 字牌一律畫在最上層，永遠不會被塔或樹蓋住；沒完全進場的怪不畫牌子
    layoutPlates()
    for (const e of [...S.enemies].filter((e) => e.entered).sort((a, b) => a.tier - b.tier)) drawPlate(e)

    for (const s of S.shots) {
      c2d.strokeStyle = 'rgba(255,240,190,' + s.life / 0.22 + ')'
      c2d.lineWidth = 3; c2d.lineCap = 'round'
      c2d.beginPath(); c2d.moveTo(s.x0, s.y0); c2d.lineTo(s.x1, s.y1); c2d.stroke()
    }
    for (const r of S.rings) {
      const t = 1 - r.life / 0.42
      c2d.strokeStyle = r.color; c2d.globalAlpha = (1 - t) * 0.9; c2d.lineWidth = 4
      c2d.beginPath(); c2d.arc(r.x, r.y, r.r + (r.max - r.r) * t, 0, 7); c2d.stroke()
      c2d.globalAlpha = 1
    }
    for (const p of S.pops) {
      c2d.globalAlpha = Math.min(1, p.life)
      c2d.font = 'bold 17px system-ui, sans-serif'; c2d.textAlign = 'center'; c2d.textBaseline = 'alphabetic'
      c2d.lineWidth = 3.5; c2d.strokeStyle = 'rgba(0,0,0,.6)'
      c2d.strokeText(p.text, p.x, p.y)
      c2d.fillStyle = p.color; c2d.fillText(p.text, p.x, p.y)
      c2d.globalAlpha = 1
    }
  }

  function drawBuildHints() {
    SLOTS.forEach((s, i) => {
      if (S.towers.some((t) => t.slot === i)) return
      const spec = TOWERS[S.picked]
      if (spec.range) {
        c2d.save()
        c2d.setLineDash([6, 8]); c2d.strokeStyle = 'rgba(255,255,255,.22)'; c2d.lineWidth = 2
        c2d.beginPath(); c2d.arc(s.x, s.y - 20, spec.range, 0, 7); c2d.stroke()
        c2d.restore()
      }
      c2d.fillStyle = 'rgba(255,255,255,.26)'
      c2d.beginPath(); c2d.arc(s.x, s.y - 12, 20, 0, 7); c2d.fill()
      c2d.fillStyle = 'rgba(255,255,255,.85)'
      c2d.font = 'bold 26px sans-serif'; c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
      c2d.fillText('+', s.x, s.y - 11)
    })
    for (const t of S.towers) {
      const spec = TOWERS[t.kind]
      if (!spec.range) continue
      const s = SLOTS[t.slot]
      const on = S.selected === t.slot
      c2d.strokeStyle = on ? 'rgba(255,224,138,.95)' : 'rgba(255,224,138,.4)'
      c2d.lineWidth = on ? 3 : 1.5
      c2d.beginPath(); c2d.arc(s.x, s.y - 20, spec.range, 0, 7); c2d.stroke()
      c2d.fillStyle = on ? 'rgba(255,224,138,.12)' : 'rgba(255,224,138,.05)'
      c2d.fill()
    }
  }

  function drawDecor(d: { k: string; x: number; y: number }) {
    const im = img[d.k]
    if (!im?.complete) return
    shadow(d.x, d.y - 3, im.width * 0.3)
    c2d.drawImage(im, d.x - im.width / 2, d.y - im.height, im.width, im.height)
  }

  function drawCastle() {
    const im = img.castle
    if (!im?.complete) return
    shadow(layout.castle.x, layout.castle.y - 6, 62)
    c2d.drawImage(im, layout.castle.x - 75, layout.castle.y - 120, 150, 120)
  }

  function drawTower(t: Tower, s: Point) {
    const im = img[t.kind]
    if (!im?.complete) return
    shadow(s.x, s.y - 4, 34)
    c2d.drawImage(im, s.x - 39, s.y - 102, 78, 104)
  }

  function drawSoldier(sd: Soldier) {
    if (img.warrior?.complete) {
      shadow(sd.x, sd.y + 2, 20)
      c2d.drawImage(img.warrior, sd.x - 42, sd.y - 63, 84, 84)
    }
    bar(sd.x - 19, sd.y - 48, 38, 5, sd.hp / TOWERS.barracks.soldierHp!, '#6fbf4a')
  }

  function drawEnemy(e: Enemy) {
    const im = img[e.art]
    const sc = (1 + (e.press > 0 ? Math.sin((e.press / PRESS) * Math.PI) * 0.18 : 0)) * e.scale
    const sh = e.shake > 0 ? Math.sin(e.shake * 70) * 4 : 0
    shadow(e.x + sh, e.y + 1, 21 * e.scale)
    c2d.save()
    c2d.translate(e.x + sh, e.y); c2d.scale(sc, sc); c2d.translate(-(e.x + sh), -e.y)
    // 圖框下緣有透明留白，腳大約在 73% 的位置，要往下挪才會真的踩在地上
    if (im?.complete) c2d.drawImage(im, (e.frame | 0) % 7 * 64, 0, 64, 64, e.x + sh - 42, e.y - 62, 84, 84)
    if (e.bad > 0) {
      c2d.globalAlpha = Math.min(0.55, e.bad)
      c2d.fillStyle = '#d43c32'
      c2d.beginPath(); c2d.ellipse(e.x + sh, e.y - 20, 26, 28, 0, 0, 7); c2d.fill()
      c2d.globalAlpha = 1
    }
    c2d.restore()
    bar(e.x + sh - 22 * e.scale, e.y - 46 * e.scale, 44 * e.scale, 5, e.hp / e.maxHp, e.boss ? '#ff7a3c' : '#d4504a')
    if (e.blocked) {
      c2d.font = '15px sans-serif'; c2d.textAlign = 'center'; c2d.textBaseline = 'alphabetic'
      c2d.fillText('⚔️', e.x + 30, e.y - 30)
    }
  }

  /** 牌子＝怪的底座。整塊跟著怪走、整塊都可以點。 */
  function drawPlate(e: Enemy) {
    const py = plateY(e)
    const w = e.pw
    const sh = e.shake > 0 ? Math.sin(e.shake * 70) * 4 : 0
    const cx = e.px + sh
    const x = cx - w / 2

    if (Math.abs(e.px - e.x) > 5 || e.tier > 0) {
      c2d.strokeStyle = 'rgba(24,18,10,.5)'; c2d.lineWidth = 3
      c2d.beginPath(); c2d.moveTo(e.x + sh, e.y - 4); c2d.lineTo(cx, py + 6); c2d.stroke()
    }

    const sc = 1 + (e.press > 0 ? Math.sin((e.press / PRESS) * Math.PI) * 0.16 : 0)
    c2d.save()
    c2d.translate(cx, py + PLATE_H / 2); c2d.scale(sc, sc); c2d.translate(-cx, -(py + PLATE_H / 2))
    c2d.fillStyle = 'rgba(0,0,0,.28)'; roundRect(x, py + 3, w, PLATE_H, 9); c2d.fill()
    c2d.fillStyle = e.good > 0 ? '#3f7a34' : e.bad > 0 ? '#8c3730' : '#2f2519'
    roundRect(x, py, w, PLATE_H, 9); c2d.fill()
    c2d.strokeStyle = e.good > 0 ? '#a8e07a' : e.bad > 0 ? '#ff9a94' : '#8a6b45'
    c2d.lineWidth = 2.5; c2d.stroke()
    c2d.strokeStyle = 'rgba(255,255,255,.16)'; c2d.lineWidth = 1.5
    c2d.beginPath(); c2d.moveTo(x + 8, py + 4); c2d.lineTo(x + w - 8, py + 4); c2d.stroke()
    c2d.fillStyle = '#fff'; c2d.font = PLATE_FONT
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    c2d.fillText(e.word.word, cx, py + PLATE_H / 2 + 1)
    c2d.restore()
  }

  // ---------------------------------------------------------------- UI
  function syncUI() {
    elHp.textContent = '❤️ ' + Math.max(0, S.hp)
    elCoin.textContent = '🪙 ' + S.coins
    elWave.textContent = `第 ${S.wave} / ${rules.waves.length} 波`
    const build = S.phase === 'build'
    elTray.hidden = !build
    elGo.textContent = '開始第 ' + S.wave + ' 波'
    elSay.disabled = !S.target
    const sel = S.selected !== null ? S.towers.find((t) => t.slot === S.selected) : undefined
    elSell.hidden = !sel
    if (sel) {
      const back = refundOf(TOWERS[sel.kind].cost, sel.builtAtWave < S.wave)
      elSell.textContent = `拆除 ${TOWERS[sel.kind].name}（退 ${back}）`
    }
  }

  function syncQuiz() {
    if (S.target) {
      elEmoji.textContent = S.target.word.emoji
      elZh.textContent = S.target.word.zh
      elHint.textContent = `（${S.target.word.pos}）點出寫著這個字的怪`
    } else if (S.phase === 'build') {
      elEmoji.textContent = '🛡️'
      elZh.textContent = '準備防守'
      elHint.textContent = '點空地蓋塔，點已有的塔可以拆掉'
    } else {
      elEmoji.textContent = '⏳'
      elZh.textContent = '怪物進場中'
      elHint.textContent = '等牠們走進來'
    }
    elSay.disabled = !S.target
  }

  // ---------------------------------------------------------------- 輸入
  function pickHit(x: number, y: number): Enemy | null {
    let exact: Enemy | null = null
    let near: Enemy | null = null
    let nd = 46
    for (const e of S.enemies) {
      if (!e.entered) continue // 還沒完全進場的怪不能被點
      const py = plateY(e)
      const inPlate = x >= e.px - e.pw / 2 - 4 && x <= e.px + e.pw / 2 + 4 && y >= py - 4 && y <= py + PLATE_H + 4
      const inBody = x >= e.x - 30 && x <= e.x + 30 && y >= e.y - 48 && y <= e.y + 6
      if (inPlate || inBody) { exact = e; break }
      const d = Math.min(Math.hypot(e.x - x, e.y - 22 - y), Math.hypot(e.px - x, py + PLATE_H / 2 - y))
      if (d < nd) { nd = d; near = e }
    }
    return exact ?? near
  }

  function onPointerDown(ev: PointerEvent) {
    if (S.phase === 'done') return
    ctx.audio.unlock()
    const r = cv.getBoundingClientRect()
    const x = ((ev.clientX - r.left) * W) / r.width
    const y = ((ev.clientY - r.top) * H) / r.height

    if (S.phase === 'battle') {
      const hit = pickHit(x, y)
      if (hit) tapEnemy(hit)
      else S.rings.push({ x, y, r: 6, max: 30, life: 0.3, color: 'rgba(255,255,255,.7)' })
      return
    }
    for (let i = 0; i < SLOTS.length; i++) {
      if (Math.hypot(SLOTS[i].x - x, SLOTS[i].y - 16 - y) < 42) return tapSlot(i)
    }
    S.selected = null
    syncUI()
  }

  cv.addEventListener('pointerdown', onPointerDown)

  const cards = [...root.querySelectorAll<HTMLButtonElement>('.td-card')]
  for (const btn of cards) {
    btn.addEventListener('click', () => {
      ctx.audio.unlock(); ctx.audio.play('ui-tap')
      for (const b of cards) b.classList.remove('td-sel')
      btn.classList.add('td-sel')
      S.picked = btn.dataset.kind!
    })
  }
  elGo.addEventListener('click', () => { ctx.audio.unlock(); ctx.audio.play('ui-tap'); startWave() })
  elSell.addEventListener('click', sellSelected)
  elSay.addEventListener('click', () => { if (S.target) speak(S.target.word.word) })

  // ---------------------------------------------------------------- 主迴圈
  let last = performance.now()
  function loop(now: number) {
    if (dead) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (S.phase !== 'done') update(dt)
    draw()
    raf = requestAnimationFrame(loop)
  }

  void loadArt().then((a) => { img = a })

  // 開發模式下把內部狀態開出來，自動測試才驗得到難度曲線與出題漏洞。
  // 正式版 build 會整段消失（import.meta.env.DEV 在 production 是 false）。
  if (import.meta.env.DEV) {
    ;(window as unknown as { __td?: unknown }).__td = {
      S, SLOTS, level, tapEnemy, tapSlot, sellSelected, startWave,
    }
  }

  syncUI(); syncQuiz()
  raf = requestAnimationFrame(loop)

  return {
    destroy() {
      dead = true
      cancelAnimationFrame(raf)
      cv.removeEventListener('pointerdown', onPointerDown)
      try { speechSynthesis.cancel() } catch { /* 有些瀏覽器沒有 */ }
      root.innerHTML = ''
    },
  }
}
