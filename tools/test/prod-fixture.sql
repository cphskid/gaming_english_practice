-- 正式站的臨時測試班級。
--
-- pack-prod-e2e.mjs 要一個真的能註冊、能買東西的學生，但不能把垃圾留在
-- 老師看得到的班級裡。所以測試前開一班 ZZ9TST，測完整班連人帶存檔刪掉。
--
-- 用法（需要 Supabase Personal Access Token，跟 Chuck 要，用完請他撤銷）：
--   建： 把「建立」那段送去 Management API 的 database/query
--   刪： 把「刪除」那段送過去
-- 學生不用在這裡建，直接在正式站的註冊畫面用邀請碼 ZZ9TST 註冊就好。

-- ── 建立 ──────────────────────────────────────────────────────────────
-- 掛在最早那位老師底下，純粹因為 classes.owner 不能是空的。
insert into public.classes (code, name, owner, open)
select 'ZZ9TST', '（測試用，可刪）', t.user_id, true
  from public.teachers t order by t.created_at limit 1
    on conflict (code) do update set open = true;

-- ── 刪除 ──────────────────────────────────────────────────────────────
-- 連匿名登入的那個 auth 使用者一起刪，不然帳號會留著卻沒有存檔。
-- delete from auth.users u
--  using public.student_links l, public.students s
--  where l.user_id = u.id and l.student_id = s.id and s.class_code = 'ZZ9TST';
-- delete from public.students where class_code = 'ZZ9TST';
-- delete from public.classes where code = 'ZZ9TST';
