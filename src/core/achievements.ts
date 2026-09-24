import type { AnswerEvent, Character, LevelProgress, Skill, WordStatEntry } from './types'
import { LEVELS } from '@/data/levels'
import { WORDS, WORDS_BY_ID } from '@/data/words'
import { ACH_BY_ID, ALL } from '@/data/achievements'

/**
 * 成就判定。
 *
 * **這一份不是真相。** 真正算數的是 supabase/schema.sql 的 refresh_achievements()，
 * 因為徽章會出現在別人看得到的個人檔案上，看得到就值得作弊，所以只能由伺服器算。
 * 這裡這一份是給**沒有金鑰的本地版**（src/net/local.ts）用的鏡像，讓離線開發和
 * 測試也看得到徽章牆。兩邊的條件一致由 tools/test/achievements.mjs 盯著。
 *
 * 條件的文字說明在 src/data/achievements.ts，那邊才是給人看的。
 */

/** 判定要看的全部東西。本地版把它們從 localStorage 撈出來餵進來。 */
export interface AchInput {
  events: AnswerEvent[]
  stats: WordStatEntry[]
  progress: LevelProgress[]
  character: Character
  matches: VersusRecord[]
  /** 用過的道具：哪一場用了什麼 */
  itemUses: { itemId: string; sessionId: string | null }[]
  /** 註冊時間，epoch 毫秒 */
  createdAt: number
  /** 現在時間，測試要可以指定 */
  now?: number
}

/** 一場兵推的結果。欄位跟 supabase 的 versus_matches 一樣。 */
export interface VersusRecord {
  sessionId: string | null
  opponentKind: 'cpu' | 'student'
  opponentName: string
  won: boolean
  /** 前線最後推到哪，0＝自己城牆、1＝對方城牆 */
  front: number
  /** 整場最落後的時候 */
  lowestFront: number
  linesUsed: Skill[]
  topTier: number
  endedAt: number
}

/** 「熟」＝這個字這個能力連對三次。用掌握度不用答對次數，不然刷簡單的字也會過。 */
const MASTER_STREAK = 3

/** 台灣時間的「哪一天」。伺服器是 UTC，不轉的話早上八點前玩的會算成前一天。 */
function dayKey(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10)
}
/** 台灣時間的星期幾，1＝一 … 7＝日 */
function isoDow(ms: number): number {
  const d = new Date(ms + 8 * 3600_000).getUTCDay()
  return d === 0 ? 7 : d
}
/** 那一天屬於哪一週（用週一當週的開頭） */
function weekKey(ms: number): string {
  const shifted = ms + 8 * 3600_000
  const d = new Date(shifted)
  d.setUTCDate(d.getUTCDate() - (isoDow(ms) - 1))
  return d.toISOString().slice(0, 10)
}

/** 同一個字、同一個技能、同一天最多算幾次答對。擋狂刷一個簡單的字。 */
export const DAILY_CAP = 5

/** 分階徽章現在的數字。`all` 是「全部」那一階照目前題庫是多少。 */
export interface AchValue { value: number; all: number }

export interface AchEval {
  /** 一次性徽章裡拿得到的 id */
  got: string[]
  /** 分階徽章的數字，階級由 tierOf() 換算 */
  values: Record<string, AchValue>
}

/** 這個數字到第幾階。跟 SQL 的 ach_put 同一套：依序數到第一個沒達到的為止。 */
export function tierOf(id: string, v: AchValue): number {
  const tiers = ACH_BY_ID.get(id)?.tiers ?? []
  let n = 0
  for (const t of tiers) {
    const goal = t === ALL ? Math.max(v.all, 1) : t
    if (v.value < goal) break
    n += 1
  }
  return n
}

