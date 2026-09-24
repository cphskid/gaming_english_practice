-- 成就的實測。
--
-- 為什麼要測：解鎖條件有四十二條，全部寫在 refresh_achievements() 裡面，
-- 而它算的是**別人看得到的東西**（徽章會出現在同學點得進來的個人檔案上）。
-- 算錯了不是顯示問題，是「他明明做到了卻沒拿到」或「他沒做到卻有」。
--
-- 跑法：跟 01_rls_test.sql 一樣，由 tools/test/db.sh 帶起來。

\set ON_ERROR_STOP on
\timing off
\pset tuples_only on
\pset format unaligned

-- test_ok / test_denied / test_as / test_force 由 01_rls_test.sql 建好了，
-- 但這支也可能單獨跑，所以再建一次（create or replace，重複無害）。
create or replace function test_ok(p_cond boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_cond then raise notice '  ✓ %', p_what;
  else raise exception '✗ 這一條不成立：%', p_what; end if;
end $$;

create or replace function test_denied(p_sql text, p_what text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception '✗ 這個動作應該被擋掉卻成功了：%', p_what;
exception
  when insufficient_privilege or raise_exception or check_violation or unique_violation then
    raise notice '  ✓ 擋下來了：%', p_what;
end $$;

create or replace function test_as(p_uid text, p_anon boolean, p_email text default null) returns void
language plpgsql as $$
begin
  perform set_config('test.uid', p_uid, false);
  perform set_config('test.jwt',
    json_build_object('is_anonymous', p_anon, 'email', p_email)::text, false);
end $$;

create or replace function test_force(p_sql text) returns void
language plpgsql security definer as $$
begin execute p_sql; end $$;

-- 我有沒有這一個徽章
create or replace function test_has(p_student uuid, p_id text) returns boolean
language sql security definer as $$
  select exists (select 1 from public.student_achievements
                  where student_id = p_student and achievement_id = p_id);
$$;

-- 背包裡有幾個這個東西
create or replace function test_item(p_student uuid, p_item text) returns int
language sql security definer as $$
  select coalesce((c.items ->> p_item)::int, 0)
    from public.characters c where c.student_id = p_student;
$$;

-- 塞一批答題事件。correct 全對，時間可以指定，不然習慣類測不了。
create or replace function test_events(
  p_student uuid, p_n int, p_skill text default 'recognize',
  p_at timestamptz default now(), p_level text default null,
  p_session uuid default null, p_combo int default 0, p_correct boolean default true)
returns void language plpgsql security definer as $$
begin
  insert into public.answer_events
    (student_id, word_id, skill, correct, ms, combo, game_id, level_id, session_id, ord, at)
  select p_student, w.id, p_skill, p_correct, 1200, p_combo, 'test', p_level, p_session,
         row_number() over (), p_at
    from (select id from public.words order by id limit p_n) w;
end $$;

-- 清乾淨再來
delete from public.students where login_id like 'ach%';
delete from public.classes where code in ('ACH1');
delete from auth.users where id::text like 'b0000000%';

insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-000000000001', null),   -- 小成的平板
  ('b0000000-0000-0000-0000-000000000002', null),   -- 同學小就
  ('b0000000-0000-0000-0000-000000000009', 'achteacher@achtest.local');

select test_force($$
  insert into public.teachers (user_id, display_name, is_admin, active)
  values ('b0000000-0000-0000-0000-000000000009', '成就測試老師', false, true)
  on conflict (user_id) do nothing;
  insert into public.classes (code, name, owner, open)
  values ('ACH1', '成就測試班', 'b0000000-0000-0000-0000-000000000009', true);
  insert into public.students (id, login_id, pw_hash, nickname, class_code, created_at)
  values ('b1000000-0000-0000-0000-000000000001', 'ach_one', 'x', '小成', 'ACH1',
          now() - interval '40 days'),
         ('b1000000-0000-0000-0000-000000000002', 'ach_two', 'x', '小就', 'ACH1', now());
  insert into public.characters (student_id, job, exp, coins, avatar)
  values ('b1000000-0000-0000-0000-000000000001', 'knight', 600, 9000, 'Avatars_01'),
         ('b1000000-0000-0000-0000-000000000002', 'mage', 100, 100, 'Avatars_02');
  insert into public.student_links (user_id, student_id) values
    ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002');
$$);

set role authenticated;
select test_as('b0000000-0000-0000-0000-000000000001', true);

\echo '── 一題都沒答的時候'
select test_ok((select count(*) from public.refresh_achievements()) = 0, '什麼都還沒有');
select test_ok((select count(*) from public.my_achievements()) = 42, '牆上四十二格都回得出來');
select test_ok((select count(*) from public.my_achievements() where unlocked_at is not null) = 0,
               '一個都還沒解開');

\echo '── 學習：答對就有第一個'
select test_force($$ select test_events('b1000000-0000-0000-0000-000000000001', 1) $$);
select test_ok(exists (select 1 from public.refresh_achievements() r where r = 'first-answer'),
               '答對第一題就解開「第一題」');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'first-answer'), '而且存起來了');
