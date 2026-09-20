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

-- 測試自己要看的內部欄位（密碼雜湊、鎖定狀態）正是我們不給 authenticated 讀的，
-- 所以測試用這兩支 security definer 的輔助函式去看，不是把欄位開放出去。
create or replace function test_peek_student(p_login text)
returns table (id uuid, nickname text, class_code text, locked boolean, failed int)
language sql security definer as $$
  select s.id, s.nickname, s.class_code,
         (s.locked_until is not null and s.locked_until > now()), s.failed_attempts
    from public.students s where s.login_id = lower(p_login);
$$;

-- auth.identities 連 authenticated 都不該讀得到（真的 Supabase 也是），
-- 但「有沒有這一列」決定了帳號登不登得進去，所以用 security definer 偷看一眼。
create or replace function test_peek_identities(p_user uuid) returns bigint
language sql security definer as $$
  select count(*) from auth.identities i where i.user_id = p_user;
$$;

create or replace function test_force(p_sql text) returns void
language plpgsql security definer as $$
begin execute p_sql; end $$;

-- 清乾淨再來
delete from public.teacher_invites where email like '%@rlstest.local';
delete from public.classes where code in ('RLS1','RLS2','RLS3');
delete from public.students where login_id like 'rls%';
delete from public.teachers where user_id::text like 'a0000000%';
delete from auth.users where id::text like 'a0000000%';

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000000', 'admin@rlstest.local'),    -- 最高管理者
  ('a0000000-0000-0000-0000-000000000001', 'teacher1@rlstest.local'),
  ('a0000000-0000-0000-0000-000000000002', 'teacher2@rlstest.local'),
  ('a0000000-0000-0000-0000-000000000003', 'nobody@rlstest.local'),   -- 沒被邀請的人
  ('a0000000-0000-0000-0000-000000000011', null),   -- 小明的平板
  ('a0000000-0000-0000-0000-000000000012', null),   -- 小華的平板
  ('a0000000-0000-0000-0000-000000000013', null),   -- 小明改用電腦
  ('a0000000-0000-0000-0000-000000000014', null);   -- 朋友的小孩，沒有班級

set role authenticated;

-- 這一條是真的踩過的死結：老師要有人邀請，邀請的人必須是管理員，
-- 而管理員自己也得先是老師，結果第一個人永遠進不來。
\echo '── 死結檢查：系統全空的時候，第一個 email 帳號直接就是管理員'
select test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
begin;
select public.claim_teacher('第一個人');
select test_ok(public.is_admin(), '系統全空時第一個註冊的人就是管理員');
rollback;

-- 而且這道後門在名單上有人之後就要關起來，不然誰都能搶先當管理員。
\echo '── 邀請名單上一有人，那道後門就要關掉'
begin;
select test_force($$ insert into public.teacher_invites (email) values ('someone@rlstest.local') $$);
select test_as('a0000000-0000-0000-0000-000000000003', false, 'nobody@rlstest.local');
select test_denied($$ select public.claim_teacher('搶先的') $$, '名單上有人之後還想走後門當管理員');
rollback;
select test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');

\echo '── 管理員：第一個人可以自己認領，之後就不行'
select test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
select public.claim_first_admin();
select test_ok(public.is_admin(), '第一個認領的人是管理員');
select test_as('a0000000-0000-0000-0000-000000000003', false, 'nobody@rlstest.local');
select test_denied($$ select public.claim_first_admin() $$, '已經有管理員了還想認領');

\echo '── 老師：沒被邀請就當不成老師，也開不了班'
select test_denied($$ select public.claim_teacher('冒牌的') $$, '沒被邀請卻想當老師');
select test_denied($$ select public.create_class('RLS3','偷開的班') $$, '不是老師卻想開班');

