# Supabase

## 要做什麼

1. 在 Supabase 後台 → SQL Editor，把 `schema.sql` **整份**貼上去按 Run。
2. 同樣的地方，把 `seed.sql` 整份貼上去按 Run（300 字題庫與 14 關）。
3. Authentication → Providers，把 **Anonymous sign-ins** 打開（學生用匿名登入進場）。
4. 前端需要兩個值，放在 `.env`：

```
VITE_SUPABASE_URL=https://<你的專案>.supabase.co
VITE_SUPABASE_KEY=sb_publishable_...
```

兩份 SQL 都可以重複執行，不會洗掉學生資料。

## 千萬不要

- **不要把 `sb_secret_...`（以前叫 service_role）那把金鑰放進 repo，也不要貼給任何人。** 那把會繞過底下所有權限檢查。
- 前端只放 `sb_publishable_...`（以前叫 anon）那把。它本來就設計成公開的，安全是靠 RLS，不是靠藏金鑰。

## 這份 schema 在防什麼

前端那把金鑰是公開的，所以任何人都可以直接打資料庫。防線是：

- 所有資料表都開了 RLS，而且**沒有給任何 insert / update / delete 權限**。學生想直接把金幣改成 999999 會被擋掉。
- 會加錢的動作只有兩支 RPC：`submit_answers`（答題）與 `save_progress`（首次通關獎勵）。金幣多少由資料庫自己算，客戶端送什麼都不算數。
- 老師的函式都先檢查「這是不是你的班」。

已知還擋不住的：`save_progress` 的「我贏了」跟星星數還是前端說了算，要真的擋住得由伺服器重跑一場。目前的緩衝是首次通關獎金要求「最近一小時在這一關真的答對過 10 題」。

## 帳號怎麼分

- **學生**：匿名登入 + 班級代碼 + 暱稱。不收真實姓名與 email。同一個暱稱在同一班就是同一個人，所以換平板會接回同一個存檔——這就是要接後端的理由。
- **老師**：真的 email 帳號。`create_class` 會擋掉匿名帳號。

同班同學之間**看得到彼此的暱稱**（排行榜要用），但看不到彼此的角色存檔與答題紀錄。

`students.pin_hash` 是留給「防同學互相亂用暱稱」的，現在前端都傳 null 所以等於沒開。要開的時候前端多一個四位數欄位就好，資料表不用再改。

## 改之前先跑測試

```
./tools/test/db.sh
```

會在本機開一個空的 Postgres 跑整份 SQL，用不同身分把每一條權限規則實際打一次，最後對帳前端 `src/core/economy.ts` 與後端 `coin_value()` 算出來的金幣是不是一樣。
