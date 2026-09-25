/**
 * 成就：五十三格徽章，八個大類，其中二十六格分五階（2026-09-24 第二版，2026-09-25 加魔王剋星與合作類）。
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

export type AchCategory = 'learn' | 'skill' | 'tower' | 'versus' | 'coop' | 'collect' | 'habit' | 'secret'

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
  // 2026-09-25 Chuck 跟女兒要的：讓大家多跟不同的人玩。「全班都組過」拿掉了——
  // 只要有一個同學從來不玩，其他人就永遠拿不到，「全班」怎麼定義都有人吃虧。
  { key: 'coop',    name: '合作', hue: '#2f8f9d',
    warn: '數「不同的人」要門檻低、上限不超過一班人數；中途離開的那場不算，不然進房就走可以刷人數。' },
  { key: 'collect', name: '收集', hue: '#5a6274',
    warn: '綁種類不綁金額，沒有任何一個是「賺到幾千塊」。' },
  { key: 'habit',   name: '習慣', hue: '#47895f',
    warn: '用「這一週來了幾天」不用「連續幾天」，斷一天不歸零，不然等於懲罰請假的小孩。' },
  { key: 'secret',  name: '彩蛋', hue: '#c05a9b',
    warn: '不給提示、數量少，而且要有安慰獎——不擅長讀書的小孩也要有東西可拿。' },
]

export const CATEGORY_NAME: Record<AchCategory, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c.name])) as Record<AchCategory, string>

/** 五階的名字。一次性的徽章沒有階級，只有「拿到／沒拿到」。 */
export const TIER_NAMES = ['銅', '銀', '金', '白金', '鑽石'] as const

/**
 * 門檻裡的「全部」。題庫會從 300 字長到兩千字，「三百個字全部答對過」寫死 300
 * 的話，加字那天就變成一個誰都能拿的鑽石。所以最後一階寫「全部」，由伺服器照
 * 當下的題庫（字數、關卡數）去算那是多少。前面幾階是固定數字，題庫大很多之後
 * 要回來調高——只加不刪，已經拿到的階級不會因為調門檻掉下來。
 */
export const ALL = -1

export interface AchDef {
  id: string
  category: AchCategory
  name: string
  /**
   * 拿到之後顯示的說明。分階徽章寫成樣板，`{n}` 換成那一階的門檻。
   */
  desc: string
  /** 還沒拿到（或還沒到下一階）時顯示的提示，`{n}` 一樣是下一階的門檻。彩蛋類沒有。 */
  hint?: string
  /** 彩蛋：牆上顯示成問號，名字都不給 */
  secret?: true
  /**
   * 分階門檻，由低到高，一律五階（銅銀金白金鑽石）。沒有這個欄位的是一次性徽章。
   * **拿到就一路往上升，牆上還是一格。** 升階永遠不會降回去。
   */
  tiers?: number[]
  /** 解開的外框（商店買不到的那六個） */
  rewardItem?: string
  /** 解開的稱號，別在暱稱旁邊 */
  rewardTitle?: string
  /** 分階徽章要到第幾階才給獎品。預設 1。 */
  rewardTier?: number
}

// 答對次數類都算「有效答對」：**同一個字一天最多算 5 次**。一萬題除以三百字，
// 每個字平均也要答對三十幾次，一天五次擋得住狂刷一個簡單的字，正常玩完全碰不到。
const CAP = '（同一個字一天最多算 5 次）'

