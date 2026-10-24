import type { Layout } from '@/core/types'

/**
 * 樂園畫風（2026-10-10 改版第一步，試玩樣板）。
 *
 * Chuck 要把守護異世界改成 Kingdom Rush 的版面、時空冒險樂園的 Q 版黏土卡通畫風，
 * 規則一個都不動。這裡只管「長什麼樣子」：
 *
 * - 地圖不再用 64px 的格子貼圖，改成「一整片畫好的草地＋程式沿著原本的路線畫路」。
 *   路線、塔位、高地的座標全部照舊，所以怪速、血量、難度曲線一格都不用重算。
 * - 陸地的上下緣是彎的，下面露一圈泥土側面，跟樂園那幾座浮空島同一個樣子。
 * - 圖都是自產的（Gemini 3.1 Flash，提示詞與切圖在專案共用資料夾 art/guardian/），
 *   可以放在公開 repo，不用走私有素材那一套。
 *
 * 先只套第一章；第二、三章的雪地和乾草原還沒產圖，照舊用像素圖。
 */

/** 地形用到的圖：到了就要把地圖重畫一次（跟 art.ts 的 TERRAIN_KEYS 同一個用途） */
/** 程式畫地圖才用得到的圖。每關有畫好的底圖之後，只有底圖抓不到時才抓這些。 */
export const PARK_FALLBACK = new Set(['p-ground', 'p-road', 'p-sea', 'p-tree', 'p-pine', 'p-bush', 'p-boulders', 'p-rock', 'p-stump', 'p-flowers', 'p-pebbles', 'p-flag'])
/** 新畫風畫面要先抓的那一份：p- 開頭、但不含程式畫地圖用的 */
export const isParkKey = (k: string) => k.startsWith('p-') && !PARK_FALLBACK.has(k)

/**
 * 每關畫好的底圖（public/td-park/maps/<版面>.webp）。上下翻的版面（結尾 M）用同一張。
 * 第二、三章同一個版面另外畫雪地、草原各一張：<版面>-snow.webp、<版面>-meadow.webp（2026-10-11）。
 */
export function mapUrl(layoutName: string, tileset = ''): string {
  const suf = tileset === 'snow' || tileset === 'meadow' ? '-' + tileset : ''
  return `${import.meta.env.BASE_URL}td-park/maps/${layoutName.replace(/M$/, '')}${suf}.webp`.replace(/([^:])\/{2,}/g, '$1/')
}
const prefetched = new Map<string, HTMLImageElement>()
/** 先把某一關的底圖抓進瀏覽器快取：選關畫面閒著的時候、點開關卡卡片的那一刻 */
export function prefetchMap(level: { chapter: number; skin: { map?: string; tileset?: string } }) {
  if (!level.skin.map) return
  const u = mapUrl(level.skin.map, level.skin.tileset)
  if (prefetched.has(u)) return
  const im = new Image(); im.decoding = 'async'; im.src = u
  prefetched.set(u, im)
}
export const PARK_TERRAIN_KEYS = ['p-sea', 'p-ground', 'p-road']

/** 佈局裡的裝飾物鍵 → 新圖，以及畫多高（px，畫布座標） */
export const DECOR: Record<string, { k: string; h: number }> = {
  tree1: { k: 'p-tree', h: 74 },
  tree2: { k: 'p-pine', h: 84 },
  rock1: { k: 'p-boulders', h: 40 },
  rock2: { k: 'p-rock', h: 36 },
  rock3: { k: 'p-bush', h: 34 },
  rock4: { k: 'p-stump', h: 34 },
}

/**
 * 動作表（一條 6 格，見 art/guardian/cut.py）。anchor＝腳底中心在一格裡的哪裡（0~1），
 * 是從圖量出來的；角色在格子裡不是正中間，不對齊的話翻面時會左右跳。
 */
export const SPRITES: Record<string, { k: string; frames: number; anchor: number }> = {
  goblinRed: { k: 'p-goblin', frames: 6, anchor: 0.45 },
  goblinPurple: { k: 'p-ogre', frames: 6, anchor: 0.42 },
  // 第二章雪地（冰哥布林、雪怪）、第三章草原（鬣狗強盜、犀牛戰士）。鍵＝原本的 art 加 -snow / -meadow
  'goblinRed-snow': { k: 'p-goblin-snow', frames: 6, anchor: 0.4 },
  'goblinPurple-snow': { k: 'p-ogre-snow', frames: 6, anchor: 0.42 },
  'goblinRed-meadow': { k: 'p-goblin-meadow', frames: 6, anchor: 0.33 },
  'goblinPurple-meadow': { k: 'p-ogre-meadow', frames: 6, anchor: 0.56 },
  soldier: { k: 'p-soldier', frames: 6, anchor: 0.5 },
}

