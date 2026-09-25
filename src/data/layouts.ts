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
 * **十四關一關一張。** 之前是三張輪流用，玩起來每一關都一樣。佈局是十幾組座標，
 * 是這個遊戲裡最便宜的變化來源——外觀要畫圖很貴，佈局不用。
 *
 * 難度不用手調：血量與怪速是 levels.ts 從這裡的路長與塔位涵蓋數回推的，
 * 所以換一張圖就是換一種打法，但「每分鐘要答對幾題」這個目標不會跑掉。
 * 改完一定要跑 `node tools/test/layout-geom.mjs`，它會抓路走進海裡、
 * 塔蓋在路上、塔位離每條路都太遠這些用眼睛看不出來的事。
 *
 * 座標系：畫布 1088×576，一格 64px。陸地是第 1~7 列（y 64~512）。
 * 城堡固定在右邊 (994, 320)，每條路的終點都要走到它腳下。
 */

/** 路的起點。要離畫面夠遠，開場的隊伍才排得下。 */
export const ENTRY = -300

/** 城堡位置。每張圖都一樣，怪才知道要往哪裡去。 */
const CASTLE = { x: 994, y: 320 }

// ── 第 1~5 關：把基本盤教完（兩條路 → 分岔 → 長路 → 三條路）

/** 1 數字島：兩條筆直的路，中間兩塊高地。最好上手的一張，原型驗證過的版本。 */
export const islandTwin: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [
    { c0: 2, c1: 4, r0: 4, r1: 5 },
    { c0: 7, c1: 10, r0: 4, r1: 5 },
  ],
  paths: [
    [{ x: ENTRY, y: 230 }, { x: 818, y: 230 }, { x: 908, y: 258 }, { x: 948, y: 276 }],
    [{ x: ENTRY, y: 424 }, { x: 818, y: 424 }, { x: 908, y: 306 }, { x: 948, y: 280 }],
  ],
  castle: CASTLE,
  slots: [
    { x: 176, y: 310, hi: true }, { x: 288, y: 310, hi: true },
    { x: 496, y: 310, hi: true }, { x: 616, y: 310, hi: true },
    { x: 380, y: 146 }, { x: 840, y: 170 },
    { x: 380, y: 502 }, { x: 800, y: 502 },
  ],
  decor: [
    { k: 'tree1', x: 52, y: 150 }, { k: 'tree2', x: 212, y: 138 },
    { k: 'tree1', x: 600, y: 146 }, { k: 'tree2', x: 700, y: 168 },
    { k: 'tree1', x: 1010, y: 158 }, { k: 'tree2', x: 896, y: 140 },
    { k: 'tree1', x: 128, y: 508 }, { k: 'tree2', x: 560, y: 512 },
    { k: 'rock1', x: 312, y: 176 }, { k: 'rock3', x: 492, y: 172 },
    { k: 'rock2', x: 60, y: 478 }, { k: 'rock4', x: 452, y: 502 },
  ],
}

/** 2 顏色與身體：一條直、一條彎。同時進場但不同時到，第一次學到「兩條路不一樣快」。 */
export const zigzag: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 5, c1: 8, r0: 4, r1: 5 }],
  paths: [
    [{ x: ENTRY, y: 200 }, { x: 830, y: 200 }, { x: 918, y: 250 }, { x: 948, y: 276 }],
    [
      { x: ENTRY, y: 400 }, { x: 180, y: 400 }, { x: 300, y: 470 },
      { x: 520, y: 470 }, { x: 660, y: 400 }, { x: 870, y: 400 },
      { x: 934, y: 340 }, { x: 948, y: 284 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 380, y: 310, hi: true }, { x: 510, y: 310, hi: true },
    { x: 150, y: 300 }, { x: 780, y: 300 },
    { x: 240, y: 110 }, { x: 560, y: 110 }, { x: 800, y: 110 },
    { x: 150, y: 490 },
  ],
  decor: [
    { k: 'tree1', x: 70, y: 130 }, { k: 'tree2', x: 400, y: 120 },
    { k: 'tree1', x: 660, y: 120 }, { k: 'tree2', x: 990, y: 150 },
    { k: 'rock1', x: 330, y: 130 }, { k: 'rock3', x: 900, y: 120 },
    { k: 'tree1', x: 400, y: 560 }, { k: 'rock2', x: 700, y: 545 },
  ],
}

