/**
 * 魔王團戰的戰場模型（2026-09-25）。
 *
 * **跟 battle.ts 一樣只有數字**，不碰畫布、網路、React。tools/test/raid-balance.mjs
 * 直接拿它跑「四個同程度的小朋友打一隻魔王」量勝率。
 *
 * 規則一句話：左邊一隻魔王，右邊 2～6 個人各守一座城。答對就派兵往左推，
 * 兵打到魔王就扣魔王的血；魔王每隔一段時間派小兵往右，小兵打每個人自己的城。
 * 三分鐘內把魔王打倒就贏，時間到或全員城堡同時倒下就輸。
 *
 * 派兵方式、三條兵種線、兵階、水晶全部沿用兵推（battle.ts），
 * 小朋友不用學第二套規則。不一樣的只有三件事：
 *   1. 對面是魔王不是人：魔王本人有一圈範圍攻擊（等於兵推的箭塔），
 *      會定時派小兵，小兵打的是「每個人自己的城」，一人分到一隻。
 *   2. **城倒了＝被壓制，不是出局**（Chuck 選 A）：繼續答題，答對改成修城，
 *      修到 REPAIR_UP 再回來出兵。不讓最弱的小孩坐著看。
 *   3. 答對那一槍可以直接打魔王（場上沒有小兵的時候就是打它），
 *      每一題都有人看得到自己的貢獻。
 *
 * **戰場裡沒有 Math.random**：六支手機各跑一份同樣的戰場（見 lockstep.ts），
 * 要亂數只能用 state 裡的 rng（斷線接手的電腦用）。
 */

import {
  LINES, MAX_TIER, TIER_COST, statsOf, type Line,
} from '../tug-of-war/battle'

export { LINES, MAX_TIER, TIER_COST, statsOf }
export type { Line }

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 6

export interface RaidRules {
  /** 魔王站在哪（身體的中心） */
  bossX: number
  /** 大家的城堡那一排在哪。兵從這裡出發、小兵走到這裡就開始打城。 */
  homeX: number
  /**
   * 魔王的血：**照每個人的速度加起來**（hpTable 內插，每分鐘答對幾題 → 這個人分到多少血）。
   * 沒有表（量測用）就是每人 bossHpPer。
   *
   * 為什麼照速度給：打到魔王的傷害對速度不是直線（快的人兵階升得上去，兵比較耐打），
   * 一隻固定血量的魔王會變成「班上快的那群每場都贏、慢的那群一場都贏不了」。
   * 照速度給，同程度的四個人不管快慢都大約六成勝率——這是 2026-09-24 定的目標。
   * 速度是前端從自己的作答時間算的（跟兵推配對用的是同一個數字）。
   */
  bossHpPer: number
  hpTable: [number, number][] | null
  /** 幾個人打的時候血量再乘多少（索引＝人數） */
  hpByN: number[]
  /** 魔王身邊那一圈多遠打得到兵 */
  bossReach: number
  /** 魔王重擊：身邊那一圈的兵每隻打掉多少血、多久一次 */
  bossHit: number
  bossEvery: number
  /** 小兵：多久來一波，一波一人一隻 */
  minionEvery: number
  minionHp: number
  minionDps: number
  minionSpeed: number
  /** 小兵每一波變強多少（第 k 波血和傷害乘 1+k×這個） */
  minionGrow: number
  /** 每個人的城堡幾血 */
  castleHp: number
  /** 城堡旁邊的箭塔：罩多遠、每一箭多少、多久一箭。每座城一座，只射衝著自己家來的小兵。 */
  towerRange: number
  towerHit: number
  towerEvery: number
  /** 答對那一槍打小兵多少、打魔王多少 */
  strike: number
  strikeBoss: number
  /** 答對拿幾顆水晶、殺一隻小兵拿幾顆（殺的那個人拿） */
  answerCrystal: number
  killCrystal: number
  /** 城倒了之後答對一題修多少 */
  repair: number
  /** 修到多少回來出兵 */
  repairUp: number
  seconds: number
  reach: number
  spacing: number
  /**
   * 神話魔王的特殊招式「半血變身」（2026-09-25）：血掉到 at 以下的那一刻，
   * 馬上多派一波小兵、重擊一次，之後小兵來得更密、重擊更快更痛。null＝不會變身。
   */
  enrage: Enrage | null
}

