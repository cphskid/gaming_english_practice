import type { ItemDef } from '@/core/inventory'

/** 裝飾品純外觀不給數值，道具才有效果——不然付費就是變強。 */
export const ITEMS: ItemDef[] = [
  { id: 'slow-30', name: '寒霜陷阱', desc: '這一波怪全部減速 30%', price: 60, kind: 'consumable', unlockLevel: 1 },
  { id: 'heal-5', name: '城牆修補', desc: '城堡回復 5 點血', price: 80, kind: 'consumable', unlockLevel: 2 },
  { id: 'double-coin', name: '幸運幣', desc: '這一場金幣加倍', price: 120, kind: 'consumable', unlockLevel: 3 },
  { id: 'hat-crown', name: '小皇冠', desc: '純裝飾，戴起來很神氣', price: 200, kind: 'cosmetic', unlockLevel: 2 },
  { id: 'cape-red', name: '紅披風', desc: '純裝飾', price: 180, kind: 'cosmetic', unlockLevel: 1 },
]
