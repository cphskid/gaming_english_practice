// 整個系統的契約。改這個檔案之前先想清楚——底下所有東西都依賴它。
// 設計說明見 docs/architecture.md

// ---------------------------------------------------------------------------
// 能力維度
// ---------------------------------------------------------------------------

/**
 * 「會這個字」不是一件事，是三件事。
 * 在打地鼠把 apple 點對十次，不代表拼得出來，所以答題紀錄一定要分維度，
 * 否則複習策略和老師報表都會是錯的。
 */
export type Skill = 'recognize' | 'spell' | 'listen'

export const SKILL_NAME: Record<Skill, string> = {
  recognize: '認字',
  spell: '拼寫',
  listen: '聽力',
}

// ---------------------------------------------------------------------------
// 模式
// ---------------------------------------------------------------------------

/** 模式描述規則（誰跟誰比、怎麼加總）。關卡描述地圖和怪。兩者不可混在一起。 */
export type Mode = 'solo' | 'versus' | 'team'

export const MODE_NAME: Record<Mode, string> = {
  solo: '個人',
  versus: '競爭',
  team: '團隊競爭',
}

// ---------------------------------------------------------------------------
// 題庫
// ---------------------------------------------------------------------------

export type WordLevel = 1 | 2 | 3

export interface Word {
  id: number
  word: string
  pos: string
  zh: string
  theme: string
  emoji: string
  /** 課綱要求要會拼寫的字 */
  spell: boolean
  level: WordLevel
  /**
   * 哪一層字庫，也就是哪一章：1＝國小核心 300、2＝基本 1,200 剩下的、3＝其他常用 800。
   * 守塔以外的遊戲（兵推、團戰）先只出第 1 層，免得國小生在對戰裡撞到國中字。
   */
  tier: 1 | 2 | 3
  /** 課綱括號裡的別名或變化形（airplane 的 plane、be 的 am/is/are），只給人看，不出題 */
  alt?: string
}

export interface Question {
  word: Word
  skill: Skill
}

// ---------------------------------------------------------------------------
// 答題事件 —— 整個系統唯一的真相來源
// ---------------------------------------------------------------------------

/**
 * 遊戲回報一題的結果。遊戲只知道這些，不知道這題值多少錢。
 * 注意沒有 coins、沒有 exp：那是 core 算的。
 */
export interface AnswerReport {
  wordId: number
  skill: Skill
  correct: boolean
  /** 從出題到作答的毫秒數 */
  ms: number
  /** 這題之前已經連對幾題（0 代表這是連擊的第一題） */
  combo: number
}

/** 寫進資料庫的那一列。localStorage 版與 Supabase 版存的是同一個形狀。 */
export interface AnswerEvent extends AnswerReport {
  studentId: string
  gameId: string
  /** 沒有關卡的遊戲（例如打地鼠）是 null */
  levelId: string | null
  /**
   * 這一題屬於哪一場。伺服器靠它把「這一場答對幾題」和「這一場通關了嗎」
   * 兜在一起——星星是這樣算出來的，不是前端說了算。
   */
  sessionId: string
  /**
   * 這是這一場的第幾題。存在的理由只有一個：**同一題不可以被算兩次錢**。
   * 結算失敗時人可以按重試，重試會把整場的答題再送一次；伺服器靠
   * (學生, 這一場, 第幾題) 把重複的擋掉。見 supabase/schema.sql 的 submit_answers。
   */
  ord: number
  /** epoch 毫秒 */
  at: number
}

// ---------------------------------------------------------------------------
// 關卡
// ---------------------------------------------------------------------------

export interface Point { x: number; y: number }

/** 佈局＝這一關要怎麼打。座標以 1088×576 的戰場為準，一格 64。 */
export interface Layout {
  /** 陸地的上下邊界（以格為單位） */
  land: { r0: number; r1: number }
  /** 高地，怪走不上去但可以蓋塔，兩條路都打得到 */
  plateaus: { c0: number; c1: number; r0: number; r1: number }[]
  /** 怪走的路。每條路是一串折線點，第一點在畫面外。 */
  paths: Point[][]
  castle: Point
  /** 蓋塔位置。y 是腳下踩到的地面。hi 代表在高地上。 */
  slots: (Point & { hi?: boolean })[]
  decor: { k: string; x: number; y: number }[]
}

