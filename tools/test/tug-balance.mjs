/**
 * 兵推平衡量測。
 *
 * 要回答的是 Chuck 擔心的那一件事：**會不會強的一路輾過去、弱的九十秒被打爆，
 * 然後他就不玩了。** 這個用眼睛看不出來，要量。
 *
 * 做法：拿 src/games/tug-of-war/battle.ts（純數字，不碰畫布）讓兩個假想的孩子
 * 對打——一個每分鐘答對 N 題、一個 M 題——量三件事：
 *   誰贏      快的人本來就該贏，問題是贏得多難看
 *   撐多久    落後的人是不是很快就被打到城堡上（被打爆就不玩了）
 *   推到哪    落後的人最後把線推到幾成（他真正在比的是這個）
 *
 * 判準（寫在下面 check 裡）：
 *   1. 同程度要接近五五波，也不該每場都在時間到之前就分出勝負
 *   2. 差距大的時候，落後的人也要撐過大半場，而且線要推得出去（不是被壓在家門口）
 *   3. 城堡的血要會動（懸殊時打得到），但任何情況都不准提早破城
 *   4. 快的人要真的比較容易贏——不然練英文沒有回報
 *
 *   node tools/test/tug-balance.mjs           跑一輪對照表
 *   node tools/test/tug-balance.mjs --tune    掃塔的火力，找最不一面倒的設定
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname

function load() {
  const dir = mkdtempSync(join(tmpdir(), 'tug-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `
    export * from '@/games/tug-of-war/battle'
    export * from '@/core/opponent'
  `)
  const out = join(dir, 'm.mjs')
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node',
    `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  return import(out)
}

const M = await load()
const DT = 1 / 30      // 量測用半速，跑得快又不影響結果（實測差 <1%）

/** 讓兩個假想的孩子打一場。rate 是每分鐘答對幾題。 */
function match(meRate, foeRate, seed, rules, flip = false) {
  const r = { ...M.RULES, ...rules }
  // **同一個種子要跑兩次，兩邊的答題亂數對調。**
  // 兩邊各自有一條亂數流決定哪幾題答錯，而某些種子的流本來就比較順；
  // 只跑一個方向的話，同程度對打會量到 38~40% 這種看起來像程式偏心的數字，
  // 實測把兩條流對調，偏差就跟著跑到另一邊——所以那是抽樣雜訊不是偏心。
  // 兩個方向都跑再平均，雜訊自己抵銷掉。
  const seedMe = flip ? seed + 7919 : seed
  const seedFoe = flip ? seed : seed + 7919
  const me = M.botOpponent({ name: '我', rate: meRate, accuracy: 0.85, seed: seedMe })
  const foe = M.botOpponent({ name: '對手', rate: foeRate, accuracy: 0.85, seed: seedFoe })
  const s = M.newBattle(r)
  // 答對＝召喚一隻兵 ＋ 對**你點的那個**開一槍。
  //
  // 這一段一定要照著畫面上真的能點到的東西寫，不然量出來的是另一個遊戲。
  // 第一版就是錯在這裡：測試一律打最前面那隻兵，可是實際遊戲裡敵方城堡前
  // 永遠掛著兩塊字牌、點到就直接扣城堡的血，所以量出來的「城堡被打爛 0%」
  // 根本不是玩家玩到的那個遊戲。
  //
  // 現在的規則：只有最前面 TAPPABLE 隻敵兵掛字牌，不夠就用城牆上的守衛湊滿，
  // 出題從這幾個裡面隨機抽。抽到守衛那一槍就落空（打不到城堡）。
  // 兩邊各一條亂數，不能共用——共用會讓兩人的「抽到守衛」互相牽連，
  // 同程度的對打就不是五五波了（實測會偏到 63%）。
  //
  // **三條兵種線＋兵階上限之後，答對不再等於出一隻兵。** 這一段跟
  // src/games/tug-of-war/engine.ts 的 feed 與 cashOut 必須逐行對得上：
  //   答對 → 開一槍、拿水晶、累積 +1；累積滿上限才出一隻那個階的兵
  //   答錯 → 把累積到一半的結算成那個階出去（不是整個沒收）
  //   有錢 → 升階（升階會讓出兵速度砍成 1/N，所以不是白賺）
  // 少抄任何一條，量出來的就是另一個遊戲。
  const TAPPABLE = 3
  const picks = { me: M.seeded(seed + 104729), foe: M.seeded(seed + 611953) }
  const pending = { me: 0, foe: 0 }
  // 一筆答題事件只是「花了一題的時間」，不等於答完一題。拼字要挖三個字母才算一題，
  // 聽音介於中間，所以要先存夠 LINE_COST 才結算一次。引擎的 feed 也是這樣寫的。
  const credit = { me: 0, foe: 0 }
  const lineOf = (t) => M.LINE_IDS[Math.floor(t / 45) % M.LINE_IDS.length]
  const act = (side) => (correct) => {
    const line = lineOf(s.t)
    credit[side] += 1
    if (credit[side] < M.LINE_COST[line]) return
    credit[side] -= M.LINE_COST[line]
    if (!correct) {
      if (pending[side] > 0) {
        M.summon(s, side, line, Math.min(pending[side], s.tier[side]), r)
        pending[side] = 0
      }
      return
    }
    s.crystal[side] += r.answerCrystal
    pending[side]++
    if (pending[side] >= s.tier[side]) {
      M.summon(s, side, line, s.tier[side], r)
      pending[side] = 0
    }
    M.upgrade(s, side)
    const foeSide = side === 'me' ? 'foe' : 'me'
    const dir = foeSide === 'foe' ? 1 : -1
    const units = s.units
      .filter((u) => u.side === foeSide && u.hp > 0)
      .sort((a, b) => (a.x - b.x) * dir)
      .slice(0, TAPPABLE)
    const i = Math.floor(picks[side]() * TAPPABLE)
    M.strike(s, side, units[i] ?? null, r)
  }
  const feedMe = M.makeFeeder(me, act('me'))
  const feedFoe = M.makeFeeder(foe, act('foe'))

  // 落後的人被壓在自己家門口多久（推進度低於一成就算「被壓著打」）
  let pinned = 0, minPush = 1, maxPush = 0
  // 有沒有真的打到對方城堡。第一版量不到這件事，所以「城堡的血永遠不會動」
  // 這個毛病是 Chuck 試玩才發現的，不是測試抓到的。
  let touched = false
  while (!s.over) {
    feedMe(s.t); feedFoe(s.t)
    M.step(s, DT, r)
    if (s.castleHp.foe < r.castleHp) touched = true
    const p = M.pushed(s, r)
    if (p < 0.12) pinned += DT
    minPush = Math.min(minPush, p)
    maxPush = Math.max(maxPush, p)
  }
  return {
    winner: s.winner, reason: s.reason, seconds: s.t, touched,
    push: M.pushed(s, r), minPush, maxPush, pinned,
    castle: { me: Math.max(0, s.castleHp.me), foe: Math.max(0, s.castleHp.foe) },
  }
}

