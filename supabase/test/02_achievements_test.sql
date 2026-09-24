-- 成就的實測。
--
-- 為什麼要測：解鎖條件有四十五條（其中二十一條分五階），全部寫在 refresh_achievements() 裡面，
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

-- 這一格到第幾階（沒有是 0）
create or replace function test_tier(p_student uuid, p_id text) returns int
language sql security definer as $$
  select coalesce((select tier::int from public.student_achievements
                    where student_id = p_student and achievement_id = p_id), 0);
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
select test_ok((select count(*) from public.my_achievements()) = 45, '牆上四十五格都回得出來');
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
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'hundred') = 1, '一百題＝萬題銅階');
select test_ok((select value from public.my_achievements() where id = 'hundred') = 101,
               '牆上看得到現在答對幾題（「還差多少」要用）');
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'literate') = 2,
               '一百個不同的字＝識字者銀階');
select test_ok((select goal_all from public.my_achievements() where id = 'literate')
               = (select count(*) from public.words),
               '識字者的「全部」照題庫字數算');
select test_ok(test_item('b1000000-0000-0000-0000-000000000001', 'frame-laurel') = 0,
               '桂冠框要到鑽石階才給，銀階還沒有');

\echo '── 分階：同一個字一天最多算 5 次，擋掉狂刷'
select test_force($$
  insert into public.answer_events
    (student_id, word_id, skill, correct, ms, combo, game_id, ord, at)
  select 'b1000000-0000-0000-0000-000000000001', (select min(id) from public.words),
         'recognize', true, 900, 0, 'test', g, now()
    from generate_series(1, 400) g
$$);
select test_ok(exists (select 1 from public.refresh_achievements() r where r = 'hundred:1') is false,
               '同一個字刷四百次也不會升階');
select test_ok((select value from public.my_achievements() where id = 'hundred') = 104,
               '四百次只多算 3 次（那個字今天本來就答對 2 次，上限 5）');
select test_force($$
  select test_events('b1000000-0000-0000-0000-000000000001', 300, 'recognize', now() - interval '1 day');
  select test_events('b1000000-0000-0000-0000-000000000001', 300, 'recognize', now() - interval '2 days');
$$);
select test_ok(exists (select 1 from public.refresh_achievements() r where r = 'hundred:2'),
               '換天再答就算數，升到銀階會回報「hundred:2」');
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'hundred') = 2, '存成銀階');
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'days') = 0,
               '才來三天，百日還沒有');
select test_denied($$ select public.ach_put('b1000000-0000-0000-0000-000000000001', 'hundred', 99999) $$,
                   '學生自己叫 ach_put 升鑽石');

\echo '── 分階：只升不降'
select test_force($$
  update public.student_achievements set tier = 5
   where student_id = 'b1000000-0000-0000-0000-000000000001' and achievement_id = 'hundred'
$$);
select test_ok((select count(*) from public.refresh_achievements() r where r like 'hundred%') = 0,
               '重算不會回報降階');
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'hundred') = 5,
               '重算算出比較低的階，也不會把已經拿到的降下去');
select test_force($$
  update public.student_achievements set tier = 2
   where student_id = 'b1000000-0000-0000-0000-000000000001' and achievement_id = 'hundred'
$$);

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
-- 3 + 13 × 1 ＝ 16 顆：過了 15（銀）、還沒到 25（金）
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'stars-30') = 2,
               '十六顆星＝星星銀階');
select test_ok((select goal_all from public.my_achievements() where id = 'stars-30')
               = 3 * (select count(*) from public.levels), '星星的「全部」＝關數 × 3');

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
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'war-flag') = 1, '贏同學五場＝戰旗銅階');
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'veteran') = 1,
               '打完十六場＝戰場老兵銅階（輸贏都算，打電腦也算）');

\echo '── 五色軍團：顏色免費送之後，要五色都真的穿上場才算'
select test_ok((select colors_played from public.characters
                 where student_id = 'b1000000-0000-0000-0000-000000000001') ? 'blue',
               '剛剛那幾場穿的是預設藍，伺服器自己記下來了');
select public.equip_item('color-red', true);
select public.record_versus_match(gen_random_uuid(), 'cpu', false);
select public.equip_item('color-yellow', true);
select public.record_versus_match(gen_random_uuid(), 'cpu', false);
select public.equip_item('color-purple', true);
select public.record_versus_match(gen_random_uuid(), 'cpu', false);
select public.refresh_achievements();
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'five-colors'), '四色還不夠');