\echo '── 管理員發邀請，老師才認領得到'
select test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
select public.admin_invite_teacher('teacher1@rlstest.local');
select public.admin_invite_teacher('teacher2@rlstest.local');
select test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
select public.claim_teacher('王老師');
select public.create_class('RLS1', '三年二班');
select test_as('a0000000-0000-0000-0000-000000000002', false, 'teacher2@rlstest.local');
select public.claim_teacher('李老師');
select public.create_class('RLS2', '別班');

-- 少了 grant 的話這一條會掛，而且掛在前端是「登入後不是管理員」這種很難查的症狀。
\echo '── 老師直接讀得到自己那一列（畫面靠它判斷是不是管理員）'
select test_ok((select count(*) from public.teachers) = 1, '老師只讀得到自己那一列');
select test_ok((select is_admin from public.teachers) = false, '王老師不是管理員');
select test_denied($$ select email from public.teacher_invites $$, '老師讀邀請名單');

\echo '── 一般人不能發老師邀請'
select test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
select test_denied($$ select public.admin_invite_teacher('hacker@rlstest.local') $$, '老師自己發邀請');

\echo '── 匿名帳號不能開班、不能當管理員'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select test_denied($$ select public.create_class('RLS3','偷開的班') $$, '匿名帳號開班');
select test_ok(not public.is_admin(), '匿名帳號不是管理員');

\echo '── 學生註冊'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select public.register_student('rlsming', 'apple99', '小明', 'RLS1');
select test_as('a0000000-0000-0000-0000-000000000012', true);
select public.register_student('rlshua', 'banana7', '小華', 'RLS1');

\echo '── 註冊擋得住的事'
select test_denied($$ select public.register_student('rlsming','apple99','別人','RLS1') $$, '帳號重複');
select test_denied($$ select public.register_student('rlsnew','apple99','小明','RLS1') $$, '同班暱稱重複');
select test_denied($$ select public.register_student('rlsnew','apple99','新人','NOPE') $$, '班級代碼不存在');
select test_denied($$ select public.register_student('ab','apple99','新人','RLS1') $$, '帳號太短');
select test_denied($$ select public.register_student('rls王','apple99','新人','RLS1') $$, '帳號有中文');

\echo '── 密碼規則'
select test_denied($$ select public.register_student('rlsp1','ab1','新人','RLS1') $$, '密碼太短');
select test_denied($$ select public.register_student('rlsp2','aaaaaa','新人','RLS1') $$, '密碼整串同一個字');
select test_denied($$ select public.register_student('rlsp3','123456','新人','RLS1') $$, '密碼是連號');
select test_denied($$ select public.register_student('rlsp4','abcdef','新人','RLS1') $$, '密碼是照順序的字母');
select test_denied($$ select public.register_student('rlsp5','rlsp5','新人','RLS1') $$, '密碼跟帳號一樣');
select test_denied($$ select public.register_student('rlsp6','pass word','新人','RLS1') $$, '密碼有空白');

\echo '── 班級關起來就不能再加入新同學'
select test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
select public.class_set_open('RLS1', false);
select test_as('a0000000-0000-0000-0000-000000000014', true);
select test_denied($$ select public.register_student('rlsx','melon12','路人','RLS1') $$, '班級關閉時註冊');
select test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
select public.class_set_open('RLS1', true);

\echo '── 登入：密碼對才進得去'
select test_as('a0000000-0000-0000-0000-000000000013', true);
select test_ok((select error from public.login_student('rlsming','wrong99')) is not null, '密碼打錯進不去');
select test_ok((select error from public.login_student('rlsnobody','apple99')) is not null, '帳號不存在進不去');

\echo '── 換一台裝置登入，要接回同一個存檔（這就是接後端的理由）'
do $$
declare v_old uuid; v_new uuid;
begin
  perform test_as('a0000000-0000-0000-0000-000000000011', true);
  select public.current_student_id() into v_old;
  perform test_as('a0000000-0000-0000-0000-000000000013', true);
  perform public.login_student('rlsming', 'apple99');
  select public.current_student_id() into v_new;
  perform test_ok(v_old = v_new, '換裝置之後還是同一個學生');
