-- 帳號改版：把使用者相關的資料表砍掉重建。
--
-- **這會刪掉所有學生、角色、答題紀錄、班級。**
-- 只在「還沒有任何真的班級上線」之前用。上線之後要改結構請改寫成 alter。
--
-- 題庫（words）與關卡（levels）不在這裡面，所以 seed.sql 不用重跑。
--
-- 為什麼是砍掉重建：帳號從「班級代碼＋暱稱」改成「自己註冊的帳號密碼」，
-- students 的欄位、唯一鍵、外鍵全部變了。做這次改版時資料庫裡確認是
-- 0 個學生、0 個班級、0 個帳號，所以砍掉重建比一長串 alter 乾淨，
-- 也不會留下改到一半的中間狀態。
--
-- 用法：先跑這一支，再跑 schema.sql。

begin;

drop table if exists public.teacher_open    cascade;
drop table if exists public.level_progress  cascade;
drop table if exists public.word_stats      cascade;
drop table if exists public.answer_events   cascade;
drop table if exists public.characters      cascade;
drop table if exists public.student_links   cascade;
drop table if exists public.students        cascade;
drop table if exists public.classes         cascade;
drop table if exists public.teacher_invites cascade;
drop table if exists public.teachers        cascade;

-- 舊版簽名的函式。新版簽名不同，不 drop 的話舊的會留著被呼叫得到。
drop function if exists public.join_class(text, text, text);
drop function if exists public.teacher_reset_pin(uuid, text);
drop function if exists public.teacher_add_student(text, text);

commit;