export interface Enrage {
  at: number
  minionEvery: number
  bossEvery: number
  bossHit: number
}

export const RAID: RaidRules = {
  bossX: 150, homeX: 960,
  // 以下數字是 tools/test/raid-balance.mjs 量出來的，改了要重跑。
  bossHpPer: 500,
  hpTable: [[6, 1134], [8, 1555], [10, 1888], [14, 2625], [20, 3887], [26, 5098], [32, 6343]],
  // 人少的時候同一個人要多扛一點（兩三個人容易一起被壓制，量出來要多給一點血才平）
  hpByN: [1, 1, 1.07, 1.03, 1, 1.03, 1.02],
  bossReach: 190, bossHit: 20, bossEvery: 7,
  minionEvery: 14, minionHp: 40, minionDps: 7, minionSpeed: 42, minionGrow: 0.08,
  castleHp: 100,
  towerRange: 200, towerHit: 5, towerEvery: 0.5,
  strike: 8, strikeBoss: 4,
  answerCrystal: 3, killCrystal: 5,
  repair: 20, repairUp: 60,
  seconds: 180, reach: 30, spacing: 34,
  enrage: null,
}

/**
 * 神話魔王：規則全部一樣，多一個半血變身——變身那一刻多來一波小兵，
 * 之後重擊從七秒一次變成六秒一次。
 *
 * 數字是 raid-balance.mjs --myth 量的，**非常敏感**：只加那一波小兵、別的都不改，
 * 四人勝率就從六成掉到三成；重擊再快一秒就掉到零。所以血量打九四折補回來，
 * 四個同程度的人約四成五（普通魔王六成）。比普通難、但打得贏——神話是給三章都破了的人打的。
 */
export const RAID_MYTH: RaidRules = {
  ...RAID,
  hpByN: RAID.hpByN.map((x) => x * 0.94),
  enrage: { at: 0.5, minionEvery: RAID.minionEvery, bossEvery: 6, bossHit: RAID.bossHit },
}

/** -1 是魔王的小兵，其他是座位（0 起算） */
export type Owner = number
export const BOSS = -1

export interface RUnit {
  id: number
  owner: Owner
  line: Line
  rank: number
  x: number
  hp: number
  maxHp: number
  dps: number
  speed: number
  reach: number
  splash: number
  fighting: boolean
  hurt: number
  /** 小兵要去打誰的城（座位）。走到的時候那座城倒了就換一座。 */
  goal: number
}

export interface Seat {
  castle: number
  /** 城倒了、還沒修好 */
  down: boolean
  crystal: number
  tier: number
  /** 答對了還沒換成兵的題數 */
  credit: number
  /** 這個人對魔王打了多少（結算畫面用） */
  dealt: number
  /** 答對幾題 */
  correct: number
  /** 答了幾題（對錯都算）。斷線接手的電腦照這個推他的速度。 */
  answered: number
  /** 斷線之後由電腦接手，從第幾秒開始 */
  botFrom: number | null
  botNext: number
  botPending: number
  /** 接手那一刻算好的速度（每分鐘答對幾題） */
  botRate: number
}

export interface RaidState {
  t: number
  n: number
  bossHp: number
  bossMax: number
  /** 魔王下一下還有多久 */
  bossCd: number
  /** 魔王這一下剛出手（畫面播攻擊動畫用），秒數 */
  bossSwing: number
  bossHurt: number
  towerCd: number
  minionCd: number
  wave: number
  units: RUnit[]
  seats: Seat[]
  over: boolean
  win: boolean
  reason: 'boss' | 'time' | 'castles' | null
  /** 變身了沒（只有 rules.enrage 的魔王會變） */
  enraged: boolean
  seq: number
  /** 斷線接手用的亂數（整數，見 rand） */
  rng: number
}

export interface RHit {
  x: number
  /** 被打的是誰：座位、BOSS（小兵）、'boss'（魔王本人）、'castle'（某座城） */
  who: Owner | 'boss' | 'castle'
  seat?: number
  killed: boolean
  /** 魔王的範圍攻擊、塔的箭 */
  from?: 'boss' | 'tower'
}

