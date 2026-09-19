import type { Layout } from '@/core/types'

/**
 * 佈局＝這一關要怎麼打，是玩法真正的來源；外觀只是皮。
 *
 * 每條路的第一點都在畫面外很遠（x = ENTRY），這樣開場那幾隻怪才能前後排開
 * 依序走進來，而不是全部疊在同一格上——疊在一起會看起來像一隻怪掛了兩個字牌。
 *
 * 可調的旋鈕：路的條數、**路的長度（＝每題可用秒數，最有效的難度旋鈕）**、
 * 高地多寡（能不能吃集火加成）、塔位數量（預算壓力）。
 *
 * 目前三種佈局輪用。十四關各有自己的佈局是目標，但座標要一關一關調，
 * 先讓關卡結構跑起來，佈局之後補。
 */

/** 兩條路，中間兩塊高地。原型驗證過的版本，最好上手。 */
/** 路的起點。要離畫面夠遠，開場的隊伍才排得下。 */
export const ENTRY = -300

const TOP_Y = 230
const BOT_Y = 424

export const twinLanes: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [
    { c0: 2, c1: 4, r0: 4, r1: 5 },
    { c0: 7, c1: 10, r0: 4, r1: 5 },
  ],
  paths: [
    [{ x: ENTRY, y: TOP_Y }, { x: 818, y: TOP_Y }, { x: 908, y: 258 }, { x: 948, y: 276 }],
    [{ x: ENTRY, y: BOT_Y }, { x: 818, y: BOT_Y }, { x: 908, y: 306 }, { x: 948, y: 280 }],
  ],
  castle: { x: 994, y: 320 },
  slots: [
    { x: 176, y: 310, hi: true }, { x: 288, y: 310, hi: true },
    { x: 496, y: 310, hi: true }, { x: 616, y: 310, hi: true },
    { x: 380, y: 186 }, { x: 800, y: 186 },
    { x: 380, y: 500 }, { x: 800, y: 500 },
  ],
  decor: [
    { k: 'tree1', x: 52, y: 150 }, { k: 'tree2', x: 212, y: 138 },
    { k: 'tree1', x: 600, y: 146 }, { k: 'tree2', x: 700, y: 168 },
    { k: 'tree1', x: 1010, y: 158 }, { k: 'tree2', x: 896, y: 140 },
    { k: 'tree1', x: 128, y: 508 }, { k: 'tree2', x: 560, y: 512 },
    { k: 'tree1', x: 940, y: 508 }, { k: 'tree2', x: 700, y: 498 },
    { k: 'rock1', x: 312, y: 176 }, { k: 'rock3', x: 492, y: 172 },
    { k: 'rock2', x: 60, y: 478 }, { k: 'rock4', x: 452, y: 502 },
    { k: 'rock1', x: 1040, y: 470 }, { k: 'rock3', x: 238, y: 470 },
    { k: 'rock2', x: 884, y: 474 },
  ],
}

/** 一條很長的 S 形路。時間最充裕，但塔要放在轉角才划算。 */
export const longRoad: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 6, c1: 8, r0: 4, r1: 5 }],
  paths: [
    [
      { x: ENTRY, y: 140 }, { x: 300, y: 140 }, { x: 300, y: 430 },
      { x: 620, y: 430 }, { x: 620, y: 180 }, { x: 880, y: 180 },
      { x: 930, y: 250 }, { x: 948, y: 278 },
    ],
  ],
  castle: { x: 994, y: 320 },
  slots: [
    { x: 420, y: 310, hi: true }, { x: 530, y: 310, hi: true },
    { x: 190, y: 300 }, { x: 470, y: 130 },
    { x: 760, y: 300 }, { x: 860, y: 400 },
    { x: 150, y: 480 }, { x: 820, y: 100 },
  ],
  decor: [
    { k: 'tree1', x: 70, y: 300 }, { k: 'tree2', x: 140, y: 210 },
    { k: 'tree1', x: 420, y: 500 }, { k: 'tree2', x: 720, y: 330 },
    { k: 'tree1', x: 1020, y: 180 }, { k: 'tree2', x: 990, y: 470 },
    { k: 'rock1', x: 230, y: 520 }, { k: 'rock3', x: 540, y: 100 },
    { k: 'rock2', x: 700, y: 520 }, { k: 'rock4', x: 380, y: 250 },
  ],
}

/** 三條路同時湧入，路短、時間緊。魔王關用，一眼就認得出不一樣。 */
export const triple: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [],
  paths: [
    [{ x: ENTRY, y: 150 }, { x: 800, y: 150 }, { x: 910, y: 250 }, { x: 948, y: 276 }],
    [{ x: ENTRY, y: 300 }, { x: 880, y: 300 }, { x: 948, y: 278 }],
    [{ x: ENTRY, y: 450 }, { x: 800, y: 450 }, { x: 910, y: 316 }, { x: 948, y: 282 }],
  ],
  castle: { x: 994, y: 320 },
  slots: [
    { x: 220, y: 226, hi: true }, { x: 430, y: 226, hi: true }, { x: 640, y: 226, hi: true },
    { x: 220, y: 376, hi: true }, { x: 430, y: 376, hi: true }, { x: 640, y: 376, hi: true },
    { x: 810, y: 90 }, { x: 810, y: 520 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 96 }, { k: 'tree2', x: 330, y: 92 },
    { k: 'tree1', x: 620, y: 545 }, { k: 'tree2', x: 120, y: 545 },
    { k: 'rock1', x: 980, y: 140 }, { k: 'rock3', x: 1000, y: 470 },
    { k: 'rock2', x: 520, y: 96 },
  ],
}

export const LAYOUTS = { twinLanes, longRoad, triple }
export type LayoutName = keyof typeof LAYOUTS
