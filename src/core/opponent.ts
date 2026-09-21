/**
 * 對手。
 *
 * **整個兵推模式的關鍵就在這個介面：對手是「一串照時間發生的答題」，
 * 不是「另一台同時連著線的裝置」。**
 *
 * 只要是這樣，下面四種東西就是同一套程式，順序怎麼排都不會白做：
 *   好友在線    → 他此刻的答題串（之後從伺服器輪詢來）
 *   好友不在    → 他上一場的紀錄
 *   沒人在線    → 電腦，照速度與正確率生出來
 *   跨班配對    → 還是同一件事，只是換個人
 *
 * 反過來把對手寫成一條要兩台裝置同時在線的連線，那四件事就要寫四遍，
 * 而且玩法一改就全部重來。
 *
 * 型別（Move、Opponent）放在 core/types.ts，因為遊戲那一層只准往 core 看。
 */

import type { Move, Opponent } from './types'

/** 小小的亂數，給同一個種子就跑出同一場——量測與重播都要靠它。 */
export function seeded(seed: number): () => number {
  let a = (seed || 1) >>> 0
  return () => {
    a ^= a << 13; a >>>= 0
    a ^= a >>> 17
    a ^= a << 5; a >>>= 0
    return a / 4294967296
  }
}

export interface BotSpec {
  name: string
  /** 每分鐘答對幾題。這是唯一描述「這個對手多強」的數字。 */
  rate: number
  /** 正確率 0~1 */
  accuracy: number
  seed?: number
}

/**
 * 電腦對手。
 *
 * 刻意只有兩個旋鈕（多快、多準），因為難度要講得出口：
 * 「普通＝每分鐘答對 14 題」比「難度 3」有意義得多，
 * 而且班上每個孩子的真實速度我們本來就量得到。
 */
export function botOpponent(spec: BotSpec): Opponent {
  const rnd = seeded(spec.seed ?? 1)
  const moves: Move[] = []
  let t = 0
  // 先把整場都生出來：對手不會因為你打得好就變強，那是作弊。
  // 也因為先生好，同一個種子每次跑都一樣，量測才有意義。
  const gapCorrect = 60 / Math.max(1, spec.rate)
  while (t < 600) {
    // 答錯也要花時間，所以間隔是「答對的間隔 × 正確率」再抖一點
    const gap = gapCorrect * Math.max(0.15, spec.accuracy) * (0.7 + rnd() * 0.6)
    t += gap
    const correct = rnd() < spec.accuracy
    moves.push({ t, correct, rank: correct ? 0 : null })
  }
  return {
    name: spec.name,
    isBot: true,
    movesUntil: (now) => moves.filter((m) => m.t <= now),
  }
}

/** 打一份紀錄。好友不在線上的時候用這個——畫面上前線照樣會動。 */
export function replayOpponent(name: string, moves: Move[]): Opponent {
  const sorted = [...moves].sort((a, b) => a.t - b.t)
  return { name, isBot: false, movesUntil: (now) => sorted.filter((m) => m.t <= now) }
}

/**
 * 把對手的答題串餵進戰場。
 *
 * 記住餵到第幾筆，所以每一格只會處理新出現的那幾筆——
 * 對手是誰、是真人還是電腦，戰場完全不知道也不需要知道。
 */
export function makeFeeder(o: Opponent, onMove: (correct: boolean) => void) {
  let done = 0
  return (t: number) => {
    const all = o.movesUntil(t)
    // **答錯也要往下送。** 兵階上限開始之後，答錯代表「把累積到一半的結算出去」，
    // 少送這一筆的話，量測裡的對手就永遠不會出半階的兵，跟畫面上玩到的不是同一個遊戲。
    for (let i = done; i < all.length; i++) onMove(all[i].correct)
    done = all.length
  }
}
