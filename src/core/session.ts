import { coinsFor, expFor } from './economy'
import { firstClearBonus, starsFor } from './progress'
import type {
  AnswerEvent, AnswerReport, GameOutcome, LevelData, Mode, Word,
} from './types'
import type { WordStat } from './wordStat'

/**
 * 一場遊戲。
 *
 * **從第一天就設計成多人也成立**，個人模式只是參與者剛好一個人。
 * 這是「現在不接後端也不會白工」的技術前提：之後加房間不用回頭改這裡，
 * 排行榜也是同一份程式（把事件加總），本地加總本地事件，連線加總廣播事件。
 */

export interface Participant {
  studentId: string
  nickname: string
  /** 團隊模式才有 */
  team?: string
}

export interface ParticipantScore {
  studentId: string
  nickname: string
  team?: string
  correct: number
  asked: number
  coins: number
  exp: number
  combo: number
  bestCombo: number
}

export interface SessionResult {
  levelId: string | null
  mode: Mode
  outcome: GameOutcome
  /** 依分數排好的名次 */
  scores: ParticipantScore[]
  events: AnswerEvent[]
  stars: 0 | 1 | 2 | 3
  /** 首次通關才有 */
  bonusCoins: number
}

export interface SessionOptions {
  mode: Mode
  gameId: string
  level: LevelData | null
  participants: Participant[]
  /** 給 economy 查字的難度 */
  wordsById: Map<number, Word>
  /** 用來算同字重複遞減；沒給就當作每個字都是第一次 */
  stat?: WordStat
  alreadyCleared?: boolean
}

export class Session {
  readonly mode: Mode
  readonly gameId: string
  readonly level: LevelData | null
  readonly participants: Participant[]
  private wordsById: Map<number, Word>
  private stat?: WordStat
  private alreadyCleared: boolean
  private events: AnswerEvent[] = []
  private scores = new Map<string, ParticipantScore>()
  /** 這一場之內某個字已經答對幾次，疊在歷史紀錄上 */
  private sessionCorrect = new Map<string, number>()

  constructor(o: SessionOptions) {
    this.mode = o.mode
    this.gameId = o.gameId
    this.level = o.level
    this.participants = o.participants
    this.wordsById = o.wordsById
    this.stat = o.stat
    this.alreadyCleared = o.alreadyCleared ?? false
    for (const p of o.participants) {
      this.scores.set(p.studentId, {
        studentId: p.studentId, nickname: p.nickname, team: p.team,
        correct: 0, asked: 0, coins: 0, exp: 0, combo: 0, bestCombo: 0,
      })
    }
  }

  get soloScore(): ParticipantScore {
    return this.scores.get(this.participants[0].studentId)!
  }

  /** 目前連對幾題，遊戲要拿去填進 AnswerReport */
  comboOf(studentId: string): number {
    return this.scores.get(studentId)?.combo ?? 0
  }

  /**
   * 遊戲回報一題。金幣與經驗在這裡算出來——遊戲全程不碰。
   */
  report(studentId: string, r: AnswerReport): AnswerEvent {
    const sc = this.scores.get(studentId)
    if (!sc) throw new Error(`不在這一場裡的學生：${studentId}`)

    const event: AnswerEvent = {
      ...r,
      studentId,
      gameId: this.gameId,
      levelId: this.level?.id ?? null,
      at: Date.now(),
    }
    this.events.push(event)

    sc.asked += 1
    if (r.correct) {
      sc.correct += 1
      sc.combo += 1
      sc.bestCombo = Math.max(sc.bestCombo, sc.combo)

      const word = this.wordsById.get(r.wordId)
      if (word) {
        const k = `${studentId}:${r.wordId}:${r.skill}`
        const before = (this.stat?.correctCount(r.wordId, r.skill) ?? 0) + (this.sessionCorrect.get(k) ?? 0)
        sc.coins += coinsFor({ word, report: r, timesAlreadyCorrect: before })
        sc.exp += expFor({ word, report: r })
        this.sessionCorrect.set(k, (this.sessionCorrect.get(k) ?? 0) + 1)
      }
    } else {
      sc.combo = 0
    }
    return event
  }

  /** 排行榜＝把事件加總。個人模式就是只有一列。 */
  leaderboard(): ParticipantScore[] {
    return [...this.scores.values()].sort((a, b) => b.correct - a.correct || a.asked - b.asked)
  }

  /** 團隊模式 v1：各打各的，隊伍分數加總 */
  teamTotals(): { team: string; correct: number; members: number }[] {
    const t = new Map<string, { team: string; correct: number; members: number }>()
    for (const s of this.scores.values()) {
      if (!s.team) continue
      const cur = t.get(s.team) ?? { team: s.team, correct: 0, members: 0 }
      cur.correct += s.correct
      cur.members += 1
      t.set(s.team, cur)
    }
    return [...t.values()].sort((a, b) => b.correct - a.correct)
  }

  finish(outcome: GameOutcome): SessionResult {
    const scores = this.leaderboard()
    const me = scores[0]
    const stars = starsFor({ outcome, correct: me?.correct ?? 0, asked: me?.asked ?? 0 })
    const bonusCoins =
      outcome.win && this.level ? firstClearBonus(this.level.no, this.alreadyCleared) : 0

    return {
      levelId: this.level?.id ?? null,
      mode: this.mode,
      outcome,
      scores,
      events: this.events,
      stars,
      bonusCoins,
    }
  }
}
