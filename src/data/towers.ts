/** 塔的數值。改這裡就好，不用動程式。 */
export interface TowerSpec {
  name: string
  emoji: string
  desc: string
  cost: number
  range: number
  damage: number
  blockRadius?: number
  soldierHp?: number
}

export const TOWERS: Record<string, TowerSpec> = {
  archery: {
    name: '箭塔', emoji: '🏹', desc: '射程內的怪會被它射中',
    cost: 40, range: 170, damage: 18,
  },
  barracks: {
    name: '軍營', emoji: '🛡️', desc: '派士兵擋路，替你爭取時間',
    cost: 30, range: 0, damage: 0, blockRadius: 30, soldierHp: 60,
  },
}

export type TowerKind = keyof typeof TOWERS

/** 集火：兩座以上同時打到，傷害加成。傷害由單字難度與塔決定，等級只負責解鎖。 */
export const FOCUS_STEP = 0.2
export const FOCUS_MAX = 3

/** 拆塔退費：這一波還沒開打全額退，打過仗的退一半。小朋友需要能安心亂試。 */
export function refundOf(cost: number, foughtAWave: boolean): number {
  return foughtAWave ? Math.floor(cost / 2) : cost
}
