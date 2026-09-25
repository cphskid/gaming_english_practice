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
import { build } from 'esbuild'

// 2026-09-24 起軍團那幾行是從 data/legions.ts 用程式展開的，用正規表示式讀原始碼
// 會漏掉，所以改成真的把 shop.ts 打包起來執行一次，拿到的就是遊戲裡那一份 ITEMS。
const out = await build({
  entryPoints: ['src/data/shop.ts'], bundle: true, write: false, format: 'esm',
  platform: 'node', alias: { '@': './src' }, logLevel: 'silent',
})
const { ITEMS } = await import('data:text/javascript;base64,' +
  Buffer.from(out.outputFiles[0].text).toString('base64'))
const items = ITEMS.map((i) => ({
  id: i.id, price: i.price, kind: i.kind, slot: i.slot ?? null, unlock: i.unlockLevel,
  // 成就限定：商店買不到，只能解成就拿到
  achievementOnly: !!i.achievementOnly,
  // 送的：不用買就能穿（陣營五色）
  free: !!i.free,
  // 要先拿到哪個成就才買得到（軍團包稀有級）
  need: i.needAchievement ?? null,
  // 魔王團戰：要把第幾章全部打過才能打這隻魔王（稀有以上）
  chapter: i.needChapter ?? null,
}))
if (!items.length) throw new Error('shop.ts 裡一個品項都沒抓到')
for (const i of items) {
  if (!i.kind || !Number.isFinite(i.price) || !Number.isFinite(i.unlock))
    throw new Error('這個品項少了欄位：' + i.id)
}

const sql = `
-- 商店品項。**這一段是 tools/gen-shop-seed.mjs 從 src/data/shop.ts 產生的，不要手改。**
-- 價格放在資料庫是因為客戶端送來的價格不能信。
insert into public.shop_items (id, price, kind, slot, unlock_level, achievement_only, free, need_achievement, need_chapter) values
${items.map((i) => `  ('${i.id}', ${i.price}, '${i.kind}', ${i.slot ? `'${i.slot}'` : 'null'}, ${i.unlock}, ${i.achievementOnly}, ${i.free}, ${i.need ? `'${i.need}'` : 'null'}, ${i.chapter ?? 'null'})`).join(',\n')}
on conflict (id) do update
  set price = excluded.price, kind = excluded.kind, slot = excluded.slot,
      unlock_level = excluded.unlock_level, achievement_only = excluded.achievement_only,
      free = excluded.free, need_achievement = excluded.need_achievement,
      need_chapter = excluded.need_chapter;

-- 商店只認這份清單。舊品項留在資料庫裡會變成「買得到但畫面上沒有」的鬼品項，
-- 所以不在清單裡的一律刪掉。
delete from public.shop_items where id not in (${items.map((i) => `'${i.id}'`).join(', ')});
`
// 換掉舊的那一段就好，**後面的東西要原封不動留著**。
// 本來是「砍掉 marker 之後的全部再接上」，於是排在後面的關卡那一段
// 每跑一次就被吃掉一次（要再跑一次 gen-levels-seed.mjs 才長回來）。
const marker = '-- 商店品項。'
let seed = readFileSync('supabase/seed.sql', 'utf8')
const i = seed.indexOf(marker)
if (i >= 0) {
  const end = seed.indexOf('\n', seed.indexOf('delete from public.shop_items', i))
  seed = seed.slice(0, i) + sql.trimStart() + seed.slice(end + 1)
} else {
  seed = seed.replace(/\ncommit;\s*$/, '\n' + sql + '\ncommit;\n')
}
writeFileSync('supabase/seed.sql', seed)
console.log('寫進 seed.sql：' + items.length + ' 個品項')