end $$;

\echo '── 大小寫不影響登入（小朋友會被大寫鎖定鍵擋住）'
do $$
begin
  perform test_as('a0000000-0000-0000-0000-000000000013', true);
  perform public.login_student('RLSMing', 'APPLE99');
  perform test_ok(public.current_student_id() is not null, '帳號密碼大小寫都不影響');
end $$;

\echo '── 試錯鎖定：連續錯五次就鎖住'
do $$
declare v_locked boolean;
begin
  perform test_as('a0000000-0000-0000-0000-000000000012', true);
  for i in 1..5 loop
    perform public.login_student('rlshua', 'nope123');
  end loop;
  select locked into v_locked from test_peek_student('rlshua');
  perform test_ok(v_locked, '錯五次之後被鎖住');
end $$;
select test_ok((select error from public.login_student('rlshua','banana7')) like '密碼錯太多次%', '鎖住期間就算密碼對也進不去');

\echo '── 老師重設密碼會順便解鎖'
do $$
declare v_id uuid;
begin
  select id into v_id from test_peek_student('rlshua');
  perform test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
  perform public.teacher_reset_student_password(v_id, 'cherry5');
  perform test_as('a0000000-0000-0000-0000-000000000012', true);
  perform public.login_student('rlshua', 'cherry5');
  perform test_ok(public.current_student_id() = v_id, '重設完可以用新密碼登入');
end $$;

\echo '── 別班老師不能重設別人班的密碼'
do $$
declare v_id uuid;
begin
  select id into v_id from test_peek_student('rlsming');
  perform test_as('a0000000-0000-0000-0000-000000000002', false, 'teacher2@rlstest.local');
  perform test_denied(format('select public.teacher_reset_student_password(%L, %L)', v_id, 'grape88'),
                      '別班老師重設密碼');
end $$;

\echo '── 學生自己改密碼：要先打對舊的'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select test_denied($$ select public.student_set_password('wrong99','orange4') $$, '舊密碼打錯');
select test_denied($$ select public.student_set_password('apple99','123456') $$, '新密碼是連號');
select public.student_set_password('apple99', 'orange4');
do $$
begin
  perform test_as('a0000000-0000-0000-0000-000000000013', true);
  perform public.login_student('rlsming', 'orange4');
  perform test_ok(public.current_student_id() is not null, '改完可以用新密碼登入');
end $$;

\echo '── 學生改暱稱：班內不能撞名，而且一週只能改一次'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select test_denied($$ select public.student_set_nickname('小華') $$, '改成同班同學的暱稱');
select public.student_set_nickname('大明');
select test_denied($$ select public.student_set_nickname('小明') $$, '一週內改第二次');
select test_ok((select nickname from test_peek_student('rlsming')) = '大明', '暱稱改成功了');

\echo '── 換班：角色與進度不會跟著不見'
do $$
declare v_id uuid; v_coins int; v_after int;
begin
  perform test_as('a0000000-0000-0000-0000-000000000011', true);
  select public.current_student_id() into v_id;
  select coins into v_coins from public.characters where student_id = v_id;
  perform test_as('a0000000-0000-0000-0000-000000000002', false, 'teacher2@rlstest.local');
  perform public.class_set_open('RLS2', true);
  perform test_as('a0000000-0000-0000-0000-000000000011', true);
  perform public.student_join_class('RLS2');
  select coins into v_after from public.characters where student_id = v_id;
  perform test_ok(v_after = v_coins, '換班之後金幣沒有歸零');
  perform test_ok((select class_code from test_peek_student('rlsming')) = 'RLS2', '班級真的換了');
  perform public.student_join_class('RLS1');  -- 換回來，後面的測試要用
end $$;