/** 3 動物森林：一條很長的 S 形路。時間最充裕，但塔要放在轉角才划算。 */
export const forestS: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 6, c1: 8, r0: 4, r1: 5 }],
  paths: [
    [
      { x: ENTRY, y: 140 }, { x: 300, y: 140 }, { x: 300, y: 430 },
      { x: 620, y: 430 }, { x: 620, y: 180 }, { x: 880, y: 180 },
      { x: 930, y: 250 }, { x: 948, y: 278 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 420, y: 310, hi: true }, { x: 530, y: 310, hi: true },
    { x: 190, y: 310 }, { x: 470, y: 130 },
    { x: 760, y: 300 }, { x: 860, y: 400 },
    { x: 150, y: 480 }, { x: 820, y: 96 },
  ],
  decor: [
    { k: 'tree1', x: 70, y: 300 }, { k: 'tree2', x: 140, y: 210 },
    { k: 'tree1', x: 420, y: 500 }, { k: 'tree2', x: 700, y: 340 },
    { k: 'tree1', x: 1020, y: 180 }, { k: 'tree2', x: 990, y: 470 },
    { k: 'rock1', x: 230, y: 520 }, { k: 'rock3', x: 540, y: 100 },
    { k: 'rock2', x: 700, y: 520 }, { k: 'rock4', x: 380, y: 250 },
  ],
}

/** 4 食物與餐具：一條路走到一半分兩邊。前半段的塔打得到全部，後半段只能顧一邊。 */
export const fork: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 9, c1: 12, r0: 4, r1: 5 }],
  paths: [
    [
      { x: ENTRY, y: 300 }, { x: 420, y: 300 }, { x: 560, y: 160 },
      { x: 860, y: 160 }, { x: 934, y: 246 }, { x: 948, y: 276 },
    ],
    [
      { x: ENTRY, y: 300 }, { x: 420, y: 300 }, { x: 560, y: 450 },
      { x: 860, y: 450 }, { x: 934, y: 356 }, { x: 948, y: 284 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 640, y: 310, hi: true }, { x: 800, y: 310, hi: true },
    { x: 150, y: 176 }, { x: 320, y: 176 },
    { x: 150, y: 424 }, { x: 320, y: 424 },
    { x: 690, y: 90 }, { x: 690, y: 510 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 100 }, { k: 'tree2', x: 240, y: 96 },
    { k: 'tree1', x: 60, y: 500 }, { k: 'tree2', x: 240, y: 505 },
    { k: 'rock1', x: 440, y: 120 }, { k: 'rock3', x: 440, y: 500 },
    { k: 'rock2', x: 1010, y: 130 }, { k: 'rock4', x: 1010, y: 490 },
  ],
}

/** 5 衣櫃魔王：三條路同時湧入，路短、時間緊。魔王關要一眼認得出不一樣。 */
export const tripleRush: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [],
  paths: [
    [{ x: ENTRY, y: 150 }, { x: 800, y: 150 }, { x: 910, y: 250 }, { x: 948, y: 276 }],
    [{ x: ENTRY, y: 300 }, { x: 880, y: 300 }, { x: 948, y: 278 }],
    [{ x: ENTRY, y: 450 }, { x: 800, y: 450 }, { x: 910, y: 316 }, { x: 948, y: 282 }],
  ],
  castle: CASTLE,
  slots: [
    { x: 220, y: 226 }, { x: 430, y: 226 }, { x: 640, y: 226 },
    { x: 220, y: 376 }, { x: 430, y: 376 }, { x: 640, y: 376 },
    { x: 780, y: 220 }, { x: 810, y: 508 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 96 }, { k: 'tree2', x: 330, y: 92 },
    { k: 'tree1', x: 620, y: 545 }, { k: 'tree2', x: 120, y: 545 },
    { k: 'rock1', x: 980, y: 140 }, { k: 'rock3', x: 1000, y: 470 },
    { k: 'rock2', x: 520, y: 96 },
  ],
}

// ── 第 6~10 關：同樣的零件開始疊，路變長、轉角變多

/** 6 我家：一條路繞著屋子轉一圈再進門。最長的一條路之一，轉角特別多。 */
export const homeLoop: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 6, c1: 9, r0: 5, r1: 6 }],
  paths: [
    [
      { x: ENTRY, y: 110 }, { x: 700, y: 110 }, { x: 790, y: 200 },
      { x: 700, y: 290 }, { x: 240, y: 290 }, { x: 160, y: 380 },
      { x: 240, y: 470 }, { x: 820, y: 470 }, { x: 930, y: 380 },
      { x: 948, y: 286 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 450, y: 380, hi: true }, { x: 570, y: 380, hi: true },
    { x: 400, y: 200 }, { x: 620, y: 200 },
    { x: 150, y: 200 }, { x: 960, y: 150 },
    { x: 160, y: 490 }, { x: 830, y: 330 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 460 }, { k: 'tree2', x: 330, y: 380 },
    { k: 'tree1', x: 760, y: 380 }, { k: 'tree2', x: 1020, y: 460 },
    { k: 'rock1', x: 520, y: 200 }, { k: 'rock3', x: 60, y: 300 },
    { k: 'rock2', x: 1010, y: 300 },
  ],
}

