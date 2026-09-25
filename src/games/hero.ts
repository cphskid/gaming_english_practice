import type { Job } from '@/core/types'
import HERO_ART from '@/data/hero-art.json'

/**
 * 戰場上的「你本人」（2026-09-25，Chuck 選的英雄方案）。
 *
 * **職業就是你本人，軍團是你的部隊**：兵和塔的長相由軍團包決定，
 * 職業只多一位英雄站在城堡前，每答對一題由他出手——
 * 騎士衝上去砍一刀，法師舉杖丟一顆光球。
 *
 * **這裡只有外觀，沒有任何數字**。傷害照舊由引擎在答對的那一刻算完
 * （職業怎麼分配那一發見 data/jobs.ts），英雄的動畫晚個零點幾秒才砍到也沒關係，
 * 所以十四關的難度、兵推的平衡都不受影響。
 *
 * 守塔和兵推共用這一份：引擎只要在答對時叫 `strike(x, y)`、每幀 `update` 和 `draw`。
 * 圖是 tools/build-hero-art.py 切的（LuizMelo 的 Hero Knight 與 Wizard Pack，CC0）。
 */

type Anim = 'idle' | 'run' | 'attack' | 'attack2'
interface ArtMeta { w: number; h: number; foot: number; cx: number; body: number; anims: Record<Anim, number> }
const META = HERO_ART as Record<Job, ArtMeta>

/** 動畫條快取。**沒載好就不畫**——畫沒載完的圖會丟例外，整個迴圈會停住。 */
const SHEETS = new Map<string, HTMLImageElement>()
function sheet(job: Job, anim: Anim): HTMLImageElement | null {
  const key = job + '/' + anim
  let im = SHEETS.get(key)
  if (!im) {
    im = new Image()
    im.src = import.meta.env.BASE_URL + 'heroes/' + key + '.png'
    SHEETS.set(key, im)
  }
  return im.complete && im.naturalWidth > 0 ? im : null
}

/** 先把圖抓起來，進戰場的時候就不會第一刀是空的 */
export function preloadHero(job: Job) {
  for (const a of ['idle', 'run', 'attack'] as Anim[]) sheet(job, a)
}

const FPS: Record<Anim, number> = { idle: 9, run: 14, attack: 16, attack2: 16 }
/** 騎士衝過去要多久；太慢的話連續答對會一直在路上跑 */
const DASH = 0.13
/** 砍完回家 */
const BACK = 0.22
/** 法師的光球飛多久 */
const ORB = 0.28
/** 光球在第幾格離手（Wizard 的 Attack2 第 4 格球出現在手上） */
const ORB_FRAME = 3

interface Orb { x0: number; y0: number; x1: number; y1: number; t: number }
interface Burst { x: number; y: number; t: number; color: string }
interface Ghost { x: number; y: number; life: number; frame: number; anim: Anim; flip: boolean }

export interface Hero {
  /** 答對了，往 (x, y) 那隻出手。y 是牠腳底的位置。 */
  strike(x: number, y: number): void
  update(dt: number): void
  /** 身體（跟著 y 排序的那一層） */
  draw(c: CanvasRenderingContext2D): void
  /** 光球與爆炸，畫在最上層 */
  drawFx(c: CanvasRenderingContext2D): void
  /** 腳底現在的 y，拿來跟其他東西一起排前後 */
  readonly y: number
}

/**
 * @param homeX, homeY 站崗的位置（腳底）
 * @param height 身體畫多高（像素）。兩套原圖一個 51 一個 86，所以用身高換算倍率，兩個職業站起來才一樣高。
 * @param face 平常面向哪邊：1 朝右、-1 朝左
 */