select test_ok((select count(*) from public.refresh_achievements()) = 0,
               '再算一次不會重複解開同一個');

\echo '── 學習：一百題'
select test_force($$ select test_events('b1000000-0000-0000-0000-000000000001', 100) $$);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'hundred'), '一百題');

\echo '── 守塔：通關、三星、城牆不倒、全破'
select test_force($$
  insert into public.level_progress (student_id, level_id, stars, best_correct, cleared_at, best_survival)
  values ('b1000000-0000-0000-0000-000000000001', 'td-01', 2, 20, now(), 0.5)
$$);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'first-clear'), '通關第一關');
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'three-star'), '兩顆星還不算滿星');
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'no-damage'), '掉過血就不算城牆不倒');

select test_force($$
  update public.level_progress set stars = 3, best_survival = 1
   where student_id = 'b1000000-0000-0000-0000-000000000001' and level_id = 'td-01'
$$);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'three-star'), '三顆星');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'no-damage'), '一滴血都沒掉');
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'all-clear'), '只過一關不算全破');

select test_force($$
  insert into public.level_progress (student_id, level_id, stars, best_correct, cleared_at, best_survival)
  select 'b1000000-0000-0000-0000-000000000001', l.id, 1, 20, now(), 0.2
    from public.levels l where l.id <> 'td-01'
$$);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'all-clear'), '十四關全破');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'boss-slayer'), '三個魔王關都過了');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'stars-30')
               = ((select sum(stars) from public.level_progress
                    where student_id = 'b1000000-0000-0000-0000-000000000001') >= 30),
               '星星三十跟實際星數一致');

\echo '── 獎品：成就限定的外框直接進背包，而且買不到'
select test_ok(test_item('b1000000-0000-0000-0000-000000000001', 'frame-flame') = 1,
               '全破就拿到火焰框');
select public.refresh_achievements();
select test_ok(test_item('b1000000-0000-0000-0000-000000000001', 'frame-flame') = 1,
               '重算幾次都只有一個，不會越算越多');
select test_denied($$ select public.buy_item('frame-flame') $$, '花錢買成就限定的外框');

\echo '── 對戰：戰績表'
select test_ok((select public.record_versus_match(
                  'c0000000-0000-0000-0000-000000000001'::uuid, 'cpu', true,
                  0.9, 0.2, array['recognize','spell','listen'], 3, '電腦對手')) is not null,
               '記得下一場兵推');
select test_ok((select public.record_versus_match(
                  'c0000000-0000-0000-0000-000000000001'::uuid, 'cpu', true,
                  0.9, 0.2, array['recognize'], 1, '電腦對手')) is not null,
               '同一場重送也回得了 id');
select test_ok((select count(*) from public.versus_matches
                 where student_id = 'b1000000-0000-0000-0000-000000000001') = 1,
               '但只會有一筆，不會變成兩場');
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'first-match'), '初上戰場');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'all-lines'), '三線通吃');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'top-tier'), '推出三階兵');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'comeback'), '被推到兩成還贏回來');
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'war-flag'),
               '贏電腦不算勝場');

\echo '── 對戰：贏電腦贏幾場都拿不到戰旗，贏同學五場才有'
select test_force($$
  insert into public.versus_matches
    (student_id, session_id, opponent_kind, won, front, lowest_front, lines_used, top_tier)
  select 'b1000000-0000-0000-0000-000000000001', gen_random_uuid(), 'cpu', true,
         0.9, 0.5, array['recognize'], 1 from generate_series(1, 10)
$$);
select public.refresh_achievements();
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'war-flag'),
               '贏電腦十場還是沒有戰旗');