/** 7 學校：兩條路夾一條長高地。整條走廊都在塔的火網裡，但只有這麼一塊地可以蓋。 */
export const corridor: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 3, c1: 12, r0: 4, r1: 5 }],
  paths: [
    [{ x: ENTRY, y: 210 }, { x: 830, y: 210 }, { x: 920, y: 250 }, { x: 948, y: 276 }],
    [{ x: ENTRY, y: 410 }, { x: 830, y: 410 }, { x: 920, y: 340 }, { x: 948, y: 284 }],
  ],
  castle: CASTLE,
  slots: [
    { x: 230, y: 310, hi: true }, { x: 320, y: 310, hi: true },
    { x: 410, y: 310, hi: true }, { x: 500, y: 310, hi: true },
    { x: 590, y: 310, hi: true },
    { x: 780, y: 310, hi: true }, { x: 420, y: 96 }, { x: 420, y: 505 },
  ],
  decor: [
    { k: 'tree1', x: 70, y: 96 }, { k: 'tree2', x: 620, y: 92 },
    { k: 'tree1', x: 240, y: 545 }, { k: 'tree2', x: 760, y: 540 },
    { k: 'rock1', x: 990, y: 130 }, { k: 'rock3', x: 1000, y: 480 },
  ],
}

/** 8 出門去：兩條路交叉。塔放在交叉點一次顧兩條，但那裡怪最多。 */
export const crossroads: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 2, c1: 4, r0: 4, r1: 5 }],
  paths: [
    [{ x: ENTRY, y: 150 }, { x: 420, y: 150 }, { x: 700, y: 450 }, { x: 880, y: 450 }, { x: 944, y: 356 }, { x: 948, y: 284 }],
    [{ x: ENTRY, y: 450 }, { x: 420, y: 450 }, { x: 700, y: 150 }, { x: 880, y: 150 }, { x: 944, y: 244 }, { x: 948, y: 276 }],
  ],
  castle: CASTLE,
  slots: [
    { x: 176, y: 310, hi: true }, { x: 288, y: 310, hi: true },
    { x: 560, y: 190 }, { x: 560, y: 410 },
    { x: 400, y: 300 }, { x: 800, y: 300 },
    { x: 620, y: 90 }, { x: 620, y: 510 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 300 }, { k: 'tree2', x: 460, y: 300 },
    { k: 'tree1', x: 990, y: 110 }, { k: 'tree2', x: 990, y: 500 },
    { k: 'rock1', x: 300, y: 90 }, { k: 'rock3', x: 300, y: 510 },
  ],
}

/** 9 運動與職業：兩個髮夾彎，來回折三趟。路長、轉角多，塔要卡在折返點才划算。 */
export const hairpin: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 13, c1: 14, r0: 2, r1: 3 }],
  paths: [
    [
      { x: ENTRY, y: 140 }, { x: 700, y: 140 }, { x: 790, y: 215 },
      { x: 700, y: 290 }, { x: 220, y: 290 }, { x: 140, y: 365 },
      { x: 220, y: 440 }, { x: 820, y: 440 }, { x: 930, y: 370 },
      { x: 948, y: 286 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 870, y: 180, hi: true }, { x: 945, y: 180, hi: true },
    { x: 300, y: 215 }, { x: 450, y: 215 }, { x: 600, y: 215 },
    { x: 300, y: 365 }, { x: 450, y: 365 }, { x: 760, y: 360 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 215 }, { k: 'tree2', x: 60, y: 365 },
    { k: 'tree1', x: 1020, y: 400 }, { k: 'rock1', x: 500, y: 540 },
    { k: 'rock3', x: 1020, y: 500 },
  ],
}

