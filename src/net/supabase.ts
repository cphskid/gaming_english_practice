import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AdminClassRow, AnswerEvent, Character, ClassRoom, Job, LevelProgress, Mode, Skill, Staff,
  Student, TeacherRow, WordStatEntry,
} from '@/core/types'
import type {
  AchievementRow, AddedTeacher, ClassRosterRow, LeaderRow, LevelResult, PublicProfile,
  Repository, RoomBrief, RoomMember, RoomState, SavedResult, VersusMatchInput,
} from './repository'

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
  job: Job; avatar: string | null; exp: number; coins: number
  items: Record<string, number> | null
  equipped: string[] | null
  pinned: string[] | null; title: string | null; public_profile: boolean | null
  avatars_seen: string[] | null; jobs_cleared: string[] | null
}
interface ProgressRow {
  level_id: string; stars: number; best_correct: number; cleared_at: string | null
  best_survival: number | null; last_win_session: string | null
}
interface EventRow {
  student_id: string; word_id: number; skill: Skill; correct: boolean
  ms: number; combo: number; game_id: string; level_id: string | null
  session_id: string | null; ord: number | null; at: string
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
      .select('job, avatar, exp, coins, items, equipped, pinned, title, public_profile, avatars_seen, jobs_cleared')
      .eq('student_id', studentId)
      .maybeSingle()
    fail('讀取角色失敗', error)
    const row = data as CharacterRow | null
    // join_class 會順便開好角色，所以正常不會是 null
    if (!row) throw new Error('讀取角色失敗：找不到這個學生的存檔')
    return {
      studentId,
      job: row.job,
      avatar: row.avatar ?? '',
      exp: row.exp,
      coins: row.coins,
      items: row.items ?? {},
      equipped: row.equipped ?? [],
      pinned: row.pinned ?? [],
      title: row.title ?? '',
      publicProfile: row.public_profile ?? true,
      avatarsSeen: row.avatars_seen ?? [],
      jobsCleared: row.jobs_cleared ?? [],
    }
  }

  /**
   * 只有職業存得回去。
   *
   * 金幣與經驗故意沒有寫入路徑——資料表沒給 update 權限，就算這裡想寫也寫不進去。
   * 它們是 appendEvents 與 saveProgress 的副作用，由資料庫自己算。
   * 道具也一樣：買的時候由 buy_item 扣錢，不是前端說我有什麼就有什麼。
   */
  async saveCharacter(c: Character): Promise<void> {
    const { error } = await this.db.rpc('set_job', { p_job: c.job })
    fail('存角色失敗', error)
  }

  async setAvatar(avatar: string): Promise<void> {
    const { error } = await this.db.rpc('set_avatar', { p_avatar: avatar })
    fail('存頭像失敗', error)
  }

  async buyItem(itemId: string): Promise<{ coins: number; items: Record<string, number> }> {
    const { data, error } = await this.db.rpc('buy_item', { p_item: itemId })
    fail('買不成', error)
    const row = (data as { coins: number; items: Record<string, number> }[] | null)?.[0]
    if (!row) throw new Error('買不成：後端沒有回傳結果')
    return { coins: row.coins, items: row.items ?? {} }
  }

  async equipItem(itemId: string, on: boolean): Promise<string[]> {
    const { data, error } = await this.db.rpc('equip_item', { p_item: itemId, p_on: on })
    fail(on ? '穿不上' : '脫不下來', error)
    return (data as string[] | null) ?? []
  }

  async consumeItem(
    itemId: string, sessionId?: string, levelId?: string,
  ): Promise<Record<string, number>> {
    // 帶上「用在哪一場」，成就那邊才知道通關的那一場有沒有用道具
    const { data, error } = await this.db.rpc('consume_item', {
      p_item: itemId, p_session: sessionId ?? null, p_level_id: levelId ?? null,
    })
    fail('用不了這個道具', error)
    return (data as Record<string, number> | null) ?? {}
  }

  async loadProgress(studentId: string): Promise<LevelProgress[]> {
    const { data, error } = await this.db
      .from('level_progress')
      .select('level_id, stars, best_correct, cleared_at, best_survival, last_win_session')
      .eq('student_id', studentId)
    fail('讀取關卡進度失敗', error)
    return ((data as ProgressRow[] | null) ?? []).map((r) => ({
      levelId: r.level_id,
      stars: r.stars as 0 | 1 | 2 | 3,
      bestCorrect: r.best_correct,
      clearedAt: r.cleared_at ? ms(r.cleared_at) : null,
      bestSurvival: Number(r.best_survival ?? 0),
      lastWinSession: r.last_win_session ?? null,
    }))
  }

  /** 星星、答對數、首次通關獎勵全部在資料庫那邊算，這裡只回報打完了什麼 */
  async saveResult(r: LevelResult): Promise<SavedResult> {
    const { data, error } = await this.db.rpc('save_progress', {
      p_level_id: r.levelId,
      p_session: r.sessionId,
      p_win: r.win,
      p_survival: r.survival,
    })
    fail('存關卡進度失敗', error)
    type Row = {
      stars: number; best_correct: number; cleared_at: string | null; bonus_coins: number
    }
    const row = (data as Row[] | null)?.[0]
    return {
      progress: {
        levelId: r.levelId,
        stars: (row?.stars ?? 0) as 0 | 1 | 2 | 3,
        bestCorrect: row?.best_correct ?? 0,
        clearedAt: row?.cleared_at ? ms(row.cleared_at) : null,
      },
      bonusCoins: row?.bonus_coins ?? 0,
    }
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
        sessionId: e.sessionId,
        // 重試送第二次時，伺服器靠這個把重複的擋掉
        ord: e.ord,
      }))
      const { error } = await this.db.rpc('submit_answers', { p_events: chunk })
      fail('回報答題失敗', error)
    }
  }

  async loadEvents(studentId: string): Promise<AnswerEvent[]> {
    const { data, error } = await this.db
      .from('answer_events')
      .select('student_id, word_id, skill, correct, ms, combo, game_id, level_id, session_id, ord, at')
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
      .select('student_id, word_id, skill, correct, ms, combo, game_id, level_id, session_id, ord, at, students!inner(class_code)')
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

  // ------------------------------------------------------------------ 房間
  //
  // 全部走輪詢。Supabase 有 Realtime 可以推播，但一個班三十個人、幾秒一次的
  // 查詢對資料庫來說是小事，而輪詢在教室的 wifi 斷一下再回來時會自己接上——
  // 長連線斷掉要自己處理重連，那才是真的會在上課中出事的地方。

  async openRoom(classCode: string, levelId: string, mode: Mode): Promise<string> {
    const { data, error } = await this.db.rpc('open_room', {
      p_class_code: classCode.trim().toUpperCase(),
      p_level_id: levelId,
      p_mode: mode,
    })
    fail('開一場失敗', error)
    return String(data)
  }

  async studentOpenRoom(levelId: string, mode: Mode): Promise<string> {
    const { data, error } = await this.db.rpc('student_open_room', {
      p_level_id: levelId, p_mode: mode,
    })
    fail('揪不成一場', error)
    return String(data)
  }

  async startRoom(roomId: string): Promise<void> {
    const { error } = await this.db.rpc('start_room', { p_room: roomId })
    fail('開始失敗', error)
  }

  async closeRoom(roomId: string): Promise<void> {
    const { error } = await this.db.rpc('close_room', { p_room: roomId })
    fail('結束這一場失敗', error)
  }

  async joinRoom(roomId?: string): Promise<string> {
    const { data, error } = await this.db.rpc('join_room', { p_room: roomId ?? null })
    fail('加入失敗', error)
    return String(data)
  }

  async leaveRoom(roomId: string): Promise<void> {
    const { error } = await this.db.rpc('leave_room', { p_room: roomId })
    fail('離開失敗', error)
  }

  async roomList(classCode?: string): Promise<RoomBrief[]> {
    const { data, error } = await this.db.rpc('room_list', {
      p_class_code: classCode ? classCode.trim().toUpperCase() : null,
    })
    fail('讀取場次失敗', error)
    return ((data as RoomBrief[] | null) ?? []).map((r) => ({ ...r, here: Number(r.here) }))
  }

  async roomState(roomId: string): Promise<RoomState | null> {
    const { data, error } = await this.db.rpc('room_state', { p_room: roomId })
    fail('讀取這一場失敗', error)
    type Row = Omit<RoomState, 'startedAt' | 'members'> & {
      startedAt: string | null
      members: RoomMember[] | null
    }
    const row = data as Row | null
    if (!row) return null
    return {
      ...row,
      startedAt: row.startedAt ? ms(row.startedAt) : null,
      members: (row.members ?? []).map((m) => ({ ...m, equipped: m.equipped ?? [] })),
    }
  }

  async roomPlaying(roomId: string, sessionId: string): Promise<void> {
    const { error } = await this.db.rpc('room_playing', {
      p_room: roomId, p_session: sessionId,
    })
    fail('回報開打失敗', error)
  }

  async roomFinished(roomId: string): Promise<void> {
    const { error } = await this.db.rpc('room_finished', { p_room: roomId })
    fail('回報打完失敗', error)
  }

  // ------------------------------------------------------------ 老師與管理員
  //
  // 老師用真的 email 帳號，跟學生完全分開。理由是老師需要自己救得回密碼，
  // 而學生的密碼是由老師或管理員重設的。

  /**
   * 讀出這個登入帳號的老師身分。沒有老師那一列就不是老師——
   * 這時候把人留在系統裡只會讓他在後台一直撞牆，所以直接登出並說清楚原因。
   */
  private async staffOf(userId: string, email: string): Promise<Staff> {
    const { data } = await this.db
      .from('teachers').select('display_name, is_admin, active').eq('user_id', userId).maybeSingle()
    const r = data as { display_name: string; is_admin: boolean; active: boolean } | null
    if (!r) {
      await this.db.auth.signOut()
      throw new Error('這個 email 還不是老師，請先請管理員把它加進名單')
    }
    if (!r.active) {
      await this.db.auth.signOut()
      throw new Error('這個老師帳號已經被停用了')
    }
    return { userId, email, displayName: r.display_name, isAdmin: r.is_admin }
  }

  async staffSignUp(email: string, password: string, displayName: string): Promise<Staff> {
    const { data, error } = await this.db.auth.signUp({ email: email.trim(), password })
    fail('註冊失敗', error)
    const user = data.user
    if (!user) throw new Error('註冊失敗：伺服器沒有回傳帳號')
    if (!data.session) {
      throw new Error('帳號建好了，請到信箱收確認信，點完連結再回來登入')
    }
    // 名單上有這個 email 才變得成老師；系統還沒有任何老師時，第一個人就是管理員。
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
    // 認領失敗（不在名單上）不在這裡報錯，交給 staffOf 統一給訊息。
    await this.db.rpc('claim_teacher', { p_display_name: null })
    return this.staffOf(user.id, user.email ?? email)
  }

  async currentStaff(): Promise<Staff | null> {
    const { data } = await this.db.auth.getSession()
    const user = data.session?.user
    if (!user || user.is_anonymous) return null
    // 開場回復畫面用的，不是老師就當作沒登入，不要讓整個 App 開不起來。
    try {
      return await this.staffOf(user.id, user.email ?? '')
    } catch {
      return null
    }
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

  async classLeaderboard(classCode?: string): Promise<LeaderRow[]> {
    // 不帶代碼就是「我這一班」，代碼由後端從身分查，客戶端插不了手。
    const { data, error } = await this.db.rpc('class_leaderboard', {
      p_code: classCode ? classCode.trim().toUpperCase() : null,
    })
    fail('讀取排行榜失敗', error)
    type Row = {
      student_id: string; nickname: string; coins: number; exp: number; stars: number
      avatar: string | null; equipped: string[] | null; me: boolean
      title: string | null; badges: number | null; viewable: boolean | null
    }
    return ((data as Row[] | null) ?? []).map((r) => ({
      studentId: r.student_id,
      nickname: r.nickname, coins: r.coins, exp: r.exp, stars: Number(r.stars),
      avatar: r.avatar ?? '', equipped: r.equipped ?? [], me: r.me,
      title: r.title ?? '', badges: Number(r.badges ?? 0), viewable: r.viewable ?? false,
    }))
  }

  // ---------------------------------------------------------------- 成就
  async loadAchievements(): Promise<AchievementRow[]> {
    const { data, error } = await this.db.rpc('my_achievements')
    fail('讀取成就失敗', error)
    type Row = { id: string; category: string; unlocked_at: string | null }
    return ((data as Row[] | null) ?? []).map((r) => ({
      id: r.id, category: r.category,
      unlockedAt: r.unlocked_at ? ms(r.unlocked_at) : null,
    }))
  }

  async refreshAchievements(): Promise<string[]> {
    const { data, error } = await this.db.rpc('refresh_achievements')
    fail('重算成就失敗', error)
    // setof text 回來的是一串字串
    return ((data as string[] | null) ?? []).filter((x) => typeof x === 'string')
  }

  async setPinned(ids: string[]): Promise<string[]> {
    const { data, error } = await this.db.rpc('set_pinned', { p_ids: ids.slice(0, 3) })
    fail('別不上去', error)
    return (data as string[] | null) ?? []
  }

  async setTitle(achievementId: string): Promise<string> {
    const { data, error } = await this.db.rpc('set_title', { p_id: achievementId })
    fail('換不了稱號', error)
    return (data as string | null) ?? ''
  }

  async setPublicProfile(open: boolean): Promise<boolean> {
    const { data, error } = await this.db.rpc('set_public_profile', { p_open: open })
    fail('改不了公開設定', error)
    return (data as boolean | null) ?? open
  }

  async publicProfile(studentId: string): Promise<PublicProfile> {
    const { data, error } = await this.db.rpc('public_profile', { p_student: studentId })
    fail('看不到這位同學的檔案', error)
    type Row = {
      nickname: string; avatar: string | null; equipped: string[] | null
      title: string | null; pinned: string[] | null; badges: string[] | null
      stars: number; level: number
    }
    const row = (data as Row[] | null)?.[0]
    if (!row) throw new Error('看不到這位同學的檔案')
    return {
      nickname: row.nickname, avatar: row.avatar ?? '', equipped: row.equipped ?? [],
      title: row.title ?? '', pinned: row.pinned ?? [], badges: row.badges ?? [],
      stars: Number(row.stars ?? 0), level: Number(row.level ?? 1),
    }
  }

  async recordVersusMatch(m: VersusMatchInput): Promise<void> {
    const { error } = await this.db.rpc('record_versus_match', {
      p_session: m.sessionId,
      p_opponent_kind: m.opponentKind,
      p_won: m.won,
      p_front: m.front,
      p_lowest_front: m.lowestFront,
      p_lines: m.linesUsed,
      p_top_tier: m.topTier,
      p_opponent_name: m.opponentName,
    })
    fail('記不了這一場戰績', error)
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

  async createTeacher(
    email: string, password: string, displayName: string,
  ): Promise<AddedTeacher> {
    const { data, error } = await this.db.rpc('admin_create_teacher', {
      p_email: email.trim().toLowerCase(),
      p_password: password,
      p_display_name: displayName.trim(),
    })
    fail('加老師失敗', error)
    const r = data as { email?: string; created?: boolean } | null
    return { email: r?.email ?? email.trim().toLowerCase(), created: r?.created !== false }
  }

  async listAllClasses(): Promise<AdminClassRow[]> {
    const { data, error } = await this.db.rpc('admin_list_classes')
    fail('讀取班級失敗', error)
    type Row = {
      code: string; name: string; open: boolean
      owner: string | null; owner_name: string | null; owner_active: boolean | null
      students: number
    }
    return ((data as Row[] | null) ?? []).map((r) => ({
      code: r.code, name: r.name, open: r.open,
      ownerId: r.owner ?? '', ownerName: r.owner_name ?? '（已經不在了）',
      ownerActive: r.owner_active ?? false, students: Number(r.students),
    }))
  }

  async setClassOwner(code: string, userId: string): Promise<void> {
    const { error } = await this.db.rpc('admin_set_class_owner', {
      p_code: code.trim().toUpperCase(), p_owner: userId,
    })
    fail('換老師失敗', error)
  }

  async hasAdmin(): Promise<boolean> {
    const { data, error } = await this.db.rpc('has_admin')
    fail('讀取系統狀態失敗', error)
    return data === true
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
    sessionId: r.session_id ?? '',
    ord: r.ord ?? 0,
    at: ms(r.at),
  }
}
