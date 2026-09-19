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
export interface GameContext {
  /** 沒有關卡的遊戲是 null */
  level: LevelData | null
  /** 下一題。回傳 null 代表題庫用完了。 */
  nextQuestion(): Question | null
  /** 唯一的回報管道 */
  report(r: AnswerReport): void
  audio: AudioBus
  /** 遊戲自己決定什麼時候結束 */
  finish(outcome: GameOutcome): void
}

/** 遊戲結束時回報的「遊戲自己的結果」，不含金幣經驗。 */
export interface GameOutcome {
  win: boolean
  /** 0~1，用來算第三顆星。沒有城堡的遊戲填 1。 */
  survival: number
  /** 給結算畫面看的一句話 */
  detail: string
}

export interface GameHandle {
  /** 離開畫面時要叫，停掉 requestAnimationFrame 與事件監聽 */
  destroy(): void
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
  | 'coin' | 'ui-tap' | 'explosion' | 'victory' | 'defeat'

export interface AudioBus {
  play(name: SfxName): void
  /** iOS 不准使用者互動前播聲音，所以第一次要綁在「開始」那一下 */
  unlock(): void
  setSfxEnabled(on: boolean): void
  setMusicEnabled(on: boolean): void
}

// ---------------------------------------------------------------------------
// 帳號與角色（刻意分開：帳號是你是誰，角色是你的存檔）
// ---------------------------------------------------------------------------

export type Role = 'student' | 'teacher'

/** 學生只有班級代碼與暱稱，不收真實姓名與 email。 */
export interface Student {
  id: string
  classCode: string
  nickname: string
  role: Role
}

export type Job = 'knight' | 'mage'

export interface Character {
  studentId: string
  job: Job
  exp: number
  coins: number
  /** 道具與裝飾品，key 是 item id，value 是數量 */
  items: Record<string, number>
  /** 目前穿戴的外觀 */
  equipped: string[]
}

export interface LevelProgress {
  levelId: string
  stars: 0 | 1 | 2 | 3
  bestCorrect: number
  clearedAt: number | null
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
