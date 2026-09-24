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
// 一筆從「{ id:」切到下一個「{ id:」。不能用 [^}]* 找結尾：說明樣板裡有 {n}。
const rows = block.split(/\n\s*\{ id: /).slice(1).map((t) => "{ id: " + t)
  .map((t) => [t, t.match(/id:\s*'([^']+)'/)[1], t.match(/category:\s*'([^']+)'/)[1]])
  .map((m, i) => ({
    id: m[1],
    category: m[2],
    ord: i,
    item: m[0].match(/rewardItem:\s*'([^']+)'/)?.[1] ?? null,
    title: m[0].match(/rewardTitle:\s*'([^']+)'/)?.[1] ?? '',
    // 分階門檻。ALL（全部）存成 -1，伺服器照當下題庫換算。
    tiers: (m[0].match(/tiers:\s*\[([^\]]*)\]/)?.[1] ?? '').split(',').map((x) => x.trim())
      .filter(Boolean).map((x) => (x === 'ALL' ? -1 : Number(x))),
    rewardTier: Number(m[0].match(/rewardTier:\s*(\d+)/)?.[1] ?? 1),
  }))

if (rows.length !== 45) throw new Error('成就數不是 45，是不是改了？' + rows.length)
for (const r of rows) {
  if (r.tiers.some((x) => Number.isNaN(x))) throw new Error(r.id + ' 的門檻有看不懂的東西')
  if (r.tiers.length && r.tiers.length !== 5) throw new Error(r.id + ' 不是五階')
}
const dup = rows.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dup.length) throw new Error('成就 id 重複：' + dup.join('、'))

const sql = `
-- 成就目錄。**這一段是 tools/gen-achievements-seed.mjs 從 src/data/achievements.ts
-- 產生的，不要手改。** 名字與說明在 TS 那邊，這裡只有伺服器算解鎖要用的欄位。
insert into public.achievements (id, category, ord, reward_item, reward_title, tiers, reward_tier) values
${rows.map((r) => `  ('${r.id}', '${r.category}', ${r.ord}, ${r.item ? `'${r.item}'` : 'null'}, '${r.title}', '{${r.tiers.join(',')}}', ${r.rewardTier})`).join(',\n')}
on conflict (id) do update
  set category = excluded.category, ord = excluded.ord,
      reward_item = excluded.reward_item, reward_title = excluded.reward_title,
      tiers = excluded.tiers, reward_tier = excluded.reward_tier;

-- 目錄以這份清單為準。刪掉的成就要跟著消失，不然畫面上沒有、資料庫裡卻還在，
-- 別人的徽章牆上會冒出一個誰都看不懂的東西。
delete from public.achievements where id not in (${rows.map((r) => `'${r.id}'`).join(', ')});
`

const marker = '-- 成就目錄。'
let seed = readFileSync('supabase/seed.sql', 'utf8')
const i = seed.indexOf(marker)
if (i >= 0) {
  // 換到這一段自己的結尾（那行 delete）為止。以前是換到 commit，
  // 會把排在後面的其他段落（關卡）一起吃掉。
  const end = seed.indexOf('delete from public.achievements', i)
  const j = seed.indexOf(';', end) + 1
  seed = seed.slice(0, i) + sql.trim() + seed.slice(j)
} else {
  seed = seed.replace(/\ncommit;\s*$/, '\n' + sql + '\ncommit;\n')
}
writeFileSync('supabase/seed.sql', seed)
console.log('寫進 seed.sql：' + rows.length + ' 個成就，'
  + rows.filter((r) => r.item).length + ' 個外框獎品，'
  + rows.filter((r) => r.title).length + ' 個稱號，'
  + rows.filter((r) => r.tiers.length).length + ' 個分階')
