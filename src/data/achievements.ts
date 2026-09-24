/**
 * 成就：四十二個徽章，七個大類。
 *
 * **三條原則**（2026-09-21 跟 Chuck 談定）：
 *
 * 1. **只給外觀與解鎖，不給金幣也不給數值。** 十四關的難度是用「每分鐘要答對
 *    幾題」回推的（見 data/levels.ts），成就只要給一點點數值，整條曲線就要重算。
 *    獎品是六個**商店買不到**的外框和幾個稱號——買不到才有稀缺性。
 * 2. **伺服器從答題事件重算，前端說了不算。** 這份檔案只有「名字、說明、圖」，
 *    **解鎖條件的唯一真相在 supabase/schema.sql 的 refresh_achievements()**。
 *    前端永遠是把伺服器回來的那一份畫出來。
 * 3. **每一類都要有認真玩就拿得到的入門款。** 一整類只有前幾名拿得到的話，
 *    落後的小孩看一眼就不看了。
 *
 * 每一類的副作用也是刻意避開的，改條件之前先看 `warn`：那一行寫的是
 * 「這一類最容易做壞的地方」。
 */

export type AchCategory = 'learn' | 'skill' | 'tower' | 'versus' | 'collect' | 'habit' | 'secret'

export interface CategoryDef {
  key: AchCategory
  name: string
  /** 徽章底板的顏色。一類一色，牆上掃過去才分得出來。 */
  hue: string
  /** 這一類要避開的副作用。改條件的人請先讀這一行。 */
  warn: string
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'learn',   name: '學習', hue: '#4d79c9',
    warn: '門檻用掌握度不用答對次數，不然會變成狂刷簡單的字。' },
  { key: 'skill',   name: '技能', hue: '#8b5cc7',
    warn: '門檻是自己的進度，不跟同學比，不然拼字慢的永遠拿不到。' },
  { key: 'tower',   name: '守塔', hue: '#c4463c',
    warn: '大多數只要「做到一次」，不要求次數，不然會變成逼人重刷。' },
  { key: 'versus',  name: '對戰', hue: '#d8a331',
    warn: '綁「自己做了什麼」不綁「贏了誰」，輸的人也拿得到；打電腦不算勝場。' },
  { key: 'collect', name: '收集', hue: '#5a6274',
    warn: '綁種類不綁金額，沒有任何一個是「賺到幾千塊」。' },
  { key: 'habit',   name: '習慣', hue: '#47895f',
    warn: '用「這一週來了幾天」不用「連續幾天」，斷一天不歸零，不然等於懲罰請假的小孩。' },
  { key: 'secret',  name: '彩蛋', hue: '#c05a9b',
    warn: '不給提示、數量少，而且要有安慰獎——不擅長讀書的小孩也要有東西可拿。' },
]

export const CATEGORY_NAME: Record<AchCategory, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c.name])) as Record<AchCategory, string>

export interface AchDef {
  id: string
  category: AchCategory
  name: string
  /** 拿到之後顯示的說明 */
  desc: string
  /** 還沒拿到時顯示的提示。彩蛋類沒有——看得到路才想拿，但彩蛋要是驚喜。 */
  hint?: string
  /** 彩蛋：牆上顯示成問號，名字都不給 */
  secret?: true
  /** 解開的外框（商店買不到的那六個） */
  rewardItem?: string
  /** 解開的稱號，別在暱稱旁邊 */
  rewardTitle?: string
}

