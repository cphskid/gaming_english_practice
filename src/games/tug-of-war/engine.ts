import type { GameContext, GameHandle, Opponent, Word } from '@/core/types'
import { makeFeeder } from '@/core/opponent'
import { loadArt } from '../tower-defense/art'
import { PLATE_RULES, layoutPlates, plateY, type Plate } from '../tower-defense/plates'
import {
  LINES, LINE_IDS, MAX_TIER, RULES, nextCost, newBattle, pushed, statsOf, step, strike,
  summon, upgrade, type Line, type Unit,
} from './battle'

const W = 1088
const H = 576
const TILE = 64
const COLS = 17
const ROAD_Y = 402
const LAND = { r0: 2, r1: 6 }
/** 答完一題到下一題之間的冷卻。**比的是英文不是手速**，所以這個不能拿掉。 */
const ANSWER_COOLDOWN = 0.3
/**
 * 場上同時掛幾塊字牌。
 *
 * 第一版每隻敵兵都掛一塊，兵一擠在一起（間隔 34px，比牌子還窄）牌子就排不下，
 * 一直換位置——Chuck 說的「字母會飄」。只掛最前面幾隻就不擠了，
 * 而且「點對的那一隻」才重新有意義。三塊是為了還有得選，不會只剩一個答案。
 */
const TAPPABLE = 3

/** 拼字題的錯誤選項從這裡抽。母音也放進去，不然一眼就看得出哪個是答案。 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const PRESS = 0.22
/** 一支箭在空中的時間。太短就變成一閃而過，孩子會以為什麼都沒發生。 */
const ARROW_LIFE = 0.32
/** 剩下這麼多秒的時候，音樂開始變快。Chuck 要的「最後三十秒節奏變急」。 */
const RUSH_AT = 30

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
  <div class="tw-bar">
    <button class="tw-line" data-line="recognize">👁️<b>認字</b></button>
    <button class="tw-line" data-line="listen">👂<b>聽音</b></button>
    <button class="tw-line" data-line="spell">✍️<b>拼字</b></button>
    <button class="tw-up">⬆️<b>升階</b><i></i></button>
    <span class="tw-crystal">💎 0</span>
  </div>
