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
 */
export function isUnlocked(levelNo: number, levelIds: string[], st: UnlockState): boolean {
  const id = levelIds[levelNo - 1]
  if (!id) return false
  if (levelNo === 1) return true
  if (st.teacherOpen.has(id)) return true
  if (st.cleared.has(id)) return true
  const prev = levelIds[levelNo - 2]
  return !!prev && st.cleared.has(prev)
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

/** 首次通關給一筆獎勵，重玩就沒有——不然刷第一關最划算 */
export function firstClearBonus(levelNo: number, alreadyCleared: boolean): number {
  return alreadyCleared ? 0 : 40 + levelNo * 10
}