/** 同一組設定跑 N 場不同種子，回傳平均。 */
/** 破城算「提早」的門檻。過了這個秒數才破城，那是正常的勝負，不是把人輾爆。 */
const STOMP_BEFORE = 120

function series(meRate, foeRate, rules, n = 48) {
  const out = { wins: 0, draws: 0, secs: 0, push: 0, pinned: 0, early: 0, stomp: 0, touched: 0 }
  for (let i = 0; i < n; i++) {
    const m = match(meRate, foeRate, 1000 + (i >> 1) * 13, rules, (i & 1) === 1)
    if (m.winner === 'me') out.wins++
    else if (m.winner === null) out.draws++
    out.secs += m.seconds
    out.push += m.push
    out.pinned += m.pinned
    if (m.reason === 'castle') {
      out.early++
      if (m.seconds < STOMP_BEFORE) out.stomp++
    }
    if (m.touched) out.touched++
  }
  return {
    winRate: out.wins / n, drawRate: out.draws / n,
    secs: out.secs / n, push: out.push / n,
    pinned: out.pinned / n, earlyRate: out.early / n, stompRate: out.stomp / n,
    touchRate: out.touched / n,
  }
}

const pad = (c, n) => String(c) + ' '.repeat(Math.max(0, n - [...String(c)]
  .reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)))

