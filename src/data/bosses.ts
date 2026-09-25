import type { Word } from '@/core/types'
import { CORE_WORDS } from './words'
import ART from './raid-art.json'

/**
 * 魔王團戰的魔王（2026-09-25 Chuck 定案）。
 *
 * **魔王不標星等，一隻魔王守一組主題。** 星星在題庫擴到兩千字時會變成十幾星，
 * 而且數字越大越像在比誰厲害。改成：
 *   - 每隻魔王考的是它守的那幾個主題的字，難度自然跟著主題走
 *     （具體名詞在前、抽象的在後，跟十四關的順序是同一個道理）；
 *   - 選魔王的畫面不寫難度，寫「這隻的字你認得幾成」（熟悉度），
 *     組隊時看全隊平均——難度是看自己，不跟別人比。
 * 題庫長大、多出新主題，就在這裡多加一隻魔王，不用排名次。
 *
 * **每隻魔王的數值一樣**（血量、小兵、打人的力道），不同的只有考哪些字。
 * 數值只跟「幾個人一起打」有關，見 games/boss-raid/raid.ts。
 *
 * 圖：chierit（CC-BY 4.0，要署名）與 LuizMelo（CC0），背景是 ansimuz（CC0），
 * 切圖見 tools/build-raid-art.py，授權見 CREDITS.md。
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
  /** 考哪些主題的字。空陣列＝全部的字（最後那一隻）。 */
  themes: string[]
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

export const BOSSES: BossDef[] = [
  { id: 'mimic', name: '寶箱怪', tagline: '會咬人的寶箱，專吃數字和顏色',
    themes: ['numbers', 'colors'], bg: 'grotto', scale: 4.2, color: '#c9894a',
    frame: 'frame-boss-mimic', art: art.mimic },
  { id: 'minotaur', name: '牛頭人', tagline: '森林裡最兇的傢伙，看守動物和身體',
    themes: ['animals', 'body'], bg: 'forest', scale: 2.3, color: '#a0643c',
    frame: 'frame-boss-minotaur', art: art.minotaur },
  { id: 'worm', name: '火焰巨蟲', tagline: '把廚房吃光光的大蟲',
    themes: ['food', 'tableware'], bg: 'caves', scale: 3.4, color: '#e0632e',
    frame: 'frame-boss-worm', art: art.worm },
  { id: 'king', name: '暴君國王', tagline: '霸佔了大家的衣櫃和家',
    themes: ['clothing', 'house', 'family'], bg: 'town', scale: 3.0, color: '#b0433f',
    frame: 'frame-boss-king', art: art.king },
  { id: 'wizard', name: '邪惡巫師', tagline: '把學校變成了墓園',
    themes: ['school', 'jobs'], bg: 'cemetery', scale: 3.4, color: '#d24a3a',
    frame: 'frame-boss-wizard', art: art.wizard },
  { id: 'cthulhu', name: '深海克蘇魯', tagline: '從海底爬上來，擋住所有的路',
    themes: ['places', 'transportation', 'sports'], bg: 'sea', scale: 2.8, color: '#3f9a6a',
    frame: 'frame-boss-cthulhu', art: art.cthulhu },
  { id: 'demon', name: '惡魔史萊姆', tagline: '最愛亂動，也最愛問為什麼',
    themes: ['verbs', 'wh-words'], bg: 'fungus', scale: 2.3, color: '#d0562a',
    frame: 'frame-boss-demon', art: art.demon },
  { id: 'frost', name: '寒冰守衛', tagline: '把天氣和時間都凍住了',
    themes: ['weather', 'time'], bg: 'cliffs', scale: 2.3, color: '#4aa3d8',
    frame: 'frame-boss-frost', art: art.frost },
  { id: 'shadow', name: '暗影法師', tagline: '把大家的心情都變成黑的',
    themes: ['feelings', 'adjectives'], bg: 'crystal', scale: 2.0, color: '#7a4fb0',
    frame: 'frame-boss-shadow', art: art.shadow },
  { id: 'lich', name: '骷髏術士', tagline: '最後的魔王，三百個字全部都考',
    themes: [], bg: 'dusk', scale: 3.6, color: '#8fa0c0',
    frame: 'frame-boss-lich', art: art.lich },
]

export const BOSS_BY_ID: Map<string, BossDef> = new Map(BOSSES.map((b) => [b.id, b]))

export function bossWords(b: BossDef): Word[] {
  if (!b.themes.length) return CORE_WORDS
  return CORE_WORDS.filter((w) => b.themes.includes(w.theme))
}

/** 素材在 public/raid/ 底下的網址 */
export function raidUrl(path: string): string {
  return `${import.meta.env.BASE_URL}raid/${path}`.replace(/\/{2,}/g, '/')
}
