import type { ItemDef, ItemMode } from '@/core/inventory'
import { LEGIONS, TIERS, legionNeed } from './legions'
import { BOSSES } from './bosses'

/** 守塔和對戰都吃得下的道具。三個消耗品現在都是。 */
const BOTH: ItemMode[] = ['tower-defense', 'tug-of-war']

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
 * **每個道具都要寫 `modes`**：道具的效果是各遊戲各自實作的，沒實作就不能列出來。
 * 2026-09-21 之前兵推沒有實作任何道具，但道具列照樣長出來，按下去完全沒反應——
 * 這個欄位就是為了不再發生那件事。只有某個遊戲吃得下的道具就只填那一個遊戲。
 *
 * 價格與解鎖等級這裡寫的只是顯示用，**真正算數的是資料庫的 shop_items**
 * （seed.sql 由 tools/gen-shop-seed.mjs 從這份產生——它會真的執行這支檔案，
 * 所以軍團那幾行用程式展開也沒關係）。
 */
export const ITEMS: ItemDef[] = [
  // 道具：效果只活在這一場戰鬥裡。三個在守塔和對戰都做得出來，
  // 但**效果不一樣**，因為兩個遊戲的戰場不一樣（各自的實作在兩支 engine.ts 的 useItem）。
  { id: 'slow-30', name: '寒霜陷阱', icon: 'frost', modes: BOTH,
    desc: '守塔：地面結霜 15 秒，怪剩三成速度。對戰：對方全軍凍住 8 秒',
    price: 60, kind: 'consumable', unlockLevel: 1 },
  { id: 'heal-5', name: '城牆修補', icon: 'repair', modes: BOTH,
    desc: '守塔：城堡回 5 點血。對戰：城堡回 15 點血',
    price: 80, kind: 'consumable', unlockLevel: 2 },
  { id: 'crystal-40', name: '水晶補給', icon: 'crystal', modes: BOTH,
    desc: '兩邊都是馬上多 40 顆水晶。守塔夠多蓋一座塔，對戰夠升一階',
    price: 120, kind: 'consumable', unlockLevel: 3 },

  // 陣營顏色：城堡、塔、士兵整套變色。**2026-09-24 起免費送**（Chuck：「多點小樂趣」），
  // 不上商店架子，在「我的角色」直接換。只對王國軍有效，換上別的軍團時變灰。
  // 價格欄只是因為資料表要求大於零，free 才是真正的把關（equip_item 不看有沒有買）。
  // **裝飾品沒有 icon**——商店直接畫色塊、外框直接套一張小頭像給你看，
  // 一個外觀品項最好的縮圖就是它自己。見 Shop.tsx。
  { id: 'color-red', name: '紅軍', icon: '', desc: '城堡、塔、士兵全部變紅色', price: 1, kind: 'cosmetic', slot: 'color', unlockLevel: 1, free: true },
  { id: 'color-yellow', name: '黃軍', icon: '', desc: '城堡、塔、士兵全部變黃色', price: 1, kind: 'cosmetic', slot: 'color', unlockLevel: 1, free: true },
  { id: 'color-purple', name: '紫軍', icon: '', desc: '城堡、塔、士兵全部變紫色', price: 1, kind: 'cosmetic', slot: 'color', unlockLevel: 1, free: true },
  { id: 'color-black', name: '黑軍', icon: '', desc: '城堡、塔、士兵全部變黑色', price: 1, kind: 'cosmetic', slot: 'color', unlockLevel: 1, free: true },

  // 軍團包：一次買整套。門檻跟著級別走（data/legions.ts 的 TIERS），這裡不用一個一個寫。
  ...LEGIONS.filter((l) => l.id).map((l): ItemDef => ({
    id: l.id, name: l.name, icon: '', desc: l.desc, kind: 'cosmetic', slot: 'legion',
    price: TIERS[l.tier].price, unlockLevel: TIERS[l.tier].unlockLevel, needAchievement: legionNeed(l),
  })),

  // 頭像外框：排行榜和上面那一條都看得到
  { id: 'frame-gold', name: '金邊框', icon: '', desc: '頭像加一圈金邊', price: 120, kind: 'cosmetic', slot: 'frame', unlockLevel: 1 },
  { id: 'frame-ribbon', name: '緞帶框', icon: '', desc: '頭像下面掛一條緞帶', price: 180, kind: 'cosmetic', slot: 'frame', unlockLevel: 3 },
  { id: 'frame-crown', name: '皇冠框', icon: '', desc: '金框加一頂小皇冠', price: 260, kind: 'cosmetic', slot: 'frame', unlockLevel: 5 },
  { id: 'frame-rainbow', name: '彩虹框', icon: '', desc: '會跑的彩虹邊，最難買到的那個', price: 400, kind: 'cosmetic', slot: 'frame', unlockLevel: 7 },

  // 成就限定的六個外框。**商店買不到**，價格欄只是因為資料表要求大於零，
  // 真正的把關在 buy_item（achievement_only 的東西一律擋）。
  // 哪一個成就給哪一個框寫在 src/data/achievements.ts。
  { id: 'frame-laurel', name: '葉冠框', icon: '', desc: '題庫每個字都答對過的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-wave', name: '音波框', icon: '', desc: '三種技能都練到熟的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-flame', name: '火焰框', icon: '', desc: '第一章全破的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-frost', name: '冰晶框', icon: '', desc: '第二章全破的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-legend', name: '傳說框', icon: '', desc: '三章全破、兩千字都走過的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-banner', name: '戰旗框', icon: '', desc: '贏過同學五場的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-stardust', name: '星塵框', icon: '', desc: '兩個職業都通關過的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },
  { id: 'frame-calendar', name: '日曆框', icon: '', desc: '一週來五天的人才有', price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true },

  // 魔王團戰的外框：第一次打倒那隻魔王就放進背包（raid_result）。一樣買不到。
  // 資料庫靠「有沒有 frame-boss-<id> 這個品項」認魔王（open_raid），所以加新魔王一定要有這一行。
  ...BOSSES.map((b): ItemDef => ({
    id: b.frame, name: b.name + '框', icon: '', desc: `第一次打倒${b.name}的人才有`,
    price: 1, kind: 'cosmetic', slot: 'frame', unlockLevel: 1, achievementOnly: true,
  })),
]