\echo '── 答題：金幣只能從這支 RPC 來'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select public.submit_answers($$[
  {"wordId":1,"skill":"recognize","correct":true,"ms":1200,"combo":0,"gameId":"tower-defense","levelId":"td-01"},
  {"wordId":2,"skill":"recognize","correct":false,"ms":3000,"combo":1,"gameId":"tower-defense","levelId":"td-01"},
  {"wordId":1,"skill":"recognize","correct":true,"ms":900,"combo":0,"gameId":"tower-defense","levelId":"td-01"}
]$$::jsonb);

\echo '── 通關與星星是伺服器算的，前端說了不算'
do $blk$
declare
  v_sess uuid := gen_random_uuid();
  v_r    record;
  v_i    int;
  v_coins_before int;
  v_coins_after  int;
begin
  perform test_as('a0000000-0000-0000-0000-000000000011', true);

  -- 一題都沒答就說自己通關了。這是最好按的那個洞。
  select * into v_r from public.save_progress('td-02', v_sess, true, 1.0);
  perform test_ok(not v_r.win and v_r.stars = 0 and v_r.cleared_at is null,
                  '一題都沒答說自己通關：不算，也沒有星星');

  -- 答了幾題但遠不到這一關的下限（td-02 要 15 題），照樣不算通關
  for v_i in 1..6 loop
    perform public.submit_answers(jsonb_build_array(jsonb_build_object(
      'wordId', 20 + v_i, 'skill', 'recognize', 'correct', true, 'ms', 1000,
      'combo', 0, 'gameId', 'tower-defense', 'levelId', 'td-02',
      'sessionId', v_sess::text)));
  end loop;
  select * into v_r from public.save_progress('td-02', v_sess, true, 1.0);
  perform test_ok(not v_r.win and v_r.stars = 0,
                  '只答 6 題就說通關第二關：不算（下限 15 題）');

  -- 真的打完一場：答對數過了下限、正確率滿分、城堡還剩很多血 → 三顆星
  v_sess := gen_random_uuid();
  for v_i in 1..20 loop
    perform public.submit_answers(jsonb_build_array(jsonb_build_object(
      'wordId', 30 + v_i, 'skill', 'recognize', 'correct', true, 'ms', 1000,
      'combo', 0, 'gameId', 'tower-defense', 'levelId', 'td-02',
      'sessionId', v_sess::text)));
  end loop;
  select c.coins into v_coins_before from public.characters c
   where c.student_id = public.current_student_id();
  select * into v_r from public.save_progress('td-02', v_sess, true, 0.9);
  perform test_ok(v_r.win and v_r.stars = 3 and v_r.counted_correct = 20,
                  '真的打完一場：三顆星，答對數 ' || v_r.counted_correct || ' 是資料庫自己數的');
  perform test_ok(v_r.bonus_coins > 0, '首次通關獎金 ' || v_r.bonus_coins || ' 入帳了');
  select c.coins into v_coins_after from public.characters c
   where c.student_id = public.current_student_id();
  perform test_ok(v_coins_after = v_coins_before + v_r.bonus_coins, '金幣真的加上去了');

  -- 重玩同一關不會再拿一次首通獎金
  v_sess := gen_random_uuid();
  for v_i in 1..20 loop
    perform public.submit_answers(jsonb_build_array(jsonb_build_object(
      'wordId', 30 + v_i, 'skill', 'recognize', 'correct', true, 'ms', 1000,
      'combo', 0, 'gameId', 'tower-defense', 'levelId', 'td-02',
      'sessionId', v_sess::text)));
  end loop;
  select * into v_r from public.save_progress('td-02', v_sess, true, 0.9);
  perform test_ok(v_r.bonus_coins = 0, '重玩不會再拿一次首通獎金');

  -- 正確率不夠就只有一顆星，前端沒有任何欄位可以蓋過去
  v_sess := gen_random_uuid();
  -- 答 40 題對 20 題：過得了 td-03 的下限（17），但正確率只有一半
  for v_i in 1..40 loop
    perform public.submit_answers(jsonb_build_array(jsonb_build_object(
      'wordId', 60 + v_i, 'skill', 'recognize', 'correct', (v_i % 2 = 0), 'ms', 1000,
      'combo', 0, 'gameId', 'tower-defense', 'levelId', 'td-03',
      'sessionId', v_sess::text)));
  end loop;
  select * into v_r from public.save_progress('td-03', v_sess, true, 1.0);
  perform test_ok(v_r.win and v_r.stars = 1,
                  '正確率一半只給一顆星（答對 ' || v_r.counted_correct ||
                  ' / ' || v_r.counted_asked || '）');

  -- 別人那一場的答題不能拿來當自己的成績
  perform test_as('a0000000-0000-0000-0000-000000000012', true);
  select * into v_r from public.save_progress('td-02', v_sess, true, 1.0);
  perform test_ok(not v_r.win and v_r.stars = 0, '借用別人那一場的 id：一題都不算');
