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
    name: '軍營', emoji: '🛡️', desc: '派士兵纏住怪，讓牠們走得很慢',
    cost: 30, range: 0, damage: 0, blockRadius: 30, soldierHp: 60,
  },
}

/**
 * 被士兵纏住的怪剩幾成速度。
 *
 * 原本士兵是把怪**完全停住**，結果產生一個玩家修不掉的壞情況：
 * 卡點只要落在所有箭塔的射程外，那隻怪就永遠停在那裡，誰也打不到。
 * 改成拖慢之後，怪再慢也一定會走進箭塔範圍，那個壞情況就不存在了。
 * 對小朋友也比較好解釋：「軍營會拖住怪，讓牠們走很慢」。
 */
export const SOLDIER_SLOW = 0.3

/**
 * 士兵離軍營最遠會走多遠，去找一個有箭塔罩得到的位置站。
 *
 * 設成跟箭塔射程一樣，這樣「士兵會在自己軍營一個箭塔射程內找位置」
 * 是一句解釋得通的話，畫面上也不會出現士兵跑到離軍營很遠的地方。
 *
 * 實測（tools/test/barracks-check.mjs）：兩條路的佈局原本有 2 個塔位
 * 放軍營是完全沒火力罩得到的，三條路的有 5 個，改完都變成 0 個。
 * 一條長路的佈局還剩 1 個，再放寬到 220 才補得掉，但那樣士兵會跑得太遠；
 * 而且士兵改成拖慢之後，站在沒火力的地方頂多是浪費，不會再把怪永遠卡死，
 * 所以那一個留著不補。
 */
export const SOLDIER_REACH = 170

export type TowerKind = keyof typeof TOWERS

/** 集火：兩座以上同時打到，傷害加成。傷害由單字難度與塔決定，等級只負責解鎖。 */
export const FOCUS_STEP = 0.2
export const FOCUS_MAX = 3

/** 拆塔退費：這一波還沒開打全額退，打過仗的退一半。小朋友需要能安心亂試。 */
export function refundOf(cost: number, foughtAWave: boolean): number {
  return foughtAWave ? Math.floor(cost / 2) : cost
}

/**
 * 戰場水晶的收入。
 *
 * **水晶跟角色金幣是兩條完全分開的線**：水晶只活在這一場裡，結束就歸零，
 * 拿來蓋塔；角色金幣跨場累積，拿來買道具和裝飾品，由 core/economy 計算。
 * 所以遊戲可以自己管水晶，這不違反「遊戲不准碰金幣怎麼算」那條規矩。
 *
 * 答對給得比殺怪多，是故意的：我們要獎勵的是讀字，不是運氣好剛好補到最後一刀。
 */
export const CRYSTAL = {
  perCorrect: 3,
  perKill: 5,
  perWave: 10,
}