/** 某個速度的人分到多少魔王血 */
export function hpFor(rate: number, r: RaidRules = RAID): number {
  const tb = r.hpTable
  if (!tb) return r.bossHpPer
  if (rate <= tb[0][0]) return tb[0][1]
  for (let i = 1; i < tb.length; i++) {
    const [x1, y1] = tb[i]
    const [x0, y0] = tb[i - 1]
    if (rate <= x1) return y0 + ((rate - x0) / (x1 - x0)) * (y1 - y0)
  }
  return tb[tb.length - 1][1]
}

/**
 * 開一場。rates 是每個座位的速度（每分鐘答對幾題），決定魔王有多少血。
 * **每支手機要拿到一模一樣的 rates**（伺服器開打時存下來發給大家），不然血量就對不上。
 */
export function newRaid(rates: number[], seed = 1, r: RaidRules = RAID): RaidState {
  const k = Math.max(1, Math.min(MAX_PLAYERS, rates.length))
  const hp = Math.round(rates.slice(0, k).reduce((a, x) => a + hpFor(x, r), 0) * (r.hpByN[k] ?? 1))
  return {
    t: 0, n: k,
    bossHp: hp, bossMax: hp,
    bossCd: r.bossEvery, bossSwing: 0, bossHurt: 0,
    towerCd: r.towerEvery, minionCd: 6, wave: 0,
    units: [],
    seats: Array.from({ length: k }, () => ({
      castle: r.castleHp, down: false, crystal: 0, tier: 1, credit: 0,
      dealt: 0, correct: 0, answered: 0, botFrom: null, botNext: 0, botPending: 0, botRate: 12,
    })),
    over: false, win: false, reason: null, enraged: false,
    seq: 1, rng: (seed >>> 0) || 1,
  }
}

/** 0~1 的亂數，只准斷線接手用。xorshift，整數運算，每支手機算出來一樣。 */
export function rand(s: RaidState): number {
  let x = s.rng | 0
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5
  s.rng = x >>> 0
  return (s.rng % 100000) / 100000
}

export function alive(s: RaidState): number[] {
  const out: number[] = []
  for (let i = 0; i < s.n; i++) if (!s.seats[i].down) out.push(i)
  return out
}

/** 派一隻兵（座位 seat 的 line 線 rank 階） */
export function summonFor(s: RaidState, seat: number, line: Line, rank: number, r: RaidRules = RAID): RUnit {
  const st = statsOf(line, rank)
  const u: RUnit = {
    id: s.seq++, owner: seat, line, rank: Math.max(1, Math.min(MAX_TIER, rank)),
    x: r.homeX - 20, hp: st.hp, maxHp: st.hp, dps: st.dps, speed: st.speed,
    reach: st.reach, splash: st.splash, fighting: false, hurt: 0, goal: -1,
  }
  s.units.push(u)
  return u
}

function spawnMinions(s: RaidState, r: RaidRules) {
  const grow = 1 + s.wave * r.minionGrow
  // 一人分到一隻，打他自己的城。城倒了的人這一波不派——他正在修城。
  // 全部的人都倒了還是照派（派給大家），不然時間到之前戰場會空掉。
  const up = alive(s)
  const goals = up.length ? up : Array.from({ length: s.n }, (_, i) => i)
  for (const g of goals) {
    const hp = Math.round(r.minionHp * grow)
    s.units.push({
      id: s.seq++, owner: BOSS, line: 'recognize', rank: 1,
      x: r.bossX + 70, hp, maxHp: hp, dps: r.minionDps * grow, speed: r.minionSpeed,
      reach: r.reach, splash: 0, fighting: false, hurt: 0, goal: g,
    })
  }
  s.wave++
}

const dirOf = (u: RUnit) => (u.owner === BOSS ? 1 : -1)

/** 答對那一槍。target 是小兵的編號；-1 或找不到就打魔王。 */
export function strikeAt(s: RaidState, seat: number, target: number, r: RaidRules = RAID): RHit | null {
  if (s.over) return null
  const u = s.units.find((x) => x.id === target && x.owner === BOSS && x.hp > 0)
  if (u) {
    u.hp -= r.strike
    u.hurt = 0.18
    const killed = u.hp <= 0
    if (killed) {
      s.seats[seat].crystal += r.killCrystal
      s.units = s.units.filter((x) => x.hp > 0)
    }
    return { x: u.x, who: BOSS, killed }
  }
  hurtBoss(s, seat, r.strikeBoss)
  return { x: r.bossX, who: 'boss', killed: s.bossHp <= 0 }
}