end $blk$;

\echo '── 學生不能直接改自己的資料'
do $$
declare v_id uuid;
begin
  perform test_as('a0000000-0000-0000-0000-000000000011', true);
  select public.current_student_id() into v_id;
  perform test_denied(format('update public.characters set coins = 999999 where student_id = %L', v_id), '直接改金幣');
  perform test_denied(format('insert into public.answer_events (student_id, word_id, skill, correct) values (%L, 5, ''recognize'', true)', v_id), '直接塞答題紀錄');
  perform test_denied(format('update public.level_progress set stars = 3 where student_id = %L', v_id), '直接改星星');
  perform test_denied(format('update public.students set class_code = ''RLS2'' where id = %L', v_id), '直接改班級');
  perform test_denied(format('update public.students set pw_hash = ''x'' where id = %L', v_id), '直接改密碼');
  perform test_denied($q$ insert into public.classes (code, name, owner) values ('RLS3','偷開的班', auth.uid()) $q$, '直接開班');
end $$;

\echo '── 商店：價格、等級門檻、餘額都由資料庫說了算'
do $$
declare v_id uuid; v_before int; v_after int; v_items jsonb;
begin
  perform test_as('a0000000-0000-0000-0000-000000000011', true);
  select public.current_student_id() into v_id;

  -- 價格不能由客戶端決定：函式只收 id，連價格參數都沒有
  perform test_denied($q$ select public.buy_item('沒這個東西') $q$, '買不存在的東西');

  -- 等級門檻。剛註冊的人 exp=0 是一級，買不起要三級的東西
  perform test_ok(public.level_of(0) = 1, '0 經驗是 1 級');
  perform test_ok(public.level_of(120) = 2, '120 經驗是 2 級');
  perform test_denied($q$ select public.buy_item('crystal-40') $q$, '等級不夠還想買');

  -- 買得起的：錢要扣對，東西要進背包
  select coins into v_before from public.characters where student_id = v_id;
  perform public.buy_item('slow-30');
  select coins, items into v_after, v_items from public.characters where student_id = v_id;
  perform test_ok(v_after = v_before - 60, '買完金幣扣掉正確的價錢');
  perform test_ok((v_items ->> 'slow-30')::int = 1, '東西進背包了');

  -- 錢不夠要被擋（紅軍 150，剛剛買完剩不到）
  perform test_denied($q$ select public.buy_item('color-red') $q$, '錢不夠還想買');

  -- 補一點錢進去（用 security definer 的輔助函式，學生自己是改不動的），
  -- 才測得到後面穿脫裝飾品那幾條
  perform test_force(format('update public.characters set coins = 900 where student_id = %L', v_id));
  perform public.buy_item('color-red');

  -- 消耗品用一次就沒了，第二次要被擋
  perform public.consume_item('slow-30');
  perform test_denied($q$ select public.consume_item('slow-30') $q$, '道具用完了還想用');

  -- 裝飾品：買過的才穿得上，消耗品不能穿
  perform public.equip_item('color-red', true);
  perform test_ok((select equipped from public.characters where student_id = v_id) ? 'color-red', '顏色穿上了');
  perform public.equip_item('color-red', false);
  perform test_ok(not ((select equipped from public.characters where student_id = v_id) ? 'color-red'), '顏色脫下來了');
  perform test_denied($q$ select public.equip_item('frame-gold', true) $q$, '穿沒買過的東西');
  perform test_denied($q$ select public.equip_item('slow-30', true) $q$, '把消耗品穿在身上');

  -- 一個欄位只能穿一件：換顏色會自動把原本那個顏色脫掉，
  -- 不然存進去會變成「同時穿紅色和黃色」，畫面就不知道要顯示哪一個
  -- 黃軍要 2 級，先把經驗補上去（一樣走 security definer，學生自己改不動）
  perform test_force(format('update public.characters set exp = 200 where student_id = %L', v_id));
  perform public.buy_item('color-yellow');
  perform public.equip_item('color-red', true);
  perform public.equip_item('color-yellow', true);
  perform test_ok((select equipped from public.characters where student_id = v_id) ? 'color-yellow'
              and not ((select equipped from public.characters where student_id = v_id) ? 'color-red'),
              '換顏色會把原本的脫掉');

  -- 但不同欄位可以同時穿：顏色歸顏色、外框歸外框
  perform public.buy_item('frame-gold');
  perform public.equip_item('frame-gold', true);
  perform test_ok((select equipped from public.characters where student_id = v_id) ? 'color-yellow'
              and (select equipped from public.characters where student_id = v_id) ? 'frame-gold',
              '顏色跟外框可以同時穿');

  -- 頭像只認素材包裡真的有的那 25 張
  perform public.set_avatar('Avatars_07');
  perform test_ok((select avatar from public.characters where student_id = v_id) = 'Avatars_07', '頭像選好了');
  perform test_denied($q$ select public.set_avatar('Avatars_99') $q$, '選不存在的頭像');
  perform test_denied($q$ select public.set_avatar('<script>') $q$, '頭像欄位塞奇怪的字串');

  -- 背包也不能直接改
  perform test_denied(format($q$ update public.characters set items = '{"frame-rainbow":99}'::jsonb where student_id = %L $q$, v_id), '直接改背包');
