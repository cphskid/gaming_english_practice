import type { GameContext, GameHandle, Opponent, Word } from '@/core/types'
import { makeFeeder } from '@/core/opponent'
import { loadArt } from '../tower-defense/art'
import { PLATE_RULES, layoutPlates, plateY, type Plate } from '../tower-defense/plates'
import {
  RANKS, RULES, frontUnitOf, newBattle, pushed, step, strike, summon, type Unit,
} from './battle'

const W = 1088
const H = 576
const TILE = 64
const COLS = 17
const ROAD_Y = 402
const LAND = { r0: 2, r1: 6 }
/** 答完一題到下一題之間的冷卻。**比的是英文不是手速**，所以這個不能拿掉。 */
const ANSWER_COOLDOWN = 0.3
const PRESS = 0.22

const SHELL = `
<div class="td-hud">
  <span class="td-stat td-clock">⏱️ 3:00</span>
  <span class="td-stat tw-mine">🏰 100</span>
  <span class="td-stat tw-theirs">🏯 100</span>
  <div class="td-quiz">
    <span class="td-qemoji">⚔️</span>
    <span class="td-qzh">準備開打</span>
    <span class="td-qhint"></span>
  </div>
  <span class="tw-foe"></span>
  <button class="td-say" disabled aria-label="再念一次">🔊</button>
</div>
<div class="td-stage">
  <canvas class="td-cv" width="1088" height="576"></canvas>
  <div class="td-toast"></div>
</div>`

/** 場上一個點得到的東西：敵方的兵，或敵方城堡前的兩面護盾。 */
interface Target extends Plate {
  id: string
  word: Word
  unit: Unit | null
  press: number
  good: number
  bad: number
  shake: number
}

