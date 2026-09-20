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

\echo '── 一般老師看不到管理員的名單'
select test_as('a0000000-0000-0000-0000-000000000001', false, 'teacher1@rlstest.local');
select test_ok((select count(*) from public.admin_list_teachers()) = 0, '老師拿不到老師名單');
select test_ok((select count(*) from public.admin_list_invites()) = 0, '老師拿不到邀請名單');

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
