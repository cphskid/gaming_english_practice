# Supabase

## 現況：已經接上去了（2026-09-19 實測通過）

Chuck 的專案 `bxrppdsbhuhjluprohkf` 已經設定完成，**不用再手動貼 SQL**：

- `schema.sql` 與 `seed.sql` 都跑過了（300 字題庫、14 關）。
- Authentication 的 **Anonymous sign-ins 已開啟**。
- 匿名登入速率上限從預設的 30/小時**調高到 200/小時**。一個班 30 個人同時進場會直接撞到 30 那個預設值，第一次全班上線就會有人進不來。

前端要的兩個值放在 `.env`：

```
VITE_SUPABASE_URL=https://<你的專案>.supabase.co
VITE_SUPABASE_KEY=sb_publishable_...
```

## 線上實測結果（打真的 Supabase，不是本機模擬）

通過：進場、換裝置用同樣暱稱接回同一個存檔、答題寫入、金幣由資料庫計算、同字重複答對金幣遞減、掌握度統計、首次通關獎勵（沒練過拿不到／練過拿得到／重玩不再給）、四位數密碼保護、老師報表與開放關卡、排行榜。

擋下來：學生直接改金幣、直接塞答題紀錄、直接改星星、自己開班、呼叫老師專用的函式。

瀏覽器跑完整一場第 1 關：88 題三星通關，**前端顯示的金幣與資料庫算出來的完全一致**，兩套金幣算式沒有漂移。

## 之後要改 schema 怎麼做

這個開發環境**連不到 Postgres 的 5432 埠**（只有 HTTPS 出得去），所以 `psql`、連線字串、Supabase CLI 的 `db push` 全部走不通。唯一的路是 Management API：

```
curl -X POST "https://api.supabase.com/v1/projects/<專案 ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" -H "Content-Type: application/json" \
  -d '{"query": "select 1"}'
```

需要一把 Personal Access Token（`sbp_` 開頭，在 https://supabase.com/dashboard/account/tokens 產生）。**那把 token 綁的是整個帳號，權限比 service_role 還大，不進 repo，用完就去撤銷。**

## 還沒做的：老師登入畫面

資料庫這邊老師是真的 email 帳號，`create_class` 也擋掉了匿名帳號。**但前端目前沒有老師登入的畫面**，選關頁面上那顆「老師」按鈕誰都能按，而且沒有任何地方可以開班級。整班上線前一定要補這一塊。

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
