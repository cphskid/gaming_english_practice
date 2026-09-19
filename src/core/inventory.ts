import type { Character } from './types'

/**
 * 道具與裝飾品的背包。放在 core 而不是各遊戲裡，
 * 所以打地鼠賺到的道具能帶進守塔——「其他遊戲當賺錢管道」就是靠這個成立的。
 */
export interface ItemDef {
  id: string
  name: string
  desc: string
  price: number
  kind: 'consumable' | 'cosmetic'
  /** 要幾級才買得到 */
  unlockLevel: number
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