end $$;

\echo '── 密碼雜湊不能被別人讀走（RLS 管列不管欄，靠的是欄位層級的 grant）'
select test_as('a0000000-0000-0000-0000-000000000012', true);
select test_denied($$ select pw_hash from public.students where login_id = 'rlsming' $$, '讀別人的密碼雜湊');
select test_denied($$ select login_id from public.students where nickname = '大明' $$, '讀別人的登入帳號');
select test_ok((select count(*) from public.students where class_code = 'RLS1') >= 2, '但看得到同班同學（暱稱）');

\echo '── 同學之間看不到彼此的存檔與答題紀錄'
select test_as('a0000000-0000-0000-0000-000000000012', true);
select test_ok((select count(*) from public.answer_events) = 0, '看不到別人的答題紀錄');
select test_ok((select count(*) from public.characters) = 1, '只看得到自己的存檔');

\echo '── 學生不能用老師的函式'
select test_as('a0000000-0000-0000-0000-000000000011', true);
select test_denied($$ select public.teacher_set_open('RLS1', array['td-14']) $$, '學生開放關卡');
select test_denied($$ select public.teacher_add_student('RLS1','ghost','melon12','幽靈同學') $$, '學生加人');
select test_denied($$ select public.class_set_open('RLS1', false) $$, '學生關閉班級');
select test_denied($$ select public.class_regenerate_code('RLS1') $$, '學生換班級代碼');
select test_ok((select count(*) from public.class_most_missed('RLS1')) = 0, '學生拿不到老師報表');

