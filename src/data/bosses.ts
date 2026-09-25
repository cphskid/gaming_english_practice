import type { Word } from '@/core/types'
import { WORDS } from './words'
import ART from './raid-art.json'

/**
 * 魔王團戰的魔王：四級共 20 隻（2026-09-25 Chuck 定案，取代原本十隻只考核心 300 字）。
 *
 * **四級照「字的層級」分，不照強度分**，剛好對上守塔三章：
 *   普通 5 隻：核心 300 字（第一章），一隻約 60 字，一開始就能打
 *   稀有 5 隻：基本 1,200 剩下的 900 字（第二章），一隻約 180 字，第二章全破才能打
 *   傳說 5 隻：其他常用 800 字（第三章），一隻約 160 字，第三章全破才能打
 *   神話 5 隻：一大類主題的三層字全部混考（一隻約 400 字），半血會變身（見 raid.ts 的 enrage），
 *             第三章全破才能打
 * 「過完那章才能打」是 Chuck 要的「守塔和團戰互相推進」；伺服器 open_raid／join_room 也會擋
 * （shop_items.need_chapter，見 gen-shop-seed.mjs）。
 *
 * **每一級的五隻各守一大類主題**（CATS）：家與生活、人物、學校與節慶、城市與世界、自然與時間。
 * 動詞、名詞、形容詞、介系詞這些不屬於哪一類的字（GENERAL），照比例平均分給五隻，
 * 讓五隻的字數差不多——不然「自然」那隻會比「城市」那隻多一倍的字。
 * 分法完全從題庫算，**字數不要寫死**：題庫再調，每隻考的字會自己跟著變。
 *
 * 選魔王的畫面一樣不寫難度，寫「這隻的字你認得幾成」（熟悉度）。
 * 數值只跟「幾個人一起打」有關（games/boss-raid/raid.ts），只有神話多一個半血變身。
 *
 * 圖：普通、稀有十隻是 chierit（CC-BY 4.0）與 LuizMelo（CC0），可放公開 repo；
 * 傳說、神話十隻是 admurin、xzany、oliveiramiro2、darkpixel-kronovi 的免費素材，
 * **可商用但禁止散布**，只放私有 repo（tools/private-assets.sh 放回來）。
 * 背景是 ansimuz（CC0）。切圖見 tools/build-raid-art.py，授權見 CREDITS.md。
 */

export interface BossArt {
  /** 每格多寬多高（原圖像素，遊戲裡再放大） */
  w: number
  h: number
  /** 腳底在格子裡的高度 */
  foot: number
  /** 身體中心的 x */
  cx: number
  /** 每個動作幾格。沒有的動作（牛頭人免費版沒有受傷和倒下）由引擎自己補效果。 */
  anims: Partial<Record<'idle' | 'attack' | 'hurt' | 'death', number>>
}

export interface BossDef {
  id: string
  name: string
  /** 名牌上那一句 */
  tagline: string
  /** 哪一級 */
  tier: BossTier
  /** 守哪一大類主題（CATS） */
  cat: CatId
  /** 戰場背景（public/raid/bg/<bg>.png） */
  bg: string
  /** 畫在戰場上放大幾倍 */
  scale: number
  /** 主色，名牌、血條、外框用 */
  color: string
  /** 第一次打倒它拿到的外框（商店買不到） */
  frame: string
  art: BossArt
}

const art = ART as Record<string, BossArt>

export type BossTier = 'normal' | 'rare' | 'legend' | 'myth'

export const TIERS: { id: BossTier; name: string; words: string; chapter: number | null }[] = [
  { id: 'normal', name: '普通', words: '核心 300 字', chapter: null },
  { id: 'rare', name: '稀有', words: '第二章的字', chapter: 2 },
  { id: 'legend', name: '傳說', words: '第三章的字', chapter: 3 },
  { id: 'myth', name: '神話', words: '三章的字混在一起', chapter: 3 },
]

/** 要把第幾章全部打過才能打（null＝一開始就能打） */
export function needChapter(b: BossDef): number | null {
  return TIERS.find((t) => t.id === b.tier)!.chapter
}

/** 這一級考題庫的第幾層（神話三層都考） */
const WORD_TIER: Record<BossTier, number[]> = { normal: [1], rare: [2], legend: [3], myth: [1, 2, 3] }

export type CatId = 'home' | 'people' | 'school' | 'world' | 'nature'