export interface WaveSpec {
  /** 這一波幾隻怪 */
  count: number
  hp: number
  /** 每秒走幾像素 */
  speed: number
  /** 每隻之間隔幾秒進場 */
  gap: number
  art?: string
}

/** 規則＝波次與怪。與佈局分開，所以同一張圖可以有不同難度。 */
export interface LevelRules {
  castleHp: number
  startCoins: number
  waves: WaveSpec[]
  boss?: { hp: number; speed: number; art: string; scale: number }
}

export interface LevelData {
  id: string
  no: number
  name: string
  /** 這一關考哪些主題的字。空陣列代表全部。 */
  themes: string[]
  /**
   * 這一關考哪些字（題庫 id）。有這欄就照這份出題，不看 themes。
   * 第二、三章的大主題（動作、其他名詞）一個主題就上百個字，要切成好幾關，
   * 所以不能只靠主題；themes 那時只拿來寫關卡上的小字。
   */
  wordIds?: number[]
  /** 第幾章（1～3）。章跟章之間要整章打完才開下一章。 */
  chapter: 1 | 2 | 3
  /** 首次通關的金幣（伺服器 levels.bonus 同一個數字，見 core/progress.ts firstClearBonus） */
  bonus: number
  /** 出題最高到第幾級 */
  maxWordLevel: WordLevel
  isBoss: boolean
  /** 外觀。每五關換一次配色，所以多關共用。 */
  skin: { tileset: string }
  layout: Layout
  rules: LevelRules
}

// ---------------------------------------------------------------------------
// 遊戲契約
// ---------------------------------------------------------------------------

/** core 交給遊戲的東西。遊戲只看得到這些，不 import core。 */
/**
 * 對手在第 t 秒做了什麼。答錯也要記，不然看不出他其實在掙扎。
 * 產生器在 core/opponent.ts。
 */
export interface Move {
  /** 從開場算起第幾秒 */
  t: number
  correct: boolean
  /** 答對時召喚出來的兵是第幾階；答錯是 null */
  rank: number | null
  /**
   * 真人錄下來的那一場才有（分身挑戰）。電腦的答題串沒有這欄，引擎照舊自己決定
   * 走哪條線、什麼時候出兵；有這欄的就**照他當時做的事原樣重播**：
   *   answer  答了一題（correct 說對錯）——答對一樣開一槍、拿水晶
   *   summon  派出一隻 line 線、rank 階的兵
   *   up      按了升階
   * 分開記而不是只記答題，是因為換線、什麼時候升階都是他自己的決定，
   * 只記對錯的話重播出來的是電腦，不是他。
   */
  act?: 'answer' | 'summon' | 'up'
  /** act 是 summon 時派的是哪條線；answer 時是答哪條線的題（舊紀錄沒有） */
  line?: Skill
}

/**
 * 對戰的對手。
 *
 * **整個對戰模式的關鍵：對手是「一串照時間發生的答題」，不是「另一台連著線的裝置」。**
 * 好友在線、好友的上一場紀錄、電腦、之後的跨班配對，四件事因此是同一套程式。
 */
export interface Opponent {
  name: string
  /** 電腦要老實寫出來。小孩被騙到會更不爽，而且輸給電腦不該記進戰績。 */
  isBot: boolean
  /**
   * 同學的分身：重播他最近一場的紀錄，本人不在線上。一樣要老實寫出來——
   * 小朋友以為同學真的在跟他打，結果去問同學，那就穿幫了。
   */
  isGhost?: boolean
  /** 對手穿哪一套軍團（品項 id，王國軍是空字串）。電腦不填，一律紅色王國軍。 */
  legion?: string
  /** 到第 t 秒為止，對手做過的事（累計，可以重複問）。 */
  movesUntil(t: number): Move[]
  /**
   * 真人即時對戰才有：跟對方手機之間的那條線（見 LiveLink）。
   * 有這個的時候 movesUntil 不用，戰場改走 lockstep（games/tug-of-war/lockstep.ts）。
   */
  live?: LiveLink
  /**
   * 這一場不出聽音題。教室裡大家一起對戰，旁邊同學的手機一念，答案就被聽到了——
   * 班上對戰預設關掉，老師可以在班級設定打開。
   */
  noListen?: boolean
}

