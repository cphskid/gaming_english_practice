// 把 src/data/achievements.ts 的成就目錄寫進 supabase/seed.sql。
//
// 為什麼目錄要進資料庫：解鎖是伺服器算的（refresh_achievements()），它得知道
// 有哪些成就、哪一個給哪一個外框。但名字和說明只有畫面要用，所以那些留在
// TS 那邊——**這支只搬機器要用的欄位**：id、分類、順序、獎品。
//
//   node tools/gen-achievements-seed.mjs
//
// 要跑在 gen-shop-seed.mjs 之後：reward_item 指到 shop_items，先有品項才插得進去。
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('src/data/achievements.ts', 'utf8')
const block = src.slice(src.indexOf('export const ACHIEVEMENTS'), src.indexOf('export const ACH_BY_ID'))
const rows = [...block.matchAll(/\{\s*id:\s*'([^']+)',\s*category:\s*'([^']+)',[^}]*\}/g)]
  .map((m, i) => ({
    id: m[1],
    category: m[2],
    ord: i,
    item: m[0].match(/rewardItem:\s*'([^']+)'/)?.[1] ?? null,
    title: m[0].match(/rewardTitle:\s*'([^']+)'/)?.[1] ?? '',
  }))

if (rows.length !== 42) throw new Error('成就數不是 42，是不是改了？' + rows.length)
const dup = rows.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dup.length) throw new Error('成就 id 重複：' + dup.join('、'))

const sql = `
-- 成就目錄。**這一段是 tools/gen-achievements-seed.mjs 從 src/data/achievements.ts
-- 產生的，不要手改。** 名字與說明在 TS 那邊，這裡只有伺服器算解鎖要用的欄位。
insert into public.achievements (id, category, ord, reward_item, reward_title) values
${rows.map((r) => `  ('${r.id}', '${r.category}', ${r.ord}, ${r.item ? `'${r.item}'` : 'null'}, '${r.title}')`).join(',\n')}
on conflict (id) do update
  set category = excluded.category, ord = excluded.ord,
      reward_item = excluded.reward_item, reward_title = excluded.reward_title;

-- 目錄以這份清單為準。刪掉的成就要跟著消失，不然畫面上沒有、資料庫裡卻還在，
-- 別人的徽章牆上會冒出一個誰都看不懂的東西。
delete from public.achievements where id not in (${rows.map((r) => `'${r.id}'`).join(', ')});
`

const marker = '-- 成就目錄。'
let seed = readFileSync('supabase/seed.sql', 'utf8')
const i = seed.indexOf(marker)
if (i >= 0) {
  const j = seed.indexOf('\ncommit;', i)
  seed = seed.slice(0, i) + sql.trimStart() + seed.slice(j)
} else {
  seed = seed.replace(/\ncommit;\s*$/, '\n' + sql + '\ncommit;\n')
}
writeFileSync('supabase/seed.sql', seed)
console.log('寫進 seed.sql：' + rows.length + ' 個成就，'
  + rows.filter((r) => r.item).length + ' 個外框獎品，'
  + rows.filter((r) => r.title).length + ' 個稱號')
