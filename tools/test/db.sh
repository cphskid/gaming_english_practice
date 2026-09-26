#!/usr/bin/env bash
# 在本機開一個空的 Postgres，把 schema.sql 與 seed.sql 跑一遍，再跑權限測試與金幣對帳。
#
# 為什麼要這一步：這份 SQL 最後是 Chuck 貼進 Supabase 後台執行的，貼錯一次要重來，
# 而 RLS 這種東西沒有真的用不同身分打過就是不知道對不對。
#
#   ./tools/test/db.sh
#
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGROOT=${PGROOT:-/tmp/pg}
SOCK="$PGROOT/sock"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "找不到 Postgres（$PGBIN）。裝一個：apt-get install -y postgresql-16" >&2
  exit 1
fi

# initdb 不准用 root 跑，所以借一個非 root 的使用者
RUNAS=${RUNAS:-claude}
as_pg() { if [ "$(id -u)" = 0 ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $1"; else PATH=$PGBIN:$PATH sh -c "$1"; fi; }

"$PGBIN/pg_ctl" -D "$PGROOT/data" stop >/dev/null 2>&1 || true
rm -rf "$PGROOT"
mkdir -p "$PGROOT/data" "$SOCK"
[ "$(id -u)" = 0 ] && chown -R "$RUNAS":"$RUNAS" "$PGROOT"

as_pg "initdb -D $PGROOT/data -U postgres --auth=trust" >/dev/null
as_pg "pg_ctl -D $PGROOT/data -o '-k $SOCK -c listen_addresses= -c log_min_messages=warning' -l $PGROOT/log start" >/dev/null
trap 'as_pg "pg_ctl -D $PGROOT/data stop" >/dev/null 2>&1 || true' EXIT

run() { "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "── 假一套 Supabase 的 auth schema 出來"
run -f "$ROOT/supabase/test/00_supabase_stub.sql"

echo "── schema.sql"
run -f "$ROOT/supabase/schema.sql" 2>&1 | grep -v NOTICE || true

echo "── seed.sql"
run -f "$ROOT/supabase/seed.sql"

echo "── 再跑一次，確認可以重複執行"
run -f "$ROOT/supabase/schema.sql" >/dev/null 2>&1
run -f "$ROOT/supabase/seed.sql" >/dev/null

echo
echo "── 權限測試"
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -f "$ROOT/supabase/test/01_rls_test.sql" 2>&1 \
  | grep -E "✓|✗|ERROR|──|全部通過" | sed 's/^psql:[^ ]* NOTICE:  //'

echo
echo "── 成就"
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -f "$ROOT/supabase/test/02_achievements_test.sql" 2>&1 \
  | grep -E "✓|✗|ERROR|──|全部通過" | sed 's/^psql:[^ ]* NOTICE:  //'

echo
echo "── 本週之星"
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -f "$ROOT/supabase/test/03_weekly_stars_test.sql" 2>&1 \
  | grep -E "✓|✗|ERROR|──|全部通過" | sed 's/^psql:[^ ]* NOTICE:  //'

echo
echo "── 舊頭像搬家（Tiny Swords 的 Avatars_XX → 職業送的第一張）"
# 做兩個戴舊頭像的角色（騎士、法師各一），再跑一次 schema.sql 就該被搬走
run -c "insert into public.students (id, login_id, pw_hash, nickname) values
  ('c1000000-0000-0000-0000-000000000001', 'old_av_one', 'x', '舊頭像騎士'),
  ('c1000000-0000-0000-0000-000000000002', 'old_av_two', 'x', '舊頭像法師') on conflict do nothing"
run -c "insert into public.characters (student_id, job, avatar) values
  ('c1000000-0000-0000-0000-000000000001', 'knight', 'Avatars_12'),
  ('c1000000-0000-0000-0000-000000000002', 'mage', 'Avatars_03') on conflict (student_id) do update set avatar = excluded.avatar"
before=$(run -tA -c "select count(*) from public.characters where avatar like 'Avatars\_%'")
run -f "$ROOT/supabase/schema.sql" >/dev/null 2>&1
after=$(run -tA -c "select count(*) from public.characters where avatar like 'Avatars\_%'")
bad=$(run -tA -c "select count(*) from public.characters where avatar <> '' and avatar not like 'av-%'")
moved=$(run -tA -c "select string_agg(avatar, ',' order by student_id) from public.characters where student_id::text like 'c1000000%'")
[ "$moved" = "av-warrior-m,av-magician-m" ] || bad="$bad（搬成 $moved）"
if [ "$before" -gt 0 ] && [ "$after" = 0 ] && [ "$bad" = 0 ]; then
  echo "  ✓ $before 個舊頭像都搬走了"
else
  echo "  ✗ 舊頭像沒搬乾淨（搬之前 $before、之後 $after、其他怪值 $bad）"; exit 1
fi

echo
echo "── 金幣算式對帳（前端 economy.ts vs 後端 coin_value）"
cd "$ROOT" && PGSOCK="$SOCK" PSQL="$PGBIN/psql" node tools/test/economy-parity.mjs