export function mountTugOfWar(root: HTMLElement, ctx: GameContext): GameHandle {
  root.innerHTML = SHELL
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T
  const cv = $<HTMLCanvasElement>('.td-cv')
  const c2d = cv.getContext('2d')!
  const elClock = $('.td-clock')
  const elMine = $('.tw-mine')
  const elTheirs = $('.tw-theirs')
  const elFoe = $('.tw-foe')
  const elEmoji = $('.td-qemoji')
  const elZh = $('.td-qzh')
  const elHint = $('.td-qhint')
  const elSay = $<HTMLButtonElement>('.td-say')
  const elToast = $('.td-toast')

  // 對手一定要有，不然這個遊戲沒有意義；容器負責給。
  const foe: Opponent = ctx.opponent!
  const R = RULES
  let img: Record<string, HTMLImageElement> = {}
  let terrain: HTMLCanvasElement | null = null
  let raf = 0
  let paused = false
  let last = performance.now()

  const S = {
    battle: newBattle(R),
    targets: new Map<string, Target>(),
    target: null as string | null,
    askedAt: 0,
    asked: 0,
    correct: 0,
    combo: 0,
    cooldown: 0,
    /** 敵方城堡前的兩面護盾。沒有它，對手兵被清光時就沒有東西可以點了。 */
    shieldWords: [null, null] as (Word | null)[],
    pops: [] as { x: number; y: number; text: string; color: string; life: number }[],
    flashes: [] as { x: number; life: number }[],
    done: false,
  }

  /**
   * 敵我的顏色。自己穿什麼色就用什麼色，對手一定換成另一色——
   * 兩邊同色的話，戰場上根本分不出哪一隻是自己的兵。
   */
  const foeSuffix = ctx.color === '_red' ? '_black' : '_red'
  const mine = (key: string) => img[key + ctx.color] ?? img[key]
  const theirs = (key: string) => img[key + foeSuffix] ?? img[key]

  const feed = makeFeeder(foe, (rank) => {
    summon(S.battle, 'foe', rank, R)
    strike(S.battle, 'foe', frontUnitOf(S.battle, 'me'), R)
  })

  // ------------------------------------------------------------------ 題目
  function freshWord(): Word | null {
    const q = ctx.nextQuestion()
    return q ? q.word : null
  }

  /** 場上所有點得到的東西，每一格重建一次（兵會死、會出生）。 */
  function syncTargets() {
    const seen = new Set<string>()

    for (const u of S.battle.units) {
      if (u.side !== 'foe') continue
      const id = 'u' + u.id
      seen.add(id)
      let t = S.targets.get(id)
      if (!t) {
        const w = freshWord()
        if (!w) continue
        t = {
          id, word: w, unit: u, press: 0, good: 0, bad: 0, shake: 0,
          x: u.x, y: ROAD_Y - 74, pw: 0, px: u.x, ptx: u.x, tier: 0, laid: false, hold: 0,
        }
        S.targets.set(id, t)
      }
      t.unit = u
      t.x = u.x
      t.y = ROAD_Y - 74
    }

    // 城堡前的護盾。對手被清光的時候，你點的就是它——也就是直接打城堡。
    for (let i = 0; i < 2; i++) {
      const id = 's' + i
      seen.add(id)
      if (!S.shieldWords[i]) S.shieldWords[i] = freshWord()
      const w = S.shieldWords[i]
      if (!w) continue
      let t = S.targets.get(id)
      const x = R.homeFoe + (i === 0 ? -6 : 46)
      const y = ROAD_Y - (i === 0 ? 136 : 96)
      if (!t) {
        t = {
          id, word: w, unit: null, press: 0, good: 0, bad: 0, shake: 0,
          x, y, pw: 0, px: x, ptx: x, tier: 0, laid: false, hold: 0,
        }
        S.targets.set(id, t)
      }
      t.word = w
      t.x = x; t.y = y
    }

    for (const id of [...S.targets.keys()]) if (!seen.has(id)) S.targets.delete(id)
    if (S.target && !S.targets.has(S.target)) pickQuestion()
  }

  function pickQuestion() {
    const list = [...S.targets.values()]
    if (!list.length) { S.target = null; return syncQuiz() }
    S.target = list[(Math.random() * list.length) | 0].id
    S.asked++
    S.askedAt = performance.now()
    syncQuiz()
  }

  function syncQuiz() {
    const t = S.target ? S.targets.get(S.target) : null
    if (t) {
      elEmoji.textContent = t.word.emoji
      elZh.textContent = t.word.zh
      elHint.textContent = `（${t.word.pos}）點出寫著這個字的敵人`
    } else {
      elEmoji.textContent = '⚔️'
      elZh.textContent = '準備開打'
      elHint.textContent = ''
    }
    elSay.disabled = !t
  }

  function syncUI() {
    const left = Math.max(0, R.seconds - S.battle.t)
    elClock.textContent = `⏱️ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
    elMine.textContent = `🏰 ${Math.max(0, Math.ceil(S.battle.castleHp.me))}`
    elTheirs.textContent = `🏯 ${Math.max(0, Math.ceil(S.battle.castleHp.foe))}`
    // 電腦對手一定要寫出來。被騙到才會真的不爽。
    elFoe.textContent = foe.isBot ? `🤖 ${foe.name}` : `🧒 ${foe.name}`
  }

  function toast(text: string) {
    elToast.textContent = text
    elToast.classList.add('on')
    setTimeout(() => elToast.classList.remove('on'), 1600)
  }

  // ------------------------------------------------------------------ 作答
  function tap(t: Target) {
    if (S.done || paused || !S.target || S.cooldown > 0) return
    t.press = PRESS
    const correct = t.id === S.target
    const asked = S.targets.get(S.target)
    S.cooldown = ANSWER_COOLDOWN

    ctx.report({
      wordId: asked!.word.id, skill: 'recognize', correct,
      ms: Math.round(performance.now() - S.askedAt), combo: S.combo,
    })

    if (correct) {
      S.correct++; S.combo++
      t.good = 0.45
      buzz(14)
      ctx.audio.play('answer-correct')
      // 答對做兩件看得見的事：派一隻兵出去，順手對你點的那個開一槍。
      summon(S.battle, 'me', 0, R)
      strike(S.battle, 'me', t.unit, R)
      S.flashes.push({ x: t.x, life: 0.22 })
      S.pops.push({ x: R.homeMe + 40, y: ROAD_Y - 80, text: '＋1 兵', color: '#a8e07a', life: 0.9 })
      if (!t.unit) S.shieldWords[Number(t.id.slice(1))] = null   // 護盾被打破就換一個字
      speak(t.word.word)
    } else {
      S.combo = 0
      t.bad = 0.5; t.shake = 0.35
      buzz(55)
      ctx.audio.play('answer-wrong')
      S.pops.push({ x: t.x, y: t.y - 10, text: '✗', color: '#ffb4b0', life: 0.8 })
    }
    syncTargets()
    pickQuestion()
    syncUI()
  }

  function buzz(ms: number) {
    try { navigator.vibrate?.(ms) } catch { /* 沒有震動就算了 */ }
  }

  function speak(t: string) {
    if (!('speechSynthesis' in window)) return
    try {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(t)
      u.lang = 'en-US'; u.rate = 0.85
      speechSynthesis.speak(u)
    } catch { /* 念不出來就算了 */ }
  }

  // ------------------------------------------------------------------ 迴圈
  function update(dt: number) {
    if (S.cooldown > 0) S.cooldown -= dt
    feed(S.battle.t)
    step(S.battle, dt, R)
    syncTargets()
    if (!S.target) pickQuestion()

    for (const t of S.targets.values()) {
      for (const k of ['press', 'good', 'bad', 'shake'] as const) if (t[k] > 0) t[k] -= dt
    }
    for (const p of S.pops) { p.life -= dt; p.y -= dt * 34 }
    S.pops = S.pops.filter((p) => p.life > 0)
    for (const f of S.flashes) f.life -= dt
    S.flashes = S.flashes.filter((f) => f.life > 0)

    if (S.battle.over && !S.done) finish()
  }

  function finish() {
    S.done = true
    const b = S.battle
    const win = b.winner === 'me'
    ctx.audio.play(win ? 'victory' : 'defeat')
    const acc = S.asked ? Math.round((S.correct / S.asked) * 100) : 0
    const pct = Math.round(pushed(b, R) * 100)
    const how = b.reason === 'castle'
      ? (win ? '把對方城堡打破了！' : '城堡被打破了。')
      : (b.winner === null ? '時間到，平手。' : win ? '時間到，你推得比較前面！' : '時間到，被推回來了。')
    ctx.finish({
      win,
      survival: Math.max(0, b.castleHp.me) / R.castleHp,
      detail: `${how}答對 ${S.correct} 題（正確率 ${acc}%），前線推到 ${pct}%。`,
    })
  }

  function loop() {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (!S.done && !paused) update(dt)
    draw()
    syncUI()
    raf = requestAnimationFrame(loop)
  }

  // ------------------------------------------------------------------ 畫面
  function buildTerrain() {
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    if (img.water?.complete) {
      g.fillStyle = g.createPattern(img.water, 'repeat')!
      g.fillRect(0, 0, W, H)
    } else { g.fillStyle = '#2a5b8f'; g.fillRect(0, 0, W, H) }

    // 圖塊是 4×4 的接邊組：欄 0/1/2/3 是左/中/右/單，列 0/1/2/3 是上/中/下/單。
    // 跟守塔一樣左右都用「中」，陸地跑出畫面外，戰場看起來才是連著的。
    for (let r = LAND.r0; r <= LAND.r1; r++) {
      const sr = r === LAND.r0 ? 0 : r === LAND.r1 ? 2 : 1
      for (let c2 = 0; c2 < COLS; c2++) {
        if (img.tiles?.complete) g.drawImage(img.tiles, 64, sr * 64, 64, 64, c2 * TILE, r * TILE, TILE, TILE)
      }
    }
    // 一條路從這頭到那頭。這套圖塊沒有土路磚，用「被踩禿的草」表現。
    g.lineCap = 'round'
    for (const [w, color] of [[62, 'rgba(122,100,54,.45)'], [46, 'rgba(198,170,112,.55)'], [30, 'rgba(216,192,138,.45)']] as [number, string][]) {
      g.lineWidth = w; g.strokeStyle = color
      g.beginPath(); g.moveTo(0, ROAD_Y); g.lineTo(W, ROAD_Y); g.stroke()
    }
    for (const d of [
      { k: 'tree1', x: 250, y: 190 }, { k: 'tree2', x: 480, y: 186 },
      { k: 'tree1', x: 700, y: 192 }, { k: 'rock1', x: 360, y: 470 },
      { k: 'rock3', x: 640, y: 474 }, { k: 'tree2', x: 860, y: 188 },
    ]) {
      const im = img[d.k]
      if (im?.complete) g.drawImage(im, d.x - 32, d.y - 52, 64, 64)
    }
    terrain = c
  }

  function shadow(x: number, y: number, r: number) {
    c2d.fillStyle = 'rgba(0,0,0,.22)'
    c2d.beginPath(); c2d.ellipse(x, y, r, r * 0.34, 0, 0, 7); c2d.fill()
  }

  function bar(x: number, y: number, w: number, h: number, pct: number, color: string) {
    c2d.fillStyle = 'rgba(0,0,0,.5)'; c2d.fillRect(x - 1, y - 1, w + 2, h + 2)
    c2d.fillStyle = color; c2d.fillRect(x, y, Math.max(0, w * pct), h)
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    c2d.beginPath()
    c2d.moveTo(x + r, y)
    c2d.arcTo(x + w, y, x + w, y + h, r)
    c2d.arcTo(x + w, y + h, x, y + h, r)
    c2d.arcTo(x, y + h, x, y, r)
    c2d.arcTo(x, y, x + w, y, r)
    c2d.closePath()
  }

  /** 兵站的高度稍微錯開，一整排才不會看起來像同一隻 */
  const laneY = (u: Unit) => ROAD_Y + ((u.id * 7) % 3) * 9 - 9

  function drawUnit(u: Unit) {
    const spec = RANKS[Math.min(u.rank, RANKS.length - 1)]
    const y = laneY(u)
    const im = u.side === 'me' ? mine('warrior') : theirs('warrior')
    shadow(u.x, y + 2, 20 * spec.size)
    c2d.save()
    if (u.side === 'foe') { c2d.translate(u.x * 2, 0); c2d.scale(-1, 1) }  // 對面的兵要朝左
    const sc = spec.size
    c2d.translate(u.x, y); c2d.scale(sc, sc); c2d.translate(-u.x, -y)
    if (im?.complete) c2d.drawImage(im, u.x - 42, y - 63, 84, 84)
    c2d.restore()
    if (u.hurt > 0) {
      c2d.globalAlpha = Math.min(0.5, u.hurt * 3)
      c2d.fillStyle = '#d43c32'
      c2d.beginPath(); c2d.ellipse(u.x, y - 22, 24, 27, 0, 0, 7); c2d.fill()
      c2d.globalAlpha = 1
    }
    bar(u.x - 19, y - 52, 38, 5, u.hp / u.maxHp, u.side === 'me' ? '#6fbf4a' : '#d4504a')
  }

  function drawCastle(side: 'me' | 'foe') {
    const x = side === 'me' ? R.homeMe : R.homeFoe
    const im = side === 'me' ? mine('castle') : theirs('castle')
    shadow(x, ROAD_Y - 4, 62)
    c2d.save()
    if (side === 'foe') { c2d.translate(x * 2, 0); c2d.scale(-1, 1) }
    if (im?.complete) c2d.drawImage(im, x - 75, ROAD_Y - 124, 150, 120)
    c2d.restore()
    bar(x - 44, ROAD_Y - 138, 88, 8,
      Math.max(0, S.battle.castleHp[side]) / R.castleHp, side === 'me' ? '#6fbf4a' : '#d4504a')
  }

  /** 前線那條線。整場最重要的一個東西——它就是「我推到哪了」。 */
  function drawFront() {
    const x = S.battle.front
    c2d.save()
    c2d.setLineDash([9, 7])
    c2d.strokeStyle = 'rgba(255,240,190,.75)'; c2d.lineWidth = 3
    c2d.beginPath(); c2d.moveTo(x, LAND.r0 * 64 - 6); c2d.lineTo(x, (LAND.r1 + 1) * 64 + 6); c2d.stroke()
    c2d.restore()

    // 上面一條推進度，左邊是我、右邊是對手
    const y = 26, x0 = 150, w = W - 300
    bar(x0, y, w, 14, 1, 'rgba(0,0,0,.35)')
    const p = pushed(S.battle, R)
    c2d.fillStyle = '#6fbf4a'; c2d.fillRect(x0, y, w * p, 14)
    c2d.fillStyle = 'rgba(255,255,255,.5)'
    c2d.fillRect(x0 + w / 2 - 1, y - 4, 2, 22)
    c2d.font = 'bold 15px system-ui, sans-serif'
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    c2d.fillStyle = '#f3ecd8'
    c2d.fillText('前線 ' + Math.round(p * 100) + '%', W / 2, y + 30)
  }

  function drawPlate(t: Target) {
    const py = plateY(t, PLATE_RULES)
    const w = t.pw
    const sh = t.shake > 0 ? Math.sin(t.shake * 70) * 4 : 0
    const cx = t.px + sh
    const x = cx - w / 2
    if (Math.abs(t.px - t.x) > 5 || t.tier > 0) {
      c2d.strokeStyle = 'rgba(24,18,10,.5)'; c2d.lineWidth = 3
      c2d.beginPath(); c2d.moveTo(t.x + sh, t.y + 18); c2d.lineTo(cx, py + 6); c2d.stroke()
    }
    const sc = 1 + (t.press > 0 ? Math.sin((t.press / PRESS) * Math.PI) * 0.16 : 0)
    c2d.save()
    c2d.translate(cx, py + 14); c2d.scale(sc, sc); c2d.translate(-cx, -(py + 14))
    c2d.fillStyle = 'rgba(0,0,0,.28)'; roundRect(x, py + 3, w, 28, 9); c2d.fill()
    c2d.fillStyle = t.good > 0 ? '#3f7a34' : t.bad > 0 ? '#8c3730' : t.unit ? '#2f2519' : '#3a2f4d'
    roundRect(x, py, w, 28, 9); c2d.fill()
    c2d.strokeStyle = t.good > 0 ? '#a8e07a' : t.bad > 0 ? '#ff9a94' : '#8a6b45'
    c2d.lineWidth = 2.5; c2d.stroke()
    c2d.fillStyle = '#fff'
    c2d.font = 'bold 17px system-ui, "Segoe UI", sans-serif'
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    c2d.fillText(t.word.word, cx, py + 15)
    c2d.restore()
  }

  function draw() {
    if (!terrain && img.tiles) buildTerrain()
    if (terrain) c2d.drawImage(terrain, 0, 0)
    else { c2d.fillStyle = '#3f6b39'; c2d.fillRect(0, 0, W, H) }

    drawCastle('me')
    drawCastle('foe')
    for (const u of [...S.battle.units].sort((a, b) => laneY(a) - laneY(b))) drawUnit(u)
    drawFront()

    // 字牌排版跟守塔共用同一支（純幾何，量得出來，見 plates.ts）
    c2d.font = 'bold 17px system-ui, "Segoe UI", sans-serif'
    const list = [...S.targets.values()]
    for (const t of list) t.pw = Math.max(58, c2d.measureText(t.word.word).width + 24)
    layoutPlates(list, PLATE_RULES)
    for (const t of [...list].sort((a, b) => a.tier - b.tier)) drawPlate(t)

    for (const f of S.flashes) {
      c2d.strokeStyle = `rgba(255,240,190,${f.life / 0.22})`
      c2d.lineWidth = 3; c2d.lineCap = 'round'
      c2d.beginPath(); c2d.moveTo(R.homeMe, ROAD_Y - 90); c2d.lineTo(f.x, ROAD_Y - 60); c2d.stroke()
    }
    for (const p of S.pops) {
      c2d.globalAlpha = Math.min(1, p.life * 1.6)
      c2d.fillStyle = p.color
      c2d.font = 'bold 19px system-ui, sans-serif'
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
      c2d.fillText(p.text, p.x, p.y)
      c2d.globalAlpha = 1
    }
  }

  // ------------------------------------------------------------------ 輸入
  function at(ev: PointerEvent): { x: number; y: number } {
    const r = cv.getBoundingClientRect()
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H }
  }

  function onDown(ev: PointerEvent) {
    const { x, y } = at(ev)
    let best: Target | null = null
    let bestD = 1e9
    for (const t of S.targets.values()) {
      const py = plateY(t, PLATE_RULES)
      const inPlate = x >= t.px - t.pw / 2 - 4 && x <= t.px + t.pw / 2 + 4 && y >= py - 4 && y <= py + 32
      const d = inPlate ? 0 : Math.min(
        Math.hypot(t.x - x, t.y - y), Math.hypot(t.px - x, py + 14 - y))
      if (d < bestD) { bestD = d; best = t }
    }
    if (best && bestD < 46) tap(best)
  }

  cv.addEventListener('pointerdown', onDown)
  elSay.addEventListener('click', () => {
    const t = S.target ? S.targets.get(S.target) : null
    if (t) speak(t.word.word)
  })

  void loadArt().then((a) => { img = a; terrain = null })

  // 開發模式下把內部狀態開出來，自動測試才打得完一場。
  // 正式版 build 會整段消失（import.meta.env.DEV 在 production 是 false）。
  if (import.meta.env.DEV) {
    ;(window as unknown as { __tug?: unknown }).__tug = {
      S, RULES: R,
      /** 點某一個目標；測試用它模擬小朋友的正確率 */
      tapId: (id: string) => { const t = S.targets.get(id); if (t) tap(t) },
      ids: () => [...S.targets.keys()],
    }
  }

  syncTargets()
  pickQuestion()
  syncUI()
  toast(foe.isBot ? `對手是電腦：${foe.name}` : `對手：${foe.name}`)
  raf = requestAnimationFrame(loop)

  return {
    setPaused(on: boolean) { paused = on; if (!on) last = performance.now() },
    destroy() {
      cancelAnimationFrame(raf)
      cv.removeEventListener('pointerdown', onDown)
      try { speechSynthesis.cancel() } catch { /* 沒有就算了 */ }
      root.innerHTML = ''
    },
  }
}