/** 一格動作畫到畫布上：x 是腳底中心、y 是腳底，h 是整格要畫多高。 */
export function drawFrame(
  c: CanvasRenderingContext2D, im: HTMLImageElement | HTMLCanvasElement, frames: number, anchor: number,
  f: number, x: number, y: number, h: number, flip: boolean,
) {
  const fw = im.width / frames
  const sc = h / im.height
  c.save()
  c.translate(x, y)
  if (flip) c.scale(-1, 1)
  c.drawImage(im, (f % frames) * fw, 0, fw, im.height, -anchor * fw * sc, -h, fw * sc, h)
  c.restore()
}

/** 同一張圖每次都撒在同樣的位置：用座標當種子的小亂數 */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** 點到折線的最短距離 */
function distToPath(x: number, y: number, pts: { x: number; y: number }[]) {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const dx = b.x - a.x, dy = b.y - a.y
    const L = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L))
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y))
  }
  return best
}

/**
 * 整張地圖畫在一張暫存畫布上（只畫一次）。圖還沒到就回傳 null，下一格再試。
 * 由下往上：海 → 陸地的泥土側面 → 沙邊 → 草地 → 高地 → 路 → 撒在地上的小花小草。
 */
export function buildParkTerrain(
  layout: Layout, img: Record<string, HTMLImageElement>, W: number, H: number,
): HTMLCanvasElement | null {
  const sea = img['p-sea'], ground = img['p-ground'], road = img['p-road']
  if (!ground?.complete || !road?.complete) return null
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')!

  // 海：樂園大門那張海面。只取中段，上面有天空和遠山、下緣有礁石，戰場上都不該出現
  if (sea?.complete) {
    g.drawImage(sea, 0, sea.height * 0.24, sea.width, sea.height * 0.58, 0, 0, W, H)
  } else { g.fillStyle = '#3fa9d6'; g.fillRect(0, 0, W, H) }

  // 陸地上下緣：幾個正弦波疊起來，彎得自然又每關都一樣
  const top = layout.land.r0 * 64, bot = (layout.land.r1 + 1) * 64
  const r = rng(layout.paths.length * 7919 + layout.slots.length * 104729)
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6]
  const edgeTop = (x: number) => top + 6 + Math.sin(x / 97 + ph[0]) * 7 + Math.sin(x / 41 + ph[1]) * 3
  const edgeBot = (x: number) => bot - 8 + Math.sin(x / 89 + ph[2]) * 7 + Math.sin(x / 37 + ph[3]) * 3
  const land = (dy: number) => {
    g.beginPath()
    g.moveTo(-10, edgeTop(-10) + dy)
    for (let x = -10; x <= W + 10; x += 8) g.lineTo(x, edgeTop(x) + dy)
    for (let x = W + 10; x >= -10; x -= 8) g.lineTo(x, edgeBot(x) + dy)
    g.closePath()
  }
  // 海面上的淺灘光暈
  g.save(); g.filter = 'blur(10px)'; g.fillStyle = 'rgba(190,240,255,.55)'; land(0); g.lineWidth = 34; g.strokeStyle = 'rgba(190,240,255,.5)'; g.stroke(); g.restore()
  // 泥土側面（往下錯開，只露出下緣那一圈）
  const earth = g.createLinearGradient(0, bot - 10, 0, bot + 30)
  earth.addColorStop(0, '#b7834f'); earth.addColorStop(1, '#7c5230')
  g.fillStyle = earth; land(24); g.fill()
  // 沙邊
  g.fillStyle = '#f0d9a0'; land(6); g.fill()
  // 草地
  // 草地貼圖是左右上下翻成的 2×2（接得起來），縮一半重複鋪，草葉才不會比怪還大；
  // 再蓋一層淡淡的草綠，畫面比較乾淨，怪和字牌才跳得出來
  const grass = g.createPattern(ground, 'repeat')!
  g.save(); land(0); g.clip()
  g.save(); g.scale(0.42, 0.42); g.fillStyle = grass; g.fillRect(0, 0, W / 0.42, H / 0.42); g.restore()
  g.fillStyle = 'rgba(150,205,80,.32)'; g.fillRect(0, 0, W, H)
  // 邊緣壓深一點，地面才有厚度
  const shade = g.createLinearGradient(0, top, 0, bot)
  shade.addColorStop(0, 'rgba(255,255,220,.18)'); shade.addColorStop(0.15, 'rgba(255,255,220,0)')
  shade.addColorStop(0.85, 'rgba(40,80,20,0)'); shade.addColorStop(1, 'rgba(40,80,20,.25)')
  g.fillStyle = shade; g.fillRect(0, top - 20, W, bot - top + 40)
  g.restore()

  // 高地：圓角的一塊台地，下面露石壁
  for (const p of layout.plateaus) {
    const x0 = p.c0 * 64 + 4, x1 = (p.c1 + 1) * 64 - 4, y0 = p.r0 * 64 + 2, y1 = (p.r1 + 1) * 64 - 6
    const rr = 26
    const box = (dy: number) => { g.beginPath(); g.roundRect(x0, y0 + dy, x1 - x0, y1 - y0, rr) }
    g.save(); g.filter = 'blur(6px)'; g.fillStyle = 'rgba(30,60,20,.35)'; box(20); g.fill(); g.restore()
    const wall = g.createLinearGradient(0, y1 - 20, 0, y1 + 16)
    wall.addColorStop(0, '#c9a77a'); wall.addColorStop(1, '#8d6a45')
    g.fillStyle = wall; box(14); g.fill()
    g.save(); box(0); g.clip()
    g.save(); g.scale(0.42, 0.42); g.fillStyle = grass; g.fillRect(0, 0, W / 0.42, H / 0.42); g.restore()
    g.fillStyle = 'rgba(190,230,110,.45)'; g.fillRect(x0, y0, x1 - x0, y1 - y0)
    g.restore()
    g.strokeStyle = 'rgba(120,160,60,.5)'; g.lineWidth = 2; box(0); g.stroke()
  }

  // 路：深色描邊 → 土色 → 中間亮一條，再撒小石子、蓋一層淡淡的土路貼圖當顆粒。
  // 整條貼圖直接鋪的話，翻轉接出來的花紋一格一格看得出來，所以只拿它當質感。
  g.lineCap = 'round'; g.lineJoin = 'round'
  const stroke = (pts: { x: number; y: number }[], w: number, color: string | CanvasPattern) => {
    g.lineWidth = w; g.strokeStyle = color
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
    g.stroke()
  }
  for (const pts of layout.paths) stroke(pts, 60, 'rgba(70,90,30,.25)')
  for (const pts of layout.paths) stroke(pts, 52, '#c79a5e')
  for (const pts of layout.paths) stroke(pts, 46, '#e3c48e')
  for (const pts of layout.paths) stroke(pts, 26, '#ecd4a4')
  g.save(); g.globalAlpha = 0.28
  for (const pts of layout.paths) stroke(pts, 46, g.createPattern(road, 'repeat')!)
  g.restore()
  for (const pts of layout.paths) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const seg = Math.hypot(b.x - a.x, b.y - a.y)
      for (let d = 0; d < seg; d += 11) {
        if (r() > 0.55) continue
        const t = d / seg, side = (r() - 0.5) * 38
        const nx = -(b.y - a.y) / seg, ny = (b.x - a.x) / seg
        const x = a.x + (b.x - a.x) * t + nx * side, y = a.y + (b.y - a.y) * t + ny * side
        if (x < -20 || x > W + 20) continue
        const rad = 1.6 + r() * 2.4
        g.fillStyle = 'rgba(150,110,60,.45)'; g.beginPath(); g.ellipse(x, y + 1, rad, rad * 0.7, 0, 0, 7); g.fill()
        g.fillStyle = r() > 0.5 ? '#f6e7c6' : '#d7b47c'; g.beginPath(); g.ellipse(x, y, rad, rad * 0.7, 0, 0, 7); g.fill()
      }
    }
  }

  // 撒小花和小草叢：離路、塔位、城堡、高地都遠一點
  const flowers = img['p-flowers'], bush = img['p-bush']
  const clear = (x: number, y: number) =>
    y > top + 24 && y < bot - 16 &&
    layout.paths.every((p) => distToPath(x, y, p) > 44) &&
    layout.slots.every((s) => Math.hypot(s.x - x, s.y - y) > 52) &&
    Math.hypot(layout.castle.x - x, layout.castle.y - y) > 110 &&
    layout.plateaus.every((p) => x < p.c0 * 64 - 10 || x > (p.c1 + 1) * 64 + 10 || y < p.r0 * 64 - 10 || y > (p.r1 + 1) * 64 + 20) &&
    layout.decor.every((d) => Math.hypot(d.x - x, d.y - y) > 40)
  let placed = 0
  for (let i = 0; i < 160 && placed < 14; i++) {
    const x = 20 + r() * (W - 40), y = top + r() * (bot - top)
    if (!clear(x, y)) continue
    const im = placed % 3 === 2 ? bush : flowers
    if (!im?.complete) continue
    const h = im === bush ? 22 : 18
    const w = (im.width / im.height) * h
    g.drawImage(im, x - w / 2, y - h, w, h)
    placed++
  }
  return cv
}
