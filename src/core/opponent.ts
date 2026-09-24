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

import type { Move, Opponent, Skill } from './types'

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
 * 同學的分身：重播他最近一場。
 *
 * 跟 replayOpponent 的差別是這一串**帶著他當時的決定**（換線、升階、什麼時候出兵，
 * 見 Move.act），引擎照做，不替他決定。所以分身打起來像他，不像電腦。
 */
export function ghostOpponent(name: string, moves: Move[], legion = ''): Opponent {
  const sorted = moves.map((m, i) => ({ m, i })).sort((a, b) => a.m.t - b.m.t || a.i - b.i).map((x) => x.m)
  return {
    name, isBot: false, isGhost: true, legion,
    movesUntil: (now) => sorted.filter((m) => m.t <= now),
  }
}

/**
 * 存進資料庫的樣子。一場三分鐘大概兩三百筆，每筆寫成一小串陣列
 * （[秒, 'a', 1] / [秒, 's', 線, 階] / [秒, 'u']），比整個物件小三四倍。
 * 伺服器也看這個形狀：它會數 'a' 答對幾筆，跟那一場的答題事件對帳。
 */
export type PackedMove = [number, 'a', 0 | 1] | [number, 's', Skill, number] | [number, 'u']

export function packMoves(moves: Move[]): PackedMove[] {
  const out: PackedMove[] = []
  for (const m of moves) {
    const t = Math.round(m.t * 10) / 10
    if (m.act === 'answer') out.push([t, 'a', m.correct ? 1 : 0])
    else if (m.act === 'summon' && m.line && m.rank) out.push([t, 's', m.line, m.rank])
    else if (m.act === 'up') out.push([t, 'u'])
  }
  return out
}

const SKILLS: Skill[] = ['recognize', 'listen', 'spell']

/** 從資料庫讀回來。看不懂的那筆直接丟掉，不讓一筆壞資料把整場打不開。 */
export function unpackMoves(raw: unknown): Move[] {
  if (!Array.isArray(raw)) return []
  const out: Move[] = []
  for (const r of raw) {
    if (!Array.isArray(r) || typeof r[0] !== 'number' || !(r[0] >= 0)) continue
    const t = r[0]
    if (r[1] === 'a') out.push({ t, act: 'answer', correct: r[2] === 1, rank: null })
    else if (r[1] === 's' && SKILLS.includes(r[2]) && typeof r[3] === 'number') {
      out.push({ t, act: 'summon', correct: true, line: r[2], rank: Math.max(1, Math.min(3, Math.round(r[3]))) })
    } else if (r[1] === 'u') out.push({ t, act: 'up', correct: true, rank: null })
  }
  return out
}

/**
 * 把對手的答題串餵進戰場。
 *
 * 記住餵到第幾筆，所以每一格只會處理新出現的那幾筆——
 * 對手是誰、是真人還是電腦，戰場完全不知道也不需要知道。
 */
export function makeFeeder(o: Opponent, onMove: (correct: boolean, m: Move) => void) {
  let done = 0
  return (t: number) => {
    const all = o.movesUntil(t)
    // **答錯也要往下送。** 兵階上限開始之後，答錯代表「把累積到一半的結算出去」，
    // 少送這一筆的話，量測裡的對手就永遠不會出半階的兵，跟畫面上玩到的不是同一個遊戲。
    for (let i = done; i < all.length; i++) onMove(all[i].correct, all[i])
    done = all.length
  }
}
