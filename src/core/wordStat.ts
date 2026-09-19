import type { AnswerEvent, Skill, WordStatEntry } from './types'

const key = (wordId: number, skill: Skill) => `${wordId}:${skill}`

/**
 * 每個字在每個能力維度上的掌握度。
 * 這不是另外存的資料，而是把答題事件跑一遍算出來的——所以永遠跟事件一致，
 * 也代表之後想換算法只要重跑一次，不用改資料庫。
 */
export class WordStat {
  private map = new Map<string, WordStatEntry>()

  static from(events: AnswerEvent[]): WordStat {
    const s = new WordStat()
    for (const e of events) s.apply(e)
    return s
  }

  /**
   * 後端已經算好的版本。
   * 本地版是把事件跑一遍算出來的，但接了後端之後一個學生一年有好幾萬列，
   * 每次登入都撈回來跑一遍太傻——所以資料庫那邊把同一份結果存成一張表。
   * 算法改了就重跑 rebuild_word_stats()，事件永遠是真相。
   */
  static fromEntries(entries: WordStatEntry[]): WordStat {
    const s = new WordStat()
    for (const e of entries) s.map.set(key(e.wordId, e.skill), { ...e })
    return s
  }

  apply(e: AnswerEvent): void {
    const k = key(e.wordId, e.skill)
    const cur: WordStatEntry = this.map.get(k) ?? {
      wordId: e.wordId, skill: e.skill,
      seen: 0, correct: 0, wrong: 0, streak: 0, lastAt: 0, avgMs: 0,
    }
    cur.seen += 1
    cur.lastAt = e.at
    if (e.correct) {
      // 只有答對的反應時間有意義，答錯的時間是在亂點
      cur.avgMs = cur.correct === 0 ? e.ms : Math.round((cur.avgMs * cur.correct + e.ms) / (cur.correct + 1))
      cur.correct += 1
      cur.streak += 1
    } else {
      cur.wrong += 1
      cur.streak = 0
    }
    this.map.set(k, cur)
  }

  get(wordId: number, skill: Skill): WordStatEntry | undefined {
    return this.map.get(key(wordId, skill))
  }

  /** 這個字答對過幾次，economy 用它算重複遞減 */
  correctCount(wordId: number, skill: Skill): number {
    return this.map.get(key(wordId, skill))?.correct ?? 0
  }

  /**
   * 出題權重：越不熟的字越容易被抽到。
   * 沒看過的字給中等權重（要讓新字有機會出現，但不能壓過該複習的字）。
   */
  weight(wordId: number, skill: Skill, now: number): number {
    const e = this.map.get(key(wordId, skill))
    if (!e) return 3
    const wrongRate = e.seen ? e.wrong / e.seen : 0
    let w = 1 + wrongRate * 6            // 常錯的字最多七倍
    if (e.streak >= 3) w *= 0.35          // 連對三次就先放一邊
    const days = (now - e.lastAt) / 86_400_000
    if (days > 3) w *= 1.6                // 太久沒碰到，拉回來複習
    return Math.max(0.2, w)
  }

  entries(): WordStatEntry[] {
    return [...this.map.values()]
  }

  /** 老師報表：最常錯的字。這是整個系統對老師最有價值的東西。 */
  mostMissed(limit = 10): WordStatEntry[] {
    return this.entries()
      .filter((e) => e.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong || b.wrong / b.seen - a.wrong / a.seen)
      .slice(0, limit)
  }
}
