/**
 * 軍團包（2026-09-24 Chuck 定案）。
 *
 * **一套軍團＝整套換掉**：兵推裡你的兵、城堡、塔、戰場背景全部換成那一套；
 * 守塔只換軍營士兵和箭塔（地圖不換，豬軍團的地形是側視的，做不出俯視的彎路）。
 * 純外觀，數值一個都不動——職業才管「答對之後發生什麼事」，軍團只管長什麼樣子。
 *
 * **為什麼整包一次解鎖，不是一隻一隻買**：不同素材包的像素密度對不起來，
 * 混著用會一隻大一隻小，所以一套就是一整套。
 *
 * **商店分四級，每一級是一層架子。** 門檻（等級、先拿到哪個成就、價格）跟著級別走，
 * 之後要加新軍團，只要：
 *   1. tools/build-td-art.py 切一組圖（鍵名前綴，例如 'pirate_'）
 *   2. 這裡多一行，說它放在哪一級
 * 同一級可以放好幾套；某一套想綁別的成就，填 needAchievement 蓋過那一級的預設。
 *
 * 陣營五色只對王國軍有效（2026-09-24 起免費送）。換上別的軍團時顏色欄變灰——
 * 不然每一套軍團都要畫五色，九隻兵乘五色就是四十五張。
 */

export type LegionTier = 'default' | 'common' | 'rare' | 'legendary'

export interface TierDef {
  name: string
  /** 幾級才買得到 */
  unlockLevel: number
  price: number
  /** 要先拿到這個成就才開放購買（src/data/achievements.ts 的 id） */
  needAchievement?: string
  /** 這一級會綁成就、但還沒決定綁哪一個（傳說級第一版是空的） */
  badgeLater?: boolean
  /** 商店上那一層架子的顏色 */
  tint: string
}

/**
 * 四層架子。**價格是暫定的**（參考最貴的彩虹框 400 金），
 * 上線後用真實答題紀錄算「一般學生幾天買得起」再調。
 */
export const TIERS: Record<LegionTier, TierDef> = {
  default: { name: '預設', unlockLevel: 1, price: 0, tint: '#8a9a7a' },
  common: { name: '普通', unlockLevel: 3, price: 300, tint: '#5d9a4a' },
  // 稀有級綁「頂階降臨」（對戰推出過頂階兵）：豬軍團在對戰最有感，拿到的人正好最會用它
  rare: { name: '稀有', unlockLevel: 6, price: 600, needAchievement: 'top-tier', tint: '#4f7fd0' },
  // 傳說級第一版是空的，之後擴充最帥的那一套。成就等那一套來了再挑。
  legendary: { name: '傳說', unlockLevel: 10, price: 1000, badgeLater: true, tint: '#c98a1c' },
}

export const TIER_ORDER: LegionTier[] = ['default', 'common', 'rare', 'legendary']

export type LegionLine = 'recognize' | 'listen' | 'spell'

export interface LegionDef {
  /** 商店品項 id。空字串是預設的王國軍，不用買。 */
  id: string
  name: string
  tier: LegionTier
  desc: string
  /** public/td-art 裡的鍵名前綴。王國軍是空字串。 */
  prefix: string
  /** 陣營五色有沒有效。只有王國軍有五色素材。 */
  usesColor: boolean
  /** 兵推的戰場：草地（Tiny Swords）或側視的城堡室內（Kings and Pigs） */
  field: 'grass' | 'castle'
  /**
   * 每一階用哪張圖（鍵名不含前綴）。沒寫的線三階都用 u_spear／u_bow／u_shield，
   * 靠體型、隨從人數和軍階標記分辨。
   */
  ranks?: Partial<Record<LegionLine, [string, string, string]>>
  /** 蓋過那一級的預設成就 */
  needAchievement?: string
  /** 商店縮圖用哪張（鍵名含前綴） */
  thumb: string
  /** 三條線三階的名字，商店與「我的角色」顯示用 */
  roster: string
}

export const LEGIONS: LegionDef[] = [
  {
    id: '', name: '王國軍', tier: 'default', prefix: '', usesColor: true, field: 'grass',
    desc: '長槍兵、弓手、盾劍士。陣營五色隨你換',
    thumb: 'u_shield', roster: '長槍兵／弓手／盾劍士',
  },
  {
    id: 'legion-goblin', name: '哥布林軍團', tier: 'common', prefix: 'gob_', usesColor: false, field: 'grass',
    desc: '火把兵、炸藥兵、木桶兵，住在木頭屋裡',
    thumb: 'gob_u_spear', roster: '火把兵／炸藥兵／木桶兵',
  },
  {
    id: 'legion-pig', name: '豬軍團', tier: 'rare', prefix: 'pig_', usesColor: false, field: 'castle',
    desc: '在城堡裡開打。升到頂階會推出大砲、豬王從箱子裡跳出來',
    ranks: {
      listen: ['u_bow', 'u_bow2', 'u_bow3'],
      spell: ['u_shield', 'u_shield', 'u_shield3'],
    },
    thumb: 'pig_u_spear', roster: '豬兵／丟炸彈豬→大砲／箱中豬→豬王',
  },
]

export const DEFAULT_LEGION = LEGIONS[0]

/** 身上那一套軍團。沒穿就是王國軍。 */
export function legionOf(equipped: string[]): LegionDef {
  return LEGIONS.find((l) => l.id && equipped.includes(l.id)) ?? DEFAULT_LEGION
}

export function legionById(id: string): LegionDef {
  return LEGIONS.find((l) => l.id === id) ?? DEFAULT_LEGION
}

/** 這一套要先拿到哪個成就才買得到（自己有寫就用自己的，不然用那一級的） */
export function legionNeed(l: LegionDef): string | undefined {
  return l.needAchievement ?? TIERS[l.tier].needAchievement
}

/** 某條線第幾階用哪張圖（鍵名含前綴）。 */
export function legionUnitArt(l: LegionDef, line: LegionLine, base: string, rank: number): string {
  const r = l.ranks?.[line]
  return l.prefix + (r ? r[Math.max(0, Math.min(2, rank - 1))] : base)
}