function hurtBoss(s: RaidState, seat: number, dmg: number) {
  s.bossHp -= dmg
  s.bossHurt = 0.15
  if (seat >= 0) s.seats[seat].dealt += dmg
}

/**
 * 答對一題（不含出兵，出兵另外一個動作）。城倒了的人答對是修城。
 * 回傳這一槍打到哪（畫面畫光線用）。
 */
export function answer(s: RaidState, seat: number, correct: boolean, target: number, r: RaidRules = RAID): RHit | null {
  const me = s.seats[seat]
  if (s.over) return null
  me.answered++
  if (!correct) return null
  me.correct++
  if (me.down) {
    me.castle = Math.min(r.castleHp, me.castle + r.repair)
    if (me.castle >= r.repairUp) me.down = false
    return null
  }
  me.crystal += r.answerCrystal
  me.credit++
  return strikeAt(s, seat, target, r)
}

/** 出兵。要有答對撐著（credit），兵階不能超過上限；城倒了不能出兵。 */
export function summon(s: RaidState, seat: number, line: Line, rank: number, r: RaidRules = RAID): RUnit | null {
  const me = s.seats[seat]
  if (s.over || me.down) return null
  const k = Math.min(MAX_TIER, me.tier, me.credit, Math.max(1, rank))
  if (k < 1) return null
  me.credit -= k
  return summonFor(s, seat, line, k, r)
}

export function upgrade(s: RaidState, seat: number): boolean {
  const me = s.seats[seat]
  if (me.tier >= MAX_TIER) return false
  const cost = TIER_COST[me.tier - 1]
  if (me.crystal < cost) return false
  me.crystal -= cost
  me.tier++
  return true
}

export function nextCost(s: RaidState, seat: number): number | null {
  const t = s.seats[seat].tier
  return t >= MAX_TIER ? null : TIER_COST[t - 1]
}

/** 小兵最前面那幾隻（離大家的城最近的），答對那一槍的目標從這裡挑 */
export function frontMinions(s: RaidState, k: number): RUnit[] {
  return s.units.filter((u) => u.owner === BOSS && u.hp > 0).sort((a, b) => b.x - a.x).slice(0, k)
}