</div>`

/** 場上一個點得到的東西：敵方最前面那幾隻兵，或敵方城牆上的守衛。 */
interface Target extends Plate {
  id: string
  word: Word
  /** 牌子上真正寫的字。認字與聽音是整個單字，拼字是一個字母。 */
  label: string
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
  const elLines = [...root.querySelectorAll<HTMLButtonElement>('.tw-line')]
  const elUp = $<HTMLButtonElement>('.tw-up')
  const elUpCost = $('.tw-up i')
  const elCrystal = $('.tw-crystal')
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
    /**
     * 敵方城牆上的守衛。對手兵太少的時候補上來，不然沒有東西可以點。
     * **打掉守衛不會扣城堡的血**，只是換你一隻兵——城堡的血只能被兵啃掉。
     */
    shieldWords: [null, null, null] as (Word | null)[],
    /** 箭塔射出去的箭，只是畫面 */
    arrows: [] as { x0: number; y0: number; x1: number; y1: number; life: number }[],
    /**
     * 現在用哪一條兵種線。換線就是換題型——這是玩家在戰場上唯一要做的選擇。
     */
    line: 'recognize' as Line,
    /**
     * 這條線已經連對幾題。滿了兵階上限就出一隻該階的兵。
     * **答錯不會整個沒收，是結算成目前累積到的階**，不然沒有人敢賭四個字。
     */
    pending: 0,
    /** 拼字題挖掉第幾個字母 */
    blank: 0,
    /** 電腦對手的累積與現在走哪條線 */
    botPending: 0,
    botLine: 'recognize' as Line,
    /** 最後三十秒的音樂加速只做一次 */
    rushed: false,
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

  /** 某一邊最前面那幾隻（＝畫面上掛得到字牌、點得到的那幾隻） */
  function tappable(side: 'me' | 'foe') {
    const d = side === 'foe' ? 1 : -1
    return S.battle.units
      .filter((u) => u.side === side && u.hp > 0)
      .sort((a, b) => (a.x - b.x) * d)
      .slice(0, TAPPABLE)
  }

  /**
   * 對手答對了。
   *
   * 他那一槍**要跟人一樣會落空**：人看到的是場上 TAPPABLE 個目標，兵不夠的時候
   * 補城牆守衛，抽到守衛那一槍就沒打到東西。電腦如果一律打中我最前面那隻，
   * 它就比人多一份火力——實測會變成三十秒把人的城堡打到剩 16 血，
   * 而平衡量測（那邊兩邊都有算落空）說不該發生。引擎跟平衡量測要跑同一套規則。
   */
  const feed = makeFeeder(foe, (correct) => {
    // **電腦跟人跑同一套規則**：一樣要累積、一樣有水晶、一樣被上限拖慢出兵速度，
    // 答錯一樣把累積的結算出去。少了任何一條，平衡量測量到的就不是玩家會遇到的東西。
    // 這段跟 tools/test/tug-balance.mjs 的 act() 必須逐行對得上。
    if (!correct) {
      if (S.botPending > 0) {
        summon(S.battle, 'foe', S.botLine, Math.min(S.botPending, S.battle.tier.foe), R)
        S.botPending = 0
      }
      return
    }
    S.battle.crystal.foe += R.answerCrystal
    S.botPending++
    if (S.botPending >= S.battle.tier.foe) {
      summon(S.battle, 'foe', S.botLine, S.battle.tier.foe, R)
      S.botPending = 0
    }
    // 有錢就升階。不是最佳解（升階會拖慢出兵），但夠當個老實的對手。
    upgrade(S.battle, 'foe')
    // 每 45 秒換一條線，讓小朋友三種兵都看得到、也都被打過。
    S.botLine = LINE_IDS[Math.floor(S.battle.t / 45) % LINE_IDS.length]
    const mine = tappable('me')
    strike(S.battle, 'foe', mine[(Math.random() * TAPPABLE) | 0] ?? null, R)
  })

  // ------------------------------------------------------------------ 題目
  function freshWord(): Word | null {
    // 題型跟著兵種線走。容器會照題型各開一份出題器，所以複習權重不會混在一起。
    const q = ctx.nextQuestion(LINES[S.line].skill)
    return q ? q.word : null
  }

  /**
   * 重寫每塊牌子上要顯示什麼。
   *
   * 認字與聽音：牌子上是整個英文單字，點出題目問的那一個。
   * 拼字：題目把單字挖掉一個字母，**牌子上改成單獨一個字母**，點正確的那個。
   *
   * 為什麼拼字不做成用鍵盤打：橫式戰場上叫出鍵盤會蓋掉半個畫面，而且
   * 三條線最好共用同一種操作——全部都是「點一隻兵」，小朋友只要學一次。
   * 單獨一個字母也比一整個單字好點，剛好治 Chuck 說的「字很小會點錯」。
   */
  function relabel() {
    const list = [...S.targets.values()]
    const asked = S.target ? S.targets.get(S.target) : null
    if (S.line !== 'spell' || !asked) {
      for (const t of list) t.label = t.word.word
      return
    }
    const w = asked.word.word
    const i = Math.min(S.blank, w.length - 1)
    const right = w[i].toLowerCase()
    const used = new Set([right])
    for (const t of list) {
      if (t === asked) { t.label = right.toUpperCase(); continue }
      let c = right
      for (let tries = 0; tries < 40 && used.has(c); tries++) c = LETTERS[(Math.random() * 26) | 0]
      used.add(c)
      t.label = c.toUpperCase()
    }
  }

  /**
   * 場上所有點得到的東西，每一格重建一次（兵會死、會出生）。
   *
   * 只有**最前面 TAPPABLE 隻**敵兵掛得到字牌，後面那一長串不掛——
   * 這是「字母會飄」的解法，見 TAPPABLE 的說明。
   * 正在問的那一題就算掉出前幾名也留著，不然字會在你正要點的時候換掉。
   */
  function syncTargets() {
    const seen = new Set<string>()

    // 正在問的那一隻排第一位，剩下的名額才給最前面的——這樣總數仍然是 TAPPABLE，
    // 而且字不會在你正要點下去的時候換掉。
    const asked = S.target?.startsWith('u') ? Number(S.target.slice(1)) : -1
    const show = new Set<number>()
    if (S.battle.units.some((u) => u.id === asked && u.side === 'foe')) show.add(asked)
    for (const u of tappable('foe')) {
      if (show.size >= TAPPABLE) break
      show.add(u.id)
    }

    for (const u of S.battle.units) {
      if (u.side !== 'foe' || !show.has(u.id)) continue
      const id = 'u' + u.id
      seen.add(id)
      let t = S.targets.get(id)
      if (!t) {
        const w = freshWord()
        if (!w) continue
        t = {
          id, word: w, label: w.word, unit: u, press: 0, good: 0, bad: 0, shake: 0,
          x: u.x, y: ROAD_Y - 74, pw: 0, px: u.x, ptx: u.x, tier: 0, laid: false, hold: 0,
        }
        S.targets.set(id, t)
      }
      t.unit = u
      t.x = u.x
      t.y = ROAD_Y - 74
    }

    // 城牆上的守衛。只在敵兵不夠的時候補上來，把場上湊滿 TAPPABLE 個選項。
    // **打掉它不扣城堡的血**（strike 已經不准打城堡了），只是換你一隻兵。
    const guards = Math.max(0, TAPPABLE - seen.size)
    for (let i = 0; i < guards; i++) {
      const id = 's' + i
      seen.add(id)
      if (!S.shieldWords[i]) S.shieldWords[i] = freshWord()
      const w = S.shieldWords[i]
      if (!w) continue
      let t = S.targets.get(id)
      const x = R.homeFoe + [-34, 18, 58][i]
      const y = ROAD_Y - [142, 108, 150][i]
      if (!t) {
        t = {
          id, word: w, label: w.word, unit: null, press: 0, good: 0, bad: 0, shake: 0,
          x, y, pw: 0, px: x, ptx: x, tier: 0, laid: false, hold: 0,
        }
        S.targets.set(id, t)
      }
      t.word = w
      t.x = x; t.y = y
    }

    for (const id of [...S.targets.keys()]) if (!seen.has(id)) S.targets.delete(id)
    if (S.target && !S.targets.has(S.target)) pickQuestion()
    else relabel()   // 這一格新生的牌子還寫著整個單字，拼字題要換成字母
  }

  function pickQuestion() {
    const list = [...S.targets.values()]
    if (!list.length) { S.target = null; return syncQuiz() }
    const pick = list[(Math.random() * list.length) | 0]
    S.target = pick.id
    // 拼字題挖掉一個字母。第一個字母不挖——挖了幾乎等於直接問「這個字怎麼開頭」，
    // 太好猜，而且看不出有沒有真的會拼。
    const w = pick.word.word
    S.blank = w.length > 1 ? 1 + ((Math.random() * (w.length - 1)) | 0) : 0
    S.asked++
    S.askedAt = performance.now()
    relabel()
    syncQuiz()
    // 聽音題的題目本身就是聲音，所以出題就唸。
    if (S.line === 'listen') speak(w)
  }

  function syncQuiz() {
    const t = S.target ? S.targets.get(S.target) : null
    if (!t) {
      elEmoji.textContent = '⚔️'
      elZh.textContent = '準備開打'
      elHint.textContent = ''
      elSay.disabled = true
      return
    }
    const need = S.battle.tier.me
    const step = need > 1 ? `（${S.pending + 1}/${need}）` : ''
    if (S.line === 'listen') {
      // 中文不給看，不然用看的就答完了，根本沒在聽。
      elEmoji.textContent = '👂'
      elZh.textContent = '聽聽看'
      elHint.textContent = `${step}點出你聽到的那個字`
    } else if (S.line === 'spell') {
      const w = t.word.word
      const i = Math.min(S.blank, w.length - 1)
      elEmoji.textContent = t.word.emoji
      elZh.textContent = w.slice(0, i) + '＿' + w.slice(i + 1)
      elHint.textContent = `${step}${t.word.zh}：補上缺的字母`
    } else {
      elEmoji.textContent = t.word.emoji
      elZh.textContent = t.word.zh
      elHint.textContent = `${step}（${t.word.pos}）點出寫著這個字的目標`
    }
    elSay.disabled = false
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

  /**
   * 把累積的答題換成一隻兵。
   *
   * 累積滿上限時叫它（出滿階的兵），答錯時也叫它（出目前累積到的階）。
   * 累積是 0 就什麼都不出。
   */
  function cashOut() {
    if (S.pending <= 0) return
    const rank = Math.min(S.pending, S.battle.tier.me)
    const u = summon(S.battle, 'me', S.line, rank, R)
    S.pending = 0
    S.pops.push({
      x: R.homeMe + 40, y: ROAD_Y - 80,
      text: statsOf(u.line, u.rank).name, color: '#a8e07a', life: 1.0,
    })
  }

  /** 換一條兵種線。累積到一半的先結算出去，不然換線等於白答。 */
  function switchLine(line: Line) {
    if (S.done || paused || line === S.line) return
    cashOut()
    S.line = line
    // 題型換了，場上那些牌子的字是舊題型抽的，整批換掉才對得上。
    S.targets.clear()
    S.shieldWords = [null, null, null]
    S.target = null
    syncTargets()
    pickQuestion()
    syncBar()
    ctx.audio.play('ui-tap')
  }

  /** 按升階。水晶不夠就沒反應（鈕本來就是暗的）。 */
  function buyTier() {
    if (S.done || paused) return
    if (!upgrade(S.battle, 'me')) return
    ctx.audio.play('tower-build')
    toast(`兵階升到 ${S.battle.tier.me} 階，現在要連對 ${S.battle.tier.me} 題才出一隻`)
    syncQuiz()
    syncBar()
  }

  /** 底下那一排：哪條線亮著、升階多少錢、水晶剩多少 */
  function syncBar() {
    for (const b of elLines) b.classList.toggle('on', b.dataset.line === S.line)
    const cost = nextCost(S.battle, 'me')
    const can = cost !== null && S.battle.crystal.me >= cost
    elUp.disabled = !can
    elUpCost.textContent = cost === null ? `已滿 ${MAX_TIER} 階` : `💎 ${cost}`
    elCrystal.textContent = `💎 ${Math.floor(S.battle.crystal.me)}　${S.battle.tier.me} 階`
  }

  for (const b of elLines) {
    b.addEventListener('click', () => switchLine(b.dataset.line as Line))
  }
  elUp.addEventListener('click', buyTier)

  // ------------------------------------------------------------------ 作答
  function tap(t: Target) {
    if (S.done || paused || !S.target || S.cooldown > 0) return
    t.press = PRESS
    const correct = t.id === S.target
    const asked = S.targets.get(S.target)
    S.cooldown = ANSWER_COOLDOWN

    ctx.report({
      wordId: asked!.word.id, skill: LINES[S.line].skill, correct,
      ms: Math.round(performance.now() - S.askedAt), combo: S.combo,
    })

    if (correct) {
      S.correct++; S.combo++
      t.good = 0.45
      buzz(14)
      ctx.audio.play('answer-correct')
      // 答對一定做的事：對你點的那個開一槍（打不到城堡，見 battle.ts 的 strike）、
      // 拿水晶。**出不出兵要看累積夠了沒**——兵階上限是幾，就要連對幾題。
      strike(S.battle, 'me', t.unit, R)
      S.battle.crystal.me += R.answerCrystal
      S.flashes.push({ x: t.x, life: 0.22 })
      S.pending++
      if (S.pending >= S.battle.tier.me) cashOut()
      else S.pops.push({
        x: R.homeMe + 40, y: ROAD_Y - 80,
        text: `${S.pending}/${S.battle.tier.me}`, color: '#ffd76a', life: 0.9,
      })
      if (!t.unit) S.shieldWords[Number(t.id.slice(1))] = null   // 守衛被打掉就換一個字
      speak(t.word.word)
    } else {
      S.combo = 0
      t.bad = 0.5; t.shake = 0.35
      buzz(55)
      ctx.audio.play('answer-wrong')
      S.pops.push({ x: t.x, y: t.y - 10, text: '✗', color: '#ffb4b0', life: 0.8 })
      // **答錯不會把累積的全部沒收**，結算成目前這一階。
      // 沒有這條的話，上限四階等於要連對四題才有兵，沒有人敢按升階。
      cashOut()
    }
    syncTargets()
    pickQuestion()
    syncUI()
    syncBar()
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
    if (!S.rushed && R.seconds - S.battle.t <= RUSH_AT) {
      S.rushed = true
      ctx.audio.setMusicRate(1.12)
    }
    feed(S.battle.t)
    for (const h of step(S.battle, dt, R)) {
      if (!h.tower || h.from === undefined) continue
      const from = h.side === 'me' ? towerX('foe') : towerX('me')
      S.arrows.push({ x0: from, y0: ROAD_Y - 92, x1: h.x, y1: ROAD_Y - 28, life: ARROW_LIFE })
    }
    syncTargets()
    if (!S.target) pickQuestion()

    for (const t of S.targets.values()) {
      for (const k of ['press', 'good', 'bad', 'shake'] as const) if (t[k] > 0) t[k] -= dt
    }
    for (const p of S.pops) { p.life -= dt; p.y -= dt * 34 }
    S.pops = S.pops.filter((p) => p.life > 0)
    for (const f of S.flashes) f.life -= dt
    S.flashes = S.flashes.filter((f) => f.life > 0)
    for (const a of S.arrows) a.life -= dt
    S.arrows = S.arrows.filter((a) => a.life > 0)

    if (S.battle.over && !S.done) finish()
  }

  function finish() {
    S.done = true
    const b = S.battle
    const win = b.winner === 'me'
    ctx.audio.playMusic(null)          // 先把 BGM 收掉，勝負那一聲才聽得清楚
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
    syncBar()
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

  /**
   * 三條線的圖都是 112×112 的方框，人物置中、腳底對齊（見 tools/build-td-art.py）。
   * 畫成 147 寬的時候，腳底剛好落在 y-3，跟舊的 84 寬 warrior 一樣高，
   * 所以換圖不會讓整排兵浮起來或陷進地裡。
   */
  const UNIT_DRAW = 147

  function drawUnit(u: Unit) {
    const spec = statsOf(u.line, u.rank)
    const y = laneY(u)
    const art = LINES[u.line].art
    const im = u.side === 'me' ? mine(art) : theirs(art)
    shadow(u.x, y + 2, 20 * spec.size)
    c2d.save()
    if (u.side === 'foe') { c2d.translate(u.x * 2, 0); c2d.scale(-1, 1) }  // 對面的兵要朝左
    const sc = spec.size
    c2d.translate(u.x, y); c2d.scale(sc, sc); c2d.translate(-u.x, -y)
    if (im?.complete) c2d.drawImage(im, u.x - UNIT_DRAW / 2, y - 94, UNIT_DRAW, UNIT_DRAW)
    c2d.restore()
    // 軍階標記：二階一槓、三階兩槓、四階一顆星。體型之外再給一個記號，
    // 因為手機上 1.15 跟 1.3 的差別其實不明顯。
    //
    // **畫在縮放之外**，高度跟血條一樣固定。跟著體型縮放的話，四階那顆星
    // 會被推到頭頂上方老遠，看起來像飄在半空中的另一個東西。
    if (u.rank > 1) {
      c2d.fillStyle = u.side === 'me' ? '#ffe08a' : '#ffc0bc'
      if (u.rank === MAX_TIER) {
        c2d.font = 'bold 13px system-ui'
        c2d.textAlign = 'center'
        c2d.fillText('★', u.x, y - 56)
      } else {
        for (let i = 0; i < u.rank - 1; i++) c2d.fillRect(u.x - 8 + i * 9, y - 61, 6, 3)
      }
    }
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

  /**
   * 城堡旁邊的箭塔。
   *
   * 這一座在第一版是**隱形的**：規則裡寫著「城堡周圍 towerRange 內會對最近的
   * 敵兵扣血」，畫面上卻什麼都沒有，所以 Chuck 問「城堡不會攻擊吧？為何有塔的
   * 火力？」。它是擋滾雪球最關鍵的一條（沒有它，快的孩子九十秒就把慢的城堡打爛），
   * 所以不能拿掉，只能畫出來。
   */
  function towerX(side: 'me' | 'foe') {
    // 離城堡遠一點，不然看起來像城堡的一部分，孩子不會知道是它在射。
    return side === 'me' ? R.homeMe + 118 : R.homeFoe - 118
  }

  function drawTower(side: 'me' | 'foe') {
    const x = towerX(side)
    const im = side === 'me' ? mine('archery') : theirs('archery')
    shadow(x, ROAD_Y - 6, 40)
    c2d.save()
    if (side === 'foe') { c2d.translate(x * 2, 0); c2d.scale(-1, 1) }
    if (im?.complete) c2d.drawImage(im, x - 52, ROAD_Y - 116, 104, 112)
    c2d.restore()
  }

  /**
   * 守備範圍：地上一層漸淡的光，越靠近自己家越亮，邊界畫一條虛線。
   * 不寫字，讓孩子自己看出來「推過這條線就會被射」。
   */
  function drawGuardZone(side: 'me' | 'foe') {
    const home = side === 'me' ? R.homeMe : R.homeFoe
    const edge = side === 'me' ? home + R.towerRange : home - R.towerRange
    // 只鋪在路的上下，不要整片草地都染色——整片會看起來像地圖破圖，
    // 而且兵本來就只走在路上，守備範圍畫在路上才看得懂。
    const top = ROAD_Y - 78
    const h = 118
    const g = c2d.createLinearGradient(home, 0, edge, 0)
    const tint = side === 'me' ? '111,191,74' : '212,80,74'
    g.addColorStop(0, `rgba(${tint},.3)`)
    g.addColorStop(1, `rgba(${tint},0)`)
    c2d.fillStyle = g
    c2d.fillRect(Math.min(home, edge), top, R.towerRange, h)
    c2d.save()
    c2d.setLineDash([5, 9])
    c2d.strokeStyle = `rgba(${tint},.45)`; c2d.lineWidth = 2
    c2d.beginPath(); c2d.moveTo(edge, top); c2d.lineTo(edge, top + h); c2d.stroke()
    c2d.restore()
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
    c2d.fillText(t.label, cx, py + 15)
    c2d.restore()
  }

  /** 箭塔射出去的箭。飛在半路上，讓人看得出是誰射的、射到誰。 */
  function drawArrows() {
    for (const a of S.arrows) {
      const k = 1 - a.life / ARROW_LIFE
      const x = a.x0 + (a.x1 - a.x0) * k
      const y = a.y0 + (a.y1 - a.y0) * k
      const ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0)
      c2d.save()
      c2d.translate(x, y); c2d.rotate(ang)
      c2d.strokeStyle = 'rgba(30,22,12,.55)'; c2d.lineWidth = 5; c2d.lineCap = 'round'
      c2d.beginPath(); c2d.moveTo(-13, 0); c2d.lineTo(9, 0); c2d.stroke()
      c2d.strokeStyle = 'rgba(255,246,214,1)'; c2d.lineWidth = 2.5
      c2d.beginPath(); c2d.moveTo(-13, 0); c2d.lineTo(9, 0); c2d.stroke()
      c2d.beginPath(); c2d.moveTo(9, 0); c2d.lineTo(2, -4.5); c2d.moveTo(9, 0); c2d.lineTo(2, 4.5); c2d.stroke()
      c2d.restore()
    }
  }

  function draw() {
    if (!terrain && img.tiles) buildTerrain()
    if (terrain) c2d.drawImage(terrain, 0, 0)
    else { c2d.fillStyle = '#3f6b39'; c2d.fillRect(0, 0, W, H) }

    drawGuardZone('me')
    drawGuardZone('foe')
    drawCastle('me')
    drawCastle('foe')
    drawTower('me')
    drawTower('foe')
    for (const u of [...S.battle.units].sort((a, b) => laneY(a) - laneY(b))) drawUnit(u)
    drawArrows()
    drawFront()

    // 字牌排版跟守塔共用同一支（純幾何，量得出來，見 plates.ts）
    c2d.font = 'bold 17px system-ui, "Segoe UI", sans-serif'
    const list = [...S.targets.values()]
    for (const t of list) t.pw = Math.max(58, c2d.measureText(t.label).width + 24)
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
      S, RULES: R, PLATES: PLATE_RULES, LINES,
      /** 換兵種線／買升階，測試用 */
      setLine: (l: Line) => switchLine(l),
      buyTier: () => buyTier(),
      /** 點某一個目標；測試用它模擬小朋友的正確率 */
      tapId: (id: string) => { const t = S.targets.get(id); if (t) tap(t) },
      ids: () => [...S.targets.keys()],
    }
  }

  syncTargets()
  pickQuestion()
  syncUI()
  toast(foe.isBot ? `對手是電腦：${foe.name}` : `對手：${foe.name}`)
  // 開戰的儀式感：號角先響，熱血 BGM 跟上。
  // 進到這個畫面之前一定點過「開打」，所以 iOS 的解鎖已經拿到了。
  ctx.audio.unlock()
  ctx.audio.play('battle-horn')
  ctx.audio.playMusic('battle')
  raf = requestAnimationFrame(loop)

  return {
    setPaused(on: boolean) {
      paused = on
      if (!on) last = performance.now()
      // 暫停（按了「離開」在問你確定嗎）的時候音樂也停，但不要從頭開始。
      ctx.audio.pauseMusic(on)
    },
    destroy() {
      cancelAnimationFrame(raf)
      // 中途離開也要把音樂收掉，不然回到選關畫面還在放。
      ctx.audio.playMusic(null)
      cv.removeEventListener('pointerdown', onDown)
      try { speechSynthesis.cancel() } catch { /* 沒有就算了 */ }
      root.innerHTML = ''
    },
  }
}