/**
 * 真人對戰裡的一個動作。跟 Move 很像，差在時間用**格數**（一秒 30 格）而不是秒：
 * 兩支手機要在同一格套用同一個動作，秒數是小數，兩邊加總出來可能差一點點，格數不會。
 *
 * 答對那一槍打哪一隻也要記（target＝兵的編號，-1＝打城牆守衛），
 * 兩邊才會打在同一隻上。
 */
export interface LiveMove {
  /** 在第幾格做的 */
  k: number
  act: 'answer' | 'summon' | 'up'
  correct?: boolean
  target?: number
  line?: Skill
  rank?: number
}

/**
 * 跟對方手機之間的線。實作在 net/live.ts（每半秒問一次伺服器，不用長連線）。
 *
 * 規則只有一條：**我說「第 k 格以前的動作都送了」，就不會再送 k 以前的動作。**
 * 對方靠這個知道自己可以放心往前算到哪一格（見 lockstep.ts）。
 */
export interface LiveLink {
  /**
   * 我是第一位還是第二位。兩支手機算的是**同一份戰場**，第一位永遠在那份戰場的左邊；
   * 第二位的手機畫的時候左右翻過來，所以每個人看到的都是自己在左邊。
   */
  seat: 1 | 2
  /** 這一場在伺服器上的編號 */
  matchId: string
  /** 送出一個動作 */
  send(m: LiveMove): void
  /** 第 k 格以前的動作都送出了 */
  mark(k: number): void
  /** 對方到現在送來的所有動作，照他做的順序（累計，可以重複問） */
  theirMoves(): LiveMove[]
  /** 對方說過「第幾格以前都送了」。還沒聽到任何消息是 -1。 */
  theirMark(): number
  /** 對方按了離開 */
  theirGone(): boolean
  /** 對方斷線或離開之後改打這個（他的分身，沒有分身就是電腦） */
  fallback: Opponent
  /** 打完或離開。left＝中途離開，對方那邊會改成打分身。 */
  close(left: boolean): void
}

export interface GameContext {
  /** 沒有關卡的遊戲是 null */
  level: LevelData | null
  /**
   * 玩家的職業。遊戲拿它決定「答對之後那一發怎麼分配」，
   * 不是拿來加傷害——見 data/jobs.ts 的說明。
   * 用不到職業的遊戲（例如打地鼠）忽略它就好。
   */
  job: Job
  /**
   * 陣營顏色的美術後綴（例如 '_red'，預設藍色是空字串）。
   * 這和 legion 是裝飾品唯二會進到遊戲裡的東西，而且**只能改外觀，不准改數值**。
   * 穿著王國軍以外的軍團時一律是空字串（顏色只對王國軍有效）。
   */
  color: string
  /**
   * 身上那一套軍團的品項 id，王國軍是空字串（見 data/legions.ts）。
   * 兵推整套換（兵、城堡、塔、戰場）；守塔只換軍營士兵和箭塔。
   */
  legion: string
  /**
   * 下一題。回傳 null 代表題庫用完了。
   *
   * 不給題型就用遊戲自己的預設。**兵推要三種題型輪流用**（認字／聽音／拼字
   * 各對應一條兵種線），所以這裡可以指定；容器會照題型各開一份出題器，
   * 複習權重才不會混在一起。
   */
  nextQuestion(skill?: Skill): Question | null
  /** 唯一的回報管道 */
  report(r: AnswerReport): void
  audio: AudioBus
  /** 對戰模式才有。單人遊戲是 null。 */
  opponent: Opponent | null
  /** 魔王團戰才有：這一場的隊友、魔王、跟大家手機之間的線（見 RaidLink） */
  raid?: RaidLink
  /** 遊戲自己決定什麼時候結束 */
  finish(outcome: GameOutcome): void
}

/** 魔王團戰的一個座位（第幾號座位＝戰場上第幾座城） */
export interface RaidSeatInfo {
  seat: number
  studentId: string
  nickname: string
  /** 他穿的軍團（品項 id，王國軍是空字串） */
  legion: string
  /** 每分鐘大概答對幾題，開打時拿來算魔王的血 */
  rate: number
  me: boolean
}

/**
 * 魔王團戰跟大家手機之間的線。實作在 net/raid.ts（每 0.4 秒問一次伺服器）。
 * 規則跟 LiveLink 一樣：我說「第 k 格以前的動作都送了」，就不會再送 k 以前的動作。
 */
