/**
 * 兵推的戰場模型。
 *
 * **這一支不碰畫布、不碰 React、不碰網路**，只有數字。理由跟 plates.ts 一樣：
 * 「一面倒不一面倒」「落後的人幾秒被打爆」是量得出來的，不該靠手感決定。
 * tools/test/tug-balance.mjs 直接拿它跑兩個假想的孩子對打。
 *
 * 規則一句話：答對就派一隻兵往對面走，兩邊的兵在中間打架，
 * 誰的兵先撐不住，線就往誰那邊退。推到對方城堡就打城堡。
 *
 * 兩條刻意的設計（理由見 versus-mode-direction 那則記憶）：
 * 1. **答對一次就是一隻兵，不管你多快按**——不然班上手指最快的永遠贏，
 *    比的就不是英文了。
 * 2. **自己的塔只罩得到自己這半邊**，越往對面推，對方的塔火力越集中在你身上。
 *    這是防守方優勢，用來擋住「強的一路輾過去、弱的九十秒被打爆」。
 */

export type Side = 'me' | 'foe'

export const OTHER: Record<Side, Side> = { me: 'foe', foe: 'me' }

/** 兵的階級。v1 只用得到第 0 階，但形狀先留著——拼字要召喚更強的兵。 */
export interface RankSpec {
  name: string
  hp: number
  /** 每秒打掉多少血 */
  dps: number
  /** 走多快，px/s */
  speed: number
  /** 畫多大，1 是基本兵 */
  size: number
}

export const RANKS: RankSpec[] = [
  { name: '字母兵', hp: 30, dps: 10, speed: 55, size: 1.0 },
  { name: '拼字獸', hp: 60, dps: 14, speed: 48, size: 1.2 },
  { name: '兵長', hp: 95, dps: 20, speed: 45, size: 1.2 },
  { name: '隊長', hp: 150, dps: 28, speed: 42, size: 1.4 },
  { name: '將軍', hp: 240, dps: 40, speed: 38, size: 1.6 },
]

export interface BattleRules {
  /** 兩邊城堡的位置 */
  homeMe: number
  homeFoe: number
  castleHp: number
  /** 兵跟兵、兵跟城堡要靠多近才打得到 */
  reach: number
  /** 後面的兵跟前面的兵至少隔多遠，不然會疊在一起看不出有幾隻 */
  spacing: number
  /** 塔罩得到多遠 */
  towerRange: number
  /** 塔每秒打掉多少血 */
  towerDps: number
  /** 多久射一箭。總傷害不變（每箭 towerDps × towerEvery），只是改成看得見的一下一下。 */
  towerEvery: number
  /** 答對一次，自己的塔對那隻敵兵開一槍打掉多少血 */
  strike: number
  /** 一場幾秒 */
  seconds: number
  /** 開場兩邊各送幾隻，讓場上一開始就有東西可以點 */
  openingUnits: number
}

export const RULES: BattleRules = {
  homeMe: 116, homeFoe: 972, castleHp: 100,
  reach: 30, spacing: 34,
  // 箭塔是**防守方優勢**那一條旋鈕，不是隨便填的。改任何一個都要重跑
  // tools/test/tug-balance.mjs。
  //
  // towerDps 10：低於 7 的時候，落後的孩子大半場次會在時間到之前就被打爆城堡
  // （也就是他不玩了）；10 讓那個數字降到 0%，而快的人照樣贏九成以上。
  //
  // towerRange 200：第一版是 250，但那是在「答對可以直接打城堡」的錯規則下訂的。
  // 規則改對之後量出來，250 讓兵根本走不到對方城堡——強弱懸殊也只有 13% 的場次
  // 碰得到城堡，同程度是 0%，兩個城堡的血從頭到尾不會動，HUD 上那兩個數字等於裝飾。
  // 200 的時候強弱懸殊有一半的場次打得到城堡（血會掉、勝負真的由城堡決定），
  // 但還是 0% 破城，落後的人被壓在家門口的時間只有 23 秒。
  // 再往下 160 會開始出現破城（8%，都在第 150 秒之後），壓制時間跳到 41 秒——不划算。
  towerRange: 200, towerDps: 10, towerEvery: 0.5,
  strike: 8,
  seconds: 180, openingUnits: 2,
}

export interface Unit {
  id: number
  side: Side
  rank: number
  x: number
  hp: number
  maxHp: number
  /** 這一格有沒有在打架（畫面要畫出刀光，也拿來判斷有沒有在前進） */
  fighting: boolean
  /** 剛被打到的閃紅，秒數 */
  hurt: number
}

