// 把 data/words2000.json 的題庫寫進 supabase/seed.sql 的 words 那一段。
//
//   node tools/gen-words-seed.mjs
//
// 伺服器要題庫是因為金幣照字的 level 算、成就的「全部」照字數算——前端送來的不能信。
// 字的內容只有一份，就是 data/words2000.json；這支只是把它抄進 SQL。
import { readFileSync, writeFileSync } from 'node:fs'

const { words } = JSON.parse(readFileSync('data/words2000.json', 'utf8'))
const ids = new Set(words.map((w) => w.id))
if (ids.size !== words.length) throw new Error('題庫 id 重複')
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const sql = `insert into public.words (id, word, pos, zh, theme, emoji, spell, level, tier) values
${words.map((w) => `  (${w.id}, ${q(w.word)}, ${q(w.pos)}, ${q(w.zh)}, ${q(w.theme)}, ${q(w.emoji)}, ${w.spell}, ${w.level}, ${w.tier})`).join(',\n')}
on conflict (id) do update set
  word = excluded.word, pos = excluded.pos, zh = excluded.zh,
  theme = excluded.theme, emoji = excluded.emoji,
  spell = excluded.spell, level = excluded.level, tier = excluded.tier;`

let seed = readFileSync('supabase/seed.sql', 'utf8')
const i = seed.indexOf('insert into public.words')
const endMark = 'spell = excluded.spell, level = excluded.level'
const e = seed.indexOf(endMark, i)
const j = seed.indexOf(';', e) + 1
if (i < 0 || e < 0) throw new Error('seed.sql 裡找不到 words 那一段')
seed = seed.slice(0, i) + sql + seed.slice(j)
seed = seed.replace('-- 這份是 data/core300.json 與 src/data/levels.ts 產生出來的，不要手改。',
  '-- 這份是 data/words2000.json、src/data/levels.ts 等檔案產生出來的，不要手改。')
writeFileSync('supabase/seed.sql', seed)
console.log('寫進 seed.sql：' + words.length + ' 個字')
