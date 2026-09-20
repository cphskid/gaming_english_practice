// 把 src/data/shop.ts 的品項寫進 supabase/seed.sql。
//
// 為什麼要有這支：價格必須存在資料庫那邊才擋得住作弊（客戶端送什麼價格都不能信），
// 但品項內容的來源只能有一份，不然兩邊會慢慢長歪。所以來源還是 shop.ts，
// 這支負責把它翻成 SQL。改完商店就跑一次：
//
//   node tools/gen-shop-seed.mjs
//
// 對帳由 tools/test/economy-parity.mjs 負責，兩邊不一致就會紅。
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('src/data/shop.ts', 'utf8')
const items = [...src.matchAll(/\{\s*id:\s*'([^']+)'[^}]*?price:\s*(\d+),\s*kind:\s*'([^']+)',\s*unlockLevel:\s*(\d+)\s*\}/g)]
  .map((m) => ({ id: m[1], price: +m[2], kind: m[3], unlock: +m[4] }))
if (!items.length) throw new Error('shop.ts 裡一個品項都沒抓到，格式是不是改了？')

const sql = `
-- 商店品項。**這一段是 tools/gen-shop-seed.mjs 從 src/data/shop.ts 產生的，不要手改。**
-- 價格放在資料庫是因為客戶端送來的價格不能信。
insert into public.shop_items (id, price, kind, unlock_level) values
${items.map((i) => `  ('${i.id}', ${i.price}, '${i.kind}', ${i.unlock})`).join(',\n')}
on conflict (id) do update
  set price = excluded.price, kind = excluded.kind, unlock_level = excluded.unlock_level;
`
const marker = '-- 商店品項。'
let seed = readFileSync('supabase/seed.sql', 'utf8')
const i = seed.indexOf(marker)
if (i >= 0) seed = seed.slice(0, i).replace(/\n+$/, '\n')
else seed = seed.replace(/\ncommit;\s*$/, '\n')
writeFileSync('supabase/seed.sql', seed + sql + '\ncommit;\n')
console.log('寫進 seed.sql：' + items.length + ' 個品項')
