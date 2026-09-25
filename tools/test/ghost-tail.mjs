/**
 * 分身的紀錄提早結束（例如第 60 秒就破城）時，後面要由電腦照他的速度接著打，
 * 不能站著不動；打滿三分鐘的紀錄則完全照原樣，不會多出東西。
 *
 *   node tools/test/ghost-tail.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), 'gt-'))
writeFileSync(join(dir, 'e.ts'), `export * from '@/core/opponent'`)
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [join(dir, 'e.ts'), '--bundle', '--format=esm',
  '--platform=node', `--alias:@=${join(ROOT, 'src')}`, `--outfile=${join(dir, 'm.mjs')}`], { stdio: 'ignore' })
const M = await import(join(dir, 'm.mjs'))

let bad = 0
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad = 1 }

// 60 秒內答 30 題、對 24 題（每分鐘答對 24 題、八成準）
const short = []
for (let i = 0; i < 30; i++) {
  const t = 2 * (i + 1)
  short.push({ t, act: 'answer', correct: i % 5 !== 0, rank: null })
  if (i % 5 !== 0) short.push({ t, act: 'summon', correct: true, line: 'recognize', rank: 1 })
}
const g = M.ghostOpponent('小甲', short)
const after = g.movesUntil(180).filter((m) => m.t > 60)
const right = after.filter((m) => m.correct).length
ok(after.length > 0 && after.every((m) => !m.act), `紀錄播完（第 60 秒）之後電腦接手：又答了 ${after.length} 題`)
ok(right >= 30 && right <= 70, `接手的速度照他那一場（後 120 秒答對 ${right} 題，他的速度約 48 題）`)
ok(g.movesUntil(60).length === short.length, '紀錄那一段照原樣重播，一筆不多一筆不少')

const full = short.map((m) => ({ ...m, t: m.t * 3 }))  // 撐到第 180 秒
const g2 = M.ghostOpponent('小乙', full)
ok(g2.movesUntil(180).length === full.length, '打滿三分鐘的紀錄不會多出電腦的動作')
ok(M.ghostOpponent('小丙', []).movesUntil(180).length === 0, '沒有紀錄就什麼都不做（不會壞掉）')

if (bad) process.exit(1)
console.log('分身接手：全部通過')
