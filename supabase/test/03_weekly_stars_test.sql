-- 本週之星（class_weekly_stars）的實測。跑法：由 tools/test/db.sh 帶起來。
--
-- 要驗的是三件事：每格挑對人、一個人最多上一格、別班看不到。

\set ON_ERROR_STOP on
\timing off
\pset tuples_only on
\pset format unaligned

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

-- 塞 p_n 題全對、每題不同字（第 p_skip+1 個字起）
create or replace function test_wk(p_student uuid, p_n int, p_at timestamptz,
                                   p_skill text default 'recognize') returns void
language plpgsql security definer as $$
begin
  insert into public.answer_events (student_id, word_id, skill, correct, ms, combo, game_id, at)
  select p_student, w.id, p_skill, true, 1000, 0, 'test', p_at
    from (select id from public.words order by id limit p_n) w;
end $$;

-- 這一格是誰
create or replace function test_star(p_slot text) returns text
language sql as $$
  select coalesce((select nickname from public.class_weekly_stars() where slot = p_slot), '（沒有人）');
$$;

delete from public.students where login_id like 'wk\_%';
delete from public.classes where code in ('WK1', 'WK2');
delete from auth.users where id::text like 'd0000000%';

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', null),
  ('d0000000-0000-0000-0000-000000000006', null),
  ('d0000000-0000-0000-0000-000000000009', 'wkteacher@wktest.local');

select test_force($$
  insert into public.teachers (user_id, display_name, is_admin, active)
  values ('d0000000-0000-0000-0000-000000000009', '本週之星老師', false, true)
  on conflict (user_id) do nothing;
  insert into public.classes (code, name, owner, open) values
    ('WK1', '本週之星班', 'd0000000-0000-0000-0000-000000000009', true),
    ('WK2', '隔壁班', 'd0000000-0000-0000-0000-000000000009', true);
  insert into public.students (id, login_id, pw_hash, nickname, class_code) values
    ('d1000000-0000-0000-0000-000000000001', 'wk_a', 'x', '小甲', 'WK1'),
    ('d1000000-0000-0000-0000-000000000002', 'wk_b', 'x', '小乙', 'WK1'),
    ('d1000000-0000-0000-0000-000000000003', 'wk_c', 'x', '小丙', 'WK1'),
    ('d1000000-0000-0000-0000-000000000004', 'wk_d', 'x', '小丁', 'WK1'),
    ('d1000000-0000-0000-0000-000000000005', 'wk_e', 'x', '小戊', 'WK1'),
    ('d1000000-0000-0000-0000-000000000006', 'wk_f', 'x', '隔壁', 'WK2');
  insert into public.characters (student_id, job)
    select id, 'knight' from public.students where login_id like 'wk\_%';
  insert into public.student_links (user_id, student_id) values
    ('d0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001'),
    ('d0000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000006');
$$);

set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000001', true);

\echo '── 一題都沒答：一格都沒有'
select test_ok((select count(*) from public.class_weekly_stars()) = 0, '沒人答題就沒有本週之星');

