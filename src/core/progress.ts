import type { GameOutcome, LevelProgress } from './types'

/** 等級只負責解鎖，不縮放傷害——傷害由單字難度決定。 */
const EXP_PER_LEVEL = 120

export function levelFromExp(exp: number): number {
  return Math.floor(exp / EXP_PER_LEVEL) + 1
}
export function expIntoLevel(exp: number): { into: number; need: number } {
  return { into: exp % EXP_PER_LEVEL, need: EXP_PER_LEVEL }
}

/**
 * 星星用正確率當門檻，不用速度——用速度會鼓勵亂點。
 * 第三顆星看城堡剩多少血，那是戰術打得好不好。
 */
export function starsFor(o: {
  outcome: GameOutcome
  correct: number
  asked: number
}): 0 | 1 | 2 | 3 {
  if (!o.outcome.win) return 0
  const acc = o.asked ? o.correct / o.asked : 0
  let stars = 1
  if (acc >= 0.8) stars = 2
  if (acc >= 0.8 && o.outcome.survival >= 0.6) stars = 3
  return stars as 0 | 1 | 2 | 3
}

export interface UnlockState {
  /** 已經通關的關卡 */
  cleared: Set<string>
  /** 老師額外開放的關卡（「這禮拜練第 3 關」），不受進度限制 */
  teacherOpen: Set<string>
}

/**
 * 解鎖規則：第一關永遠開；通關第 n 關就開第 n+1 關；
 * 老師可以另外開任何一關。通過的關永遠可以回頭重玩。
 *
 * **換章要整章打完**（2026-09-25 Chuck 定的）：第二章第一關要第一章每一關都通關才開，
 * 第三章同理。只過前一關不夠——不然跳著過（老師開的關）也能一路衝進國中字。
 * 老師開的關照樣直接能玩，那是老師的決定。
 */
export function isUnlocked(
  levelNo: number,
  levels: { id: string; no: number; chapter: number }[],
  st: UnlockState,
): boolean {
  const i = levels.findIndex((l) => l.no === levelNo)
  const lv = levels[i]
  if (!lv) return false
  if (i === 0) return true
  if (st.teacherOpen.has(lv.id)) return true
  if (st.cleared.has(lv.id)) return true
  const prev = levels[i - 1]
  if (prev.chapter !== lv.chapter) return chapterCleared(prev.chapter, levels, st.cleared)
  return st.cleared.has(prev.id)
}

/** 這一章是不是每一關都通關了 */
export function chapterCleared(
  chapter: number,
  levels: { id: string; chapter: number }[],
  cleared: Set<string>,
): boolean {
  const mine = levels.filter((l) => l.chapter === chapter)
  return mine.length > 0 && mine.every((l) => cleared.has(l.id))
}

export function mergeProgress(prev: LevelProgress | undefined, next: LevelProgress): LevelProgress {
  if (!prev) return next
  return {
    levelId: next.levelId,
    stars: Math.max(prev.stars, next.stars) as 0 | 1 | 2 | 3,
    bestCorrect: Math.max(prev.bestCorrect, next.bestCorrect),
    clearedAt: prev.clearedAt ?? next.clearedAt,
  }
}

/**
 * 首次通關給一筆獎勵，重玩就沒有——不然刷第一關最划算。
 *
 * 第一章是 40＋關卡編號×10（50～180）。後兩章如果照編號算，第 85 關會給 890，
 * 所以改照章內的位置：第二章 90～210、第三章 130～250。**伺服器的 finish_level
 * 用同一條公式**（levels.bonus 欄位由 gen-levels-seed 從這裡算好灌進去）。
 */
export function firstClearBonus(level: { no: number; chapter?: number; bonus?: number } | number, alreadyCleared: boolean): number {
  if (alreadyCleared) return 0
  if (typeof level === 'number') return 40 + level * 10
  return level.bonus ?? 40 + level.no * 10
}
