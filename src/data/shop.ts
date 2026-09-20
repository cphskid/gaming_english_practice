import type { ItemDef } from '@/core/inventory'

/**
 * 裝飾品純外觀不給數值，道具才有效果——不然付費就是變強。
 *
 * **道具的效果一律只活在戰場裡**（減速、補城堡血、補水晶），不准碰金幣與經驗。
 * 原本有一個「這一場金幣加倍」，拿掉了：金幣是伺服器從答題事件重算的，
 * 前端自己乘二會跟伺服器對不起來，那條對帳測試就是為了抓這種事。
 * 要做加倍就得讓伺服器也知道這一場用了道具，那是另一個題目。
 */
export const ITEMS: ItemDef[] = [
  { id: 'slow-30', name: '寒霜陷阱', desc: '這一波怪全部減速 30%', price: 60, kind: 'consumable', unlockLevel: 1 },
  { id: 'heal-5', name: '城牆修補', desc: '城堡回復 5 點血', price: 80, kind: 'consumable', unlockLevel: 2 },
  { id: 'crystal-40', name: '水晶補給', desc: '戰場上馬上多 40 顆水晶', price: 120, kind: 'consumable', unlockLevel: 3 },
  { id: 'hat-crown', name: '小皇冠', desc: '純裝飾，戴起來很神氣', price: 200, kind: 'cosmetic', unlockLevel: 2 },
  { id: 'cape-red', name: '紅披風', desc: '純裝飾', price: 180, kind: 'cosmetic', unlockLevel: 1 },
]
