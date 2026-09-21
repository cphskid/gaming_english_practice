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

/**
 * 三條兵種線＝三種英文技能。**線決定你怎麼打，階決定你有多強。**
 *
 * ### 強度怎麼定的
 *
 * 照 Chuck 那條「花多少時間就值多少」：一階的 **血 × 傷害** ＝ 300 × 這條線
 * 一題要花的時間（見 LINE_COST）。
 *   認字（長槍）  30/10    ＝ 300      近戰、快、最均衡
 *   聽音（弓手）  24/17.5  ＝ 420      射程 150 加濺射，但很脆
 *   拼字（盾劍）  150/6    ＝ 900      最耐打、傷害最低，唯一輕鬆撐過箭塔的一階兵
 *
 * 這中間繞過一次遠路：第一版的拼字題是「挖一個字母的選擇題」，很快就答完，
 * 卻照四倍強度給，量測是懸殊對局 96% 的場次提早破城。所以一度把三條線改成
 * 等強。現在拼字改成**真的一個字母一個字母拼完整個字**，時間差回來了，
 * 強度也跟著回來——但**強度必須跟著實際花的時間走，不是跟著設計想像走**。
 *
 * 強度尺用 血×傷害：射程 30、間距 34 的時候只有最前面那隻打得到人，
 * 等於排隊單挑，所以兩隻兵誰贏是看 hp×dps 誰大，不是平方律。
 *
 * 階級也是同一條原則：連對 N 題出一隻 N 階，血和傷害各乘 √N，hp×dps 剛好 N 倍。
 */
export type Line = 'recognize' | 'listen' | 'spell'

export const LINE_IDS: Line[] = ['recognize', 'listen', 'spell']

export interface LineSpec {
  /** 四階的名字，一階在前。體型與軍階標記負責辨識，名字只負責有感。 */
  names: [string, string, string]
  /** 一階的血。二階以上乘 √階。 */
  hp: number
  /** 一階每秒打掉多少血。二階以上乘 √階。 */
  dps: number
  /** 走多快，px/s */
  speed: number
  /** 打得到多遠。弓手站著射，另外兩種要貼上去。 */
  reach: number
  /** 濺射半徑，0 代表只打單體。濺到的吃三成，最多三隻。 */
  splash: number
  /** 體型的線別修正，乘在階級的體型上 */
  sizeMul: number
  /** 畫面用 public/td-art 裡的哪張圖 */
  art: 'u_spear' | 'u_bow' | 'u_shield'
  /** 這條線對應的題型，出題器照這個挑字 */
  skill: 'recognize' | 'listen' | 'spell'
}

export const LINES: Record<Line, LineSpec> = {
  // 認字：便宜、快、成群。長槍的橫線剪影在手機上最好認。
  recognize: {
    names: ['字母兵', '字母槍士', '字母將軍'],
    hp: 30, dps: 10, speed: 55, reach: 30, splash: 0,
    sizeMul: 0.95, art: 'u_spear', skill: 'recognize',
  },  // 血×傷害 ＝ 300，這是基準
  // 聚焦：血只有 18，被近戰貼上去就沒了，要靠前面有人擋。
  // 聽音：唯一的遠程。**射程 150 故意小於箭塔的 200**——不然弓手可以站在
  // 塔打不到的地方慢慢拆城堡，防守方優勢就廢了，落後的孩子會被凌遲。
  listen: {
    names: ['音波弓手', '回音射手', '音闇神射'],
    hp: 24, dps: 17.5, speed: 45, reach: 150, splash: 60,   // 420 ＝ 300 × 1.4
    sizeMul: 1.0, art: 'u_bow', skill: 'listen',
  },
  // 拼字：肉盾。傷害是三條線裡最低的，但**一階兵裡只有它撐得過箭塔那 200 格**
  // （走完要吃約 59 點，牠有 60 血），所以「想敲對方城堡」這件事從它開始。
  spell: {
    names: ['拼字盾兵', '拼字鐵衛', '拼字戰神'],
    hp: 150, dps: 6, speed: 34, reach: 30, splash: 0,        // 900 ＝ 300 × 3
    sizeMul: 1.1, art: 'u_shield', skill: 'spell',
  },
}

