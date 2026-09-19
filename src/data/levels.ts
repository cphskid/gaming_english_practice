import type { LevelData, WaveSpec } from '@/core/types'
import { LAYOUTS, type LayoutName } from './layouts'

/**
 * 十四關，用 300 字全部。
 *
 * **關卡照主題切，不照年級。** 課綱附錄五沒有年級分類，但表三有官方的主題分類，
 * 而主題本身就帶難度：具體名詞（身體、動物、顏色、數字）LV1 很多，
 * 抽象主題（時間、動作、天氣、形容詞、感覺、職業、疑問詞）一個 LV1 的字都沒有。
 * 所以由具體排到抽象，難度漸進自然成立，不必另外設計。
 *
 * 小主題一定要合併，否則五波怪會讓同一個字出現四五次，變成背答案。門檻是一關至少 14 字。
 */

/**
 * 波次。難度旋鈕集中在這裡，調數字就好。
 * d 是關卡序號（1~14），i 是第幾波（0 起算）。
 */
function waves(count: number, d: number): WaveSpec[] {
  const out: WaveSpec[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      count: 3 + i + Math.floor(d / 4),
      hp: 18 + d * 6 + i * (8 + d),
      speed: 26 + d * 1.5 + i * 2,
      gap: Math.max(1.5, 3.2 - d * 0.1),
      art: i % 2 ? 'goblinPurple' : 'goblinRed',
    })
  }
  return out
}

interface LevelSeed {
  name: string
  themes: string[]
  layout: LayoutName
  waveCount: number
  boss?: boolean
  /** 外觀，每五關換一次配色 */
  tileset?: string
}

const SEEDS: LevelSeed[] = [
  { name: '數字島', themes: ['numbers'], layout: 'twinLanes', waveCount: 4 },
  { name: '顏色與身體', themes: ['colors', 'body'], layout: 'twinLanes', waveCount: 4 },
  { name: '動物森林', themes: ['animals'], layout: 'longRoad', waveCount: 4 },
  { name: '食物與餐具', themes: ['food', 'tableware'], layout: 'twinLanes', waveCount: 5 },
  { name: '衣櫃魔王', themes: ['clothing'], layout: 'triple', waveCount: 5, boss: true },

  { name: '我家', themes: ['house', 'family'], layout: 'twinLanes', waveCount: 5 },
  { name: '學校', themes: ['school'], layout: 'longRoad', waveCount: 5 },
  { name: '出門去', themes: ['places', 'transportation'], layout: 'twinLanes', waveCount: 5 },
  { name: '運動與職業', themes: ['sports', 'jobs'], layout: 'longRoad', waveCount: 5 },
  { name: '暴風雨魔王', themes: ['weather'], layout: 'triple', waveCount: 6, boss: true },

  { name: '心情', themes: ['feelings', 'adjectives'], layout: 'twinLanes', waveCount: 6 },
  { name: '動起來', themes: ['verbs'], layout: 'longRoad', waveCount: 6 },
  { name: '時間之塔', themes: ['time'], layout: 'twinLanes', waveCount: 6 },
  { name: '最終試煉', themes: [], layout: 'triple', waveCount: 7, boss: true },
]

/** 外觀每五關換一次，佈局每一關可以不同——外觀貴、佈局便宜 */
function tilesetFor(no: number): string {
  if (no <= 5) return 'color1'
  if (no <= 10) return 'color3'
  return 'color4'
}

export const LEVELS: LevelData[] = SEEDS.map((s, i) => {
  const no = i + 1
  return {
    id: `td-${String(no).padStart(2, '0')}`,
    no,
    name: s.name,
    themes: s.themes,
    // 主題本身就帶難度，所以字級不再另外限制
    maxWordLevel: 3,
    isBoss: !!s.boss,
    skin: { tileset: s.tileset ?? tilesetFor(no) },
    layout: LAYOUTS[s.layout],
    rules: {
      castleHp: s.boss ? 15 : 20,
      startCoins: 120 + Math.floor(no / 3) * 20,
      waves: waves(s.waveCount, no),
      boss: s.boss
        ? { hp: 220 + no * 40, speed: 22 + no, art: 'goblinPurple', scale: 1.6 }
        : undefined,
    },
  }
})

export const LEVEL_IDS: string[] = LEVELS.map((l) => l.id)

export function levelById(id: string): LevelData | undefined {
  return LEVELS.find((l) => l.id === id)
}
