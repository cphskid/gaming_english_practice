/**
 * 真人即時對戰：兩支手機怎麼算出**同一場**戰鬥。
 *
 * 做法叫 lockstep：兩支手機各跑一份一模一樣的戰場（這一支裡的 truth），
 * 只交換「誰在第幾格做了什麼」。每個動作都**晚 DELAY 格才生效**，
 * 所以對方的動作傳過來的那一秒多，戰場還沒算到那一格，兩邊套用的時間點一樣，
 * 算出來的結果就一樣——輸贏兩支手機一定講得一樣，不用另外找伺服器來判。
 *
 * 要守的規矩：
 *   1. 固定每格 1/30 秒，不跟著畫面的更新率走（手機快慢不一，dt 不同就會算歪）。
 *   2. 對方還沒說「第 n-DELAY 格以前的動作都送了」，就不准算第 n 格——等。
 *      平常網路一秒多一定到，等的時候畫面照畫，只是戰場停一下。
 *   3. 戰場裡不准有亂數。答對那一槍打哪一隻，由動作自己帶（target）。
 *   4. 同一格兩邊都有動作的時候，第一位先、第二位後，兩支手機都照這個順序。
 *   5. **第一位永遠是戰場的左邊（me）**。第二位的手機畫的時候左右翻過來（見 mirror），
 *      不是另外算一份翻過來的戰場——浮點數左右各算一次不保證一模一樣。
 *
 * 也順便擋一點作弊：出兵要有答對撐著（credit），升階要真的有水晶，
 * 兵階不能比上限高。改過的前端硬送也沒用，而且兩邊用同一套規則擋，還是一樣的結果。
 *
 * 這一支跟 battle.ts 一樣只有數字，不碰畫布、網路。tools/test/lockstep-sync.mjs 直接拿它測。
 */

import type { LiveMove } from '@/core/types'
import {
  MAX_TIER, OTHER, RULES, newBattle, step, strike, summon, upgrade,
  type BattleRules, type BattleState, type Hit, type Line, type Side, type Unit,
} from './battle'

/** 一格幾秒 */
export const TICK = 1 / 30
/**
 * 動作晚幾格生效。45 格＝1.5 秒：每半秒問一次伺服器，一來一回再加上對方也是半秒問一次，
 * 大部分時候一秒多就到了。再短的話網路一抖戰場就要停下來等。
 */
export const DELAY = 45

export const SEAT_SIDE: Record<1 | 2, Side> = { 1: 'me', 2: 'foe' }

export class Lockstep {
  truth: BattleState
  /** 已經算完幾格 */
  tick = 0
  /** 兩位各自送來的動作（照順序），和套用到第幾筆了 */
  private q: Record<Side, LiveMove[]> = { me: [], foe: [] }
  private done: Record<Side, number> = { me: 0, foe: 0 }
  /**
   * 答對了還沒換成兵的題數。出一隻 N 階的兵要花掉 N。
   * 正常的前端本來就是這樣算（連對 N 題出 N 階），這裡只是再擋一次。
   */
  private credit: Record<Side, number> = { me: 0, foe: 0 }

  constructor(private r: BattleRules = RULES) {
    this.truth = newBattle(r)
  }

  /** 收到某一位的新動作（累計串的全部，重複給沒關係，只取還沒收過的） */
  feed(side: Side, all: readonly LiveMove[]) {
    const q = this.q[side]
    for (let i = q.length; i < all.length; i++) q.push(all[i])
  }

  /**
   * 能不能算下一格。對方說過「第 mark 格以前的都送了」，
   * 第 n 格要套用的是第 n-DELAY 格做的動作，所以 n-DELAY <= mark 才行。
   */
  canStep(theirMark: number): boolean {
    return this.tick + 1 - DELAY <= theirMark
  }

  /** 算一格。回傳這一格的傷害（畫面畫箭用）。 */
  step(): Hit[] {
    const n = this.tick + 1
    for (const side of ['me', 'foe'] as Side[]) {
      const q = this.q[side]
      while (this.done[side] < q.length && q[this.done[side]].k + DELAY <= n) {
        this.apply(side, q[this.done[side]])
        this.done[side]++
      }
    }
    this.tick = n
    return step(this.truth, TICK, this.r)
  }

  /** 還沒套用的動作。對方斷線、改打分身的那一刻，已經送出的要先補完。 */
  flush() {
    for (const side of ['me', 'foe'] as Side[]) {
      const q = this.q[side]
      while (this.done[side] < q.length) this.apply(side, q[this.done[side]++])
    }
  }

  private apply(side: Side, m: LiveMove) {
    const s = this.truth
    if (s.over) return
    if (m.act === 'answer') {
      if (!m.correct) return
      s.crystal[side] += this.r.answerCrystal
      this.credit[side]++
      const target: Unit | null =
        s.units.find((u) => u.id === m.target && u.side === OTHER[side] && u.hp > 0) ?? null
      strike(s, side, target, this.r)
    } else if (m.act === 'summon' && m.line) {
      const rank = Math.min(MAX_TIER, s.tier[side], this.credit[side], Math.max(1, m.rank ?? 1))
      if (rank < 1) return
      this.credit[side] -= rank
      summon(s, side, m.line as Line, rank, this.r)
    } else if (m.act === 'up') {
      upgrade(s, side)
    }
  }
}

/**
 * 左右翻過來的戰場，給第二位的手機畫。
 *
 * 兵的物件照編號留著重用（into 那一份），不要每一格都生新的——
 * 引擎的字牌拿著兵的參考，換掉的話字牌會一直重新配位置。
 */
export function mirror(src: BattleState, into: BattleState | null, r: BattleRules = RULES): BattleState {
  const span = r.homeMe + r.homeFoe
  const flip = (x: number) => span - x
  const out = into ?? newBattle(r)
  const old = new Map(out.units.map((u) => [u.id, u]))
  out.units = src.units.map((u) => {
    const v = old.get(u.id) ?? { ...u }
    v.id = u.id
    v.side = OTHER[u.side]
    v.line = u.line
    v.rank = u.rank
    v.x = flip(u.x)
    v.hp = u.hp
    v.maxHp = u.maxHp
    v.fighting = u.fighting
    v.hurt = u.hurt
    return v
  })
  out.t = src.t
  out.towerCd = { me: src.towerCd.foe, foe: src.towerCd.me }
  out.castleHp = { me: src.castleHp.foe, foe: src.castleHp.me }
  out.front = flip(src.front)
  out.over = src.over
  out.winner = src.winner === null ? null : OTHER[src.winner]
  out.reason = src.reason
  out.crystal = { me: src.crystal.foe, foe: src.crystal.me }
  out.tier = { me: src.tier.foe, foe: src.tier.me }
  out.chill = { me: src.chill.foe, foe: src.chill.me }
  out.seq = src.seq
  return out
}

/** 傷害也要翻過來，箭才畫得對邊 */
export function mirrorHit(h: Hit, r: BattleRules = RULES): Hit {
  const span = r.homeMe + r.homeFoe
  return { ...h, x: span - h.x, side: OTHER[h.side], from: h.from === undefined ? undefined : span - h.from }
}
