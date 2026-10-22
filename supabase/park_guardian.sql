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

-- =============================================================================
-- 時光幣合用（2026-10-10，Chuck 同意：遊戲銅幣收掉、時光幣合用、商店分兩櫃同一種錢）
--
-- 錢包只有一個：樂園的帳本 park_coin_ledger（park_coins.sql）。這份只做三件事：
--   1. 賺：遊戲照舊用 coin_value 算銅幣（submit_answers、過關獎勵、團戰獎勵都會加到 characters.coins），
--      characters.coins 一變多，觸發器就把「今天累積的銅幣」換算成時光幣，記在帳本的
--      'guardian:play:<日期>' 那一筆（同一天一直長大，上限 guardian_daily）。
--      換算率、每日上限都在樂園的費率表 park_coin_rates，可以直接改。
--   2. 舊銅幣：第一次打開錢包時一次換算進來（'guardian:legacy'，上限 guardian_legacy）。
--   3. 花：英雄營軍械庫 guardian_buy（道具、軍團）用時光幣買，價格＝原本銅幣價 ÷ 換算率（無條件進位）。
--      外觀（頭像、外框）改去樂園商店，這裡不賣。
-- characters.coins 還是會照舊長，只是沒人用了；沒裝樂園的本機版照舊用它。
-- 需要先套樂園的 park_coins.sql；沒套的話這段什麼都不做（觸發器看到帳本不在就跳過）。
-- =============================================================================

do $$ begin
  if to_regclass('public.park_coin_rates') is not null then
    insert into public.park_coin_rates (code, amount, note) values
      ('guardian_copper', 20,  '守護異世界：幾枚舊銅幣換 1 枚時光幣（遊戲裡答對題目照舊算銅幣）'),
      ('guardian_daily',  100, '守護異世界：一天最多從答題換到幾枚時光幣'),
      ('guardian_legacy', 200, '守護異世界：舊銅幣一次換算的上限')
    on conflict (code) do nothing;
  end if;
end $$;

-- 每個學生每天累積了多少銅幣（臺灣時間的日期）
create table if not exists public.guardian_copper_day (
  student_id uuid not null references public.students(id) on delete cascade,
  day        date not null,
  copper     int  not null default 0,
  primary key (student_id, day)
);
alter table public.guardian_copper_day enable row level security;

create or replace function public.guardian_rate(p_code text, p_default int)
returns int language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v int;
begin
  if to_regclass('public.park_coin_rates') is null then return p_default; end if;
  execute 'select amount from public.park_coin_rates where code = $1' into v using p_code;
  return coalesce(v, p_default);
end;
$$;

