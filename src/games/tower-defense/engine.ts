import { CRYSTAL, FOCUS_MAX, FOCUS_STEP, HERO, SOLDIER_REACH, SOLDIER_SLOW, TOWERS, refundOf } from '@/data/towers'
import { JOB_EFFECT } from '@/data/jobs'
import type { GameContext, GameHandle, LevelData, Point, Word } from '@/core/types'
import { ART, TERRAIN_KEYS, loadArt, onArt } from './art'
import { PLATE_RULES, layoutPlates as runPlateLayout, plateY } from './plates'
import { iconImg, iconUrl } from '@/data/icons'
import { legionById } from '@/data/legions'
import { createHero } from '../hero'

const W = 1088
const H = 576
const TILE = 64
const COLS = 17
const PLATE_FONT = 'bold 17px system-ui, "Segoe UI", sans-serif'
const PLATE_H = PLATE_RULES.height
const PRESS = 0.22

/** 怪要完全走進畫面才算數。這一條是第一次試玩那個「狂點就得分」漏洞的修法。 */
const ENTER_X = 40
/** 答完一題到下一題之間的冷卻，避免連點穿題 */
const ANSWER_COOLDOWN = 0.3
/**
 * 場上只剩一隻可點的怪時，等這麼久還是要出題。
 * 不等的話那隻怪永遠沒有人打得到，會直接走到城堡。
 * 真正的解法是下面那條「少於兩隻就提前放下一隻」，這裡只是整波最後一隻的保險，
 * 所以時間要短，不然玩家會眼睜睜看著怪走卻不能打。
 */
const SOLO_GRACE = 0.4
/** 開場那一小隊怪彼此隔多遠，免得疊在同一格 */
const LINE_SPACING = 95
/**
 * 寒霜陷阱持續幾秒。
 *
 * 本來寫的是「這一波」，但「這一波」沒有長度可以顯示，玩家看不出來它還在不在，
 * 用起來就像沒發生。改成固定秒數，狀態列才有倒數可以看，也才變成一個
 * 要抓時機的判斷（等怪擠成一團再按）。
 */
const SLOW_SECONDS = 15

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
  /** 牌子這一格該去的位置。px 是慢慢追過去的，不是直接跳過去——見 layoutPlates */
  ptx: number
  pw: number
  tier: number
  /** 進場後第一次排版：牌子要直接出現在本體上，不能從畫面左邊滑進來 */
  laid: boolean
  /** 低的那一層已經空了幾格，見 plates.ts */
  hold: number
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
interface Pop {
  x: number; y: number; text: string; color: string; life: number
  /** 字前面要不要擺一張圖示（data/icons.ts 的鍵）。沒載好就只寫字。 */
  icon?: string
}
/** 播一次就結束的圖片特效（例如治療）。t 從 0 走到 dur。 */
interface Fx { kind: string; x: number; y: number; t: number; dur: number; size: number }

/**
 * 身上正在生效的狀態。
 *
 * 本來寒霜陷阱的效果是「這一波」，結果是玩家完全看不出來它還在不在——
 * 「這一波」沒有長度可以顯示。改成固定秒數之後才有倒數可以看，
 * 而且變成一個要抓時機的判斷（等怪擠成一團再按），比開場就按掉有趣。
 */
interface Buff { id: string; icon: string; name: string; left: number; dur: number }

/** 擴散出去的圈圈。dur 是它本來有多長命，畫的時候要靠它算擴散到哪了。 */
interface Ring { x: number; y: number; r: number; max: number; life: number; dur: number; color: string }
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
  <span class="td-stat td-hp">${iconImg('heart', 15)} 20</span>
  <span class="td-stat td-coin">${iconImg('crystal', 15)} 0</span>
  <span class="td-wave">第 1 波</span>
  <div class="td-quiz">
    <span class="td-qemoji">🛡️</span>
    <span class="td-qzh">準備防守</span>
    <span class="td-qhint">蓋好塔再開戰</span>
  </div>
  <span class="td-buffs"></span>
  <button class="td-say" disabled aria-label="再念一次">🔊</button>
</div>
<div class="td-stage">
  <canvas class="td-cv" width="1088" height="576"></canvas>
  <div class="td-toast"></div>
  <div class="td-tray">
    <button class="td-card td-sel" data-kind="archery"><b>${iconImg('bow', 15)} 箭塔 <i>40</i></b><span>射程內的怪會被它射中</span></button>
    <button class="td-card" data-kind="barracks"><b>${iconImg('shield', 15)} 軍營 <i>30</i></b><span>派士兵擋路，替你爭取時間</span></button>
    <button class="td-btn td-sell" hidden>拆除</button>
    <button class="td-btn td-go">開始第 1 波</button>
  </div>
