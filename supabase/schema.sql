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
do $$ begin
  alter table public.shop_items add constraint shop_items_slot_ck
    check (slot is null or slot in ('color','frame'));
exception when duplicate_object then null; end $$;

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

    insert into public.answer_events
      (student_id, word_id, skill, correct, ms, combo, game_id, level_id, session_id)
    values
      (v_student, v_word, v_skill, v_ok, v_ms, v_combo,
       coalesce(e ->> 'gameId', 'unknown'), nullif(e ->> 'levelId', ''),
       -- 格式不對就當沒有，不要讓一個壞欄位把整包答題擋下來
       (case when (e ->> 'sessionId') ~ '^[0-9a-fA-F-]{36}$'
             then (e ->> 'sessionId')::uuid end));

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
    (student_id, level_id, stars, best_correct, cleared_at)
  values
    (v_student, p_level_id, v_stars, v_correct,
     case when v_win then now() else null end)
  on conflict (student_id, level_id) do update set
    stars        = greatest(lp.stars, excluded.stars),
    best_correct = greatest(lp.best_correct, excluded.best_correct),
    -- 第一次通關的時間留著，重玩不覆蓋
    cleared_at   = coalesce(lp.cleared_at, excluded.cleared_at);

  if v_bonus > 0 then
    update public.characters c
       set coins = c.coins + v_bonus, updated_at = now()
     where c.student_id = v_student;
  end if;

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
  update public.characters set avatar = p_avatar, updated_at = now()
   where student_id = v_student;
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
  v_price int; v_unlock int; v_coins int; v_exp int;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  select i.price, i.unlock_level into v_price, v_unlock
    from public.shop_items i where i.id = p_item;
  if v_price is null then raise exception '商店裡沒有這個東西'; end if;

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
  v_kind text; v_slot text; v_have int; v_equipped jsonb;
begin
  if v_student is null then raise exception '還沒加入班級'; end if;
  select i.kind, i.slot into v_kind, v_slot from public.shop_items i where i.id = p_item;
  if v_kind is null then raise exception '沒有這個東西'; end if;
  if v_kind <> 'cosmetic' then raise exception '這個不是穿戴的東西'; end if;

  select coalesce((c.items ->> p_item)::int, 0) into v_have
    from public.characters c where c.student_id = v_student;
  if p_on and v_have <= 0 then raise exception '你還沒有這個東西'; end if;

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
create or replace function public.consume_item(p_item text)
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
  return v_items;
end;
$$;

-- 同班排行榜。只給暱稱、分數和外觀，不給背包內容——
-- 「誰有幾個道具」不是排行榜的事，但**外框和顏色一定要看得到**：
-- 收集品要同學看得到才有意義（見 src/data/cosmetics.ts）。
-- me 是「這一列是不是我」，讓畫面把自己那一行標出來，不用把 id 送出去。
-- 回傳的欄位變多了，create or replace 不能改回傳型別，所以先丟掉舊的。
drop function if exists public.class_leaderboard(text);
create or replace function public.class_leaderboard(p_code text default null)
returns table (nickname text, coins int, exp int, stars int,
               avatar text, equipped jsonb, me boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (
    select coalesce(upper(btrim(p_code)), public.current_class_code()) as code
  )
  select s.nickname, c.coins, c.exp,
         coalesce((select sum(lp.stars)::int from public.level_progress lp
                    where lp.student_id = s.id), 0),
         c.avatar, c.equipped, s.id = public.current_student_id()
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
begin
  if not public.room_is_mine(p_room) then raise exception '這一場不是你開的'; end if;
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

-- 加入班上的某一場。已經開始的也進得去——遲到的人照樣要能玩，
-- 一節課只有四十分鐘，卡在門外沒有任何好處。
-- 不指定哪一場就進老師那場（沒有的話進最新的一場），選關畫面那顆按鈕就是這樣用的。
create or replace function public.join_room(p_room uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := public.current_student_id();
        v_code    text := public.current_class_code();
        v_room    uuid;
begin
  if v_student is null then raise exception '請先登入'; end if;
  if v_code is null then raise exception '還沒加入班級'; end if;

  if p_room is not null then
    select r.id into v_room from public.rooms r
     where r.id = p_room and r.class_code = v_code and r.status <> 'done';
  else
    select r.id into v_room from public.rooms r
     where r.class_code = v_code and r.status <> 'done'
     order by (r.host_student is null) desc, r.created_at desc limit 1;
  end if;
  if v_room is null then raise exception '這一場已經結束了'; end if;

  -- 同時只在一場裡。不退掉舊的話，他會同時出現在兩份名單上，
  -- 開場的人會一直等一個其實在別場的人。
  delete from public.room_members m
   where m.student_id = v_student and m.room_id <> v_room
     and exists (select 1 from public.rooms r where r.id = m.room_id and r.status <> 'done');

  insert into public.room_members as m (room_id, student_id)
       values (v_room, v_student)
    on conflict (room_id, student_id) do update set seen_at = now();
  return v_room;
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
     where r.class_code = v_code and r.status <> 'done'), '[]'::jsonb);
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
    'mode',      v_room.mode,
    'status',    v_room.status,
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
  public.consume_item(text),
  public.level_of(int),
  public.class_leaderboard(text),
  public.current_student_id(),
  public.current_class_code(),
  public.rebuild_word_stats(uuid),
  public.join_room(uuid),
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