/** 五大類。每一級的五隻各守一類。 */
export const CATS: { id: CatId; name: string; themes: string[] }[] = [
  { id: 'home', name: '家與生活', themes: ['food', 'tableware', 'house', 'clothing', 'money', 'health'] },
  { id: 'people', name: '人物', themes: ['family', 'jobs', 'body', 'feelings', 'people', 'traits'] },
  { id: 'school', name: '學校與節慶', themes: ['school', 'sports', 'holidays', 'colors'] },
  { id: 'world', name: '城市與世界', themes: ['places', 'transportation', 'countries', 'geography', 'numbers'] },
  { id: 'nature', name: '自然與時間', themes: ['animals', 'weather', 'time', 'sizes'] },
]

// 名字、主色、背景。id 是舊的就沿用（打倒紀錄、外框都掛在 id 上，舊紀錄一個都不能掉）。
export const BOSSES: BossDef[] = [
  // ---------------------------------------------------------------- 普通（核心 300）
  { id: 'worm', tier: 'normal', cat: 'home', name: '火焰巨蟲', tagline: '把廚房和衣櫃吃光光的大蟲',
    bg: 'caves', scale: 3.4, color: '#e0632e', frame: 'frame-boss-worm', art: art.worm },
  { id: 'king', tier: 'normal', cat: 'people', name: '暴君國王', tagline: '把大家的家人都抓去當僕人',
    bg: 'town', scale: 3.0, color: '#b0433f', frame: 'frame-boss-king', art: art.king },
  { id: 'wizard', tier: 'normal', cat: 'school', name: '邪惡巫師', tagline: '把學校變成了墓園',
    bg: 'cemetery', scale: 3.4, color: '#d24a3a', frame: 'frame-boss-wizard', art: art.wizard },
  { id: 'mimic', tier: 'normal', cat: 'world', name: '寶箱怪', tagline: '會咬人的寶箱，專吃數字和路牌',
    bg: 'grotto', scale: 4.2, color: '#c9894a', frame: 'frame-boss-mimic', art: art.mimic },
  { id: 'minotaur', tier: 'normal', cat: 'nature', name: '牛頭人', tagline: '森林裡最兇的傢伙，看守動物和天氣',
    bg: 'forest', scale: 2.3, color: '#a0643c', frame: 'frame-boss-minotaur', art: art.minotaur },
  // ---------------------------------------------------------------- 稀有（第二章）
  { id: 'demon', tier: 'rare', cat: 'home', name: '惡魔史萊姆', tagline: '黏在家裡每個角落，趕都趕不走',
    bg: 'fungus', scale: 2.3, color: '#d0562a', frame: 'frame-boss-demon', art: art.demon },
  { id: 'shadow', tier: 'rare', cat: 'people', name: '暗影法師', tagline: '把大家的心情都變成黑的',
    bg: 'crystal', scale: 2.0, color: '#7a4fb0', frame: 'frame-boss-shadow', art: art.shadow },
  { id: 'lich', tier: 'rare', cat: 'school', name: '骷髏術士', tagline: '偷走了所有的課本和節日',
    bg: 'dusk', scale: 3.6, color: '#8fa0c0', frame: 'frame-boss-lich', art: art.lich },
  { id: 'cthulhu', tier: 'rare', cat: 'world', name: '深海克蘇魯', tagline: '從海底爬上來，擋住所有的路',
    bg: 'sea', scale: 2.8, color: '#3f9a6a', frame: 'frame-boss-cthulhu', art: art.cthulhu },
  { id: 'frost', tier: 'rare', cat: 'nature', name: '寒冰守衛', tagline: '把天氣和時間都凍住了',
    bg: 'cliffs', scale: 2.3, color: '#4aa3d8', frame: 'frame-boss-frost', art: art.frost },
  // ---------------------------------------------------------------- 傳說（第三章）
  { id: 'badger', tier: 'legend', cat: 'home', name: '蜜獾大王', tagline: '闖進每一家的廚房，什麼都不怕',
    bg: 'forest', scale: 2.6, color: '#d8c24a', frame: 'frame-boss-badger', art: art.badger },
  { id: 'gorilla', tier: 'legend', cat: 'people', name: '大猩猩', tagline: '一拳就能把人嚇跑',
    bg: 'caves', scale: 3.5, color: '#9a4a3a', frame: 'frame-boss-gorilla', art: art.gorilla },
  { id: 'frog', tier: 'legend', cat: 'school', name: '青蛙將軍', tagline: '舌頭一伸，把課本全吞下去',
    bg: 'fungus', scale: 3.3, color: '#4fa04a', frame: 'frame-boss-frog', art: art.frog },
  { id: 'penguin', tier: 'legend', cat: 'world', name: '企鵝老大', tagline: '戴墨鏡的老大，整座城都歸牠管',
    bg: 'cliffs', scale: 2.3, color: '#5a7ab8', frame: 'frame-boss-penguin', art: art.penguin },
  { id: 'rex', tier: 'legend', cat: 'nature', name: '暴龍', tagline: '戴著生日帽，脾氣可一點都不可愛',
    bg: 'grotto', scale: 2.5, color: '#5ab8c8', frame: 'frame-boss-rex', art: art.rex },
  // ---------------------------------------------------------------- 神話（三層混考、半血變身）
  { id: 'golem', tier: 'myth', cat: 'home', name: '機械石魔像', tagline: '整座城堡的石頭都聽牠的',
    bg: 'grotto', scale: 4.8, color: '#40c8d8', frame: 'frame-boss-golem', art: art.golem },
  { id: 'reaper', tier: 'myth', cat: 'people', name: '亡靈處刑者', tagline: '鐮刀一揮，名字就被忘掉',
    bg: 'cemetery', scale: 4.0, color: '#6a6a7a', frame: 'frame-boss-reaper', art: art.reaper },
  { id: 'skelwiz', tier: 'myth', cat: 'school', name: '骷髏巫師', tagline: '把三章的字全部裝進水晶球',
    bg: 'dusk', scale: 2.2, color: '#6a5ad8', frame: 'frame-boss-skelwiz', art: art.skelwiz },
  { id: 'winged', tier: 'myth', cat: 'world', name: '翼魔', tagline: '翅膀一張，整個世界都暗了',
    bg: 'crystal', scale: 3.0, color: '#d05aa0', frame: 'frame-boss-winged', art: art.winged },
  { id: 'flydemon', tier: 'myth', cat: 'nature', name: '飛天惡魔', tagline: '從天上把暴風雨帶下來',
    bg: 'town', scale: 3.4, color: '#e03a2a', frame: 'frame-boss-flydemon', art: art.flydemon },
]