/**
 * 階級的體型。
 *
 * 本來是 [1, 1.15, 1.3, 1.45]，Chuck 試玩說「升等之後兵沒有改變大小」——他是對的，
 * 量了一下一階到二階在手機上只差 **7 個像素**，等於看不出來。
 * 級距拉到每階 +30%，一階到三階差 60%，加上畫面上「幾階就畫幾個人」，
 * 才真的分得出來。
 */
export const RANK_SIZE = [1.0, 1.3, 1.6]

/**
 * 頂階是三階，不是四階（2026-09-21 Chuck 定的）。
 *
 * 一場只有三分鐘，四階要連對四題才出一隻兵，等於整場都在存錢；
 * 三階連對三題就到頂，剩下的時間才是真的在打。
 */
export const MAX_TIER = 3

/**
 * 一題要花的時間，以認字一題為 1。
 *
 * **三條線的強度就是照這個比例給的**（「花多少時間就值多少」）。
 * 第一版把三條線做成等強，是因為當時拼字題只是挖一個字母的選擇題，很快；
 * 現在拼字是真的把整個字一個字母一個字母拼出來，時間差就回來了。
 *
 * 這三個數字目前是**估的**。系統每一題都有記花幾毫秒（AnswerReport.ms），
 * 等班上真的玩過，就用真實資料重訂，不要再用手感。
 */
export const LINE_COST: Record<Line, number> = { recognize: 1, listen: 1.4, spell: 3 }

/** 從第 N 階升到第 N+1 階要幾顆水晶。索引 0 是升到二階。 */
export const TIER_COST = [30, 80]

export interface UnitStats {
  name: string
  hp: number
  dps: number
  speed: number
  reach: number
  splash: number
  size: number
}

/**
 * 某條線的第 rank 階長什麼樣（rank 從 1 起算）。
 *
 * 血和傷害各乘 √rank，所以 hp×dps 剛好是 rank 倍——「連對四題出一隻四階」
 * 跟「分四次出四隻一階」在戰力上等價，差的是**大隻的撐得過箭塔**。
 * 高階走得慢一點（每階 -6%），一方面有重量感，一方面也讓對手有時間反應。
 */
export function statsOf(line: Line, rank: number): UnitStats {
  const L = LINES[line]
  const n = Math.max(1, Math.min(MAX_TIER, Math.round(rank)))
  const k = Math.sqrt(n)
  return {
    name: L.names[n - 1],
    hp: Math.round(L.hp * k),
    dps: L.dps * k,
    speed: L.speed * (1 - 0.06 * (n - 1)),
    reach: L.reach,
    splash: L.splash,
    size: RANK_SIZE[n - 1] * L.sizeMul,
  }
}

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
  /** 答對一次拿幾顆水晶 */
  answerCrystal: number
  /** 殺掉一隻敵兵拿幾顆水晶 */
  killCrystal: number
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
  towerRange: 200, towerDps: 16, towerEvery: 0.5,
  strike: 8,
  // 水晶的來源比照守塔，小朋友不用學第二套規則。
  // 一場三分鐘、大約答 45 題、殺 20~40 隻，所以一場大概進帳 250~350 顆，
  // 剛好夠把兵階從一路頂到四（30＋70＋130＝230）再剩一點。
  answerCrystal: 3, killCrystal: 5,
  seconds: 180, openingUnits: 2,
}