create or replace function public.guardian_copper_add(p_student uuid, p_copper int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day date := (now() at time zone 'Asia/Taipei')::date; v_total int; v_amt int;
begin
  if p_student is null or coalesce(p_copper, 0) <= 0 or to_regclass('public.park_coin_ledger') is null then return; end if;
  insert into public.guardian_copper_day as d (student_id, day, copper) values (p_student, v_day, p_copper)
  on conflict (student_id, day) do update set copper = d.copper + excluded.copper
  returning copper into v_total;
  v_amt := least(public.guardian_rate('guardian_daily', 100),
                 v_total / greatest(1, public.guardian_rate('guardian_copper', 20)));
  if v_amt <= 0 then return; end if;
  execute $q$
    insert into public.park_coin_ledger as l (student_id, source, amount, facility, note)
    values ($1, $2, $3, 'guardian', $4)
    on conflict (student_id, source) do update set amount = excluded.amount, seen = false
     where l.amount <> excluded.amount $q$
  using p_student, 'guardian:play:' || v_day, v_amt, '守護異世界 ' || to_char(v_day, 'FMMM/FMDD') || ' 答對題目';
end;
$$;

create or replace function public.guardian_coins_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.coins > old.coins then
    perform public.guardian_copper_add(new.student_id, new.coins - old.coins);
  end if;
  return new;
end;
$$;
drop trigger if exists guardian_coins_to_park on public.characters;
create trigger guardian_coins_to_park after update of coins on public.characters
  for each row execute function public.guardian_coins_trg();

-- 錢包：{park, coins, today, cap, per}。park=false 表示樂園的帳本還沒裝，前端照舊用銅幣。
create or replace function public.guardian_wallet()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_per int; v_old int; v_bal int; v_today int;
        v_day date := (now() at time zone 'Asia/Taipei')::date;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if to_regclass('public.park_coin_ledger') is null then return jsonb_build_object('park', false); end if;
  v_per := greatest(1, public.guardian_rate('guardian_copper', 20));
  select c.coins into v_old from public.characters c where c.student_id = v_me;
  if coalesce(v_old, 0) / v_per > 0 then
    execute $q$ insert into public.park_coin_ledger (student_id, source, amount, facility, note)
      values ($1, 'guardian:legacy', $2, 'guardian', '守護異世界的舊銅幣換成時光幣')
      on conflict (student_id, source) do nothing $q$
    using v_me, least(public.guardian_rate('guardian_legacy', 200), v_old / v_per);
  end if;
  execute 'select coalesce(sum(amount), 0)::int from public.park_coin_ledger where student_id = $1' into v_bal using v_me;
  execute 'select coalesce(sum(amount), 0)::int from public.park_coin_ledger where student_id = $1 and source = $2'
    into v_today using v_me, 'guardian:play:' || v_day;
  return jsonb_build_object('park', true, 'coins', v_bal, 'today', v_today,
    'cap', public.guardian_rate('guardian_daily', 100), 'per', v_per);
end;
$$;

-- 英雄營軍械庫：道具、軍團用時光幣買。檢查跟 buy_item 一樣（等級、成就、送的不用買），只是錢從帳本扣。
drop function if exists public.guardian_buy(text);
create or replace function public.guardian_buy(p_item text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); i public.shop_items; v_exp int; v_price int; v_bal int; v_n int;
begin
  if v_me is null then raise exception '還沒加入班級'; end if;
  if to_regclass('public.park_coin_ledger') is null then raise exception '樂園的時光幣還沒開'; end if;
  select * into i from public.shop_items s where s.id = p_item;
  if i.id is null then raise exception '軍械庫裡沒有這個東西'; end if;
  if i.achievement_only then raise exception '這個要解成就才拿得到，買不到'; end if;
  if i.free then raise exception '這個是送的，不用買'; end if;
  if i.kind = 'cosmetic' and coalesce(i.slot, '') <> 'legion' then
    raise exception '頭像、外框這些外觀改到樂園的商店買';
  end if;
  if i.need_achievement is not null and not exists (
       select 1 from public.student_achievements sa where sa.student_id = v_me and sa.achievement_id = i.need_achievement) then
    raise exception '要先拿到指定的成就才買得到';
  end if;
  if i.kind = 'cosmetic' and coalesce((select (c.items ->> p_item)::int from public.characters c where c.student_id = v_me), 0) > 0 then
    raise exception '你已經有這一套了';
  end if;
  select c.exp into v_exp from public.characters c where c.student_id = v_me for update;
  if public.level_of(coalesce(v_exp, 0)) < i.unlock_level then
    raise exception '等級不夠，要 % 級才買得到', i.unlock_level;
  end if;
  perform pg_advisory_xact_lock(hashtext('park_coin:' || v_me::text));
  v_price := ceil(i.price::numeric / greatest(1, public.guardian_rate('guardian_copper', 20)))::int;
  execute 'select coalesce(sum(amount), 0)::int from public.park_coin_ledger where student_id = $1' into v_bal using v_me;
  if v_bal < v_price then raise exception '時光幣不夠，還差 % 枚', v_price - v_bal; end if;
  execute 'select count(*) + 1 from public.park_coin_ledger where student_id = $1 and source like $2'
    into v_n using v_me, 'buy:guardian:' || p_item || ':%';
  execute $q$ insert into public.park_coin_ledger (student_id, source, amount, facility, note)
    values ($1, $2, $3, 'guardian', $4) $q$
  using v_me, 'buy:guardian:' || p_item || ':' || v_n, -v_price, '英雄營買了「' || coalesce(nullif(left(btrim(coalesce(p_name, '')), 20), ''), p_item) || '」';
  update public.characters c
     set items = jsonb_set(c.items, array[p_item], to_jsonb(coalesce((c.items ->> p_item)::int, 0) + 1), true),
         updated_at = now()
   where c.student_id = v_me;
  return jsonb_build_object('coins', v_bal - v_price,
    'items', (select c.items from public.characters c where c.student_id = v_me));
end;
$$;

revoke all on function public.guardian_rate(text, int), public.guardian_copper_add(uuid, int),
  public.guardian_coins_trg() from public, anon, authenticated;
revoke all on function public.guardian_wallet(), public.guardian_buy(text, text) from public, anon;
grant execute on function public.guardian_wallet(), public.guardian_buy(text, text) to authenticated;

-- =============================================================================
-- 徽章搬到樂園（2026-10-10，Chuck 同意：徽章交給樂園的徽章牆，放在「守護異世界」那一頁）
--
-- 遊戲自己的 55 格成就（data/achievements.ts，伺服器 refresh_achievements 判定）每一格變成樂園的一枚勳章，
-- 代碼 'a-<成就 id>'，拿到第一階就蓋上去（分階的升級細節還是在遊戲裡的徽章牆看）。
-- 跟樂園原本那 8 個過關章重複的不搬：初戰＝first、全破三章＝ch1~ch3。
-- 圖是遊戲裡同一個徽章畫成 SVG，放在樂園 repo 的 img/stamp/guardian-a-<id>.svg
-- （產生方式：英文 repo tools/build-park-badges.mjs）。
--
-- 為了不被樂園那幾份 SQL 重跑蓋掉，用新的函式名稱，再把設施登記改過去：
--   guardian_all_earned_stamps   原本的過關章＋成就勳章
--   guardian_play_coin_sources   時光幣只算原本的過關章（勳章不發時光幣，跟樂園的勳章規則一樣）
-- =============================================================================
do $$ begin
  if to_regclass('public.park_stamps') is null then return; end if;
  insert into public.park_stamps as s (facility, code, name, hint, art, sort, active, kind, rarity, era, grp) values
  ('guardian', 'a-first-answer', '第一題', '答對一題就有了', 'img/stamp/guardian-a-first-answer.svg', 100, true, 'master', 'bronze', null, null),
  ('guardian', 'a-hundred', '萬題', '累計答對 100 題', 'img/stamp/guardian-a-hundred.svg', 101, true, 'master', 'silver', null, null),
  ('guardian', 'a-nemesis', '死對頭', '把 1 個常錯的字練到連對三次', 'img/stamp/guardian-a-nemesis.svg', 102, true, 'master', 'silver', null, null),
  ('guardian', 'a-theme-king', '主題王', '把 3 個主題的字全部答對過', 'img/stamp/guardian-a-theme-king.svg', 103, true, 'master', 'silver', null, null),
  ('guardian', 'a-mastered-50', '精通', '100 組「字 × 技能」練到熟——認字、聽音、拼字分開算', 'img/stamp/guardian-a-mastered-50.svg', 104, true, 'master', 'silver', null, null),
  ('guardian', 'a-literate', '識字者', '100 個不同的字至少答對過一次', 'img/stamp/guardian-a-literate.svg', 105, true, 'master', 'gold', null, null),
  ('guardian', 'a-read-100', '看得懂', '認字答對 100 題', 'img/stamp/guardian-a-read-100.svg', 106, true, 'master', 'silver', null, null),
  ('guardian', 'a-listen-100', '聽得出', '聽音答對 100 題', 'img/stamp/guardian-a-listen-100.svg', 107, true, 'master', 'silver', null, null),
  ('guardian', 'a-spell-100', '拼得出', '拼字答對 100 題', 'img/stamp/guardian-a-spell-100.svg', 108, true, 'master', 'silver', null, null),
  ('guardian', 'a-triple-day', '三修生', '1 天裡三種技能都玩過', 'img/stamp/guardian-a-triple-day.svg', 109, true, 'master', 'silver', null, null),
  ('guardian', 'a-long-words', '長字挑戰', '拼對八個字母以上的長字 10 次', 'img/stamp/guardian-a-long-words.svg', 110, true, 'master', 'silver', null, null),
  ('guardian', 'a-balanced', '均衡', '三種技能各熟 30 個字', 'img/stamp/guardian-a-balanced.svg', 111, true, 'master', 'gold', null, null),
  ('guardian', 'a-combo', '連對', '同一場裡連對 10 題', 'img/stamp/guardian-a-combo.svg', 112, true, 'master', 'silver', null, null),
  ('guardian', 'a-three-star', '滿星', '1 關拿到三顆星', 'img/stamp/guardian-a-three-star.svg', 114, true, 'clear', 'silver', null, null),
  ('guardian', 'a-no-damage', '城牆不倒', '1 關城堡一滴血都沒掉就通關', 'img/stamp/guardian-a-no-damage.svg', 115, true, 'clear', 'silver', null, null),
  ('guardian', 'a-boss-slayer', '屠魔', '3 個魔王關通關', 'img/stamp/guardian-a-boss-slayer.svg', 116, true, 'clear', 'silver', null, null),
  ('guardian', 'a-stars-30', '星星', '累計 10 顆星', 'img/stamp/guardian-a-stars-30.svg', 117, true, 'clear', 'silver', null, null),
  ('guardian', 'a-first-match', '初上戰場', '打完一場兵推', 'img/stamp/guardian-a-first-match.svg', 121, true, 'clear', 'bronze', null, null),
  ('guardian', 'a-veteran', '戰場老兵', '打完 5 場兵推，輸贏都算', 'img/stamp/guardian-a-veteran.svg', 122, true, 'clear', 'silver', null, null),
  ('guardian', 'a-all-lines', '三線通吃', '同一場裡三條兵種線都派過兵', 'img/stamp/guardian-a-all-lines.svg', 123, true, 'clear', 'bronze', null, null),
  ('guardian', 'a-top-tier', '頂階降臨', '1 場裡推出過三階兵', 'img/stamp/guardian-a-top-tier.svg', 124, true, 'clear', 'silver', null, null),
  ('guardian', 'a-comeback', '逆轉勝', '被推進自己半場之後還贏回來 1 場', 'img/stamp/guardian-a-comeback.svg', 125, true, 'clear', 'silver', null, null),
  ('guardian', 'a-never-quit', '不服輸', '連輸兩場之後再開一場', 'img/stamp/guardian-a-never-quit.svg', 126, true, 'clear', 'bronze', null, null),
  ('guardian', 'a-war-flag', '戰旗', '贏過同學 5 場（打電腦不算）', 'img/stamp/guardian-a-war-flag.svg', 127, true, 'clear', 'gold', null, null),
  ('guardian', 'a-first-live', '初次交手', '跟同學真人對戰一場（打分身、打電腦不算）', 'img/stamp/guardian-a-first-live.svg', 128, true, 'clear', 'bronze', null, null),
  ('guardian', 'a-live-mates', '交手', '跟 3 位不同的同學真人對戰，輸贏都算', 'img/stamp/guardian-a-live-mates.svg', 129, true, 'clear', 'silver', null, null),
  ('guardian', 'a-raid-slayer', '魔王剋星', '在魔王團戰打倒 1 隻不同的魔王', 'img/stamp/guardian-a-raid-slayer.svg', 130, true, 'clear', 'silver', null, null),
  ('guardian', 'a-raid-wins', '並肩作戰', '魔王團戰打贏 1 場', 'img/stamp/guardian-a-raid-wins.svg', 131, true, 'clear', 'silver', null, null),
  ('guardian', 'a-big-team', '人多力量大', '揪四個人以上打贏 1 場魔王', 'img/stamp/guardian-a-big-team.svg', 132, true, 'clear', 'silver', null, null),
  ('guardian', 'a-raid-mates', '廣結善緣', '跟 3 位不同的同學一起打完魔王團戰，輸贏都算', 'img/stamp/guardian-a-raid-mates.svg', 133, true, 'clear', 'silver', null, null),
  ('guardian', 'a-dressed', '換裝', '在商店買一個外框穿上', 'img/stamp/guardian-a-dressed.svg', 134, true, 'collect', 'bronze', null, null),
  ('guardian', 'a-five-colors', '五色軍團', '在「我的角色」換顏色，五色各打一場（守塔或對戰都算）', 'img/stamp/guardian-a-five-colors.svg', 135, true, 'collect', 'bronze', null, null),
  ('guardian', 'a-all-frames', '框框控', '把商店的四個外框都買齊', 'img/stamp/guardian-a-all-frames.svg', 136, true, 'collect', 'bronze', null, null),
  ('guardian', 'a-avatar-10', '換頭像', '換過十種頭像', 'img/stamp/guardian-a-avatar-10.svg', 137, true, 'collect', 'bronze', null, null),
  ('guardian', 'a-dual-job', '雙修', '兩個職業都用來通關過', 'img/stamp/guardian-a-dual-job.svg', 138, true, 'collect', 'gold', null, null),
  ('guardian', 'a-item-taster', '道具三味', '三種道具都用過', 'img/stamp/guardian-a-item-taster.svg', 139, true, 'collect', 'bronze', null, null),
  ('guardian', 'a-week-3', '一週三天', '同一週玩三天', 'img/stamp/guardian-a-week-3.svg', 140, true, 'story', 'bronze', null, null),
  ('guardian', 'a-days', '百日', '總共來玩 7 天，不用連續', 'img/stamp/guardian-a-days.svg', 141, true, 'story', 'silver', null, null),
  ('guardian', 'a-weekend', '週末戰士', '週末來玩 1 天', 'img/stamp/guardian-a-weekend.svg', 142, true, 'story', 'silver', null, null),
  ('guardian', 'a-replay', '回鍋', '回頭重玩一關已經通關的關卡', 'img/stamp/guardian-a-replay.svg', 143, true, 'story', 'bronze', null, null),
  ('guardian', 'a-month-12', '月曆十二', '同一個月玩十二天，不用連續', 'img/stamp/guardian-a-month-12.svg', 144, true, 'story', 'bronze', null, null),
  ('guardian', 'a-old-friend', '老朋友', '註冊滿三十天而且還在玩', 'img/stamp/guardian-a-old-friend.svg', 145, true, 'story', 'bronze', null, null),
  ('guardian', 'a-week-5', '天天見', '同一週玩五天', 'img/stamp/guardian-a-week-5.svg', 146, true, 'story', 'gold', null, null),
  ('guardian', 'a-persistent', '不死心', '彩蛋：自己找找看', 'img/stamp/guardian-a-persistent.svg', 147, true, 'egg', 'gold', null, null),
  ('guardian', 'a-quick-hand', '快手', '彩蛋：自己找找看', 'img/stamp/guardian-a-quick-hand.svg', 148, true, 'egg', 'gold', null, null),
  ('guardian', 'a-so-close', '差一點', '彩蛋：自己找找看', 'img/stamp/guardian-a-so-close.svg', 149, true, 'egg', 'gold', null, null),
  ('guardian', 'a-bare-handed', '空手過關', '彩蛋：自己找找看', 'img/stamp/guardian-a-bare-handed.svg', 150, true, 'egg', 'gold', null, null),
  ('guardian', 'a-combo-20', '連對二十', '彩蛋：自己找找看', 'img/stamp/guardian-a-combo-20.svg', 151, true, 'egg', 'gold', null, null),
  ('guardian', 'a-helper', '小幫手', '彩蛋：自己找找看', 'img/stamp/guardian-a-helper.svg', 152, true, 'egg', 'gold', null, null),
  ('guardian', 'a-all-rounder', '全能生', '彩蛋：自己找找看', 'img/stamp/guardian-a-all-rounder.svg', 153, true, 'egg', 'gold', null, null)
  on conflict (facility, code) do update
    set name = excluded.name, hint = excluded.hint, art = excluded.art, sort = excluded.sort,
        kind = excluded.kind, rarity = excluded.rarity;
end $$;

create or replace function public.guardian_all_earned_stamps(p_student uuid)
returns setof text language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regprocedure('public.guardian_earned_stamps(uuid)') is not null then
    return query select public.guardian_earned_stamps(p_student);
  end if;
  return query select 'a-' || sa.achievement_id from public.student_achievements sa where sa.student_id = p_student;
end;
$$;

create or replace function public.guardian_play_coin_sources(p_student uuid)
returns table (source text, amount int, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query execute $q$
    select 'guardian:stamp:' || x.stamp, public.park_coin_rate('guardian_stamp'), '蓋到護照章「' || s.name || '」'
      from public.park_student_stamps x
      join public.park_stamps s on s.facility = x.facility and s.code = x.stamp
     where x.student_id = $1 and x.facility = 'guardian' and x.stamp not like 'a-%' $q$ using p_student;
end;
$$;

do $$ begin
  if to_regclass('public.park_facilities') is null then return; end if;
  update public.park_facilities set stamps_fn = 'guardian_all_earned_stamps' where code = 'guardian';
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'park_facilities' and column_name = 'coins_fn') then
    execute $q$ update public.park_facilities set coins_fn = 'guardian_play_coin_sources' where code = 'guardian' $q$;
  end if;
end $$;

revoke all on function public.guardian_all_earned_stamps(uuid), public.guardian_play_coin_sources(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2026-10-12 同學的時空旅人大頭：排行榜、對戰、團戰等待室、同學的徽章牆都改用樂園的頭像。
-- 只回「自己」和「跟我在同一個樂園班」（或我教的班）的人；樂園排行榜本來就看得到同學的大頭。
-- 一次最多 60 人。回 {student_id: look}，還沒建旅人的不列。
-- -----------------------------------------------------------------------------
create or replace function public.guardian_class_looks(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if to_regclass('public.park_travellers') is null then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(t.student_id, t.look)
      from public.park_travellers t
     where t.student_id = any (p_ids[1:60])
       and (t.student_id = v_me
            or exists (select 1 from public.park_class_members a
                         join public.park_class_members b on b.class_code = a.class_code
                        where a.student_id = t.student_id and b.student_id = v_me)
            or exists (select 1 from public.park_class_members a
                        where a.student_id = t.student_id and public.is_teacher_of(a.class_code)))
  ), '{}'::jsonb);
end;
$$;
revoke all on function public.guardian_class_looks(uuid[]) from public, anon;
grant execute on function public.guardian_class_looks(uuid[]) to authenticated;
