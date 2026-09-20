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

export type Slot = 'color' | 'frame'

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
}

export const FRAMES: FrameDef[] = [
  { id: 'frame-gold', name: '金邊框', className: 'f-gold' },
  { id: 'frame-ribbon', name: '緞帶框', className: 'f-ribbon' },
  { id: 'frame-crown', name: '皇冠框', className: 'f-crown', badge: '👑' },
  { id: 'frame-rainbow', name: '彩虹框', className: 'f-rainbow' },
]

/** 身上那一套裡的顏色。沒穿就是預設藍。 */
export function colorOf(equipped: string[]): ColorDef {
  return COLORS.find((c) => c.id && equipped.includes(c.id)) ?? COLORS[0]
}

export function frameOf(equipped: string[]): FrameDef | null {
  return FRAMES.find((f) => equipped.includes(f.id)) ?? null
}