export const BOSS_BY_ID: Map<string, BossDef> = new Map(BOSSES.map((b) => [b.id, b]))

/**
 * 每一層字分給五大類：主題在某一類的就歸那一類；GENERAL（動詞、名詞、形容詞…）
 * 照「離平均還差多少」的比例分，同一個主題的字會平均散到五隻，不會整包丟給同一隻。
 */
function splitTier(tier: number): Map<CatId, Word[]> {
  const words = WORDS.filter((w) => w.tier === tier)
  const out = new Map<CatId, Word[]>(CATS.map((c) => [c.id, []]))
  const catOf = new Map<string, CatId>()
  for (const c of CATS) for (const t of c.themes) catOf.set(t, c.id)
  const general: Word[] = []
  for (const w of words) {
    const c = catOf.get(w.theme)
    if (c) out.get(c)!.push(w); else general.push(w)
  }
  const target = words.length / CATS.length
  const quota = CATS.map((c) => Math.max(1, target - out.get(c.id)!.length))
  const got = CATS.map(() => 0)
  general.sort((a, b) => (a.theme < b.theme ? -1 : a.theme > b.theme ? 1 : a.id - b.id))
  for (const w of general) {
    let k = 0
    for (let i = 1; i < CATS.length; i++) if ((got[i] + 1) / quota[i] < (got[k] + 1) / quota[k]) k = i
    got[k]++
    out.get(CATS[k].id)!.push(w)
  }
  return out
}

const SPLIT = new Map([1, 2, 3].map((t) => [t, splitTier(t)]))
const WORDS_OF = new Map<string, Word[]>(BOSSES.map((b) => [
  b.id,
  WORD_TIER[b.tier].flatMap((t) => SPLIT.get(t)!.get(b.cat)!).sort((x, y) => x.id - y.id),
]))

export function bossWords(b: BossDef): Word[] {
  return WORDS_OF.get(b.id) ?? []
}

/** 選魔王的格子寫「考什麼」：大類＋哪一層的字 */
export function bossTopic(b: BossDef): string {
  return CATS.find((c) => c.id === b.cat)!.name + '・' + TIERS.find((t) => t.id === b.tier)!.words
}

/** 素材在 public/raid/ 底下的網址 */
export function raidUrl(path: string): string {
  return `${import.meta.env.BASE_URL}raid/${path}`.replace(/\/{2,}/g, '/')
}