/** 10 暴風雨魔王：三條路從三個方向斜著撲過來，路最短、時間最緊。 */
export const stormTriple: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [],
  paths: [
    [{ x: ENTRY, y: 96 }, { x: 560, y: 96 }, { x: 900, y: 250 }, { x: 948, y: 276 }],
    [{ x: ENTRY, y: 300 }, { x: 900, y: 300 }, { x: 948, y: 278 }],
    [{ x: ENTRY, y: 504 }, { x: 560, y: 504 }, { x: 900, y: 348 }, { x: 948, y: 284 }],
  ],
  castle: CASTLE,
  slots: [
    { x: 200, y: 198 }, { x: 420, y: 190 }, { x: 700, y: 225 },
    { x: 200, y: 402 }, { x: 420, y: 410 }, { x: 700, y: 375 },
    { x: 870, y: 160 }, { x: 830, y: 490 },
  ],
  decor: [
    { k: 'rock1', x: 60, y: 196 }, { k: 'rock3', x: 60, y: 404 },
    { k: 'rock2', x: 500, y: 198 }, { k: 'rock4', x: 500, y: 402 },
    { k: 'tree1', x: 1020, y: 150 }, { k: 'tree2', x: 1020, y: 470 },
  ],
}

// ── 第 11~14 關：路最長、塔最擠，最後一關把三條路和長路合在一起

/** 11 心情：兩條路各自繞一圈，一邊快一邊慢，中間隔著高地互相看不到。 */
export const twinLoops: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 7, c1: 9, r0: 4, r1: 5 }],
  paths: [
    [
      { x: ENTRY, y: 110 }, { x: 360, y: 110 }, { x: 360, y: 220 },
      { x: 700, y: 220 }, { x: 700, y: 120 }, { x: 880, y: 120 },
      { x: 940, y: 220 }, { x: 948, y: 276 },
    ],
    [
      { x: ENTRY, y: 490 }, { x: 300, y: 490 }, { x: 300, y: 390 },
      { x: 620, y: 390 }, { x: 620, y: 490 }, { x: 880, y: 490 },
      { x: 940, y: 390 }, { x: 948, y: 284 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 496, y: 310, hi: true }, { x: 610, y: 310, hi: true },
    { x: 180, y: 300 }, { x: 800, y: 300 },
    { x: 500, y: 120 }, { x: 750, y: 390 },
    { x: 760, y: 230 }, { x: 180, y: 400 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 300 }, { k: 'tree2', x: 330, y: 300 },
    { k: 'tree1', x: 1020, y: 110 }, { k: 'tree2', x: 1020, y: 500 },
    { k: 'rock1', x: 800, y: 420 }, { k: 'rock3', x: 800, y: 190 },
  ],
}

/** 12 動起來：像梳子一樣上下折六趟。路很長，塔可以一次罩住兩根梳齒。 */
export const switchback: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [],
  paths: [
    [
      { x: ENTRY, y: 300 }, { x: 140, y: 300 }, { x: 140, y: 110 },
      { x: 300, y: 110 }, { x: 300, y: 490 }, { x: 460, y: 490 },
      { x: 460, y: 110 }, { x: 620, y: 110 }, { x: 620, y: 490 },
      { x: 780, y: 490 }, { x: 780, y: 180 }, { x: 900, y: 240 },
      { x: 948, y: 278 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 220, y: 200 }, { x: 380, y: 200 }, { x: 540, y: 200 }, { x: 700, y: 200 },
    { x: 220, y: 400 }, { x: 380, y: 400 }, { x: 540, y: 400 }, { x: 840, y: 390 },
  ],
  decor: [
    { k: 'rock1', x: 60, y: 150 }, { k: 'rock3', x: 60, y: 450 },
    { k: 'rock2', x: 1000, y: 150 }, { k: 'rock4', x: 1000, y: 450 },
    { k: 'tree1', x: 880, y: 470 },
  ],
}

/** 13 時間之塔：兩條路像時針分針繞著中央那座高地轉。塔全擠在中間，射程剛好罩得到一圈。 */
export const clockTower: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 6, c1: 9, r0: 3, r1: 5 }],
  paths: [
    [
      { x: ENTRY, y: 145 }, { x: 760, y: 145 }, { x: 860, y: 215 },
      { x: 860, y: 300 }, { x: 930, y: 300 }, { x: 948, y: 278 },
    ],
    [
      { x: ENTRY, y: 455 }, { x: 760, y: 455 }, { x: 860, y: 385 },
      { x: 860, y: 340 }, { x: 930, y: 320 }, { x: 948, y: 284 },
    ],
  ],
  castle: CASTLE,
  slots: [
    { x: 420, y: 300, hi: true }, { x: 530, y: 310, hi: true },
    { x: 620, y: 310, hi: true }, { x: 200, y: 300 },
    { x: 200, y: 215 }, { x: 200, y: 385 },
    { x: 700, y: 215 }, { x: 780, y: 360 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 300 }, { k: 'tree2', x: 330, y: 215 },
    { k: 'tree1', x: 330, y: 385 }, { k: 'tree2', x: 1020, y: 145 },
    { k: 'rock1', x: 1020, y: 455 }, { k: 'rock3', x: 60, y: 215 },
  ],
}

