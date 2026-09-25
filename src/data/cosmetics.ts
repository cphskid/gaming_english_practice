/**
 * 裝飾品：陣營顏色與頭像外框。
 *
 * **為什麼是顏色和外框，不是帽子和披風。**
 * 那 25 張頭像是畫好的完成品，不是可以疊圖層的人偶——要讓小皇冠真的戴在頭上，
 * 等於要有人照著 25 顆頭畫 25 頂帽子。所以第一版走兩條不用畫新圖的路：
 *
 * 1. **陣營顏色**：素材包裡每一棟建築和每一個兵本來就有藍紅紫黃黑五色，
 *    買了之後城堡、箭塔、軍營、士兵整個戰場都變成他的顏色。變化幅度最大，
 *    成本是零（見 tools/build-td-art.py）。
 * 2. **頭像外框**：外框跟任何一張頭像都能疊，25 張 × N 個外框就是 N 倍的變化。
 *    而且外框在上面那一條、選關畫面、之後的排行榜都看得到——**同學看得到才叫收集**。
 *
 * 一個欄位一次只能穿一件（顏色只能有一種、外框只能有一個），這條規則是
 * **資料庫在管**（shop_items.slot ＋ equip_item），前端這份只負責顯示。
 */

import { BOSSES } from './bosses'

/**
 * legion 是整套軍團（見 data/legions.ts）；avatar 是商店賣的頭像（見 data/avatars.ts）。
 * 頭像不走 equip_item，戴哪一張存在 characters.avatar，由 set_avatar 換——
 * 這個欄位只是讓商店分得出哪幾個品項是頭像。
 */
export type Slot = 'color' | 'frame' | 'legion' | 'avatar'

export interface ColorDef {
  /** 商店品項 id。空字串代表預設的藍色，不用買。 */
  id: string
  name: string
  /** 美術鍵的後綴，例如 '_red' 會讓城堡用 castle_red */
  suffix: string
  /** 畫在商店與展示頁上的色塊 */
  swatch: string
}

export const COLORS: ColorDef[] = [
  { id: '', name: '藍軍', suffix: '', swatch: '#4d79c9' },
  { id: 'color-red', name: '紅軍', suffix: '_red', swatch: '#c4463c' },
  { id: 'color-yellow', name: '黃軍', suffix: '_yellow', swatch: '#d8a331' },
  { id: 'color-purple', name: '紫軍', suffix: '_purple', swatch: '#8b5cc7' },
  { id: 'color-black', name: '黑軍', suffix: '_black', swatch: '#3c3f4a' },
]

export interface FrameDef {
  id: string
  name: string
  /** 加在頭像外面那一層的 class，樣式在 styles.css */
  className: string
  /** 框上角落掛的小東西，沒有就不掛 */
  badge?: string
  /** 只能靠這個成就解開，商店買不到（見 src/data/achievements.ts） */
  fromAchievement?: string
  /** 第一次打倒這隻魔王拿到的（魔王團戰），商店也買不到 */
  fromBoss?: string
}

export const FRAMES: FrameDef[] = [
  { id: 'frame-gold', name: '金邊框', className: 'f-gold' },
  { id: 'frame-ribbon', name: '緞帶框', className: 'f-ribbon' },
  { id: 'frame-crown', name: '皇冠框', className: 'f-crown', badge: '👑' },
  { id: 'frame-rainbow', name: '彩虹框', className: 'f-rainbow' },

  // 成就限定。**這八個商店買不到**——買不到才有稀缺性，這是 Chuck 要的那一點。
  // 資料庫那邊 shop_items.achievement_only = true，buy_item 會直接擋掉。
  { id: 'frame-laurel', name: '葉冠框', className: 'f-laurel', fromAchievement: 'literate' },
  { id: 'frame-wave', name: '音波框', className: 'f-wave', fromAchievement: 'balanced' },
  { id: 'frame-flame', name: '火焰框', className: 'f-flame', fromAchievement: 'all-clear' },
  { id: 'frame-frost', name: '冰晶框', className: 'f-frost', fromAchievement: 'all-clear-2' },
  { id: 'frame-legend', name: '傳說框', className: 'f-legend', badge: '⚜️', fromAchievement: 'all-clear-3' },
  { id: 'frame-banner', name: '戰旗框', className: 'f-banner', fromAchievement: 'war-flag' },
  { id: 'frame-stardust', name: '星塵框', className: 'f-stardust', fromAchievement: 'dual-job' },
  { id: 'frame-calendar', name: '日曆框', className: 'f-calendar', fromAchievement: 'week-5' },

  // 魔王團戰：每隻魔王第一次打倒給一個（2026-09-25）。框是魔王的主色，角落掛牠的小頭像。
  ...BOSSES.map((b) => ({
    id: b.frame, name: b.name + '框', className: 'f-boss f-boss-' + b.id, fromBoss: b.id,
  })),
]

/** 身上那一套裡的顏色。沒穿就是預設藍。 */
export function colorOf(equipped: string[]): ColorDef {
  return COLORS.find((c) => c.id && equipped.includes(c.id)) ?? COLORS[0]
}

export function frameOf(equipped: string[]): FrameDef | null {
  return FRAMES.find((f) => equipped.includes(f.id)) ?? null
}