\echo '── 別班老師看不到這一班'
select test_as('a0000000-0000-0000-0000-000000000002', false, 'teacher2@rlstest.local');
select test_ok((select count(*) from public.class_overview('RLS1')) = 0, '別班老師看不到名單');
select test_denied($$ select public.teacher_set_open('RLS1', array['td-05']) $$, '別班老師開放關卡');

\echo '── 老師看得到自己班'
select test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
select test_ok((select count(*) from public.class_overview('RLS1')) >= 2, '老師看得到自己班的名單');
select test_ok((select count(*) from public.class_most_missed('RLS1')) >= 1, '老師看得到最常錯的字');

\echo '── 老師代學生開帳號'
select public.teacher_add_student('RLS1', 'rlslate', 'kiwi123', '遲到的同學');
select test_ok((select count(*) from test_peek_student('rlslate')) = 1, '老師開的帳號建好了');

\echo '── 換班級代碼，班上的人要跟著走不能被踢掉'
do $$
declare v_new text; v_n int;
begin
  perform test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
  select public.class_regenerate_code('RLS1') into v_new;
  select count(*) into v_n from public.students s where s.class_code = v_new;
  perform test_ok(v_n >= 3, '換代碼之後班上的人還在（' || v_n || ' 個）');
  perform test_force(format('update public.classes set code = ''RLS1'' where code = %L', v_new));  -- 換回來收尾
end $$;

\echo '── 管理員：看得到所有老師、可以停用老師'
select test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
select test_ok((select count(*) from public.admin_list_teachers()) >= 3, '管理員看得到老師名單');
select test_denied($$ select public.admin_set_teacher_active('a0000000-0000-0000-0000-000000000000', false) $$, '管理員停用自己');
select public.admin_set_teacher_active('a0000000-0000-0000-0000-000000000002', false);

\echo '── 被停用的老師開不了班，也看不到自己原本的班'
select test_as('a0000000-0000-0000-0000-000000000002', false, 'teacher2@rlstest.local');
select test_denied($$ select public.create_class('RLS3','停用後開的班') $$, '被停用的老師開班');
select test_ok((select count(*) from public.class_overview('RLS2')) = 0, '被停用的老師看不到自己的班');

\echo '── 管理員：看得到全部班級、換得了老師'
do $blk$
declare v_owner uuid; v_n int;
begin
  perform test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
  -- 上一段把李老師停用了，這裡要先恢復——停用中的老師不能接班
  perform public.admin_set_teacher_active('a0000000-0000-0000-0000-000000000002', true);
  select count(*) into v_n from public.admin_list_classes();
  perform test_ok(v_n >= 2, '管理員看得到全部班級（' || v_n || ' 班）');
  -- RLS1 本來是 teacher1 的，交給 teacher2
  perform public.admin_set_class_owner('RLS1', 'a0000000-0000-0000-0000-000000000002');
  select c.owner into v_owner from public.classes c where c.code = 'RLS1';
  perform test_ok(v_owner = 'a0000000-0000-0000-0000-000000000002', '班級換老師了');
  -- 換老師不能把學生弄丟：學生是掛在班級代碼上的
  select count(*) into v_n from public.students s where s.class_code = 'RLS1';
  perform test_ok(v_n >= 3, '換老師之後班上的人還在（' || v_n || ' 個）');
  perform test_denied($$ select public.admin_set_class_owner('RLS1', 'a0000000-0000-0000-0000-000000000009') $$,
                      '把班交給不是老師的人');
  perform public.admin_set_class_owner('RLS1', 'a0000000-0000-0000-0000-000000000001');  -- 換回來收尾
end $blk$;

