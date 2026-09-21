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
 *   3. 快的人要真的比較容易贏——不然練英文沒有回報
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
    export * from '@/games/tug-of-war/opponent'
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
function match(meRate, foeRate, seed, rules) {
  const r = { ...M.RULES, ...rules }
  const me = M.botOpponent({ name: '我', rate: meRate, accuracy: 0.85, seed })
  const foe = M.botOpponent({ name: '對手', rate: foeRate, accuracy: 0.85, seed: seed + 7919 })
  const s = M.newBattle(r)
  // 答對＝召喚一隻兵 ＋ 對最前面那隻敵兵開一槍。真人點哪一隻由他決定，
  // 但他看得到的、也最該點的就是最前面那隻，所以假想玩家一律打那隻。
  const act = (side) => (rank) => {
    M.summon(s, side, rank, r)
    M.strike(s, side, M.frontUnitOf(s, side === 'me' ? 'foe' : 'me'), r)
  }
  const feedMe = M.makeFeeder(me, act('me'))
  const feedFoe = M.makeFeeder(foe, act('foe'))

  // 落後的人被壓在自己家門口多久（推進度低於一成就算「被壓著打」）
  let pinned = 0, minPush = 1, maxPush = 0
  while (!s.over) {
    feedMe(s.t); feedFoe(s.t)
    M.step(s, DT, r)
    const p = M.pushed(s, r)
    if (p < 0.12) pinned += DT
    minPush = Math.min(minPush, p)
    maxPush = Math.max(maxPush, p)
  }
  return {
    winner: s.winner, reason: s.reason, seconds: s.t,
    push: M.pushed(s, r), minPush, maxPush, pinned,
    castle: { me: Math.max(0, s.castleHp.me), foe: Math.max(0, s.castleHp.foe) },
  }
}

/** 同一組設定跑 N 場不同種子，回傳平均。 */
function series(meRate, foeRate, rules, n = 24) {
  const out = { wins: 0, draws: 0, secs: 0, push: 0, pinned: 0, early: 0 }
  for (let i = 0; i < n; i++) {
    const m = match(meRate, foeRate, 1000 + i * 13, rules)
    if (m.winner === 'me') out.wins++
    else if (m.winner === null) out.draws++
    out.secs += m.seconds
    out.push += m.push
    out.pinned += m.pinned
    if (m.reason === 'castle') out.early++
  }
  return {
    winRate: out.wins / n, drawRate: out.draws / n,
    secs: out.secs / n, push: out.push / n,
    pinned: out.pinned / n, earlyRate: out.early / n,
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

console.log('一場 ' + M.RULES.seconds + ' 秒，塔火力 ' + M.RULES.towerDps +
  '，兵 ' + M.RANKS[0].hp + ' 血 / ' + M.RANKS[0].dps + ' 傷')
console.log('（每組跑 24 場不同種子；「被壓著打」＝前線退到自己這邊一成以內的秒數）')
console.log('')
console.log(pad('我 vs 對手', 14) + pad('我的勝率', 12) + pad('平手', 8) +
  pad('平均長度', 12) + pad('提早分勝負', 14) + pad('我推到', 10) + '我被壓著打')

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
    pad(s.secs.toFixed(0) + ' 秒', 12) + pad((s.earlyRate * 100).toFixed(0) + '%', 14) +
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
// 3. 快的人要真的比較容易贏
const strong = by('20 vs 11')
if (strong.winRate < 0.7) fails.push(`快很多的人只贏 ${(strong.winRate * 100).toFixed(0)}%，練英文沒回報`)
if (by('20 vs 16').winRate < 0.55) fails.push('快一點的人沒有比較容易贏')

if (fails.length) { for (const f of fails) console.log('✗ ' + f); process.exit(1) }
console.log('✓ 同程度五五波、落後的人撐得住也推得出去、快的人確實比較容易贏')