/** 走一格 */
export function step(s: RaidState, dt: number, r: RaidRules = RAID): RHit[] {
  if (s.over) return []
  s.t += dt
  const hits: RHit[] = []
  if (s.bossSwing > 0) s.bossSwing -= dt
  if (s.bossHurt > 0) s.bossHurt -= dt

  // --- 神話魔王半血變身：那一刻馬上多一波小兵、重擊一次（重擊在下面 bossCd 歸零時做）
  if (r.enrage && !s.enraged && s.bossHp <= s.bossMax * r.enrage.at) {
    s.enraged = true
    spawnMinions(s, r)
    s.minionCd = r.enrage.minionEvery
  }

  const ev = s.enraged && r.enrage ? r.enrage : r

  // --- 小兵
  s.minionCd -= dt
  if (s.minionCd <= 0) {
    s.minionCd += ev.minionEvery
    spawnMinions(s, r)
  }

  // --- 斷線接手的電腦
  for (let i = 0; i < s.n; i++) botStep(s, i, r)

  // --- 兵與小兵**互不相打，各走各的**（2026-09-25 量過才這樣定）。
  //
  // 第一版照兵推讓兩邊在路中間打架，結果勝負變成「兵夠不夠多衝過小兵」：
  // 每分鐘答對 10 題的一隊一滴血都打不到魔王，20 題的一隊七十秒打完，
  // 勝率對速度是一道懸崖，沒辦法讓「同程度的人打都約六成」。
  // 改成兵只打魔王、小兵只打城堡之後，打到魔王的傷害跟答對的題數成正比，
  // 而「要不要先把衝向我家的小兵點掉」變成每一題都在做的決定——
  // 上面三塊木牌就是最前面的小兵，沒有小兵的位置是魔王本人。
  for (const u of s.units) {
    if (u.hurt > 0) u.hurt -= dt
    if (u.owner === BOSS) {
      if (r.homeX - u.x <= u.reach) {
        u.fighting = true
        const c = s.seats[u.goal]
        // 那座城已經倒了：小兵衝進城裡就不見了（不會轉去打別人家，
        // 不然一座城倒下會連鎖把全隊拖垮——量過，人越多越容易全滅）
        if (!c || c.down) { u.hp = 0; continue }
        c.castle -= u.dps * dt
        hits.push({ x: r.homeX, who: 'castle', seat: u.goal, killed: false })
        if (c.castle <= 0) {
          c.castle = 0
          c.down = true
          c.credit = 0
        }
        continue
      }
    } else if (u.x - r.bossX <= u.reach + 40) {
      // 魔王的身體比一般城堡寬，站在牠身前 40 就打得到；大家一擁而上，不用排隊
      u.fighting = true
      hurtBoss(s, u.owner, u.dps * dt)
      continue
    }
    u.fighting = false
    u.x += u.speed * dirOf(u) * dt
  }

  // --- 魔王本人：每隔幾秒「重擊」一次，身邊那一圈的兵全部挨一下。
  // 不做成持續的範圍攻擊：持續打的話魔王身前會變成一道牆，兵一隻都擠不進去，
  // 整場就變成「推得進去全贏、推不進去全輸」（量過，勝率只有 0% 或 100% 兩種）。
  // 一下一下的重擊看得到、躲不掉，但打完有空檔，兵還是衝得進去。
  s.bossCd -= dt
  if (s.bossCd <= 0) {
    s.bossCd += ev.bossEvery
    s.bossSwing = 0.6
    for (const u of s.units) {
      if (u.owner === BOSS || u.hp <= 0 || u.x - r.bossX > r.bossReach) continue
      u.hp -= ev.bossHit
      u.hurt = 0.3
      hits.push({ x: u.x, who: u.owner, killed: u.hp <= 0, from: 'boss' })
    }
  }

  // --- 每座城各有一座箭塔，只射衝著自己家來的小兵。
  // 一座塔守全部的話，六個人的小兵是兩個人的三倍，塔射不完，人越多越難守。
  s.towerCd -= dt
  if (s.towerCd <= 0) {
    s.towerCd += r.towerEvery
    for (let i = 0; i < s.n; i++) {
      if (s.seats[i].down) continue
      let t: RUnit | null = null
      for (const u of s.units) {
        if (u.owner !== BOSS || u.hp <= 0 || u.goal !== i) continue
        if (r.homeX - u.x <= r.towerRange && (!t || u.x > t.x)) t = u
      }
      if (t) {
        t.hp -= r.towerHit
        t.hurt = 0.12
        hits.push({ x: t.x, who: BOSS, killed: t.hp <= 0, from: 'tower' })
      }
    }
  }

  s.units = s.units.filter((u) => u.hp > 0)

  if (s.bossHp <= 0) {
    s.bossHp = 0
    s.over = true; s.win = true; s.reason = 'boss'
  } else if (alive(s).length === 0) {
    s.over = true; s.win = false; s.reason = 'castles'
  } else if (s.t >= r.seconds) {
    s.over = true; s.win = false; s.reason = 'time'
  }
  return hits
}

/**
 * 斷線接手的電腦。照他自己打到斷線那一刻的速度（答對幾題÷幾秒）繼續答，
 * 正確率 85%，一律走認字線、有錢就升階。**用 state 裡的 rng**，每支手機算的一樣。
 */
function botStep(s: RaidState, i: number, r: RaidRules) {
  const me = s.seats[i]
  if (me.botFrom === null || s.t < me.botNext) return
  me.botNext = s.t + 60 / me.botRate
  const ok = rand(s) < 0.85
  if (!ok) {
    if (me.botPending > 0) summon(s, i, 'recognize', me.botPending, r)
    me.botPending = 0
    return
  }
  const front = frontMinions(s, 1)[0]
  answer(s, i, true, front ? front.id : -1, r)
  if (me.down) return
  me.botPending++
  if (me.botPending >= me.tier) {
    summon(s, i, 'recognize', me.tier, r)
    me.botPending = 0
  }
  upgrade(s, i)
}

/** 這個座位從現在起由電腦接手 */
export function botTakeOver(s: RaidState, seat: number) {
  const me = s.seats[seat]
  if (me.botFrom !== null) return
  me.botFrom = s.t
  me.botRate = Math.max(6, Math.min(30, s.t > 20 ? (me.answered / s.t) * 60 : 12))
  me.botNext = s.t + 1
  me.botPending = 0
}
