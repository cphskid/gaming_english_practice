import type { Slot } from '@/data/cosmetics'
import type { Character } from './types'

/**
 * 道具與裝飾品的背包。放在 core 而不是各遊戲裡，
 * 所以打地鼠賺到的道具能帶進守塔——「其他遊戲當賺錢管道」就是靠這個成立的。
 */
/**
 * 道具在哪個遊戲裡有效果。值是 `GameModule.id`。
 *
 * **每個道具都要指定**，因為效果是各遊戲各自實作的——守塔的「地面結霜」
 * 在兵推裡根本沒有地面。沒指定就等於「這個遊戲沒做」，道具列不會列出來，
 * 玩家才不會按了一個什麼都不會發生的按鈕（2026-09-21 之前兵推就是這樣）。
 */
export type ItemMode = 'tower-defense' | 'tug-of-war'

export const MODE_LABEL: Record<ItemMode, string> = {
  'tower-defense': '守塔',
  'tug-of-war': '對戰',
}

export interface ItemDef {
  id: string
  name: string
  /** 圖示的鍵，對到 public/icons/（見 data/icons.ts）。不是 emoji。 */
  icon: string
  desc: string
  price: number
  kind: 'consumable' | 'cosmetic'
  /**
   * 這個道具在哪些遊戲裡有效果，順序就是商店上標示的順序。
   * 裝飾品不用填（外觀到處都看得到，不屬於任何一個遊戲）。
   */
  modes?: ItemMode[]
  /**
   * 裝飾品穿在哪個欄位。一個欄位一次只能穿一件（顏色只能有一種、
   * 外框只能有一個），這條規則是資料庫在管，不是前端。
   */
  slot?: Slot
  /** 要幾級才買得到 */
  unlockLevel: number
  /**
   * 成就限定：商店裡不顯示、也買不到，只能靠解成就拿到。
   * 擋下來的是資料庫（buy_item），前端這個旗標只負責不要把它畫在商店裡。
   */
  achievementOnly?: boolean
}

export function count(c: Character, itemId: string): number {
  return c.items[itemId] ?? 0
}

export function add(c: Character, itemId: string, n = 1): Character {
  return { ...c, items: { ...c.items, [itemId]: count(c, itemId) + n } }
}

export function consume(c: Character, itemId: string): Character | null {
  const have = count(c, itemId)
  if (have <= 0) return null
  return { ...c, items: { ...c.items, [itemId]: have - 1 } }
}

export function buy(c: Character, item: ItemDef): { ok: false; why: string } | { ok: true; character: Character } {
  if (c.coins < item.price) return { ok: false, why: `銅幣不夠，還差 ${item.price - c.coins} 枚` }
  const next = add({ ...c, coins: c.coins - item.price }, item.id)
  return { ok: true, character: next }
}

/** 這個遊戲用得到、而且背包裡真的有的道具。道具列就是照這個長出來的。 */
export function bagFor(items: Record<string, number>, defs: ItemDef[], gameId: string): ItemDef[] {
  return defs.filter((d) => d.kind === 'consumable'
    && (items[d.id] ?? 0) > 0
    && (d.modes ?? []).includes(gameId as ItemMode))
}
