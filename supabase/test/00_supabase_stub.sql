-- 只給本機測試用，**不要**貼進 Supabase 後台。
--
-- Supabase 的專案本來就有 auth schema、anon / authenticated 這兩個角色、
-- 以及 extensions schema。本機的空 Postgres 沒有，所以先用這份假一套出來，
-- schema.sql 就能一個字都不改地在本機跑，測出來的才算數。
--
-- auth.uid() 與 auth.jwt() 在這裡讀 session 變數，測試時用
--   set local "test.uid" = '...';  set local "test.jwt" = '{"is_anonymous":true}';
-- 來扮演不同的人。

create schema if not exists extensions;
create schema if not exists auth;

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public, extensions, auth to anon, authenticated;

-- 欄位照真的 Supabase 抄，因為 admin_create_teacher 是**自己手寫 auth.users**
-- （老師帳號由管理員直接開，不寄確認信）。欄位少一個，本機就測不到寫錯什麼。
-- confirmed_at 在真的 Supabase 是自動算出來的欄位，這裡照做，寫它就會報錯。
create table if not exists auth.users (
  instance_id                uuid,
  id                         uuid primary key default gen_random_uuid(),
  aud                        varchar(255),
  role                       varchar(255),
  email                      varchar(255),
  encrypted_password         varchar(255),
  email_confirmed_at         timestamptz,
  confirmation_token         varchar(255),
  recovery_token             varchar(255),
  email_change_token_new     varchar(255),
  email_change               varchar(255),
  email_change_token_current varchar(255) default '',
  phone_change               text default '',
  phone_change_token         varchar(255) default '',
  reauthentication_token     varchar(255) default '',
  raw_app_meta_data          jsonb,
  raw_user_meta_data         jsonb,
  created_at                 timestamptz,
  updated_at                 timestamptz,
  confirmed_at               timestamptz generated always as (email_confirmed_at) stored,
  is_sso_user                boolean not null default false,
  is_anonymous               boolean not null default false
);
create unique index if not exists users_email_uq on auth.users (email);
grant select on auth.users to anon, authenticated;

create table if not exists auth.identities (
  provider_id     text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  id              uuid primary key default gen_random_uuid(),
  unique (provider_id, provider)
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb);
$$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
