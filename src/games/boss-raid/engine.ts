import type { GameContext, GameHandle, LiveMove, RaidSeatInfo, Word } from '@/core/types'
import { iconImg } from '@/data/icons'
import { BOSS_BY_ID, BOSSES, raidUrl, type BossDef } from '@/data/bosses'
import { legionById, legionUnitArt } from '@/data/legions'
import { ART, loadArt } from '../tower-defense/art'
import {
  BOSS, LINES, MAX_TIER, RAID, frontMinions, nextCost, statsOf,
  type Line, type RHit, type RUnit, type RaidState,
} from './raid'
import { DELAY, RaidLockstep, TICK } from './lockstep'

/**
 * 魔王團戰的畫面（2026-09-25）。
 *
 * 規則在 raid.ts、同步在 lockstep.ts，這一支只負責「看得到、點得到」。
 * **引擎不直接改戰場**：答對、出兵、升階都是送一個動作出去，1.5 秒後每支手機一起生效
 * （跟兵推的真人對戰一樣）。所以按下去的那一刻畫面先給回饋（光線、飄字），
 * 真的打到是一秒多之後。
 *
 * 版面：魔王在左，右邊一排城堡（一人一座，最多六座），每座城有自己的一條路——
 * 衝著你家來的小兵走你那條路，你出的兵也走你那條路，一眼看得出誰家要破了。
 * 上面三塊木牌跟兵推一樣：最前面的小兵，小兵不夠就是魔王本人。
 */

const W = 1088
const H = 576
/** 答完一題到下一題之間的冷卻。比的是英文不是手速。 */
const ANSWER_COOLDOWN = 0.3
const TAPPABLE = 3
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const PRESS = 0.22
/** 魔王登場的那一段（秒）。這段時間戰場不動，大家都在看名牌。 */
const INTRO = 3.4
/** 剩這麼多秒音樂變快 */
const RUSH_AT = 30
/** 路的範圍：一人一條，從上到下排 */
const LANES = { mid: 392, maxGap: 62, span: 250 }
/** 城堡的位置（畫面上）。規則裡的 homeX 是小兵停下來打城的地方。 */
const CASTLE_X = 1010
/** 隊友腳下的色圈，一人一色（我是綠色） */
const SEAT_RING = ['#f0c24a', '#4fb3e8', '#e07ad0', '#ff8c4a', '#9a8cff', '#6fe0c0']

const SHELL = `
<div class="td-hud">
  <span class="td-stat td-clock">${iconImg('clock', 15)} 3:00</span>
  <span class="td-stat tw-mine">${iconImg('castle', 15)} 100</span>
  <div class="td-quiz">
    <span class="td-qemoji">👹</span>
    <span class="td-qzh">魔王登場</span>
    <span class="td-qhint"></span>
  </div>
  <span class="tw-foe"></span>
  <button class="td-say" disabled aria-label="再念一次">🔊</button>
</div>
<div class="td-stage">
  <canvas class="td-cv" width="1088" height="576"></canvas>
  <div class="td-toast"></div>
  <div class="tw-bar">
    <button class="tw-line" data-line="recognize">${iconImg('eye', 20)}<b>認字</b></button>
    <button class="tw-line" data-line="listen">👂<b>聽音</b></button>
    <button class="tw-line" data-line="spell">${iconImg('quill', 20)}<b>拼字</b></button>
    <button class="tw-up">⬆️<b>升階</b><i></i></button>
    <span class="tw-crystal">${iconImg('crystal', 15)} 0</span>
  </div>
</div>`

/** 上面三塊木牌（跟兵推同一套尺寸，小朋友已經習慣了） */
const BOARD = { y: 76, h: 46, w: 258, gap: 22 }
const SLOT_COLOR = ['#e0963a', '#4fa3cf', '#ab7ad2']
const slotX = (i: number) =>
  (W - (BOARD.w * 3 + BOARD.gap * 2)) / 2 + i * (BOARD.w + BOARD.gap) + BOARD.w / 2
const SPELL = { slotY: 92, slotW: 48, slotH: 58, slotGap: 8, bankY: 490, bankW: 76, bankH: 66, bankGap: 12 }

interface Target {
  id: string
  word: Word
  /** 小兵的編號；打魔王本人是 -1 */
  unit: number
  slot: number
  x: number
  y: number
  press: number
  good: number
  bad: number
  shake: number
}

/** 魔王的動畫圖（一條橫的格子）。一張一張載，沒到就先不畫那個動作。 */
function loadBossArt(b: BossDef): Record<string, HTMLImageElement> {
  const out: Record<string, HTMLImageElement> = {}
  for (const a of Object.keys(b.art.anims)) {
    const im = new Image()
    im.onload = () => { out[a] = im }
    im.src = raidUrl(`${b.id}/${a}.png`)
  }
  return out
}