export const ACHIEVEMENTS: AchDef[] = [
  // ---------------------------------------------------------------- 學習
  { id: 'first-answer', category: 'learn', name: '第一題',
    desc: '答對第一題。', hint: '答對一題就有了', rewardTitle: '新生' },
  { id: 'hundred', category: 'learn', name: '百題',
    desc: '累計答對一百題。', hint: '累計答對一百題' },
  { id: 'nemesis', category: 'learn', name: '死對頭',
    desc: '把一個錯過三次以上的字，練到連對三次。',
    hint: '把一個常錯的字練到連對三次', rewardTitle: '不放棄' },
  { id: 'theme-king', category: 'learn', name: '主題王',
    desc: '五個主題的字全部答對過。', hint: '把五個主題的字全部答對過' },
  { id: 'mastered-50', category: 'learn', name: '熟練五十',
    desc: '五十個字達到「熟」（連對三次）。', hint: '五十個字連對三次' },
  { id: 'literate', category: 'learn', name: '識字者',
    desc: '三百個字全部答對過至少一次。', hint: '每一個字都至少答對過一次',
    rewardItem: 'frame-laurel' },

  // ---------------------------------------------------------------- 技能
  { id: 'read-100', category: 'skill', name: '看得懂',
    desc: '認字答對一百題。', hint: '認字答對一百題' },
  { id: 'listen-100', category: 'skill', name: '聽得出',
    desc: '聽音答對一百題。', hint: '聽音答對一百題' },
  { id: 'spell-100', category: 'skill', name: '拼得出',
    desc: '拼字答對一百題。', hint: '拼字答對一百題' },
  { id: 'triple-day', category: 'skill', name: '三修生',
    desc: '同一天三種技能都玩過。', hint: '同一天認字、聽音、拼字都玩過' },
  { id: 'long-words', category: 'skill', name: '長字挑戰',
    desc: '拼對八個字母以上的字十次。', hint: '拼對八個字母以上的長字十次' },
  { id: 'balanced', category: 'skill', name: '均衡',
    desc: '三種技能各有五十個字達到「熟」。', hint: '三種技能各熟五十個字',
    rewardItem: 'frame-wave' },

  // ---------------------------------------------------------------- 守塔
  { id: 'first-clear', category: 'tower', name: '初戰',
    desc: '通關第一關。', hint: '通關任何一關' },
  { id: 'three-star', category: 'tower', name: '滿星',
    desc: '任何一關拿到三顆星。', hint: '一關拿到三顆星' },
  { id: 'no-damage', category: 'tower', name: '城牆不倒',
    desc: '城堡一滴血都沒掉就通關。', hint: '城堡一滴血都沒掉就通關' },
  { id: 'boss-slayer', category: 'tower', name: '屠魔',
    desc: '三個魔王關都通關。', hint: '三個魔王關都通關' },
  { id: 'stars-30', category: 'tower', name: '星星三十',
    desc: '累計三十顆星。', hint: '累計三十顆星（滿分四十二）' },
  { id: 'all-clear', category: 'tower', name: '全破',
    desc: '十四關全部通關。', hint: '十四關全部通關', rewardItem: 'frame-flame' },

  // ---------------------------------------------------------------- 對戰
  { id: 'first-match', category: 'versus', name: '初上戰場',
    desc: '打完第一場兵推。', hint: '打完一場兵推' },
  { id: 'all-lines', category: 'versus', name: '三線通吃',
    desc: '同一場裡三條兵種線都派過兵。', hint: '同一場裡三條兵種線都派過兵' },
  { id: 'top-tier', category: 'versus', name: '頂階降臨',
    desc: '推出三階兵：字母將軍、音闇神射或拼字戰神。', hint: '在戰場上推出一隻三階兵' },
  { id: 'comeback', category: 'versus', name: '逆轉勝',
    desc: '前線被推進自己半場，最後還是贏了。', hint: '被推進自己半場之後還贏回來' },
  { id: 'never-quit', category: 'versus', name: '不服輸',
    desc: '連輸兩場之後又開了一場。', hint: '連輸兩場之後再開一場',
    rewardTitle: '再來一局' },
  { id: 'war-flag', category: 'versus', name: '戰旗',
    desc: '贏過同學五場。', hint: '贏過同學五場（打電腦不算）', rewardItem: 'frame-banner' },

  // ---------------------------------------------------------------- 收集
  { id: 'dressed', category: 'collect', name: '換裝',
    desc: '第一次穿上外框。', hint: '在商店買一個外框穿上' },
  { id: 'five-colors', category: 'collect', name: '五色軍團',
    desc: '紅黃紫黑四個陣營顏色都買齊（藍軍本來就有）。', hint: '把四個陣營顏色都買齊' },
  { id: 'all-frames', category: 'collect', name: '框框控',
    desc: '商店的四個外框都買齊。', hint: '把商店的四個外框都買齊' },
  { id: 'avatar-10', category: 'collect', name: '換頭像',
    desc: '換過十種頭像。', hint: '換過十種頭像' },
  { id: 'dual-job', category: 'collect', name: '雙修',
    desc: '騎士和法師都用來通關過。', hint: '兩個職業都用來通關過',
    rewardItem: 'frame-stardust' },
  { id: 'item-taster', category: 'collect', name: '道具三味',
    desc: '寒霜陷阱、城牆修補、水晶補給三種都用過。', hint: '三種道具都用過' },

  // ---------------------------------------------------------------- 習慣
  { id: 'week-3', category: 'habit', name: '一週三天',
    desc: '同一週裡有三天玩過。', hint: '同一週玩三天' },
  { id: 'weekend', category: 'habit', name: '週末戰士',
    desc: '週六或週日也玩過。', hint: '週末也來玩一次' },
  { id: 'replay', category: 'habit', name: '回鍋',
    desc: '回頭重玩已經通關的關卡。', hint: '回頭重玩一關已經通關的關卡' },
  { id: 'month-12', category: 'habit', name: '月曆十二',
    desc: '同一個月裡玩過十二天。', hint: '同一個月玩十二天，不用連續' },
  { id: 'old-friend', category: 'habit', name: '老朋友',
    desc: '註冊滿三十天而且還在玩。', hint: '註冊滿三十天而且還在玩' },
  { id: 'week-5', category: 'habit', name: '天天見',
    desc: '同一週裡有五天玩過。', hint: '同一週玩五天', rewardItem: 'frame-calendar' },

  // ---------------------------------------------------------------- 彩蛋
  { id: 'persistent', category: 'secret', name: '不死心', secret: true,
    desc: '同一個字錯過五次之後，終於答對。' },
  { id: 'quick-hand', category: 'secret', name: '快手', secret: true,
    desc: '十秒內連對五題。' },
  { id: 'so-close', category: 'secret', name: '差一點', secret: true,
    desc: '魔王關答對八成以上，還是被破城了。安慰獎。' },
  { id: 'bare-handed', category: 'secret', name: '空手過關', secret: true,
    desc: '一整關沒用任何道具就通關。' },
  { id: 'combo-20', category: 'secret', name: '連對二十', secret: true,
    desc: '同一場裡連對二十題。' },
  { id: 'all-rounder', category: 'secret', name: '全能生', secret: true,
    desc: '七個大類每一類都至少拿到一個徽章。', rewardTitle: '全能生' },
]

export const ACH_BY_ID: Map<string, AchDef> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))

/** 某一類的徽章，牆上的順序就是這個順序。 */
export function achievementsOf(cat: AchCategory): AchDef[] {
  return ACHIEVEMENTS.filter((a) => a.category === cat)
}

/** 稱號清單：拿到對應徽章才選得起來。 */
export const TITLES: { id: string; title: string }[] =
  ACHIEVEMENTS.filter((a) => a.rewardTitle).map((a) => ({ id: a.id, title: a.rewardTitle! }))
