import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AnswerEvent, Character, ClassRoom, Job, LevelProgress, Skill, Staff, Student,
  TeacherRow, WordStatEntry,
} from '@/core/types'
import type { ClassRosterRow, Repository } from './repository'

/**
 * Supabase 版。
 *
 * 跟本地版最大的差別是**誰說了算**：
 * 本地版相信客戶端，因為客戶端就是全世界；接了後端之後前端那把金鑰是公開的，
 * 所以金幣、經驗、首次通關獎勵全部由資料庫算，這裡只是把事件送過去。
 * 資料表與權限規則在 supabase/schema.sql，改之前先跑 ./tools/test/db.sh。
 *
 * **學生的匿名帳號是「這台裝置」，不是「這個人」。**
 * 是誰由學生自己註冊的帳號密碼決定（register_student / login_student），
 * 驗過之後資料庫把這台裝置綁到那個學生身上，所以換一台平板還是同一個存檔。
 *
 * 學生刻意不走 Supabase 的 email 註冊：那條路每註冊一個就寄一封確認信，
 * 內建寄信額度小到一整班同時註冊就會被擋（實測連五個就 429）。
 * 老師與管理員人少，就用真的 email 帳號，這樣他們自己救得回密碼。
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

  /** 資料庫回來的學生一列 */
  private static student(row: {
    student_id: string; login_id: string; nickname: string; class_code: string | null
  }): Student {
    return {
      id: row.student_id, loginId: row.login_id,
      nickname: row.nickname, classCode: row.class_code, role: 'student',
    }
  }

  async register(
    loginId: string, password: string, nickname: string, classCode: string,
  ): Promise<Student> {
    await this.ensureSession()
    const { data, error } = await this.db.rpc('register_student', {
      p_login_id: loginId.trim().toLowerCase(),
      p_password: password,
      p_nickname: nickname.trim(),
      p_class_code: classCode.trim().toUpperCase(),
    })
    fail('註冊失敗', error)
    const row = (data as Parameters<typeof SupabaseRepository.student>[0][] | null)?.[0]
    if (!row) throw new Error('註冊失敗：伺服器沒有回傳學生資料')
    return SupabaseRepository.student(row)
  }

  /**
   * 登入。**失敗回 error 字串而不是丟例外**，因為後端要在密碼打錯時記下次數，
   * 而在 Postgres 裡丟例外會把同一筆交易的 update 一起回滾，鎖定就不會生效。
   * 這裡只是忠實地把那個 error 帶上來。
   */
  async login(
    loginId: string, password: string,
  ): Promise<{ student: Student | null; error: string | null }> {
    await this.ensureSession()
    const { data, error } = await this.db.rpc('login_student', {
      p_login_id: loginId.trim().toLowerCase(),
      p_password: password,
    })
    fail('登入失敗', error)
    const row = (data as (Parameters<typeof SupabaseRepository.student>[0] & {
      error: string | null
    })[] | null)?.[0]
    if (!row) return { student: null, error: '登入失敗：伺服器沒有回應' }
    if (row.error) return { student: null, error: row.error }
    return { student: SupabaseRepository.student(row), error: null }
  }

  /** 這台裝置上次是誰。匿名 session 存在瀏覽器裡，所以重開還記得。 */
  async currentStudent(): Promise<Student | null> {
    const { data: sess } = await this.db.auth.getSession()
    if (!sess.session) return null
    const { data, error } = await this.db.rpc('current_student_id')
    if (error || !data) return null
    const { data: rows } = await this.db
      .from('students').select('id, nickname, class_code').eq('id', data as string).maybeSingle()
    const r = rows as { id: string; nickname: string; class_code: string | null } | null
    if (!r) return null
    // login_id 是不給讀的欄位（同班同學不能互相看帳號），所以這裡填空字串；
    // 畫面上要顯示的是暱稱，登入帳號只有登入那一刻用得到。
    return { id: r.id, loginId: '', nickname: r.nickname, classCode: r.class_code, role: 'student' }
  }

  async logout(): Promise<void> {
    await this.db.auth.signOut()
  }

  async setPassword(oldPassword: string, newPassword: string): Promise<void> {
    const { error } = await this.db.rpc('student_set_password', {
      p_old: oldPassword, p_new: newPassword,
    })
    fail('改密碼失敗', error)
  }

  async setNickname(nickname: string): Promise<string> {
    const { data, error } = await this.db.rpc('student_set_nickname', {
      p_nickname: nickname.trim(),
    })
    fail('改暱稱失敗', error)
    return (data as string) ?? nickname.trim()
  }

  async joinClass(classCode: string): Promise<string> {
    const { data, error } = await this.db.rpc('student_join_class', {
      p_class_code: classCode.trim().toUpperCase(),
    })
    fail('加入班級失敗', error)
    return (data as string) ?? classCode.trim().toUpperCase()
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

  // ------------------------------------------------------------ 老師與管理員
  //
  // 老師用真的 email 帳號，跟學生完全分開。理由是老師需要自己救得回密碼，
  // 而學生的密碼是由老師或管理員重設的。

  private async staffOf(userId: string, email: string): Promise<Staff> {
    const { data } = await this.db
      .from('teachers').select('display_name, is_admin').eq('user_id', userId).maybeSingle()
    const r = data as { display_name: string; is_admin: boolean } | null
    return {
      userId, email,
      displayName: r?.display_name ?? '老師',
      isAdmin: r?.is_admin ?? false,
    }
  }

  async staffSignUp(email: string, password: string, displayName: string): Promise<Staff> {
    const { data, error } = await this.db.auth.signUp({ email: email.trim(), password })
    fail('註冊失敗', error)
    const user = data.user
    if (!user) throw new Error('註冊失敗：伺服器沒有回傳帳號')
    if (!data.session) {
      throw new Error('帳號建好了，請到信箱收確認信，點完連結再回來登入')
    }
    // 名單上有這個 email 才變得成老師。不在名單上這裡就會丟出錯誤。
    const { error: claimErr } = await this.db.rpc('claim_teacher', { p_display_name: displayName })
    fail('這個 email 還不能當老師', claimErr)
    return this.staffOf(user.id, user.email ?? email)
  }

  async staffLogin(email: string, password: string): Promise<Staff> {
    const { data, error } = await this.db.auth.signInWithPassword({
      email: email.trim(), password,
    })
    fail('登入失敗', error)
    const user = data.user
    if (!user) throw new Error('登入失敗')
    // 第一次登入時如果還沒認領過老師身分，這裡補認領；已經是老師就直接回來。
    await this.db.rpc('claim_teacher', { p_display_name: null })
    return this.staffOf(user.id, user.email ?? email)
  }

  async currentStaff(): Promise<Staff | null> {
    const { data } = await this.db.auth.getSession()
    const user = data.session?.user
    if (!user || user.is_anonymous) return null
    return this.staffOf(user.id, user.email ?? '')
  }

  async staffLogout(): Promise<void> {
    await this.db.auth.signOut()
  }

  async listClasses(): Promise<ClassRoom[]> {
    const { data, error } = await this.db
      .from('classes').select('code, name, open').order('created_at')
    fail('讀取班級失敗', error)
    return ((data as ClassRoom[] | null) ?? []).map((r) => ({
      code: r.code, name: r.name, open: r.open,
    }))
  }

  async createClass(code: string, name: string): Promise<ClassRoom> {
    const { data, error } = await this.db.rpc('create_class', {
      p_code: code.trim().toUpperCase(), p_name: name.trim(),
    })
    fail('開班失敗', error)
    const row = (data as { code: string; name: string }[] | null)?.[0]
    if (!row) throw new Error('開班失敗：伺服器沒有回應')
    return { code: row.code, name: row.name, open: true }
  }

  async setClassOpen(code: string, open: boolean): Promise<boolean> {
    const { data, error } = await this.db.rpc('class_set_open', {
      p_code: code.trim().toUpperCase(), p_open: open,
    })
    fail('設定失敗', error)
    return (data as boolean) ?? open
  }

  async regenerateClassCode(code: string): Promise<string> {
    const { data, error } = await this.db.rpc('class_regenerate_code', {
      p_code: code.trim().toUpperCase(),
    })
    fail('換代碼失敗', error)
    return data as string
  }

  async loadClassRoster(classCode: string): Promise<ClassRosterRow[]> {
    const { data, error } = await this.db.rpc('class_overview', {
      p_code: classCode.trim().toUpperCase(),
    })
    fail('讀取班級名單失敗', error)
    type Row = {
      student_id: string; nickname: string; coins: number; exp: number
      stars: number; answered: number
    }
    return ((data as Row[] | null) ?? []).map((r) => ({
      studentId: r.student_id, nickname: r.nickname,
      coins: r.coins, exp: r.exp, stars: Number(r.stars), answers: Number(r.answered),
    }))
  }

  async addStudent(
    classCode: string, loginId: string, password: string, nickname: string,
  ): Promise<void> {
    const { error } = await this.db.rpc('teacher_add_student', {
      p_code: classCode.trim().toUpperCase(),
      p_login_id: loginId.trim().toLowerCase(),
      p_password: password,
      p_nickname: nickname.trim(),
    })
    fail('加入學生失敗', error)
  }

  async removeStudent(studentId: string): Promise<void> {
    const { error } = await this.db.rpc('teacher_remove_student', { p_student: studentId })
    fail('移除學生失敗', error)
  }

  async resetStudentPassword(studentId: string, password: string): Promise<void> {
    const { error } = await this.db.rpc('teacher_reset_student_password', {
      p_student: studentId, p_password: password,
    })
    fail('重設密碼失敗', error)
  }

  async claimFirstAdmin(): Promise<void> {
    const { error } = await this.db.rpc('claim_first_admin')
    fail('認領管理員失敗', error)
  }

  async inviteTeacher(email: string): Promise<string> {
    const { data, error } = await this.db.rpc('admin_invite_teacher', {
      p_email: email.trim().toLowerCase(),
    })
    fail('發邀請失敗', error)
    return data as string
  }

  async listTeachers(): Promise<TeacherRow[]> {
    const { data, error } = await this.db.rpc('admin_list_teachers')
    fail('讀取老師名單失敗', error)
    type Row = {
      user_id: string; display_name: string; is_admin: boolean; active: boolean
      classes: number; students: number
    }
    return ((data as Row[] | null) ?? []).map((r) => ({
      userId: r.user_id, displayName: r.display_name, isAdmin: r.is_admin,
      active: r.active, classes: Number(r.classes), students: Number(r.students),
    }))
  }

  async listInvites(): Promise<{ email: string; used: boolean }[]> {
    const { data, error } = await this.db.rpc('admin_list_invites')
    fail('讀取邀請名單失敗', error)
    return ((data as { email: string; used_at: string | null }[] | null) ?? []).map((r) => ({
      email: r.email, used: r.used_at !== null,
    }))
  }

  async setTeacherActive(userId: string, active: boolean): Promise<void> {
    const { error } = await this.db.rpc('admin_set_teacher_active', {
      p_user: userId, p_active: active,
    })
    fail('設定失敗', error)
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
