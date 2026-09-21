import type { ItemDef } from '@/core/inventory'

/**
 * 裝飾品純外觀不給數值，道具才有效果——不然付費就是變強。
 *
 * **道具的效果一律只活在戰場裡**（減速、補城堡血、補水晶），不准碰金幣與經驗。
 * 原本有一個「這一場金幣加倍」，拿掉了：金幣是伺服器從答題事件重算的，
 * 前端自己乘二會跟伺服器對不起來，那條對帳測試就是為了抓這種事。
 * 要做加倍就得讓伺服器也知道這一場用了道具，那是另一個題目。
 *
 * 裝飾品分成兩個欄位（見 data/cosmetics.ts）：
 * **顏色**會換掉整個戰場的陣營色，**外框**套在頭像外面。一個欄位只能穿一件，
 * 這條規則由資料庫執行，前端只是顯示。
 *
 * 價格與解鎖等級這裡寫的只是顯示用，**真正算數的是資料庫的 shop_items**
 * （seed.sql 由 tools/gen-shop-seed.mjs 從這份產生）。
 */
export const ITEMS: ItemDef[] = [
  // 道具：效果只活在這一場戰鬥裡
  { id: 'slow-30', name: '寒霜陷阱', icon: '🧊', desc: '15 秒內怪全部慢下來', price: 60, kind: 'consumable', unlockLevel: 1 },
  { id: 'heal-5', name: '城牆修補', icon: '🧱', desc: '城堡回復 5 點血', price: 80, kind: 'consumable', unlockLevel: 2 },
  { id: 'crystal-40', name: '水晶補給', icon: '💎', desc: '戰場上馬上多 40 顆水晶', price: 120, kind: 'consumable', unlockLevel: 3 },

  // 陣營顏色：城堡、箭塔、軍營、士兵整套變色
  { id: 'color-red', name: '紅軍', icon: '🟥', desc: '城堡、塔、士兵全部變紅色', price: 150, kind: 'cosmetic', slot: 'color', unlockLevel: 1 },
  { id: 'color-yellow', name: '黃軍', icon: '🟨', desc: '城堡、塔、士兵全部變黃色', price: 150, kind: 'cosmetic', slot: 'color', unlockLevel: 2 },
  { id: 'color-purple', name: '紫軍', icon: '🟪', desc: '城堡、塔、士兵全部變紫色', price: 220, kind: 'cosmetic', slot: 'color', unlockLevel: 4 },
  { id: 'color-black', name: '黑軍', icon: '⬛', desc: '城堡、塔、士兵全部變黑色', price: 300, kind: 'cosmetic', slot: 'color', unlockLevel: 6 },

  // 頭像外框：排行榜和上面那一條都看得到
  { id: 'frame-gold', name: '金邊框', icon: '🖼️', desc: '頭像加一圈金邊', price: 120, kind: 'cosmetic', slot: 'frame', unlockLevel: 1 },
  { id: 'frame-ribbon', name: '緞帶框', icon: '🎗️', desc: '頭像下面掛一條緞帶', price: 180, kind: 'cosmetic', slot: 'frame', unlockLevel: 3 },
  { id: 'frame-crown', name: '皇冠框', icon: '👑', desc: '金框加一頂小皇冠', price: 260, kind: 'cosmetic', slot: 'frame', unlockLevel: 5 },
  { id: 'frame-rainbow', name: '彩虹框', icon: '🌈', desc: '會跑的彩虹邊，最難買到的那個', price: 400, kind: 'cosmetic', slot: 'frame', unlockLevel: 7 },

  // 成就限定的六個外框。**商店買不到**，價格欄只是因為資料表要求大於零，
  // 真正的把關在 buy_item（achievement_only 的東西一律擋）。
  // 哪一個成就給哪一個框寫在 src/data/achievements.ts。
  { id: 'frame-laurel', name: '葉冠框', icon: '🍃', desc: '三百個字都答對過的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-wave', name: '音波框', icon: '🎵', desc: '三種技能都練到熟的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-flame', name: '火焰框', icon: '🔥', desc: '十四關全破的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-banner', name: '戰旗框', icon: '🏴', desc: '贏過同學五場的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-stardust', name: '星塵框', icon: '✨', desc: '兩個職業都通關過的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-calendar', name: '日曆框', icon: '📅', desc: '一週來五天的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
]
