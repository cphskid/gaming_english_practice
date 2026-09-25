/**
 * 魔王團戰：二到六支手機怎麼算出**同一場**戰鬥。
 *
 * 跟兵推的真人對戰同一套 lockstep（見 games/tug-of-war/lockstep.ts 開頭的五條規矩），
 * 差在人數不固定、而且有人會斷線：
 *
 *   - 每個座位一串動作、一個「第幾格以前都送了」（mark）。要算第 n 格，
 *     **每一位還在的人**都得說過 n-DELAY 以前的都送了。
 *   - 同一格好幾個人都有動作，照座位順序套用（0 號先），每支手機都一樣。
 *   - 斷線：**由伺服器判**（某一位 RAID_GONE_S 秒沒消息，或按了離開），
 *     判下去的那一刻把他的 mark 凍住（final）。大家收到的是同一個 final，
 *     就在第 final+DELAY+1 格由電腦接手他的座位（raid.ts 的 botTakeOver，用戰場裡的亂數），
 *     每支手機接手的時間點一樣、電腦答的也一樣。
 *   - 斷線的那一位如果又連回來，他那份戰場已經跟大家不一樣了（他自己的動作多算了），
 *     所以他看到自己被判出局就結束這一場（電腦會幫他打完）。
 *
 * 這一支只有數字，不碰畫布、網路。tools/test/raid-sync.mjs 直接拿它測。
 */

import type { LiveMove } from '@/core/types'
import {
  RAID, answer, botTakeOver, newRaid, step, summon, upgrade,
  type Line, type RHit, type RaidRules, type RaidState,
} from './raid'

export { DELAY, TICK } from '../tug-of-war/lockstep'
import { DELAY, TICK } from '../tug-of-war/lockstep'

/** 伺服器多久沒聽到某一位就判他斷線（schema.sql 的 raid_sync 用同一個數字） */
export const RAID_GONE_S = 12

/**
 * 打完了（這一份戰場 over）送的 mark：「我不會再有動作了」。
 * 大家打完的時間點不一樣（網路慢的那支晚一點算到），先打完的人不能就此不理伺服器，
 * 不然 12 秒後被判斷線、電腦接手，還沒算完的那幾支就會算出不一樣的結局。
 */
export const DONE_MARK = 1_000_000_000

export interface SeatFeed {
  /** 這一位到現在送來的全部動作（累計） */
  moves: readonly LiveMove[]
  /** 他說過「第幾格以前都送了」，還沒消息是 -1 */
  mark: number
  /** 被判出局的話，凍住的 mark；還在就是 null */
  final: number | null
}

export class RaidLockstep {
  truth: RaidState
  tick = 0
  private q: LiveMove[][]
  private done: number[]
  private marks: number[]
  private finals: (number | null)[]

  constructor(rates: number[], seed: number, private r: RaidRules = RAID) {
    this.truth = newRaid(rates, seed, r)
    const n = this.truth.n
    this.q = Array.from({ length: n }, () => [])
    this.done = Array(n).fill(0)
    this.marks = Array(n).fill(-1)
    this.finals = Array(n).fill(null)
  }

  get n() { return this.truth.n }

  /** 收到某一位的最新消息（累計串，重複給沒關係） */
  feed(seat: number, f: SeatFeed) {
    const q = this.q[seat]
    if (!q) return
    for (let i = q.length; i < f.moves.length; i++) q.push(f.moves[i])
    this.marks[seat] = Math.max(this.marks[seat], f.mark)
    // final 一旦定了就不再變（伺服器也是這樣保證）
    if (f.final !== null && this.finals[seat] === null) this.finals[seat] = f.final
  }

  /** 我自己的動作也走同一條路：送出去的同時餵給自己 */
  mine(seat: number, all: readonly LiveMove[], mark: number) {
    this.feed(seat, { moves: all, mark, final: null })
  }

  /** 哪幾位已經被判斷線 */
  gone(seat: number): boolean { return this.finals[seat] !== null }

  /** 能不能算下一格：每一位還在的人都得送到 n-DELAY 格 */
  canStep(): boolean {
    const need = this.tick + 1 - DELAY
    for (let i = 0; i < this.n; i++) {
      const fin = this.finals[i]
      if (fin !== null) {
        // 出局的人：他 final 以前的動作要全部收到才行（伺服器會一起給，這裡只是保險）
        if (this.marks[i] < Math.min(fin, need)) return false
        continue
      }
      if (this.marks[i] < need) return false
    }
    return true
  }

  /** 卡在誰身上（畫面上顯示「等 xxx 連線…」） */
  waitingFor(): number[] {
    const need = this.tick + 1 - DELAY
    const out: number[] = []
    for (let i = 0; i < this.n; i++) {
      if (this.finals[i] === null && this.marks[i] < need) out.push(i)
    }
    return out
  }

  /** 算一格。回傳這一格的傷害與答對那一槍（畫面畫光線用）。 */
  step(): RHit[] {
    const n = this.tick + 1
    const hits: RHit[] = []
    for (let i = 0; i < this.n; i++) {
      const fin = this.finals[i]
      const q = this.q[i]
      while (this.done[i] < q.length && q[this.done[i]].k + DELAY <= n) {
        const m = q[this.done[i]++]
        // 出局那一位 final 之後的動作不算（伺服器也不會收，這裡再擋一次）
        if (fin !== null && m.k > fin) continue
        const h = this.apply(i, m)
        if (h) hits.push(h)
      }
      if (fin !== null && n === fin + DELAY + 1) botTakeOver(this.truth, i)
    }
    // 不會錯過接手那一格：出局那一位的 mark 最多到 final，
    // 其他人本來就算不過 final+DELAY 格
    this.tick = n
    for (const h of step(this.truth, TICK, this.r)) hits.push(h)
    return hits
  }

  private apply(seat: number, m: LiveMove): RHit | null {
    const s = this.truth
    if (s.over || s.seats[seat].botFrom !== null) return null
    if (m.act === 'answer') return answer(s, seat, !!m.correct, m.target ?? -1, this.r)
    if (m.act === 'summon' && m.line) summon(s, seat, m.line as Line, m.rank ?? 1, this.r)
    else if (m.act === 'up') upgrade(s, seat)
    return null
  }
}