</div>`

/** 守塔裡會跟著軍團換的圖 */
const LEGION_KEYS = ['warrior', 'archery']

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
  const elBuffs = $<HTMLElement>('.td-buffs')

  // 素材是一張一張進來的，ART 這個物件會就地長大，所以拿參考就好，不用重新指派。
  const img = ART
  /**
   * 身上那一套軍團。**守塔只換軍營士兵和箭塔**（Chuck 2026-09-24 定案），
   * 地圖、城堡、軍營都不動——豬軍團的地形是側視的，做不出守塔的俯視彎路。
   */
  const legion = legionById(ctx.legion)
  let terrain: HTMLCanvasElement | null = null
  // 地形先畫在暫存畫布上再整張貼；地形用到的圖後到的話得把它作廢重畫。
  const unArt = onArt((k) => { if (TERRAIN_KEYS.includes(k)) terrain = null })

  // 各章的外觀（2026-09-25）：第二章雪地、第三章乾草原。圖是同一套調色出來的，
  // 鍵名後面接 _snow / _meadow；那一張還沒下載到（或第一章）就用原本的，畫面不會空掉。
  const TILESET = level.skin.tileset === 'snow' || level.skin.tileset === 'meadow' ? level.skin.tileset : ''
  const skinned = (key: string): HTMLImageElement | undefined =>
    (TILESET && img[key + '_' + TILESET]) || img[key]
  // 城堡：第二章是神殿（瘦高），其他章是城堡。照圖本身的比例畫，不壓扁。
  const CASTLE_KEY = TILESET === 'snow' ? 'temple' : 'castle'
  let raf = 0
  let dead = false
  let paused = false

  const S = {
    phase: 'build' as 'build' | 'battle' | 'done',
    wave: 1,
    hp: rules.castleHp,
    crystals: rules.startCoins,
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
    buffs: [] as Buff[],
    fx: [] as Fx[],
    t: 0,
  }

  /**
   * 英雄守的是**城門**（每條路的終點取平均），不是他腳下。
   *
   * 0.20.0～0.22.0 是從英雄胸口量：他站在城堡右下角，路卻是從城堡左邊偏上進城，
   * 範圍收到 90 之後第一章十四關只有少數幾條路經過圈內，大部分關卡英雄永遠不出手
   * （回報 #9、#10）。改從城門量，每一條路的最後一段都在圈裡。
   */
  const GATE = (() => {
    const ends = layout.paths.map((p) => p[p.length - 1])
    return { x: ends.reduce((n, q) => n + q.x, 0) / ends.length, y: ends.reduce((n, q) => n + q.y, 0) / ends.length - 22 }
  })()
  /**
   * 你本人（職業英雄），站在城門前（2026-09-26 Chuck：站在城堡前比較有守城的樣子；
   * 原本站在城堡右下角，離怪進城的地方很遠）。箭塔都打不到的怪走進城門 HERO.reach 以內，
   * 答對時由他出一發跟一座箭塔一樣的傷害（在 volley 裡算）；其他時候只演動畫。見 games/hero.ts。
   */
  const HERO_HOME = { x: GATE.x - 44, y: GATE.y + 22 + 26 }
  const hero = createHero(ctx.job, HERO_HOME.x, HERO_HOME.y, 58, -1)
  /** 這隻怪在不在英雄守的範圍裡：從城門到怪身體 */
  const heroReaches = (e: Enemy) => Math.hypot(GATE.x - e.x, GATE.y - (e.y - 22)) <= HERO.reach
  /** 有沒有任何一座箭塔打得到牠 */
  const towerCovers = (e: Enemy) => S.towers.some((t) => {
    const spec = TOWERS[t.kind]
    const s = SLOTS[t.slot]
    return spec.damage > 0 && Math.hypot(s.x - e.x, s.y - 20 - (e.y - 22)) <= spec.range
  })

  /** 怪現在剩幾成速度。寒霜陷阱生效中就是三成慢。 */
  const slowFactor = () => (S.buffs.some((b) => b.id === 'slow-30') ? 0.7 : 1)

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

  /**
   * 水晶入帳。水晶只活在這一場裡，結束就歸零，跟角色金幣是兩條線。
   * 角色金幣由 core 從答題事件算，遊戲碰不到。
   */
  function gainCrystals(n: number, x: number, y: number) {
    S.crystals += n
    S.pops.push({ x, y, text: '+' + n, icon: 'crystal', color: '#8fd8ff', life: 1 })
    ctx.audio.play('coin')
    syncUI()
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
    // 開頭一次放三隻，場上才有得選；只有一隻的話點哪裡都對。
    // 每一條路各自算前導距離，同一條路上的才不會疊在一起。
    const lead = new Map<number, number>()
    for (let i = 0; i < 3; i++) {
      const path = S.spawnQueue[0]?.path ?? 0
      const n = lead.get(path) ?? 0
      lead.set(path, n + 1)
      spawnNext(Math.max(0, (2 - n) * LINE_SPACING))
    }
    ctx.audio.play('wave-start')
    if (!S.hinted) { S.hinted = true; toast('點怪物、或牠腳下的字牌，都算點到') }
    syncUI()
  }

  /**
   * 放一隻怪出來。`headStart` 是牠已經先走了多遠——開場一次放一小隊時，
   * 每隻的前導距離不同，牠們才會排成一列走進來，而不是全部疊在起點同一格上
   * （疊在一起會看起來像一隻怪掛了兩三個字牌）。
   */
  function spawnNext(headStart = 0) {
    const s = S.spawnQueue.shift()
    if (!s) return
    const word = freshWord()
    if (!word) return
    const p = pointAt(PATHS[s.path], headStart)
    S.enemies.push({
      word, path: s.path, dist: headStart, hp: s.hp, maxHp: s.hp, speed: s.speed,
      art: s.art, scale: s.scale, boss: s.boss,
      frame: Math.random() * 7, blocked: false,
      px: 0, ptx: 0, pw: 0, tier: 0, laid: false, hold: 0, press: 0, good: 0, bad: 0, shake: 0,
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
    // 快進城、箭塔又打不到的怪先問：答對了英雄才有機會出手。不然題目常常問遠方的怪，
    // 小朋友眼看門口那隻走進去、英雄卻沒動，看起來像英雄壞掉。只換問哪一隻，不加傷害。
    const danger = ready.filter((e) => heroReaches(e) && !towerCovers(e))
    S.target = danger.length
      ? danger.reduce((a, b) => (Math.hypot(GATE.x - a.x, GATE.y - a.y) <= Math.hypot(GATE.x - b.x, GATE.y - b.y) ? a : b))
      : ready[(Math.random() * ready.length) | 0]
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
      gainCrystals(CRYSTAL.perCorrect, e.x, e.y - 58)
      S.rings.push({ x: e.x, y: e.y - 20, r: 16, max: 56, life: 0.42, dur: 0.42, color: '#ffe08a' })
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

  /**
   * 齊射：射程涵蓋到這隻怪的塔全部打它一次，同時開火的塔越多傷害越高。
   *
   * 職業在這裡進場，而且**只**在這裡進場：它改的是這一發怎麼分配，
   * 不是玩家有多強（理由見 data/jobs.ts）。騎士把整發壓在被點到的那隻身上，
   * 法師把同一發散到附近幾隻。塔的傷害、集火倍率、水晶收入都不受職業影響。
   */
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

    // 英雄守城：箭塔都打不到、怪又走到城堡前面，英雄自己出手（見 data/towers.ts 的 HERO）
    const guard = !hits.length && heroReaches(e)
    if (guard) base += HERO.damage
    const shooters = hits.length + (guard ? 1 : 0)

    if (!shooters) {
      S.pops.push({ x: e.x, y: e.y - 40, text: '沒有塔打得到', color: '#ffd9a0', life: 1.2 })
      pickQuestion()
      return
    }

    ctx.audio.play('volley')
    // 英雄只在自己出手（guard）時衝出去；箭塔打的那一下，他在城堡旁原地揮一下就好
    if (guard) hero.strike(e.x, e.y)
    else hero.cheer(e.x)
    const mult = 1 + FOCUS_STEP * Math.min(FOCUS_MAX, shooters - 1)
    const total = Math.round(base * mult)
    const job = JOB_EFFECT[ctx.job] ?? JOB_EFFECT.knight

    // 主目標。騎士的專長寫在 bossBonus：打魔王特別痛，打小兵跟沒職業一樣。
    const boss = e.boss ? job.bossBonus : 1
    const main = Math.max(1, Math.round(total * job.focus * boss))
    const dead: Enemy[] = []
    e.hp -= main
    S.pops.push({ x: e.x + 18, y: e.y - 40, text: '-' + main, color: '#fff', life: 0.9 })
    if (guard) S.pops.push({ x: e.x + 18, y: e.y - 22, text: '英雄守城', color: '#9fd0ff', life: 1 })
    if (shooters > 1)
      S.pops.push({ x: e.x + 18, y: e.y - 22, text: '集火 ×' + mult.toFixed(1), color: '#ffd05a', life: 1 })
    if (e.hp <= 0) dead.push(e)

    // 濺射。只打已經進場的怪，近的先吃，最多 splashMax 隻——
    // 不設上限的話後面幾關一發就清場，法師會變成唯一解。
    if (job.splash > 0 && job.splashShare > 0) {
      const near = S.enemies
        .filter((o) => o !== e && o.entered)
        .map((o) => ({ o, d: Math.hypot(o.x - e.x, o.y - e.y) }))
        .filter((x) => x.d <= job.splash)
        .sort((a, b) => a.d - b.d)
        .slice(0, job.splashMax)
      if (near.length) {
        const dmg = Math.max(1, Math.round(total * job.splashShare))
        S.rings.push({ x: e.x, y: e.y - 20, r: 20, max: job.splash, life: 0.5, dur: 0.5, color: '#9fd0ff' })
        for (const { o } of near) {
          o.hp -= dmg
          o.shake = 0.25
          S.pops.push({ x: o.x + 14, y: o.y - 34, text: '-' + dmg, color: '#9fd0ff', life: 0.8 })
          if (o.hp <= 0) dead.push(o)
        }
      }
    }

    if (dead.length) {
      ctx.audio.play('enemy-die')
      for (const d of dead) {
        gainCrystals(d.boss ? CRYSTAL.perKill * 5 : CRYSTAL.perKill, d.x, d.y - 70)
        killEnemy(d)
      }
    } else ctx.audio.play('enemy-hit')
    pickQuestion()
  }

  /**
   * 用一個道具。
   *
   * 容器負責「有沒有這個道具、用掉之後要寫回哪裡」，遊戲只負責「效果長什麼樣」——
   * 跟金幣一樣，遊戲碰不到背包，它只知道有人叫它做一件事。
   * 回傳 false 代表現在用了會浪費（例如血是滿的），容器就不會把道具扣掉。
   */
  function useItem(id: string): boolean {
    if (S.phase === 'done') return false
    switch (id) {
      case 'slow-30': {
        if (S.phase !== 'battle') { toast('開戰之後才用得到，不然會浪費'); return false }
        if (S.buffs.some((b) => b.id === id)) { toast('地面已經結霜了，等它退了再用'); return false }
        S.buffs.push({ id, icon: 'frost', name: '寒霜', left: SLOW_SECONDS, dur: SLOW_SECONDS })
        toast('地面結霜了，怪走得很慢')
        // 從城堡往外掃一圈，讓人看得出來是整片地結霜，不是只有一個點
        S.rings.push({ x: layout.castle.x - 200, y: (layout.land.r0 + layout.land.r1) * 32,
          r: 20, max: 900, life: 1.1, dur: 1.1, color: '#9fd0ff' })
        for (const e of S.enemies) {
          S.rings.push({ x: e.x, y: e.y - 18, r: 6, max: 46, life: 0.55, dur: 0.55, color: '#bfe6ff' })
          S.pops.push({ x: e.x, y: e.y - 52, text: '', icon: 'frost', color: '#bfe6ff', life: 0.9 })
        }
        ctx.audio.play('explosion')
        syncUI()
        return true
      }
      case 'heal-5':
        if (S.hp >= rules.castleHp) { toast('城堡是滿血的，留著下次用'); return false }
        S.hp = Math.min(rules.castleHp, S.hp + 5)
        toast('城牆補好了')
        // 修士的治療特效，素材包裡本來就有（見 tools/build-td-art.py）
        S.fx.push({ kind: 'heal', x: layout.castle.x - 6, y: layout.castle.y - 54, t: 0, dur: 0.9, size: 190 })
        S.pops.push({ x: layout.castle.x - 40, y: layout.castle.y - 70, text: '+5', icon: 'heart', color: '#9de8a0', life: 1.2 })
        ctx.audio.play('tower-build')
        syncUI()
        return true
      case 'crystal-40': {
        // 一顆一顆冒出來，比一個 +40 有感
        for (let i = 0; i < 8; i++)
          S.pops.push({ x: layout.castle.x - 150 + Math.random() * 180,
            y: layout.castle.y - 60 - Math.random() * 60, text: '', icon: 'crystal', color: '#8fd8ff', life: 0.7 + i * 0.09 })
        gainCrystals(40, layout.castle.x - 60, layout.castle.y - 110)
        toast('補給到了，多蓋一座塔吧')
        return true
      }
      default:
        return false
    }
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
    if (S.crystals < spec.cost) return toast('水晶不夠，還差 ' + (spec.cost - S.crystals) + ' 顆')
    S.crystals -= spec.cost
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
    S.crystals += back
    S.towers.splice(i, 1)
    S.selected = null
    ctx.audio.play('tower-sell')
    toast('拆掉了，退回 ' + back + ' 顆水晶')
    syncUI()
  }

  /**
   * 士兵要站在路的哪一點。
   *
   * 原本是「離軍營最近的路點」，結果士兵常常站在沒有任何箭塔罩得到的地方，
   * 怪纏在那裡誰也打不到。這不是個案：魔王關八個塔位裡有五個是這種。
   *
   * 現在改成在軍營走得到的範圍內，挑**被最多箭塔罩到**的那一點，
   * 一樣近的就挑離軍營近的。附近完全沒有箭塔罩得到（例如開場還沒蓋塔）
   * 就退回最近的路點。士兵每次重生都會重算，所以後來才蓋的箭塔
   * 會把士兵吸進火力網裡，玩家亂放也不會白放。
   */
  function makeSoldier(slotIdx: number): Soldier {
    const s = SLOTS[slotIdx]
    const archers = S.towers.filter((t) => t.kind === 'archery').map((t) => SLOTS[t.slot])
    // 跟 data/levels.ts 的 volleyOf 用同一個判定，不然難度算出來的跟實際打到的會不一樣
    const covered = (px: number, py: number) =>
      archers.reduce((n, a) => n + (Math.hypot(a.x - px, a.y - 20 - (py - 22)) <= TOWERS.archery.range ? 1 : 0), 0)

    type Spot = { score: number; d: number; x: number; y: number; path: number; dist: number }
    const spots: Spot[] = []
    PATHS.forEach((pts, pi) => {
      for (let d = 0; d < PATH_LEN[pi]; d += 6) {
        const p = pointAt(pts, d)
        spots.push({
          score: covered(p.x, p.y), d: Math.hypot(p.x - s.x, p.y - s.y),
          x: p.x, y: p.y, path: pi, dist: d,
        })
      }
    })
    // 走得到而且真的有箭塔罩得到的點優先；一個都沒有就退回最近的點。
    const reachable = spots.filter((sp) => sp.d <= SOLDIER_REACH && sp.score > 0)
    const pool = reachable.length ? reachable : spots
    const b = pool.reduce((a, c) => (c.score > a.score || (c.score === a.score && c.d < a.d) ? c : a))
    return { x: b.x, y: b.y, path: b.path, dist: b.dist, hp: TOWERS.barracks.soldierHp!, respawn: 0 }
  }

  // ---------------------------------------------------------------- 每幀
  function update(dt: number) {
    S.t += dt
    hero.update(dt)
    if (S.cooldown > 0) S.cooldown -= dt

    if (S.phase === 'battle') {
      S.spawnTimer -= dt
      // 場上少於兩隻就提前把下一隻放出來。整波的怪數不變，所以難度不變，
      // 但玩家不會再遇到「只剩一隻卻不能打，只能看著牠走」的空窗。
      const alive = S.enemies.length
      if (S.spawnQueue.length && (S.spawnTimer <= 0 || alive < 2)) {
        spawnNext()
        S.spawnTimer = alive < 2 ? Math.min(S.spawnGap, 0.8) : S.spawnGap
      }

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
        // 士兵是「纏住」不是「擋死」。擋死會產生一個修不掉的壞情況：
        // 卡點如果在所有箭塔的射程外，那隻怪就永遠停在那裡，誰也打不到牠。
        // 拖慢之後怪再慢也一定會走進箭塔的範圍，那個壞情況就消失了，
        // 而軍營原本的用處（替你爭取時間）完全保留。
        if (blocker) blocker.hp -= dt * 9
        e.dist += e.speed * (blocker ? SOLDIER_SLOW : 1) * slowFactor() * dt

        const p = pointAt(PATHS[e.path], e.dist)
        e.x = p.x; e.y = p.y
        if (!e.entered && e.x > ENTER_X) e.entered = true

        if (e.dist >= PATH_LEN[e.path]) {
          S.hp -= e.boss ? 3 : 1
          ctx.audio.play('castle-hit')
          S.pops.push({ x: layout.castle.x - 40, y: layout.castle.y - 70, text: '-1', icon: 'heart', color: '#ff9a94', life: 1.1 })
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
        gainCrystals(CRYSTAL.perWave, layout.castle.x - 60, layout.castle.y - 100)
        syncUI(); syncQuiz()
      }
    }

    // 狀態倒數。停在備戰畫面的時候不扣，不然玩家在蓋塔它就默默退光了。
    if (S.phase === 'battle') {
      for (const b of S.buffs) b.left -= dt
      const before = S.buffs.length
      S.buffs = S.buffs.filter((b) => b.left > 0)
      if (S.buffs.length !== before) { toast('寒霜退了'); syncUI() }
    }
    S.fx = S.fx.filter((f) => (f.t += dt) < f.dur)

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
  // 規則本身在 plates.ts（純幾何，量得出來），這裡只負責量字寬和挑出該排的怪。
  function layoutPlates() {
    c2d.font = PLATE_FONT
    const list = S.enemies.filter((e) => e.entered)
    for (const e of list) e.pw = Math.max(58, c2d.measureText(e.word.word).width + 24)
    runPlateLayout(list, PLATE_RULES)
  }

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
    const water = skinned('water'), tiles = skinned('tiles')
    if (water?.complete) {
      g.fillStyle = g.createPattern(water, 'repeat')!
      g.fillRect(0, 0, W, H)
    } else { g.fillStyle = '#2a5b8f'; g.fillRect(0, 0, W, H) }

    const tile = (sc: number, sr: number, dx: number, dy: number) => {
      if (tiles?.complete) g.drawImage(tiles, sc * 64, sr * 64, 64, 64, dx, dy, 64, 64)
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

  /**
   * 地圖還沒下載完的時候畫這個。以前這裡只是一塊純綠色，看起來就像壞掉的地圖，
   * 小朋友會以為關卡本來就長這樣；寫一句話出來才知道是在等。
   */
  function drawLoadingField() {
    c2d.fillStyle = '#6ea84f'; c2d.fillRect(0, 0, W, H)
    c2d.save()
    // 蓋塔位的虛線圈也畫在這片綠色上，字直接寫上去會跟它們糊在一起，
    // 所以墊一塊深色底再寫。
    c2d.font = 'bold 30px system-ui, sans-serif'
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    const t = '地圖載入中…'
    const w = c2d.measureText(t).width + 56
    c2d.fillStyle = 'rgba(20,30,20,.6)'
    roundRect(W / 2 - w / 2, H / 2 - 27, w, 54, 27); c2d.fill()
    c2d.fillStyle = '#fff'
    c2d.fillText(t, W / 2, H / 2 + 1)
    c2d.restore()
  }

  function draw() {
    if (!terrain && img.tiles) buildTerrain()
    if (terrain) c2d.drawImage(terrain, 0, 0)
    else drawLoadingField()

    if (S.phase === 'build') drawBuildHints()
    drawFrost() // 地面那一層要壓在人和塔底下，所以畫在排序之前

    // 所有站在地上的東西照「腳下的 y」由遠到近排，遮擋關係才會對
    const scene: { y: number; f: () => void }[] = []
    for (const d of layout.decor) scene.push({ y: d.y, f: () => drawDecor(d) })
    scene.push({ y: layout.castle.y, f: drawCastle })
    scene.push({ y: hero.y, f: () => hero.draw(c2d) })
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
      // 本來這裡寫死 0.42（當時只有一種圈圈），命長一點的圈圈會算出負的半徑，
      // canvas 直接丟例外，整個遊戲畫面就停在那裡。改成用它自己的 dur。
      const t = 1 - r.life / r.dur
      c2d.strokeStyle = r.color; c2d.globalAlpha = (1 - t) * 0.9; c2d.lineWidth = 4
      c2d.beginPath(); c2d.arc(r.x, r.y, r.r + (r.max - r.r) * t, 0, 7); c2d.stroke()
      c2d.globalAlpha = 1
    }
    hero.drawFx(c2d)
    // 一次性的圖片特效。治療用的是素材包裡修士的 Heal_Effect，11 格。
    for (const f of S.fx) {
      const im = img[f.kind]
      if (!im?.complete) continue
      const frames = Math.max(1, Math.round(im.width / im.height))
      const k = Math.min(frames - 1, Math.floor((f.t / f.dur) * frames))
      const cell = im.width / frames
      c2d.drawImage(im, k * cell, 0, cell, im.height,
        f.x - f.size / 2, f.y - f.size / 2, f.size, f.size)
    }
    for (const p of S.pops) {
      c2d.globalAlpha = Math.min(1, p.life)
      c2d.font = 'bold 17px system-ui, sans-serif'; c2d.textBaseline = 'alphabetic'
      c2d.lineWidth = 3.5; c2d.strokeStyle = 'rgba(0,0,0,.6)'
      // 圖示還沒載好就只寫字——畫沒載好的圖會丟例外，那會把整個迴圈打斷。
      const im = p.icon ? popIcon(p.icon) : null
      const SZ = 20
      if (im && p.text) {
        c2d.textAlign = 'left'
        const left = p.x - (SZ + 3 + c2d.measureText(p.text).width) / 2
        c2d.drawImage(im, left, p.y - SZ + 3, SZ, SZ)
        c2d.strokeText(p.text, left + SZ + 3, p.y)
        c2d.fillStyle = p.color; c2d.fillText(p.text, left + SZ + 3, p.y)
      } else if (im) {
        c2d.drawImage(im, p.x - SZ / 2, p.y - SZ, SZ, SZ)
      } else {
        c2d.textAlign = 'center'
        c2d.strokeText(p.text, p.x, p.y)
        c2d.fillStyle = p.color; c2d.fillText(p.text, p.x, p.y)
      }
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
    // 英雄守的那一圈，讓人知道城堡門口有人顧，箭塔可以蓋前面一點
    c2d.save()
    c2d.setLineDash([4, 6]); c2d.strokeStyle = 'rgba(159,208,255,.55)'; c2d.lineWidth = 2
    c2d.beginPath(); c2d.arc(GATE.x, GATE.y, HERO.reach, 0, 7); c2d.stroke()
    c2d.fillStyle = 'rgba(159,208,255,.06)'; c2d.fill()
    c2d.restore()
  }

  function drawDecor(d: { k: string; x: number; y: number }) {
    const im = skinned(d.k)
    if (!im?.complete) return
    shadow(d.x, d.y - 3, im.width * 0.3)
    c2d.drawImage(im, d.x - im.width / 2, d.y - im.height, im.width, im.height)
  }

  /**
   * 拿這個陣營顏色的圖。素材包每一棟建築和每一個兵都有五色，
   * 藍色是預設所以鍵名不帶後綴。沒有那一色就退回藍色，畫面不會空掉。
   */
  function art(key: string): HTMLImageElement | undefined {
    if (LEGION_KEYS.includes(key)) {
      const im = img[legion.prefix + key]
      if (legion.prefix && im) return im
    }
    return img[key + ctx.color] ?? img[key]
  }

  function drawCastle() {
    const im = art(CASTLE_KEY) ?? art('castle')
    if (!im?.complete) return
    shadow(layout.castle.x, layout.castle.y - 6, 62)
    // 城堡原圖縮一半是 160×128，一直是畫成 150×120；神殿用同一個倍率，高度照它自己的
    const w = im.width * 0.9375, h = im.height * 0.9375
    c2d.drawImage(im, layout.castle.x - w / 2, layout.castle.y - h, w, h)
  }

  function drawTower(t: Tower, s: Point) {
    const im = art(t.kind)
    if (!im?.complete) return
    shadow(s.x, s.y - 4, 34)
    c2d.drawImage(im, s.x - 39, s.y - 102, 78, 104)
  }

  function drawSoldier(sd: Soldier) {
    const w = art('warrior')
    if (w?.complete) {
      shadow(sd.x, sd.y + 2, 20)
      c2d.drawImage(w, sd.x - 42, sd.y - 63, 84, 84)
    }
    bar(sd.x - 19, sd.y - 48, 38, 5, sd.hp / TOWERS.barracks.soldierHp!, '#6fbf4a')
  }

  /**
   * 結霜的視覺。道具的問題不是效果不夠強，是**看不出來它在生效**，
   * 所以這裡分三層：整片地面偏藍、每隻怪身上一層霜、頭上一片雪花。
   */
  function drawFrost() {
    if (!S.buffs.some((b) => b.id === 'slow-30')) return
    const y0 = layout.land.r0 * 64, y1 = layout.land.r1 * 64 + 64
    c2d.save()
    // 淡淡的藍在綠色草地上幾乎看不出來，小朋友要一眼看得出「地上結霜了」，
    // 所以這裡刻意上得比較重。
    c2d.globalAlpha = 0.3
    c2d.fillStyle = '#9fd0ff'
    c2d.fillRect(0, y0, W, y1 - y0)
    c2d.globalAlpha = 0.8
    c2d.strokeStyle = '#eaf7ff'; c2d.lineWidth = 2.5
    // 沿著上下緣畫一排冰稜，一眼看得出這一片是結霜的範圍
    for (let x = 8; x < W; x += 34) {
      c2d.beginPath(); c2d.moveTo(x, y0); c2d.lineTo(x + 8, y0 + 11); c2d.lineTo(x + 16, y0); c2d.stroke()
      c2d.beginPath(); c2d.moveTo(x, y1); c2d.lineTo(x + 8, y1 - 11); c2d.lineTo(x + 16, y1); c2d.stroke()
    }
    c2d.restore()
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
    if (S.buffs.some((b) => b.id === 'slow-30')) {
      c2d.globalAlpha = 0.38
      c2d.fillStyle = '#9fd0ff'
      c2d.beginPath(); c2d.ellipse(e.x + sh, e.y - 22, 24, 27, 0, 0, 7); c2d.fill()
      c2d.globalAlpha = 1
      const fi = popIcon('frost')
      if (fi) c2d.drawImage(fi, e.x + sh - 9, e.y - 65, 18, 18)
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

  /**
   * 飄字用的道具圖示。畫布畫不了 CSS 的 <img>，所以自己留一份。
   * **沒載好就不畫**——沒載完的圖 drawImage 會丟例外，畫面會直接定住。
   */
  const popIcons = new Map<string, HTMLImageElement>()
  function popIcon(name: string): HTMLImageElement | null {
    let im = popIcons.get(name)
    if (!im) {
      im = new Image()
      im.src = iconUrl(name as 'frost')
      popIcons.set(name, im)
    }
    return im.complete && im.naturalWidth > 0 ? im : null
  }

  // ---------------------------------------------------------------- UI
  function syncUI() {
    elHp.innerHTML = iconImg('heart', 15) + ' ' + Math.max(0, S.hp)
    elCoin.innerHTML = iconImg('crystal', 15) + ' ' + S.crystals
    elWave.textContent = `第 ${S.wave} / ${rules.waves.length} 波`
    const build = S.phase === 'build'
    elTray.hidden = !build
    elGo.textContent = '開始第 ' + S.wave + ' 波'
    elSay.disabled = !S.target
    const sel = S.selected !== null ? S.towers.find((t) => t.slot === S.selected) : undefined
    elSell.hidden = !sel
    if (sel) {
      const back = refundOf(TOWERS[sel.kind].cost, sel.builtAtWave < S.wave)
      elSell.innerHTML = `拆除 ${TOWERS[sel.kind].name}（退 ${back} ${iconImg('crystal', 13)}）`
    }
  }

  /**
   * 狀態列：正在生效的道具效果 ＋ 倒數條。
   *
   * 每一格都重畫太浪費，所以只在顯示出來的秒數變了才重建 DOM。
   */
  let buffSig = ''
  function syncBuffs() {
    const sig = S.buffs.map((b) => b.id + ':' + Math.ceil(b.left)).join(',')
    if (sig === buffSig) return
    buffSig = sig
    elBuffs.innerHTML = S.buffs
      .map((b) => `<span class="td-buff"><i><img class="ic-img" src="${iconUrl(b.icon as 'frost')}" alt=""></i>${b.name}<b>${Math.ceil(b.left)}s</b>`
        + `<u style="width:${Math.max(0, Math.min(100, (b.left / b.dur) * 100)).toFixed(1)}%"></u></span>`)
      .join('')
  }

  function syncQuiz() {
    if (S.target) {
      // 題目的 emoji 是題庫的內容不是介面圖示，所以照樣用 textContent
      elEmoji.textContent = S.target.word.emoji
      elZh.textContent = S.target.word.zh
      elHint.textContent = `（${S.target.word.pos}）點出寫著這個字的怪`
    } else if (S.phase === 'build') {
      elEmoji.innerHTML = iconImg('shield', 24)
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
  /**
   * 點到哪一隻。字牌（上面寫字的那塊）優先：字牌有 plates.ts 推開，不會疊。
   * 身體會疊——路線交叉的關（例如第 8 關）怪擠在交叉口，以前是「迴圈先碰到哪隻算哪隻」，
   * 小朋友明明點在對的那隻身上卻算到旁邊那隻（2026-09-26 🌙 回報「交叉口會亂掉」）。
   * 所以身體疊在一起時，裡面有題目那隻就算點到牠。
   */
  function pickHit(x: number, y: number): Enemy | null {
    let plate: Enemy | null = null
    const bodies: Enemy[] = []
    let near: Enemy | null = null
    let nd = 46
    for (const e of S.enemies) {
      if (!e.entered) continue // 還沒完全進場的怪不能被點
      const py = plateY(e)
      const inPlate = x >= e.px - e.pw / 2 - 4 && x <= e.px + e.pw / 2 + 4 && y >= py - 4 && y <= py + PLATE_H + 4
      if (inPlate) { plate = e; break }
      const inBody = x >= e.x - 30 && x <= e.x + 30 && y >= e.y - 48 && y <= e.y + 6
      if (inBody) { bodies.push(e); continue }
      const d = Math.min(Math.hypot(e.x - x, e.y - 22 - y), Math.hypot(e.px - x, py + PLATE_H / 2 - y))
      if (d < nd) { nd = d; near = e }
    }
    if (plate) return plate
    if (bodies.length) return bodies.find((e) => e === S.target) ?? bodies[0]
    return near
  }

  function onPointerDown(ev: PointerEvent) {
    if (S.phase === 'done' || paused) return
    ctx.audio.unlock()
    const r = cv.getBoundingClientRect()
    const x = ((ev.clientX - r.left) * W) / r.width
    const y = ((ev.clientY - r.top) * H) / r.height

    if (S.phase === 'battle') {
      const hit = pickHit(x, y)
      if (hit) tapEnemy(hit)
      else S.rings.push({ x, y, r: 6, max: 30, life: 0.3, dur: 0.3, color: 'rgba(255,255,255,.7)' })
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
  let artKick = last
  function loop(now: number) {
    if (dead) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (S.phase !== 'done' && !paused) update(dt)
    // 地圖的圖還沒到就每三秒再敲一次。loadArt 正在跑就跟著同一趟，
    // 上一趟放棄了才會重開，所以在關卡裡也救得回來，不用退出去重進。
    if (!img.tiles && now - artKick > 3000) { artKick = now; void loadArt() }
    syncBuffs()
    draw()
    raf = requestAnimationFrame(loop)
  }

  void loadArt()

  // 開發模式下把內部狀態開出來，自動測試才驗得到難度曲線與出題漏洞。
  // 正式版 build 會整段消失（import.meta.env.DEV 在 production 是 false）。
  if (import.meta.env.DEV) {
    ;(window as unknown as { __td?: unknown }).__td = {
      S, SLOTS, level, tapEnemy, tapSlot, sellSelected, startWave, useItem,
    }
  }

  syncUI(); syncQuiz()
  raf = requestAnimationFrame(loop)

  return {
    useItem,
    setPaused(on: boolean) {
      paused = on
      // 暫停期間時間會一直走，恢復時把 last 拉回來，不然會一口氣補一大格
      last = performance.now()
    },
    destroy() {
      dead = true
      unArt()
      cancelAnimationFrame(raf)
      cv.removeEventListener('pointerdown', onPointerDown)
      try { speechSynthesis.cancel() } catch { /* 有些瀏覽器沒有 */ }
      root.innerHTML = ''
    },
  }
}