-- 換上別的軍團時顏色是灰的，穿著黑色去打也不算黑色
select test_force($$ update public.characters set items = items || '{"legion-goblin":1}'
                     where student_id = 'b1000000-0000-0000-0000-000000000001' $$);
select public.equip_item('legion-goblin', true);
select public.equip_item('color-black', true);
select public.record_versus_match(gen_random_uuid(), 'cpu', false);
select public.refresh_achievements();
select test_ok(not ((select colors_played from public.characters
                      where student_id = 'b1000000-0000-0000-0000-000000000001') ? 'color-black'),
               '穿著哥布林軍團打的那一場，黑色不算');
select test_ok(not test_has('b1000000-0000-0000-0000-000000000001', 'five-colors'), '所以還是沒有五色軍團');

select public.equip_item('legion-goblin', false);
select public.record_versus_match(gen_random_uuid(), 'cpu', false);
select public.refresh_achievements();
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'five-colors'),
               '脫下軍團、穿黑色打一場＝五色軍團');

\echo '── 軍團包：稀有級要先拿到「頂階降臨」才買得到'
select test_force($$ update public.characters set coins = 5000, exp = 1200
                     where student_id in ('b1000000-0000-0000-0000-000000000001',
                                          'b1000000-0000-0000-0000-000000000002') $$);
select test_ok(test_has('b1000000-0000-0000-0000-000000000001', 'top-tier'), '小明推過三階兵');
select public.buy_item('legion-pig');
select test_ok(test_item('b1000000-0000-0000-0000-000000000001', 'legion-pig') = 1, '所以買得到豬軍團');
select public.equip_item('legion-goblin', true);
select public.equip_item('legion-pig', true);
select test_ok((select equipped ? 'legion-pig' and not equipped ? 'legion-goblin' and equipped ? 'color-black'
                  from public.characters where student_id = 'b1000000-0000-0000-0000-000000000001'),
               '軍團一次只能穿一套，換軍團不會把顏色脫掉（換回王國軍時顏色還在）');
select test_as('b0000000-0000-0000-0000-000000000002', true);
select test_ok(not test_has('b1000000-0000-0000-0000-000000000002', 'top-tier'), '小就沒推過三階兵');
select test_denied($$ select public.buy_item('legion-pig') $$, '沒拿到頂階降臨就想買豬軍團');
select public.buy_item('legion-goblin');
select test_ok(test_item('b1000000-0000-0000-0000-000000000002', 'legion-goblin') = 1,
               '普通級只看等級和金幣，哥布林買得到');
select test_as('b0000000-0000-0000-0000-000000000001', true);

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
select test_ok(test_tier('b1000000-0000-0000-0000-000000000001', 'combo') = 2, '連對二十＝連對銀階');

\echo '── 別徽章與稱號：只能別自己拿到的'
select test_ok(public.set_pinned(array['first-answer','hundred','first-clear']) is not null,
               '別得上自己的三個');
select test_ok(jsonb_array_length(public.set_pinned(
                 array['first-answer','hundred','first-clear','all-clear'])) = 3,
               '最多三個');
select test_ok(public.set_pinned(array['so-close']) = '[]'::jsonb,
               '沒拿到的別不上去');
select public.set_pinned(array['first-answer','hundred','first-clear']);
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
select test_ok((select pins -> 0 ->> 'id' from public.class_leaderboard()
                 where student_id = 'b1000000-0000-0000-0000-000000000001') = 'first-answer',
               '別的徽章照順序排，第一個是主徽章');
select test_ok((select (pins -> 1 ->> 'tier')::int from public.class_leaderboard()
                 where student_id = 'b1000000-0000-0000-0000-000000000001') = 2,
               '排行榜上看得到萬題是銀階');

\echo '── 全班幾人有'
select test_ok((select holders from public.class_badge_counts()
                 where achievement_id = 'hundred' and tier = 1) = 1,
               '萬題銅階全班只有小成一個');
select test_ok((select class_size from public.class_badge_counts() limit 1) = 2,
               '全班兩個人');
select test_denied($$ select * from public.class_badge_counts('ZZZ9') $$, '看別班的徽章人數');

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

\echo '── 分身：存答題串、同學看得到、假的答題串不收'
select test_as('b0000000-0000-0000-0000-000000000001', true);
select test_force($$ select test_events('b1000000-0000-0000-0000-000000000001', 3,
                       p_session => 'c0000000-0000-0000-0000-0000000000a1') $$);
