import type { GameContext, GameHandle, LiveMove, Move, Opponent, Word } from '@/core/types'
import { makeFeeder } from '@/core/opponent'
import { iconImg, iconUrl } from '@/data/icons'
import { ART, TERRAIN_KEYS, loadArt, onArt } from '../tower-defense/art'
import { legionById, legionUnitArt } from '@/data/legions'
import {
  LINES, LINE_COST, LINE_IDS, MAX_TIER, RULES, nextCost, newBattle, pushed, statsOf, step,
  strike, summon, upgrade, OTHER, type BattleState, type Hit, type Line, type Side, type Unit,
} from './battle'
import { DELAY, Lockstep, SEAT_SIDE, TICK, mirror, mirrorHit } from './lockstep'

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
/**
 * 寒霜陷阱在兵推凍多久。
 *
 * 守塔是 15 秒，這裡砍成 8——守塔一波打完要一分多鐘，兵推整場才三分鐘，
 * 15 秒等於一場的十二分之一都在單方面推進。
 */
const FREEZE_SECONDS = 8
/** 城牆修補在兵推補多少血。兵推城堡 100 血，守塔是 20 血補 5，同樣是一成五到兩成五之間。 */
const VERSUS_HEAL = 15
/** 水晶補給。兵推升階是 30／80，所以 40 剛好是「馬上升得起一階」。 */
const VERSUS_CRYSTALS = 40

const SHELL = `
<div class="td-hud">
  <span class="td-stat td-clock">${iconImg('clock', 15)} 3:00</span>
  <span class="td-stat tw-mine">${iconImg('castle', 15)} 100</span>
  <span class="td-stat tw-theirs">🏯 100</span>
  <span class="tw-foe"></span>
  <div class="td-quiz">
    <span class="td-qemoji">⚔️</span>
    <span class="td-qzh">準備開打</span>
    <span class="td-qhint"></span>
  </div>
  <span class="td-buffs"></span>
  <button class="td-say" disabled aria-label="再念一次">🔊</button>
</div>
<div class="td-stage">
  <canvas class="td-cv" width="1088" height="576"></canvas>
  <div class="td-toast"></div>
  <div class="tw-bar">
    <button class="tw-line" data-line="recognize">${iconImg('eye', 20)}<b>認字</b></button>
    <button class="tw-line" data-line="listen">👂<b>聽音</b></button>
    <button class="tw-line" data-line="spell">${iconImg('quill', 20)}<b>拼字</b></button>
    <button class="tw-up">⬆️<b>升階</b><i></i></button>
    <span class="tw-crystal">${iconImg('crystal', 15)} 0</span>
  </div>
</div>`

/**
 * 場上一個點得到的東西：敵方最前面那幾隻兵，或敵方城牆上的守衛。
 *
 * **字牌不再黏在兵身上。** 第一版黏著，於是兵一移動字就跟著飄，而且為了
 * 塞得下只能寫很小——Chuck 在手機上「不是不會，是點錯」講的就是這個。
 * 現在字牌是上方三塊固定不動的大木牌，兵身上只留一面同色的旗子，
 * 點木牌或點那隻兵都算數。
 */
interface Target {
  id: string
  word: Word
  /** 木牌上寫的字 */
  label: string
  unit: Unit | null
  /** 佔上方哪一塊木牌（0~2），決定位置與顏色 */
  slot: number
  /** 這個目標在戰場上的位置（畫旗子與連線用） */
  x: number
  y: number
  press: number
  good: number
  bad: number
  shake: number
}

/**
 * 拼字題的版面：中間一排空格，下面一排木頭字母磚。
 *
 * **這是真的把整個字拼出來，不是選擇題。** 第一版做成「挖掉一個字母選一個」，
 * 快是快，但那練不到拼寫，Chuck 一看就說「怎麼變成填空題」。
 *
 * 字母磚 76px 寬，手機上約 45 CSS px，大拇指按得到（44 是底線）。
 */
const SPELL = { slotY: 100, slotW: 48, slotH: 58, slotGap: 8, bankY: 462, bankW: 76, bankH: 66, bankGap: 12 }