export interface BattleState {
  t: number
  /** 兩座箭塔各自距離下一箭還有多久 */
  towerCd: Record<Side, number>
  units: Unit[]
  castleHp: Record<Side, number>
  /** 前線在哪。兩邊最前面那隻的中點，沒有兵就用城堡算。 */
  front: number
  over: boolean
  winner: Side | null
  /** 為什麼結束：城堡破了，還是時間到 */
  reason: 'castle' | 'time' | null
}

export interface Hit {
  x: number
  side: Side
  killed: boolean
  /** 這一下是城堡旁邊的箭塔射的。畫面靠它畫箭，玩家才看得到守備火力存在。 */
  tower?: boolean
  /** 箭是從哪裡射出來的（只有 tower 的時候有） */
  from?: number
}

let nextId = 1

export function newBattle(r: BattleRules = RULES): BattleState {
  const s: BattleState = {
    t: 0, towerCd: { me: r.towerEvery, foe: r.towerEvery },
    units: [], castleHp: { me: r.castleHp, foe: r.castleHp },
    front: (r.homeMe + r.homeFoe) / 2, over: false, winner: null, reason: null,
  }
  for (let i = 0; i < r.openingUnits; i++) {
    summon(s, 'me', 0, r)
    summon(s, 'foe', 0, r)
  }
  return s
}

/** 派一隻兵。答對就叫這個，電腦對手也叫這個。 */
export function summon(s: BattleState, side: Side, rank: number, r: BattleRules = RULES): Unit {
  const spec = RANKS[Math.min(rank, RANKS.length - 1)]
  const u: Unit = {
    id: nextId++, side, rank,
    x: side === 'me' ? r.homeMe : r.homeFoe,
    hp: spec.hp, maxHp: spec.hp, fighting: false, hurt: 0,
  }
  s.units.push(u)
  return u
}

const dir = (side: Side) => (side === 'me' ? 1 : -1)
const homeOf = (side: Side, r: BattleRules) => (side === 'me' ? r.homeMe : r.homeFoe)

/** 我這一邊最前面那隻在哪（沒有兵就回城堡的位置） */
export function frontOf(s: BattleState, side: Side, r: BattleRules = RULES): number {
  let best: number | null = null
  for (const u of s.units) {
    if (u.side !== side) continue
    if (best === null || u.x * dir(side) > best * dir(side)) best = u.x
  }
  return best ?? homeOf(side, r)
}

/**
 * 走一格。回傳這一格發生的傷害，畫面拿去畫刀光與飄字。
 */
export function step(s: BattleState, dt: number, r: BattleRules = RULES): Hit[] {
  if (s.over) return []
  s.t += dt
  const hits: Hit[] = []

  // --- 誰擋在我前面。同一邊的兵排成一列，不會疊在一起。
  const ahead = new Map<number, Unit | null>()
  for (const u of s.units) {
    let block: Unit | null = null
    for (const o of s.units) {
      if (o === u || o.side !== u.side) continue
      const gap = (o.x - u.x) * dir(u.side)
      if (gap > 0 && gap < r.spacing && (!block || o.x * dir(u.side) < block.x * dir(u.side))) block = o
    }
    ahead.set(u.id, block)
  }

  // --- 打架：打得到的就停下來打，打不到就往前走
  for (const u of s.units) {
    if (u.hurt > 0) u.hurt -= dt
    const spec = RANKS[Math.min(u.rank, RANKS.length - 1)]
    const foeSide = OTHER[u.side]

    // 最近的敵兵
    let target: Unit | null = null
    for (const o of s.units) {
      if (o.side === u.side || o.hp <= 0) continue
      const gap = (o.x - u.x) * dir(u.side)
      if (gap >= -r.reach && gap <= r.reach && (!target || gap < (target.x - u.x) * dir(u.side))) target = o
    }

    if (target) {
      u.fighting = true
      target.hp -= spec.dps * dt
      target.hurt = 0.12
      hits.push({ x: target.x, side: target.side, killed: target.hp <= 0 })
      continue
    }

    // 打得到對方城堡就打城堡
    const home = homeOf(foeSide, r)
    if ((home - u.x) * dir(u.side) <= r.reach) {
      u.fighting = true
      s.castleHp[foeSide] -= spec.dps * dt
      hits.push({ x: home, side: foeSide, killed: false })
      continue
    }

    // 前面有自己人就跟著停，沒有就往前走
    u.fighting = false
    const block = ahead.get(u.id)
    if (block && block.fighting) continue
    u.x += spec.speed * dir(u.side) * dt
  }

  // --- 箭塔。只罩得到自己這半邊，所以越深入敵陣越難推。
  // 一波一波射而不是連續扣血：總傷害一樣，但畫面上有一支箭可以畫。
  // 「有效果、看不到」是 Chuck 第一次試玩就抓到的毛病。
  for (const side of ['me', 'foe'] as Side[]) {
    s.towerCd[side] -= dt
    if (s.towerCd[side] > 0) continue
    s.towerCd[side] += r.towerEvery
    const home = homeOf(side, r)
    let target: Unit | null = null
    for (const o of s.units) {
      if (o.side === side || o.hp <= 0) continue
      const d = Math.abs(o.x - home)
      if (d <= r.towerRange && (!target || Math.abs(target.x - home) > d)) target = o
    }
    if (target) {
      target.hp -= r.towerDps * r.towerEvery
      target.hurt = 0.12
      hits.push({ x: target.x, side: target.side, killed: target.hp <= 0, tower: true, from: home })
    }
  }

  s.units = s.units.filter((u) => u.hp > 0)
  s.front = (frontOf(s, 'me', r) + frontOf(s, 'foe', r)) / 2

  if (s.castleHp.me <= 0 || s.castleHp.foe <= 0) {
    s.over = true
    s.reason = 'castle'
    s.winner = s.castleHp.foe <= 0 ? 'me' : 'foe'
    if (s.castleHp.me <= 0 && s.castleHp.foe <= 0) s.winner = null
  } else if (s.t >= r.seconds) {
    s.over = true
    s.reason = 'time'
    s.winner = judge(s, r)
  }
  return hits
}

