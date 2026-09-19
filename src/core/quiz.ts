import type { Question, Skill, Word } from './types'
import type { WordStat } from './wordStat'

export interface QuizOptions {
  words: Word[]
  skill: Skill
  /** 只考這些主題。空陣列代表全部。 */
  themes?: string[]
  maxWordLevel?: 1 | 2 | 3
  stat?: WordStat
  /** 測試用，讓出題可重現 */
  random?: () => number
}

/**
 * 出題。三個遊戲共用同一套，所以複習策略只有一份。
 * 遊戲不自己挑字——它只問「下一題是什麼」。
 */
export class Quiz {
  readonly pool: Word[]
  readonly skill: Skill
  private stat?: WordStat
  private rnd: () => number
  /** 剛出過的字，避免連續重複 */
  private recent: number[] = []

  constructor(o: QuizOptions) {
    this.skill = o.skill
    this.stat = o.stat
    this.rnd = o.random ?? Math.random
    const themes = o.themes ?? []
    const max = o.maxWordLevel ?? 3
    this.pool = o.words.filter(
      (w) =>
        w.level <= max &&
        (themes.length === 0 || themes.includes(w.theme)) &&
        (o.skill !== 'spell' || w.spell),
    )
  }

  get size(): number {
    return this.pool.length
  }

  /** 加權抽一個字，最近出過的先排除 */
  next(): Question | null {
    if (!this.pool.length) return null
    const avoid = new Set(this.recent)
    let candidates = this.pool.filter((w) => !avoid.has(w.id))
    if (!candidates.length) candidates = this.pool

    const now = Date.now()
    const weights = candidates.map((w) =>
      this.stat ? this.stat.weight(w.id, this.skill, now) : 1,
    )
    const total = weights.reduce((a, b) => a + b, 0)
    let r = this.rnd() * total
    let picked = candidates[candidates.length - 1]
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i]
      if (r <= 0) { picked = candidates[i]; break }
    }

    this.recent.push(picked.id)
    // 題庫小的時候記憶要短，不然會沒得挑
    const memory = Math.min(6, Math.max(1, Math.floor(this.pool.length / 3)))
    while (this.recent.length > memory) this.recent.shift()

    return { word: picked, skill: this.skill }
  }

  /** 守塔要一次拿一批字掛在怪身上 */
  take(n: number): Question[] {
    const out: Question[] = []
    for (let i = 0; i < n; i++) {
      const q = this.next()
      if (!q) break
      out.push(q)
    }
    return out
  }
}