export const ACHIEVEMENTS: AchDef[] = [
  // ---------------------------------------------------------------- 學習
  { id: 'first-answer', category: 'learn', name: '第一題',
    desc: '答對第一題。', hint: '答對一題就有了', rewardTitle: '新生' },
  { id: 'hundred', category: 'learn', name: '萬題',
    tiers: [100, 500, 1000, 3000, 10000],
    desc: '累計答對 {n} 題' + CAP + '。', hint: '累計答對 {n} 題' },
  { id: 'nemesis', category: 'learn', name: '死對頭',
    tiers: [1, 5, 15, 30, 60],
    desc: '把 {n} 個錯過三次以上的字，練到連對三次。',
    hint: '把 {n} 個常錯的字練到連對三次', rewardTitle: '不放棄' },
  { id: 'theme-king', category: 'learn', name: '主題王',
    tiers: [3, 8, 15, 25, ALL],
    desc: '{n} 個主題的字全部答對過。', hint: '把 {n} 個主題的字全部答對過' },
  // 「500 字、750 字」題庫裝不下，所以算「字 × 技能」：同一個字認得、聽得出、
  // 拼得出分開算。300 字是 300＋300＋180（要拼的）＝780 組。
  { id: 'mastered-50', category: 'learn', name: '精通',
    tiers: [100, 500, 1500, 3000, ALL],
    desc: '{n} 組「字 × 技能」練到熟（連對三次）。',
    hint: '{n} 組「字 × 技能」練到熟——認字、聽音、拼字分開算' },
  { id: 'literate', category: 'learn', name: '識字者',
    tiers: [100, 300, 800, 1500, ALL],
    desc: '{n} 個不同的字答對過。', hint: '{n} 個不同的字至少答對過一次',
    rewardItem: 'frame-laurel', rewardTier: 5 },

  // ---------------------------------------------------------------- 技能
  { id: 'read-100', category: 'skill', name: '看得懂',
    tiers: [100, 300, 1000, 2000, 5000],
    desc: '認字答對 {n} 題' + CAP + '。', hint: '認字答對 {n} 題' },
  { id: 'listen-100', category: 'skill', name: '聽得出',
    tiers: [100, 300, 1000, 2000, 5000],
    desc: '聽音答對 {n} 題' + CAP + '。', hint: '聽音答對 {n} 題' },
  { id: 'spell-100', category: 'skill', name: '拼得出',
    tiers: [100, 300, 1000, 2000, 5000],
    desc: '拼字答對 {n} 題' + CAP + '。', hint: '拼字答對 {n} 題' },
  { id: 'triple-day', category: 'skill', name: '三修生',
    tiers: [1, 5, 15, 30, 60],
    desc: '有 {n} 天是認字、聽音、拼字三種都玩過。', hint: '{n} 天裡三種技能都玩過' },
  { id: 'long-words', category: 'skill', name: '長字挑戰',
    tiers: [10, 30, 80, 150, 300],
    desc: '拼對八個字母以上的字 {n} 次' + CAP + '。', hint: '拼對八個字母以上的長字 {n} 次' },
  { id: 'balanced', category: 'skill', name: '均衡',
    tiers: [30, 100, 300, 500, ALL],
    desc: '三種技能各有 {n} 個字練到熟。', hint: '三種技能各熟 {n} 個字',
    rewardItem: 'frame-wave', rewardTier: 2 },
  { id: 'combo', category: 'skill', name: '連對',
    tiers: [10, 20, 30, 40, 50],
    desc: '同一場裡連對 {n} 題。', hint: '同一場裡連對 {n} 題' },

  // ---------------------------------------------------------------- 守塔
  { id: 'first-clear', category: 'tower', name: '初戰',
    desc: '通關第一關。', hint: '通關任何一關' },
  { id: 'three-star', category: 'tower', name: '滿星',
    tiers: [1, 5, 15, 30, ALL],
    desc: '{n} 關拿到三顆星。', hint: '{n} 關拿到三顆星' },
  { id: 'no-damage', category: 'tower', name: '城牆不倒',
    tiers: [1, 5, 15, 30, ALL],
    desc: '{n} 關城堡一滴血都沒掉就通關。', hint: '{n} 關城堡一滴血都沒掉就通關' },
  // 2026-09-25 擴成八十五關：本來是「三個魔王關都過」的一次性徽章，改成分階。
  // 舊的已經拿到的學生（第一章三個魔王都過了）直接就是銅階，不會掉。
  { id: 'boss-slayer', category: 'tower', name: '屠魔',
    tiers: [3, 6, 10, 14, ALL],
    desc: '{n} 個魔王關通關。', hint: '{n} 個魔王關通關' },
  { id: 'stars-30', category: 'tower', name: '星星',
    tiers: [10, 40, 100, 160, ALL],
    desc: '累計 {n} 顆星。', hint: '累計 {n} 顆星' },
  // 一章一個全破徽章，各給一個外框，第三章的最稀有（2026-09-25）。
  // 第一章沿用舊 id，已經拿到火焰框的人不受影響。
  { id: 'all-clear', category: 'tower', name: '全破・第一章',
    desc: '第一章草地城堡的關卡全部通關。', hint: '第一章的關卡全部通關', rewardItem: 'frame-flame' },
  { id: 'all-clear-2', category: 'tower', name: '全破・第二章',
    desc: '第二章雪地神殿的關卡全部通關。', hint: '第二章的關卡全部通關', rewardItem: 'frame-frost' },
  { id: 'all-clear-3', category: 'tower', name: '全破・第三章',
    desc: '第三章草原木堡的關卡全部通關。兩千字全部走過一遍。', hint: '第三章的關卡全部通關',
    rewardItem: 'frame-legend', rewardTitle: '兩千字勇者' },

  // ---------------------------------------------------------------- 對戰
  { id: 'first-match', category: 'versus', name: '初上戰場',
    desc: '打完第一場兵推。', hint: '打完一場兵推' },
  { id: 'veteran', category: 'versus', name: '戰場老兵',
    tiers: [5, 20, 50, 100, 200],
    desc: '打完 {n} 場兵推，輸贏都算。', hint: '打完 {n} 場兵推，輸贏都算' },
  { id: 'all-lines', category: 'versus', name: '三線通吃',
    desc: '同一場裡三條兵種線都派過兵。', hint: '同一場裡三條兵種線都派過兵' },
  { id: 'top-tier', category: 'versus', name: '頂階降臨',
    tiers: [1, 5, 15, 30, 60],
    desc: '{n} 場裡推出過三階兵：字母將軍、音闇神射或拼字戰神。',
    hint: '{n} 場裡推出過三階兵' },
  { id: 'comeback', category: 'versus', name: '逆轉勝',
    tiers: [1, 3, 10, 20, 40],
    desc: '前線被推進自己半場，最後還是贏了，{n} 場。', hint: '被推進自己半場之後還贏回來 {n} 場' },
  { id: 'never-quit', category: 'versus', name: '不服輸',
    desc: '連輸兩場之後又開了一場。', hint: '連輸兩場之後再開一場',
    rewardTitle: '再來一局' },
  { id: 'war-flag', category: 'versus', name: '戰旗',
    tiers: [5, 15, 40, 80, 150],
    desc: '贏過同學 {n} 場。', hint: '贏過同學 {n} 場（打電腦不算）', rewardItem: 'frame-banner' },

  // ---------------------------------------------------------------- 合作
  // 團戰「打完」＝待到最後有回報結果；中途斷線或按離開的那場一律不算（見 schema.sql）。
  { id: 'first-live', category: 'coop', name: '初次交手',
    desc: '第一次跟同學真人對戰，打完一場。', hint: '跟同學真人對戰一場（打分身、打電腦不算）' },
  { id: 'live-mates', category: 'coop', name: '交手',
    tiers: [3, 5, 10, 15, 20],
    desc: '跟 {n} 位不同的同學真人對戰過。', hint: '跟 {n} 位不同的同學真人對戰，輸贏都算' },
  // 魔王團戰（2026-09-25）。數的是「幾隻不同的」不是「幾次」：同一隻打一百次不會升階，
  // 要去找別的主題的魔王——等於鼓勵把每一組主題的字都練到。
  { id: 'raid-slayer', category: 'coop', name: '魔王剋星',
    tiers: [1, 3, 5, 8, ALL],
    desc: '跟同學組隊打倒過 {n} 隻不同的魔王。', hint: '在魔王團戰打倒 {n} 隻不同的魔王' },
  { id: 'raid-wins', category: 'coop', name: '並肩作戰',
    tiers: [1, 5, 15, 30, 60],
    desc: '魔王團戰打贏 {n} 場。', hint: '魔王團戰打贏 {n} 場' },
  { id: 'big-team', category: 'coop', name: '人多力量大',
    tiers: [1, 3, 10, 20, 40],
    desc: '在四個人以上的團打贏 {n} 場魔王。', hint: '揪四個人以上打贏 {n} 場魔王' },
  { id: 'raid-mates', category: 'coop', name: '廣結善緣',
    tiers: [3, 5, 10, 15, 20],
    desc: '跟 {n} 位不同的同學一起打完魔王團戰。', hint: '跟 {n} 位不同的同學一起打完魔王團戰，輸贏都算' },

  // ---------------------------------------------------------------- 收集
  { id: 'dressed', category: 'collect', name: '換裝',
    desc: '第一次穿上外框。', hint: '在商店買一個外框穿上' },
  { id: 'five-colors', category: 'collect', name: '五色軍團',
    desc: '藍紅黃紫黑五個陣營顏色，每一色都穿上打過一場。',
    hint: '在「我的角色」換顏色，五色各打一場（守塔或對戰都算）' },
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
  { id: 'days', category: 'habit', name: '百日',
    tiers: [7, 20, 40, 70, 100],
    desc: '總共來玩 {n} 天，不用連續。', hint: '總共來玩 {n} 天，不用連續' },
  { id: 'weekend', category: 'habit', name: '週末戰士',
    tiers: [1, 5, 15, 30, 50],
    desc: '{n} 個週六、週日來玩過。', hint: '週末來玩 {n} 天' },
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
    desc: '八個大類每一類都至少拿到一個徽章。', rewardTitle: '全能生' },
]