select test_force($$
  insert into public.versus_matches
    (student_id, session_id, opponent_kind, opponent_student, won, front, lowest_front,
     lines_used, top_tier)
  select 'b1000000-0000-0000-0000-000000000001', gen_random_uuid(), 'student',
         'b1000000-0000-0000-0000-000000000002', true, 0.9, 0.5, array['recognize'], 1
    from generate_series(1, 5)
$$);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'war-flag'), '贏同學五場');

\echo '── 對戰：連輸兩場之後又開一場（輸的人也拿得到的那一個）'
select test_ok(not test_has('b1000000-0000-0000-0000-000000000002', 'never-quit'),
               '小就還沒輸過');
select test_force($$
  insert into public.versus_matches
    (student_id, session_id, opponent_kind, won, front, lowest_front, lines_used, top_tier, ended_at)
  values ('b1000000-0000-0000-0000-000000000002', gen_random_uuid(), 'cpu', false,
          0.2, 0.2, array['recognize'], 1, now() - interval '3 minutes'),
         ('b1000000-0000-0000-0000-000000000002', gen_random_uuid(), 'cpu', false,
          0.2, 0.2, array['recognize'], 1, now() - interval '2 minutes'),
         ('b1000000-0000-0000-0000-000000000002', gen_random_uuid(), 'cpu', false,
          0.3, 0.3, array['recognize'], 1, now() - interval '1 minute')
$$);
select test_as('b0000000-0000-0000-0000-000000000002', true);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000002', 'never-quit'),
               '連輸兩場還願意再開一場');
select test_as('b0000000-0000-0000-0000-000000000001', true);

\echo '── 道具：用過什麼要記得（背包只存剩幾個，用完就歸零）'
select test_force($$
  update public.characters set items = '{"slow-30":1,"heal-5":1,"crystal-40":1}'::jsonb
   where student_id = 'b1000000-0000-0000-0000-000000000001'
$$);
select public.consume_item('slow-30', 'd0000000-0000-0000-0000-000000000001'::uuid, 'td-02');
select public.consume_item('heal-5', 'd0000000-0000-0000-0000-000000000001'::uuid, 'td-02');
select public.refresh_achievements();
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'item-taster'),
               '才用兩種還不算三味');
select public.consume_item('crystal-40', 'd0000000-0000-0000-0000-000000000001'::uuid, 'td-02');
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'item-taster'), '三種道具都用過');
select test_ok(test_item('b1000000-0000-0000-0000-000000000001', 'slow-30') = 0,
               '用掉的道具真的從背包扣掉了');

\echo '── 空手過關：通關那一場沒用道具才算'
select test_force($$
  update public.level_progress
     set last_win_session = 'd0000000-0000-0000-0000-000000000001'
   where student_id = 'b1000000-0000-0000-0000-000000000001'
$$);
select public.refresh_achievements();
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'bare-handed'),
               '那一場用了道具就不算空手');
select test_force($$
  update public.level_progress set last_win_session = 'd0000000-0000-0000-0000-000000000002'
   where student_id = 'b1000000-0000-0000-0000-000000000001' and level_id = 'td-03'
$$);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'bare-handed'), '空手過關');

\echo '── 習慣：算的是「那一週來了幾天」，不是連續幾天'
select test_ok(not test_has('b1000000-0000-0000-0000-000000000002', 'week-3'), '小就還沒累積天數');
select test_force($$
  select test_events('b1000000-0000-0000-0000-000000000002', 1, 'recognize',
                     date_trunc('week', now()) + interval '10 hours');
  select test_events('b1000000-0000-0000-0000-000000000002', 1, 'recognize',
                     date_trunc('week', now()) + interval '1 day 10 hours');
  select test_events('b1000000-0000-0000-0000-000000000002', 1, 'recognize',
                     date_trunc('week', now()) + interval '3 days 10 hours');
$$);
select test_as('b0000000-0000-0000-0000-000000000002', true);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000002', 'week-3'),
               '同一週來三天（中間空一天也算）');
select test_ok(not test_has('b1000000-0000-0000-0000-000000000002', 'week-5'), '三天還不到五天');
select test_as('b0000000-0000-0000-0000-000000000001', true);

