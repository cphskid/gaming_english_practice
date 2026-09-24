// 把 src/data/levels.ts 的關卡寫進 supabase/seed.sql。
//
// 為什麼要有這支：關卡名稱本來就要進資料庫（老師報表要顯示），但真正的理由是
// **min_correct**——「這一關至少要答對幾題才可能過」。通關與星星由伺服器算，
// 伺服器就得知道這個數字，而數字的來源只能有一份，就是 levels.ts。
//
//   node tools/gen-levels-seed.mjs
//
// min_correct 怎麼來的：守塔的怪只會被齊射打死，而齊射只有答對才會發生
// （軍營的士兵只纏住減速，不造成傷害），所以「殺光全部的怪」至少要答對
// 怪的總數那麼多次。但玩家可以放幾隻進城堡照樣通關，所以**打對折**——
// 這是刻意訂得寬鬆的下限：擋掉「一題都沒答就說自己通關了」，
// 而不是去判斷誰打得好。寧可放過作弊的，也不能誤殺真的打過的小朋友。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname

// 關卡的數值是算出來的不是寫死的，所以不能用正規表示式撈，要真的把 TS 跑起來
const dir = mkdtempSync(join(tmpdir(), 'levelseed-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, "export { LEVELS } from '@/data/levels'\n")
const out = join(dir, 'data.mjs')
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
  entry, '--bundle', '--format=esm', '--platform=node',
  `--alias:@=${join(ROOT, 'src')}`, `--outfile=${out}`,
], { stdio: ['ignore', 'ignore', 'inherit'] })
const { LEVELS } = await import(out)

const rows = LEVELS.map((l) => {
  const enemies = l.rules.waves.reduce((n, w) => n + w.count, 0) + (l.rules.boss ? 1 : 0)
  // isBoss：守塔的成就（「屠魔」「差一點」）要分得出哪幾關是魔王關
  return { id: l.id, no: l.no, name: l.name, minCorrect: Math.ceil(enemies * 0.5), boss: !!l.isBoss }
})
if (rows.length !== 14) throw new Error('關卡數不是 14，是不是改了？' + rows.length)

const sql = `
-- 關卡。**這一段是 tools/gen-levels-seed.mjs 從 src/data/levels.ts 產生的，不要手改。**
-- min_correct 是「這一關至少要答對幾題才可能通關」，通關與星星由伺服器判定時要用。
insert into public.levels (id, no, name, min_correct, is_boss) values
${rows.map((r) => `  ('${r.id}', ${r.no}, '${r.name}', ${r.minCorrect}, ${r.boss})`).join(',\n')}
on conflict (id) do update
  set no = excluded.no, name = excluded.name, min_correct = excluded.min_correct,
      is_boss = excluded.is_boss;
`
const marker = '-- 關卡。'
let seed = readFileSync('supabase/seed.sql', 'utf8')
const i = seed.indexOf(marker)
if (i >= 0) {
  const j = seed.indexOf('\n\n', seed.indexOf('on conflict (id) do update', i))
  seed = seed.slice(0, i) + sql.trimStart() + seed.slice(j + 1)
} else {
  seed = seed.replace(/\ncommit;\s*$/, '\n' + sql + '\ncommit;\n')
}
writeFileSync('supabase/seed.sql', seed)
console.log('寫進 seed.sql：' + rows.length + ' 關')
console.log(rows.map((r) => `  ${r.id} ${r.name}  至少答對 ${r.minCorrect}`).join('\n'))