\echo '── 塞一週的紀錄'
select test_force($$
  -- 本週：小甲 50、小乙 30、小丙 20、小戊拼字 6＋聽力 6
  select test_wk('d1000000-0000-0000-0000-000000000001', 50, now() - interval '1 second');
  select test_wk('d1000000-0000-0000-0000-000000000002', 30, now() - interval '1 second');
  select test_wk('d1000000-0000-0000-0000-000000000003', 20, now() - interval '1 second');
  select test_wk('d1000000-0000-0000-0000-000000000005', 6, now() - interval '1 second', 'spell');
  select test_wk('d1000000-0000-0000-0000-000000000005', 6, now() - interval '1 second', 'listen');
  -- 同一個字一天答對 20 次也只算 5 次：小丁狂刷一個字，本週只算 5 題
  insert into public.answer_events (student_id, word_id, skill, correct, ms, combo, game_id, at)
    select 'd1000000-0000-0000-0000-000000000004', (select min(id) from public.words),
           'recognize', true, 1000, 0, 'test', now() - interval '1 second'
      from generate_series(1, 20);
  -- 上週同一段時間：小丙 18（所以只進步 2）；上上週的不算
  select test_wk('d1000000-0000-0000-0000-000000000003', 18, now() - interval '7 days 1 minute');
  select test_wk('d1000000-0000-0000-0000-000000000002', 40, now() - interval '30 days');
  -- 徽章：小甲、小乙本週都拿到「第一題」（兩個人有），小丁拿到萬題金階（只有他有）
  insert into public.student_achievements (student_id, achievement_id, tier, unlocked_at) values
    ('d1000000-0000-0000-0000-000000000001', 'first-answer', 1, now()),
    ('d1000000-0000-0000-0000-000000000002', 'first-answer', 1, now()),
    ('d1000000-0000-0000-0000-000000000004', 'hundred', 3, now());
  -- 魔王團戰：小丙贏兩場共 900 傷害；小甲贏一場 2000 傷害（但他已經是答對最多了）
  insert into public.rooms (id, class_code, level_id, opened_by, started_at) values
    ('d2000000-0000-0000-0000-000000000001', 'WK1', 'td-01', 'd0000000-0000-0000-0000-000000000001', now()),
    ('d2000000-0000-0000-0000-000000000002', 'WK1', 'td-01', 'd0000000-0000-0000-0000-000000000001', now());
  insert into public.raid_seats (room_id, seat, student_id, won, dealt) values
    ('d2000000-0000-0000-0000-000000000001', 0, 'd1000000-0000-0000-0000-000000000003', true, 400),
    ('d2000000-0000-0000-0000-000000000002', 0, 'd1000000-0000-0000-0000-000000000003', true, 500),
    ('d2000000-0000-0000-0000-000000000002', 1, 'd1000000-0000-0000-0000-000000000001', true, 2000),
    ('d2000000-0000-0000-0000-000000000001', 1, 'd1000000-0000-0000-0000-000000000002', false, 3000);
$$);

\echo '── 每格挑對人'
select test_ok(test_star('most') = '小甲', '答對最多：小甲（50 題）');
select test_ok((select value from public.class_weekly_stars() where slot = 'most') = 50, '顯示 50 題');
select test_ok(test_star('improve') = '小乙',
               '進步最多：小乙（上週同一段時間 0 → 30；小丙 18 → 20 只進步 2；上上週的不算）');
select test_ok((select value || '/' || extra from public.class_weekly_stars() where slot = 'improve') = '30/0',
               '進步 30 題、上週 0 題');
select test_ok(test_star('rare') = '小丁', '最稀有徽章：小丁的萬題金階（全班只有他）');
select test_ok((select extra from public.class_weekly_stars() where slot = 'rare') = 'hundred:3',
               '帶著是哪一格、第幾階');
select test_ok(test_star('raid') = '小丙',
               '魔王 MVP：小丙（小甲傷害較高但已經上榜了；小乙那場輸了不算）');
select test_ok((select value || '/' || extra from public.class_weekly_stars() where slot = 'raid') = '900/2',
               '兩場共 900 傷害');
select test_ok(test_star('mystery') = '小戊', '神祕格：剩下的小戊');
select test_ok((select extra from public.class_weekly_stars() where slot = 'mystery') in ('spell', 'listen', 'days'),
               '神祕格帶著這週比什麼');
select test_ok((select count(distinct student_id) = count(*) from public.class_weekly_stars()),
               '一個人最多上一格');
select test_ok(not exists (select 1 from public.class_weekly_stars() where nickname = '隔壁'),
               '別班的人不會出現');

\echo '── 狂刷一個字上不了榜'
select test_ok(not exists (select 1 from public.class_weekly_stars() where nickname = '小丁' and slot <> 'rare'),
               '小丁答對 20 次同一個字只算 5 題，哪一格答題榜都沒有他');

\echo '── 誰看得到'
select test_denied($q$ select * from public.class_weekly_stars('WK2') $q$, '學生看別班的本週之星');
select test_as('d0000000-0000-0000-0000-000000000009', false, 'wkteacher@wktest.local');
select test_ok((select count(*) from public.class_weekly_stars('WK1')) = 5, '老師看自己班的五格');
select test_denied($q$ select * from public.wk_ok('WK1', now() - interval '1 day', now()) $q$,
                   '學生、老師都叫不到內部的 wk_ok');

reset role;
select test_force($$
  delete from public.rooms where id::text like 'd2000000%';
  delete from public.students where login_id like 'wk\_%';
  delete from public.classes where code in ('WK1', 'WK2');
  delete from public.teachers where user_id::text like 'd0000000%';
  delete from auth.users where id::text like 'd0000000%';
$$);

\echo '本週之星：全部通過'
