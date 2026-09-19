import type { AnswerReport, Word } from './types'

/**
 * 錢只有這一個出口。
 *
 * 鐵則：一題值多少錢，由字的難度和你答過幾次決定，**跟你在玩哪個遊戲無關**。
 * 遊戲唯一能影響的是「一分鐘能答幾題」。打地鼠賺得多是因為題數多，
 * 不是因為它給得大方——這樣加十個遊戲，經濟都不會崩。
 */

/** 不同難度的字基礎值不同，鼓勵去啃難的 */
const BASE_BY_LEVEL: Record<number, number> = { 1: 3, 2: 4, 3: 6 }

/** 同一個字重複答對，第 n 次的折扣。超過就都是最後一檔。 */
const REPEAT_DECAY = [1, 1, 0.7, 0.5, 0.35, 0.25, 0.15]

/** 連擊加成，上限兩倍 */
function comboMultiplier(combo: number): number {
  return 1 + Math.min(1, Math.floor(combo / 3) * 0.2)
}

export function repeatFactor(timesAlreadyCorrect: number): number {
  const i = Math.min(timesAlreadyCorrect, REPEAT_DECAY.length - 1)
  return REPEAT_DECAY[i]
}

export interface CoinInput {
  word: Word
  report: AnswerReport
  /** 這個字之前已經答對過幾次（跨場次累計） */
  timesAlreadyCorrect: number
  /** 首次通關某一關會另外給獎勵，重玩就沒有；由 progress 決定 */
  firstClearBonus?: number
}

export function coinsFor(i: CoinInput): number {
  if (!i.report.correct) return 0
  const base = BASE_BY_LEVEL[i.word.level] ?? 3
  const coins = base * repeatFactor(i.timesAlreadyCorrect) * comboMultiplier(i.report.combo)
  return Math.max(1, Math.round(coins))
}

/** 經驗與金幣一樣，只能從答對來，但不受重複遞減影響——練熟也是學習 */
export function expFor(i: Pick<CoinInput, 'word' | 'report'>): number {
  return i.report.correct ? i.word.level : 0
}
