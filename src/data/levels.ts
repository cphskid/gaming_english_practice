import type { Layout, LevelData, WaveSpec } from '@/core/types'
import { FOCUS_MAX, FOCUS_STEP, TOWERS } from './towers'
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

type Pt = { x: number; y: number }

/** 一條路的總長，含畫面外那一段（怪實際要走的距離）。 */
function pathLength(pts: Pt[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return L
}

/**
 * 沿著路取樣，只留下在畫面內的點。
 *
 * 路的起點刻意拉到畫面外很遠（讓開場的怪排得開），但**畫面外那一段不能算進難度**：
 * 那裡沒有塔打得到，玩家也看不到，算進去會把速度和塔位涵蓋率都算錯。
 */
function visiblePoints(pts: Pt[], step = 8): Pt[] {
  const out: Pt[] = []
  const len = pathLength(pts)
  for (let d = 0; d < len; d += step) {
    const p = pointAtDist(pts, d)
    if (p.x >= 0) out.push(p)
  }
  return out
}

/** 路在畫面內有多長。這才是「每題有多少秒可以想」，是最有效的難度旋鈕。 */
function visibleLength(pts: Pt[], step = 8): number {
  return visiblePoints(pts, step).length * step
}

/**
 * 這張佈局「一次齊射打得出多少傷害」。
 *
 * 不能寫死。同樣八個塔位，兩條路的圖大部分路段有三座塔打得到，
 * 三條路的圖塔被拉開，通常只有兩座打得到——血量寫死的話，
 * 三條路的關卡就會變成完全打不動。所以沿著路取樣，算涵蓋到的塔數中位數。
 */
function volleyOf(layout: Layout): number {
  const counts: number[] = []
  for (const pts of layout.paths) {
    // 只看畫面內的路段，畫面外沒有塔打得到，算進去會把傷害低估
    const pv = visiblePoints(pts, 20)
    for (const p of pv) {
      let n = 0
      for (const s of layout.slots) {
        if (Math.hypot(s.x - p.x, s.y - 20 - (p.y - 22)) <= TOWERS.archery.range) n++
      }
      counts.push(n)
    }
  }
  counts.sort((a, b) => a - b)
  const median = counts[Math.floor(counts.length / 2)] || 1
  const focus = 1 + FOCUS_STEP * Math.min(FOCUS_MAX, Math.max(0, median - 1))
  return Math.max(TOWERS.archery.damage, Math.round(median * TOWERS.archery.damage * focus))
}

function pointAtDist(pts: { x: number; y: number }[], dist: number): { x: number; y: number } {
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (dist <= seg) {
      const t = seg ? dist / seg : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    dist -= seg
  }
  return pts[pts.length - 1]
}

/**
 * 難度＝**每分鐘要答對幾題**，其他數字都是從這個目標回推的。
 *
 * 這是第二次試玩「難度感覺不到變化」的正解。當時的做法是把血量往上加，
 * 但三座塔集火一次剛好 76 傷害＝第五波的血量，所以每一波都是答對一次就死，
 * 血量成長整個被集火加成吃光，實際負荷從 7 秒一題只變成 5.6 秒一題。
 *
 * 現在反過來算：
 *   1. 訂這一關每分鐘要答對幾題（第 1 關 12 題，第 14 關 25 題）
 *   2. 訂一隻怪要答對幾次才會死，血量直接等於那麼多次齊射
 *   3. 出怪間隔＝餵飽那個答題速率所需的間隔
 *   4. 速度＝路的長度除以「希望怪在畫面上待幾秒」
 *
 * 驗證用 tools/test/play-td.mjs，不是手感。
 */
function waves(waveCount: number, d: number, pathLen: number, volley: number): WaveSpec[] {
  const rate = 11 + d                                   // 目標：每分鐘答對幾題
  const hits = d <= 4 ? 1 : d <= 9 ? 2 : 3              // 一隻怪要答對幾次才會死
  const gap = (60 / rate) * hits                        // 出怪間隔
  const onScreen = Math.max(14, 24 - d * 0.6)           // 怪在畫面上待幾秒
  const speed = Math.round(pathLen / onScreen)

  const out: WaveSpec[] = []
  for (let i = 0; i < waveCount; i++) {
    const waveSeconds = 24 + d * 1.5 + i * 4
    out.push({
      count: Math.max(3, Math.min(10, Math.round(waveSeconds / gap))),
      hp: Math.round(volley * hits * 0.95 + i * volley * 0.08),
      speed,
      gap: +gap.toFixed(1),
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
  const layout = LAYOUTS[s.layout]
  // 用最短的一條路算，怪走最短那條時也要有合理的時間
  // 速度用「畫面內的長度」回推，怪在畫面上待多久才是玩家真正感受到的時間
  const pathLen = Math.min(...layout.paths.map((p) => visibleLength(p)))
  const volley = volleyOf(layout)
  return {
    id: `td-${String(no).padStart(2, '0')}`,
    no,
    name: s.name,
    themes: s.themes,
    // 主題本身就帶難度，所以字級不再另外限制
    maxWordLevel: 3,
    isBoss: !!s.boss,
    skin: { tileset: s.tileset ?? tilesetFor(no) },
    layout,
    rules: {
      castleHp: s.boss ? 15 : 20,
      startCoins: 120 + Math.floor(no / 3) * 20,
      waves: waves(s.waveCount, no, pathLen, volley),
      boss: s.boss
        // 魔王要六次齊射才倒，單塔絕對打不動，一定要集火
        ? { hp: volley * 6, speed: Math.round(pathLen / 26), art: 'goblinPurple', scale: 1.6 }
        : undefined,
    },
  }
})

export const LEVEL_IDS: string[] = LEVELS.map((l) => l.id)

export function levelById(id: string): LevelData | undefined {
  return LEVELS.find((l) => l.id === id)
}
