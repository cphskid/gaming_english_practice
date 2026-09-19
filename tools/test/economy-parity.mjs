/**
 * 金幣算式對帳：src/core/economy.ts（前端）與 supabase/schema.sql 的 coin_value（後端）
 * 必須算出一模一樣的數字。兩邊都有是因為前端要立刻把數字跳給小朋友看，
 * 後端才是真的算數的那個——一旦漂移，學生會看到跳出 +5 但實際入帳 +3。
 *
 * 跑法（要先有本機 Postgres，見 supabase/test/README.md）：
 *   node tools/test/economy-parity.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOCK = process.env.PGSOCK ?? '/tmp/pg/sock'
const PSQL = process.env.PSQL ?? '/usr/lib/postgresql/16/bin/psql'

const psql = (sql) =>
  execFileSync(PSQL, ['-h', SOCK, '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }).trim()

// economy.ts 只 import 型別，所以可以單獨打包出來直接跑
const tmp = mkdtempSync(join(tmpdir(), 'econ-'))
const out = join(tmp, 'economy.cjs')
await build({
  entryPoints: [join(ROOT, 'src/core/economy.ts')],
  outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'error',
})
const { createRequire } = await import('node:module')
const economy = createRequire(import.meta.url)(out)

const WORDS = JSON.parse(readFileSync(join(ROOT, 'data/core300.json'), 'utf8')).words
const byId = new Map(WORDS.map((w) => [w.id, w]))
const SKILLS = ['recognize', 'spell', 'listen']

// 固定亂數種子，每次跑出同一組資料，壞掉才重現得了
let seed = 20260919
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (a) => a[Math.floor(rnd() * a.length)]

// 刻意讓少數幾個字重複很多次，把「重複遞減」那一段真的踩到
const pool = WORDS.slice(0, 40).map((w) => w.id)
const correctSoFar = new Map()   // `${wordId}:${skill}` -> 已經答對幾次
const events = []
let expectCoins = 0
let expectExp = 0
let combo = 0

for (let i = 0; i < 400; i++) {
  const wordId = rnd() < 0.6 ? pick(pool.slice(0, 6)) : pick(pool)
  const skill = pick(SKILLS)
  const correct = rnd() < 0.75
  const ms = 400 + Math.floor(rnd() * 4000)
  const word = byId.get(wordId)
  const key = `${wordId}:${skill}`
  const times = correctSoFar.get(key) ?? 0
  const report = { wordId, skill, correct, ms, combo }

  expectCoins += economy.coinsFor({ word, report, timesAlreadyCorrect: times })
  expectExp += economy.expFor({ word, report })

  if (correct) { correctSoFar.set(key, times + 1); combo += 1 } else { combo = 0 }
  events.push({ ...report, gameId: 'tower-defense', levelId: 'td-01' })
}

const TEACHER = '11111111-1111-1111-1111-111111111111'
const STUDENT = '22222222-2222-2222-2222-222222222222'
const TEACHER_EMAIL = 'parity-teacher@example.com'
const as = (uid, anon, email = null) =>
  `select set_config('test.uid','${uid}',false), set_config('test.jwt','${JSON.stringify({
    is_anonymous: anon, email,
  })}',false);`

psql(`
  delete from public.students where login_id = 'parityming';
  delete from public.classes where code = 'PARITY';
  delete from public.teachers where user_id in ('${TEACHER}','${STUDENT}');
  delete from public.teacher_invites where email = '${TEACHER_EMAIL}';
  delete from auth.users where id in ('${TEACHER}','${STUDENT}');
  insert into auth.users (id, email) values ('${TEACHER}', '${TEACHER_EMAIL}');
  insert into auth.users (id) values ('${STUDENT}');
`)
// 開班要先是老師。這支在對帳金幣，不是在測權限（那個是 01_rls_test.sql 的事），
// 所以直接用 postgres 的身分把老師那一列塞進去，不繞邀請流程。
psql(`insert into public.teachers (user_id, display_name) values ('${TEACHER}','對帳老師')
        on conflict (user_id) do update set active = true;`)
psql(`${as(TEACHER, false, TEACHER_EMAIL)} select public.create_class('PARITY','對帳班');`)
psql(`${as(STUDENT, true)} select public.register_student('parityming','apple99','對帳小明','PARITY');`)

// 一次最多 500 題，這裡 400 題一次送完
const file = join(tmp, 'events.json')
writeFileSync(file, JSON.stringify(events))
const payload = readFileSync(file, 'utf8').replace(/'/g, "''")
const row = psql(`set role authenticated; ${as(STUDENT, true)}
  select coins || '|' || exp from public.submit_answers('${payload}'::jsonb);`)
const [coins, exp] = row.split('\n').pop().split('|').map(Number)

// 資料庫是從 120 起跳的
const gotCoins = coins - 120
const ok = gotCoins === expectCoins && exp === expectExp
console.log(`題數 ${events.length}`)
console.log(`金幣  前端 ${expectCoins}  後端 ${gotCoins}  ${gotCoins === expectCoins ? '✓' : '✗'}`)
console.log(`經驗  前端 ${expectExp}  後端 ${exp}  ${exp === expectExp ? '✓' : '✗'}`)
if (!ok) { console.error('前後端算式漂移了'); process.exit(1) }
console.log('兩邊一致')