/**
 * 時間到了誰贏。
 *
 * **先比城堡再比前線**：把對方城堡啃掉一半的人，贏過只是把線推過去一點的人。
 * 兩個都一樣才算平手——平手是可以接受的結果，落後的人比的是
 * 「我把線推到哪」而不是「我有沒有贏」。
 */
export function judge(s: BattleState, r: BattleRules = RULES): Side | null {
  if (s.castleHp.me !== s.castleHp.foe) return s.castleHp.me > s.castleHp.foe ? 'me' : 'foe'
  const mid = (r.homeMe + r.homeFoe) / 2
  if (Math.abs(s.front - mid) < 8) return null
  return s.front > mid ? 'me' : 'foe'
}

/**
 * 答對的那一槍，打在你點的那個東西上。
 *
 * 答對只召喚一隻兵的話，點哪一隻敵兵就沒差別了，畫面上也看不出「我剛剛打到你」。
 * 所以答對同時開一槍。
 *
 * **這一槍絕對不會打到城堡。** 第一版寫成「沒有兵可打就打城堡」，而畫面上
 * 敵方城堡前永遠掛著兩塊字牌，所以抽到那兩塊就是直接扣城堡血——13 題就能
 * 繞過整個兵推把城堡推倒。Chuck 第一次試玩就說「感覺是直接扣城堡的血」，
 * 他是對的。**城堡的血只能被兵啃掉**（見 step 裡打城堡那一段），
 * 這樣兵推才是兵推。
 *
 * **這一槍有算進平衡量測裡**（tools/test/tug-balance.mjs），改傷害要重跑。
 */
export function strike(s: BattleState, _side: Side, target: Unit | null, r: BattleRules = RULES): void {
  if (s.over) return
  if (!target || target.hp <= 0) return
  target.hp -= r.strike
  target.hurt = 0.18
  if (target.hp <= 0) s.units = s.units.filter((u) => u.hp > 0)
}

/** 對方最前面那隻（離我最近的那隻）。答對那一槍預設打它。 */
export function frontUnitOf(s: BattleState, side: Side): Unit | null {
  let best: Unit | null = null
  for (const u of s.units) {
    if (u.side !== side || u.hp <= 0) continue
    if (!best || u.x * dir(OTHER[side]) > best.x * dir(OTHER[side])) best = u
  }
  return best
}

/** 前線推進了幾成：0 是被壓在自己城堡上，1 是打到對方城堡，0.5 是正中間。 */
export function pushed(s: BattleState, r: BattleRules = RULES): number {
  return Math.max(0, Math.min(1, (s.front - r.homeMe) / (r.homeFoe - r.homeMe)))
}