export function mountBossRaid(root: HTMLElement, ctx: GameContext): GameHandle {
  const link = ctx.raid!
  const boss = BOSS_BY_ID.get(link.bossId) ?? BOSSES[0]
  root.innerHTML = SHELL
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T
  const cv = $<HTMLCanvasElement>('.td-cv')
  const c2d = cv.getContext('2d')!
  const elClock = $('.td-clock')
  const elMine = $('.tw-mine')
  const elInfo = $('.tw-foe')
  const elEmoji = $('.td-qemoji')
  const elZh = $('.td-qzh')
  const elHint = $('.td-qhint')
  const elSay = $<HTMLButtonElement>('.td-say')
  const elLines = [...root.querySelectorAll<HTMLButtonElement>('.tw-line')]
  const elUp = $<HTMLButtonElement>('.tw-up')
  const elUpCost = $('.tw-up i')
  const elCrystal = $('.tw-crystal')
  const elToast = $('.td-toast')

  const R = RAID
  const img = ART
  const me = link.seat
  const seats = link.seats
  const n = seats.length
  const ls = new RaidLockstep(seats.map((s) => s.rate), link.seed, R)
  const bossArt = loadBossArt(boss)
  const bg = new Image()
  bg.src = raidUrl(`bg/${boss.bg}.png`)
  let raf = 0
  let last = performance.now()
  const t0 = performance.now()

  const S = {
    /** 拿來畫的那一份（就是 lockstep 的 truth，不准直接改） */
    s: ls.truth as RaidState,
    targets: new Map<string, Target>(),
    target: null as string | null,
    bossWords: [null, null, null] as (Word | null)[],
    askedAt: 0,
    asked: 0,
    correct: 0,
    combo: 0,
    cooldown: 0,
    line: 'recognize' as Line,
    pending: 0,
    spell: {
      word: null as Word | null,
      filled: 0,
      bank: [] as { ch: string; used: boolean; press: number; bad: number }[],
      slips: 0,
    },
    pops: [] as { x: number; y: number; text: string; color: string; life: number }[],
    beams: [] as { x0: number; y0: number; x1: number; y1: number; life: number }[],
    /** 小兵死掉時的一團煙 */
    puffs: [] as { x: number; y: number; life: number }[],
    shakeCam: 0,
    upWait: 0,
    lastUpK: 0,
    rushed: false,
    done: false,
    /** 魔王死掉的動畫從什麼時候開始 */
    deathAt: 0,
    /** 等人等多久了（performance.now），沒在等是 0 */
    stallSince: 0,
    /** 我的城上一格倒了沒（倒下／修好那一刻要講一聲） */
    wasDown: false,
    lastCastle: R.castleHp,
    castleSfx: 0,
    /** 動畫用的時鐘（跟戰場時間分開，戰場停下來等人的時候畫面照樣會動） */
    anim: 0,
  }
  /** 我送出去的動作（累計） */
  const myMoves: LiveMove[] = []
  let acc = 0

  if (link.noListen) {
    const b = elLines.find((x) => x.dataset.line === 'listen')
    if (b) b.style.display = 'none'
  }

  // --------------------------------------------------------------- 路與軍團
  const gap = n > 1 ? Math.min(LANES.maxGap, LANES.span / (n - 1)) : 0
  const laneY = (seat: number) => LANES.mid - ((n - 1) * gap) / 2 + seat * gap
  /** 小兵與兵站的高度：各走各家的那一條路 */
  const unitY = (u: RUnit) => laneY(u.owner === BOSS ? u.goal : u.owner) + ((u.id * 7) % 3) * 4 - 4
  /** 路多時兵要畫小一點，不然六條路擠成一團 */
  const unitScale = n <= 2 ? 0.8 : n <= 4 ? 0.68 : 0.58

  const legions = seats.map((s) => legionById(s.legion))
  const unitImg = (u: RUnit, rank: number) => {
    const l = legions[u.owner] ?? legions[0]
    const key = legionUnitArt(l, u.line, LINES[u.line].art, rank)
    const color = u.owner === me ? ctx.color : ''
    return img[key] ?? img[LINES[u.line].art + color] ?? img[LINES[u.line].art]
  }
  const castleImg = (seat: number) => {
    const l = legions[seat] ?? legions[0]
    const color = seat === me ? ctx.color : ''
    return img[l.prefix + 'castle'] ?? img['castle' + color] ?? img['castle']
  }

  // ------------------------------------------------------------------ 題目
  function freshWord(): Word | null {
    const q = ctx.nextQuestion(LINES[S.line].skill)
    return q ? q.word : null
  }

  function newSpellWord() {
    const w = freshWord()
    S.spell.word = w
    S.spell.filled = 0
    S.spell.slips = 0
    S.spell.bank = []
    if (!w) return
    const letters = w.word.toLowerCase().split('')
    const want = Math.min(8, Math.max(5, letters.length + 2))
    const pool = [...letters]
    while (pool.length < want) {
      const c = LETTERS[(Math.random() * 26) | 0]
      if (!letters.includes(c) && !pool.includes(c)) pool.push(c)
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    S.spell.bank = pool.map((ch) => ({ ch, used: false, press: 0, bad: 0 }))
    S.asked++
    S.askedAt = performance.now()
    syncQuiz()
  }

  const bankX = (i: number) => {
    const k = S.spell.bank.length
    return (W - (k * SPELL.bankW + (k - 1) * SPELL.bankGap)) / 2 + i * (SPELL.bankW + SPELL.bankGap)
  }
  const slotXi = (i: number) => {
    const k = S.spell.word?.word.length ?? 0
    return (W - (k * SPELL.slotW + (k - 1) * SPELL.slotGap)) / 2 + i * (SPELL.slotW + SPELL.slotGap)
  }

  /** 魔王身上掛木牌旗子的三個點（小兵不夠三隻時，剩下的牌子是打魔王本人） */
  function bossSpot(i: number): { x: number; y: number } {
    const top = bossFoot() - boss.art.h * boss.scale * 0.8
    return { x: R.bossX + [-10, 40, 10][i], y: top + [30, 90, 150][i] }
  }
  const bossFoot = () => LANES.mid + (n > 1 ? ((n - 1) * gap) / 2 : 0) + 30

  /**
   * 場上點得到的東西：最前面（離城最近）的 TAPPABLE 隻小兵，不夠的用魔王本人補。
   * 正在問的那一題就算掉出前幾名也留著，不然字會在你正要點的時候換掉。
   */
  function syncTargets() {
    if (S.line === 'spell') {
      S.targets.clear()
      S.bossWords = [null, null, null]
      S.target = null
      return
    }
    const seen = new Set<string>()
    const asked = S.target?.startsWith('u') ? Number(S.target.slice(1)) : -1
    const show: RUnit[] = []
    const alive = S.s.units.filter((u) => u.owner === BOSS && u.hp > 0)
    const a = alive.find((u) => u.id === asked)
    if (a) show.push(a)
    for (const u of frontMinions(S.s, TAPPABLE + 1)) {
      if (show.length >= TAPPABLE) break
      if (!show.includes(u)) show.push(u)
    }
    for (const u of show) {
      const id = 'u' + u.id
      seen.add(id)
      let t = S.targets.get(id)
      if (!t) {
        const w = freshWord()
        if (!w) continue
        t = { id, word: w, unit: u.id, slot: -1, x: u.x, y: unitY(u) - 60, press: 0, good: 0, bad: 0, shake: 0 }
        S.targets.set(id, t)
      }
      t.x = u.x; t.y = unitY(u) - 60 * unitScale
    }
    const need = Math.max(0, TAPPABLE - seen.size)
    for (let i = 0; i < need; i++) {
      const id = 'b' + i
      seen.add(id)
      if (!S.bossWords[i]) S.bossWords[i] = freshWord()
      const w = S.bossWords[i]
      if (!w) continue
      const p = bossSpot(i)
      let t = S.targets.get(id)
      if (!t) {
        t = { id, word: w, unit: -1, slot: -1, x: p.x, y: p.y, press: 0, good: 0, bad: 0, shake: 0 }
        S.targets.set(id, t)
      }
      t.word = w; t.x = p.x; t.y = p.y
    }
    for (const id of [...S.targets.keys()]) if (!seen.has(id)) S.targets.delete(id)
    // 已經有位子的不准換位子（不然字會在手指底下換掉）
    const taken = new Set<number>()
    for (const t of S.targets.values()) {
      if (t.slot >= 0 && t.slot < TAPPABLE && !taken.has(t.slot)) taken.add(t.slot)
      else t.slot = -1
    }
    for (const t of S.targets.values()) {
      if (t.slot >= 0) continue
      for (let i = 0; i < TAPPABLE; i++) if (!taken.has(i)) { t.slot = i; taken.add(i); break }
    }
    if (S.target && !S.targets.has(S.target)) pickQuestion()
  }

  function pickQuestion() {
    if (S.line === 'spell') return newSpellWord()
    const list = [...S.targets.values()]
    if (!list.length) { S.target = null; return syncQuiz() }
    const pick = list[(Math.random() * list.length) | 0]
    S.target = pick.id
    S.asked++
    S.askedAt = performance.now()
    syncQuiz()
    if (S.line === 'listen') speak(pick.word.word)
  }

  const mySeat = () => S.s.seats[me]

  function syncQuiz() {
    const seat = mySeat()
    if (seat.down) {
      elEmoji.textContent = '🛠️'
      elHint.textContent = `城被攻破了！答對修城（${Math.floor(seat.castle)}/${R.repairUp}）`
    }
    const need = seat.tier
    const step = need > 1 && !seat.down ? `（${S.pending + 1}/${need}）` : ''
    if (S.line === 'spell') {
      const w = S.spell.word
      if (!seat.down) elEmoji.textContent = w?.emoji ?? '✍️'
      elZh.textContent = w ? w.zh : '拼字'
      if (!seat.down) elHint.textContent = w ? `${step}用下面的字母磚拼出來` : '題庫用完了'
      elSay.disabled = !w
      return
    }
    const t = S.target ? S.targets.get(S.target) : null
    if (!t) {
      elEmoji.textContent = '👹'
      elZh.textContent = boss.name
      elHint.textContent = ''
      elSay.disabled = true
      return
    }
    if (S.line === 'listen') {
      if (!seat.down) { elEmoji.textContent = '👂'; elHint.textContent = `${step}點出你聽到的那個字` }
      elZh.textContent = '聽聽看'
    } else {
      if (!seat.down) {
        elEmoji.textContent = t.word.emoji
        elHint.textContent = `${step}（${t.word.pos}）點出寫著這個字的目標`
      }
      elZh.textContent = t.word.zh
    }
    elSay.disabled = false
  }

  function syncUI() {
    const s = S.s
    const left = Math.max(0, R.seconds - s.t)
    elClock.innerHTML = `${iconImg('clock', 15)} ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
    const seat = mySeat()
    elMine.innerHTML = seat.down ? '🛠️ 修城中' : `${iconImg('castle', 15)} ${Math.max(0, Math.ceil(seat.castle))}`
    const wait = ls.waitingFor().filter((i) => i !== me)
    elInfo.textContent = S.stallSince && performance.now() - S.stallSince > 1200 && wait.length
      ? `等 ${wait.map((i) => seats[i].nickname).join('、')} 連線…`
      : `👥 ${n} 人團戰`
  }

  function syncBar() {
    for (const b of elLines) b.classList.toggle('on', b.dataset.line === S.line)
    const cost = nextCost(S.s, me)
    const seat = mySeat()
    elUp.disabled = cost === null || seat.crystal < cost || S.upWait > 0 || seat.down
    elUpCost.innerHTML = cost === null ? `已滿 ${MAX_TIER} 階` : `${iconImg('crystal', 13)} ${cost}`
    elCrystal.innerHTML = `${iconImg('crystal', 15)} ${Math.floor(seat.crystal)}　${seat.tier} 階`
  }

  let toastTimer = 0
  function toast(text: string, ms = 1800) {
    elToast.textContent = text
    elToast.classList.add('on')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => elToast.classList.remove('on'), ms)
  }

  function send(m: Omit<LiveMove, 'k'>) {
    const full = { ...m, k: ls.tick + 1 }
    myMoves.push(full)
    link.send(full)
  }

  /** 累積的答對換成一隻兵（跟兵推一樣：滿階出、答錯把累積的結算出去） */
  function cashOut() {
    if (S.pending <= 0) return
    if (mySeat().down) { S.pending = 0; return }
    const rank = Math.min(S.pending, mySeat().tier)
    send({ act: 'summon', line: LINES[S.line].skill, rank })
    S.pending = 0
    S.pops.push({ x: CASTLE_X - 60, y: laneY(me) - 70, text: `${statsOf(S.line, rank).name}出發`, color: '#a8e07a', life: 1.0 })
  }

  function switchLine(line: Line) {
    if (S.done || !started() || line === S.line) return
    if (line === 'listen' && link.noListen) return
    cashOut()
    S.line = line
    S.targets.clear()
    S.bossWords = [null, null, null]
    S.target = null
    syncTargets()
    pickQuestion()
    syncBar()
    ctx.audio.play('ui-tap')
  }

  function buyTier() {
    if (S.done || !started()) return
    const cost = nextCost(S.s, me)
    const seat = mySeat()
    if (S.upWait || cost === null || seat.crystal < cost || seat.down) return
    S.upWait = seat.tier
    S.lastUpK = ls.tick + 1
    send({ act: 'up' })
    ctx.audio.play('tower-build')
    toast(`升到 ${S.upWait + 1} 階，馬上生效`)
    syncBar()
  }

  for (const b of elLines) b.addEventListener('click', () => switchLine(b.dataset.line as Line))
  elUp.addEventListener('click', buyTier)

  // ------------------------------------------------------------------ 作答
  function settle(correct: boolean, word: Word, target: number, at: { x: number; y: number }) {
    ctx.report({
      wordId: word.id, skill: LINES[S.line].skill, correct,
      ms: Math.round(performance.now() - S.askedAt), combo: S.combo,
    })
    send({ act: 'answer', correct, target: correct ? target : -1 })
    const down = mySeat().down
    if (correct) {
      S.correct++; S.combo++
      buzz(14)
      ctx.audio.play('answer-correct')
      S.beams.push({ x0: CASTLE_X - 30, y0: laneY(me) - 50, x1: at.x, y1: at.y, life: 0.25 })
      if (down) {
        S.pops.push({ x: CASTLE_X, y: laneY(me) - 60, text: `+${R.repair} 修城`, color: '#9de8a0', life: 1.0 })
      } else {
        S.pending++
        if (S.pending >= mySeat().tier) cashOut()
        else S.pops.push({ x: CASTLE_X - 60, y: laneY(me) - 70, text: `${S.pending}/${mySeat().tier}`, color: '#ffd76a', life: 0.9 })
      }
      speak(word.word)
    } else {
      S.combo = 0
      buzz(55)
      ctx.audio.play('answer-wrong')
      S.pops.push({ x: at.x, y: at.y - 10, text: '✗', color: '#ffb4b0', life: 0.8 })
      cashOut()
    }
    syncTargets()
    pickQuestion()
    syncUI()
    syncBar()
  }

  function tap(t: Target) {
    if (S.done || !started() || !S.target || S.cooldown > 0) return
    t.press = PRESS
    const correct = t.id === S.target
    const asked = S.targets.get(S.target)!
    S.cooldown = ANSWER_COOLDOWN
    if (correct) t.good = 0.45
    else { t.bad = 0.5; t.shake = 0.35 }
    if (correct && t.unit < 0) S.bossWords[Number(t.id.slice(1))] = null
    settle(correct, asked.word, asked.unit, { x: t.x, y: t.y })
  }

  function tapLetter(i: number) {
    if (S.done || !started() || S.cooldown > 0) return
    const w = S.spell.word
    const tile = S.spell.bank[i]
    if (!w || !tile || tile.used) return
    const need = w.word.toLowerCase()
    if (tile.ch !== need[S.spell.filled]) {
      tile.bad = 0.45
      S.spell.slips++
      buzz(35)
      ctx.audio.play('answer-wrong')
      return
    }
    tile.used = true
    tile.press = PRESS
    S.spell.filled++
    if (S.spell.filled < need.length) { ctx.audio.play('ui-tap'); return }
    S.cooldown = ANSWER_COOLDOWN
    const front = frontMinions(S.s, 1)[0]
    settle(S.spell.slips === 0, w, front ? front.id : -1,
      front ? { x: front.x, y: unitY(front) - 30 } : bossSpot(1))
  }

  function buzz(ms: number) {
    try { navigator.vibrate?.(ms) } catch { /* 沒有震動就算了 */ }
  }

  function speak(t: string) {
    if (!('speechSynthesis' in window)) return
    try {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(t)
      u.lang = 'en-US'; u.rate = 0.85
      speechSynthesis.speak(u)
    } catch { /* 念不出來就算了 */ }
  }

  // ------------------------------------------------------------------ 迴圈
  const started = () => (performance.now() - t0) / 1000 >= INTRO

  function update(dt: number) {
    S.anim += dt
    if (S.cooldown > 0) S.cooldown -= dt
    if (S.shakeCam > 0) S.shakeCam -= dt
    // 大家的消息餵進 lockstep
    ls.mine(me, myMoves, ls.tick)
    const feeds = link.feeds()
    for (let i = 0; i < n; i++) if (i !== me && feeds[i]) ls.feed(i, feeds[i])

    let stalled = false
    if (started() && !S.s.over) {
      acc = Math.min(acc + dt, 0.5)
      while (acc >= TICK) {
        if (!ls.canStep()) { stalled = true; break }
        acc -= TICK
        for (const h of ls.step()) onHit(h)
        if (S.s.over) break
      }
    }
    link.mark(ls.tick)
    const now = performance.now()
    if (stalled) { if (!S.stallSince) S.stallSince = now } else S.stallSince = 0

    const seat = mySeat()
    if (S.upWait && seat.tier > S.upWait) S.upWait = 0
    if (S.upWait && ls.tick > S.lastUpK + DELAY + 2) S.upWait = 0
    if (seat.down && !S.wasDown) {
      toast('你的城被攻破了！先答對幾題把城修好，才能再出兵', 3000)
      ctx.audio.play('castle-hit')
      S.pending = 0
    } else if (!seat.down && S.wasDown) {
      toast('城修好了！繼續出兵打魔王')
      ctx.audio.play('tower-build')
    }
    S.wasDown = seat.down
    if (seat.castle < S.lastCastle - 0.5 && S.anim - S.castleSfx > 1.2) {
      S.castleSfx = S.anim
      ctx.audio.play('castle-hit')
    }
    S.lastCastle = seat.castle

    if (!S.rushed && R.seconds - S.s.t <= RUSH_AT && started()) {
      S.rushed = true
      ctx.audio.setMusicRate(1.12)
    }

    syncTargets()
    for (const tile of S.spell.bank) {
      if (tile.press > 0) tile.press -= dt
      if (tile.bad > 0) tile.bad -= dt
    }
    if (started() && S.line !== 'spell' && !S.target) pickQuestion()
    for (const t of S.targets.values()) {
      for (const k of ['press', 'good', 'bad', 'shake'] as const) if (t[k] > 0) t[k] -= dt
    }
    for (const p of S.pops) { p.life -= dt; p.y -= dt * 34 }
    S.pops = S.pops.filter((p) => p.life > 0)
    for (const b of S.beams) b.life -= dt
    S.beams = S.beams.filter((b) => b.life > 0)
    for (const p of S.puffs) p.life -= dt
    S.puffs = S.puffs.filter((p) => p.life > 0)

    if (link.kickedOut() && !S.done) return finish(true)
    if (S.s.over && !S.done) {
      if (S.s.win && !S.deathAt) S.deathAt = S.anim
      // 魔王倒下的動畫播完再結算
      if (!S.s.win || S.anim - S.deathAt > 1.6) finish(false)
    }
  }

  function onHit(h: RHit) {
    if (h.who === 'boss' && h.from === undefined && h.seat === undefined) {
      // 答對那一槍打到魔王（strikeAt）
      S.pops.push({ x: R.bossX + 30, y: bossFoot() - boss.art.h * boss.scale * 0.5, text: `-${R.strikeBoss}`, color: '#ffd76a', life: 0.7 })
    }
    if (h.who === BOSS && h.killed) {
      S.puffs.push({ x: h.x, y: LANES.mid, life: 0.4 })
      ctx.audio.play('enemy-die')
    }
    if (h.from === 'boss') S.shakeCam = 0.25
  }

  let finished = false
  function finish(kicked: boolean) {
    if (finished) return
    finished = true
    S.done = true
    link.close(false)
    const s = S.s
    const win = !kicked && s.win
    ctx.audio.playMusic(null)
    ctx.audio.play(win ? 'victory' : 'defeat')
    const acc2 = S.asked ? Math.round((S.correct / S.asked) * 100) : 0
    const left = Math.round((Math.max(0, s.bossHp) / s.bossMax) * 100)
    const how = kicked ? '你斷線太久，剩下的由電腦幫你打完。'
      : win ? `大家一起打倒${boss.name}了！`
      : s.reason === 'castles' ? `全部的城都被攻破了，${boss.name}還剩 ${left}% 的血。`
      : `時間到，${boss.name}還剩 ${left}% 的血。`
    ctx.finish({
      win,
      survival: 1,
      detail: `${how}你答對 ${S.correct} 題（正確率 ${acc2}%），對魔王打了 ${Math.round(s.seats[me].dealt)} 點。`,
      raid: { won: win, dealt: s.seats[me].dealt, correct: S.correct, kickedOut: kicked },
    })
  }

  function loop() {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // 團戰不能暫停：別人那邊還在打
    if (!S.done) update(dt)
    draw()
    syncUI()
    syncBar()
    raf = requestAnimationFrame(loop)
  }

  // ------------------------------------------------------------------ 畫面
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    c2d.beginPath()
    c2d.moveTo(x + r, y)
    c2d.arcTo(x + w, y, x + w, y + h, r)
    c2d.arcTo(x + w, y + h, x, y + h, r)
    c2d.arcTo(x, y + h, x, y, r)
    c2d.arcTo(x, y, x + w, y, r)
    c2d.closePath()
  }

  function bar(x: number, y: number, w: number, h: number, pct: number, color: string) {
    c2d.fillStyle = 'rgba(0,0,0,.55)'; c2d.fillRect(x - 1, y - 1, w + 2, h + 2)
    c2d.fillStyle = color; c2d.fillRect(x, y, Math.max(0, w * Math.min(1, pct)), h)
  }

  function shadow(x: number, y: number, r: number) {
    c2d.fillStyle = 'rgba(0,0,0,.25)'
    c2d.beginPath(); c2d.ellipse(x, y, r, r * 0.34, 0, 0, 7); c2d.fill()
  }

  function drawField() {
    c2d.imageSmoothingEnabled = false
    if (bg.complete && bg.naturalWidth) c2d.drawImage(bg, 0, 0, W, H)
    else { c2d.fillStyle = '#2a2335'; c2d.fillRect(0, 0, W, H) }
    c2d.imageSmoothingEnabled = true
    // 底下壓暗一層，字牌和兵才跳得出來（背景都是很花的像素畫）
    const g = c2d.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, 'rgba(10,8,20,.35)'); g.addColorStop(0.5, 'rgba(10,8,20,.1)'); g.addColorStop(1, 'rgba(10,8,20,.45)')
    c2d.fillStyle = g; c2d.fillRect(0, 0, W, H)
    // 一人一條路
    for (let i = 0; i < n; i++) {
      const y = laneY(i)
      c2d.strokeStyle = i === me ? 'rgba(168,224,122,.22)' : 'rgba(255,240,200,.1)'
      c2d.lineWidth = Math.max(10, gap * 0.5)
      c2d.lineCap = 'round'
      c2d.beginPath(); c2d.moveTo(R.bossX + 60, y + 6); c2d.lineTo(CASTLE_X, y + 6); c2d.stroke()
    }
  }

  /** 魔王本人。動作照狀態選：倒下 > 重擊 > 受傷 > 待機。 */
  function drawBoss() {
    const s = S.s
    const a = boss.art
    const sc = boss.scale
    let anim: 'idle' | 'attack' | 'hurt' | 'death' = 'idle'
    let frame = 0
    const count = (k: keyof typeof a.anims) => a.anims[k] ?? 0
    if (S.deathAt && count('death')) {
      anim = 'death'
      frame = Math.min(count('death') - 1, Math.floor(((S.anim - S.deathAt) / 1.3) * count('death')))
    } else if (s.bossSwing > 0 && count('attack')) {
      anim = 'attack'
      frame = Math.min(count('attack') - 1, Math.floor((1 - s.bossSwing / 0.6) * count('attack')))
    } else if (s.bossHurt > 0 && count('hurt') && Math.floor(S.anim * 3) % 4 === 0) {
      anim = 'hurt'
      frame = Math.floor(S.anim * 12) % count('hurt')
    } else {
      frame = Math.floor(S.anim * 8) % Math.max(1, count('idle'))
    }
    const im = bossArt[anim] ?? bossArt.idle
    if (!im) return
    if (anim === 'idle' || !bossArt[anim]) frame = Math.floor(S.anim * 8) % Math.max(1, count('idle'))
    const w = a.w * sc, h = a.h * sc
    // 登場：從左邊滑進來
    const intro = Math.min(1, (performance.now() - t0) / 1000 / 1.2)
    const slide = (1 - intro) * -260
    const x = R.bossX - a.cx * sc + slide
    const y = bossFoot() - a.foot * sc
    shadow(R.bossX + slide, bossFoot(), w * 0.3)
    c2d.save()
    c2d.imageSmoothingEnabled = false
    // 沒有倒下動畫的（牛頭人免費版）就淡出
    if (S.deathAt && !count('death')) c2d.globalAlpha = Math.max(0, 1 - (S.anim - S.deathAt) / 1.3)
    c2d.drawImage(im, frame * a.w, 0, a.w, a.h, x, y, w, h)
    if (s.bossHurt > 0) {
      c2d.globalAlpha = 0.35
      c2d.globalCompositeOperation = 'source-atop'
    }
    c2d.restore()
    // 重擊的衝擊波：看得到範圍，小朋友才知道兵為什麼少了
    if (s.bossSwing > 0.3) {
      const k = (0.6 - s.bossSwing) / 0.3
      c2d.save()
      c2d.strokeStyle = `rgba(255,120,80,${1 - k})`
      c2d.lineWidth = 6
      c2d.beginPath(); c2d.ellipse(R.bossX, LANES.mid + 10, R.bossReach * k + 20, (R.bossReach * k + 20) * 0.45, 0, 0, 7); c2d.stroke()
      c2d.restore()
    }
  }

  function drawCastle(seat: number) {
    const y = laneY(seat)
    const st = S.s.seats[seat]
    const sc = n <= 2 ? 0.75 : n <= 4 ? 0.6 : 0.5
    const im = castleImg(seat)
    const w = 150 * sc, h = 120 * sc
    shadow(CASTLE_X, y + 6, w * 0.4)
    c2d.save()
    if (st.down) c2d.globalAlpha = 0.45
    if (im?.complete) c2d.drawImage(im, CASTLE_X - w / 2, y + 6 - h, w, h)
    c2d.restore()
    // 名牌＋血條，畫在城的右邊一點，不要擋到路
    const info = seats[seat]
    c2d.save()
    c2d.font = `bold ${n <= 4 ? 15 : 13}px system-ui, sans-serif`
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    const label = (st.botFrom !== null ? '🤖' : '') + info.nickname
    const tw = Math.min(118, c2d.measureText(label).width + 14)
    const ty = y + 16
    c2d.fillStyle = seat === me ? 'rgba(60,110,40,.9)' : 'rgba(30,24,20,.8)'
    roundRect(CASTLE_X - tw / 2, ty - 10, tw, 20, 10); c2d.fill()
    c2d.strokeStyle = SEAT_RING[seat % SEAT_RING.length]; c2d.lineWidth = 2; c2d.stroke()
    c2d.fillStyle = '#fff'
    c2d.fillText(label, CASTLE_X, ty + 1, 110)
    c2d.restore()
    bar(CASTLE_X - 34, y - h - 2, 68, 6, st.castle / R.castleHp, st.down ? '#e0a040' : seat === me ? '#6fbf4a' : '#8fc4e0')
    if (st.down) {
      c2d.save()
      c2d.font = 'bold 14px system-ui'
      c2d.textAlign = 'center'
      c2d.fillStyle = '#ffd08a'
      c2d.fillText('🛠️ 修城中', CASTLE_X, y - h / 2)
      c2d.restore()
    }
  }

  function drawFigure(im: HTMLImageElement | undefined, x: number, y: number, sc: number, flip: boolean) {
    if (!im?.complete) return
    c2d.save()
    if (flip) { c2d.translate(x * 2, 0); c2d.scale(-1, 1) }
    c2d.translate(x, y); c2d.scale(sc, sc); c2d.translate(-x, -y)
    c2d.drawImage(im, x - 147 / 2, y - 94, 147, 147)
    c2d.restore()
  }

  function drawUnit(u: RUnit) {
    const y = unitY(u)
    if (u.owner === BOSS) {
      // 魔王的小兵（哥布林）。往右走，衝著某一家的城去。
      const im = img[(u.id % 2) ? 'goblinPurple' : 'goblinRed']
      const sc = unitScale * 1.05
      shadow(u.x, y + 2, 18 * sc)
      c2d.save()
      if (im?.complete) {
        const fr = u.fighting ? 5 + (Math.floor(S.anim * 6) % 2) : Math.floor(S.anim * 10 + u.id) % 7
        c2d.drawImage(im, fr * 64, 0, 64, 64, u.x - 42 * sc, y - 62 * sc, 84 * sc, 84 * sc)
      }
      if (u.hurt > 0) {
        c2d.globalAlpha = Math.min(0.5, u.hurt * 3)
        c2d.fillStyle = '#d43c32'
        c2d.beginPath(); c2d.ellipse(u.x, y - 20 * sc, 22 * sc, 26 * sc, 0, 0, 7); c2d.fill()
      }
      c2d.restore()
      bar(u.x - 18 * sc, y - 50 * sc, 36 * sc, 4, u.hp / u.maxHp, '#d4504a')
      return
    }
    const spec = statsOf(u.line, u.rank)
    const sc = spec.size * unitScale
    const im = unitImg(u, u.rank)
    const follower = unitImg(u, 1)
    for (let i = u.rank - 1; i >= 1; i--) {
      const fx = u.x + i * 14 * unitScale
      const fy = y + (i % 2 === 0 ? 5 : -5)
      shadow(fx, fy + 2, 13 * sc)
      drawFigure(follower, fx, fy, sc * 0.72, true)
    }
    shadow(u.x, y + 2, 18 * sc)
    c2d.save()
    c2d.strokeStyle = u.owner === me ? 'rgba(120,220,90,.9)' : SEAT_RING[u.owner % SEAT_RING.length]
    c2d.lineWidth = 2.5
    c2d.beginPath(); c2d.ellipse(u.x, y + 2, 18 * sc, 18 * sc * 0.34, 0, 0, 7); c2d.stroke()
    c2d.restore()
    // 我方的兵往左走（朝魔王），所以圖要翻過來
    drawFigure(im, u.x, y, sc, true)
    if (u.hurt > 0) {
      c2d.globalAlpha = Math.min(0.5, u.hurt * 3)
      c2d.fillStyle = '#d43c32'
      c2d.beginPath(); c2d.ellipse(u.x, y - 20 * sc, 22 * sc, 25 * sc, 0, 0, 7); c2d.fill()
      c2d.globalAlpha = 1
    }
    bar(u.x - 16, y - 50 * sc - 4, 32, 4, u.hp / u.maxHp, u.owner === me ? '#6fbf4a' : '#8fc4e0')
  }

  function drawBossBar() {
    const s = S.s
    const x0 = 150, w = W - 300, y = 20
    c2d.save()
    c2d.fillStyle = 'rgba(0,0,0,.6)'
    roundRect(x0 - 4, y - 4, w + 8, 26, 8); c2d.fill()
    const p = Math.max(0, s.bossHp) / s.bossMax
    const g = c2d.createLinearGradient(x0, 0, x0 + w, 0)
    g.addColorStop(0, boss.color); g.addColorStop(1, '#ff4a3a')
    c2d.fillStyle = g
    c2d.fillRect(x0, y, w * p, 18)
    c2d.font = 'bold 15px system-ui, sans-serif'
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    c2d.fillStyle = '#fff'
    c2d.fillText(`${boss.name}　${Math.max(0, Math.ceil(s.bossHp))} / ${s.bossMax}`, W / 2, y + 9)
    c2d.restore()
  }

  function drawBoard(t: Target) {
    const cx = slotX(t.slot) + (t.shake > 0 ? Math.sin(t.shake * 70) * 5 : 0)
    const x = cx - BOARD.w / 2
    const color = SLOT_COLOR[t.slot] ?? '#8a6b45'
    const sc = 1 + (t.press > 0 ? Math.sin((t.press / PRESS) * Math.PI) * 0.1 : 0)
    c2d.save()
    c2d.translate(cx, BOARD.y + BOARD.h / 2); c2d.scale(sc, sc)
    c2d.translate(-cx, -(BOARD.y + BOARD.h / 2))
    c2d.fillStyle = 'rgba(0,0,0,.3)'; roundRect(x, BOARD.y + 5, BOARD.w, BOARD.h, 11); c2d.fill()
    c2d.fillStyle = t.good > 0 ? '#3f7a34' : t.bad > 0 ? '#8c3730' : '#2b2117'
    roundRect(x, BOARD.y, BOARD.w, BOARD.h, 11); c2d.fill()
    c2d.strokeStyle = t.good > 0 ? '#a8e07a' : t.bad > 0 ? '#ff9a94' : color
    c2d.lineWidth = 4; c2d.stroke()
    c2d.fillStyle = '#fff'
    c2d.font = 'bold 30px system-ui, "Segoe UI", sans-serif'
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    c2d.fillText(t.word.word, cx, BOARD.y + BOARD.h / 2 + 1)
    if (t.unit < 0) {
      // 打魔王本人的牌子標一個小角，跟打小兵的分得出來
      c2d.font = 'bold 13px system-ui'
      c2d.fillStyle = color
      c2d.fillText('魔王', x + 24, BOARD.y + 12)
    }
    c2d.restore()
  }

  function drawPennant(t: Target) {
    const color = SLOT_COLOR[t.slot] ?? '#8a6b45'
    const x = t.x + (t.shake > 0 ? Math.sin(t.shake * 70) * 4 : 0)
    const top = t.y - 30
    c2d.strokeStyle = 'rgba(28,20,12,.8)'; c2d.lineWidth = 3
    c2d.beginPath(); c2d.moveTo(x, t.y + 4); c2d.lineTo(x, top); c2d.stroke()
    c2d.fillStyle = color
    c2d.beginPath(); c2d.moveTo(x, top); c2d.lineTo(x + 24, top + 8); c2d.lineTo(x, top + 16); c2d.closePath(); c2d.fill()
    c2d.strokeStyle = 'rgba(28,20,12,.8)'; c2d.lineWidth = 2; c2d.stroke()
    if (t.good > 0 || t.bad > 0) {
      c2d.fillStyle = t.good > 0 ? 'rgba(168,224,122,.9)' : 'rgba(255,154,148,.9)'
      c2d.beginPath(); c2d.arc(x, t.y - 4, 18, 0, 7); c2d.fill()
    }
  }

  function drawSpell() {
    const w = S.spell.word
    if (!w) return
    const need = w.word
    for (let i = 0; i < need.length; i++) {
      const x = slotXi(i)
      const done = i < S.spell.filled
      c2d.fillStyle = 'rgba(0,0,0,.3)'; roundRect(x, SPELL.slotY + 4, SPELL.slotW, SPELL.slotH, 9); c2d.fill()
      c2d.fillStyle = done ? '#3f7a34' : '#241c12'; roundRect(x, SPELL.slotY, SPELL.slotW, SPELL.slotH, 9); c2d.fill()
      c2d.strokeStyle = done ? '#a8e07a' : 'rgba(180,150,110,.55)'; c2d.lineWidth = 3; c2d.stroke()
      if (done) {
        c2d.fillStyle = '#fff'
        c2d.font = 'bold 34px system-ui, "Segoe UI", sans-serif'
        c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
        c2d.fillText(need[i], x + SPELL.slotW / 2, SPELL.slotY + SPELL.slotH / 2 + 1)
      }
    }
    for (let i = 0; i < S.spell.bank.length; i++) {
      const tile = S.spell.bank[i]
      const x = bankX(i) + (tile.bad > 0 ? Math.sin(tile.bad * 70) * 5 : 0)
      const sc = 1 + (tile.press > 0 ? Math.sin((tile.press / PRESS) * Math.PI) * 0.12 : 0)
      const cx = x + SPELL.bankW / 2, cy = SPELL.bankY + SPELL.bankH / 2
      c2d.save()
      c2d.translate(cx, cy); c2d.scale(sc, sc); c2d.translate(-cx, -cy)
      c2d.globalAlpha = tile.used ? 0.3 : 1
      c2d.fillStyle = 'rgba(0,0,0,.32)'; roundRect(x, SPELL.bankY + 5, SPELL.bankW, SPELL.bankH, 11); c2d.fill()
      c2d.fillStyle = tile.bad > 0 ? '#8c3730' : '#5b4128'; roundRect(x, SPELL.bankY, SPELL.bankW, SPELL.bankH, 11); c2d.fill()
      c2d.strokeStyle = tile.bad > 0 ? '#ff9a94' : '#8a6b45'; c2d.lineWidth = 3; c2d.stroke()
      c2d.fillStyle = '#fff'
      c2d.font = 'bold 36px system-ui, "Segoe UI", sans-serif'
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
      c2d.fillText(tile.ch.toUpperCase(), cx, cy + 1)
      c2d.restore()
    }
  }

  /** 魔王登場：背景暗下來、名牌從中間放大出來。儀式感是 Chuck 要的。 */
  function drawIntro() {
    const t = (performance.now() - t0) / 1000
    if (t >= INTRO) return
    const fade = t < INTRO - 0.5 ? 1 : (INTRO - t) / 0.5
    c2d.save()
    c2d.globalAlpha = 0.55 * fade
    c2d.fillStyle = '#000'; c2d.fillRect(0, 0, W, H)
    c2d.globalAlpha = fade
    const pop = Math.min(1, Math.max(0, (t - 0.5) / 0.35))
    const sc = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3))
    c2d.translate(W / 2 + 90, H / 2 - 30); c2d.scale(sc, sc)
    const w = 520, h = 150
    c2d.fillStyle = 'rgba(20,12,10,.92)'
    roundRect(-w / 2, -h / 2, w, h, 18); c2d.fill()
    c2d.strokeStyle = boss.color; c2d.lineWidth = 5; c2d.stroke()
    c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
    c2d.fillStyle = boss.color
    c2d.font = 'bold 18px system-ui, sans-serif'
    c2d.fillText('魔王登場', 0, -h / 2 + 24)
    c2d.fillStyle = '#fff'
    c2d.font = 'bold 54px system-ui, sans-serif'
    c2d.fillText(boss.name, 0, -4)
    c2d.fillStyle = '#e8dcc8'
    c2d.font = '18px system-ui, sans-serif'
    c2d.fillText(boss.tagline, 0, h / 2 - 26)
    c2d.restore()
  }

  function draw() {
    c2d.save()
    if (S.shakeCam > 0) c2d.translate(Math.sin(S.anim * 90) * 4, 0)
    drawField()
    drawBoss()
    for (let i = 0; i < n; i++) drawCastle(i)
    for (const u of [...S.s.units].sort((a, b) => unitY(a) - unitY(b))) drawUnit(u)
    for (const p of S.puffs) {
      c2d.fillStyle = `rgba(240,230,210,${p.life * 1.5})`
      c2d.beginPath(); c2d.arc(p.x, p.y, 28 * (1 - p.life), 0, 7); c2d.fill()
    }
    c2d.restore()
    drawBossBar()
    if (started() && !S.done) {
      if (S.line === 'spell') drawSpell()
      else {
        const list = [...S.targets.values()]
        for (const t of list) drawPennant(t)
        for (const t of list) drawBoard(t)
      }
    }
    for (const b of S.beams) {
      c2d.strokeStyle = `rgba(255,240,190,${b.life / 0.25})`
      c2d.lineWidth = 3; c2d.lineCap = 'round'
      c2d.beginPath(); c2d.moveTo(b.x0, b.y0); c2d.lineTo(b.x1, b.y1); c2d.stroke()
    }
    for (const p of S.pops) {
      c2d.globalAlpha = Math.min(1, p.life * 1.6)
      c2d.font = 'bold 19px system-ui, sans-serif'
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle'
      c2d.fillStyle = p.color
      c2d.fillText(p.text, p.x, p.y)
      c2d.globalAlpha = 1
    }
    drawIntro()
  }

  // ------------------------------------------------------------------ 輸入
  function at(ev: PointerEvent) {
    const r = cv.getBoundingClientRect()
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H }
  }

  function onDown(ev: PointerEvent) {
    const { x, y } = at(ev)
    if (S.line === 'spell') {
      for (let i = 0; i < S.spell.bank.length; i++) {
        const bx = bankX(i)
        if (x >= bx && x <= bx + SPELL.bankW && y >= SPELL.bankY - 6 && y <= SPELL.bankY + SPELL.bankH + 6) return tapLetter(i)
      }
      return
    }
    let best: Target | null = null
    let bestD = 1e9
    for (const t of S.targets.values()) {
      const cx = slotX(t.slot)
      const inBoard = x >= cx - BOARD.w / 2 && x <= cx + BOARD.w / 2 && y >= BOARD.y - 6 && y <= BOARD.y + BOARD.h + 6
      const d = inBoard ? 0 : Math.hypot(t.x - x, t.y - y)
      if (d < bestD) { bestD = d; best = t }
    }
    if (best && bestD < 40) tap(best)
  }

  cv.addEventListener('pointerdown', onDown)
  elSay.addEventListener('click', () => {
    const w = S.line === 'spell' ? S.spell.word : (S.target ? S.targets.get(S.target)?.word ?? null : null)
    if (w) speak(w.word)
  })

  void loadArt()

  if (import.meta.env.DEV) {
    ;(window as unknown as { __raid?: unknown }).__raid = {
      S, ls, BOARD, SPELL,
      tapLetter: (i: number) => tapLetter(i),
      setLine: (l: Line) => switchLine(l),
      buyTier: () => buyTier(),
      tapId: (id: string) => { const t = S.targets.get(id); if (t) tap(t) },
      ids: () => [...S.targets.keys()],
      target: () => S.target,
      truth: () => ({ tick: ls.tick, t: ls.truth.t, bossHp: ls.truth.bossHp, over: ls.truth.over, win: ls.truth.win,
        seats: ls.truth.seats.map((x) => [Math.round(x.castle * 1000), x.down, x.botFrom]),
        units: ls.truth.units.map((u) => [u.id, u.owner, Math.round(u.x * 1000), Math.round(u.hp * 1000)]) }),
    }
  }

  syncTargets()
  syncUI()
  syncQuiz()
  ctx.audio.unlock()
  ctx.audio.play('battle-horn')
  setTimeout(() => { if (!S.done) ctx.audio.play('explosion') }, 700)
  ctx.audio.playMusic('boss')
  const others = seats.filter((s) => !s.me).map((s: RaidSeatInfo) => s.nickname)
  setTimeout(() => {
    if (!S.done) toast(`和 ${others.join('、')} 一起打${boss.name}！三分鐘內打光牠的血`, 2600)
  }, INTRO * 1000)
  raf = requestAnimationFrame(loop)

  return {
    destroy() {
      cancelAnimationFrame(raf)
      clearTimeout(toastTimer)
      ctx.audio.playMusic(null)
      cv.removeEventListener('pointerdown', onDown)
      try { speechSynthesis.cancel() } catch { /* 沒有就算了 */ }
      root.innerHTML = ''
    },
  }
}