/** 這一份輸入現在拿得到哪些成就。 */
export function evaluateAchievements(input: AchInput): AchEval {
  const { events, stats, progress, character: c, matches, itemUses } = input
  const now = input.now ?? Date.now()
  const got: string[] = []
  const values: Record<string, AchValue> = {}
  const win = (id: string, ok: boolean) => { if (ok) got.push(id) }
  const put = (id: string, value: number, all = 0) => { values[id] = { value, all } }

  const ok = events.filter((e) => e.correct)
  // 有效答對：同一個字、同一個技能、同一天最多 DAILY_CAP 次
  const capKey = new Map<string, number>()
  const okCapped = ok.filter((e) => {
    const key = e.wordId + '|' + e.skill + '|' + dayKey(e.at)
    const n = (capKey.get(key) ?? 0) + 1
    capKey.set(key, n)
    return n <= DAILY_CAP
  })
  const okBySkill = (s: Skill) => okCapped.filter((e) => e.skill === s).length
  const mastered = stats.filter((s) => s.streak >= MASTER_STREAK)
  const cleared = progress.filter((p) => p.clearedAt)
  const clearedIds = new Set(cleared.map((p) => p.levelId))

  // ---------------------------------------------------------------- 學習
  win('first-answer', ok.length >= 1)
  put('hundred', okCapped.length)
  put('nemesis', new Set(stats.filter((s) => s.wrong >= 3 && s.streak >= MASTER_STREAK)
    .map((s) => s.wordId)).size)

  const okWords = new Set(ok.map((e) => e.wordId))
  const themes = new Map<string, { all: number; done: number }>()
  for (const w of WORDS) {
    if (!w.theme) continue
    const t = themes.get(w.theme) ?? { all: 0, done: 0 }
    t.all += 1
    if (okWords.has(w.id)) t.done += 1
    themes.set(w.theme, t)
  }
  put('theme-king', [...themes.values()].filter((t) => t.all > 0 && t.all === t.done).length,
    themes.size)
  const spellable = WORDS.filter((w) => w.spell).length
  put('mastered-50', mastered.length, 2 * WORDS.length + spellable)
  put('literate', okWords.size, WORDS.length)

  // ---------------------------------------------------------------- 技能
  put('read-100', okBySkill('recognize'))
  put('listen-100', okBySkill('listen'))
  put('spell-100', okBySkill('spell'))

  const skillsPerDay = new Map<string, Set<Skill>>()
  for (const e of events) {
    const key = dayKey(e.at)
    const set = skillsPerDay.get(key) ?? new Set<Skill>()
    set.add(e.skill)
    skillsPerDay.set(key, set)
  }
  put('triple-day', [...skillsPerDay.values()].filter((s) => s.size >= 3).length)

  const longSpell = okCapped.filter(
    (e) => e.skill === 'spell' && (WORDS_BY_ID.get(e.wordId)?.word.length ?? 0) >= 8).length
  put('long-words', longSpell)

  const perSkillMastered = (s: Skill) => mastered.filter((m) => m.skill === s).length
  put('balanced', Math.min(...(['recognize', 'spell', 'listen'] as Skill[]).map(perSkillMastered)),
    Math.min(WORDS.length, spellable))
  put('combo', Math.max(0, ...ok.map((e) => e.combo)))

  // ---------------------------------------------------------------- 守塔
  win('first-clear', cleared.length >= 1)
  put('three-star', progress.filter((p) => p.stars >= 3).length, LEVELS.length)
  put('no-damage', cleared.filter((p) => (p.bestSurvival ?? 0) >= 1).length, LEVELS.length)
  const bosses = LEVELS.filter((l) => l.isBoss)
  win('boss-slayer', bosses.length > 0 && bosses.every((l) => clearedIds.has(l.id)))
  put('stars-30', progress.reduce((n, p) => n + p.stars, 0), LEVELS.length * 3)
  win('all-clear', LEVELS.every((l) => clearedIds.has(l.id)))

  // ---------------------------------------------------------------- 對戰
  const byTime = [...matches].sort((a, b) => a.endedAt - b.endedAt)
  win('first-match', byTime.length >= 1)
  put('veteran', byTime.length)
  win('all-lines', byTime.some((m) => new Set(m.linesUsed).size >= 3))
  put('top-tier', byTime.filter((m) => m.topTier >= 3).length)
  put('comeback', byTime.filter((m) => m.won && m.lowestFront <= 0.35).length)
  // 連輸兩場之後又開了一場。輸的人也拿得到的那一個。
  win('never-quit', byTime.some((_, i) =>
    i >= 2 && !byTime[i - 1].won && !byTime[i - 2].won))
  // 勝場只認同學，贏電腦不算——不然打最弱的電腦就能刷。
  put('war-flag', byTime.filter((m) => m.won && m.opponentKind === 'student').length)

  // ---------------------------------------------------------------- 收集
  const has = (id: string) => (c.items[id] ?? 0) > 0
  win('dressed', c.equipped.some((e) => e.startsWith('frame-')))
  win('five-colors', ['color-red', 'color-yellow', 'color-purple', 'color-black'].every(has))
  win('all-frames', ['frame-gold', 'frame-ribbon', 'frame-crown', 'frame-rainbow'].every(has))
  win('avatar-10', new Set(c.avatarsSeen ?? []).size >= 10)
  win('dual-job', ['knight', 'mage'].every((j) => (c.jobsCleared ?? []).includes(j)))
  win('item-taster', new Set(itemUses.map((u) => u.itemId)).size >= 3)

  // ---------------------------------------------------------------- 習慣
  const daysPerWeek = new Map<string, Set<string>>()
  const daysPerMonth = new Map<string, Set<string>>()
  for (const e of events) {
    const d = dayKey(e.at)
    const w = weekKey(e.at)
    const m = d.slice(0, 7)
    ;(daysPerWeek.get(w) ?? daysPerWeek.set(w, new Set()).get(w)!).add(d)
    ;(daysPerMonth.get(m) ?? daysPerMonth.set(m, new Set()).get(m)!).add(d)
  }
  const bestWeek = Math.max(0, ...[...daysPerWeek.values()].map((s) => s.size))
  // 用「那一週來了幾天」不用「連續幾天」：斷一天不歸零，
  // 不然請假或沒平板的小孩等於被懲罰。
  win('week-3', bestWeek >= 3)
  win('week-5', bestWeek >= 5)
  put('days', new Set(events.map((e) => dayKey(e.at))).size)
  put('weekend', new Set(events.filter((e) => isoDow(e.at) >= 6).map((e) => dayKey(e.at))).size)
  win('month-12', Math.max(0, ...[...daysPerMonth.values()].map((s) => s.size)) >= 12)

  const clearedAtOf = new Map(cleared.map((p) => [p.levelId, p.clearedAt ?? 0]))
  win('replay', events.some((e) => {
    const at = e.levelId ? clearedAtOf.get(e.levelId) : undefined
    return at !== undefined && e.at > at + 60_000
  }))
  win('old-friend', input.createdAt > 0
    && now - input.createdAt >= 30 * 86400_000
    && events.some((e) => now - e.at <= 7 * 86400_000))

  // ---------------------------------------------------------------- 彩蛋
  win('persistent', stats.some((s) => s.wrong >= 5 && s.streak >= 1))

  const inOrder = [...events].sort((a, b) => a.at - b.at)
  win('quick-hand', inOrder.some((e, i) => {
    if (i < 4) return false
    const five = inOrder.slice(i - 4, i + 1)
    return five.every((x) => x.correct) && e.at - five[0].at <= 10_000
  }))

  // 安慰獎：魔王關答對八成還是沒守住。拿到就不會收回（存起來的東西不會被刪）。
  const bossIds = new Set(bosses.map((l) => l.id))
  const perSession = new Map<string, { levelId: string; ok: number; n: number }>()
  for (const e of events) {
    if (!e.levelId || !bossIds.has(e.levelId)) continue
    const key = e.sessionId + '|' + e.levelId
    const row = perSession.get(key) ?? { levelId: e.levelId, ok: 0, n: 0 }
    row.n += 1
    if (e.correct) row.ok += 1
    perSession.set(key, row)
  }
  win('so-close', [...perSession.values()].some(
    (s) => s.n >= 10 && s.ok / s.n >= 0.8 && !clearedIds.has(s.levelId)))

  const usedSessions = new Set(itemUses.map((u) => u.sessionId ?? ''))
  win('bare-handed', cleared.some(
    (p) => p.lastWinSession && !usedSessions.has(p.lastWinSession)))
  win('combo-20', ok.some((e) => e.combo >= 20))

  return { got, values }
}
