-- =============================================================================
-- 遊戲化國小英文練習 —— Supabase 資料表與權限
--
-- 執行方式：Supabase 後台 → SQL Editor → 新增查詢 → 把「整份」貼上去 → Run。
-- 跑完之後再跑一次 seed.sql（題庫與關卡目錄）。
--
-- 這份可以重複執行，不會把現有資料洗掉。
--
-- 三個貫穿全檔的原則：
--   1. 答題事件是唯一真相來源。金幣、經驗、掌握度、排行榜、老師報表都從它算。
--   2. 客戶端不能直接寫金幣。前端拿到的那把 publishable key 是公開的，
--      所以所有會加錢的動作都只能走底下的 RPC，資料表本身不給 insert/update 權限。
--   3. 學生只有班級代碼與暱稱，不收真實姓名與 email。
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. 目錄：題庫與關卡
--    金幣由資料庫算，所以資料庫必須知道每個字幾級、每一關是第幾關。
--    內容由 seed.sql 灌，這裡只建表。
-- -----------------------------------------------------------------------------

create table if not exists public.words (
  id     int primary key,
  word   text     not null,
  pos    text     not null default '',
  zh     text     not null default '',
  theme  text     not null default '',
  emoji  text     not null default '',
  spell  boolean  not null default false,
  level  smallint not null check (level between 1 and 3)
);

create table if not exists public.levels (
  id   text primary key,
  no   int  not null unique check (no > 0),
  name text not null default ''
);
-- 「這一關至少要答對幾題才可能通關」。通關與星星是伺服器判定的，就得知道這個數字。
-- 由 tools/gen-levels-seed.mjs 從 src/data/levels.ts 算出來（怪的總數打對折），
-- 訂得刻意寬鬆：擋的是「一題都沒答就說自己通關」，不是去評誰打得好。
alter table public.levels add column if not exists min_correct int not null default 0;

-- -----------------------------------------------------------------------------
-- 2. 老師與班級
--    老師是真的 Supabase 帳號（email 登入）。學生不是。
-- -----------------------------------------------------------------------------