select public.record_versus_match('c0000000-0000-0000-0000-0000000000a1'::uuid, 'cpu', true,
  p_moves => '[[1.2,"a",1],[1.2,"s","recognize",1],[3,"a",0],[5.5,"a",1],[6,"u"],[8,"a",1],[8,"s","spell",2]]'::jsonb);
select test_ok((select moves is not null from public.versus_matches
                 where session_id = 'c0000000-0000-0000-0000-0000000000a1'),
               '答對三題、答題串也說三題：收下來當分身');
select test_ok((select legion from public.versus_matches
                 where session_id = 'c0000000-0000-0000-0000-0000000000a1')
               = coalesce((select e from public.characters c, jsonb_array_elements_text(c.equipped) e
                            where c.student_id = 'b1000000-0000-0000-0000-000000000001'
                              and e like 'legion-%' limit 1), ''),
               '那一場穿什麼軍團是伺服器自己看的');
-- 答題事件只有兩題，答題串卻說答對五題：做一個打不贏的假分身
select test_force($$ select test_events('b1000000-0000-0000-0000-000000000001', 2,
                       p_session => 'c0000000-0000-0000-0000-0000000000a2') $$);
select public.record_versus_match('c0000000-0000-0000-0000-0000000000a2'::uuid, 'cpu', true,
  p_moves => '[[1,"a",1],[2,"a",1],[3,"a",1],[4,"a",1],[5,"a",1]]'::jsonb);
select test_ok((select moves is null from public.versus_matches
                 where session_id = 'c0000000-0000-0000-0000-0000000000a2'),
               '答對筆數比答題事件多：答題串不收（戰績照記）');
select test_ok((select count(*) from public.class_ghosts()) = 0, '自己不會出現在自己的分身名單上');

select test_as('b0000000-0000-0000-0000-000000000002', true);
select test_ok((select count(*) from public.class_ghosts()) = 1, '同學看得到小成的分身');
select test_ok((select correct from public.class_ghosts()) = 3,
               '名單上寫的是最近一場「有分身」的那一場，答對三題');
select test_ok((select jsonb_array_length(moves) from public.ghost_of('b1000000-0000-0000-0000-000000000001')) = 7,
               '挑下去抓得到整串');
select test_ok((select count(*) from public.ghost_of(gen_random_uuid())) = 0, '不存在的人抓不到');
select test_ok((select count(*) from public.versus_matches
                 where student_id = 'b1000000-0000-0000-0000-000000000001') = 0,
               '別人的戰績表還是直接讀不到，只能走 ghost_of');

select test_force($$ select test_events('b1000000-0000-0000-0000-000000000002', 1,
                       p_session => 'c0000000-0000-0000-0000-0000000000b1') $$);
select public.record_versus_match('c0000000-0000-0000-0000-0000000000b1'::uuid, 'ghost', true,
  p_opponent => 'b1000000-0000-0000-0000-000000000001'::uuid,
  p_moves => '[[2,"a",1]]'::jsonb);
select test_ok((select opponent_kind = 'ghost' and opponent_student = 'b1000000-0000-0000-0000-000000000001'
                  from public.versus_matches where session_id = 'c0000000-0000-0000-0000-0000000000b1'),
               '打同學的分身記成 ghost，對手是誰也記下來');
select public.record_versus_match('c0000000-0000-0000-0000-0000000000b2'::uuid, 'student', true,
  p_opponent => 'b1000000-0000-0000-0000-000000000001'::uuid);
select public.record_versus_match('c0000000-0000-0000-0000-0000000000b3'::uuid, 'ghost', true,
  p_opponent => gen_random_uuid());
select test_ok((select count(*) from public.versus_matches
                 where session_id in ('c0000000-0000-0000-0000-0000000000b2',
                                      'c0000000-0000-0000-0000-0000000000b3')
                   and opponent_kind = 'cpu') = 2,
               '自稱贏了真人、或是分身不是同班同學：都當成打電腦');
select public.refresh_achievements();
select test_ok((select value from public.my_achievements() where id = 'war-flag') = 0,
               '贏分身、自稱贏真人，都不算戰旗勝場');

reset role;
select test_force($$
  delete from public.students where login_id like 'ach%';
  delete from public.classes where code = 'ACH1';
  delete from public.teachers where user_id::text like 'b0000000%';
  delete from auth.users where id::text like 'b0000000%';
$$);

\echo '成就：全部通過'
