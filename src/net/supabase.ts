import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AnswerEvent, Character, Job, LevelProgress, Skill, Student, WordStatEntry,
} from '@/core/types'
import type { Repository } from './repository'

/**
 * Supabase 版。
 *
 * 跟本地版最大的差別是**誰說了算**：
 * 本地版相信客戶端，因為客戶端就是全世界；接了後端之後前端那把金鑰是公開的，
 * 所以金幣、經驗、首次通關獎勵全部由資料庫算，這裡只是把事件送過去。
 * 資料表與權限規則在 supabase/schema.sql，改之前先跑 ./tools/test/db.sh。
 *
 * 學生用匿名登入。匿名帳號是「這台裝置」，不是「這個人」——
 * 是誰由班級代碼＋暱稱決定，所以換一台平板還是同一個存檔。
 */

/** 資料庫回來的一列，欄位名是 snake_case */
interface CharacterRow {
  job: Job; exp: number; coins: number
  items: Record<string, number> | null
  equipped: string[] | null
}
interface ProgressRow {
  level_id: string; stars: number; best_correct: number; cleared_at: string | null
}
interface EventRow {
  student_id: string; word_id: number; skill: Skill; correct: boolean
  ms: number; combo: number; game_id: string; level_id: string | null; at: string
}
interface StatRow {
  word_id: number; skill: Skill; seen: number; correct: number; wrong: number
  streak: number; last_at: string | null; avg_ms: number
}

/** 一次送太多會被資料庫擋掉（schema.sql 裡限 500），所以自己先切 */
const BATCH = 400

/** 老師報表一次撈多少。一個班一學期大概這個量級，超過就要改用資料庫的統計函式。 */
const CLASS_EVENT_LIMIT = 50_000

function fail(where: string, error: { message: string } | null): void {
  if (error) throw new Error(`${where}：${error.message}`)
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : 0)

export class SupabaseRepository implements Repository {
  private readonly db: SupabaseClient

  constructor(url: string, publishableKey: string) {
    this.db = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }

  /** 學生進場一定要先有一個（匿名）身分，資料庫才知道是誰在打 */
  private async ensureSession(): Promise<void> {
    const { data } = await this.db.auth.getSession()
    if (data.session) return
    const { error } = await this.db.auth.signInAnonymously()
    // 這一步失敗多半是 Supabase 後台沒把 Anonymous sign-ins 打開
    fail('匿名登入失敗（後台的 Anonymous sign-ins 打開了嗎）', error)
  }

  async join(classCode: string, nickname: string): Promise<Student> {
    await this.ensureSession()
    const { data, error } = await this.db.rpc('join_class', {
      p_code: classCode.trim().toUpperCase(),
      p_nickname: nickname.trim(),
      // 暱稱密碼先不開，見 supabase/README.md
      p_pin: null,
    })
    fail('進場失敗', error)
    const row = (data as { student_id: string; class_code: string; nickname: string }[] | null)?.[0]
    if (!row) throw new Error('進場失敗：伺服器沒有回傳學生資料')
    return { id: row.student_id, classCode: row.class_code, nickname: row.nickname, role: 'student' }
  }

  async loadCharacter(studentId: string): Promise<Character> {
    const { data, error } = await this.db
      .from('characters')
      .select('job, exp, coins, items, equipped')
      .eq('student_id', studentId)
      .maybeSingle()
    fail('讀取角色失敗', error)
    const row = data as CharacterRow | null
    // join_class 會順便開好角色，所以正常不會是 null
    if (!row) throw new Error('讀取角色失敗：找不到這個學生的存檔')
    return {
      studentId,
      job: row.job,
      exp: row.exp,
      coins: row.coins,
      items: row.items ?? {},
      equipped: row.equipped ?? [],
    }
  }

  /**
   * 只有職業存得回去。
   *
   * 金幣與經驗故意沒有寫入路徑——資料表沒給 update 權限，就算這裡想寫也寫不進去。
   * 它們是 appendEvents 與 saveProgress 的副作用，由資料庫自己算。
   * 道具要等商店做好，會是另一支 RPC（買的時候扣錢，不是前端說我有什麼就有什麼）。
   */
  async saveCharacter(c: Character): Promise<void> {
    const { error } = await this.db.rpc('set_job', { p_job: c.job })
    fail('存角色失敗', error)
  }

