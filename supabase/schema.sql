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

-- -----------------------------------------------------------------------------
-- 2. 老師與班級
--    老師是真的 Supabase 帳號（email 登入）。學生不是。
-- -----------------------------------------------------------------------------

create table if not exists public.teachers (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '老師',
  created_at   timestamptz not null default now()
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
--    id 用 uuid，不要用「班級代碼:暱稱」當主鍵——那樣暱稱永遠改不了。
--    暱稱在班內唯一，就是那個人。
-- -----------------------------------------------------------------------------

create table if not exists public.students (
  id         uuid primary key default gen_random_uuid(),
  class_code text not null references public.classes(code) on delete cascade,
  nickname   text not null check (length(btrim(nickname)) between 1 and 16),
  -- 可選的四位數密碼。null＝沒設，任何人打這個暱稱都能接手這個存檔。
  -- 預設不設，因為 Chuck 要的是「班級代碼＋暱稱」就能進。
  -- 要防同學互相亂用的時候，把 join_class 的 p_pin 接起來就好，資料表不用再改。
  pin_hash   text,
  created_at timestamptz not null default now(),
  unique (class_code, nickname)
);
create index if not exists students_class on public.students(class_code);

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
alter table public.answer_events  enable row level security;
alter table public.word_stats     enable row level security;
alter table public.level_progress enable row level security;
alter table public.teacher_open   enable row level security;

-- 沒寫 policy 的動作一律擋掉。寫入全部走 RPC，所以這裡只開讀。
revoke all on all tables in schema public from anon, authenticated;
grant select on public.words, public.levels to anon, authenticated;
grant select on public.classes, public.students, public.characters,
                public.answer_events, public.word_stats,
                public.level_progress, public.teacher_open, public.student_links
  to authenticated;

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

create or replace function public.is_teacher_of(p_code text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.classes c where c.code = p_code and c.owner = auth.uid()
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

drop policy if exists teachers_self on public.teachers;
create policy teachers_self on public.teachers for select to authenticated
  using (user_id = auth.uid());

-- 學生看得到自己那一班（要顯示班名），老師看得到自己開的班
drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes for select to authenticated
  using (owner = auth.uid() or code = public.current_class_code());

-- 同班同學互相看得到暱稱，排行榜要用。這裡本來就沒有真實姓名。
drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated
  using (class_code = public.current_class_code() or public.is_teacher_of(class_code));

drop policy if exists student_links_self on public.student_links;
create policy student_links_self on public.student_links for select to authenticated
  using (user_id = auth.uid());

-- 角色存檔只有自己跟老師看得到。排行榜走底下的 class_leaderboard()，
-- 不讓同學直接翻彼此的背包。
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
-- 進場：班級代碼＋暱稱。沒有這個暱稱就開一個新的存檔。
-- p_pin 現在前端都傳 null。之後要防同學互相亂用，前端加一個四位數欄位就好。
-- -----------------------------------------------------------------------------
create or replace function public.join_class(
  p_code     text,
  p_nickname text,
  p_pin      text default null
)
returns table (student_id uuid, class_code text, nickname text)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
-- returns table 的欄位名會變成 PL/pgSQL 變數，跟資料表欄位撞名時 Postgres 會直接拒絕。
-- 這一行叫它撞名時一律當作欄位（回傳值都是用 return query 給的，不靠變數名）。
#variable_conflict use_column
declare
  v_code  text := upper(btrim(p_code));
  v_nick  text := btrim(p_nickname);
  v_open  boolean;
  v_id    uuid;
  v_hash  text;
begin
  if auth.uid() is null then
    raise exception '請先登入（學生用匿名登入）';
  end if;
  if v_nick = '' or length(v_nick) > 16 then
    raise exception '暱稱要 1 到 16 個字';
  end if;

  select c.open into v_open from public.classes c where c.code = v_code;
  if v_open is null then
    raise exception '找不到班級代碼 %', v_code;
  end if;

  select s.id, s.pin_hash into v_id, v_hash
    from public.students s
   where s.class_code = v_code and s.nickname = v_nick;

  if v_id is null then
    if not v_open then
      raise exception '這一班已經關閉，不能再加入新同學';
    end if;
    insert into public.students (class_code, nickname, pin_hash)
    values (v_code, v_nick,
            case when p_pin is null then null
                 else extensions.crypt(p_pin, extensions.gen_salt('bf')) end)
    returning id into v_id;
    insert into public.characters (student_id) values (v_id)
      on conflict (student_id) do nothing;
  elsif v_hash is not null then
    if p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
      raise exception '密碼不對';
    end if;
  end if;

  -- 這台裝置從現在起是這個學生
  insert into public.student_links (user_id, student_id)
  values (auth.uid(), v_id)
  on conflict (user_id) do update set student_id = excluded.student_id, linked_at = now();

  return query select v_id, v_code, v_nick;
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
      (student_id, word_id, skill, correct, ms, combo, game_id, level_id)
    values
      (v_student, v_word, v_skill, v_ok, v_ms, v_combo,
       coalesce(e ->> 'gameId', 'unknown'), nullif(e ->> 'levelId', ''));

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
-- 存關卡進度。首次通關的獎勵在這裡發，關卡是第幾關由資料庫自己查，
-- 不能讓前端說「我剛通關第 14 關」就領大獎。
--
-- 已知限制：p_stars 與 p_win 還是前端說了算。要真的擋住得由伺服器重跑一場，
-- 這版不做。所以這裡至少要求「最近一小時在這一關真的答對過 10 題」才給獎金，
-- 把最好按的那個洞先堵起來。
-- -----------------------------------------------------------------------------
create or replace function public.save_progress(
  p_level_id     text,
  p_stars        int,
  p_best_correct int,
  p_win          boolean
)
returns table (stars int, best_correct int, cleared_at timestamptz, bonus_coins int)
language plpgsql security definer set search_path = public, pg_temp as $$
-- returns table 的欄位名會變成 PL/pgSQL 變數，跟資料表欄位撞名時 Postgres 會直接拒絕。
-- 這一行叫它撞名時一律當作欄位（回傳值都是用 return query 給的，不靠變數名）。
#variable_conflict use_column
declare
  v_student uuid := public.current_student_id();
  v_no      int;
  v_was     timestamptz;
  v_recent  int;
  v_bonus   int := 0;
  v_stars   int := least(greatest(coalesce(p_stars, 0), 0), 3);
  v_best    int := greatest(coalesce(p_best_correct, 0), 0);
begin
  if v_student is null then raise exception '還沒加入班級'; end if;

  select l.no into v_no from public.levels l where l.id = p_level_id;
  if v_no is null then raise exception '沒有這一關：%', p_level_id; end if;

  select lp.cleared_at into v_was
    from public.level_progress lp
   where lp.student_id = v_student and lp.level_id = p_level_id;

  if p_win and v_was is null then
    select count(*) into v_recent
      from public.answer_events ae
     where ae.student_id = v_student
       and ae.level_id = p_level_id
       and ae.correct
       and ae.at > now() - interval '1 hour';
    if v_recent >= 10 then
      v_bonus := 40 + v_no * 10;
    end if;
  end if;

  insert into public.level_progress as lp
    (student_id, level_id, stars, best_correct, cleared_at)
  values
    (v_student, p_level_id, v_stars, v_best,
     case when p_win then now() else null end)
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
    select lp.stars::int, lp.best_correct, lp.cleared_at, v_bonus
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

-- 同班排行榜。只給暱稱與分數，不給背包內容。
create or replace function public.class_leaderboard(p_code text default null)
returns table (nickname text, coins int, exp int, stars int)
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (
    select coalesce(upper(btrim(p_code)), public.current_class_code()) as code
  )
  select s.nickname, c.coins, c.exp,
         coalesce((select sum(lp.stars)::int from public.level_progress lp
                    where lp.student_id = s.id), 0)
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
  if not public.is_real_account() then
    raise exception '老師要用 email 登入，匿名帳號不能開班';
  end if;
  if v_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception '班級代碼只能用英文字母和數字，3 到 12 個字';
  end if;
  if exists (select 1 from public.classes c where c.code = v_code and c.owner <> auth.uid()) then
    raise exception '這個班級代碼已經有人用了';
  end if;

  insert into public.teachers (user_id) values (auth.uid()) on conflict do nothing;
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
create or replace function public.teacher_add_student(p_code text, p_nickname text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(btrim(p_code));
  v_nick text := btrim(p_nickname);
  v_id   uuid;
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  if v_nick = '' or length(v_nick) > 16 then raise exception '暱稱要 1 到 16 個字'; end if;

  insert into public.students (class_code, nickname) values (v_code, v_nick)
    on conflict (class_code, nickname) do update set nickname = excluded.nickname
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
create or replace function public.teacher_reset_pin(p_student uuid, p_pin text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_code text;
begin
  select s.class_code into v_code from public.students s where s.id = p_student;
  if v_code is null or not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  update public.students
     set pin_hash = case when p_pin is null then null
                         else extensions.crypt(p_pin, extensions.gen_salt('bf')) end
   where id = p_student;
end;
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

grant execute on function
  public.join_class(text, text, text),
  public.submit_answers(jsonb),
  public.save_progress(text, int, int, boolean),
  public.set_job(text),
  public.class_leaderboard(text),
  public.current_student_id(),
  public.current_class_code(),
  public.rebuild_word_stats(uuid)
to authenticated;

grant execute on function
  public.create_class(text, text),
  public.teacher_set_open(text, text[]),
  public.teacher_add_student(text, text),
  public.teacher_remove_student(uuid),
  public.teacher_reset_pin(uuid, text),
  public.class_most_missed(text, int),
  public.class_overview(text),
  public.is_teacher_of(text)
to authenticated;
