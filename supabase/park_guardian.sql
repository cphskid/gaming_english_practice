-- =============================================================================
-- 守護異世界 × 時空冒險樂園：這個遊戲交給樂園的東西
--
-- 樂園（cphskid.github.io）的規劃書「遊戲接入規則」要每個遊戲自己提供：
--   1. <前綴>_class_summary(班級代碼)：老師後台「全班總覽」那一欄
--   2. 進場時呼叫 park_can_enter('guardian')（在前端，見 src/net/supabase.ts 的 canEnter）
-- 2026-10-01 P3 從樂園的 park_teacher.sql 搬回這裡：摘要怎麼算是這個遊戲的事，
-- 改關卡、改計分時跟著改，不用動樂園。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：schema.sql → 樂園的 park_accounts.sql → 樂園的 park_teacher.sql → 這份。
-- 重跑 schema.sql 之後（它會收回權限），樂園那兩份和這份都要再跑一次。
-- 沒套這份的話，樂園的全班總覽只會在守護異世界那一欄顯示「摘要函式還沒裝到資料庫」，其他照常。
-- =============================================================================

-- 欄位固定：學生、進度 0–100、最後遊玩、一句目前狀態、是否需要注意、一句原因。
-- 看的是班上所有成員（park_class_members），不只把這班當主要班級的學生。
create or replace function public.guardian_class_summary(p_code text)
returns table (student_id uuid, progress int, last_played timestamptz,
               status text, attention boolean, reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (select upper(btrim(coalesce(p_code, ''))) as code),
  total as (select greatest(count(*), 1) as n from public.levels),
  kids as (
    select s.id, s.locked_until
      from public.park_class_members m
      join public.students s on s.id = m.student_id
      join target t on t.code = m.class_code
     where public.is_teacher_of(t.code)
  ),
  stat as (
    select k.id, k.locked_until,
           (select count(*) from public.level_progress lp
             where lp.student_id = k.id and lp.cleared_at is not null) as cleared,
           (select l.chapter || ':' || l.no || ':' || l.name
              from public.level_progress lp join public.levels l on l.id = lp.level_id
             where lp.student_id = k.id and lp.cleared_at is not null
             order by l.no desc limit 1) as best,
           (select max(ae.at) from public.answer_events ae where ae.student_id = k.id) as last_at,
           (select round(100 * avg(case when x.correct then 1 else 0 end))::int
              from (select ae.correct from public.answer_events ae
                     where ae.student_id = k.id order by ae.at desc limit 50) x) as recent_acc,
           (select count(*) from (select 1 from public.answer_events ae
                     where ae.student_id = k.id order by ae.at desc limit 50) x) as recent_n
      from kids k
  )
  select st.id,
         least(100, round(100.0 * st.cleared / (select n from total)))::int,
         st.last_at,
         case
           when st.last_at is null then '還沒開始'
           when st.best is null then '還在挑戰第 1 關'
           else '已過第 ' || split_part(st.best, ':', 2) || ' 關「' || split_part(st.best, ':', 3)
                || '」（第' || substr('一二三四五', split_part(st.best, ':', 1)::int, 1) || '章）'
         end,
         (coalesce(st.locked_until > now(), false)
          or st.last_at is null
          or st.last_at < now() - interval '7 days'
          or (st.recent_n >= 20 and st.recent_acc < 60)),
         case
           when coalesce(st.locked_until > now(), false) then '密碼試錯太多次被鎖住了，可以幫他重設密碼'
           when st.last_at is null then '還沒玩過'
           when st.last_at < now() - interval '7 days'
             then extract(day from now() - st.last_at)::int || ' 天沒玩了'
           when st.recent_n >= 20 and st.recent_acc < 60
             then '最近 ' || st.recent_n || ' 題只答對 ' || st.recent_acc || '%'
           else null
         end
    from stat st;
$$;

revoke all on function public.guardian_class_summary(text) from public, anon, authenticated;
grant execute on function public.guardian_class_summary(text) to authenticated;