if (process.argv.includes('--tune')) {
  console.log('掃塔的火力（towerDps）：看哪一個讓落後的人最不會被壓在家門口')
  console.log(pad('塔火力', 10) + pad('同程度勝率', 14) + pad('快一點的勝率', 16) +
    pad('快很多的勝率', 16) + pad('弱者被壓', 12) + pad('弱者推到', 12) + '提早結束')
  for (const towerDps of [0, 3, 5, 7, 9, 10, 12, 16, 20]) {
    const even = series(16, 16, { towerDps }, 16)
    const edge = series(20, 16, { towerDps }, 16)
    const weak = series(11, 20, { towerDps }, 16)
    const strong = series(20, 11, { towerDps }, 16)
    console.log(pad(towerDps, 10) + pad((even.winRate * 100).toFixed(0) + '%', 14) +
      pad((edge.winRate * 100).toFixed(0) + '%', 16) +
      pad((strong.winRate * 100).toFixed(0) + '%', 16) +
      pad(weak.pinned.toFixed(0) + ' 秒', 12) +
      pad((weak.push * 100).toFixed(0) + '%', 12) + (weak.earlyRate * 100).toFixed(0) + '%')
  }
  process.exit(0)
}

// 想試別的塔火力不用改原始碼：node tools/test/tug-balance.mjs --tower=14
const towerArg = process.argv.find((a) => a.startsWith('--tower='))
if (towerArg) M.RULES.towerDps = Number(towerArg.split('=')[1])

console.log('一場 ' + M.RULES.seconds + ' 秒，塔火力 ' + M.RULES.towerDps +
  '，一階兵 ' + M.LINE_IDS.map((l) => {
    const st = M.statsOf(l, 1)
    return M.LINES[l].names[0] + ' ' + st.hp + '/' + st.dps
  }).join('、'))
console.log('（每組跑 48 場不同種子；「被壓著打」＝前線退到自己這邊一成以內的秒數）')
console.log('')
console.log(pad('我 vs 對手', 14) + pad('我的勝率', 12) + pad('平手', 8) +
  pad('平均長度', 12) + pad('打到城堡', 12) + pad('提早分勝負', 14) +
  pad('我推到', 10) + '我被壓著打')

const CASES = [
  ['16 vs 16', 16, 16], ['20 vs 20', 20, 20], ['11 vs 11', 11, 11],
  ['20 vs 16', 20, 16], ['16 vs 20', 16, 20],
  ['20 vs 11', 20, 11], ['11 vs 20', 11, 20],
]
const rows = []
for (const [label, a, b] of CASES) {
  const s = series(a, b)
  rows.push({ label, a, b, ...s })
  console.log(pad(label, 14) + pad((s.winRate * 100).toFixed(0) + '%', 12) +
    pad((s.drawRate * 100).toFixed(0) + '%', 8) +
    pad(s.secs.toFixed(0) + ' 秒', 12) + pad((s.touchRate * 100).toFixed(0) + '%', 12) +
    pad((s.earlyRate * 100).toFixed(0) + '%', 14) +
    pad((s.push * 100).toFixed(0) + '%', 10) + s.pinned.toFixed(0) + ' 秒')
}
console.log('')