\echo '── 彩蛋：連對二十'
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'combo-20'), '還沒連對二十');
select test_force($$
  select test_events('b1000000-0000-0000-0000-000000000001', 1, 'listen', now(), null,
                     gen_random_uuid(), 20, true)
$$);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'combo-20'), '連對二十');

\echo '── 別徽章與稱號：只能別自己拿到的'
select test_ok(public.set_pinned(array['first-answer','hundred','first-clear']) is not null,
               '別得上自己的三個');
select test_ok(jsonb_array_length(public.set_pinned(
                 array['first-answer','hundred','first-clear','all-clear'])) = 3,
               '最多三個');
select test_ok(public.set_pinned(array['literate']) = '[]'::jsonb,
               '沒拿到的別不上去');
select test_denied($$ select public.set_title('literate') $$, '掛沒拿到的稱號');
select test_ok(public.set_title('first-answer') = '新生', '掛得上自己的稱號');

\echo '── 個人檔案：預設看得到，關起來就看不到，老師不受限'
select test_as('b0000000-0000-0000-0000-000000000002', true);
select test_ok((select nickname from public.public_profile(
                 'b1000000-0000-0000-0000-000000000001')) = '小成',
               '同學看得到我的檔案');
select test_as('b0000000-0000-0000-0000-000000000001', true);
select public.set_public_profile(false);
select test_as('b0000000-0000-0000-0000-000000000002', true);
select test_denied($$ select public.public_profile('b1000000-0000-0000-0000-000000000001') $$,
                   '關起來之後同學就看不到了');
select test_as('b0000000-0000-0000-0000-000000000009', false, 'achteacher@achtest.local');
select test_ok((select nickname from public.public_profile(
                 'b1000000-0000-0000-0000-000000000001')) = '小成',
               '老師一律看得到');

\echo '── 排行榜上看得出誰的檔案點得進去'
select test_as('b0000000-0000-0000-0000-000000000002', true);
select test_ok((select viewable from public.class_leaderboard()
                 where student_id = 'b1000000-0000-0000-0000-000000000001') = false,
               '關起來的那個點不進去');
select test_ok((select viewable from public.class_leaderboard()
                 where student_id = 'b1000000-0000-0000-0000-000000000002') = true,
               '自己一定點得進去');
select test_ok((select badges from public.class_leaderboard()
                 where student_id = 'b1000000-0000-0000-0000-000000000001') > 0,
               '徽章數看得到（數量不是隱私，內容才是）');

\echo '── 全能生：七類都有才給'
-- 小就只打過對戰、答過幾題，離七類還遠。
select test_as('b0000000-0000-0000-0000-000000000002', true);
select test_ok((select count(distinct a.category)
                  from public.student_achievements sa
                  join public.achievements a on a.id = sa.achievement_id
                 where sa.student_id = 'b1000000-0000-0000-0000-000000000002'
                   and a.id <> 'all-rounder') < 7,
               '小就還沒七類都有');
select test_ok(not test_has('b1000000-0000-0000-0000-000000000002', 'all-rounder'),
               '沒七類就沒有全能生');

-- 小成一路打下來，七個大類早就各有一個了，全能生就該自己冒出來。
select test_as('b0000000-0000-0000-0000-000000000001', true);
select test_ok((select count(distinct a.category)
                  from public.student_achievements sa
                  join public.achievements a on a.id = sa.achievement_id
                 where sa.student_id = 'b1000000-0000-0000-0000-000000000001'
                   and a.id <> 'all-rounder') = 7,
               '小成七個大類都有了');
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'all-rounder'),
               '七個大類都有一個就拿到全能生');
-- 每一類各塞一個給小就，湊滿七類，下一次重算就該給他。
select test_force($$
  insert into public.student_achievements (student_id, achievement_id)
  select distinct on (a.category) 'b1000000-0000-0000-0000-000000000002', a.id
    from public.achievements a
   where a.id <> 'all-rounder'
   order by a.category, a.ord
  on conflict do nothing
$$);
select test_as('b0000000-0000-0000-0000-000000000002', true);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000002', 'all-rounder'),
               '補到七類之後小就也拿到了');

reset role;
select test_force($$
  delete from public.students where login_id like 'ach%';
  delete from public.classes where code = 'ACH1';
  delete from public.teachers where user_id::text like 'b0000000%';
  delete from auth.users where id::text like 'b0000000%';
$$);

\echo '成就：全部通過'