export function createHero(job: Job, homeX: number, homeY: number, height: number, face: 1 | -1 = 1): Hero {
  const m = META[job] ?? META.knight
  const sc = height / m.body
  let x = homeX, y = homeY
  let dir: 1 | -1 = face
  let anim: Anim = 'idle'
  let t = 0
  // 騎士的一刀：phase 0 衝過去、1 砍、2 回家
  let phase = -1
  let from = { x: homeX, y: homeY }
  let to = { x: homeX, y: homeY }
  let pt = 0
  let aim = { x: 0, y: 0 }
  let orbSent = true
  const orbs: Orb[] = []
  const bursts: Burst[] = []
  const ghosts: Ghost[] = []

  const frames = (a: Anim) => m.anims[a] ?? 1
  const frameNow = () => Math.floor(t * FPS[anim]) % frames(anim)

  function play(a: Anim) { anim = a; t = 0 }

  function strike(tx: number, ty: number) {
    aim = { x: tx, y: ty }
    if (job === 'mage') {
      // 站在原地轉過去丟，丟完再轉回來
      dir = tx >= x ? 1 : -1
      play('attack'); orbSent = false
      return
    }
    // 騎士：衝到那隻旁邊（站在靠自己這一側），面向牠砍
    const side = homeX <= tx ? -1 : 1
    from = { x, y }
    to = { x: tx + side * 34, y: ty + 2 }
    dir = side === -1 ? 1 : -1
    phase = 0; pt = 0
    play('run')
  }

  function update(dt: number) {
    t += dt
    for (const g of ghosts) g.life -= dt
    while (ghosts.length && ghosts[0].life <= 0) ghosts.shift()

    if (job === 'knight' && phase >= 0) {
      pt += dt
      if (phase === 0) {
        const k = Math.min(1, pt / DASH)
        x = from.x + (to.x - from.x) * k
        y = from.y + (to.y - from.y) * k
        ghosts.push({ x, y, life: 0.16, frame: frameNow(), anim, flip: dir < 0 })
        if (k >= 1) { phase = 1; pt = 0; play('attack') }
      } else if (phase === 1) {
        // 刀光在第四格最大，那時候噴一圈
        if (frameNow() === 3 && !bursts.some((b) => b.t < 0.05)) bursts.push({ x: aim.x, y: aim.y - m.body * sc * 0.5, t: 0, color: '#fff6d8' })
        if (t * FPS.attack >= frames('attack')) {
          phase = 2; pt = 0; from = { x, y }; to = { x: homeX, y: homeY }
          dir = homeX >= x ? 1 : -1
          play('run')
        }
      } else {
        const k = Math.min(1, pt / BACK)
        x = from.x + (to.x - from.x) * k
        y = from.y + (to.y - from.y) * k
        if (k >= 1) { phase = -1; dir = face; play('idle') }
      }
    }

    if (job === 'mage' && anim === 'attack') {
      if (!orbSent && frameNow() >= ORB_FRAME) {
        orbSent = true
        const hx = x + dir * (m.w - m.cx) * sc * 0.55
        orbs.push({ x0: hx, y0: y - m.body * sc * 0.72, x1: aim.x, y1: aim.y - 24, t: 0 })
      }
      if (t * FPS.attack >= frames('attack')) { dir = face; play('idle') }
    }

    for (const o of orbs) o.t += dt
    for (let i = orbs.length - 1; i >= 0; i--) {
      if (orbs[i].t >= ORB) {
        bursts.push({ x: orbs[i].x1, y: orbs[i].y1, t: 0, color: '#c9a6ff' })
        orbs.splice(i, 1)
      }
    }
    for (const b of bursts) b.t += dt
    for (let i = bursts.length - 1; i >= 0; i--) if (bursts[i].t > 0.35) bursts.splice(i, 1)
  }

  function blit(c: CanvasRenderingContext2D, a: Anim, f: number, px: number, py: number, flip: boolean) {
    const im = sheet(job, a)
    if (!im) return
    const w = m.w * sc, h = m.h * sc
    c.save()
    c.translate(px, py)
    if (flip) c.scale(-1, 1)
    c.drawImage(im, f * m.w, 0, m.w, m.h, -m.cx * sc, -m.foot * sc, w, h)
    c.restore()
  }

  function draw(c: CanvasRenderingContext2D) {
    const smooth = c.imageSmoothingEnabled
    c.imageSmoothingEnabled = false
    // 腳下一圈淡影子，跟其他人物一樣
    c.fillStyle = 'rgba(0,0,0,.22)'
    c.beginPath(); c.ellipse(x, y - 2, 20, 6, 0, 0, 7); c.fill()
    for (const g of ghosts) {
      c.globalAlpha = Math.max(0, g.life / 0.16) * 0.35
      blit(c, g.anim, g.frame, g.x, g.y, g.flip)
    }
    c.globalAlpha = 1
    blit(c, anim, frameNow(), x, y, dir < 0)
    c.imageSmoothingEnabled = smooth
  }

  function drawFx(c: CanvasRenderingContext2D) {
    for (const o of orbs) {
      const k = o.t / ORB
      const ox = o.x0 + (o.x1 - o.x0) * k
      // 走一點弧線，看起來是丟出去的不是直線雷射
      const oy = o.y0 + (o.y1 - o.y0) * k - Math.sin(k * Math.PI) * 26
      c.save()
      c.fillStyle = 'rgba(168,120,255,.35)'
      c.beginPath(); c.arc(ox, oy, 13, 0, 7); c.fill()
      c.fillStyle = '#ffffff'; c.strokeStyle = '#8a5cff'; c.lineWidth = 3
      c.beginPath(); c.arc(ox, oy, 7, 0, 7); c.fill(); c.stroke()
      c.restore()
    }
    for (const b of bursts) {
      const k = b.t / 0.35
      c.save()
      c.globalAlpha = 1 - k
      c.strokeStyle = b.color; c.lineWidth = 5 - 3 * k
      c.beginPath(); c.arc(b.x, b.y, 8 + 30 * k, 0, 7); c.stroke()
      // 放射狀的幾道光，法師是紫的碎片、騎士是白的刀痕
      c.lineWidth = 2.5
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (job === 'mage' ? 0.3 : 0)
        const r0 = 6 + 18 * k, r1 = 14 + 34 * k
        c.beginPath()
        c.moveTo(b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0)
        c.lineTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1)
        c.stroke()
      }
      c.restore()
    }
  }

  return {
    strike, update, draw, drawFx,
    get y() { return y },
  }
}