  async loadProgress(studentId: string): Promise<LevelProgress[]> {
    const { data, error } = await this.db
      .from('level_progress')
      .select('level_id, stars, best_correct, cleared_at')
      .eq('student_id', studentId)
    fail('讀取關卡進度失敗', error)
    return ((data as ProgressRow[] | null) ?? []).map((r) => ({
      levelId: r.level_id,
      stars: r.stars as 0 | 1 | 2 | 3,
      bestCorrect: r.best_correct,
      clearedAt: r.cleared_at ? ms(r.cleared_at) : null,
    }))
  }

  /** 首次通關獎勵在資料庫那邊發，這裡送的星星與通關與否只是回報 */
  async saveProgress(_studentId: string, p: LevelProgress): Promise<void> {
    const { error } = await this.db.rpc('save_progress', {
      p_level_id: p.levelId,
      p_stars: p.stars,
      p_best_correct: p.bestCorrect,
      p_win: p.clearedAt !== null,
    })
    fail('存關卡進度失敗', error)
  }

  /**
   * 唯一會讓金幣變多的入口。
   * 送過去的 studentId 與 at 都會被忽略——是誰由 session 決定，時間由伺服器蓋。
   */
  async appendEvents(events: AnswerEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += BATCH) {
      const chunk = events.slice(i, i + BATCH).map((e) => ({
        wordId: e.wordId,
        skill: e.skill,
        correct: e.correct,
        ms: e.ms,
        combo: e.combo,
        gameId: e.gameId,
        levelId: e.levelId,
      }))
      const { error } = await this.db.rpc('submit_answers', { p_events: chunk })
      fail('回報答題失敗', error)
    }
  }

  async loadEvents(studentId: string): Promise<AnswerEvent[]> {
    const { data, error } = await this.db
      .from('answer_events')
      .select('student_id, word_id, skill, correct, ms, combo, game_id, level_id, at')
      .eq('student_id', studentId)
      .order('at', { ascending: true })
      .limit(CLASS_EVENT_LIMIT)
    fail('讀取答題紀錄失敗', error)
    return ((data as EventRow[] | null) ?? []).map(toEvent)
  }

  async loadWordStats(studentId: string): Promise<WordStatEntry[]> {
    const { data, error } = await this.db
      .from('word_stats')
      .select('word_id, skill, seen, correct, wrong, streak, last_at, avg_ms')
      .eq('student_id', studentId)
    fail('讀取掌握度失敗', error)
    return ((data as StatRow[] | null) ?? []).map((r) => ({
      wordId: r.word_id,
      skill: r.skill,
      seen: r.seen,
      correct: r.correct,
      wrong: r.wrong,
      streak: r.streak,
      lastAt: ms(r.last_at),
      avgMs: r.avg_ms,
    }))
  }

  /**
   * 老師報表用。只有這個班的老師撈得到，別人撈回來是空的（權限擋在資料庫）。
   * 報表變重的時候改用 class_most_missed() 與 class_overview()，那兩支是在資料庫裡算完才回來。
   */
  async loadClassEvents(classCode: string): Promise<AnswerEvent[]> {
    const { data, error } = await this.db
      .from('answer_events')
      .select('student_id, word_id, skill, correct, ms, combo, game_id, level_id, at, students!inner(class_code)')
      .eq('students.class_code', classCode.trim().toUpperCase())
      .order('at', { ascending: true })
      .limit(CLASS_EVENT_LIMIT)
    fail('讀取全班紀錄失敗', error)
    return ((data as EventRow[] | null) ?? []).map(toEvent)
  }

  async loadTeacherOpen(classCode: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('teacher_open')
      .select('level_id')
      .eq('class_code', classCode.trim().toUpperCase())
    fail('讀取開放關卡失敗', error)
    return ((data as { level_id: string }[] | null) ?? []).map((r) => r.level_id)
  }

  async setTeacherOpen(classCode: string, levelIds: string[]): Promise<void> {
    const { error } = await this.db.rpc('teacher_set_open', {
      p_code: classCode.trim().toUpperCase(),
      p_level_ids: levelIds,
    })
    fail('設定開放關卡失敗', error)
  }
}

function toEvent(r: EventRow): AnswerEvent {
  return {
    studentId: r.student_id,
    wordId: r.word_id,
    skill: r.skill,
    correct: r.correct,
    ms: r.ms,
    combo: r.combo,
    gameId: r.game_id,
    levelId: r.level_id,
    at: ms(r.at),
  }
}
