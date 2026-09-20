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
const items = [...src.matchAll(/\{\s*id:\s*'([^']+)'[^}]*?\}/g)].map((m) => {
  const body = m[0]
  const one = (re) => body.match(re)?.[1] ?? null
  return {
    id: m[1],
    price: +one(/price:\s*(\d+)/),
    kind: one(/kind:\s*'([^']+)'/),
    slot: one(/slot:\s*'([^']+)'/),
    unlock: +one(/unlockLevel:\s*(\d+)/),
  }
})
if (!items.length) throw new Error('shop.ts 裡一個品項都沒抓到，格式是不是改了？')
for (const i of items) {
  if (!i.kind || !Number.isFinite(i.price) || !Number.isFinite(i.unlock))
    throw new Error('這個品項少了欄位：' + i.id)
}

const sql = `
-- 商店品項。**這一段是 tools/gen-shop-seed.mjs 從 src/data/shop.ts 產生的，不要手改。**
-- 價格放在資料庫是因為客戶端送來的價格不能信。
insert into public.shop_items (id, price, kind, slot, unlock_level) values
${items.map((i) => `  ('${i.id}', ${i.price}, '${i.kind}', ${i.slot ? `'${i.slot}'` : 'null'}, ${i.unlock})`).join(',\n')}
on conflict (id) do update
  set price = excluded.price, kind = excluded.kind, slot = excluded.slot,
      unlock_level = excluded.unlock_level;

-- 商店只認這份清單。舊品項留在資料庫裡會變成「買得到但畫面上沒有」的鬼品項，
-- 所以不在清單裡的一律刪掉。
delete from public.shop_items where id not in (${items.map((i) => `'${i.id}'`).join(', ')});
`
const marker = '-- 商店品項。'
let seed = readFileSync('supabase/seed.sql', 'utf8')
const i = seed.indexOf(marker)
if (i >= 0) seed = seed.slice(0, i).replace(/\n+$/, '\n')
else seed = seed.replace(/\ncommit;\s*$/, '\n')
writeFileSync('supabase/seed.sql', seed + sql + '\ncommit;\n')
console.log('寫進 seed.sql：' + items.length + ' 個品項')