const by = (l) => rows.find((r) => r.label === l)
const fails = []
// 1. 同程度要接近五五波
for (const l of ['16 vs 16', '20 vs 20', '11 vs 11']) {
  const r = by(l)
  if (Math.abs(r.winRate - 0.5) > 0.22) fails.push(`${l} 勝率 ${(r.winRate * 100).toFixed(0)}%，不夠五五波`)
}
// 2. 落後很多的人也要撐得住、推得出去
const weak = by('11 vs 20')
if (weak.pinned > 45) fails.push(`落後的人被壓在家門口 ${weak.pinned.toFixed(0)} 秒，太久了`)
if (weak.push < 0.15) fails.push(`落後的人最後只推到 ${(weak.push * 100).toFixed(0)}%，等於整場沒事做`)
if (weak.secs < M.RULES.seconds * 0.55) fails.push(`落後的人平均 ${weak.secs.toFixed(0)} 秒就被打完，撐不夠久`)
// 3. 城堡的血要真的會動。
// **這一條是補 Chuck 試玩抓到的洞。** 第一版答對可以直接打城堡，所以城堡的血
// 動得很兇；規則改對之後才發現兵根本走不到對方城堡，兩個數字整場不動。
// 兩邊實力懸殊的時候城堡一定要掉血，不然 HUD 上那兩個數字就是裝飾。
if (by('20 vs 11').touchRate < 0.3) {
  fails.push(`強弱懸殊也只有 ${(by('20 vs 11').touchRate * 100).toFixed(0)}% 的場次打到城堡，城堡的血形同裝飾`)
}
// 4. 不准把落後的孩子的城堡**提早**打爆——他會直接不玩了。
//
// 量的是「破城發生在第幾秒」，不是「有沒有破城」。加了兵階之後四階兵本來就
// 該撐得過箭塔，完全不准破城等於把升階做假的；真正會讓孩子不玩的是
// 「我才打一半就結束了」。所以門檻放在第 120 秒：撐過三分之二場才被破城，
// 那是輸了一場球，不是被趕出球場。
for (const r of rows) {
  if (r.stompRate > 0) {
    fails.push(`${r.label} 有 ${(r.stompRate * 100).toFixed(0)}% 的場次在第 ${STOMP_BEFORE} 秒前就被破城`)
  }
}
// 5. 快的人要真的比較容易贏
const strong = by('20 vs 11')
if (strong.winRate < 0.7) fails.push(`快很多的人只贏 ${(strong.winRate * 100).toFixed(0)}%，練英文沒回報`)
if (by('20 vs 16').winRate < 0.55) fails.push('快一點的人沒有比較容易贏')

// 6. 鐵則：城堡的血只准被「站在城堡前面的兵」啃掉。
// Chuck 第一次試玩抓到的洞就是這一條被破了（答對那一槍可以直接打城堡，
// 13 題就能繞過整個兵推）。這裡直接盯著模型每一格檢查，不用開瀏覽器。
{
  const r = M.RULES
  let drops = 0, cheats = 0
  // 一場打不打得到城堡是有運氣成分的（懸殊時約一半場次），所以跑多個種子。
  for (let k = 0; k < 12; k++) {
    const s = M.newBattle(r)
    const picks = { me: M.seeded(4242 + k * 31), foe: M.seeded(2424 + k * 31) }
    const act = (side) => () => {
      M.summon(s, side, 'recognize', 1, r)
      const fs = side === 'me' ? 'foe' : 'me'
      const d = fs === 'foe' ? 1 : -1
      const us = s.units.filter((u) => u.side === fs && u.hp > 0).sort((a, b) => (a.x - b.x) * d).slice(0, 3)
      M.strike(s, side, us[Math.floor(picks[side]() * 3)] ?? null, r)
    }
    const f1 = M.makeFeeder(M.botOpponent({ name: 'a', rate: 26, accuracy: 1, seed: 5 + k }), act('me'))
    const f2 = M.makeFeeder(M.botOpponent({ name: 'b', rate: 9, accuracy: 1, seed: 600 + k }), act('foe'))
    let last = { ...s.castleHp }
    while (!s.over) {
      f1(s.t); f2(s.t)
      // 誰站在門口要在 step **之前**記下來：打完那一下自己也可能被射死，
      // step 回來之後他已經從 units 裡被清掉了，照 step 之後看會冤枉它。
      const atGate = { me: false, foe: false }
      for (const side of ['me', 'foe']) {
        const home = side === 'me' ? r.homeMe : r.homeFoe
        atGate[side] = s.units.some((u) => u.side !== side && u.hp > 0 &&
          Math.abs(u.x - home) <= r.reach + 1)
      }
      M.step(s, DT, r)
      for (const side of ['me', 'foe']) {
        if (s.castleHp[side] >= last[side]) continue
        drops++
        if (!atGate[side]) cheats++
      }
      last = { ...s.castleHp }
    }
  }
  if (!drops) fails.push('十二場下來城堡的血都沒動過，這一條就驗不到了（把速度差拉大）')
  if (cheats) fails.push(`有 ${cheats} 格城堡門口沒有兵卻掉血——答對又在直接打城堡了`)
  else if (drops) console.log(`✓ 城堡的血只被門口的兵啃掉（十二場共 ${drops} 格掉血，0 格作弊）`)
}

if (fails.length) { for (const f of fails) console.log('✗ ' + f); process.exit(1) }
console.log('✓ 同程度五五波、落後的人撐得住也推得出去、快的人確實比較容易贏')
