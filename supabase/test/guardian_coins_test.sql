-- 守護異世界 × 樂園時光幣（park_guardian.sql 下半段）的實測。
-- 要在樂園的 tools/test/db.sh 跑完之後接著跑（用到它的 test_ok / test_as 與學生 t2_cat），
-- 而且 park_coins.sql 之後要再套一次 park_guardian.sql（費率才寫得進去）。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
select test_one($$select id from public.students where login_id = 't2_cat'$$) as cat \gset
insert into public.characters (student_id, job, coins) values (:'cat', 'knight', 1000)
on conflict (student_id) do update set coins = 1000, items = '{}';
delete from public.park_coin_ledger where student_id = :'cat' and source like 'guardian:%';
delete from public.guardian_copper_day where student_id = :'cat';
select test_ok(public.park_coin_rate('guardian_copper') = 20, '換算率 20 銅幣＝1 時光幣');
select test_ok(public.park_coin_rate('guardian_daily') = 100, '每天上限 100');
select coalesce(sum(amount), 0) as base from public.park_coin_ledger where student_id = :'cat' \gset

set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);

\echo '── 舊銅幣一次換算'
select public.guardian_wallet() as w \gset
select test_ok((:'w'::jsonb ->> 'park')::boolean, '錢包說樂園有開');
select test_ok((:'w'::jsonb ->> 'coins')::int = :base + 50, '舊銅幣 1000 換成 50 時光幣');
select public.guardian_wallet() as w \gset
select test_ok((:'w'::jsonb ->> 'coins')::int = :base + 50, '再打開一次不會再換一次');

\echo '── 答題的銅幣換成時光幣'
reset role;
update public.characters set coins = coins + 130 where student_id = :'cat';   -- 6.5 枚 → 6
select test_ok((select amount from public.park_coin_ledger where student_id = :'cat' and source like 'guardian:play:%') = 6, '今天 130 銅幣換 6 枚');
update public.characters set coins = coins + 10 where student_id = :'cat';    -- 140 → 7
select test_ok((select amount from public.park_coin_ledger where student_id = :'cat' and source like 'guardian:play:%') = 7, '同一天累積，餘數不會不見');
select test_ok((select count(*) from public.park_coin_ledger where student_id = :'cat' and source like 'guardian:play:%') = 1, '一天只有一筆');
update public.characters set coins = coins + 99999 where student_id = :'cat';
select test_ok((select amount from public.park_coin_ledger where student_id = :'cat' and source like 'guardian:play:%') = 100, '一天最多 100');
update public.characters set coins = coins - 50 where student_id = :'cat';
select test_ok((select amount from public.park_coin_ledger where student_id = :'cat' and source like 'guardian:play:%') = 100, '銅幣變少不會扣時光幣');
update public.characters set exp = 99999 where student_id = :'cat';

\echo '── 英雄營軍械庫'
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);
select public.guardian_buy('slow-30', '寒霜陷阱') as b \gset
select test_ok((:'b'::jsonb ->> 'coins')::int = :base + 150 - 3, '寒霜陷阱 60 銅幣 → 3 時光幣');
select test_ok((:'b'::jsonb -> 'items' ->> 'slow-30')::int = 1, '背包多一個寒霜陷阱');
select test_ok((select note from public.park_coin_ledger where source = 'buy:guardian:slow-30:1' and student_id = public.current_student_id()) = '英雄營買了「寒霜陷阱」', '帳本寫得出買了什麼');
select public.guardian_buy('slow-30') as b \gset
select test_ok((select count(*) from public.park_coin_ledger where source like 'buy:guardian:slow-30:%' and student_id = public.current_student_id()) = 2, '消耗品可以一直買');
select test_denied($$select public.guardian_buy('frame-gold')$$, '外框改到樂園商店，軍械庫不賣');
select test_denied($$select public.guardian_buy('color-red')$$, '送的東西不用買');
select test_denied($$select public.guardian_buy('frame-legend')$$, '成就限定的買不到');
select test_denied($$select public.guardian_buy('nope')$$, '沒有的東西');
select test_denied($$select public.guardian_buy('legion-pig')$$, '時光幣不夠買不了軍團（或要成就）');
select test_denied($$select public.guardian_copper_add(public.current_student_id(), 100)$$, '學生不能自己加銅幣');
select test_denied($$select public.guardian_rate('x', 1)$$, '學生不能直接叫費率函式');

\echo '── 徽章搬到樂園'
reset role;
select test_ok((select count(*) from public.park_stamps where facility = 'guardian' and code like 'a-%') = 50, '50 枚成就勳章登記在守護異世界那一頁');
select test_ok((select stamps_fn from public.park_facilities where code = 'guardian') = 'guardian_all_earned_stamps', '設施改用新的蓋章函式');
insert into public.student_achievements (student_id, achievement_id) values (:'cat', 'hundred'), (:'cat', 'first-clear') on conflict do nothing;
select public.park_stamp_sync(:'cat');
select test_ok(exists (select 1 from public.park_student_stamps where student_id = :'cat' and facility = 'guardian' and stamp = 'a-hundred'), '萬題蓋到樂園護照');
select test_ok(not exists (select 1 from public.park_student_stamps where student_id = :'cat' and stamp = 'a-first-clear'), '跟過關章重複的不搬');
select test_ok(not exists (select 1 from public.guardian_play_coin_sources(:'cat') where source like '%:a-%'), '勳章不發時光幣');
\echo '  全部通過'