export interface RaidLink {
  roomId: string
  bossId: string
  /** 開打那一刻伺服器定的亂數種子，每支手機一樣 */
  seed: number
  /** 我是第幾號座位 */
  seat: number
  seats: RaidSeatInfo[]
  /** 這一場不出聽音題 */
  noListen: boolean
  send(m: LiveMove): void
  mark(k: number): void
  /** 每個座位到現在的消息（照座位號排） */
  feeds(): { moves: LiveMove[]; mark: number; final: number | null }[]
  /** 我被伺服器判斷線了（太久沒消息）。這一份戰場已經跟大家不一樣，要結束。 */
  kickedOut(): boolean
  /** 打完或離開。left＝中途離開，大家那邊由電腦接手我的座位。 */
  close(left: boolean): void
}

/** 遊戲結束時回報的「遊戲自己的結果」，不含金幣經驗。 */
export interface GameOutcome {
  win: boolean
  /** 0~1，用來算第三顆星。沒有城堡的遊戲填 1。 */
  survival: number
  /** 給結算畫面看的一句話 */
  detail: string
  /**
   * 對戰才有的戰報。容器拿它去記戰績（versus_matches），成就那邊要用——
   * 「三線通吃」「頂階降臨」「逆轉勝」從答題事件是看不出來的。
   */
  versus?: {
    /** 前線最後推到哪，0＝自己城牆、1＝對方城堡 */
    front: number
    /** 整場最落後的時候。逆轉勝要用。 */
    lowestFront: number
    /** 用過哪幾條兵種線 */
    linesUsed: Skill[]
    /** 這一場推出過的最高兵階 */
    topTier: number
    /** 這一場自己做過的事，照時間排。存起來就是同學挑戰你時的「分身」。 */
    moves: Move[]
    /**
     * 真人即時對戰：打到最後都是跟本人打（true），還是中途對方斷線、
     * 剩下的改打分身（false）。**只有 true 的那場贏了才算戰旗。**
     * 不是真人對戰就沒有這一欄。
     */
    liveToEnd?: boolean
  }
  /** 魔王團戰才有。容器拿去跟伺服器回報（raid_result），兩個人都說贏才算打倒。 */
  raid?: {
    won: boolean
    /** 我對魔王打了多少 */
    dealt: number
    correct: number
    /** 我斷線太久被判出局，這一場的結果不回報 */
    kickedOut: boolean
  }
}

export interface GameHandle {
  /** 離開畫面時要叫，停掉 requestAnimationFrame 與事件監聽 */
  destroy(): void
  /**
   * 用一個道具。容器管背包（有沒有、扣不扣），遊戲只管效果長什麼樣，
   * 所以遊戲一樣碰不到金幣與存檔。回傳 false 代表現在用了會浪費，
   * 容器就不要把道具扣掉。不吃道具的遊戲不用實作。
   */
  useItem?(itemId: string): boolean
  /**
   * 暫停／繼續。容器要跳確認框或設定選單時用——
   * 不暫停的話小朋友在讀「確定要離開嗎」的時候怪還在走，會莫名其妙掉血。
   */
  setPaused?(on: boolean): void
}

export interface GameModule {
  id: string
  name: string
  emoji: string
  /** 這個遊戲練哪個能力 */
  skill: Skill
  hasLevels: boolean
  supportedModes: Mode[]
  mount(el: HTMLElement, ctx: GameContext): GameHandle
}

// ---------------------------------------------------------------------------
// 音訊
// ---------------------------------------------------------------------------

export type SfxName =
  | 'answer-correct' | 'answer-wrong' | 'volley' | 'enemy-hit' | 'enemy-die'
  | 'castle-hit' | 'tower-build' | 'tower-sell' | 'wave-start' | 'star'
  | 'coin' | 'ui-tap' | 'explosion' | 'victory' | 'defeat' | 'battle-horn'

/** 有哪幾首曲子。對戰才放音樂，關卡裡不放（一整班同時放會吵到老師）。 */
export type MusicName = 'battle' | 'boss'

export interface AudioBus {
  play(name: SfxName): void
  /** iOS 不准使用者互動前播聲音，所以第一次要綁在「開始」那一下 */
  unlock(): void
  setSfxEnabled(on: boolean): void
  setMusicEnabled(on: boolean): void
  /** 換一首，或傳 null 把音樂停掉。音樂總開關是關的時候這支什麼都不做。 */
  playMusic(track: MusicName | null): void
  /** 把音樂放快一點。對戰最後三十秒用它把節奏催起來。 */
  setMusicRate(rate: number): void
  /** 暫停／繼續，**不會從頭開始**。按「離開」在問你確定嗎的時候用。 */
  pauseMusic(on: boolean): void
  readonly isMusicOn: boolean
}