\echo '── 管理員直接幫老師開帳號（不寄確認信）'
do $blk$
declare v_uid uuid;
begin
  perform test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
  perform public.admin_create_teacher('newbie@rlstest.local', 'longenough1', '新來的老師');
  select u.id into v_uid from auth.users u where u.email = 'newbie@rlstest.local';
  perform test_ok(v_uid is not null, '帳號建起來了');
  perform test_ok((select count(*) from public.teachers t where t.user_id = v_uid) = 1, '同時就是老師了');
  -- 這三件事任何一件漏掉，帳號建得起來但登入會失敗
  perform test_ok((select u.email_confirmed_at is not null from auth.users u where u.id = v_uid),
                  'email 直接算已確認，不用收信');
  perform test_ok((select u.confirmation_token = '' and u.recovery_token = ''
                     and u.email_change = '' and u.email_change_token_new = ''
                   from auth.users u where u.id = v_uid),
                  'token 欄位是空字串不是 NULL（NULL 會讓登入回 500）');
  perform test_ok(test_peek_identities(v_uid) = 1, '有 identities 那一列（沒有就登入不了）');
  perform test_denied($$ select public.admin_create_teacher('short@rlstest.local', 'abc1234') $$,
                      '密碼太短的老師帳號');
  -- 已經自己註冊過、卻卡在「不是老師」的人很常見（照畫面註冊完卻進不去的那些）。
  -- 這種情況不該再開一個帳號，而是把現有的那個設成老師。
  perform test_force($$ insert into auth.users (id, email)
                        values ('a0000000-0000-0000-0000-000000000003', 'stuck@rlstest.local')
                        on conflict (id) do update set email = 'stuck@rlstest.local' $$);
  perform test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
  perform test_ok(
    (public.admin_create_teacher('stuck@rlstest.local', 'longenough1', '卡住的老師') ->> 'created') = 'false',
    '已經有帳號的人不會被開第二個帳號');
  perform test_ok((select count(*) from auth.users u where u.email = 'stuck@rlstest.local') = 1,
                  'auth 帳號還是只有一個');
  perform test_ok((select count(*) from public.teachers t
                    where t.user_id = 'a0000000-0000-0000-0000-000000000003') = 1,
                  '他現在是老師了');
  perform test_ok(
    (public.admin_create_teacher('newbie@rlstest.local', 'longenough1') ->> 'created') = 'false',
    '同一個 email 加第二次不會壞');
  perform test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
  perform test_denied($$ select public.admin_create_teacher('sneaky@rlstest.local', 'longenough1') $$,
                      '一般老師自己開老師帳號');
end $blk$;

\echo '── 一般老師看不到管理員的名單'
select test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
select test_ok((select count(*) from public.admin_list_teachers()) = 0, '老師拿不到老師名單');
select test_ok((select count(*) from public.admin_list_invites()) = 0, '老師拿不到邀請名單');
select test_ok((select count(*) from public.admin_list_classes()) = 0, '老師拿不到全部班級');

\echo '── 沒有班級的學生（朋友的小孩）'
do $$
declare v_id uuid;
begin
  perform test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
  perform public.admin_set_teacher_active('a0000000-0000-0000-0000-000000000002', true);
  perform test_as('a0000000-0000-0000-0000-000000000014', true);
  perform public.register_student('rlsfriend', 'peach21', '朋友的小孩', 'RLS2');
  select public.current_student_id() into v_id;
  perform test_force(format('update public.students set class_code = null where id = %L', v_id));  -- 模擬離開班級
  perform test_ok((select count(*) from public.students where id = v_id) = 1, '沒有班級也看得到自己');
  perform test_ok((select count(*) from public.characters where student_id = v_id) = 1, '沒有班級也有自己的存檔');
  perform test_as('a0000000-0000-0000-0000-000000000000', false, 'admin@rlstest.local');
  perform public.teacher_reset_student_password(v_id, 'peach99');
  perform test_ok(true, '管理員重設得了沒有班級的學生的密碼');
end $$;

reset role;
\echo ''
\echo '全部通過'
