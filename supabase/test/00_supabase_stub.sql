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

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);
grant select on auth.users to anon, authenticated;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb);
$$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
