import type {
  AnswerEvent, Character, ClassRoom, LevelProgress, Staff, Student, TeacherRow, WordStatEntry,
} from '@/core/types'

/**
 * 唯一知道資料存在哪裡的介面。core 只認這份契約，不知道 Supabase 存在。
 * 換資料庫＝換一個實作，不動其他任何地方。
 */
export interface Repository {
  // -------------------------------------------------------------- 學生帳號
  /**
   * 註冊。班級代碼同時是邀請碼：沒有一組有效而且開放加入的代碼就註冊不了。
   *
   * 學生刻意不走 email 註冊。Supabase 的帳號一定綁 email，每註冊一個就寄一封
   * 確認信，而內建寄信額度小到一整班同時註冊就會被擋（實測連五個就 429）。
   */
  register(loginId: string, password: string, nickname: string, classCode: string): Promise<Student>

  /**
   * 登入。**失敗不丟例外，回 error 字串**——後端要在密碼打錯時記下次數，
   * 而在 Postgres 裡丟例外會把同一筆交易的 update 一起回滾，鎖定就永遠不會生效。
   */
  login(loginId: string, password: string): Promise<{ student: Student | null; error: string | null }>

  /** 這台裝置上次是誰。沒有就回 null（要去登入）。 */
  currentStudent(): Promise<Student | null>
  logout(): Promise<void>

  setPassword(oldPassword: string, newPassword: string): Promise<void>
  /** 回傳實際存下來的暱稱 */
  setNickname(nickname: string): Promise<string>
  /** 換班或第一次加入班級。角色與進度完全不動。 */
  joinClass(classCode: string): Promise<string>

  // -------------------------------------------------------------- 角色與進度
  loadCharacter(studentId: string): Promise<Character>
  saveCharacter(c: Character): Promise<void>

  /** 創角：選頭像。職業走 saveCharacter。 */
  setAvatar(avatar: string): Promise<void>

  /**
   * 買東西。**只送品項 id**——價格、等級門檻、餘額全部由後端查。
   * 前端說「這個賣一塊」是不算數的。回傳買完之後的角色，畫面直接用。
   */
  buyItem(itemId: string): Promise<{ coins: number; items: Record<string, number> }>

  /** 穿脫裝飾品。回傳穿好之後的清單。 */
  equipItem(itemId: string, on: boolean): Promise<string[]>

  /** 用掉一個消耗品。回傳用完之後的背包。 */
  consumeItem(itemId: string): Promise<Record<string, number>>

  loadProgress(studentId: string): Promise<LevelProgress[]>
  saveProgress(studentId: string, p: LevelProgress): Promise<void>

  /**
   * 寫入答題事件。整個系統的地基：金幣、經驗、星星、排行榜、老師報表
   * 全都是從這裡算出來的。
   *
   * 接了 Supabase 之後這是一支 RPC，由資料庫從事件算出金幣與經驗，
   * **客戶端不能直接寫 coins 欄位**——小朋友真的會找漏洞。
   */
  appendEvents(events: AnswerEvent[]): Promise<void>
  loadEvents(studentId: string): Promise<AnswerEvent[]>

  /**
   * 掌握度。本地版是把事件跑一遍算出來的；接了後端之後改成直接讀資料庫算好的
   * 那張表，不然一個學生一年好幾萬列，每次登入都撈回來跑一遍，學校的平板會卡住。
   */
  loadWordStats(studentId: string): Promise<WordStatEntry[]>

  // -------------------------------------------------------------- 老師
  /** 老師與管理員用真的 email 登入，跟學生走不同的路。 */
  staffSignUp(email: string, password: string, displayName: string): Promise<Staff>
  staffLogin(email: string, password: string): Promise<Staff>
  currentStaff(): Promise<Staff | null>
  staffLogout(): Promise<void>

  listClasses(): Promise<ClassRoom[]>
  createClass(code: string, name: string): Promise<ClassRoom>
  /** 開關「可不可以加入」。班級代碼就是邀請碼，上課時開、註冊完關。 */
  setClassOpen(code: string, open: boolean): Promise<boolean>
  /** 代碼流出去了就換一組。班上的人會跟著走，不會被踢掉。 */
  regenerateClassCode(code: string): Promise<string>

  /** 老師報表用：整個班的事件 */
  loadClassEvents(classCode: string): Promise<AnswerEvent[]>
  /** 班上每個人的概況 */
  loadClassRoster(classCode: string): Promise<ClassRosterRow[]>
  addStudent(classCode: string, loginId: string, password: string, nickname: string): Promise<void>
  removeStudent(studentId: string): Promise<void>
  /** 忘記密碼。順便解鎖，因為忘記的人通常已經試到被鎖住了。 */
  resetStudentPassword(studentId: string, password: string): Promise<void>

  /** 老師額外開放的關卡 */
  loadTeacherOpen(classCode: string): Promise<string[]>
  setTeacherOpen(classCode: string, levelIds: string[]): Promise<void>

  // -------------------------------------------------------------- 管理員
  /** 還沒有任何管理員的時候，第一個呼叫的人就是管理員。之後永遠拒絕。 */
  claimFirstAdmin(): Promise<void>
  /** 指定某個 email 可以成為老師。對方自己註冊、自己設密碼。 */
  inviteTeacher(email: string): Promise<string>
  listTeachers(): Promise<TeacherRow[]>
  listInvites(): Promise<{ email: string; used: boolean }[]>
  setTeacherActive(userId: string, active: boolean): Promise<void>
}

export interface ClassRosterRow {
  studentId: string
  nickname: string
  coins: number
  exp: number
  stars: number
  answers: number
}