export interface Unit {
  id: number
  side: Side
  /** 哪一條線（＝用哪種題型召出來的） */
  line: Line
  /** 第幾階，1 起算 */
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
  /**
   * 這一場的水晶。**每場歸零，跟角色的金幣完全分開**——金幣只能從答對來、
   * 由伺服器重算，戰場上的東西一毛都不能碰它。
   */
  crystal: Record<Side, number>
  /** 兵階上限，1~4。三條線共用同一個上限：一顆鈕，沒有第三層選單。 */
  tier: Record<Side, number>
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
    crystal: { me: 0, foe: 0 }, tier: { me: 1, foe: 1 },
  }
  for (let i = 0; i < r.openingUnits; i++) {
    summon(s, 'me', 'recognize', 1, r)
    summon(s, 'foe', 'recognize', 1, r)
  }
  return s
}

/**
 * 升一階。水晶不夠就回 false，畫面據此把鈕畫成暗的。
 *
 * **升階不是「變強」那麼單純**：上限升到 N 之後，召喚一隻兵要連對 N 題，
 * 出兵速度直接砍成 1/N。所以「有錢就買」不見得對——這就是那個決定。
 */
export function upgrade(s: BattleState, side: Side): boolean {
  const tier = s.tier[side]
  if (tier >= MAX_TIER) return false
  const cost = TIER_COST[tier - 1]
  if (s.crystal[side] < cost) return false
  s.crystal[side] -= cost
  s.tier[side] = tier + 1
  return true
}

/** 下一階要多少水晶，已經頂了就回 null */
export function nextCost(s: BattleState, side: Side): number | null {
  const tier = s.tier[side]
  return tier >= MAX_TIER ? null : TIER_COST[tier - 1]
}

/** 派一隻兵。答對累積夠了就叫這個，電腦對手也叫這個。 */
export function summon(
  s: BattleState, side: Side, line: Line, rank: number, r: BattleRules = RULES,
): Unit {
  const spec = statsOf(line, rank)
  const u: Unit = {
    id: nextId++, side, line, rank: Math.max(1, Math.min(MAX_TIER, rank)),
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
    const spec = statsOf(u.line, u.rank)
    const foeSide = OTHER[u.side]

    // 最近的敵兵。**射程是每隻兵自己的**——弓手站在 150 外就開打，
    // 長槍兵和盾劍士要走到 30 以內。遠程的便宜就在這段免費輸出。
    let target: Unit | null = null
    for (const o of s.units) {
      if (o.side === u.side || o.hp <= 0) continue
      const gap = (o.x - u.x) * dir(u.side)
      if (gap >= -spec.reach && gap <= spec.reach && (!target || gap < (target.x - u.x) * dir(u.side))) target = o
    }

    if (target) {
      u.fighting = true
      target.hp -= spec.dps * dt
      target.hurt = 0.12
      hits.push({ x: target.x, side: target.side, killed: target.hp <= 0 })
      // 濺射：只有弓手線有。濺到的吃三成、最多三隻，跟守塔的法師同一套數字，
      // 所以「一發打一片」這件事小朋友在兩個遊戲裡學一次就好。
      // 三成是刻意壓低的——拼字線那隻大的不能被一發濺射掃掉，
      // 不然花八秒拼出來的兵三秒就沒了，沒有人會想拼。
      if (spec.splash > 0) {
        let splashed = 0
        for (const o of s.units) {
          if (splashed >= 3) break
          if (o === target || o.side === u.side || o.hp <= 0) continue
          if (Math.abs(o.x - target.x) > spec.splash) continue
          o.hp -= spec.dps * dt * 0.3
          o.hurt = 0.12
          splashed++
          hits.push({ x: o.x, side: o.side, killed: o.hp <= 0 })
        }
      }
      continue
    }

    // 打得到對方城堡就打城堡
    const home = homeOf(foeSide, r)
    if ((home - u.x) * dir(u.side) <= spec.reach) {
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

  // 殺掉一隻給對手方水晶。**水晶只在這場有效**，跟金幣無關。
  for (const u of s.units) if (u.hp <= 0) s.crystal[OTHER[u.side]] += r.killCrystal
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
  if (target.hp <= 0) {
    s.crystal[OTHER[target.side]] += r.killCrystal
    s.units = s.units.filter((u) => u.hp > 0)
  }
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