// ---------------------------------------------------------------------------
// 帳號與角色（刻意分開：帳號是你是誰，角色是你的存檔）
// ---------------------------------------------------------------------------

export type Role = 'student' | 'teacher'

/** 學生只有班級代碼與暱稱，不收真實姓名與 email。 */
export interface Student {
  id: string
  /** 登入用的帳號，全站唯一。跟 nickname 是兩回事：nickname 可以改、可以跟別班的人重複。 */
  loginId: string
  /** 現在在哪一班。null＝還沒加入任何班級（例如朋友的小孩）。 */
  classCode: string | null
  nickname: string
  role: Role
  /**
   * 註冊時間，epoch 毫秒。本地版才有——Supabase 那邊 students 只 grant
   * 三個欄位出來（見 schema.sql），註冊時間只有伺服器自己看得到。
   */
  createdAt?: number
}

/** 老師或管理員。跟 Student 是兩種不同的身分，走不同的登入方式。 */
export interface Staff {
  userId: string
  email: string
  displayName: string
  isAdmin: boolean
}

/** 老師看到的一個班。 */
export interface ClassRoom {
  code: string
  name: string
  open: boolean
  /** 班上真人對戰出不出聽音題（教室裡會互相聽到答案，預設不出） */
  liveListen?: boolean
}

/** 管理員看到的一位老師。 */
export interface TeacherRow {
  userId: string
  displayName: string
  isAdmin: boolean
  active: boolean
  classes: number
  students: number
  email?: string
  /** 自己在「老師／家長」畫面註冊的（不是管理員開的） */
  selfSignup?: boolean
  createdAt?: string
  maxClasses?: number
  maxStudents?: number
}

/** 管理員看到的一個班級：誰在帶、幾個人。 */
export interface AdminClassRow {
  code: string
  name: string
  open: boolean
  /** 帶這一班的老師。班級是掛在代碼上的，換老師不會動到學生。 */
  ownerId: string
  ownerName: string
  ownerActive: boolean
  students: number
}

export type Job = 'knight' | 'mage'

export interface Character {
  studentId: string
  job: Job
  /** 頭像 id。空字串代表還沒創角，登入後會被帶去創角畫面。 */
  avatar: string
  exp: number
  coins: number
  /** 道具與裝飾品，key 是 item id，value 是數量 */
  items: Record<string, number>
  /** 目前穿戴的外觀 */
  equipped: string[]
  /** 別在名字旁邊的三個徽章。同學在排行榜上看得到的就是這三個。 */
  pinned?: string[]
  /** 稱號，解成就拿到的 */
  title?: string
  /** 讓同學從排行榜點進來看我的徽章。預設開，自己可以關，老師一律看得到。 */
  publicProfile?: boolean
  /** 換過哪些頭像。avatar 只存現在這一個，但「換頭像」那個成就數的是種類。 */
  avatarsSeen?: string[]
  /** 用哪些職業通關過（「雙修」要用）。職業隨時能改，所以要在通關那一刻記。 */
  jobsCleared?: string[]
  /**
   * 穿過哪些陣營顏色打過一場（「五色軍團」要用）。藍色是 'blue'。
   * **只有本地版會填**：正式版是資料庫自己記、自己判成就，前端不讀這一欄——
   * 前端多讀一個新欄位，資料庫還沒升級時整個登入就會壞掉（2026-09-24 踩過）。
   */
  colorsPlayed?: string[]
}

export interface LevelProgress {
  levelId: string
  stars: 0 | 1 | 2 | 3
  bestCorrect: number
  clearedAt: number | null
  /** 通關那幾次裡城堡血剩最多的一次，0~1。「城牆不倒」要用。 */
  bestSurvival?: number
  /** 最後一次通關是哪一場。「空手過關」要知道那一場有沒有用道具。 */
  lastWinSession?: string | null
}

/** wordStat 的一格：某個學生的某個字的某個能力 */
export interface WordStatEntry {
  wordId: number
  skill: Skill
  seen: number
  correct: number
  wrong: number
  /** 連續答對幾次 */
  streak: number
  lastAt: number
  /** 答對時的平均反應毫秒 */
  avgMs: number
}
