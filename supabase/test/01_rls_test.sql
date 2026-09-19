-- 權限規則的實測。RLS 這種東西沒有真的打過就是不知道對不對，所以每一條都打一次。
-- 跑法見 supabase/test/README.md。任何一條不成立就會直接中止並印出是哪一條。

\set ON_ERROR_STOP on
\timing off
\pset tuples_only on
\pset format unaligned

create or replace function test_ok(p_cond boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_cond then
    raise notice '  ✓ %', p_what;
  else
    raise exception '✗ 這一條不成立：%', p_what;
  end if;
end $$;

-- 期待會被擋下來的動作。沒被擋下來才是出事。
create or replace function test_denied(p_sql text, p_what text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception '✗ 這個動作應該被擋掉卻成功了：%', p_what;
exception
  when insufficient_privilege or raise_exception or check_violation then
    raise notice '  ✓ 擋下來了：%', p_what;
end $$;

create or replace function test_as(p_uid text, p_anon boolean) returns void
language plpgsql as $$
begin
  perform set_config('test.uid', p_uid, false);
  perform set_config('test.jwt', json_build_object('is_anonymous', p_anon)::text, false);
end $$;

-- 清乾淨再來
delete from public.classes where code in ('RLS1','RLS2','RLS3');
delete from auth.users where id in (
  'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000012',
  'a0000000-0000-0000-0000-000000000013');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'teacher1@rlstest'),
  ('a0000000-0000-0000-0000-000000000002', 'teacher2@rlstest'),
  ('a0000000-0000-0000-0000-000000000011', null),   -- 小明的平板
  ('a0000000-0000-0000-0000-000000000012', null),   -- 小華的平板
  ('a0000000-0000-0000-0000-000000000013', null);   -- 小明改用電腦

\echo '── 老師開班'
set role authenticated;
select test_as('a0000000-0000-0000-0000-000000000001', false);
select public.create_class('RLS1', '三年二班');
select test_as('a0000000-0000-0000-0000-000000000002', false);
select public.create_class('RLS2', '別班');

\echo '── 匿名帳號不能開班'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select test_denied($$ select public.create_class('RLS3','偷開的班') $$, '匿名帳號開班');

\echo '── 學生進場'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select public.join_class('RLS1', '小明');
select test_as('a0000000-0000-0000-0000-000000000012', true);
select public.join_class('RLS1', '小華');

\echo '── 打錯班級代碼進不來'
select test_denied($$ select public.join_class('NOPE','小華') $$, '不存在的班級代碼');

\echo '── 換一台裝置，同樣的暱稱要接回同一個存檔（這就是接後端的理由）'
do $$
declare v_old uuid; v_new uuid;
begin
  perform test_as('a0000000-0000-0000-0000-000000000011', true);
  select public.current_student_id() into v_old;
  perform test_as('a0000000-0000-0000-0000-000000000013', true);
  perform public.join_class('RLS1', '小明');
  select public.current_student_id() into v_new;
  perform test_ok(v_old = v_new, '換裝置之後還是同一個學生');
end $$;

\echo '── 答題：金幣只能從這支 RPC 來'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select public.submit_answers($$[
  {"wordId":1,"skill":"recognize","correct":true,"ms":1200,"combo":0,"gameId":"tower-defense","levelId":"td-01"},
  {"wordId":2,"skill":"recognize","correct":false,"ms":3000,"combo":1,"gameId":"tower-defense","levelId":"td-01"},
  {"wordId":1,"skill":"recognize","correct":true,"ms":900,"combo":0,"gameId":"tower-defense","levelId":"td-01"}
]$$::jsonb);

do $$
declare v_coins int; v_seen int;
begin
  select c.coins into v_coins from public.characters c where c.student_id = public.current_student_id();
  -- 120 起跳；zero 是第 1 級（基礎 3），第一次 +3，第二次已經答對過一次所以還是 ×1 → +3
  perform test_ok(v_coins = 126, '金幣入帳正確（120 + 3 + 3），實際 ' || v_coins);
  select ws.seen into v_seen from public.word_stats ws
   where ws.student_id = public.current_student_id() and ws.word_id = 1 and ws.skill = 'recognize';
  perform test_ok(v_seen = 2, '掌握度有跟著更新');
end $$;

\echo '── 題庫裡沒有的字直接忽略，不會炸掉也不會給錢'
do $$
declare v_before int; v_after int;
begin
  select c.coins into v_before from public.characters c where c.student_id = public.current_student_id();
  perform public.submit_answers('[{"wordId":99999,"skill":"recognize","correct":true,"ms":100,"combo":0,"gameId":"x"}]'::jsonb);
  select c.coins into v_after from public.characters c where c.student_id = public.current_student_id();
  perform test_ok(v_before = v_after, '亂送字號不會加錢');
end $$;

\echo '── 學生不能自己改金幣、不能自己塞答題紀錄'
select test_denied($$ update public.characters set coins = 999999 $$, '直接改 coins');
select test_denied($$ update public.characters set items = '{"sword":99}'::jsonb $$, '直接塞道具');
select test_denied($$ insert into public.answer_events (student_id, word_id, skill, correct, ms, combo, game_id)
                      values (public.current_student_id(), 1, 'recognize', true, 1, 0, 'x') $$, '直接寫答題紀錄');
select test_denied($$ update public.level_progress set stars = 3 $$, '直接改星星');
select test_denied($$ insert into public.teacher_open (class_code, level_id) values ('RLS1','td-14') $$, '學生自己開關卡');

\echo '── 同學之間看不到彼此的存檔與答題紀錄'
do $$
declare v_chars int; v_events int; v_students int;
begin
  perform test_as('a0000000-0000-0000-0000-000000000012', true);   -- 小華
  select count(*) into v_chars  from public.characters;
  select count(*) into v_events from public.answer_events;
  select count(*) into v_students from public.students;
  perform test_ok(v_chars  = 1, '小華只看得到自己的角色，看到 ' || v_chars);
  perform test_ok(v_events = 0, '小華看不到小明的答題紀錄，看到 ' || v_events);
  -- 暱稱是刻意開放的，排行榜要用，而且這裡本來就沒有真實姓名
  perform test_ok(v_students = 2, '同班的暱稱看得到（排行榜要用），看到 ' || v_students);
end $$;

\echo '── 學生不能碰老師的東西'
select test_denied($$ select public.teacher_set_open('RLS1', array['td-14']) $$, '學生開放關卡');
select test_denied($$ select public.class_most_missed('RLS1') $$, '學生看全班錯字報表');
select test_denied($$ select public.teacher_add_student('RLS1','幽靈同學') $$, '學生加人');

\echo '── 別班的老師也不行'
select test_as('a0000000-0000-0000-0000-000000000002', false);
select test_denied($$ select public.teacher_set_open('RLS1', array['td-14']) $$, '別班老師開放這一班的關卡');
do $$
declare n int;
begin
  select count(*) into n from public.class_overview('RLS1');
  perform test_ok(n = 0, '別班老師看不到這一班的進度，看到 ' || n);
end $$;

\echo '── 自己班的老師看得到'
select test_as('a0000000-0000-0000-0000-000000000001', false);
do $$
declare n int; m int;
begin
  select count(*) into n from public.class_overview('RLS1');
  perform test_ok(n = 2, '老師看得到全班兩個人，看到 ' || n);
  select count(*) into m from public.class_most_missed('RLS1');
  perform test_ok(m >= 1, '最常錯的字報表有東西');
end $$;
select public.teacher_set_open('RLS1', array['td-05','td-10']);
do $$
declare n int;
begin
  select count(*) into n from public.teacher_open where class_code = 'RLS1';
  perform test_ok(n = 2, '老師開放了兩關');
end $$;

\echo '── 首次通關獎勵：答不到 10 題不給，給過就不再給'
select test_as('a0000000-0000-0000-0000-000000000011', true);
do $$
declare v_bonus int;
begin
  select bonus_coins into v_bonus from public.save_progress('td-01', 3, 2, true);
  perform test_ok(v_bonus = 0, '只答對兩題就說通關，不給獎金');

  -- 補到 10 題答對
  perform public.submit_answers((
    select jsonb_agg(jsonb_build_object(
      'wordId', 10 + i, 'skill', 'recognize', 'correct', true,
      'ms', 1000, 'combo', 0, 'gameId', 'tower-defense', 'levelId', 'td-01'))
    from generate_series(1, 12) i));

end $$;

-- 上面那次已經把 cleared_at 寫進去了，清掉再測一次首殺。
-- 學生自己刪不掉（剛才就是這樣被擋下來的），所以這一步要跳出 authenticated。
reset role;
delete from public.level_progress lp
 using public.students s
 where lp.student_id = s.id and s.class_code = 'RLS1' and s.nickname = '小明'
   and lp.level_id = 'td-01';
set role authenticated;
select test_as('a0000000-0000-0000-0000-000000000011', true);

do $$
declare v_bonus int;
begin
  select bonus_coins into v_bonus from public.save_progress('td-01', 3, 12, true);
  perform test_ok(v_bonus = 50, '首次通關第 1 關給 50，實際 ' || v_bonus);

  select bonus_coins into v_bonus from public.save_progress('td-01', 3, 12, true);
  perform test_ok(v_bonus = 0, '重玩不再給首殺獎金');
end $$;

\echo '── 沒有這一關就不要給我亂存'
select test_denied($$ select public.save_progress('td-99', 3, 99, true) $$, '不存在的關卡');

\echo '── 星星取高的，通關時間不覆蓋'
do $$
declare v_stars int; v_cleared timestamptz; v_first timestamptz;
begin
  select lp.cleared_at into v_first from public.level_progress lp
   where lp.student_id = public.current_student_id() and lp.level_id = 'td-01';
  perform public.save_progress('td-01', 1, 3, true);
  select stars, cleared_at into v_stars, v_cleared from public.level_progress
   where student_id = public.current_student_id() and level_id = 'td-01';
  perform test_ok(v_stars = 3, '重玩拿 1 顆星不會蓋掉原本的 3 顆');
  perform test_ok(v_cleared = v_first, '首次通關時間保留');
end $$;

\echo '── 排行榜看得到同班，看不到別班'
do $$
declare n int;
begin
  select count(*) into n from public.class_leaderboard();
  perform test_ok(n = 2, '排行榜有同班兩個人，看到 ' || n);
  select count(*) into n from public.class_leaderboard('RLS2');
  perform test_ok(n = 0, '看不到別班的排行榜');
end $$;

\echo '── 密碼（之後要防同學互相亂用時才開，資料表已經準備好）'
select test_as('a0000000-0000-0000-0000-000000000001', false);
do $$
declare v_id uuid;
begin
  select s.id into v_id from public.students s
   where s.class_code = 'RLS1' and s.nickname = '小華';
  perform public.teacher_reset_pin(v_id, '1234');
end $$;
select test_as('a0000000-0000-0000-0000-000000000012', true);
select test_denied($$ select public.join_class('RLS1','小華') $$, '有設密碼卻沒帶密碼');
select test_denied($$ select public.join_class('RLS1','小華','9999') $$, '密碼打錯');
do $$ begin
  perform public.join_class('RLS1','小華','1234');
  perform test_ok(true, '密碼對就進得來');
end $$;

\echo '── 掌握度可以從事件重算（事件才是真相，那張表只是快取）'
select test_as('a0000000-0000-0000-0000-000000000011', true);
do $$
declare v_before int; v_after int;
begin
  select sum(ws.seen) into v_before from public.word_stats ws
   where ws.student_id = public.current_student_id();
  perform public.rebuild_word_stats(public.current_student_id());
  select sum(ws.seen) into v_after from public.word_stats ws
   where ws.student_id = public.current_student_id();
  perform test_ok(v_before = v_after, '重算出來的總次數一樣（' || v_before || '）');
end $$;
select test_denied($$ select public.rebuild_word_stats('a0000000-0000-0000-0000-000000000099'::uuid) $$,
                   '重算別人的掌握度');

reset role;
\echo ''
\echo '全部通過'