/** 14 最終試煉：三條路，而且中間那條繞了一大圈。前面十三關的東西全在這裡。 */
export const finalTrial: Layout = {
  land: { r0: 1, r1: 7 },
  plateaus: [{ c0: 6, c1: 8, r0: 4, r1: 5 }],
  paths: [
    [{ x: ENTRY, y: 96 }, { x: 820, y: 96 }, { x: 920, y: 210 }, { x: 948, y: 276 }],
    [
      { x: ENTRY, y: 300 }, { x: 240, y: 300 }, { x: 240, y: 216 },
      { x: 700, y: 216 }, { x: 700, y: 400 }, { x: 880, y: 400 },
      { x: 940, y: 340 }, { x: 948, y: 280 },
    ],
    [{ x: ENTRY, y: 480 }, { x: 820, y: 480 }, { x: 920, y: 366 }, { x: 948, y: 284 }],
  ],
  castle: CASTLE,
  slots: [
    { x: 440, y: 310, hi: true }, { x: 520, y: 310, hi: true },
    { x: 330, y: 156 }, { x: 620, y: 156 },
    { x: 130, y: 200 }, { x: 890, y: 500 },
    { x: 800, y: 260 }, { x: 560, y: 400 },
  ],
  decor: [
    { k: 'tree1', x: 60, y: 156 }, { k: 'tree2', x: 200, y: 400 },
    { k: 'tree1', x: 980, y: 160 }, { k: 'tree2', x: 980, y: 420 },
    { k: 'rock1', x: 400, y: 545 }, { k: 'rock3', x: 700, y: 545 },
  ],
}

const BASE = {
  islandTwin, zigzag, forestS, fork, tripleRush,
  homeLoop, corridor, crossroads, hairpin, stormTriple,
  twinLoops, switchback, clockTower, finalTrial,
}

/**
 * 上下翻過來的同一張圖（第二、三章用）。
 *
 * 八十五關不可能一關畫一張，所以後兩章拿第一章的圖上下翻、再換地形和城堡。
 * **為什麼只翻上下不翻左右**：城堡固定在右邊、怪從左邊進場，左右翻要連引擎一起改。
 * 上下翻是繞陸地的中線（y＝288）鏡射；城堡跟著翻到 y＝256，路的終點還是走到它腳下。
 * 塔位涵蓋數、路長都不變，所以怪血怪速跟原圖幾乎一樣（layout-geom 會印出來對）。
 * 高地、塔位、裝飾物都一起翻；高地的列數也要翻（第 r 列 → 第 8−r 列）。
 */
export function mirrorY(L: Layout): Layout {
  const MID2 = (L.land.r0 + L.land.r1 + 1) * 64 // 陸地上緣＋下緣
  const fy = (y: number) => MID2 - y
  const fr = (r: number) => L.land.r0 + L.land.r1 - r
  return {
    land: L.land,
    plateaus: L.plateaus.map((p) => ({ c0: p.c0, c1: p.c1, r0: fr(p.r1), r1: fr(p.r0) })),
    paths: L.paths.map((pts) => pts.map((q) => ({ x: q.x, y: fy(q.y) }))),
    castle: { x: L.castle.x, y: fy(L.castle.y) },
    // 塔是從腳下往上 20px 的地方放箭，怪的中心在腳下往上 22px；翻過來之後這 2px 的差
    // 會變成反方向，塔位再往上挪 4px 才跟原圖的射程涵蓋一模一樣。
    // 挪了會壓到路（離路心不到 56px）或掉出陸地的那幾個就不挪。
    slots: L.slots.map((q) => {
      const y = fy(q.y) - 4
      const paths = L.paths.map((pts) => pts.map((p) => ({ x: p.x, y: fy(p.y) })))
      const ok = y >= L.land.r0 * 64 && paths.every((pts) => distToPolyline({ x: q.x, y }, pts) >= 56)
      return { ...q, y: ok ? y : fy(q.y) }
    }),
    decor: L.decor.map((d) => ({ ...d, y: fy(d.y) })),
  }
}

function distToPolyline(p: { x: number; y: number }, pts: { x: number; y: number }[]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy))
  }
  return best
}

type BaseName = keyof typeof BASE
const MIRRORED = Object.fromEntries(
  Object.entries(BASE).map(([k, L]) => [k + 'M', mirrorY(L)]),
) as Record<`${BaseName}M`, Layout>

export const LAYOUTS = { ...BASE, ...MIRRORED }
export type LayoutName = keyof typeof LAYOUTS