/** 三塊木牌的位置與顏色。顏色是木牌與兵身上旗子的對應關係，所以要夠不一樣。 */
const BOARD = { y: 86, h: 46, w: 258, gap: 22 }
const SLOT_COLOR = ['#e0963a', '#4fa3cf', '#ab7ad2']
const slotX = (i: number) =>
  (W - (BOARD.w * 3 + BOARD.gap * 2)) / 2 + i * (BOARD.w + BOARD.gap) + BOARD.w / 2

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
  const elBuffs = $('.td-buffs')
  const elToast = $('.td-toast')

  // 對手一定要有，不然這個遊戲沒有意義；容器負責給。
  const foe: Opponent = ctx.opponent!
  const R = RULES
  // 素材一張一張進來，ART 這個物件會就地長大，拿參考就好。
  const img = ART
  let terrain: HTMLCanvasElement | null = null
  // 戰場先畫在暫存畫布上再整張貼；圖後到的話得把它作廢重畫。
  const unArt = onArt((k) => { if (TERRAIN_KEYS.includes(k)) terrain = null })
  let artKick = performance.now()
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
     * 這一場的戰報，打完交給容器去記戰績（成就要用）。
     * 開場那一條線就算用過了，因為開場就有一隊那條線的兵。
     */
    linesUsed: new Set<Line>(['recognize']),
    topTier: 1,
    /** 整場前線最落後的時候（0＝自己城牆）。逆轉勝要用。 */
    lowestFront: 1,
    /**
     * 這條線已經連對幾題。滿了兵階上限就出一隻該階的兵。
     * **答錯不會整個沒收，是結算成目前累積到的階**，不然沒有人敢賭四個字。
     */
    pending: 0,
    /**
     * 拼字題的狀態。跟認字／聽音完全不同一套：那兩種是點場上的目標，
     * 拼字是點下面的字母磚把整個字拼出來。
     */
    spell: {
      word: null as Word | null,
      /** 還要拼幾個字母才完成 */
      filled: 0,
      /** 下面那一排字母磚 */
      bank: [] as { ch: string; used: boolean; press: number; bad: number }[],
      /** 這個字拼到現在按錯幾次。全對才算答對。 */
      slips: 0,
    },
    /** 電腦對手的累積與現在走哪條線 */
    botPending: 0,
    botLine: 'recognize' as Line,
    /**
     * 電腦答題的時間存款。對手的答題串是「認字一題」的節奏產生的，
     * 但拼一個字要花三倍時間，所以走拼字線的時候要存夠三筆才換到一題。
     * 少了這個，電腦用拼字線會用認字的速度丟出三倍強的兵。
     */
    botCredit: 0,
    /**
     * 這一場自己做過的事（答題、出兵、升階），照時間記下來。打完交給容器存起來，
     * 同學來挑戰的時候，他打的就是這一串重播出來的「分身」。
     */
    rec: [] as Move[],
    /** 最後三十秒的音樂加速只做一次 */
    rushed: false,
    pops: [] as { x: number; y: number; text: string; color: string; life: number; icon?: string }[],
    /** 道具開出來的效果，上面那一條會跑倒數。現在只有寒霜。 */
    buffs: [] as { id: string; icon: string; name: string; left: number; dur: number }[],
    flashes: [] as { x: number; life: number }[],
    done: false,
    /** 真人對戰：按了升階、還在等它生效（晚 1.5 秒）的時候是按下去那時的階，不然 0 */
    upWait: 0,
  }

  /**
   * 真人即時對戰（2026-09-25）。兩支手機跑同一份戰場，只交換動作，
   * 做法與規矩見 lockstep.ts。這時候 S.battle 是**拿來畫的那一份**：
   * 第一位就是那份戰場本身，第二位是左右翻過來的複本——引擎裡所有「me」
   * 都還是「看這支手機的人」，畫面那一大段完全不用改。
   *
   * **真人對戰時引擎不准直接改 S.battle**。答對、出兵、升階都變成送一個動作出去，
   * 1.5 秒後兩邊一起生效。
   */
  const live = foe.live ?? null
  const ls = live ? new Lockstep(R) : null
  const mySide: Side = live ? SEAT_SIDE[live.seat] : 'me'
  const flip = live?.seat === 2
  let flipped: BattleState | null = null
  const viewOf = (): BattleState => (flip ? (flipped = mirror(ls!.truth, flipped, R)) : ls!.truth)
  /** 還在跟本人打。對方斷線、改打分身之後是 false。 */
  let liveOn = !!live
  /** 我送出去的動作（累計），lockstep 自己那一邊也吃這一串 */
  const myLive: LiveMove[] = []
  let liveAcc = 0
  const truthLog = new Map<number, string>()
  let lastUpK = 0
  /** 從什麼時候開始在等對方（performance.now），沒在等是 0 */
  let stallSince = 0
  function sendLive(m: Omit<LiveMove, 'k'>) {
    const full = { ...m, k: ls!.tick + 1 }
    myLive.push(full)
    live!.send(full)
  }
  if (ls) S.battle = viewOf()
  if (foe.noListen) {
    const b = elLines.find((x) => x.dataset.line === 'listen')
    if (b) b.style.display = 'none'
  }

  /**
   * 我方穿哪一套軍團（2026-09-24）。兵、城堡、塔、戰場整套換；
   * 某張圖那一套沒有，就退回王國軍那張，畫面不會開天窗。
   */
  const legion = legionById(ctx.legion)

  /**
   * 敵我的顏色。自己穿什麼色就用什麼色，對手一定換成另一色——
   * 兩邊同色的話，戰場上根本分不出哪一隻是自己的兵。
   * **電腦對手是紅色王國軍**（Chuck 定案）；我方剛好也穿紅的王國軍時才換黑色。
   * 之後好友對戰兩邊可能都是豬，所以敵我另外靠腳下的色圈分（見 drawUnit）。
   */
  const foeSuffix = ctx.color === '_red' && !legion.id ? '_black' : '_red'
  const mine = (key: string) =>
    img[legion.prefix + key + ctx.color] ?? img[legion.prefix + key] ?? img[key + ctx.color] ?? img[key]
  /**
   * 對手那一套。同學的分身穿他自己的軍團（兩邊都是豬也沒關係，腳下的色圈分得出敵我）；
   * 電腦、或是對手穿王國軍，就是紅色（我方也紅的話黑色）。
   */
  const foeLegion = legionById(foe.legion ?? '')
  const theirs = (key: string) =>
    (foeLegion.id ? img[foeLegion.prefix + key] : undefined) ?? img[key + foeSuffix] ?? img[key]
  const theirUnit = (u: Unit, rank: number) =>
    (foeLegion.id ? img[legionUnitArt(foeLegion, u.line, LINES[u.line].art, rank)] : undefined)
      ?? theirs(LINES[u.line].art)
  /** 我方某條線某一階的圖。有的軍團每一階長得不一樣（豬軍團的大砲、豬王）。 */
  const myUnit = (u: Unit, rank: number) =>
    img[legionUnitArt(legion, u.line, LINES[u.line].art, rank)] ?? img[LINES[u.line].art + ctx.color] ?? img[LINES[u.line].art]
  /** 戰場的底圖有沒有到。沒到的話 loop 會每三秒再敲一次 loadArt。 */
  const fieldKey = legion.field === 'castle' ? legion.prefix + 'wall' : 'tiles'

  /**
   * 飄字用的道具圖示。畫布沒辦法直接畫 CSS 的 <img>，所以自己留一份。
   * **沒載好就不畫**——沒畫完的圖 drawImage 會丟例外，那會把整個畫面定住。
   */
  const popIcons = new Map<string, HTMLImageElement>()
  function popIcon(name: string): HTMLImageElement | null {
    let im = popIcons.get(name)
    if (!im) {
      im = new Image()
      im.src = iconUrl(name as Parameters<typeof iconUrl>[0])
      popIcons.set(name, im)
    }
    return im.complete && im.naturalWidth > 0 ? im : null
  }

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
  function onFoeMove(correct: boolean, move: Move) {
    // 同學的分身：照他當時做的事重播，不替他決定（見 ghostMove）。
    if (move.act) { ghostMove(move); return }
    // **電腦跟人跑同一套規則**：一樣要累積、一樣有水晶、一樣被上限拖慢出兵速度，
    // 答錯一樣把累積的結算出去。少了任何一條，平衡量測量到的就不是玩家會遇到的東西。
    // 這段跟 tools/test/tug-balance.mjs 的 act() 必須逐行對得上。
    //
    // 每 45 秒換一條線，讓小朋友三種兵都看得到、也都被打過。
    S.botLine = LINE_IDS[Math.floor(S.battle.t / 45) % LINE_IDS.length]
    // 拼字一題要花三倍時間，所以要存夠三筆才算答完一題。
    S.botCredit += 1
    if (S.botCredit < LINE_COST[S.botLine]) return
    S.botCredit -= LINE_COST[S.botLine]
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
    const mine = tappable('me')
    strike(S.battle, 'foe', mine[(Math.random() * TAPPABLE) | 0] ?? null, R)
  }
  let feed = makeFeeder(foe, onFoeMove)

  /**
   * 對方斷線（15 秒沒消息）或按了離開：剩下的時間改打他的分身。
   * 已經送出來的動作先全部套用完，然後這份戰場就變成這支手機自己的，照一般兵推往下打。
   * **這一場不算戰旗**（liveToEnd = false），不然拔網路線就能讓對方的勝場作廢。
   */
  function takeOver() {
    if (!ls || !liveOn) return
    liveOn = false
    ls.flush()
    S.battle = viewOf()
    const t0 = S.battle.t
    const fb = live!.fallback
    feed = makeFeeder({ ...fb, movesUntil: (t) => fb.movesUntil(t).filter((m) => m.t > t0) }, onFoeMove)
    S.upWait = 0
    stallSince = 0
    // 跟對方說這邊不等了：他那邊也馬上改打分身，不用再乾等 15 秒
    live!.close(true)
    toast(fb.isGhost ? `${foe.name}斷線了，剩下的改打他的分身（這場不算戰旗）`
      : `${foe.name}斷線了，剩下的改打電腦（這場不算戰旗）`)
  }

  /**
   * 分身的一步。**他當時做了什麼就做什麼**：答對一樣開一槍、拿水晶（槍一樣會落空，
   * 理由同上），出兵就出他當時那條線那一階，升階就升階。
   *
   * 升階有可能水晶不夠——這一場他殺掉的兵跟當時不一樣，殺敵水晶就對不上。
   * 那還是照升：分身重播的是「他的打法」，不是重算一遍他當時的荷包。
   */
  function ghostMove(m: Move) {
    if (m.act === 'answer') {
      if (!m.correct) return
      S.battle.crystal.foe += R.answerCrystal
      const mine = tappable('me')
      strike(S.battle, 'foe', mine[(Math.random() * TAPPABLE) | 0] ?? null, R)
    } else if (m.act === 'summon' && m.line) {
      summon(S.battle, 'foe', m.line as Line, Math.min(MAX_TIER, m.rank ?? 1), R)
    } else if (m.act === 'up') {
      if (!upgrade(S.battle, 'foe')) S.battle.tier.foe = Math.min(MAX_TIER, S.battle.tier.foe + 1)
    }
  }

  // ------------------------------------------------------------------ 題目
  function freshWord(): Word | null {
    // 題型跟著兵種線走。容器會照題型各開一份出題器，所以複習權重不會混在一起。
    const q = ctx.nextQuestion(LINES[S.line].skill)
    return q ? q.word : null
  }

  /** 木牌上寫的就是整個英文單字。拼字線不走木牌，走下面的字母磚。 */
  function relabel() {
    for (const t of S.targets.values()) t.label = t.word.word
  }

  /**
   * 開一個新的拼字題。
   *
   * 字母磚 ＝ 這個字的字母（含重複的）＋ 幾個混淆用的，洗牌後排在下面。
   * 混淆的數量讓磚數落在 5~8 之間：太少用猜的就會中，太多在手機上排不下。
   */
  function newSpellWord() {
    const w = freshWord()
    S.spell.word = w
    S.spell.filled = 0
    S.spell.slips = 0
    S.spell.bank = []
    if (!w) return
    const letters = w.word.toLowerCase().split('')
    const want = Math.min(8, Math.max(5, letters.length + 2))
    const pool = [...letters]
    while (pool.length < want) {
      const c = LETTERS[(Math.random() * 26) | 0]
      // 混淆字母不要跟字裡的重複，不然玩家點下去會被判錯，看起來像程式壞了
      if (!letters.includes(c) && !pool.includes(c)) pool.push(c)
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    S.spell.bank = pool.map((ch) => ({ ch, used: false, press: 0, bad: 0 }))
    S.asked++
    S.askedAt = performance.now()
    syncQuiz()
  }

  /** 字母磚在畫面上的位置 */
  function bankX(i: number) {
    const n = S.spell.bank.length
    const total = n * SPELL.bankW + (n - 1) * SPELL.bankGap
    return (W - total) / 2 + i * (SPELL.bankW + SPELL.bankGap)
  }

  /** 空格在畫面上的位置 */
  function slotXi(i: number) {
    const n = S.spell.word?.word.length ?? 0
    const total = n * SPELL.slotW + (n - 1) * SPELL.slotGap
    return (W - total) / 2 + i * (SPELL.slotW + SPELL.slotGap)
  }

  /**
   * 場上所有點得到的東西，每一格重建一次（兵會死、會出生）。
   *
   * 只有**最前面 TAPPABLE 隻**敵兵掛得到字牌，後面那一長串不掛——
   * 這是「字母會飄」的解法，見 TAPPABLE 的說明。
   * 正在問的那一題就算掉出前幾名也留著，不然字會在你正要點的時候換掉。
   */
  function syncTargets() {
    // 拼字線不用場上的目標——作答是點下面的字母磚。留著舊的木牌會變成
    // 「畫面上有三個字但點了沒反應」，比沒有還糟。
    if (S.line === 'spell') {
      S.targets.clear()
      S.shieldWords = [null, null, null]
      S.target = null
      return
    }
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
        t = { id, word: w, label: w.word, unit: u, slot: -1, x: u.x, y: ROAD_Y - 74,
          press: 0, good: 0, bad: 0, shake: 0 }
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
        t = { id, word: w, label: w.word, unit: null, slot: -1, x, y,
          press: 0, good: 0, bad: 0, shake: 0 }
        S.targets.set(id, t)
      }
      t.word = w
      t.x = x; t.y = y
    }

    for (const id of [...S.targets.keys()]) if (!seen.has(id)) S.targets.delete(id)
    assignSlots()
    if (S.target && !S.targets.has(S.target)) pickQuestion()
    else relabel()   // 這一格新生的牌子還寫著整個單字，拼字題要換成字母
  }

  /**
   * 把每個目標配到上方三塊木牌的其中一塊。
   *
   * **已經有位子的不准換位子**——木牌是固定的，如果兵一死就把剩下的往前擠，
   * 玩家正要點的那塊會在手指底下換成別的字，等於又回到「點錯」那個毛病。
   */
  function assignSlots() {
    const list = [...S.targets.values()]
    const taken = new Set<number>()
    for (const t of list) {
      if (t.slot >= 0 && t.slot < TAPPABLE && !taken.has(t.slot)) taken.add(t.slot)
      else t.slot = -1
    }
    for (const t of list) {
      if (t.slot >= 0) continue
      for (let i = 0; i < TAPPABLE; i++) {
        if (taken.has(i)) continue
        t.slot = i; taken.add(i); break
      }
    }
  }

  function pickQuestion() {
    if (S.line === 'spell') return newSpellWord()
    const list = [...S.targets.values()]
    if (!list.length) { S.target = null; return syncQuiz() }
    const pick = list[(Math.random() * list.length) | 0]
    S.target = pick.id
    S.asked++
    S.askedAt = performance.now()
    relabel()
    syncQuiz()
    // 聽音題的題目本身就是聲音，所以出題就唸。
    if (S.line === 'listen') speak(pick.word.word)
  }

  function syncQuiz() {
    const need = S.battle.tier.me
    const step = need > 1 ? `（${S.pending + 1}/${need}）` : ''
    if (S.line === 'spell') {
      const w = S.spell.word
      elEmoji.textContent = w?.emoji ?? '✍️'
      elZh.textContent = w ? w.zh : '拼字'
      elHint.textContent = w
        ? `${step}用下面的字母磚把「${w.zh}」拼出來`
        : '題庫用完了'
      elSay.disabled = !w
      return
    }
    const t = S.target ? S.targets.get(S.target) : null
    if (!t) {
      elEmoji.textContent = '⚔️'
      elZh.textContent = '準備開打'
      elHint.textContent = ''
      elSay.disabled = true
      return
    }
    if (S.line === 'listen') {
      // 中文不給看，不然用看的就答完了，根本沒在聽。
      elEmoji.textContent = '👂'
      elZh.textContent = '聽聽看'
      elHint.textContent = `${step}點出你聽到的那個字`
    } else {
      elEmoji.textContent = t.word.emoji
      elZh.textContent = t.word.zh
      elHint.textContent = `${step}（${t.word.pos}）點出寫著這個字的目標`
    }
    elSay.disabled = false
  }

  function syncUI() {
    const left = Math.max(0, R.seconds - S.battle.t)
    const mm = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
    elClock.innerHTML = `${iconImg('clock', 15)} ${mm}`
    elMine.innerHTML = `${iconImg('castle', 15)} ${Math.max(0, Math.ceil(S.battle.castleHp.me))}`
    elTheirs.textContent = `🏯 ${Math.max(0, Math.ceil(S.battle.castleHp.foe))}`
    // 電腦對手一定要寫出來。被騙到才會真的不爽。
    elFoe.textContent = live && !liveOn
      ? (live.fallback.isGhost ? `👤 ${foe.name}的分身（斷線接手）` : `🤖 電腦（${foe.name}斷線接手）`)
      : foe.isBot ? `🤖 電腦對手．${foe.name}`
      : foe.isGhost ? `👤 ${foe.name}的分身`
      : stallSince && performance.now() - stallSince > 1200 ? `🧒 ${foe.name}・等他連線…`
      : `🧒 ${foe.name}・真人`
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
    S.topTier = Math.max(S.topTier, rank)
    S.linesUsed.add(S.line)
    if (liveOn) sendLive({ act: 'summon', line: LINES[S.line].skill, rank })
    else summon(S.battle, 'me', S.line, rank, R)
    S.rec.push({ t: S.battle.t, act: 'summon', correct: true, line: LINES[S.line].skill, rank })
    S.pending = 0
    S.pops.push({
      x: R.homeMe + 40, y: ROAD_Y - 80,
      text: liveOn ? `${statsOf(S.line, rank).name}出發` : statsOf(S.line, rank).name,
      color: '#a8e07a', life: 1.0,
    })
  }

  /** 換一條兵種線。累積到一半的先結算出去，不然換線等於白答。 */
  function switchLine(line: Line) {
    if (S.done || paused || line === S.line) return
    if (line === 'listen' && foe.noListen) return
    S.linesUsed.add(line)
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
    if (liveOn) {
      // 真人對戰：水晶夠不夠先照畫面上的看，真的扣是 1.5 秒後兩邊一起扣。
      // 等它生效之前不准再按，不然連按兩下會送出兩次、第二次一定失敗，看起來像壞掉。
      const cost = nextCost(S.battle, 'me')
      if (S.upWait || cost === null || S.battle.crystal.me < cost) return
      S.upWait = S.battle.tier.me
      lastUpK = ls!.tick + 1
      sendLive({ act: 'up' })
      S.rec.push({ t: S.battle.t, act: 'up', correct: true, rank: null })
      ctx.audio.play('tower-build')
      toast(`升到 ${S.upWait + 1} 階，馬上生效`)
      syncBar()
      return
    }
    if (!upgrade(S.battle, 'me')) return
    S.rec.push({ t: S.battle.t, act: 'up', correct: true, rank: null })
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
    elUp.disabled = !can || S.upWait > 0
    elUpCost.innerHTML = cost === null ? `已滿 ${MAX_TIER} 階` : `${iconImg('crystal', 13)} ${cost}`
    elCrystal.innerHTML = `${iconImg('crystal', 15)} ${Math.floor(S.battle.crystal.me)}　${S.battle.tier.me} 階`
  }

  // ---------------------------------------------------------------- 道具
  /**
   * 用一個道具。
   *
   * **跟守塔是同一份道具、不同的效果**——守塔有地面可以結霜、有一座要守的城堡，
   * 兵推兩邊都在推進，所以「減速」在這裡的意思是「對方停下來」。
   * 界線一樣：容器管背包，這裡只管效果長什麼樣；回傳 false 代表現在用了會浪費，
   * 容器就不會把道具扣掉。
   *
   * 2026-09-21 之前這支根本不存在，但容器照樣把道具列畫出來，
   * 所以在兵推裡按道具是完全沒反應。現在三個都做了。
   */
  function useItem(id: string): boolean {
    if (S.done || S.battle.over) return false
    // 真人對戰不用道具：道具是金幣買的，拿來打同學就變成花錢買贏。
    if (live) { toast('跟同學真人對戰不能用道具'); return false }
    switch (id) {
      case 'slow-30': {
        if (S.buffs.some((b) => b.id === id)) { toast('對面還凍著，等退了再用'); return false }
        S.battle.chill.foe = FREEZE_SECONDS
        S.buffs.push({ id, icon: 'frost', name: '寒霜', left: FREEZE_SECONDS, dur: FREEZE_SECONDS })
        // 每一隻凍住的兵身上冒一朵雪花，不然只看到「對面不動了」會以為是當掉
        for (const u of S.battle.units) {
          if (u.side !== 'foe' || u.hp <= 0) continue
          S.pops.push({ x: u.x, y: ROAD_Y - 96, text: '', icon: 'frost', color: '#bfe6ff', life: 1.0 })
        }
        toast(`對方全軍凍住 ${FREEZE_SECONDS} 秒`)
        ctx.audio.play('explosion')
        syncBuffs()
        return true
      }
      case 'heal-5': {
        if (S.battle.castleHp.me >= R.castleHp) { toast('城堡是滿血的，留著下次用'); return false }
        S.battle.castleHp.me = Math.min(R.castleHp, S.battle.castleHp.me + VERSUS_HEAL)
        S.pops.push({
          x: R.homeMe + 40, y: ROAD_Y - 110,
          text: `+${VERSUS_HEAL}`, icon: 'heart', color: '#9de8a0', life: 1.3,
        })
        toast('城牆補好了')
        ctx.audio.play('tower-build')
        syncUI()
        return true
      }
      case 'crystal-40': {
        S.battle.crystal.me += VERSUS_CRYSTALS
        // 一顆一顆冒出來，比一個 +40 有感（跟守塔同一套做法）
        for (let i = 0; i < 8; i++) {
          S.pops.push({
            x: R.homeMe + 20 + Math.random() * 170, y: ROAD_Y - 70 - Math.random() * 60,
            text: '', icon: 'crystal', color: '#8fd8ff', life: 0.7 + i * 0.09,
          })
        }
        toast(`補給到了，${VERSUS_CRYSTALS} 顆水晶`)
        ctx.audio.play('coin')
        syncBar()
        return true
      }
      default:
        return false
    }
  }

  /** 上面那一條的道具倒數。每整秒才重畫一次，不然每一格都在動很吵。 */
  let buffShown = -1
  function syncBuffs() {
    const now = S.buffs.length ? Math.ceil(S.buffs[0].left) : -1
    if (now === buffShown && S.buffs.length) return
    buffShown = now
    elBuffs.innerHTML = S.buffs
      .map((b) => `<span class="td-buff"><i><img class="ic-img" src="${iconUrl('frost')}" alt=""></i>`
        + `${b.name}<b>${Math.ceil(b.left)}s</b>`
        + `<u style="width:${Math.round((b.left / b.dur) * 100)}%"></u></span>`)
      .join('')
  }

  for (const b of elLines) {
    b.addEventListener('click', () => switchLine(b.dataset.line as Line))
  }
  elUp.addEventListener('click', buyTier)

  // ------------------------------------------------------------------ 作答
  /**
   * 一題的結果，三條線共用這一段。
   *
   * 拆出來是因為拼字線的作答方式完全不同（點下面的字母磚拼完整個字），
   * 但「答對之後發生什麼事」必須一模一樣，不然三條線會慢慢長成三套規則。
   */
  function settle(correct: boolean, word: Word, target: Unit | null, at: { x: number; y: number }) {
    ctx.report({
      wordId: word.id, skill: LINES[S.line].skill, correct,
      ms: Math.round(performance.now() - S.askedAt), combo: S.combo,
    })
    S.rec.push({ t: S.battle.t, act: 'answer', correct, rank: null })
    if (liveOn) sendLive({ act: 'answer', correct, target: correct && target ? target.id : -1 })
    if (correct) {
      S.correct++; S.combo++
      buzz(14)
      ctx.audio.play('answer-correct')
      // 答對一定做的事：開一槍（打不到城堡，見 battle.ts 的 strike）、拿水晶。
      // **出不出兵要看累積夠了沒**——兵階上限是幾，就要連對幾題。
      if (!liveOn) {
        strike(S.battle, 'me', target, R)
        S.battle.crystal.me += R.answerCrystal
      }
      S.flashes.push({ x: at.x, life: 0.22 })
      S.pending++
      if (S.pending >= S.battle.tier.me) cashOut()
      else S.pops.push({
        x: R.homeMe + 40, y: ROAD_Y - 80,
        text: `${S.pending}/${S.battle.tier.me}`, color: '#ffd76a', life: 0.9,
      })
      speak(word.word)
    } else {
      S.combo = 0
      buzz(55)
      ctx.audio.play('answer-wrong')
      S.pops.push({ x: at.x, y: at.y - 10, text: '✗', color: '#ffb4b0', life: 0.8 })
      // **答錯不會把累積的全部沒收**，結算成目前這一階。
      // 沒有這條的話，上限四階等於要連對四題才有兵，沒有人敢按升階。
      cashOut()
    }
    syncTargets()
    pickQuestion()
    syncUI()
    syncBar()
  }

  /** 認字與聽音：點上面的木牌（或點那隻兵）。 */
  function tap(t: Target) {
    if (S.done || paused || !S.target || S.cooldown > 0) return
    t.press = PRESS
    const correct = t.id === S.target
    const asked = S.targets.get(S.target)!
    S.cooldown = ANSWER_COOLDOWN
    if (correct) t.good = 0.45
    else { t.bad = 0.5; t.shake = 0.35 }
    if (correct && !t.unit) S.shieldWords[Number(t.id.slice(1))] = null  // 守衛打掉就換字
    settle(correct, asked.word, t.unit, { x: t.x, y: t.y })
  }

  /**
   * 拼字：點下面的字母磚。
   *
   * **按錯不會直接判定整題答錯**，只記一筆、磚子抖一下，這個字繼續拼完。
   * 理由是一個字要點五六下，按錯一下就整題作廢的話，小朋友會不敢拼長的字——
   * 跟「拼到一半錯不整個沒收」是同一個道理。全部拼完的時候，
   * 沒按錯過才算答對。
   */
  function tapLetter(i: number) {
    if (S.done || paused || S.cooldown > 0) return
    const w = S.spell.word
    const tile = S.spell.bank[i]
    if (!w || !tile || tile.used) return
    const need = w.word.toLowerCase()
    if (tile.ch !== need[S.spell.filled]) {
      tile.bad = 0.45
      S.spell.slips++
      buzz(35)
      ctx.audio.play('answer-wrong')
      return
    }
    tile.used = true
    tile.press = PRESS
    S.spell.filled++
    if (S.spell.filled < need.length) {
      ctx.audio.play('ui-tap')
      return
    }
    // 整個字拼完了，這才算一題
    S.cooldown = ANSWER_COOLDOWN
    const front = tappable('foe')[0] ?? null
    settle(S.spell.slips === 0, w, front, { x: W / 2, y: SPELL.slotY + SPELL.slotH })
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
    const hits = liveOn ? liveStep(dt) : (feed(S.battle.t), step(S.battle, dt, R))
    for (const h of hits) {
      if (!h.tower || h.from === undefined) continue
      const from = h.side === 'me' ? towerX('foe') : towerX('me')
      S.arrows.push({ x0: from, y0: ROAD_Y - 92, x1: h.x, y1: ROAD_Y - 28, life: ARROW_LIFE })
    }
    syncTargets()
    for (const tile of S.spell.bank) {
      if (tile.press > 0) tile.press -= dt
      if (tile.bad > 0) tile.bad -= dt
    }
    if (S.line !== 'spell' && !S.target) pickQuestion()

    for (const t of S.targets.values()) {
      for (const k of ['press', 'good', 'bad', 'shake'] as const) if (t[k] > 0) t[k] -= dt
    }
    for (const p of S.pops) { p.life -= dt; p.y -= dt * 34 }
    S.pops = S.pops.filter((p) => p.life > 0)
    for (const f of S.flashes) f.life -= dt
    S.flashes = S.flashes.filter((f) => f.life > 0)
    for (const a of S.arrows) a.life -= dt
    S.arrows = S.arrows.filter((a) => a.life > 0)
    if (S.buffs.length) {
      for (const b of S.buffs) b.left -= dt
      const before = S.buffs.length
      S.buffs = S.buffs.filter((b) => b.left > 0)
      syncBuffs()
      if (S.buffs.length !== before && !S.buffs.length) elBuffs.innerHTML = ''
    }

    // 整場最落後的時候。逆轉勝要看這個，結束時才看是看不出來的。
    S.lowestFront = Math.min(S.lowestFront, pushed(S.battle, R))

    if (S.battle.over && !S.done) finish()
  }

  /**
   * 真人對戰的一格畫面：能往前算幾格就算幾格（每格固定 1/30 秒），
   * 對方的消息還沒到就停下來等。等太久（15 秒）或對方離開了就改打分身。
   */
  function liveStep(dt: number) {
    const lk = live!
    const l = ls!
    liveAcc = Math.min(liveAcc + dt, 0.5)
    l.feed(mySide, myLive)
    l.feed(OTHER[mySide], lk.theirMoves())
    const out: Hit[] = []
    let stalled = false
    while (liveAcc >= TICK) {
      if (!l.canStep(lk.theirMark())) { stalled = true; break }
      liveAcc -= TICK
      for (const h of l.step()) out.push(flip ? mirrorHit(h, R) : h)
      // 開發版：每一秒記一筆戰場的樣子，測試拿兩支手機同一格的來比（正式版整段消失）
      if (import.meta.env.DEV && l.tick % 30 === 0) {
        truthLog.set(l.tick, JSON.stringify([l.truth.castleHp, l.truth.units.map((u) => [u.id, u.side, u.x, u.hp])]))
      }
    }
    lk.mark(l.tick)
    S.battle = viewOf()
    if (S.upWait && S.battle.tier.me > S.upWait) S.upWait = 0
    // 升階送出去 DELAY 格還沒生效，就是水晶其實不夠（被別的東西先花掉了），放掉讓他能再按
    if (S.upWait && l.tick > lastUpK + DELAY + 2) S.upWait = 0
    const now = performance.now()
    if (stalled) {
      if (!stallSince) stallSince = now
      if (now - stallSince > 15000) takeOver()
    } else stallSince = 0
    if (lk.theirGone()) takeOver()
    return out
  }

  function finish() {
    S.done = true
    live?.close(false)
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
      // 戰報。容器拿去記戰績，成就那邊要用（從答題事件看不出這些）。
      versus: {
        front: pushed(b, R),
        lowestFront: Math.min(S.lowestFront, pushed(b, R)),
        linesUsed: [...S.linesUsed].map((l) => LINES[l].skill),
        topTier: S.topTier,
        moves: S.rec,
        ...(live ? { liveToEnd: liveOn } : {}),
      },
    })
  }

  function loop() {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // 真人對戰不能暫停——對方那邊還在打。按了「離開」在問確定嗎的時候戰場照跑。
    if (!S.done && (!paused || liveOn)) update(dt)
    // 戰場的圖還沒到就每三秒再敲一次，在戰場裡也救得回來，不用退出去重進。
    if (!img[fieldKey] && now - artKick > 3000) { artKick = now; void loadArt() }
    draw()
    syncUI()
    syncBar()
    raf = requestAnimationFrame(loop)
  }

  // ------------------------------------------------------------------ 畫面
  function buildTerrain() {
    if (legion.field === 'castle') return buildCastleHall()
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

  /**
   * 豬軍團的戰場：側視的城堡室內（Kings and Pigs 的地形）。
   * 背後一整面磚牆開幾扇窗，兵走在一條石頭地板上，地板以下是暗的——
   * 拼字的字母磚剛好落在暗色上，比落在草地上還清楚。
   * 圖塊 32 像素放大兩倍，剛好是遊戲的 64 一格。
   */
  function buildCastleHall() {
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    const p = legion.prefix
    const wall = img[p + 'wall'], floor = img[p + 'floor'], under = img[p + 'under']
    const floorY = 6 * TILE
    g.fillStyle = '#3f3851'; g.fillRect(0, 0, W, H)
    for (let x = 0; x < W; x += TILE) {
      for (let y = 0; y < floorY; y += TILE) if (wall?.complete) g.drawImage(wall, x, y, TILE, TILE)
      if (floor?.complete) g.drawImage(floor, x, floorY, TILE, TILE)
      for (let y = floorY + TILE; y < H; y += TILE) if (under?.complete) g.drawImage(under, x, y, TILE, TILE)
    }
    // 窗戶排在城堡與塔中間的那一段牆上，不要被城堡擋住
    const win = img[p + 'window']
    if (win?.complete) {
      for (const x of [300, 544, 788]) g.drawImage(win, x - win.width / 2, 196, win.width, win.height)
    }
    // 牆腳一條陰影，兵才像站在地板上而不是貼在牆上
    const sh = g.createLinearGradient(0, floorY - 26, 0, floorY)
    sh.addColorStop(0, 'rgba(40,30,50,0)'); sh.addColorStop(1, 'rgba(40,30,50,.45)')
    g.fillStyle = sh; g.fillRect(0, floorY - 26, W, 26)
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

  /** 畫一個人。squad 裡每一個都走這裡，只是位置與縮放不同。 */
  function drawFigure(im: HTMLImageElement | undefined, x: number, y: number, sc: number, flip: boolean) {
    if (!im?.complete) return
    c2d.save()
    if (flip) { c2d.translate(x * 2, 0); c2d.scale(-1, 1) }   // 對面的兵要朝左
    c2d.translate(x, y); c2d.scale(sc, sc); c2d.translate(-x, -y)
    c2d.drawImage(im, x - UNIT_DRAW / 2, y - 94, UNIT_DRAW, UNIT_DRAW)
    c2d.restore()
  }

  /**
   * 腳下的色圈：綠的是我方、紅的是對方。
   * 本來敵我靠陣營顏色分，換成軍團之後兩邊可能都是豬（之後的好友對戰），
   * 顏色靠不住了，所以一律在腳下畫一圈。
   */
  function footRing(x: number, y: number, r: number, side: 'me' | 'foe') {
    c2d.save()
    c2d.strokeStyle = side === 'me' ? 'rgba(120,220,90,.85)' : 'rgba(240,90,80,.85)'
    c2d.lineWidth = 2.5
    c2d.beginPath(); c2d.ellipse(x, y, r, r * 0.34, 0, 0, 7); c2d.stroke()
    c2d.restore()
  }

  function drawUnit(u: Unit) {
    const spec = statsOf(u.line, u.rank)
    const y = laneY(u)
    const im = u.side === 'me' ? myUnit(u, u.rank) : theirUnit(u, u.rank)
    // 隨從一律畫一階的樣子：豬軍團三階是大砲，後面跟的還是丟箱子的小豬
    const follower = u.side === 'me' ? myUnit(u, 1) : theirUnit(u, 1)
    const flip = u.side === 'foe'
    const back = u.side === 'me' ? -1 : 1      // 「後面」是朝自己城堡那一邊

    // **幾階就畫幾個人。** 體型級距（每階 +25%）在手機上還是不夠明顯，
    // 但「一個人 vs 四個人排成一小隊」隔多遠都看得出來，而且剛好對上
    // 「隊長」「將軍」這些名字。機制上仍然只有一隻兵、一條血條——
    // 跟班只是畫出來的，不會多打一下也不會多挨一下。
    for (let i = u.rank - 1; i >= 1; i--) {
      const fx = u.x + back * i * 17
      const fy = y + (i % 2 === 0 ? 7 : -7)
      shadow(fx, fy + 2, 15 * spec.size)
      drawFigure(follower, fx, fy, spec.size * 0.72, flip)
    }
    shadow(u.x, y + 2, 20 * spec.size)
    footRing(u.x, y + 2, 20 * spec.size, u.side)
    drawFigure(im, u.x, y, spec.size, flip)

    // 軍階標記：二階一槓、三階兩槓、四階一顆星。畫在縮放之外，高度跟血條一樣固定，
    // 跟著體型縮放的話四階那顆星會被推到頭頂上方老遠。
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
    // 電腦對手直接寫在它的城堡上。上面那條的對手名字在手機橫拿時放不下（會被藏起來），
    // 只靠開場那一下提示，小朋友打到一半會忘記對面是電腦。
    if (side === 'foe' && (foe.isBot || foe.isGhost)) {
      const tag = foe.isBot ? '電腦對手' : `${foe.name}的分身`
      c2d.save()
      c2d.font = 'bold 15px system-ui'
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
      const w = c2d.measureText(tag).width + 18
      c2d.fillStyle = 'rgba(40,24,20,.78)'
      roundRect(x - w / 2, ROAD_Y - 190, w, 22, 11); c2d.fill()
      c2d.fillStyle = '#ffd9d4'
      c2d.fillText(tag, x, ROAD_Y - 178)
      c2d.restore()
    }
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

  /**
   * 上方那三塊固定的大木牌。
   *
   * 重點是**它不動、而且夠大**：258px 寬、字 30px，在手機上約 152×27 CSS px，
   * 比舊版黏在兵身上的 16px 牌子大一個量級。每塊有自己的顏色，兵身上掛同色的
   * 旗子，所以「這個字是誰身上的」用顏色對，不用把字擠到兵頭上。
   */
  function drawBoard(t: Target) {
    const cx = slotX(t.slot) + (t.shake > 0 ? Math.sin(t.shake * 70) * 5 : 0)
    const x = cx - BOARD.w / 2
    const color = SLOT_COLOR[t.slot] ?? '#8a6b45'
    const sc = 1 + (t.press > 0 ? Math.sin((t.press / PRESS) * Math.PI) * 0.1 : 0)
    c2d.save()
    c2d.translate(cx, BOARD.y + BOARD.h / 2); c2d.scale(sc, sc)
    c2d.translate(-cx, -(BOARD.y + BOARD.h / 2))
    c2d.fillStyle = 'rgba(0,0,0,.3)'; roundRect(x, BOARD.y + 5, BOARD.w, BOARD.h, 11); c2d.fill()
    c2d.fillStyle = t.good > 0 ? '#3f7a34' : t.bad > 0 ? '#8c3730' : '#2b2117'
    roundRect(x, BOARD.y, BOARD.w, BOARD.h, 11); c2d.fill()
    c2d.strokeStyle = t.good > 0 ? '#a8e07a' : t.bad > 0 ? '#ff9a94' : color
    c2d.lineWidth = 4; c2d.stroke()
    c2d.fillStyle = '#fff'
    c2d.font = 'bold 30px system-ui, "Segoe UI", sans-serif'
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    c2d.fillText(t.label, cx, BOARD.y + BOARD.h / 2 + 1)
    c2d.restore()
  }

  /**
   * 兵身上那面旗子。顏色對應上面哪一塊木牌，所以不用把整個單字寫在兵頭上。
   * 沒有兵的（城牆守衛）就畫在它自己的位置上。
   */
  function drawPennant(t: Target) {
    const color = SLOT_COLOR[t.slot] ?? '#8a6b45'
    const x = t.x + (t.shake > 0 ? Math.sin(t.shake * 70) * 4 : 0)
    const top = t.y - 34
    c2d.strokeStyle = 'rgba(28,20,12,.75)'; c2d.lineWidth = 3
    c2d.beginPath(); c2d.moveTo(x, t.y + 6); c2d.lineTo(x, top); c2d.stroke()
    c2d.fillStyle = color
    c2d.beginPath()
    c2d.moveTo(x, top); c2d.lineTo(x + 26, top + 9); c2d.lineTo(x, top + 18); c2d.closePath()
    c2d.fill()
    c2d.strokeStyle = 'rgba(28,20,12,.75)'; c2d.lineWidth = 2; c2d.stroke()
    if (t.good > 0 || t.bad > 0) {
      c2d.fillStyle = t.good > 0 ? 'rgba(168,224,122,.9)' : 'rgba(255,154,148,.9)'
      c2d.beginPath(); c2d.arc(x, t.y - 4, 20, 0, 7); c2d.fill()
    }
  }

  /**
   * 拼字題的畫面：中間一排空格（拼到哪裡看得出來），下面一排木頭字母磚。
   *
   * 空格用綠色填、還沒拼的留暗色，所以進度一眼看得到；已經用掉的磚變暗，
   * 小朋友才不會一直去點同一塊。
   */
  function drawSpell() {
    const w = S.spell.word
    if (!w) return
    const need = w.word

    // 空格
    for (let i = 0; i < need.length; i++) {
      const x = slotXi(i)
      const done = i < S.spell.filled
      c2d.fillStyle = 'rgba(0,0,0,.3)'
      roundRect(x, SPELL.slotY + 4, SPELL.slotW, SPELL.slotH, 9); c2d.fill()
      c2d.fillStyle = done ? '#3f7a34' : '#241c12'
      roundRect(x, SPELL.slotY, SPELL.slotW, SPELL.slotH, 9); c2d.fill()
      c2d.strokeStyle = done ? '#a8e07a' : 'rgba(180,150,110,.55)'
      c2d.lineWidth = 3; c2d.stroke()
      if (done) {
        c2d.fillStyle = '#fff'
        c2d.font = 'bold 34px system-ui, "Segoe UI", sans-serif'
        c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
        c2d.fillText(need[i], x + SPELL.slotW / 2, SPELL.slotY + SPELL.slotH / 2 + 1)
      }
    }

    // 字母磚
    for (let i = 0; i < S.spell.bank.length; i++) {
      const tile = S.spell.bank[i]
      const sh = tile.bad > 0 ? Math.sin(tile.bad * 70) * 5 : 0
      const x = bankX(i) + sh
      const sc = 1 + (tile.press > 0 ? Math.sin((tile.press / PRESS) * Math.PI) * 0.12 : 0)
      const cx = x + SPELL.bankW / 2
      const cy = SPELL.bankY + SPELL.bankH / 2
      c2d.save()
      c2d.translate(cx, cy); c2d.scale(sc, sc); c2d.translate(-cx, -cy)
      c2d.globalAlpha = tile.used ? 0.3 : 1
      c2d.fillStyle = 'rgba(0,0,0,.32)'
      roundRect(x, SPELL.bankY + 5, SPELL.bankW, SPELL.bankH, 11); c2d.fill()
      c2d.fillStyle = tile.bad > 0 ? '#8c3730' : '#5b4128'
      roundRect(x, SPELL.bankY, SPELL.bankW, SPELL.bankH, 11); c2d.fill()
      c2d.strokeStyle = tile.bad > 0 ? '#ff9a94' : '#8a6b45'
      c2d.lineWidth = 3; c2d.stroke()
      c2d.fillStyle = '#fff'
      c2d.font = 'bold 36px system-ui, "Segoe UI", sans-serif'
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
      c2d.fillText(tile.ch.toUpperCase(), cx, cy + 1)
      c2d.globalAlpha = 1
      c2d.restore()
    }
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

  /** 戰場還沒下載完的時候畫這個，免得看起來像壞掉的地圖。 */
  function drawLoadingField() {
    c2d.fillStyle = '#3f6b39'; c2d.fillRect(0, 0, W, H)
    c2d.save()
    // 蓋塔位的虛線圈也畫在這片綠色上，字直接寫上去會跟它們糊在一起，
    // 所以墊一塊深色底再寫。
    c2d.font = 'bold 30px system-ui, sans-serif'
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    const t = '戰場載入中…'
    const w = c2d.measureText(t).width + 56
    c2d.fillStyle = 'rgba(20,30,20,.6)'
    roundRect(W / 2 - w / 2, H / 2 - 27, w, 54, 27); c2d.fill()
    c2d.fillStyle = '#fff'
    c2d.fillText(t, W / 2, H / 2 + 1)
    c2d.restore()
  }

  /**
   * 對方被凍住的時候，他那半邊鋪一層藍。
   *
   * 守塔那邊試過 alpha 0.16，在草地上根本看不出來，所以這裡直接用 0.3——
   * 「有效果、看不到」是這個遊戲最常犯的毛病。
   *
   * **範圍是從對方最前面那隻往右，不是從前線往右**：用前線當界線的話，
   * 自己的兵也會站在藍色裡面，看起來像兩邊一起被凍到。從敵兵算起，
   * 藍色蓋到哪裡就等於「這些人現在不動」，一眼對得起來。
   */
  function drawFrost() {
    if (S.battle.chill.foe <= 0) return
    const foes = S.battle.units.filter((u) => u.side === 'foe' && u.hp > 0)
    const x0 = Math.max(0, foes.length
      ? Math.min(...foes.map((u) => u.x)) - 44
      : R.homeFoe - 90)
    const y0 = LAND.r0 * TILE
    const y1 = (LAND.r1 + 1) * TILE
    c2d.save()
    c2d.globalAlpha = 0.3
    c2d.fillStyle = '#9fd0ff'
    c2d.fillRect(x0, y0, W - x0, y1 - y0)
    // 上緣掛一排冰稜，讓它看起來是結霜不是一塊色板
    c2d.globalAlpha = 0.55
    c2d.fillStyle = '#e4f4ff'
    for (let x = x0; x < W; x += 26) {
      c2d.beginPath()
      c2d.moveTo(x, y0); c2d.lineTo(x + 13, y0); c2d.lineTo(x + 6.5, y0 + 18)
      c2d.closePath(); c2d.fill()
    }
    // 每一隻腳下一圈冰，凍住的是「人」不是「那塊地」
    c2d.globalAlpha = 0.5
    for (const u of foes) {
      c2d.beginPath(); c2d.ellipse(u.x, laneY(u) - 4, 26, 10, 0, 0, 7); c2d.fill()
    }
    c2d.restore()
  }

  function draw() {
    if (!terrain && img.tiles) buildTerrain()
    if (terrain) c2d.drawImage(terrain, 0, 0)
    else drawLoadingField()

    drawGuardZone('me')
    drawGuardZone('foe')
    drawCastle('me')
    drawCastle('foe')
    drawTower('me')
    drawTower('foe')
    for (const u of [...S.battle.units].sort((a, b) => laneY(a) - laneY(b))) drawUnit(u)
    drawFrost()
    drawArrows()
    drawFront()

    // 木牌固定在上面、旗子在兵身上，兩者靠顏色配對。不用排版演算法了：
    // 位置是固定的，所以不會飄，也就不需要 plates.ts 那套推擠。
    if (S.line === 'spell') {
      drawSpell()
    } else {
      const list = [...S.targets.values()]
      for (const t of list) drawPennant(t)
      for (const t of list) drawBoard(t)
    }

    for (const f of S.flashes) {
      c2d.strokeStyle = `rgba(255,240,190,${f.life / 0.22})`
      c2d.lineWidth = 3; c2d.lineCap = 'round'
      c2d.beginPath(); c2d.moveTo(R.homeMe, ROAD_Y - 90); c2d.lineTo(f.x, ROAD_Y - 60); c2d.stroke()
    }
    for (const p of S.pops) {
      c2d.globalAlpha = Math.min(1, p.life * 1.6)
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
      // 有圖示就畫圖示（還沒載好就只寫字，畫壞掉的圖會丟例外把整個迴圈打斷）
      const im = p.icon ? popIcon(p.icon) : null
      const S_ = 24
      c2d.font = 'bold 19px system-ui, sans-serif'
      c2d.fillStyle = p.color
      if (im && p.text) {
        // 圖示和字當成一整塊置中，不然 +15 會歪一邊
        const left = p.x - (S_ + 4 + c2d.measureText(p.text).width) / 2
        c2d.drawImage(im, left, p.y - S_ / 2, S_, S_)
        c2d.textAlign = 'left'
        c2d.fillText(p.text, left + S_ + 4, p.y)
      } else if (im) {
        c2d.drawImage(im, p.x - S_ / 2, p.y - S_ / 2, S_, S_)
      } else {
        c2d.fillText(p.text, p.x, p.y)
      }
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
    if (S.line === 'spell') {
      for (let i = 0; i < S.spell.bank.length; i++) {
        const bx = bankX(i)
        if (x >= bx && x <= bx + SPELL.bankW &&
          y >= SPELL.bankY - 6 && y <= SPELL.bankY + SPELL.bankH + 6) return tapLetter(i)
      }
      return
    }
    let best: Target | null = null
    let bestD = 1e9
    for (const t of S.targets.values()) {
      const cx = slotX(t.slot)
      // 木牌是一塊大矩形，點進去就是零距離；點兵身上也算（有些孩子會直接點兵）。
      const inBoard = x >= cx - BOARD.w / 2 && x <= cx + BOARD.w / 2 &&
        y >= BOARD.y - 6 && y <= BOARD.y + BOARD.h + 6
      const d = inBoard ? 0 : Math.hypot(t.x - x, t.y - y)
      if (d < bestD) { bestD = d; best = t }
    }
    if (best && bestD < 46) tap(best)
  }

  cv.addEventListener('pointerdown', onDown)
  elSay.addEventListener('click', () => {
    // 拼字線的題目在下面那一排，沒有 target，所以要各自取字
    const w = S.line === 'spell'
      ? S.spell.word
      : (S.target ? S.targets.get(S.target)?.word ?? null : null)
    if (w) speak(w.word)
  })

  void loadArt()

  // 開發模式下把內部狀態開出來，自動測試才打得完一場。
  // 正式版 build 會整段消失（import.meta.env.DEV 在 production 是 false）。
  if (import.meta.env.DEV) {
    ;(window as unknown as { __tug?: unknown }).__tug = {
      S, RULES: R, BOARD, SPELL, LINES,
      /** 點第幾塊字母磚，拼字測試用 */
      tapLetter: (i: number) => tapLetter(i),
      /** 換兵種線／買升階，測試用 */
      setLine: (l: Line) => switchLine(l),
      buyTier: () => buyTier(),
      /** 直接放一隻兵上場，看軍團各階長相用（legion-e2e.mjs） */
      summon: (side: 'me' | 'foe', l: Line, rank: number) => summon(S.battle, side, l, rank, R),
      /** 定格（畫面照畫、戰場不動），截圖用 */
      freeze: (on: boolean) => { paused = on },
      /** 點某一個目標；測試用它模擬小朋友的正確率 */
      tapId: (id: string) => { const t = S.targets.get(id); if (t) tap(t) },
      ids: () => [...S.targets.keys()],
      /** 真人對戰：兩支手機的戰場要一模一樣，測試拿這個比 */
      truth: () => ls && { tick: ls.tick, t: ls.truth.t, castle: ls.truth.castleHp, front: ls.truth.front,
        units: ls.truth.units.map((u) => [u.id, u.side, Math.round(u.x * 1000), Math.round(u.hp * 1000)]),
        over: ls.truth.over, winner: ls.truth.winner },
      liveOn: () => liveOn,
      truthLog: () => Object.fromEntries(truthLog),
    }
  }

  syncTargets()
  pickQuestion()
  syncUI()
  toast(foe.isBot ? `對手是電腦：${foe.name}`
    : foe.isGhost ? `對手是${foe.name}的分身（重播最近一場）`
    : live ? `真人對戰：${foe.name}！答對的兵 1 秒多後出發` : `對手：${foe.name}`)
  // 開戰的儀式感：號角先響，熱血 BGM 跟上。
  // 進到這個畫面之前一定點過「開打」，所以 iOS 的解鎖已經拿到了。
  ctx.audio.unlock()
  ctx.audio.play('battle-horn')
  ctx.audio.playMusic('battle')
  raf = requestAnimationFrame(loop)

  return {
    useItem,
    setPaused(on: boolean) {
      paused = on
      if (!on) last = performance.now()
      // 暫停（按了「離開」在問你確定嗎）的時候音樂也停，但不要從頭開始。
      ctx.audio.pauseMusic(on)
    },
    destroy() {
      unArt()
      cancelAnimationFrame(raf)
      // 中途離開也要把音樂收掉，不然回到選關畫面還在放。
      ctx.audio.playMusic(null)
      cv.removeEventListener('pointerdown', onDown)
      try { speechSynthesis.cancel() } catch { /* 沒有就算了 */ }
      root.innerHTML = ''
    },
  }
}