export const ACH_BY_ID: Map<string, AchDef> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))

/** 某一類的徽章，牆上的順序就是這個順序。 */
export function achievementsOf(cat: AchCategory): AchDef[] {
  return ACHIEVEMENTS.filter((a) => a.category === cat)
}

/** 稱號清單：拿到對應徽章才選得起來。 */
export const TITLES: { id: string; title: string }[] =
  ACHIEVEMENTS.filter((a) => a.rewardTitle).map((a) => ({ id: a.id, title: a.rewardTitle! }))

/** 這一階的門檻。`all` 是伺服器照當下題庫算出來的「全部」是多少。 */
export function tierGoal(def: AchDef, tier: number, all: number): number | null {
  const t = def.tiers?.[tier - 1]
  if (t === undefined) return null
  return t === ALL ? all : t
}

/** 把說明樣板裡的 `{n}` 換成數字。 */
export function fillN(text: string, n: number | null): string {
  return n === null ? text : text.replace('{n}', n.toLocaleString('en-US'))
}

/** 「萬題·金」。一次性的徽章只有名字。 */
export function badgeLabel(def: AchDef, tier: number): string {
  return def.tiers && tier > 0 ? `${def.name}·${TIER_NAMES[tier - 1]}` : def.name
}

/** refreshAchievements() 回來的一筆：'hundred:3' → { id: 'hundred', tier: 3 }，'first-clear' → tier 1。 */
export function parseUnlock(s: string): { id: string; tier: number } {
  const [id, t] = s.split(':')
  return { id, tier: t ? Number(t) || 1 : 1 }
}