-- 老師是真的 email 帳號。**但不是註冊了就是老師**：要管理員先把 email 放進
-- teacher_invites，註冊完呼叫 claim_teacher() 才會變成老師。
-- 沒有這道關卡的話，開放學生自由註冊之後，任何人拿 email 註冊都能開班。
create table if not exists public.teachers (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '老師',
  -- 最高管理者。可以發老師邀請、停用老師、重設任何人的密碼、看所有班級。
  is_admin     boolean not null default false,
  -- 停用的老師登入得了，但開不了班也看不到班級資料。
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 管理員指定「這個 email 可以成為老師」。老師自己註冊、自己設密碼，
-- 管理員不用經手別人的密碼，也不用等老師申請再核准。
create table if not exists public.teacher_invites (
  email      text primary key check (email = lower(btrim(email)) and email like '%@%'),
  invited_by uuid references auth.users(id) on delete set null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  code       text primary key
             check (code = upper(code) and code ~ '^[A-Z0-9]{3,12}$'),
  name       text not null default '',
  owner      uuid not null references auth.users(id) on delete cascade,
  -- 關掉之後沒加入過的人就進不來，期末可以關起來
  open       boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists classes_owner on public.classes(owner);

-- -----------------------------------------------------------------------------
-- 3. 學生
--    **帳號（你是誰）跟班級（你現在在哪一班）是分開的。**
--    班級只是一筆可以改的歸屬，所以升級換班不會弄丟角色與進度，
--    沒有班級的人（朋友的小孩）也照樣能玩。
--
--    id 用 uuid，不要用「班級代碼:暱稱」當主鍵——那樣暱稱永遠改不了。
-- -----------------------------------------------------------------------------

create table if not exists public.students (
  id         uuid primary key default gen_random_uuid(),

  -- 登入用的帳號，全站唯一。限英數與底線並一律存小寫：
  -- 中文帳號在不同裝置的輸入法會打出不一樣的字，小朋友會登入不了卻不知道為什麼。
  login_id   text not null unique
             check (login_id = lower(login_id) and login_id ~ '^[a-z0-9_]{3,16}$'),
  -- 六位以上英數密碼的 bcrypt。比對前一律轉小寫，
  -- 否則小朋友會被大寫鎖定鍵擋在門外，而且他們想不到是這個原因。
  pw_hash    text not null,

  -- 排行榜上顯示的名字，可以改，跟登入帳號無關。
  nickname   text not null check (length(btrim(nickname)) between 1 and 16),
  nickname_changed_at timestamptz,

  -- 現在在哪一班。null＝還沒加入任何班級。
  class_code text references public.classes(code) on delete set null on update cascade,

  -- 試錯鎖定。六位英數聽起來安全，但小朋友實際會取 abc123、自己的名字，
  -- 真正擋住猜測的是這個，不是長度。
  failed_attempts int not null default 0,
  locked_until    timestamptz,

  created_at timestamptz not null default now()
);
create index if not exists students_class on public.students(class_code);
-- 暱稱只在班內唯一。跨班重複沒關係，因為排行榜只比班內；
-- 同班重複才會讓人搞混誰是誰。沒有班級的人不受限制。
create unique index if not exists students_class_nickname
  on public.students(class_code, nickname) where class_code is not null;

-- 這台裝置現在是誰。匿名登入每台裝置一組 uid，靠這張表接回同一個學生，
-- 所以換平板也看得到自己的存檔——這就是要接後端的原因。
create table if not exists public.student_links (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  linked_at  timestamptz not null default now()
);
create index if not exists student_links_student on public.student_links(student_id);

-- -----------------------------------------------------------------------------
-- 4. 角色存檔
--    coins 與 exp 故意沒有給任何 update 權限，只有底下的 RPC 改得動。
-- -----------------------------------------------------------------------------

create table if not exists public.characters (
  student_id uuid primary key references public.students(id) on delete cascade,
  job        text  not null default 'knight' check (job in ('knight','mage')),
  exp        int   not null default 0   check (exp   >= 0),
  coins      int   not null default 120 check (coins >= 0),
  items      jsonb not null default '{}'::jsonb,
  equipped   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 舊的存檔沒有 avatar，補上。空字串＝還沒創角，登入後會被帶去創角畫面。
alter table public.characters add column if not exists avatar text not null default '';

-- 商店品項。**價格一定要放在資料庫這邊**，不能信客戶端送來的數字，
-- 不然改一下網頁就能用 1 塊錢買走全部東西。
-- 內容由 seed.sql 從 src/data/shop.ts 灌進來，那邊是唯一的來源。
create table if not exists public.shop_items (
  id           text primary key,
  price        int  not null check (price > 0),
  kind         text not null check (kind in ('consumable','cosmetic')),
  unlock_level int  not null default 1 check (unlock_level >= 1)
);
-- 裝飾品穿在哪個欄位。一個欄位一次只能穿一件：顏色只能有一種、外框只能有一個。
-- 這條規則放在資料庫而不是前端，因為「同時穿四種顏色」這種狀態一旦存進去，
-- 畫面要顯示哪一個就變成沒有答案的問題。
alter table public.shop_items add column if not exists slot text;
-- 2026-09-24 多一個欄位 legion（整套軍團，見 src/data/legions.ts）。
-- 約束要先拆再建，不然舊資料庫會一直停在只認 color／frame 的那一版。
alter table public.shop_items drop constraint if exists shop_items_slot_ck;
alter table public.shop_items add constraint shop_items_slot_ck
  check (slot is null or slot in ('color','frame','legion'));

-- 軍團包（2026-09-24）：
--   free              送的，不用買就能穿。陣營五色從這天起免費，equip_item 看這一欄。
--   need_achievement  要先拿到這個成就才開放購買（稀有級綁「頂階降臨」）。
--                     不設外鍵：seed.sql 先灌商店才灌成就目錄，設了新資料庫會灌不進去。
alter table public.shop_items add column if not exists free boolean not null default false;
alter table public.shop_items add column if not exists need_achievement text;

-- 2026-09-20 的品項搬家。第一版賣的「小皇冠／紅披風」是要畫在頭像上的，
-- 但那 25 張頭像是完成品不是可以疊圖層的人偶，所以改成了「皇冠框／金邊框」。
-- 已經花錢買過的人不能白買，這裡直接換成對應的新品項，錢不動。
-- 跑第二次以後 where 就不成立了，重複套用是安全的。
update public.characters c
   set items = (c.items - 'hat-crown' - 'cape-red')
             || (case when c.items ? 'hat-crown' then jsonb_build_object('frame-crown', 1) else '{}'::jsonb end)
             || (case when c.items ? 'cape-red'  then jsonb_build_object('frame-gold',  1) else '{}'::jsonb end),
       equipped = coalesce((
         select jsonb_agg(distinct case x when 'hat-crown' then 'frame-crown'
                                          when 'cape-red'  then 'frame-gold'
                                          else x end)
           from jsonb_array_elements_text(c.equipped) x), '[]'::jsonb)
 where c.items ? 'hat-crown' or c.items ? 'cape-red'
    or c.equipped @> '["hat-crown"]'::jsonb or c.equipped @> '["cape-red"]'::jsonb;

-- -----------------------------------------------------------------------------
-- 5. 答題事件 —— 整個系統的地基
-- -----------------------------------------------------------------------------

create table if not exists public.answer_events (
  id         bigint generated always as identity primary key,
  student_id uuid    not null references public.students(id) on delete cascade,
  word_id    int     not null references public.words(id),
  skill      text    not null check (skill in ('recognize','spell','listen')),
  correct    boolean not null,
  ms         int     not null default 0 check (ms >= 0),
  combo      int     not null default 0 check (combo >= 0),
  game_id    text    not null,
  -- 沒有關卡的遊戲（例如打地鼠）是 null
  level_id   text,
  -- 用伺服器時間，不用客戶端送來的，不然時間可以偽造
  at         timestamptz not null default now()
);
-- 一場遊戲一個 id。有了它，伺服器才能把「這一場答對幾題」跟「這一場通關了嗎」
-- 兜在一起——不然只能看時間區間，玩家開兩個分頁就騙得過去。
-- 舊資料沒有這一欄，所以可以是 null。
alter table public.answer_events add column if not exists session_id uuid;
create index if not exists answer_events_session on public.answer_events(session_id);
-- 這一題是這一場的第幾題。存在的理由只有一個：**同一題不可以被算兩次錢**。
--
-- 網路斷掉的時候，「伺服器沒收到」和「伺服器收到了但回不來」長得一模一樣，
-- 客戶端分不出來。結算失敗讓人按重試（不讓他按，人就卡在一個定住的畫面上），
-- 而重試一定會把整場的答題再送一次——沒有這個鍵，那一場的金幣就變兩倍。
-- 有了它，送幾次都只算一次，客戶端可以放心重試。
alter table public.answer_events add column if not exists ord smallint;
create unique index if not exists answer_events_once
  on public.answer_events(student_id, session_id, ord)
  where session_id is not null and ord is not null;
create index if not exists answer_events_student_at on public.answer_events(student_id, at desc);
create index if not exists answer_events_level on public.answer_events(student_id, level_id, at desc);
create index if not exists answer_events_word on public.answer_events(word_id);

-- 掌握度。這是事件跑一遍算出來的結果，存起來只是為了不要每次登入都撈三萬列。
-- 算錯了永遠可以用 rebuild_word_stats() 從事件重算。
create table if not exists public.word_stats (
  student_id uuid not null references public.students(id) on delete cascade,
  word_id    int  not null references public.words(id),
  skill      text not null check (skill in ('recognize','spell','listen')),
  seen       int  not null default 0,
  correct    int  not null default 0,
  wrong      int  not null default 0,
  streak     int  not null default 0,
  last_at    timestamptz,
  avg_ms     int  not null default 0,
  primary key (student_id, word_id, skill)
);

-- -----------------------------------------------------------------------------
-- 6. 關卡進度與老師開放的關卡
-- -----------------------------------------------------------------------------

create table if not exists public.level_progress (
  student_id   uuid not null references public.students(id) on delete cascade,
  level_id     text not null references public.levels(id) on delete cascade,
  stars        smallint not null default 0 check (stars between 0 and 3),
  best_correct int  not null default 0,
  cleared_at   timestamptz,
  primary key (student_id, level_id)
);

create table if not exists public.teacher_open (
  class_code text not null references public.classes(code) on delete cascade,
  level_id   text not null references public.levels(id) on delete cascade,
  primary key (class_code, level_id)
);

-- 魔王關。守塔的成就要分得出哪幾關是魔王關，而這件事的來源是
-- src/data/levels.ts（boss: true），由 tools/gen-levels-seed.mjs 灌進來。
alter table public.levels add column if not exists is_boss boolean not null default false;

-- 通關時的城堡血量與那一場的 session。
--   * best_survival：「城牆不倒」要知道有沒有一滴血都沒掉。
--   * last_win_session：「空手過關」要知道通關的那一場有沒有用道具。
alter table public.level_progress add column if not exists best_survival numeric not null default 0;
alter table public.level_progress add column if not exists last_win_session uuid;

-- 角色上的成就周邊。
--   * pinned：別在暱稱旁邊的三個徽章（同學看得到的那三個）
--   * title：稱號，一樣別在暱稱旁邊
--   * public_profile：允許同學從排行榜點進來看。預設開，自己可以關，老師一律看得到。
--   * avatars_seen：換過哪些頭像（「換頭像」要數種類，但 avatar 欄位只存現在這一個）
--   * jobs_cleared：用哪些職業通關過（「雙修」要用）
alter table public.characters add column if not exists pinned jsonb not null default '[]'::jsonb;
alter table public.characters add column if not exists title text not null default '';
alter table public.characters add column if not exists public_profile boolean not null default true;
alter table public.characters add column if not exists avatars_seen jsonb not null default '[]'::jsonb;
alter table public.characters add column if not exists jobs_cleared text[] not null default '{}';
-- 穿過哪些陣營顏色打過一場（「五色軍團」要用）。2026-09-24 顏色改成免費送之後，
-- 「買齊四色」變成白拿，所以改成五色都要真的穿上場。藍色存 'blue'，其他存品項 id。
-- 由伺服器在一場結束時照「那一刻身上穿什麼」記，前端送不進來。
alter table public.characters add column if not exists colors_played jsonb not null default '[]'::jsonb;

-- 成就限定的品項：商店買不到，只能解成就拿到。**買不到才有稀缺性。**
alter table public.shop_items add column if not exists achievement_only boolean not null default false;

-- 成就目錄。名字和說明在前端，這裡只存「機器要用的」：分類、順序、獎品。
create table if not exists public.achievements (
  id           text primary key,
  category     text not null check (category in
                 ('learn','skill','tower','versus','collect','habit','secret')),
  ord          smallint not null default 0,
  -- 解開的外框。指到 shop_items，因為「一個欄位只能穿一件」那條規則住在那邊。
  reward_item  text references public.shop_items(id) on delete set null,
  reward_title text not null default ''
);

create table if not exists public.student_achievements (
  student_id     uuid not null references public.students(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  primary key (student_id, achievement_id)
);
create index if not exists student_achievements_student
  on public.student_achievements(student_id, unlocked_at desc);

-- 第二版（2026-09-24）：**分階徽章**。同一格分銅銀金白金鑽石五階，拿到就一路往上升。
--   tiers        門檻由低到高；-1＝「全部」，照當下題庫換算（題庫會從 300 字長到兩千字）。
--                空陣列＝一次性徽章，跟第一版一樣只有拿到／沒拿到。
--   reward_tier  分階徽章到第幾階才給外框。
--   tier         這個學生到第幾階。**只升不降**，跟「只加不刪」同一個道理。
-- 舊資料的 tier 預設 1，下一次重算會照真實紀錄自己升上去，不用寫搬家。
alter table public.achievements add column if not exists tiers int[] not null default '{}';
alter table public.achievements add column if not exists reward_tier smallint not null default 1;
alter table public.student_achievements add column if not exists tier smallint not null default 1;
alter table public.student_achievements add column if not exists tier_at timestamptz;

-- 每一格分階徽章現在的數字（「還差 1,588 題」要用）。每次重算整格覆寫。
--   goal_all  「全部」這一階現在是多少（題庫幾個字、幾關）。
create table if not exists public.achievement_progress (
  student_id     uuid not null references public.students(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  value          int  not null default 0,
  goal_all       int  not null default 0,
  primary key (student_id, achievement_id)
);

-- 兵推的戰績。
--
-- **為什麼要這張表**：兵推本來只寫答題事件，每一場的輸贏根本沒存，
-- 所以對戰那一類六個成就有五個算不出來。順便也是好友挑戰要用的那張表——
-- 對手就是「一串照時間發生的答題」，這裡存的是那一串的結果。
--
-- 打電腦的場次照樣記（要算「初上戰場」「三線通吃」），但 **won 只在
-- opponent_kind = 'student' 時才算勝場**，不然贏電腦就能刷「戰旗」。
create table if not exists public.versus_matches (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students(id) on delete cascade,
  -- 那一場的 Session id，跟答題事件對得起來
  session_id       uuid,
  opponent_kind    text not null check (opponent_kind in ('cpu','ghost','student')),
  opponent_student uuid references public.students(id) on delete set null,
  opponent_name    text not null default '',
  won              boolean not null,
  -- 前線最後推到哪（0＝自己城牆，1＝對方城牆）
  front            numeric not null default 0.5 check (front between 0 and 1),
  -- 整場最落後的時候。逆轉勝要用。
  lowest_front     numeric not null default 0.5 check (lowest_front between 0 and 1),
  -- 用過哪幾條兵種線
  lines_used       text[] not null default '{}',
  -- 這一場推出過的最高兵階
  top_tier         smallint not null default 1 check (top_tier between 1 and 3),
  ended_at         timestamptz not null default now()
);
create index if not exists versus_matches_student
  on public.versus_matches(student_id, ended_at desc);

-- 同學的分身（2026-09-24）。
--
-- 每一場存下自己做過的事（答題、出兵、升階，照時間排），同學挑戰你時就重播
-- **你最近的那一場**。形狀是一串小陣列：[秒,'a',0|1]、[秒,'s',線,階]、[秒,'u']
-- （見 src/core/opponent.ts 的 packMoves）。legion 是那一場穿的軍團，伺服器自己看，
-- 前端送不進來。
--
-- opponent_kind 多一個 'ghost'：打分身。**分身不算勝場**，免得一直挑同一個弱的同學刷戰旗。
alter table public.versus_matches add column if not exists moves  jsonb;
alter table public.versus_matches add column if not exists legion text not null default '';
alter table public.versus_matches drop constraint if exists versus_matches_opponent_kind_check;
alter table public.versus_matches add constraint versus_matches_opponent_kind_check
  check (opponent_kind in ('cpu','ghost','student'));

-- 真人即時對戰（2026-09-25）：記是哪一場（live_matches.id），兩個人的戰報才對得起來。
-- 表在檔案最後面，所以這裡不掛外鍵。
alter table public.versus_matches add column if not exists live_match uuid;

-- 道具用在哪一場。
-- 「空手過關」要知道通關那一場有沒有用道具，「道具三味」要知道用過幾種，
-- 而 characters.items 是消耗品的「剩幾個」，用完歸零，什麼都看不出來。
create table if not exists public.item_uses (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  item_id    text not null,
  session_id uuid,
  level_id   text,
  at         timestamptz not null default now()
);
create index if not exists item_uses_student on public.item_uses(student_id, at desc);
create index if not exists item_uses_session on public.item_uses(session_id);

-- =============================================================================
-- 權限：先全部關起來，再一條一條開
-- =============================================================================

alter table public.words          enable row level security;
alter table public.levels         enable row level security;
alter table public.teachers       enable row level security;
alter table public.classes        enable row level security;
alter table public.students       enable row level security;
alter table public.student_links  enable row level security;
alter table public.characters     enable row level security;
alter table public.shop_items     enable row level security;
alter table public.answer_events  enable row level security;
alter table public.word_stats     enable row level security;
alter table public.level_progress enable row level security;
alter table public.teacher_open   enable row level security;

-- 沒寫 policy 的動作一律擋掉。寫入全部走 RPC，所以這裡只開讀。
revoke all on all tables in schema public from anon, authenticated;
grant select on public.words, public.levels, public.shop_items to anon, authenticated;
-- **students 只給得出這三欄。**
-- 同學之間要看得到彼此的暱稱（排行榜要用），但這張表現在還放著密碼雜湊、
-- 登入帳號和鎖定狀態。整張表 grant 出去的話，一個小朋友就能把全班的
-- 密碼雜湊撈回自己的平板慢慢破，RLS 擋不了這件事（RLS 管的是列，不是欄）。
grant select (id, nickname, class_code) on public.students to authenticated;

grant select on public.classes, public.characters,
                public.answer_events, public.word_stats,
                public.level_progress, public.teacher_open, public.student_links
  to authenticated;

-- teachers 與 teacher_invites 也要 grant，不然 policy 寫得再對也讀不到：
-- 少了這一行，老師登入後讀不到自己那一列，畫面上就永遠不是管理員。
-- 這兩張表沒有密碼之類的欄位，可以整張給，擋住列的是上面的 policy
-- （teachers 只看得到自己那列，invites 只有管理員看得到）。
grant select on public.teachers, public.teacher_invites to authenticated;

-- -----------------------------------------------------------------------------
-- 小幫手。都是 security definer，因為 policy 裡面再查有 RLS 的表會打結。
-- -----------------------------------------------------------------------------

create or replace function public.current_student_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select l.student_id from public.student_links l where l.user_id = auth.uid();
$$;

create or replace function public.current_class_code()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select s.class_code
    from public.student_links l
    join public.students s on s.id = l.student_id
   where l.user_id = auth.uid();
$$;

-- 最高管理者。
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.teachers t
     where t.user_id = auth.uid() and t.is_admin and t.active
  );
$$;

-- 這是不是你的班。被停用的老師會回 false，管理員對所有班都是 true。
create or replace function public.is_teacher_of(p_code text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or exists (
    select 1
      from public.classes c
      join public.teachers t on t.user_id = c.owner
     where c.code = p_code and c.owner = auth.uid() and t.active
  );
$$;

-- 匿名登入的人不能當老師。Supabase 把這件事放在 JWT 的 is_anonymous。
create or replace function public.is_real_account()
returns boolean language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

create or replace function public.owns_student(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.student_links l
     where l.user_id = auth.uid() and l.student_id = p_student
  ) or exists (
    select 1 from public.students s
     where s.id = p_student and public.is_teacher_of(s.class_code)
  );
$$;

-- -----------------------------------------------------------------------------
-- policy
-- -----------------------------------------------------------------------------

drop policy if exists words_read on public.words;
create policy words_read on public.words for select to anon, authenticated using (true);

drop policy if exists levels_read on public.levels;
create policy levels_read on public.levels for select to anon, authenticated using (true);

-- 邀請名單只有管理員看得到，而且只能透過 RPC 改。
alter table public.teacher_invites enable row level security;
drop policy if exists teacher_invites_admin on public.teacher_invites;
create policy teacher_invites_admin on public.teacher_invites for select to authenticated
  using (public.is_admin());

drop policy if exists teachers_self on public.teachers;
create policy teachers_self on public.teachers for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 學生看得到自己那一班（要顯示班名），老師看得到自己開的班
drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes for select to authenticated
  using (owner = auth.uid() or code = public.current_class_code() or public.is_admin());

-- 同班同學互相看得到暱稱，排行榜要用（只有三個欄位 grant 得出去，見上面）。
-- 第一條是「自己一定看得到自己」：沒有加入任何班級的人（朋友的小孩）
-- class_code 是 null，少了這條他連自己都讀不到。
drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated
  using (
    id = public.current_student_id()
    or (class_code is not null and class_code = public.current_class_code())
    or (class_code is not null and public.is_teacher_of(class_code))
    or public.is_admin()
  );

drop policy if exists student_links_self on public.student_links;
create policy student_links_self on public.student_links for select to authenticated
  using (user_id = auth.uid());

-- 角色存檔只有自己跟老師看得到。排行榜走底下的 class_leaderboard()，
-- 不讓同學直接翻彼此的背包。
-- 價目表本來就是要給大家看的，跟題庫、關卡同一類。
drop policy if exists shop_items_read on public.shop_items;
create policy shop_items_read on public.shop_items for select to anon, authenticated using (true);

drop policy if exists characters_read on public.characters;
create policy characters_read on public.characters for select to authenticated
  using (public.owns_student(student_id));

drop policy if exists answer_events_read on public.answer_events;
create policy answer_events_read on public.answer_events for select to authenticated
  using (public.owns_student(student_id));

drop policy if exists word_stats_read on public.word_stats;
create policy word_stats_read on public.word_stats for select to authenticated
  using (public.owns_student(student_id));

drop policy if exists level_progress_read on public.level_progress;
create policy level_progress_read on public.level_progress for select to authenticated
  using (public.owns_student(student_id));

drop policy if exists teacher_open_read on public.teacher_open;
create policy teacher_open_read on public.teacher_open for select to authenticated
  using (class_code = public.current_class_code() or public.is_teacher_of(class_code));

-- =============================================================================
-- 金幣與經驗的算式
--
-- 這一段必須跟 src/core/economy.ts 一模一樣。兩邊都有是因為：
--   前端要立刻把數字跳出來給小朋友看，後端才是真的算數的那個。
-- 改其中一邊記得改另一邊，src/core/economy.ts 上面有標。
-- =============================================================================

-- 字級基礎值：1→3、2→4、3→6，鼓勵去啃難的字
create or replace function public.coin_base(p_level int)
returns numeric language sql immutable as $$
  select case p_level when 1 then 3 when 2 then 4 when 3 then 6 else 3 end::numeric;
$$;

-- 同一個字重複答對會遞減，不然刷同一個字最划算
create or replace function public.coin_repeat_factor(p_times_correct int)
returns numeric language sql immutable as $$
  select (array[1, 1, 0.7, 0.5, 0.35, 0.25, 0.15]::numeric[])
         [ least(greatest(p_times_correct, 0), 6) + 1 ];
$$;

-- 連擊加成，上限兩倍
create or replace function public.coin_combo_multiplier(p_combo int)
returns numeric language sql immutable as $$
  select 1 + least(1, floor(greatest(p_combo, 0) / 3.0) * 0.2);
$$;

create or replace function public.coin_value(p_level int, p_times_correct int, p_combo int)
returns int language sql immutable as $$
  select greatest(1, round(
    public.coin_base(p_level)
    * public.coin_repeat_factor(p_times_correct)
    * public.coin_combo_multiplier(p_combo)
  ))::int;
$$;

-- =============================================================================
-- RPC —— 所有會改到資料的動作
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 學生帳號
--
-- 學生**不用** Supabase 的 email 帳號，理由是實測發現的：Supabase 的註冊
-- 一定綁 email，每註冊一個就想寄一封確認信，而內建寄信額度非常小，
-- 連續註冊五個就被擋（email rate limit）。一整班三十個人同時註冊會直接卡死。
--
-- 所以學生走這條路：裝置先匿名登入拿到一個 auth 身分，再呼叫底下的
-- register_student / login_student 帶帳號密碼，驗過就把這台裝置綁到那個學生。
-- 密碼用 bcrypt 存在我們自己的表裡，完全不碰寄信。
-- -----------------------------------------------------------------------------

-- 密碼規則。不要求大小寫混合或特殊符號：那種規則只會讓國小生記不住，
-- 然後全班都來找老師重設。真正擋住猜測的是底下的試錯鎖定。
create or replace function public.password_problem(p_password text, p_login_id text)
returns text language plpgsql immutable as $$
declare v text := lower(coalesce(p_password, ''));
begin
  if length(v) < 6 or length(v) > 32 then return '密碼要 6 到 32 個字'; end if;
  if v !~ '^[a-z0-9]+$' then return '密碼只能用英文字母和數字'; end if;
  if v ~ '^(.)\1+$' then return '密碼不能整串都是同一個字'; end if;
  if strpos('0123456789', v) > 0 or strpos('abcdefghijklmnopqrstuvwxyz', v) > 0
    then return '密碼不能是連號或照順序的字母'; end if;
  if v = lower(coalesce(p_login_id, '')) then return '密碼不能跟帳號一樣'; end if;
  return null;
end;
$$;

-- 把這台裝置綁到某個學生身上，並把試錯次數歸零。
create or replace function public.link_device(p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.student_links (user_id, student_id)
  values (auth.uid(), p_student)
  on conflict (user_id) do update set student_id = excluded.student_id, linked_at = now();
  update public.students
     set failed_attempts = 0, locked_until = null
   where id = p_student;
end;
$$;

-- -----------------------------------------------------------------------------
-- 註冊。班級代碼就是邀請碼：沒有一組有效而且開放加入的代碼就註冊不了，
-- 所以網址流出去也不會變成一個任何人都能進的公開網站。
-- -----------------------------------------------------------------------------
create or replace function public.register_student(
  p_login_id   text,
  p_password   text,
  p_nickname   text,
  p_class_code text
)
returns table (student_id uuid, login_id text, nickname text, class_code text)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  v_login text := lower(btrim(coalesce(p_login_id, '')));
  v_nick  text := btrim(coalesce(p_nickname, ''));
  v_code  text := upper(btrim(coalesce(p_class_code, '')));
  v_open  boolean;
  v_bad   text;
  v_id    uuid;
begin
  if auth.uid() is null then raise exception '請先開啟遊戲再註冊'; end if;
  if v_login !~ '^[a-z0-9_]{3,16}$' then
    raise exception '帳號要 3 到 16 個字，只能用英文字母、數字和底線';
  end if;
  if v_nick = '' or length(v_nick) > 16 then raise exception '暱稱要 1 到 16 個字'; end if;

  v_bad := public.password_problem(p_password, v_login);
  if v_bad is not null then raise exception '%', v_bad; end if;

  select c.open into v_open from public.classes c where c.code = v_code;
  if v_open is null then raise exception '找不到這組班級代碼'; end if;
  if not v_open then raise exception '這一班目前沒有開放加入，請老師打開'; end if;

  if exists (select 1 from public.students s where s.login_id = v_login) then
    raise exception '這個帳號已經有人用了，換一個';
  end if;
  if exists (select 1 from public.students s where s.class_code = v_code and s.nickname = v_nick) then
    raise exception '這一班已經有人叫這個暱稱了，換一個';
  end if;

  insert into public.students (login_id, pw_hash, nickname, class_code)
  values (v_login, extensions.crypt(lower(p_password), extensions.gen_salt('bf')), v_nick, v_code)
  returning id into v_id;
  insert into public.characters (student_id) values (v_id) on conflict (student_id) do nothing;

  perform public.link_device(v_id);
  return query select v_id, v_login, v_nick, v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- 登入。連續錯五次鎖十分鐘，老師或管理員可以立刻解鎖。
--
-- **這支不用 raise exception 回報失敗，而是回一個 error 欄位**，理由踩過坑：
-- 在 Postgres 裡 raise exception 會把同一筆交易裡的 update 一起回滾，
-- 所以「記下這次打錯了」跟「丟出錯誤」不能並存——本機測試就是這樣抓到的，
-- 鎖定次數永遠停在 0。現在改成回傳錯誤字串，由前端自己丟出來。
--
-- 帳號不存在跟密碼錯誤回同一句話，才不會讓人拿這支函式問出誰有註冊。
-- -----------------------------------------------------------------------------
create or replace function public.login_student(p_login_id text, p_password text)
returns table (student_id uuid, login_id text, nickname text, class_code text, error text)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  v_login text := lower(btrim(coalesce(p_login_id, '')));
  v_rec   public.students%rowtype;
  v_wait  int;
begin
  if auth.uid() is null then
    return query select null::uuid, null::text, null::text, null::text, '請先開啟遊戲再登入'::text;
    return;
  end if;

  select * into v_rec from public.students s where s.login_id = v_login;
  if v_rec.id is null then
    return query select null::uuid, null::text, null::text, null::text, '帳號或密碼不對'::text;
    return;
  end if;

  if v_rec.locked_until is not null and v_rec.locked_until > now() then
    v_wait := greatest(1, ceil(extract(epoch from (v_rec.locked_until - now())) / 60));
    return query select null::uuid, null::text, null::text, null::text,
      format('密碼錯太多次了，請等 %s 分鐘再試，或請老師幫你重設', v_wait);
    return;
  end if;

  if extensions.crypt(lower(coalesce(p_password, '')), v_rec.pw_hash) <> v_rec.pw_hash then
    update public.students
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '10 minutes' end
     where id = v_rec.id;
    return query select null::uuid, null::text, null::text, null::text, '帳號或密碼不對'::text;
    return;
  end if;

  perform public.link_device(v_rec.id);
  return query select v_rec.id, v_rec.login_id, v_rec.nickname, v_rec.class_code, null::text;
end;
$$;

-- 學生自己改密碼。要先打對舊的，免得別人拿到一台沒鎖的平板就把密碼換掉。
create or replace function public.student_set_password(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_id uuid := public.current_student_id(); v_hash text; v_login text; v_bad text;
begin
  if v_id is null then raise exception '請先登入'; end if;
  select s.pw_hash, s.login_id into v_hash, v_login from public.students s where s.id = v_id;
  if extensions.crypt(lower(coalesce(p_old, '')), v_hash) <> v_hash then
    raise exception '舊密碼不對';
  end if;
  v_bad := public.password_problem(p_new, v_login);
  if v_bad is not null then raise exception '%', v_bad; end if;
  update public.students
     set pw_hash = extensions.crypt(lower(p_new), extensions.gen_salt('bf'))
   where id = v_id;
end;
$$;

-- 學生自己改暱稱。一週一次，不然一定有人整節課都在改名字玩。
create or replace function public.student_set_nickname(p_nickname text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := public.current_student_id();
  v_nick text := btrim(coalesce(p_nickname, ''));
  v_code text; v_last timestamptz;
begin
  if v_id is null then raise exception '請先登入'; end if;
  if v_nick = '' or length(v_nick) > 16 then raise exception '暱稱要 1 到 16 個字'; end if;

  select s.class_code, s.nickname_changed_at into v_code, v_last
    from public.students s where s.id = v_id;

  if v_last is not null and v_last > now() - interval '7 days' then
    raise exception '暱稱一週只能改一次，上次是 % ', to_char(v_last, 'MM/DD');
  end if;
  if v_code is not null and exists (
    select 1 from public.students s
     where s.class_code = v_code and s.nickname = v_nick and s.id <> v_id
  ) then raise exception '這一班已經有人叫這個暱稱了'; end if;

  update public.students set nickname = v_nick, nickname_changed_at = now() where id = v_id;
  return v_nick;
end;
$$;

-- 換班（或第一次加入班級）。角色、金幣、進度完全不動，只換一筆歸屬。
create or replace function public.student_join_class(p_class_code text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := public.current_student_id();
  v_code text := upper(btrim(coalesce(p_class_code, '')));
  v_open boolean; v_nick text;
begin
  if v_id is null then raise exception '請先登入'; end if;
  select c.open into v_open from public.classes c where c.code = v_code;
  if v_open is null then raise exception '找不到這組班級代碼'; end if;
  if not v_open then raise exception '這一班目前沒有開放加入'; end if;

  select s.nickname into v_nick from public.students s where s.id = v_id;
  if exists (select 1 from public.students s
              where s.class_code = v_code and s.nickname = v_nick and s.id <> v_id) then
    raise exception '這一班已經有人叫「%」了，請先改一個別的暱稱再加入', v_nick;
  end if;

  update public.students set class_code = v_code where id = v_id;
  return v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- 交答題事件。前端唯一能讓金幣變多的入口。
--
-- p_events 是 AnswerReport 的陣列：
--   [{ "wordId": 12, "skill": "recognize", "correct": true, "ms": 1800,
--      "combo": 3, "gameId": "tower-defense", "levelId": "td-01" }, ...]
-- 客戶端送來的 coins / exp / at 一律忽略，這裡自己算自己蓋時間。
-- -----------------------------------------------------------------------------
create or replace function public.submit_answers(p_events jsonb)
returns table (coins int, exp int, gained_coins int, gained_exp int)
language plpgsql security definer set search_path = public, pg_temp as $$
-- returns table 的欄位名會變成 PL/pgSQL 變數，跟資料表欄位撞名時 Postgres 會直接拒絕。
-- 這一行叫它撞名時一律當作欄位（回傳值都是用 return query 給的，不靠變數名）。
#variable_conflict use_column
declare
  v_student uuid := public.current_student_id();
  e         jsonb;
  v_word    int;
  v_skill   text;
  v_level   smallint;
  v_ok      boolean;
  v_ms      int;
  v_combo   int;
  v_prior   int;
  v_ord     smallint;
  v_gain_c  int := 0;
  v_gain_e  int := 0;
begin
  if v_student is null then
    raise exception '還沒加入班級';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events 要是陣列';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception '一次最多 500 題';
  end if;

  for e in select value from jsonb_array_elements(p_events) loop
    v_word  := nullif(e ->> 'wordId', '')::int;
    v_skill := e ->> 'skill';
    if v_word is null or v_skill not in ('recognize','spell','listen') then
      continue;
    end if;

    select w.level into v_level from public.words w where w.id = v_word;
    if v_level is null then
      continue;   -- 題庫沒有的字就當沒發生
    end if;

    v_ok    := coalesce((e ->> 'correct')::boolean, false);
    v_ms    := least(greatest(coalesce((e ->> 'ms')::int, 0), 0), 600000);
    v_combo := least(greatest(coalesce((e ->> 'combo')::int, 0), 0), 999);

    select ws.correct into v_prior
      from public.word_stats ws
     where ws.student_id = v_student and ws.word_id = v_word and ws.skill = v_skill;
    v_prior := coalesce(v_prior, 0);

    v_ord := nullif(e ->> 'ord', '')::smallint;

    insert into public.answer_events
      (student_id, word_id, skill, correct, ms, combo, game_id, level_id, session_id, ord)
    values
      (v_student, v_word, v_skill, v_ok, v_ms, v_combo,
       coalesce(e ->> 'gameId', 'unknown'), nullif(e ->> 'levelId', ''),
       -- 格式不對就當沒有，不要讓一個壞欄位把整包答題擋下來
       (case when (e ->> 'sessionId') ~ '^[0-9a-fA-F-]{36}$'
             then (e ->> 'sessionId')::uuid end),
       v_ord)
    on conflict do nothing;

    -- 這一題之前就進來過（客戶端重試）。掌握度和金幣都跳過，不然會算兩次。
    if not found then
      continue;
    end if;

    insert into public.word_stats as ws
      (student_id, word_id, skill, seen, correct, wrong, streak, last_at, avg_ms)
    values
      (v_student, v_word, v_skill, 1,
       case when v_ok then 1 else 0 end,
       case when v_ok then 0 else 1 end,
       case when v_ok then 1 else 0 end,
       now(),
       case when v_ok then v_ms else 0 end)
    on conflict (student_id, word_id, skill) do update set
      seen    = ws.seen + 1,
      -- 只有答對的反應時間有意義，答錯的時間是在亂點
      avg_ms  = case when v_ok
                     then round((ws.avg_ms::numeric * ws.correct + v_ms) / (ws.correct + 1))::int
                     else ws.avg_ms end,
      correct = ws.correct + case when v_ok then 1 else 0 end,
      wrong   = ws.wrong   + case when v_ok then 0 else 1 end,
      streak  = case when v_ok then ws.streak + 1 else 0 end,
      last_at = now();

    if v_ok then
      v_gain_c := v_gain_c + public.coin_value(v_level, v_prior, v_combo);
      v_gain_e := v_gain_e + v_level;
    end if;
  end loop;

  update public.characters c
     set coins = c.coins + v_gain_c,
         exp   = c.exp   + v_gain_e,
         updated_at = now()
   where c.student_id = v_student;

  return query
    select c.coins, c.exp, v_gain_c, v_gain_e
      from public.characters c where c.student_id = v_student;
end;
$$;

-- -----------------------------------------------------------------------------
-- 存關卡進度。
--
-- **星星與答對數是伺服器自己算的，前端說了不算。** 個人玩的時候作弊只是騙自己，
-- 但星星會上排行榜，排行榜一出現就值得作弊了——而且小朋友真的會找漏洞，
-- 第一次試玩就有人發現亂點得分，不是假想敵。
--
-- 做法：前端送「這一場的 id」，伺服器自己去數這一場答對幾題、問了幾題，
-- 由正確率算星星（規則跟 core/progress.ts 的 starsFor 一模一樣）。
--
-- 還是信前端的兩件事，以及為什麼可以接受：
--   * p_win（我守住了嗎）：城堡有沒有被打破是玩法的結果，不重跑一場算不出來。
--     但守塔的怪只會被齊射打死，而齊射只有答對才會發生，所以「通關」至少要
--     答對 levels.min_correct 題——達不到就不算通關，那一場只記錄答題。
--   * p_survival（城堡剩幾成血）：只影響第三顆星，而且夾在 0~1 之間。
-- 兩個都不可能靠「直接呼叫這支函式」憑空生出星星，最好按的那個洞堵住了。
-- -----------------------------------------------------------------------------

-- 星星規則。跟 src/core/progress.ts 的 starsFor 是同一套，改一邊要改另一邊
-- （tools/test/economy-parity.mjs 會對帳）。
-- 用正確率當門檻不用速度，因為用速度會鼓勵亂點。
create or replace function public.stars_of(
  p_win boolean, p_correct int, p_asked int, p_survival numeric)
returns int language sql immutable as $$
  select case
    when not coalesce(p_win, false) then 0
    when coalesce(p_asked, 0) = 0 then 0
    when p_correct::numeric / p_asked >= 0.8
     and least(greatest(coalesce(p_survival, 0), 0), 1) >= 0.6 then 3
    when p_correct::numeric / p_asked >= 0.8 then 2
    else 1
  end;
$$;

-- 參數變了，舊的那支要丟掉，不然會變成兩支同名函式，前端呼叫誰全看運氣。
drop function if exists public.save_progress(text, int, int, boolean);
/*
  記下「穿著什麼顏色打了一場」（「五色軍團」要用）。一場結束時由 save_progress 與
  record_versus_match 叫。**看的是那一刻身上穿什麼**，前端送不進來。
  換上別的軍團時顏色是灰的（沒作用），那一場就不算哪一色。
*/
create or replace function public.note_color_played(p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_color text;
begin
  select case
           when exists (select 1 from jsonb_array_elements_text(c.equipped) e
                          join public.shop_items i on i.id = e and i.slot = 'legion') then null
           else coalesce((select e from jsonb_array_elements_text(c.equipped) e
                            join public.shop_items i on i.id = e and i.slot = 'color'
                           limit 1), 'blue')
         end
    into v_color
    from public.characters c where c.student_id = p_student;
  if v_color is null then return; end if;
  update public.characters c
     set colors_played = c.colors_played || to_jsonb(v_color)
   where c.student_id = p_student and not (c.colors_played @> to_jsonb(v_color));
end;
$$;
revoke all on function public.note_color_played(uuid) from public, anon, authenticated;

create or replace function public.save_progress(
  p_level_id  text,
  p_session   uuid,
  p_win       boolean,
  p_survival  numeric default 0
)
returns table (stars int, best_correct int, cleared_at timestamptz,
               bonus_coins int, counted_correct int, counted_asked int, win boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
-- returns table 的欄位名會變成 PL/pgSQL 變數，跟資料表欄位撞名時 Postgres 會直接拒絕。
-- 這一行叫它撞名時一律當作欄位（回傳值都是用 return query 給的，不靠變數名）。
#variable_conflict use_column
declare
  v_student uuid := public.current_student_id();
  v_no      int;
  v_min     int;
  v_was     timestamptz;
  v_correct int := 0;
  v_asked   int := 0;
  v_win     boolean;
  v_stars   int;
  v_bonus   int := 0;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;

  select l.no, l.min_correct into v_no, v_min from public.levels l where l.id = p_level_id;
  if v_no is null then raise exception '沒有這一關：%', p_level_id; end if;

  -- 這一場答了什麼，資料庫自己數。沒有 session id 就一題都不算，
  -- 也就拿不到星星——舊版的前端送不出這個欄位，升版時會自己接上。
  if p_session is not null then
    select count(*) filter (where ae.correct), count(*)
      into v_correct, v_asked
      from public.answer_events ae
     where ae.student_id = v_student
       and ae.session_id = p_session
       and ae.level_id   = p_level_id;
  end if;

  -- 怪只會被齊射打死，齊射只有答對才會發生。答對的題數連下限都不到，
  -- 就不可能是真的打過去的。
  v_win   := coalesce(p_win, false) and v_correct >= v_min;
  v_stars := public.stars_of(v_win, v_correct, v_asked, p_survival);

  select lp.cleared_at into v_was
    from public.level_progress lp
   where lp.student_id = v_student and lp.level_id = p_level_id;

  if v_win and v_was is null then
    v_bonus := 40 + v_no * 10;
  end if;

  insert into public.level_progress as lp
    (student_id, level_id, stars, best_correct, cleared_at, best_survival, last_win_session)
  values
    (v_student, p_level_id, v_stars, v_correct,
     case when v_win then now() else null end,
     case when v_win then least(greatest(coalesce(p_survival, 0), 0), 1) else 0 end,
     case when v_win then p_session end)
  on conflict (student_id, level_id) do update set
    stars        = greatest(lp.stars, excluded.stars),
    best_correct = greatest(lp.best_correct, excluded.best_correct),
    -- 第一次通關的時間留著，重玩不覆蓋
    cleared_at   = coalesce(lp.cleared_at, excluded.cleared_at),
    -- 城堡血留最好的那一次（「城牆不倒」要用），只有通關的場次算
    best_survival = greatest(lp.best_survival, excluded.best_survival),
    last_win_session = coalesce(excluded.last_win_session, lp.last_win_session);

  -- 用哪個職業通關過（「雙修」要用）。職業隨時可以改，所以要在通關那一刻記。
  if v_win then
    update public.characters c
       set jobs_cleared = (select array_agg(distinct x)
                             from unnest(c.jobs_cleared || array[c.job]) x),
           updated_at = now()
     where c.student_id = v_student and not (c.jobs_cleared @> array[c.job]);
  end if;

  if v_bonus > 0 then
    update public.characters c
       set coins = c.coins + v_bonus, updated_at = now()
     where c.student_id = v_student;
  end if;

  -- 真的有答題才算「打過一場」，進去馬上離開的不算
  if v_asked > 0 then perform public.note_color_played(v_student); end if;

  return query
    select lp.stars::int, lp.best_correct, lp.cleared_at, v_bonus, v_correct, v_asked, v_win
      from public.level_progress lp
     where lp.student_id = v_student and lp.level_id = p_level_id;
end;
$$;

-- 換職業。外觀與職業可以自己改，金幣不行，所以只開這一支。
create or replace function public.set_job(p_job text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  if p_job not in ('knight','mage') then raise exception '沒有這個職業'; end if;
  update public.characters set job = p_job, updated_at = now() where student_id = v_student;
end;
$$;

-- 等級只負責解鎖，公式跟 src/core/progress.ts 的 levelFromExp 一樣。
-- **改一邊要改另一邊**，跟金幣算式一樣的老問題，所以對帳測試把它一起測了。
create or replace function public.level_of(p_exp int)
returns int language sql immutable as $$ select (p_exp / 120) + 1 $$;

create or replace function public.set_avatar(p_avatar text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  -- 只認 Avatars_01 ~ Avatars_25，不然什麼字串都塞得進來
  if p_avatar !~ '^Avatars_(0[1-9]|1[0-9]|2[0-5])$' then
    raise exception '沒有這張頭像';
  end if;
  -- 換過哪些頭像要留著。avatar 欄位只存「現在這一個」，
  -- 但「換頭像」那個成就數的是種類。
  update public.characters c
     set avatar = p_avatar,
         avatars_seen = case when c.avatars_seen @> to_jsonb(p_avatar)
                             then c.avatars_seen
                             else c.avatars_seen || to_jsonb(p_avatar) end,
         updated_at = now()
   where c.student_id = v_student;
end;
$$;

/*
  買東西。**價格、等級門檻、餘額全部在這裡查**，客戶端只送品項 id。
  金幣本來就只有 RPC 動得了（見上面 characters 的註解），買東西是唯一會扣錢的地方。
*/
create or replace function public.buy_item(p_item text)
returns table (coins int, items jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_student uuid := public.current_student_id();
  v_price int; v_unlock int; v_coins int; v_exp int; v_only boolean;
  v_free boolean; v_need text;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  select i.price, i.unlock_level, i.achievement_only, i.free, i.need_achievement
    into v_price, v_unlock, v_only, v_free, v_need
    from public.shop_items i where i.id = p_item;
  if v_price is null then raise exception '商店裡沒有這個東西'; end if;
  -- 成就限定的東西買不到。買得到就不稀有了，而且商店根本沒把它畫出來，
  -- 會走到這一行的只有自己打 API 的人。
  if v_only then raise exception '這個要解成就才拿得到，買不到'; end if;
  -- 送的東西不用買（陣營五色）。不擋的話舊版前端還是會讓人花錢買。
  if v_free then raise exception '這個是送的，不用買，去「我的角色」直接換上'; end if;
  -- 稀有級軍團：先拿到指定成就才開放購買。分階徽章拿到第一階就算。
  if v_need is not null and not exists (
       select 1 from public.student_achievements sa
        where sa.student_id = v_student and sa.achievement_id = v_need) then
    raise exception '要先拿到指定的成就才買得到';
  end if;

  select c.coins, c.exp into v_coins, v_exp
    from public.characters c where c.student_id = v_student for update;
  if public.level_of(v_exp) < v_unlock then
    raise exception '等級不夠，要 % 級才買得到', v_unlock;
  end if;
  if v_coins < v_price then raise exception '金幣不夠，還差 % 枚', v_price - v_coins; end if;

  update public.characters c
     set coins = c.coins - v_price,
         items = jsonb_set(c.items, array[p_item],
                           to_jsonb(coalesce((c.items ->> p_item)::int, 0) + 1), true),
         updated_at = now()
   where c.student_id = v_student;

  return query select c.coins, c.items from public.characters c where c.student_id = v_student;
end;
$$;

/* 穿脫裝飾品。沒有買過就穿不了，而且消耗品不能穿在身上。 */
create or replace function public.equip_item(p_item text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.current_student_id();
  v_kind text; v_slot text; v_have int; v_equipped jsonb; v_free boolean;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  select i.kind, i.slot, i.free into v_kind, v_slot, v_free
    from public.shop_items i where i.id = p_item;
  if v_kind is null then raise exception '沒有這個東西'; end if;
  if v_kind <> 'cosmetic' then raise exception '這個不是穿戴的東西'; end if;

  select coalesce((c.items ->> p_item)::int, 0) into v_have
    from public.characters c where c.student_id = v_student;
  -- 送的東西（陣營五色）不用擁有就能穿
  if p_on and v_have <= 0 and not v_free then raise exception '你還沒有這個東西'; end if;

  -- 穿上同欄位的東西時，先把那個欄位原本那件脫下來。
  -- 不做這件事的話會出現「同時穿紅色和紫色」，畫面就不知道要顯示哪一個。
  update public.characters c
     set equipped = case when p_on
           then (select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
                   from jsonb_array_elements_text(
                          coalesce((select jsonb_agg(x)
                                      from jsonb_array_elements_text(c.equipped) x
                                     where v_slot is null
                                        or x not in (select i.id from public.shop_items i
                                                      where i.slot = v_slot)),
                                   '[]'::jsonb) || to_jsonb(p_item)) e)
           else coalesce((select jsonb_agg(e)
                   from jsonb_array_elements_text(c.equipped) e
                  where e <> p_item), '[]'::jsonb) end,
         updated_at = now()
   where c.student_id = v_student
  returning c.equipped into v_equipped;
  return coalesce(v_equipped, '[]'::jsonb);
end;
$$;

/* 用掉一個消耗品。數量不夠就擋下來，不然按快一點就能無限用。 */
-- 參數變多了（多了「用在哪一場」），舊的那支要先丟掉，
-- 不然會變成兩支同名函式，前端呼叫到哪一支全看運氣。
drop function if exists public.consume_item(text);
create or replace function public.consume_item(
  p_item text, p_session uuid default null, p_level_id text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.current_student_id();
  v_have int; v_items jsonb;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  select coalesce((c.items ->> p_item)::int, 0) into v_have
    from public.characters c where c.student_id = v_student for update;
  if v_have <= 0 then raise exception '你沒有這個道具了'; end if;

  update public.characters c
     set items = jsonb_set(c.items, array[p_item], to_jsonb(v_have - 1), true),
         updated_at = now()
   where c.student_id = v_student
  returning c.items into v_items;

  -- 用在哪一場要留著：「空手過關」要知道通關那一場有沒有用道具，
  -- 「道具三味」要知道用過幾種。背包只存剩幾個，用完歸零就什麼都看不出來。
  insert into public.item_uses (student_id, item_id, session_id, level_id)
  values (v_student, p_item, p_session, nullif(p_level_id, ''));

  return v_items;
end;
$$;

-- 同班排行榜。只給暱稱、分數和外觀，不給背包內容——
-- 「誰有幾個道具」不是排行榜的事，但**外框和顏色一定要看得到**：
-- 收集品要同學看得到才有意義（見 src/data/cosmetics.ts）。
-- me 是「這一列是不是我」，讓畫面把自己那一行標出來，不用把 id 送出去。
-- 回傳的欄位變多了，create or replace 不能改回傳型別，所以先丟掉舊的。
-- 多了四欄（id、稱號、徽章數、檔案開不開）：排行榜的名字點下去要能看同學的
-- 徽章牆，所以這裡得說「這是誰」和「他讓不讓看」。
drop function if exists public.class_leaderboard(text);
create or replace function public.class_leaderboard(p_code text default null)
returns table (student_id uuid, nickname text, coins int, exp int, stars int,
               avatar text, equipped jsonb, me boolean,
               title text, badges int, viewable boolean, pins jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (
    select coalesce(upper(btrim(p_code)), public.current_class_code()) as code
  )
  select s.id, s.nickname, c.coins, c.exp,
         coalesce((select sum(lp.stars)::int from public.level_progress lp
                    where lp.student_id = s.id), 0),
         c.avatar, c.equipped, s.id = public.current_student_id(),
         c.title,
         (select count(*)::int from public.student_achievements sa
           where sa.student_id = s.id),
         -- 自己的一定看得到；同學的要他沒關起來；老師看得到全班。
         (s.id = public.current_student_id() or c.public_profile
          or public.is_teacher_of(s.class_code)),
         -- 別在名字旁邊的三個，連同階級：[{"id":"hundred","tier":3}, ...]。
         -- 第一個是主徽章。只露自己拿到的（set_pinned 已經擋過，這裡再擋一次）。
         coalesce((select jsonb_agg(jsonb_build_object('id', sa.achievement_id, 'tier', sa.tier)
                                    order by p.i)
                     from jsonb_array_elements_text(c.pinned) with ordinality as p(id, i)
                     join public.student_achievements sa
                       on sa.student_id = s.id and sa.achievement_id = p.id), '[]'::jsonb)
    from public.students s
    join public.characters c on c.student_id = s.id
    join target t on t.code = s.class_code
   where t.code = public.current_class_code() or public.is_teacher_of(t.code)
   order by c.exp desc, c.coins desc;
$$;

-- =============================================================================
-- 老師後台
-- =============================================================================

-- 老師開班。第一次開班順便把自己登記成老師。匿名帳號不行。
create or replace function public.create_class(p_code text, p_name text default '')
returns table (code text, name text)
language plpgsql security definer set search_path = public, pg_temp as $$
-- returns table 的欄位名會變成 PL/pgSQL 變數，跟資料表欄位撞名時 Postgres 會直接拒絕。
-- 這一行叫它撞名時一律當作欄位（回傳值都是用 return query 給的，不靠變數名）。
#variable_conflict use_column
declare v_code text := upper(btrim(p_code));
begin
  -- 以前這裡只擋匿名帳號，等於任何人拿 email 註冊就能開班變老師。
  -- 開放學生自由註冊之後那會是個真的洞，所以改成必須是啟用中的老師。
  if not exists (select 1 from public.teachers t
                  where t.user_id = auth.uid() and t.active) then
    raise exception '只有老師可以開班。請先請管理員把你加進老師名單';
  end if;
  if v_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception '班級代碼只能用英文字母和數字，3 到 12 個字';
  end if;
  if exists (select 1 from public.classes c where c.code = v_code and c.owner <> auth.uid()) then
    raise exception '這個班級代碼已經有人用了';
  end if;

  insert into public.classes as c (code, name, owner) values (v_code, coalesce(p_name,''), auth.uid())
    on conflict (code) do update set name = excluded.name;

  return query select c.code, c.name from public.classes c where c.code = v_code;
end;
$$;

-- 老師這禮拜開放哪幾關。整包覆蓋，跟前端的 setTeacherOpen 一樣。
create or replace function public.teacher_set_open(p_code text, p_level_ids text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(p_code));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  delete from public.teacher_open t where t.class_code = v_code;
  insert into public.teacher_open (class_code, level_id)
  select v_code, l.id from public.levels l where l.id = any(coalesce(p_level_ids, '{}'));
end;
$$;

-- 老師加人。小朋友自己進不來的時候（打錯暱稱、忘記），老師直接開一個。
-- 老師代學生開帳號。小朋友自己註冊是常態，這支是補救用的：
-- 有人忘記註冊、或是註冊卡住，老師可以直接幫他開一個再把密碼告訴他。
create or replace function public.teacher_add_student(
  p_code text, p_login_id text, p_password text, p_nickname text
)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_code  text := upper(btrim(p_code));
  v_login text := lower(btrim(coalesce(p_login_id, '')));
  v_nick  text := btrim(coalesce(p_nickname, ''));
  v_bad   text;
  v_id    uuid;
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  if v_login !~ '^[a-z0-9_]{3,16}$' then
    raise exception '帳號要 3 到 16 個字，只能用英文字母、數字和底線';
  end if;
  if v_nick = '' or length(v_nick) > 16 then raise exception '暱稱要 1 到 16 個字'; end if;
  v_bad := public.password_problem(p_password, v_login);
  if v_bad is not null then raise exception '%', v_bad; end if;
  if exists (select 1 from public.students s where s.login_id = v_login) then
    raise exception '這個帳號已經有人用了';
  end if;
  if exists (select 1 from public.students s
              where s.class_code = v_code and s.nickname = v_nick) then
    raise exception '這一班已經有人叫這個暱稱了';
  end if;

  insert into public.students (login_id, pw_hash, nickname, class_code)
  values (v_login, extensions.crypt(lower(p_password), extensions.gen_salt('bf')), v_nick, v_code)
  returning id into v_id;
  insert into public.characters (student_id) values (v_id) on conflict do nothing;
  return v_id;
end;
$$;

-- 老師移除學生。連同答題紀錄一起刪，刪掉就沒了。
create or replace function public.teacher_remove_student(p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  select s.class_code into v_code from public.students s where s.id = p_student;
  if v_code is null then return; end if;
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  delete from public.students where id = p_student;
end;
$$;

-- 老師重設某個學生的密碼（傳 null 就是拿掉密碼）
-- 學生忘記密碼。老師重設自己班的，管理員重設任何人的。
-- 順便解鎖，因為忘記密碼的小朋友通常已經試到被鎖住了。
create or replace function public.teacher_reset_student_password(p_student uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_code text; v_login text; v_bad text;
begin
  select s.class_code, s.login_id into v_code, v_login
    from public.students s where s.id = p_student;
  if v_login is null then raise exception '找不到這個學生'; end if;
  -- 沒有班級的學生（朋友的小孩）只有管理員管得到
  if not (public.is_admin() or (v_code is not null and public.is_teacher_of(v_code))) then
    raise exception '這不是你的班';
  end if;
  v_bad := public.password_problem(p_password, v_login);
  if v_bad is not null then raise exception '%', v_bad; end if;

  update public.students
     set pw_hash = extensions.crypt(lower(p_password), extensions.gen_salt('bf')),
         failed_attempts = 0, locked_until = null
   where id = p_student;
end;
$$;

-- 老師開關「可不可以加入」。班級代碼就是邀請碼，上課時打開讓全班註冊，
-- 註冊完關起來，代碼之後流出去也沒用。
create or replace function public.class_set_open(p_code text, p_open boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(p_code));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  update public.classes set open = coalesce(p_open, true) where code = v_code;
  return coalesce(p_open, true);
end;
$$;

-- 代碼流出去了就換一組。學生的 class_code 是 on update cascade，所以班上的人
-- 會自動跟著新代碼走，不會被踢出去。
create or replace function public.class_regenerate_code(p_code text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(p_code)); v_new text;
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  loop
    -- 拿掉容易看錯的 0/O 與 1/I，老師要在黑板上寫、小朋友要照著打
    v_new := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                                       (random() * 31)::int + 1, 1), '')
                from generate_series(1, 6));
    exit when not exists (select 1 from public.classes c where c.code = v_new);
  end loop;
  update public.classes set code = v_new where code = v_code;
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 管理員
-- -----------------------------------------------------------------------------

-- 第一個管理員怎麼來。還沒有任何管理員的時候，第一個用 email 帳號呼叫的人
-- 就是管理員；有了之後這支就永遠拒絕，所以不會變成後門。
create or replace function public.claim_first_admin()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_real_account() then
    raise exception '要先在上面建好老師帳號並登入，才按得了這個';
  end if;
  if exists (select 1 from public.teachers t where t.is_admin) then
    raise exception '這個系統已經有管理員了';
  end if;
  insert into public.teachers (user_id, display_name, is_admin)
  values (auth.uid(), '管理員', true)
  on conflict (user_id) do update set is_admin = true, active = true;
end;
$$;

-- 管理員指定某個 email 可以成為老師。對方自己註冊、自己設密碼，
-- 管理員不用經手別人的密碼，老師也不用等人核准。
create or replace function public.admin_invite_teacher(p_email text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_admin() then raise exception '只有管理員可以做這件事'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email 格式不對';
  end if;
  insert into public.teacher_invites (email, invited_by) values (v_email, auth.uid())
    on conflict (email) do update set invited_by = auth.uid(), used_at = null;
  return v_email;
end;
$$;

-- 老師用 email 註冊完之後呼叫這支，名單上有他的 email 才會變成老師。
create or replace function public.claim_teacher(p_display_name text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if not public.is_real_account() then raise exception '老師要用 email 登入'; end if;
  if exists (select 1 from public.teachers t where t.user_id = auth.uid()) then
    return v_email;
  end if;
  -- 全新的一套系統完全空的時候，第一個用 email 登入的人直接成為管理員。
  -- 沒有這一段就是死結：老師要有人邀請，邀請的人必須是管理員，
  -- 而管理員本身也得先是老師，於是誰都進不來。
  --
  -- 條件故意加上「邀請名單也是空的」：名單上只要有一個人，這道後門就關了，
  -- 否則在還沒有人註冊之前，任何知道網址的人都能搶先變成管理員。
  if not exists (select 1 from public.teachers)
     and not exists (select 1 from public.teacher_invites) then
    insert into public.teachers (user_id, display_name, is_admin)
    values (auth.uid(), coalesce(nullif(btrim(p_display_name), ''), '管理員'), true);
    return v_email;
  end if;
  if not exists (select 1 from public.teacher_invites i where i.email = v_email) then
    raise exception '這個 email 不在老師名單裡，請先請管理員把你加進去';
  end if;

  insert into public.teachers (user_id, display_name)
  values (auth.uid(), coalesce(nullif(btrim(p_display_name), ''), '老師'));
  update public.teacher_invites set used_at = now() where email = v_email;
  return v_email;
end;
$$;

-- 停用或恢復一位老師。停用的老師登入得了，但開不了班也看不到班級資料。
create or replace function public.admin_set_teacher_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception '只有管理員可以做這件事'; end if;
  if p_user = auth.uid() then raise exception '不能停用自己'; end if;
  update public.teachers set active = coalesce(p_active, true) where user_id = p_user;
end;
$$;

-- 管理員看到的老師名單：每位老師、開了幾班、班上共幾個學生。
create or replace function public.admin_list_teachers()
returns table (user_id uuid, display_name text, is_admin boolean, active boolean,
               classes bigint, students bigint, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.user_id, t.display_name, t.is_admin, t.active,
         (select count(*) from public.classes c where c.owner = t.user_id),
         (select count(*) from public.students s
            join public.classes c on c.code = s.class_code where c.owner = t.user_id),
         t.created_at
    from public.teachers t
   where public.is_admin()
   order by t.is_admin desc, t.created_at;
$$;

-- 管理員加一位老師：帳號直接開好（不寄確認信），已經有帳號的就直接設成老師。
--
-- 為什麼不是讓老師自己註冊：Supabase 註冊會寄一封確認信，而這個專案的寄信
-- 額度是**一小時兩封**，也沒有接外部寄信服務。幾位老師同一個下午一起註冊
-- 就會有人卡在收不到信，而且卡住的人完全不知道自己在等什麼。
--
-- 所以這裡直接把 auth.users 那一列寫好，email_confirmed_at 先填上，
-- 對方拿到帳號密碼就能登入。email 在這套系統裡只是登入用的名字，
-- 老師的權限本來就是靠管理員給的，不是靠驗 email 驗出來的。
--
-- **手寫 auth.users 有一個坑**：GoTrue 會把 confirmation_token 這一類欄位讀進
-- 不可為空的字串，欄位是 NULL 的話登入直接回 500 Database error querying schema。
-- 所以下面每一個 token 欄位都要填空字串，不能留 NULL。
-- 另外 confirmed_at 是自動算出來的欄位，不能寫。
create or replace function public.admin_create_teacher(
  p_email text, p_password text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_uid   uuid := gen_random_uuid();
  v_have  uuid;
begin
  if not public.is_admin() then raise exception '只有管理員可以做這件事'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email 格式不對';
  end if;
  -- 老師的密碼要求比學生高：學生是全班一起註冊、六位好記為主，
  -- 老師手上是整個班的資料。
  if length(coalesce(p_password, '')) < 8 then
    raise exception '老師的密碼至少要 8 個字';
  end if;

  -- 這個 email 已經自己註冊過了（名單上沒有他，所以卡在「還不是老師」）。
  -- 這種人很常見，就是照著畫面註冊完卻進不去的那些。這時不要再開一個帳號，
  -- 直接把他設成老師就好，密碼還是他自己的那組，我們不去動別人的密碼。
  select u.id into v_have from auth.users u
   where lower(u.email) = v_email and coalesce(u.is_anonymous, false) = false;
  if v_have is not null then
    if exists (select 1 from public.teachers t where t.user_id = v_have) then
      update public.teachers set active = true,
             display_name = coalesce(v_name, display_name)
       where user_id = v_have;
      return jsonb_build_object('email', v_email, 'created', false, 'existing', true);
    end if;
    insert into public.teachers (user_id, display_name) values (v_have, coalesce(v_name, '老師'));
    insert into public.teacher_invites (email, invited_by, used_at)
    values (v_email, auth.uid(), now()) on conflict (email) do update set used_at = now();
    return jsonb_build_object('email', v_email, 'created', false, 'existing', true);
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', coalesce(v_name, '老師')), now(), now(),
    '', '', '', '', '', '', '', '',
    false, false
  );

  -- 沒有這一列的話帳號建起來了卻登入不了：GoTrue 是照 identities 找帳號的。
  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid::text, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email',
    null, now(), now()
  );

  insert into public.teachers (user_id, display_name) values (v_uid, coalesce(v_name, '老師'));
  -- 名單是「誰可以自己註冊」用的，這條路沒走名單，但把它補上去，
  -- 免得同一個 email 之後又被加進名單變成兩套說法。
  insert into public.teacher_invites (email, invited_by, used_at)
  values (v_email, auth.uid(), now())
  on conflict (email) do update set used_at = now();
  return jsonb_build_object('email', v_email, 'created', true, 'existing', false);
end;
$fn$;

-- 管理員看到的全部班級：哪一班、誰在帶、班上幾個人。
-- 老師只看得到自己的班（listClasses），管理員要看得到整間學校的，
-- 不然「誰在帶哪一班」只有問人才知道。
create or replace function public.admin_list_classes()
returns table (code text, name text, open boolean,
               owner uuid, owner_name text, owner_active boolean, students bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.code, c.name, c.open, c.owner, t.display_name, t.active,
         (select count(*) from public.students s where s.class_code = c.code)
    from public.classes c
    left join public.teachers t on t.user_id = c.owner
   where public.is_admin()
   order by c.created_at;
$$;

-- 管理員把一個班交給另一位老師。
--
-- 一個班目前就是一位老師（classes.owner），所以「換老師」是換這一欄。
-- 班級代碼、學生、進度全部不動——學生是掛在班級代碼上的，不是掛在老師身上，
-- 所以換人帶不會有人掉出去。之後要做一班多位老師的話，
-- 這一欄的意思會變成「班主」（能改名字、換代碼、刪班的那個人）。
create or replace function public.admin_set_class_owner(p_code text, p_owner uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_admin() then raise exception '只有管理員可以做這件事'; end if;
  if not exists (select 1 from public.classes c where c.code = v_code) then
    raise exception '找不到這個班級';
  end if;
  -- 交給一個被停用的老師等於這個班沒人帶，畫面上還會看起來正常，所以擋掉。
  if not exists (select 1 from public.teachers t where t.user_id = p_owner and t.active) then
    raise exception '這個人不是啟用中的老師';
  end if;
  update public.classes set owner = p_owner where code = v_code;
end;
$$;

-- 這套系統有沒有管理員。用來決定要不要在老師後台顯示「認領管理員」。
-- 誰都問得到（答案只有有或沒有），不問就沒人知道自己卡在哪。
create or replace function public.has_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.teachers t where t.is_admin);
$$;

-- 管理員看到的老師邀請名單（還沒註冊的也看得到）。
create or replace function public.admin_list_invites()
returns table (email text, used_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.email, i.used_at, i.created_at
    from public.teacher_invites i
   where public.is_admin()
   order by i.created_at desc;
$$;

-- 「全班最常錯的字」。這是整個系統對老師最有價值的東西。
create or replace function public.class_most_missed(p_code text, p_limit int default 20)
returns table (word_id int, word text, zh text, skill text,
               seen bigint, wrong bigint, wrong_rate numeric, students bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.word, w.zh, ws.skill,
         sum(ws.seen)  as seen,
         sum(ws.wrong) as wrong,
         round(sum(ws.wrong)::numeric / nullif(sum(ws.seen), 0), 2) as wrong_rate,
         count(*)      as students
    from public.word_stats ws
    join public.students s on s.id = ws.student_id
    join public.words   w  on w.id = ws.word_id
   where s.class_code = upper(btrim(p_code))
     and public.is_teacher_of(upper(btrim(p_code)))
     and ws.wrong > 0
   group by w.id, w.word, w.zh, ws.skill
   order by sum(ws.wrong) desc, wrong_rate desc
   limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

-- 全班進度一覽
create or replace function public.class_overview(p_code text)
returns table (student_id uuid, nickname text, coins int, exp int,
               stars bigint, cleared bigint, answered bigint,
               accuracy numeric, last_played timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.nickname, c.coins, c.exp,
         coalesce(sum(lp.stars), 0)                                  as stars,
         count(lp.cleared_at)                                        as cleared,
         coalesce((select count(*) from public.answer_events ae
                    where ae.student_id = s.id), 0)                  as answered,
         coalesce((select round(avg(case when ae.correct then 1 else 0 end), 2)
                     from public.answer_events ae
                    where ae.student_id = s.id), 0)                  as accuracy,
         (select max(ae.at) from public.answer_events ae
           where ae.student_id = s.id)                               as last_played
    from public.students s
    join public.characters c on c.student_id = s.id
    left join public.level_progress lp on lp.student_id = s.id
   where s.class_code = upper(btrim(p_code))
     and public.is_teacher_of(upper(btrim(p_code)))
   group by s.id, s.nickname, c.coins, c.exp
   order by s.nickname;
$$;

-- =============================================================================
-- 房間：揪人一起打同一關
--
-- **不用輸入房間代碼。** 班級代碼已經是他的身分的一部分，再叫小朋友抄一組
-- 四位數字只會多一批「我打不進去」的手。所以規則是：房間掛在班級上，
-- 同班的人在選關畫面就看得到現在開著哪幾場，按一下就進去。
--
-- **老師和學生都開得了。** 上課是老師開場全班一起，下課和回家是誰想打誰開——
-- 同一套機制。老師開的那場會排在最前面並標示出來。
--
-- 房間只管「誰在、什麼時候一起開始」。分數不存在這裡——分數一律從答題事件算，
-- room_members 只記下那個人這一場的 session_id，剩下的用它去查（見 save_progress）。
-- =============================================================================

create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  class_code text not null references public.classes(code)
             on delete cascade on update cascade,
  level_id   text not null references public.levels(id),
  -- solo＝各打各的只是同時開始；versus／team 是之後的事，欄位先留著。
  mode       text not null default 'solo' check (mode in ('solo', 'versus', 'team')),
  status     text not null default 'lobby' check (status in ('lobby', 'playing', 'done')),
  opened_by  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at   timestamptz
);
-- 開這一場的學生。null＝老師開的。
-- 學生的 auth 帳號是「這台裝置」不是「這個人」（見 supabase.ts 的說明），
-- 所以 opened_by 拿來判斷「這是不是我開的」是不準的，要另外記學生 id。
alter table public.rooms add column if not exists host_student uuid
  references public.students(id) on delete cascade;
-- 以前限制「一班同時只有一場」，因為學生端要不問代碼就找得到房間。
-- 開放學生自己開之後這條就不成立了，改成選關畫面列出現在開著的幾場。
drop index if exists rooms_one_live_per_class;
create index if not exists rooms_class on public.rooms(class_code, created_at desc);
create index if not exists rooms_host on public.rooms(host_student) where host_student is not null;

create table if not exists public.room_members (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- 團隊模式才會填
  team       text,
  -- 他這一場的 Session.id。之後要算即時分數就是拿它去 answer_events 加總。
  session_id uuid,
  joined_at   timestamptz not null default now(),
  -- 心跳。學生每幾秒問一次房間狀態，順手更新這一格，
  -- 關掉分頁的人就會停在那裡，別人看得出來他不在了。
  seen_at     timestamptz not null default now(),
  finished_at timestamptz,
  primary key (room_id, student_id)
);
create index if not exists room_members_student on public.room_members(student_id);

-- ---- 魔王團戰（2026-09-25）：房間改成打魔王，舊的「一起打同一關」拿掉 --------------
-- 見下面「魔王團戰」那一段的說明。欄位放在這裡是因為下面房間的函式就會用到。
alter table public.rooms alter column level_id drop not null;
alter table public.rooms drop constraint if exists rooms_mode_check;
alter table public.rooms add constraint rooms_mode_check
  check (mode in ('solo', 'versus', 'team', 'raid'));
-- 打哪一隻魔王（src/data/bosses.ts 的 id）
alter table public.rooms add column if not exists boss_id text;
-- 私人房的四位數密碼。null＝公開房。
-- 為什麼要有：有的小朋友會故意跑進別人的房間搗亂，那一團就一直開不成（Chuck 2026-09-25）。
alter table public.rooms add column if not exists pass text;
alter table public.rooms drop constraint if exists rooms_pass_ck;
alter table public.rooms add constraint rooms_pass_ck check (pass is null or pass ~ '^[0-9]{4}$');
-- 開打那一刻定的亂數種子。每支手機拿同一個，戰場才會一樣（斷線接手的電腦要用）。
alter table public.rooms add column if not exists seed int;
-- 這一場不出聽音題（照班級的 live_listen，開房那一刻定下來）
alter table public.rooms add column if not exists no_listen boolean not null default true;
-- 打倒魔王確認了沒（null＝還沒確認，見 raid_result）
alter table public.rooms add column if not exists raid_won boolean;
-- 每分鐘大概答對幾題，開打時照這個算魔王的血
alter table public.room_members add column if not exists rate numeric not null default 14;

-- 被房主請出去的人，這一場不能再進來
create table if not exists public.room_bans (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (room_id, student_id)
);
alter table public.room_bans enable row level security;

-- 開打時排好的座位。座位號＝戰場上第幾座城，也是 lockstep 套用動作的順序。
-- 跟 live_matches 一樣，伺服器只是信箱：每個人放自己的動作串、拿別人的。
create table if not exists public.raid_seats (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  seat       int  not null,
  student_id uuid not null references public.students(id) on delete cascade,
  rate       numeric not null default 14,
  -- 動作串：[格,'a',對錯,目標] / [格,'s',線,階] / [格,'u']
  moves      jsonb not null default '[]'::jsonb,
  -- 「第幾格以前的動作都送了」
  mark       int not null default -1,
  -- 被判斷線（或按了離開）那一刻凍住的 mark。之後大家在第 final+DELAY+1 格讓電腦接手。
  final      int,
  seen_at    timestamptz not null default now(),
  -- 打完回報的結果（raid_result）
  won        boolean,
  dealt      int,
  correct    int,
  session_id uuid,
  primary key (room_id, seat),
  unique (room_id, student_id)
);
create index if not exists raid_seats_student on public.raid_seats(student_id);
alter table public.raid_seats enable row level security;

-- 每個人打倒過哪幾隻魔王、幾次。個人檔案顯示，「屠龍者」成就也從這裡數。
create table if not exists public.raid_kills (
  student_id uuid not null references public.students(id) on delete cascade,
  boss_id    text not null,
  kills      int  not null default 0,
  first_at   timestamptz not null default now(),
  -- 第一次打倒的那一場（結算畫面靠它判斷「這一場是不是第一次」）
  first_room uuid,
  primary key (student_id, boss_id)
);
alter table public.raid_kills enable row level security;

alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;
grant select on public.rooms, public.room_members to authenticated;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated
  using (class_code = public.current_class_code() or public.is_teacher_of(class_code));

drop policy if exists room_members_read on public.room_members;
create policy room_members_read on public.room_members for select to authenticated
  using (exists (
    select 1 from public.rooms r
     where r.id = room_id
       and (r.class_code = public.current_class_code() or public.is_teacher_of(r.class_code))
  ));

-- 這兩支換過簽章：room_state 從「班級代碼」改成「房間 id」，join_room 多了一個
-- 參數。舊的留著會跟新的同時存在，PostgREST 挑不出該呼叫哪一支（參數都給 null
-- 的時候尤其明顯），所以一定要先砍掉。
drop function if exists public.room_state(text);
drop function if exists public.join_room();
drop function if exists public.join_room(uuid);

-- -----------------------------------------------------------------------------
-- 小幫手
-- -----------------------------------------------------------------------------

-- 這一場是不是我作主的（老師看自己班的每一場，學生只看自己開的那場）。
create or replace function public.room_is_mine(p_room uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.rooms r
     where r.id = p_room
       and (public.is_teacher_of(r.class_code)
            or (r.host_student is not null and r.host_student = public.current_student_id()))
  );
$$;

-- 沒人在的場自己收掉。小朋友開了一場就把分頁關掉是常態，
-- 不收的話班上很快就掛著一排沒人的房間，真的那場反而找不到。
-- 老師開的不收——老師可能上課前就先開好放著。
create or replace function public.room_sweep(p_code text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.rooms r set status = 'done', ended_at = now()
   where r.class_code = p_code and r.status <> 'done' and r.host_student is not null
     and coalesce((select max(m.seen_at) from public.room_members m where m.room_id = r.id),
                  r.created_at) < now() - interval '5 minutes';
  -- 魔王團戰一場三分鐘，開打十分鐘還沒收（大家都關掉分頁沒回報）就收掉，老師開的也一樣
  update public.rooms r set status = 'done', ended_at = now()
   where r.class_code = p_code and r.status = 'playing' and r.mode = 'raid'
     and r.started_at < now() - interval '10 minutes';
$$;

-- -----------------------------------------------------------------------------
-- 開一場
-- -----------------------------------------------------------------------------

create or replace function public.open_room(
  p_class_code text, p_level_id text, p_mode text default 'solo')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(p_class_code));
        v_mode text := lower(btrim(coalesce(p_mode, 'solo')));
        v_id   uuid;
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  if not exists (select 1 from public.levels l where l.id = p_level_id) then
    raise exception '沒有這一關';
  end if;
  if v_mode not in ('solo', 'versus', 'team') then raise exception '沒有這種模式'; end if;

  -- 老師再按一次「開一場」就是換一關重開，收掉的只有老師自己那場，
  -- 不要把小朋友自己開的也一起收了。
  update public.rooms set status = 'done', ended_at = now()
   where class_code = v_code and status <> 'done' and host_student is null;

  insert into public.rooms (class_code, level_id, mode, opened_by)
       values (v_code, p_level_id, v_mode, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

-- 學生自己開一場。開完直接算他已經進來了——開了一場卻要再按一次加入很怪。
create or replace function public.student_open_room(p_level_id text, p_mode text default 'solo')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
        v_code    text := public.current_class_code();
        v_mode    text := lower(btrim(coalesce(p_mode, 'solo')));
        v_id      uuid;
begin
  if v_student is null then raise exception '請先登入'; end if;
  if v_code is null then raise exception '還沒加入班級，沒辦法揪人'; end if;
  if not exists (select 1 from public.levels l where l.id = p_level_id) then
    raise exception '沒有這一關';
  end if;
  if v_mode not in ('solo', 'versus', 'team') then raise exception '沒有這種模式'; end if;

  perform public.room_sweep(v_code);

  -- 一個人同時只能開一場。不擋的話小朋友會連按十次，班上就掛著十個空房間。
  update public.rooms set status = 'done', ended_at = now()
   where host_student = v_student and status <> 'done';

  -- 一個班同時最多這麼多場。上限不是怕資料庫撐不住，是怕清單長到找不到老師那場。
  if (select count(*) from public.rooms r
       where r.class_code = v_code and r.status <> 'done') >= 12 then
    raise exception '班上開著的場次太多了，等別人打完再開';
  end if;

  insert into public.rooms (class_code, level_id, mode, opened_by, host_student)
       values (v_code, p_level_id, v_mode, auth.uid(), v_student)
    returning id into v_id;

  insert into public.room_members (room_id, student_id) values (v_id, v_student);
  return v_id;
end;
$$;

create or replace function public.start_room(p_room uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms;
        v_n    int;
begin
  if not public.room_is_mine(p_room) then raise exception '這一場不是你開的'; end if;
  select * into v_room from public.rooms where id = p_room for update;
  if v_room.status <> 'lobby' then return; end if;

  if v_room.mode = 'raid' then
    -- 座位＝現在人在的（三十秒內有回報），照進來的順序，最多六個。
    -- 不在的人留在名單上但沒有座位，他回來會看到「已經開打了」。
    insert into public.raid_seats (room_id, seat, student_id, rate, seen_at)
    select p_room, (row_number() over (order by m.joined_at, m.student_id))::int - 1,
           m.student_id, m.rate,
           -- 開打後手機要載圖、演魔王登場，多給十秒才開始算「沒消息」
           now() + interval '10 seconds'
      from public.room_members m
     where m.room_id = p_room and m.seen_at > now() - interval '30 seconds'
     order by m.joined_at, m.student_id
     limit 6;
    get diagnostics v_n = row_count;
    if v_n < 2 then
      delete from public.raid_seats where room_id = p_room;
      raise exception '至少要兩個人才能開打';
    end if;
    update public.rooms
       set status = 'playing', started_at = now(),
           seed = 1 + floor(random() * 2000000000)::int
     where id = p_room;
    return;
  end if;

  update public.rooms set status = 'playing', started_at = now()
   where id = p_room and status = 'lobby';
end;
$$;

create or replace function public.close_room(p_room uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.room_is_mine(p_room) then raise exception '這一場不是你開的'; end if;
  update public.rooms set status = 'done', ended_at = now() where id = p_room;
end;
$$;

-- -----------------------------------------------------------------------------
-- 學生：加入、離開、回報
-- -----------------------------------------------------------------------------

-- 加入班上的某一場。
-- 不指定哪一場就進老師那場（沒有的話進最新的一場）。
--
-- 魔王團戰（2026-09-25）多了幾道門，**已經在名單上的人不受影響**（網路斷了重進）：
--   - 開打之後不能進（戰場已經照開打那一刻的人數算好了）
--   - 被房主請出去的，這一場不能再進
--   - 私人房要對密碼（四位數字）
--   - 最多六個人
-- p_rate 是他每分鐘大概答對幾題（前端從自己的作答速度算的），開打時拿來算魔王的血。
-- 報假的只會讓自己那一隊的魔王變硬或變軟，拿不到任何東西，所以信前端沒關係。
create or replace function public.join_room(
  p_room uuid default null, p_pass text default null, p_rate numeric default 14)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
        v_code    text := public.current_class_code();
        v_room    public.rooms;
        v_rate    numeric := least(greatest(coalesce(p_rate, 14), 6), 32);
begin
  if v_student is null then raise exception '請先登入'; end if;
  if v_code is null then raise exception '還沒加入班級'; end if;

  if p_room is not null then
    select * into v_room from public.rooms r
     where r.id = p_room and r.class_code = v_code and r.status <> 'done'
     for update;
  else
    select * into v_room from public.rooms r
     where r.class_code = v_code and r.status <> 'done'
     order by (r.host_student is null) desc, r.created_at desc limit 1
     for update;
  end if;
  if v_room.id is null then raise exception '這一場已經結束了'; end if;

  if v_room.mode = 'raid' and not exists (
       select 1 from public.room_members m where m.room_id = v_room.id and m.student_id = v_student) then
    if v_room.status <> 'lobby' then raise exception '這一場已經開打了，等下一場'; end if;
    if exists (select 1 from public.room_bans b where b.room_id = v_room.id and b.student_id = v_student) then
      raise exception '房主請你離開了這一場，換一場吧';
    end if;
    if v_room.pass is not null and coalesce(btrim(p_pass), '') <> v_room.pass then
      raise exception '密碼不對';
    end if;
    if (select count(*) from public.room_members m where m.room_id = v_room.id) >= 6 then
      raise exception '這一場滿了（最多六個人）';
    end if;
  end if;

  -- 同時只在一場裡。不退掉舊的話，他會同時出現在兩份名單上，
  -- 開場的人會一直等一個其實在別場的人。
  delete from public.room_members m
   where m.student_id = v_student and m.room_id <> v_room.id
     and exists (select 1 from public.rooms r where r.id = m.room_id and r.status = 'lobby');

  insert into public.room_members as m (room_id, student_id, rate)
       values (v_room.id, v_student, v_rate)
    on conflict (room_id, student_id) do update set seen_at = now(), rate = excluded.rate;
  return v_room.id;
end;
$$;

-- 離開。開場的人走了，把主人交給下一個還在的人；一個人都不剩才收掉。
-- 直接收掉會把留下來的人一起踢出去，而開場的人中途離開是很常見的事。
create or replace function public.leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
begin
  delete from public.room_members
   where room_id = p_room and student_id = v_student;

  -- 開場的人走了，而且一個人都沒有了：收掉。
  update public.rooms r set status = 'done', ended_at = now()
   where r.id = p_room and r.host_student = v_student and r.status <> 'done'
     and not exists (select 1 from public.room_members m where m.room_id = r.id);

  -- 還有人：主人換成最早進來的那個，按開始、收場的權限跟著走。
  update public.rooms r
     set host_student = (select m.student_id from public.room_members m
                          where m.room_id = r.id order by m.joined_at, m.student_id limit 1)
   where r.id = p_room and r.host_student = v_student and r.status <> 'done';
end;
$$;

-- 我開打了，這是我這一場的 session。伺服器之後靠它把這個人的答題事件
-- 跟這一場房間對起來。
create or replace function public.room_playing(p_room uuid, p_session uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.room_members
     set session_id = p_session, finished_at = null, seen_at = now()
   where room_id = p_room and student_id = public.current_student_id();
end;
$$;

create or replace function public.room_finished(p_room uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.room_members
     set finished_at = now(), seen_at = now()
   where room_id = p_room and student_id = public.current_student_id();
end;
$$;

-- -----------------------------------------------------------------------------
-- 讀狀態
-- -----------------------------------------------------------------------------

-- 班上現在開著哪幾場。選關畫面與「一起玩」那一頁都是問這一支。
-- 老師開的排最前面，其餘新的在前。
create or replace function public.room_list(p_class_code text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code    text := coalesce(upper(btrim(p_class_code)), public.current_class_code());
        v_student uuid := public.current_student_id();
begin
  if v_code is null then return '[]'::jsonb; end if;
  if not (v_code = public.current_class_code() or public.is_teacher_of(v_code)) then
    raise exception '看不到這一班';
  end if;
  perform public.room_sweep(v_code);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',       r.id,
             'levelId',  r.level_id,
             'bossId',   r.boss_id,
             -- 私人房。密碼本身只有房主和老師看得到（見 room_state）
             'locked',   r.pass is not null,
             'members',  (select count(*) from public.room_members m where m.room_id = r.id),
             'mode',     r.mode,
             'status',   r.status,
             'hostName', coalesce(hs.nickname, ''),
             -- 老師開的那場學生要一眼認得出來，不然會跑去跟同學那場
             'byTeacher', r.host_student is null,
             'mine',     exists (select 1 from public.room_members m
                                  where m.room_id = r.id and m.student_id = v_student),
             'here',     (select count(*) from public.room_members m
                           where m.room_id = r.id
                             and m.seen_at > now() - interval '30 seconds'))
           order by (r.host_student is null) desc, r.created_at desc)
      from public.rooms r
      left join public.students hs on hs.id = r.host_student
     -- 2026-09-25 起房間只剩魔王團戰（舊的「一起打同一關」拿掉了）
     where r.class_code = v_code and r.status <> 'done' and r.mode = 'raid'), '[]'::jsonb);
end;
$$;

-- 某一場現在長什麼樣。等待室與老師的面板都是問這一支，每幾秒一次。
-- 一次把房間跟名單都給出來，因為輪詢的次數會是全班人數乘以每分鐘二十次，
-- 拆成兩支就是白白多一倍。
create or replace function public.room_state(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
        v_room    public.rooms;
begin
  select * into v_room from public.rooms r
   where r.id = p_room and r.status <> 'done'
     and (r.class_code = public.current_class_code() or public.is_teacher_of(r.class_code));
  if v_room.id is null then return 'null'::jsonb; end if;

  -- 順便報到（見 room_members.seen_at）。
  if v_student is not null then
    update public.room_members
       set seen_at = now()
     where room_id = v_room.id and student_id = v_student;
  end if;

  return jsonb_build_object(
    'id',        v_room.id,
    'classCode', v_room.class_code,
    'levelId',   v_room.level_id,
    'bossId',    v_room.boss_id,
    'locked',    v_room.pass is not null,
    -- 密碼只給房主和老師，讓他告訴要找的人
    'pass',      case when public.room_is_mine(v_room.id) then v_room.pass end,
    'seed',      v_room.seed,
    'noListen',  v_room.no_listen,
    'mode',      v_room.mode,
    'status',    v_room.status,
    -- 開打之後的座位（魔王團戰）。第幾號座位就是戰場上第幾座城。
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat',      rs.seat,
               'studentId', rs.student_id,
               'nickname',  s.nickname,
               'rate',      rs.rate,
               'avatar',    coalesce(c.avatar, ''),
               'equipped',  coalesce(c.equipped, '[]'::jsonb),
               'me',        rs.student_id = v_student)
             order by rs.seat)
        from public.raid_seats rs
        join public.students s on s.id = rs.student_id
        left join public.characters c on c.student_id = rs.student_id
       where rs.room_id = v_room.id), '[]'::jsonb),
    'startedAt', v_room.started_at,
    'byTeacher', v_room.host_student is null,
    'mine',      public.room_is_mine(v_room.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'studentId', m.student_id,
               'nickname',  s.nickname,
               'team',      m.team,
               'avatar',    coalesce(c.avatar, ''),
               'equipped',  coalesce(c.equipped, '[]'::jsonb),
               'host',      m.student_id = v_room.host_student,
               'finished',  m.finished_at is not null,
               'rate',      m.rate,
               -- 三十秒沒回報就當作人不在了。輪詢是每幾秒一次，
               -- 抓太短會讓網路頓一下的人一直閃掉。
               'here',      m.seen_at > now() - interval '30 seconds',
               'me',        m.student_id = v_student)
             order by m.joined_at)
        from public.room_members m
        join public.students s on s.id = m.student_id
        left join public.characters c on c.student_id = m.student_id
       where m.room_id = v_room.id), '[]'::jsonb));
end;
$$;


-- =============================================================================
-- 維修用：掌握度算錯了就從事件重算一次。事件是真相，這張表只是快取。
-- =============================================================================
create or replace function public.rebuild_word_stats(p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.owns_student(p_student) then raise exception '沒有權限'; end if;
  delete from public.word_stats where student_id = p_student;
  insert into public.word_stats (student_id, word_id, skill, seen, correct, wrong, streak, last_at, avg_ms)
  select ae.student_id, ae.word_id, ae.skill,
         count(*),
         count(*) filter (where ae.correct),
         count(*) filter (where not ae.correct),
         0,
         max(ae.at),
         coalesce(round(avg(ae.ms) filter (where ae.correct))::int, 0)
    from public.answer_events ae
   where ae.student_id = p_student
   group by ae.student_id, ae.word_id, ae.skill;
end;
$$;

-- -----------------------------------------------------------------------------
-- 誰可以叫哪一支
-- -----------------------------------------------------------------------------
revoke all on all functions in schema public from anon, authenticated;

-- 學生（匿名帳號也算 authenticated）
grant execute on function
  public.register_student(text, text, text, text),
  public.login_student(text, text),
  public.student_set_password(text, text),
  public.student_set_nickname(text),
  public.student_join_class(text),
  public.submit_answers(jsonb),
  public.save_progress(text, uuid, boolean, numeric),
  public.stars_of(boolean, int, int, numeric),
  public.set_job(text),
  public.set_avatar(text),
  public.buy_item(text),
  public.equip_item(text, boolean),
  public.consume_item(text, uuid, text),
  public.level_of(int),
  public.class_leaderboard(text),
  public.current_student_id(),
  public.current_class_code(),
  public.rebuild_word_stats(uuid),
  public.join_room(uuid, text, numeric),
  public.leave_room(uuid),
  public.room_playing(uuid, uuid),
  public.room_finished(uuid),
  public.student_open_room(text, text),
  -- 老師也是叫這兩支看自己班上的場次，函式裡面自己分辨誰在問。
  public.room_list(text),
  public.room_state(uuid),
  public.room_is_mine(uuid),
  public.room_sweep(text)
to authenticated;

-- 老師。函式裡面自己會檢查「這是不是你的班」，所以給 authenticated 沒關係。
grant execute on function
  public.create_class(text, text),
  public.claim_teacher(text),
  public.teacher_set_open(text, text[]),
  public.teacher_add_student(text, text, text, text),
  public.teacher_remove_student(uuid),
  public.teacher_reset_student_password(uuid, text),
  public.class_set_open(text, boolean),
  public.class_regenerate_code(text),
  public.class_most_missed(text, int),
  public.class_overview(text),
  public.is_teacher_of(text),
  public.open_room(text, text, text),
  public.start_room(uuid),
  public.close_room(uuid)
to authenticated;

-- 管理員。同樣靠函式內部的 is_admin() 把關。
grant execute on function
  public.claim_first_admin(),
  public.admin_invite_teacher(text),
  public.admin_set_teacher_active(uuid, boolean),
  public.admin_list_teachers(),
  public.admin_list_invites(),
  public.admin_create_teacher(text, text, text),
  public.admin_list_classes(),
  public.admin_set_class_owner(text, uuid),
  public.has_admin(),
  public.is_admin()
to authenticated;

-- =============================================================================
-- 成就
--
-- **解鎖條件的唯一真相在這裡**（refresh_achievements()）。前端那份
-- src/data/achievements.ts 只有名字、說明和圖，它說誰拿到了是不算數的——
-- 徽章會出現在別人看得到的個人檔案上，看得到就值得作弊。
--
-- 做法跟星星一樣：**每次都從頭重算**，不是「答對時順手加一」。
--   * 規則改了、資料補了，下一次重算自己就對了，不用寫搬家 SQL。
--   * 少算一次不會永久漏掉（下一次打完、下一次開檔案都會再算一遍）。
--   * 四十二個條件都是小查詢，一次重算對一個學生來說很便宜。
-- 已經拿到的**永遠不會被收回**（只 insert 不 delete），不然「差一點」這種
-- 安慰獎會在他終於通關那天消失，那比沒給還傷。
-- =============================================================================

alter table public.achievements         enable row level security;
alter table public.student_achievements enable row level security;
alter table public.versus_matches       enable row level security;
alter table public.item_uses            enable row level security;
alter table public.achievement_progress enable row level security;

grant select on public.achievements to anon, authenticated;
grant select on public.student_achievements, public.versus_matches, public.item_uses,
  public.achievement_progress to authenticated;

-- 目錄人人可讀（畫面要畫出「還沒拿到的那些」）。
drop policy if exists achievements_read on public.achievements;
create policy achievements_read on public.achievements for select to anon, authenticated using (true);

-- 自己的徽章自己讀得到。**別人的徽章走 public_profile() 那支**，
-- 因為「可不可以看」牽涉到對方有沒有把檔案關起來，那是函式在管的事。
drop policy if exists student_achievements_read on public.student_achievements;
create policy student_achievements_read on public.student_achievements for select to authenticated
  using (student_id = public.current_student_id() or public.owns_student(student_id));

drop policy if exists versus_matches_read on public.versus_matches;
create policy versus_matches_read on public.versus_matches for select to authenticated
  using (student_id = public.current_student_id() or public.owns_student(student_id));

drop policy if exists achievement_progress_read on public.achievement_progress;
create policy achievement_progress_read on public.achievement_progress for select to authenticated
  using (student_id = public.current_student_id() or public.owns_student(student_id));

drop policy if exists item_uses_read on public.item_uses;
create policy item_uses_read on public.item_uses for select to authenticated
  using (student_id = public.current_student_id() or public.owns_student(student_id));

-- -----------------------------------------------------------------------------
-- 重算成就。每一格都從來源資料算一遍，回傳「這次新解開或升階的」。
--
-- 回傳格式：一次性徽章是 'id'，分階徽章是 'id:階'（'hundred:3'＝萬題升到金）。
-- 條件寫得囉嗦是故意的：一個條件一段，改一條不用讀懂另外四十四條。
-- 時間一律轉 Asia/Taipei 再算「哪一天」——伺服器是 UTC，不轉的話台灣時間
-- 早上八點以前玩的都會被算成前一天，連續天數會莫名其妙斷掉。
-- -----------------------------------------------------------------------------

-- 分階徽章寫進去：記下現在的數字，算到第幾階，比原本高才升。
-- **只給 refresh_achievements() 叫**：它不檢查身分，開放出去等於誰都能幫自己升鑽石。
create or replace function public.ach_put(p_student uuid, p_id text, p_value int, p_all int default 0)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tiers int[];
  v_tier  int;
  v_old   int;
begin
  select a.tiers into v_tiers from public.achievements a where a.id = p_id;
  -- 目錄裡沒有（前端新版、資料庫還沒灌新目錄）或不是分階的，就不寫
  if v_tiers is null or cardinality(v_tiers) = 0 then return null; end if;

  insert into public.achievement_progress (student_id, achievement_id, value, goal_all)
  values (p_student, p_id, coalesce(p_value, 0), coalesce(p_all, 0))
  on conflict (student_id, achievement_id)
    do update set value = excluded.value, goal_all = excluded.goal_all;

  -- 到第幾階＝門檻依序數過去，數到第一個沒達到的為止。「全部」是 0 的時候
  -- （例如題庫還沒灌）那一階不算達到，不然一個字都沒答就是鑽石。
  select coalesce(max(t.i), 0) into v_tier
    from unnest(v_tiers) with ordinality as t(g, i)
   where t.i <= (select coalesce(min(u.i) - 1, cardinality(v_tiers))
                   from unnest(v_tiers) with ordinality as u(g, i)
                  where coalesce(p_value, 0) < case when u.g < 0 then greatest(p_all, 1) else u.g end);
  if v_tier = 0 then return null; end if;

  select sa.tier into v_old from public.student_achievements sa
   where sa.student_id = p_student and sa.achievement_id = p_id;
  if v_old is null then
    insert into public.student_achievements (student_id, achievement_id, tier, tier_at)
    values (p_student, p_id, v_tier, now());
    return p_id || ':' || v_tier;
  elsif v_tier > v_old then
    update public.student_achievements set tier = v_tier, tier_at = now()
     where student_id = p_student and achievement_id = p_id;
    return p_id || ':' || v_tier;
  end if;
  return null;
end;
$$;
revoke all on function public.ach_put(uuid, text, int, int) from public, anon, authenticated;

create or replace function public.refresh_achievements()
returns setof text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.current_student_id();
  v_got     text[] := '{}';
  v_up      text[] := '{}';
  v_n       int;
  v_all     int;
  v_items   jsonb;
  v_jobs    text[];
  v_new     text;
begin
  if v_student is null then return; end if;

  -- 「有效答對」：同一個字、同一個技能、同一天最多算 5 次。
  -- 累積次數的徽章都從這張暫存表數，擋掉狂刷一個簡單的字。
  create temp table if not exists ach_ok (word_id int, skill text, n int) on commit drop;
  truncate ach_ok;
  insert into ach_ok
    select ae.word_id, ae.skill, least(count(*), 5)::int
      from public.answer_events ae
     where ae.student_id = v_student and ae.correct
     group by ae.word_id, ae.skill, (ae.at at time zone 'Asia/Taipei')::date;

  -- ---------------------------------------------------------------- 學習
  if exists (select 1 from ach_ok) then
    v_got := array_append(v_got, 'first-answer');
  end if;

  select coalesce(sum(n), 0) into v_n from ach_ok;
  v_up := array_append(v_up, public.ach_put(v_student, 'hundred', v_n));

  -- 錯過三次以上、現在連對三次＝真的把死對頭練起來了
  select count(distinct ws.word_id) into v_n from public.word_stats ws
   where ws.student_id = v_student and ws.wrong >= 3 and ws.streak >= 3;
  v_up := array_append(v_up, public.ach_put(v_student, 'nemesis', v_n));

  select count(*) into v_n from (
    select w.theme,
           bool_and(exists (select 1 from ach_ok o where o.word_id = w.id)) as done
      from public.words w
     where w.theme <> ''
     group by w.theme) t
   where t.done;
  select count(distinct w.theme) into v_all from public.words w where w.theme <> '';
  v_up := array_append(v_up, public.ach_put(v_student, 'theme-king', v_n, v_all));

  -- 精通：「字 × 技能」練到熟（連對三次）。用掌握度而不是答對次數，
  -- 不然一直刷同一個簡單的字也會過。全部＝每個字可認可聽，要拼的字再加一組。
  select count(*) into v_n from public.word_stats ws
   where ws.student_id = v_student and ws.streak >= 3;
  select 2 * count(*) + count(*) filter (where w.spell) into v_all from public.words w;
  v_up := array_append(v_up, public.ach_put(v_student, 'mastered-50', v_n, v_all));

  select count(distinct word_id) into v_n from ach_ok;
  select count(*) into v_all from public.words;
  v_up := array_append(v_up, public.ach_put(v_student, 'literate', v_n, v_all));

  -- ---------------------------------------------------------------- 技能
  select coalesce(sum(n), 0) into v_n from ach_ok where skill = 'recognize';
  v_up := array_append(v_up, public.ach_put(v_student, 'read-100', v_n));
  select coalesce(sum(n), 0) into v_n from ach_ok where skill = 'listen';
  v_up := array_append(v_up, public.ach_put(v_student, 'listen-100', v_n));
  select coalesce(sum(n), 0) into v_n from ach_ok where skill = 'spell';
  v_up := array_append(v_up, public.ach_put(v_student, 'spell-100', v_n));

  select count(*) into v_n from (
    select 1 from public.answer_events ae
     where ae.student_id = v_student
     group by (ae.at at time zone 'Asia/Taipei')::date
    having count(distinct ae.skill) = 3) t;
  v_up := array_append(v_up, public.ach_put(v_student, 'triple-day', v_n));

  select coalesce(sum(o.n), 0) into v_n
    from ach_ok o join public.words w on w.id = o.word_id
   where o.skill = 'spell' and length(w.word) >= 8;
  v_up := array_append(v_up, public.ach_put(v_student, 'long-words', v_n));

  select min(c) into v_n from (
    select s.k, (select count(*) from public.word_stats ws
                  where ws.student_id = v_student and ws.skill = s.k and ws.streak >= 3) as c
      from (values ('recognize'),('spell'),('listen')) as s(k)) t;
  -- 全部＝最少的那一個技能有幾個字可以練（拼字只有要拼的那些）
  select least(count(*), count(*) filter (where w.spell)) into v_all from public.words w;
  v_up := array_append(v_up, public.ach_put(v_student, 'balanced', coalesce(v_n, 0), v_all));

  select coalesce(max(ae.combo), 0) into v_n from public.answer_events ae
   where ae.student_id = v_student and ae.correct;
  v_up := array_append(v_up, public.ach_put(v_student, 'combo', v_n));

  -- ---------------------------------------------------------------- 守塔
  if exists (select 1 from public.level_progress lp
              where lp.student_id = v_student and lp.cleared_at is not null) then
    v_got := array_append(v_got, 'first-clear');
  end if;

  select count(*) into v_all from public.levels;

  select count(*) into v_n from public.level_progress lp
   where lp.student_id = v_student and lp.stars >= 3;
  v_up := array_append(v_up, public.ach_put(v_student, 'three-star', v_n, v_all));

  select count(*) into v_n from public.level_progress lp
   where lp.student_id = v_student and lp.cleared_at is not null and lp.best_survival >= 1;
  v_up := array_append(v_up, public.ach_put(v_student, 'no-damage', v_n, v_all));

  select coalesce(sum(lp.stars), 0) into v_n from public.level_progress lp
   where lp.student_id = v_student;
  v_up := array_append(v_up, public.ach_put(v_student, 'stars-30', v_n, v_all * 3));

  select count(*) into v_n
    from public.level_progress lp join public.levels l on l.id = lp.level_id
   where lp.student_id = v_student and lp.cleared_at is not null and l.is_boss;
  if v_n > 0 and v_n >= (select count(*) from public.levels where is_boss) then
    v_got := array_append(v_got, 'boss-slayer');
  end if;

  select count(*) into v_n from public.level_progress lp
   where lp.student_id = v_student and lp.cleared_at is not null;
  if v_n >= v_all then v_got := array_append(v_got, 'all-clear'); end if;

  -- ---------------------------------------------------------------- 對戰
  select count(*) into v_n from public.versus_matches m where m.student_id = v_student;
  if v_n >= 1 then v_got := array_append(v_got, 'first-match'); end if;
  v_up := array_append(v_up, public.ach_put(v_student, 'veteran', v_n));

  if exists (select 1 from public.versus_matches m
              where m.student_id = v_student
                and coalesce(array_length(m.lines_used, 1), 0) >= 3) then
    v_got := array_append(v_got, 'all-lines');
  end if;

  select count(*) into v_n from public.versus_matches m
   where m.student_id = v_student and m.top_tier >= 3;
  v_up := array_append(v_up, public.ach_put(v_student, 'top-tier', v_n));

  -- 被推進自己半場（前線剩三成五以下）還贏回來
  select count(*) into v_n from public.versus_matches m
   where m.student_id = v_student and m.won and m.lowest_front <= 0.35;
  v_up := array_append(v_up, public.ach_put(v_student, 'comeback', v_n));

  -- 連輸兩場之後又開了一場。**輸的人也拿得到的那一個**，整個對戰類就靠它
  -- 不變成「強的越拿越多」。
  if exists (
    select 1 from (
      select lag(m.won, 1) over (order by m.ended_at, m.id) as p1,
             lag(m.won, 2) over (order by m.ended_at, m.id) as p2
        from public.versus_matches m where m.student_id = v_student) t
     where t.p1 is false and t.p2 is false) then
    v_got := array_append(v_got, 'never-quit');
  end if;

  -- 只算贏同學的場次。打電腦不記戰績，這是一開始就講好的。
  -- 真人對戰兩支手機算的是同一場，輸贏一定講得一樣；**兩個人都說自己贏**的那一場
  -- 就是有人改了前端，兩邊都不算。對方輸了直接關掉不回報也照算，不然輸的人一關就能讓人白贏。
  select count(*) into v_n from public.versus_matches m
   where m.student_id = v_student and m.won and m.opponent_kind = 'student'
     and not exists (select 1 from public.versus_matches o
                      where o.live_match = m.live_match and o.student_id <> m.student_id and o.won);
  v_up := array_append(v_up, public.ach_put(v_student, 'war-flag', v_n));

  -- 魔王團戰：打倒過幾隻不同的魔王。「全部」＝有幾隻魔王（每隻魔王有一個外框品項）
  select count(*) into v_n from public.raid_kills k where k.student_id = v_student and k.kills > 0;
  select count(*) into v_all from public.shop_items i where i.id like 'frame-boss-%';
  v_up := array_append(v_up, public.ach_put(v_student, 'raid-slayer', v_n, v_all));

  -- ---------------------------------------------------------------- 收集
  select c.items, c.jobs_cleared into v_items, v_jobs
    from public.characters c where c.student_id = v_student;
  v_items := coalesce(v_items, '{}'::jsonb);

  if exists (
    select 1 from public.characters c
      join lateral jsonb_array_elements_text(c.equipped) e on true
      join public.shop_items i on i.id = e
     where c.student_id = v_student and i.slot = 'frame') then
    v_got := array_append(v_got, 'dressed');
  end if;

  -- 五色都穿上打過一場（2026-09-24 起顏色免費送，「買齊」變成白拿，所以改成要上場）
  if exists (select 1 from public.characters c
              where c.student_id = v_student
                and c.colors_played ?& array['blue','color-red','color-yellow','color-purple','color-black']) then
    v_got := array_append(v_got, 'five-colors');
  end if;

  if v_items ?& array['frame-gold','frame-ribbon','frame-crown','frame-rainbow'] then
    v_got := array_append(v_got, 'all-frames');
  end if;

  select coalesce(jsonb_array_length(c.avatars_seen), 0) into v_n
    from public.characters c where c.student_id = v_student;
  if v_n >= 10 then v_got := array_append(v_got, 'avatar-10'); end if;

  if coalesce(v_jobs, '{}') @> array['knight','mage'] then v_got := array_append(v_got, 'dual-job'); end if;

  select count(distinct u.item_id) into v_n from public.item_uses u
   where u.student_id = v_student;
  if v_n >= 3 then v_got := array_append(v_got, 'item-taster'); end if;

  -- ---------------------------------------------------------------- 習慣
  -- 一律用「來了幾天」，不是「連續幾天」。斷一天不歸零，
  -- 不然請假、沒平板的小孩等於被懲罰。
  select coalesce(max(d), 0) into v_n from (
    select count(distinct (ae.at at time zone 'Asia/Taipei')::date) as d
      from public.answer_events ae
     where ae.student_id = v_student
     group by date_trunc('week', ae.at at time zone 'Asia/Taipei')) t;
  if v_n >= 3 then v_got := array_append(v_got, 'week-3'); end if;
  if v_n >= 5 then v_got := array_append(v_got, 'week-5'); end if;

  select count(distinct (ae.at at time zone 'Asia/Taipei')::date) into v_n
    from public.answer_events ae where ae.student_id = v_student;
  v_up := array_append(v_up, public.ach_put(v_student, 'days', v_n));

  select count(distinct (ae.at at time zone 'Asia/Taipei')::date) into v_n
    from public.answer_events ae
   where ae.student_id = v_student
     and extract(isodow from ae.at at time zone 'Asia/Taipei') in (6, 7);
  v_up := array_append(v_up, public.ach_put(v_student, 'weekend', v_n));

  -- 回鍋：已經通關的關卡又回去玩。隔一分鐘以上才算，
  -- 不然同一場結算前後的那幾題會被當成回鍋。
  if exists (
    select 1 from public.answer_events ae
      join public.level_progress lp
        on lp.student_id = ae.student_id and lp.level_id = ae.level_id
     where ae.student_id = v_student and lp.cleared_at is not null
       and ae.at > lp.cleared_at + interval '1 minute') then
    v_got := array_append(v_got, 'replay');
  end if;

  select coalesce(max(d), 0) into v_n from (
    select count(distinct (ae.at at time zone 'Asia/Taipei')::date) as d
      from public.answer_events ae
     where ae.student_id = v_student
     group by date_trunc('month', ae.at at time zone 'Asia/Taipei')) t;
  if v_n >= 12 then v_got := array_append(v_got, 'month-12'); end if;

  if (select s.created_at from public.students s where s.id = v_student)
       <= now() - interval '30 days'
     and exists (select 1 from public.answer_events ae
                  where ae.student_id = v_student and ae.at > now() - interval '7 days') then
    v_got := array_append(v_got, 'old-friend');
  end if;

  -- ---------------------------------------------------------------- 彩蛋
  if exists (select 1 from public.word_stats ws
              where ws.student_id = v_student and ws.wrong >= 5 and ws.streak >= 1) then
    v_got := array_append(v_got, 'persistent');
  end if;

  -- 十秒內連對五題：看第五題跟它前面第四題的時間差
  if exists (
    select 1 from (
      select ae.at,
             lag(ae.at, 4) over (order by ae.at, ae.id) as p4,
             min(case when ae.correct then 1 else 0 end)
               over (order by ae.at, ae.id rows between 4 preceding and current row) as mn
        from public.answer_events ae where ae.student_id = v_student) t
     where t.mn = 1 and t.p4 is not null and t.at - t.p4 <= interval '10 seconds') then
    v_got := array_append(v_got, 'quick-hand');
  end if;

  -- 安慰獎：魔王關答對八成以上還是沒守住。**通關之後也不會被收回**
  -- （只 insert 不 delete），不然他終於打贏那天徽章反而不見。
  if exists (
    select 1 from (
      select ae.session_id, ae.level_id,
             count(*) filter (where ae.correct) as c, count(*) as n
        from public.answer_events ae
       where ae.student_id = v_student and ae.level_id is not null
         and ae.session_id is not null
       group by ae.session_id, ae.level_id) t
      join public.levels l on l.id = t.level_id
     where l.is_boss and t.n >= 10 and t.c::numeric / t.n >= 0.8
       and not exists (select 1 from public.level_progress lp
                        where lp.student_id = v_student and lp.level_id = t.level_id
                          and lp.cleared_at is not null)) then
    v_got := array_append(v_got, 'so-close');
  end if;

  if exists (
    select 1 from public.level_progress lp
     where lp.student_id = v_student and lp.last_win_session is not null
       and not exists (select 1 from public.item_uses u
                        where u.session_id = lp.last_win_session)) then
    v_got := array_append(v_got, 'bare-handed');
  end if;

  if exists (select 1 from public.answer_events ae
              where ae.student_id = v_student and ae.correct and ae.combo >= 20) then
    v_got := array_append(v_got, 'combo-20');
  end if;

  -- ---------------------------------------------------------------- 寫進去
  -- 目錄裡沒有的 id 不寫（前端跑在新版、資料庫還沒灌新目錄的那段時間）。
  for v_new in
    insert into public.student_achievements (student_id, achievement_id)
    select v_student, a.id from public.achievements a where a.id = any(v_got)
       and cardinality(a.tiers) = 0
    on conflict do nothing
    returning achievement_id
  loop
    return next v_new;
  end loop;

  -- 分階的在上面 ach_put 就寫好了，這裡只把升上去的那些回報出去
  for v_new in select x from unnest(v_up) x where x is not null loop
    return next v_new;
  end loop;

  -- 全能生：七個大類每一類都至少一個（它自己不算）。要等上面寫完才數得準。
  select count(distinct a.category) into v_n
    from public.student_achievements sa
    join public.achievements a on a.id = sa.achievement_id
   where sa.student_id = v_student and a.id <> 'all-rounder';
  if v_n >= 7 then
    for v_new in
      insert into public.student_achievements (student_id, achievement_id)
      select v_student, 'all-rounder'
       where exists (select 1 from public.achievements where id = 'all-rounder')
      on conflict do nothing
      returning achievement_id
    loop
      return next v_new;
    end loop;
  end if;

  -- 獎品：成就限定的外框直接放進背包（不用去商店領，小朋友不會想到要去領）。
  -- 已經有的不重複加，所以重算幾次都一樣。
  update public.characters c
     set items = c.items || coalesce((
           select jsonb_object_agg(a.reward_item, 1)
             from public.student_achievements sa
             join public.achievements a on a.id = sa.achievement_id
            where sa.student_id = v_student
              and a.reward_item is not null and sa.tier >= a.reward_tier
              and not (c.items ? a.reward_item)), '{}'::jsonb),
         updated_at = now()
   where c.student_id = v_student
     and exists (select 1 from public.student_achievements sa
                  join public.achievements a on a.id = sa.achievement_id
                 where sa.student_id = v_student and a.reward_item is not null
                   and sa.tier >= a.reward_tier
                   and not (c.items ? a.reward_item));
end;
$$;

-- -----------------------------------------------------------------------------
-- 記一場兵推。
--
-- 打電腦也記（「初上戰場」「三線通吃」要算），但**勝場只認同學**——
-- won 照實存，要不要算成勝場是 refresh_achievements 在判斷的事。
-- 前端送來的數字都夾住：前線 0~1、兵階 1~3、兵種線只認那三個。
--
-- 對手種類前端說了不全算：'student'（真人即時對戰）要帶 p_live 而且真的有那一場，不然當電腦，
-- 不然直接呼叫這支就能刷戰旗；'ghost' 要真的是同班同學才認。
--
-- p_moves 是這一場的答題串（分身）。**答對的筆數不能比這一場真的答對的多**
-- （跟 answer_events 對帳），多了就整串不收——不然改一串假的，就能做出一個
-- 同學永遠打不贏的分身。這一場照樣記，只是沒有分身。
-- -----------------------------------------------------------------------------
drop function if exists public.record_versus_match(uuid, text, boolean, numeric, numeric, text[], int, text, uuid);
drop function if exists public.record_versus_match(uuid, text, boolean, numeric, numeric, text[], int, text, uuid, jsonb);
create or replace function public.record_versus_match(
  p_session       uuid,
  p_opponent_kind text,
  p_won           boolean,
  p_front         numeric default 0.5,
  p_lowest_front  numeric default 0.5,
  p_lines         text[] default '{}',
  p_top_tier      int default 1,
  p_opponent_name text default '',
  p_opponent      uuid default null,
  p_moves         jsonb default null,
  p_live          uuid default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.current_student_id();
  v_kind    text := 'cpu';
  v_id      uuid;
  v_moves   jsonb := null;
  v_claimed int;
  v_real    int;
  v_legion  text;
  v_foe     uuid := null;
  v_live    uuid := null;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;

  -- 真人即時對戰（2026-09-25）：要真的有這一場、而且我是其中一位，才認 'student'，
  -- 對手也從那一場讀，前端說誰都不算。
  if p_opponent_kind = 'student' and p_live is not null then
    select case when m.p1 = v_student then m.p2 else m.p1 end into v_foe
      from public.live_matches m
     where m.id = p_live and v_student in (m.p1, m.p2);
    if v_foe is not null then v_kind := 'student'; v_live := p_live; end if;
  end if;

  if p_opponent_kind = 'ghost' and p_opponent is not null and p_opponent <> v_student
     and exists (select 1 from public.students a join public.students b on a.class_code = b.class_code
                  where a.id = v_student and b.id = p_opponent) then
    v_kind := 'ghost';
  end if;

  -- 分身的答題串：要是陣列、不能大得離譜（三分鐘正常兩三百筆）、答對筆數對得上帳
  if p_moves is not null and jsonb_typeof(p_moves) = 'array'
     and jsonb_array_length(p_moves) between 1 and 1500 and p_session is not null then
    select count(*) into v_claimed from jsonb_array_elements(p_moves) e
     where jsonb_typeof(e) = 'array' and e->>1 = 'a' and e->>2 = '1';
    select count(*) into v_real from public.answer_events a
     where a.student_id = v_student and a.session_id = p_session and a.correct;
    if v_claimed <= v_real then v_moves := p_moves; end if;
  end if;

  select coalesce((select e from jsonb_array_elements_text(c.equipped) e
                     join public.shop_items i on i.id = e and i.slot = 'legion' limit 1), '')
    into v_legion
    from public.characters c where c.student_id = v_student;

  -- 同一場只記一次。網路不好時前端會重送，重送不能變成兩場戰績。
  if p_session is not null then
    select m.id into v_id from public.versus_matches m
     where m.student_id = v_student and m.session_id = p_session;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.versus_matches
    (student_id, session_id, opponent_kind, opponent_student, opponent_name,
     won, front, lowest_front, lines_used, top_tier, moves, legion, live_match)
  values
    (v_student, p_session, v_kind,
     case when v_kind = 'ghost' then p_opponent when v_kind = 'student' then v_foe end,
     left(coalesce(p_opponent_name, ''), 16),
     coalesce(p_won, false),
     least(greatest(coalesce(p_front, 0.5), 0), 1),
     least(greatest(coalesce(p_lowest_front, 0.5), 0), 1),
     coalesce((select array_agg(x) from unnest(coalesce(p_lines, '{}')) x
                where x in ('recognize','spell','listen')), '{}'),
     least(greatest(coalesce(p_top_tier, 1), 1), 3),
     v_moves, coalesce(v_legion, ''), v_live)
  returning id into v_id;
  perform public.note_color_played(v_student);
  return v_id;
end;
$$;

-- 同班可以挑戰的分身：每個同學最近一場有答題串的兵推，不含自己。
-- 只回摘要（誰、多久前、答對幾題、穿什麼），答題串挑了才用 ghost_of 抓。
drop function if exists public.class_ghosts();
create or replace function public.class_ghosts()
returns table (student_id uuid, nickname text, avatar text, legion text,
               ended_at timestamptz, correct int)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.student_id, s.nickname, c.avatar, g.legion, g.ended_at,
         (select count(*)::int from jsonb_array_elements(g.moves) e
           where e->>1 = 'a' and e->>2 = '1')
    from (select distinct on (m.student_id) m.student_id, m.legion, m.ended_at, m.moves
            from public.versus_matches m
            join public.students s on s.id = m.student_id
           where m.moves is not null
             and s.class_code = public.current_class_code()
             and m.student_id <> public.current_student_id()
           order by m.student_id, m.ended_at desc) g
    join public.students s on s.id = g.student_id
    left join public.characters c on c.student_id = g.student_id
   order by g.ended_at desc
   limit 60;
$$;

-- 某個同學最近一場的答題串。不同班就什麼都不回。
drop function if exists public.ghost_of(uuid);
create or replace function public.ghost_of(p_student uuid)
returns table (nickname text, legion text, moves jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.nickname, m.legion, m.moves
    from public.versus_matches m
    join public.students s on s.id = m.student_id
   where m.student_id = p_student
     and m.moves is not null
     and s.class_code = public.current_class_code()
   order by m.ended_at desc
   limit 1;
$$;

-- 我的徽章牆。回「全部目錄 ＋ 我拿到的時間與階級 ＋ 現在的數字」，沒拿到的
-- unlocked_at 是 null——畫面要畫得出灰色剪影和「還差多少」，所以沒拿到的也要回。
--   goal_all  「全部」那一階現在是多少。沒算過的（還沒重算）是 0。
drop function if exists public.my_achievements();
create or replace function public.my_achievements()
returns table (id text, category text, unlocked_at timestamptz,
               tier int, tier_at timestamptz, value int, goal_all int)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.category, sa.unlocked_at,
         coalesce(sa.tier, 0)::int, coalesce(sa.tier_at, sa.unlocked_at),
         coalesce(p.value, 0), coalesce(p.goal_all, 0)
    from public.achievements a
    left join public.student_achievements sa
      on sa.achievement_id = a.id and sa.student_id = public.current_student_id()
    left join public.achievement_progress p
      on p.achievement_id = a.id and p.student_id = public.current_student_id()
   order by a.ord;
$$;

-- 全班每一格、每一階有幾個人拿到，「全班 23 人只有 2 人有」要用。
-- 只回人數不回名字。學生看自己班；老師傳班級代碼看自己帶的班。
create or replace function public.class_badge_counts(p_code text default null)
returns table (achievement_id text, tier int, holders int, class_size int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_code text := coalesce(upper(btrim(p_code)), public.current_class_code());
begin
  if v_code is null then return; end if;
  if v_code is distinct from public.current_class_code() and not public.is_teacher_of(v_code) then
    raise exception '看不到別班的徽章';
  end if;
  return query
    with kids as (select s.id from public.students s where s.class_code = v_code)
    select sa.achievement_id, t.t::int,
           count(*)::int,
           (select count(*)::int from kids)
      from public.student_achievements sa
      join kids k on k.id = sa.student_id
      join lateral generate_series(1, sa.tier) as t(t) on true
     group by sa.achievement_id, t.t;
end;
$$;

-- 別人的個人檔案。**一定要走這支**：別人的角色存檔 RLS 是讀不到的，
-- 而且「可不可以看」要看對方有沒有把檔案關起來（老師不受限）。
-- 只露暱稱、頭像、外框、稱號、徽章——不露登入帳號，也不露答題明細。
drop function if exists public.public_profile(uuid);
create or replace function public.public_profile(p_student uuid)
returns table (nickname text, avatar text, equipped jsonb, title text,
               pinned jsonb, badges jsonb, stars int, level int, tiers jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := public.current_student_id();
  v_open boolean;
  v_code text;
begin
  select c.public_profile, s.class_code into v_open, v_code
    from public.students s join public.characters c on c.student_id = s.id
   where s.id = p_student;
  if v_open is null then raise exception '沒有這個人'; end if;

  -- 同班才看得到（排行榜只比班內，檔案也一樣）。老師看自己班的全部。
  if p_student <> coalesce(v_me, p_student)
     and not public.is_teacher_of(v_code)
     and (v_code is distinct from public.current_class_code()) then
    raise exception '看不到別班的檔案';
  end if;
  if not v_open and p_student <> v_me and not public.is_teacher_of(v_code) then
    raise exception '這位同學把檔案關起來了';
  end if;

  return query
    select s.nickname, c.avatar, c.equipped, c.title, c.pinned,
           coalesce((select jsonb_agg(sa.achievement_id order by sa.unlocked_at)
                       from public.student_achievements sa
                      where sa.student_id = p_student), '[]'::jsonb),
           coalesce((select sum(lp.stars)::int from public.level_progress lp
                      where lp.student_id = p_student), 0),
           public.level_of(c.exp),
           -- 每一格拿到第幾階：{"hundred": 3, ...}。一次性的是 1。
           coalesce((select jsonb_object_agg(sa.achievement_id, sa.tier)
                       from public.student_achievements sa
                      where sa.student_id = p_student), '{}'::jsonb)
      from public.students s join public.characters c on c.student_id = s.id
     where s.id = p_student;
end;
$$;

-- 別在名字旁邊的三個徽章。**只能別自己拿到的**，不然打個 API 就能掛一排。
create or replace function public.set_pinned(p_ids text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.current_student_id();
  v_ok      jsonb;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_ok
    from (select x from unnest(coalesce(p_ids, '{}')) with ordinality as t(x, i)
           where exists (select 1 from public.student_achievements sa
                          where sa.student_id = v_student and sa.achievement_id = x)
           order by t.i limit 3) q;
  update public.characters set pinned = v_ok, updated_at = now()
   where student_id = v_student;
  return v_ok;
end;
$$;

-- 稱號。一樣只能選自己拿到的那些（空字串＝不掛）。
create or replace function public.set_title(p_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.current_student_id();
  v_title   text := '';
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  if coalesce(p_id, '') <> '' then
    select a.reward_title into v_title
      from public.student_achievements sa
      join public.achievements a on a.id = sa.achievement_id
     where sa.student_id = v_student and a.id = p_id and a.reward_title <> '';
    if v_title is null then raise exception '這個稱號你還沒拿到'; end if;
  end if;
  update public.characters set title = coalesce(v_title, ''), updated_at = now()
   where student_id = v_student;
  return coalesce(v_title, '');
end;
$$;

-- 檔案給不給同學看。預設開，自己隨時可以關；老師一律看得到。
create or replace function public.set_public_profile(p_open boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  update public.characters set public_profile = coalesce(p_open, true), updated_at = now()
   where student_id = v_student;
  return coalesce(p_open, true);
end;
$$;

grant execute on function
  public.refresh_achievements(),
  public.my_achievements(),
  public.class_badge_counts(text),
  public.public_profile(uuid),
  public.set_pinned(text[]),
  public.set_title(text),
  public.set_public_profile(boolean),
  public.record_versus_match(uuid, text, boolean, numeric, numeric, text[], int, text, uuid, jsonb, uuid),
  public.class_ghosts(),
  public.ghost_of(uuid)
to authenticated;

-- =============================================================================
-- 真人即時對戰（2026-09-25）
--
-- 兩條路找對手，**都不用代碼**：
--   隨機對戰  按下去就排進班上的隊伍，伺服器湊兩個程度接近的人。沒有「拒絕」這一步，
--             人緣差、不認識人的小朋友也一定配得到（Chuck 最在意的就是這個）。
--   邀同學    對戰頁列出班上**現在也在對戰頁**的同學，點頭像邀請。對方沒接，
--             邀請的人只看到「他現在沒空」，不會看到「被拒絕」。
-- 20 秒沒配到／沒人接，前端自己改打分身。
--
-- 打的時候兩支手機各跑一份同樣的戰場，只交換「誰在第幾格做了什麼」
-- （見 src/games/tug-of-war/lockstep.ts）。伺服器只是一個信箱：
-- 每人每半秒叫一次 live_sync，把自己的新動作放上來、把對方的拿回去。
-- 用輪詢不用 Realtime，理由跟房間一樣：教室 wifi 斷一下，輪詢自己會接回來。
-- =============================================================================

-- 聽音題在教室裡會被旁邊同學的手機念出答案。班上對戰預設關，老師可以打開。
alter table public.classes add column if not exists live_listen boolean not null default false;

-- 誰現在在對戰頁。對戰頁每一秒半叫一次 live_poll 就會更新 seen_at，
-- 六秒沒消息就當作不在了（關掉頁面不會通知，只能靠這個）。
create table if not exists public.live_lobby (
  student_id  uuid primary key references public.students(id) on delete cascade,
  class_code  text not null,
  -- 按了「隨機對戰」、正在排隊
  seeking     boolean not null default false,
  -- 每分鐘大概答對幾題（前端從自己的作答速度算的）。只拿來湊程度接近的人，
  -- 報假的頂多配到不相當的對手，拿不到任何東西，所以信前端沒關係。
  rate        numeric not null default 14,
  -- 我正在邀誰、什麼時候邀的。20 秒沒接就過期。
  invite_to   uuid references public.students(id) on delete set null,
  invite_at   timestamptz,
  -- 配好的那一場。回到對戰頁的時候如果已經是 20 秒前的舊場次，就清掉。
  match_id    uuid,
  seen_at     timestamptz not null default now()
);
create index if not exists live_lobby_class on public.live_lobby(class_code, seen_at desc);

create table if not exists public.live_matches (
  id          uuid primary key default gen_random_uuid(),
  class_code  text not null,
  -- 第一位永遠是「戰場左邊」那一方（兩支手機算的是同一份戰場，見 lockstep.ts）
  p1          uuid not null references public.students(id) on delete cascade,
  p2          uuid not null references public.students(id) on delete cascade,
  how         text not null check (how in ('random', 'invite')),
  created_at  timestamptz not null default now(),
  -- 兩人各自的動作串：[格,'a',對錯,目標] / [格,'s',線,階] / [格,'u']
  moves1      jsonb not null default '[]'::jsonb,
  moves2      jsonb not null default '[]'::jsonb,
  -- 「第幾格以前的動作都送了」。對方靠它知道自己可以放心算到哪一格。
  mark1       int not null default -1,
  mark2       int not null default -1,
  seen1       timestamptz,
  seen2       timestamptz,
  -- 中途按了離開。對方那邊會改打分身。
  left1       boolean not null default false,
  left2       boolean not null default false
);
create index if not exists live_matches_p1 on public.live_matches(p1, created_at desc);
create index if not exists live_matches_p2 on public.live_matches(p2, created_at desc);

-- 兩張表都只准透過下面幾支函式碰（上面 revoke all on all tables 已經收掉了，
-- 這裡只是講清楚：不開 grant、不寫 policy）。
alter table public.live_lobby   enable row level security;
alter table public.live_matches enable row level security;


-- 一場配好的對戰，照「我」的角度寫出來給前端。
create or replace function public.live_match_json(p_match uuid, p_me uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', m.id,
    'seat', case when m.p1 = p_me then 1 else 2 end,
    'foe', f.id,
    'foe_name', f.nickname,
    'foe_avatar', coalesce(c.avatar, ''),
    'foe_legion', coalesce((select e from jsonb_array_elements_text(c.equipped) e
                              join public.shop_items i on i.id = e and i.slot = 'legion' limit 1), ''),
    'foe_rate', coalesce(l.rate, 14),
    'no_listen', not coalesce(k.live_listen, false),
    'how', m.how)
    from public.live_matches m
    join public.students f on f.id = case when m.p1 = p_me then m.p2 else m.p1 end
    left join public.characters c on c.student_id = f.id
    left join public.live_lobby l on l.student_id = f.id
    left join public.classes k on k.code = m.class_code
   where m.id = p_match and p_me in (m.p1, m.p2);
$$;
revoke all on function public.live_match_json(uuid, uuid) from public, anon, authenticated;

-- 對戰頁每一秒半叫一次：報到、排隊、湊對、看誰在邀我、看班上誰在。
--   p_seeking  我現在有沒有按「隨機對戰」
--   p_rate     我每分鐘大概答對幾題
-- 回傳 { match, invites, online, inviting }
create or replace function public.live_poll(p_seeking boolean default false, p_rate numeric default 14)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me     uuid := public.current_student_id();
  v_code   text := public.current_class_code();
  v_row    public.live_lobby;
  v_other  uuid;
  v_match  uuid;
  v_rate   numeric := least(greatest(coalesce(p_rate, 14), 1), 60);
begin
  if v_me is null or v_code is null then raise exception '還沒加入班級'; end if;

  insert into public.live_lobby as l (student_id, class_code, seeking, rate, seen_at)
  values (v_me, v_code, coalesce(p_seeking, false), v_rate, now())
  on conflict (student_id) do update
     set class_code = excluded.class_code, seeking = excluded.seeking,
         rate = excluded.rate, seen_at = now();

  select * into v_row from public.live_lobby where student_id = v_me for update;

  -- 舊的那一場（打完回來了）清掉。剛配好的那一場前端一秒半內就會拿到，20 秒綽綽有餘。
  if v_row.match_id is not null and not exists (
       select 1 from public.live_matches m
        where m.id = v_row.match_id and m.created_at > now() - interval '20 seconds') then
    update public.live_lobby set match_id = null where student_id = v_me;
    v_row.match_id := null;
  end if;

  -- 排隊中又還沒配到：找一個也在排隊、程度最接近的同學。
  -- 對方那一列鎖不到（他也正在湊對）就跳過，下一輪再說，免得兩個人互等卡死。
  if v_row.match_id is null and coalesce(p_seeking, false) then
    select l.student_id into v_other
      from public.live_lobby l
     where l.class_code = v_code and l.student_id <> v_me and l.seeking
       and l.match_id is null and l.seen_at > now() - interval '6 seconds'
     order by abs(l.rate - v_rate), random()
     limit 1
     for update skip locked;
    if v_other is not null then
      insert into public.live_matches (class_code, p1, p2, how)
      values (v_code, v_other, v_me, 'random') returning id into v_match;
      update public.live_lobby
         set match_id = v_match, seeking = false, invite_to = null, invite_at = null
       where student_id in (v_me, v_other);
      v_row.match_id := v_match;
    end if;
  end if;

  return jsonb_build_object(
    'match', case when v_row.match_id is null then null
                  else public.live_match_json(v_row.match_id, v_me) end,
    'inviting', (select l.invite_to from public.live_lobby l
                  where l.student_id = v_me and l.invite_at > now() - interval '20 seconds'),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nickname', s.nickname,
                                          'avatar', coalesce(c.avatar, '')) order by l.invite_at)
        from public.live_lobby l
        join public.students s on s.id = l.student_id
        left join public.characters c on c.student_id = s.id
       where l.invite_to = v_me and l.invite_at > now() - interval '20 seconds'
         and l.seen_at > now() - interval '6 seconds' and l.match_id is null
         and s.class_code = v_code), '[]'::jsonb),
    'online', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nickname', s.nickname,
                                          'avatar', coalesce(c.avatar, ''),
                                          'busy', l.match_id is not null) order by s.nickname)
        from public.live_lobby l
        join public.students s on s.id = l.student_id
        left join public.characters c on c.student_id = s.id
       where l.class_code = v_code and s.class_code = v_code and l.student_id <> v_me
         and l.seen_at > now() - interval '6 seconds'), '[]'::jsonb));
end;
$$;

-- 邀一個同學。null＝收回邀請（並退出隊伍）。只邀得到同班、現在在對戰頁的人。
create or replace function public.live_invite(p_to uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_code text := public.current_class_code();
begin
  if v_me is null or v_code is null then raise exception '還沒加入班級'; end if;
  if p_to is null then
    -- 離開對戰頁也叫這支：順便退出隊伍，免得在他走掉的那幾秒被配給別人
    update public.live_lobby set invite_to = null, invite_at = null, seeking = false where student_id = v_me;
    return false;
  end if;
  if p_to = v_me or not exists (
       select 1 from public.live_lobby l join public.students s on s.id = l.student_id
        where l.student_id = p_to and s.class_code = v_code
          and l.seen_at > now() - interval '6 seconds') then
    return false;
  end if;
  update public.live_lobby set invite_to = p_to, invite_at = now(), seeking = false
   where student_id = v_me;
  return found;
end;
$$;

-- 接受邀請。邀的人還在、邀請還沒過期、兩個人都還沒配到別人，才開得成。
-- 開不成回 null，前端說「邀請過期了」。
create or replace function public.live_accept(p_from uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := public.current_student_id();
  v_code  text := public.current_class_code();
  v_match uuid;
  v_n     int;
begin
  if v_me is null or v_code is null then raise exception '還沒加入班級'; end if;
  -- 兩列照編號順序一起鎖，兩個人同時互相接受也不會卡死
  perform 1 from public.live_lobby where student_id in (v_me, p_from)
   order by student_id for update;
  select count(*) into v_n from public.live_lobby l
    join public.students s on s.id = l.student_id
   where s.class_code = v_code
     and ((l.student_id = p_from and l.invite_to = v_me and l.invite_at > now() - interval '20 seconds'
           and l.seen_at > now() - interval '6 seconds')
       or l.student_id = v_me)
     and (l.match_id is null or not exists (
            select 1 from public.live_matches m
             where m.id = l.match_id and m.created_at > now() - interval '20 seconds'));
  if v_n < 2 or p_from = v_me then return null; end if;
  insert into public.live_matches (class_code, p1, p2, how)
  values (v_code, p_from, v_me, 'invite') returning id into v_match;
  update public.live_lobby
     set match_id = v_match, seeking = false, invite_to = null, invite_at = null
   where student_id in (v_me, p_from);
  return public.live_match_json(v_match, v_me);
end;
$$;

-- 打的時候每半秒叫一次：放上我的新動作、拿回對方的。
--   p_base       p_moves 的第一筆是我的第幾筆（從 0 算）。網路重送時伺服器靠它不重複收。
--   p_moves      我從 p_base 開始的動作
--   p_mark       我第幾格以前的動作都送了
--   p_their_from 對方的動作我已經有幾筆
--   p_left       我按了離開
-- 回傳 { mine: 伺服器上我有幾筆, theirs: 對方從 p_their_from 開始的動作, their_mark, their_left }
create or replace function public.live_sync(
  p_match uuid, p_base int, p_moves jsonb, p_mark int, p_their_from int, p_left boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := public.current_student_id();
  m       public.live_matches;
  v_seat  int;
  v_mine  jsonb;
  v_n     int;
  v_add   jsonb;
  v_their jsonb;
begin
  if v_me is null then raise exception '還沒加入班級'; end if;
  select * into m from public.live_matches where id = p_match for update;
  if m.id is null or v_me not in (m.p1, m.p2) then raise exception '不是你的對戰'; end if;
  -- 一場三分鐘，十分鐘前的場次不再收
  if m.created_at < now() - interval '10 minutes' then raise exception '這場已經結束了'; end if;
  v_seat := case when m.p1 = v_me then 1 else 2 end;
  v_mine := case when v_seat = 1 then m.moves1 else m.moves2 end;
  -- 開打了：大廳那一列不再指著這一場，不然提早離開又馬上回到對戰頁，會被拉回同一場
  update public.live_lobby set match_id = null where student_id = v_me and match_id = p_match;
  v_n := jsonb_array_length(v_mine);

  -- 接得上才收（p_base 不能跳過還沒收到的）。接不上就什麼都不收、mark 也不動，
  -- 前端看回傳的 mine 從那裡重送——少一筆的話兩支手機就算歪了。
  if p_base is not null and p_base <= v_n and jsonb_typeof(p_moves) = 'array' then
    select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_add
      from jsonb_array_elements(p_moves) with ordinality as x(e, i)
     where i > v_n - p_base;
    if v_n + jsonb_array_length(v_add) <= 3000 then
      v_mine := v_mine || v_add;
      v_n := jsonb_array_length(v_mine);
      if v_seat = 1 then
        update public.live_matches set moves1 = v_mine, mark1 = greatest(mark1, coalesce(p_mark, -1)),
               seen1 = now(), left1 = left1 or coalesce(p_left, false) where id = p_match;
      else
        update public.live_matches set moves2 = v_mine, mark2 = greatest(mark2, coalesce(p_mark, -1)),
               seen2 = now(), left2 = left2 or coalesce(p_left, false) where id = p_match;
      end if;
    end if;
  elsif coalesce(p_left, false) then
    if v_seat = 1 then update public.live_matches set left1 = true where id = p_match;
    else update public.live_matches set left2 = true where id = p_match; end if;
  end if;

  v_their := case when v_seat = 1 then m.moves2 else m.moves1 end;
  return jsonb_build_object(
    'mine', v_n,
    'theirs', coalesce((select jsonb_agg(e order by i)
                          from jsonb_array_elements(v_their) with ordinality as x(e, i)
                         where i > greatest(coalesce(p_their_from, 0), 0)), '[]'::jsonb),
    'their_mark', case when v_seat = 1 then m.mark2 else m.mark1 end,
    'their_left', case when v_seat = 1 then m.left2 else m.left1 end);
end;
$$;

-- 老師開關「班上真人對戰出不出聽音題」
create or replace function public.class_set_live_listen(p_code text, p_on boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(p_code));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  update public.classes set live_listen = coalesce(p_on, false) where code = v_code;
  return coalesce(p_on, false);
end;
$$;

grant execute on function
  public.live_poll(boolean, numeric),
  public.live_invite(uuid),
  public.live_accept(uuid),
  public.live_sync(uuid, int, jsonb, int, int, boolean),
  public.class_set_live_listen(text, boolean)
to authenticated;


-- =============================================================================
-- 魔王團戰（2026-09-25）
--
-- 房間原本是「大家同時打同一關守塔」，Chuck 說感覺不出一起玩。改成：
-- 二到六個人共用一個戰場，魔王在左邊，大家各守一座城、各自出兵往左推。
-- 三分鐘內把魔王的血打光就贏；時間到或全部的城同時倒下就輸。
--
-- 入口沿用房間（選關畫面的橫幅、老師的面板），改成選魔王不選關卡：
--   - 公開房或私人房（四位數密碼，清單上掛鎖頭）
--   - 房主可以請人離開，被請出的人這一場不能再進；老師看得到、關得掉每一場，不用密碼
--   - 至少兩個人，房主按開始；開打之後不能再進
-- 打的時候每支手機各跑一份一樣的戰場，只交換動作（src/games/boss-raid/lockstep.ts）。
--
-- 獎勵：答題照常算（事件是唯一真相）；打贏**不多給金幣**。
-- 每隻魔王第一次打倒給一個商店買不到的外框，個人檔案記打倒次數。
-- =============================================================================

-- 開一場魔王團戰。
--   老師：p_class_code 填他的班，開出來的房間排最前面、沒有房主（老師自己管）。
--   學生：p_class_code 留空，開在自己班上，開完直接算他進來了。
-- p_pass：null 或空字串＝公開房；四位數字＝私人房。
create or replace function public.open_raid(
  p_boss text, p_pass text default null, p_class_code text default null, p_rate numeric default 14)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
        v_code    text;
        v_pass    text := nullif(btrim(coalesce(p_pass, '')), '');
        v_teacher boolean := false;
        v_id      uuid;
begin
  -- 魔王的 id 是前端的，資料庫不另外存一份目錄：有它的外框才算有這隻魔王
  if p_boss is null or p_boss !~ '^[a-z]+$'
     or not exists (select 1 from public.shop_items i where i.id = 'frame-boss-' || p_boss) then
    raise exception '沒有這隻魔王';
  end if;
  if v_pass is not null and v_pass !~ '^[0-9]{4}$' then raise exception '密碼要四位數字'; end if;

  if p_class_code is not null then
    v_code := upper(btrim(p_class_code));
    if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
    v_teacher := true;
  else
    v_code := public.current_class_code();
    if v_student is null then raise exception '請先登入'; end if;
    if v_code is null then raise exception '還沒加入班級，沒辦法揪人'; end if;
    perform public.room_sweep(v_code);
    -- 一個人同時只能開一場（連按十次就是十個空房間）
    update public.rooms set status = 'done', ended_at = now()
     where host_student = v_student and status = 'lobby';
    if (select count(*) from public.rooms r
         where r.class_code = v_code and r.status <> 'done') >= 12 then
      raise exception '班上開著的場次太多了，等別人打完再開';
    end if;
  end if;

  insert into public.rooms (class_code, level_id, boss_id, mode, opened_by, host_student, pass, no_listen)
  values (v_code, null, p_boss, 'raid', auth.uid(), case when v_teacher then null else v_student end,
          v_pass, not coalesce((select k.live_listen from public.classes k where k.code = v_code), false))
  returning id into v_id;

  if not v_teacher then
    delete from public.room_members m
     where m.student_id = v_student and m.room_id <> v_id
       and exists (select 1 from public.rooms r where r.id = m.room_id and r.status = 'lobby');
    insert into public.room_members (room_id, student_id, rate)
    values (v_id, v_student, least(greatest(coalesce(p_rate, 14), 6), 32));
  end if;
  return v_id;
end;
$$;

-- 房主請某個人離開。只在還沒開打的時候；被請出的人這一場不能再進來。
create or replace function public.room_kick(p_room uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.room_is_mine(p_room) then raise exception '這一場不是你開的'; end if;
  if p_student = public.current_student_id() then raise exception '不能請自己離開'; end if;
  if not exists (select 1 from public.rooms r where r.id = p_room and r.status = 'lobby') then
    raise exception '已經開打了';
  end if;
  delete from public.room_members where room_id = p_room and student_id = p_student;
  insert into public.room_bans (room_id, student_id) values (p_room, p_student)
    on conflict do nothing;
end;
$$;

-- 打的時候每 0.4 秒叫一次：放上我的新動作、拿回大家的。
--   p_base   p_moves 的第一筆是我的第幾筆（從 0 算）。網路重送時靠它不重複收。
--   p_mark   我第幾格以前的動作都送了。打完了送 1000000000（DONE_MARK）。
--   p_from   每個座位的動作我已經有幾筆（照座位號排的陣列）
--   p_left   我按了離開
-- 回傳 { mine, gone, seats: [{ moves（從 p_from 開始）, mark, final }] }
--
-- 斷線**由這裡判**：某個座位 12 秒沒消息（RAID_GONE_S），就把他的 mark 凍住當作 final。
-- 每支手機拿到的是同一個 final，就在同一格讓電腦接手——不能讓各支手機自己判，
-- 網路快慢不一，各判各的一定會判在不同格。
-- 打完的人（mark 是 DONE_MARK）不判：他只是不用再送了。
create or replace function public.raid_sync(
  p_room uuid, p_base int, p_moves jsonb, p_mark int, p_from jsonb, p_left boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := public.current_student_id();
  v_room public.rooms;
  v_seat public.raid_seats;
  v_n    int;
  v_add  jsonb;
begin
  if v_me is null then raise exception '請先登入'; end if;
  select * into v_room from public.rooms where id = p_room;
  if v_room.id is null or v_room.mode <> 'raid' then raise exception '沒有這一場'; end if;
  -- 一場三分鐘，十分鐘前開打的不再收
  if v_room.started_at is null or v_room.started_at < now() - interval '10 minutes' then
    raise exception '這場已經結束了';
  end if;
  -- 鎖整場的座位（照座位號），判斷線跟收動作才不會搶在一起
  perform 1 from public.raid_seats where room_id = p_room order by seat for update;
  select * into v_seat from public.raid_seats where room_id = p_room and student_id = v_me;
  if v_seat.room_id is null then raise exception '你不在這一場'; end if;

  if v_seat.final is null then
    v_n := jsonb_array_length(v_seat.moves);
    -- 接得上才收（跟 live_sync 一樣）；接不上前端看回傳的 mine 從那裡重送
    if p_base is not null and p_base <= v_n and jsonb_typeof(p_moves) = 'array' then
      select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_add
        from jsonb_array_elements(p_moves) with ordinality as x(e, i)
       where i > v_n - p_base;
      if v_n + jsonb_array_length(v_add) <= 3000 then
        update public.raid_seats
           set moves = moves || v_add, mark = greatest(mark, coalesce(p_mark, -1))
         where room_id = p_room and seat = v_seat.seat;
      end if;
    end if;
    update public.raid_seats
       set seen_at = greatest(seen_at, now()),
           final = case when coalesce(p_left, false) then mark else final end
     where room_id = p_room and seat = v_seat.seat;
  end if;

  update public.raid_seats
     set final = mark
   where room_id = p_room and final is null and mark < 1000000000
     and seen_at < now() - interval '12 seconds';

  return jsonb_build_object(
    'mine', (select jsonb_array_length(moves) from public.raid_seats
              where room_id = p_room and seat = v_seat.seat),
    'gone', (select final is not null from public.raid_seats
              where room_id = p_room and seat = v_seat.seat)
            -- 自己按離開的不算「被判出局」
            and not coalesce(p_left, false),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'moves', coalesce((select jsonb_agg(e order by i)
                                    from jsonb_array_elements(rs.moves) with ordinality as x(e, i)
                                   where i > greatest(coalesce((p_from ->> rs.seat)::int, 0), 0)),
                                 '[]'::jsonb),
               'mark', coalesce(rs.final, rs.mark),
               'final', rs.final)
             order by rs.seat)
        from public.raid_seats rs where rs.room_id = p_room), '[]'::jsonb));
end;
$$;

-- 打完回報。回傳 { confirmed, won, kills, first }：
--   confirmed  這一場「打倒魔王」伺服器認了沒
--   kills      我打倒這隻魔王幾次了
--   first      這一場是不是我第一次打倒它（拿到外框的那一場）
--
-- **打倒要兩個人都說贏才算**（還在場上的只剩一個人就一個）。每支手機算的是同一場，
-- 輸贏一定講得一樣；只有一個人說贏、其他人說輸，就是有人改了前端。
-- 認了之後，座位上的每個人都記一次（斷線由電腦接手的也算，他有打），
-- 第一次打倒的人外框直接放進背包。還沒認的話前端隔兩秒再問一次（同一支，重複叫沒關係）。
create or replace function public.raid_result(
  p_room uuid, p_won boolean, p_dealt int default 0, p_correct int default 0, p_session uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := public.current_student_id();
  v_room  public.rooms;
  v_yes   int;
  v_no    int;
  v_need  int;
  v_frame text;
  v_k     public.raid_kills;
begin
  if v_me is null then raise exception '請先登入'; end if;
  select * into v_room from public.rooms where id = p_room for update;
  if v_room.id is null or v_room.mode <> 'raid' then raise exception '沒有這一場'; end if;

  update public.raid_seats
     set won = coalesce(p_won, false),
         dealt = least(greatest(coalesce(p_dealt, 0), 0), 100000),
         correct = least(greatest(coalesce(p_correct, 0), 0), 1000),
         session_id = coalesce(p_session, session_id),
         mark = greatest(mark, 1000000000)
   where room_id = p_room and student_id = v_me and final is null;

  if v_room.raid_won is null then
    select count(*) filter (where won), count(*) filter (where not won),
           least(2, count(*) filter (where final is null))
      into v_yes, v_no, v_need
      from public.raid_seats where room_id = p_room;
    if v_yes >= greatest(v_need, 1) and v_yes > v_no then
      update public.rooms set raid_won = true where id = p_room;
      v_room.raid_won := true;
      v_frame := 'frame-boss-' || v_room.boss_id;
      insert into public.raid_kills as k (student_id, boss_id, kills, first_room)
      select rs.student_id, v_room.boss_id, 1, p_room
        from public.raid_seats rs where rs.room_id = p_room
      on conflict (student_id, boss_id) do update set kills = k.kills + 1;
      update public.characters c
         set items = c.items || jsonb_build_object(v_frame, 1), updated_at = now()
       where c.student_id in (select rs.student_id from public.raid_seats rs where rs.room_id = p_room)
         and not (c.items ? v_frame)
         and exists (select 1 from public.shop_items i where i.id = v_frame);
    end if;
  end if;

  -- 大家都回報了（或斷線了），這一場就收掉，房間清單上不再掛著
  if not exists (select 1 from public.raid_seats
                  where room_id = p_room and won is null and final is null) then
    update public.rooms set status = 'done', ended_at = now()
     where id = p_room and status <> 'done';
  end if;

  select * into v_k from public.raid_kills where student_id = v_me and boss_id = v_room.boss_id;
  return jsonb_build_object(
    'confirmed', coalesce(v_room.raid_won, false),
    'kills', coalesce(v_k.kills, 0),
    'first', v_room.raid_won is true and v_k.first_room = p_room);
end;
$$;

-- 誰打倒過哪幾隻魔王。不給 id 就是自己；同班同學、老師看得到（個人檔案用）。
create or replace function public.raid_kill_list(p_student uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(p_student, public.current_student_id());
        v_code text;
begin
  select s.class_code into v_code from public.students s where s.id = v_id;
  if v_id is null or not (v_id = public.current_student_id()
                          or v_code = public.current_class_code()
                          or public.is_teacher_of(v_code)) then
    return '{}'::jsonb;
  end if;
  return coalesce((select jsonb_object_agg(k.boss_id, k.kills)
                     from public.raid_kills k where k.student_id = v_id and k.kills > 0), '{}'::jsonb);
end;
$$;

grant execute on function
  public.open_raid(text, text, text, numeric),
  public.room_kick(uuid, uuid),
  public.raid_sync(uuid, int, jsonb, int, jsonb, boolean),
  public.raid_result(uuid, boolean, int, int, uuid),
  public.raid_kill_list(uuid)
to authenticated;
