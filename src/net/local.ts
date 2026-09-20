import { newCharacter, studentId } from '@/core/character'
import { buy, consume, count } from '@/core/inventory'
import { levelFromExp } from '@/core/progress'
import { ITEMS } from '@/data/shop'
import { WordStat } from '@/core/wordStat'
import type {
  AdminClassRow, AnswerEvent, Character, ClassRoom, LevelProgress, Staff, Student,
  TeacherRow, WordStatEntry,
} from '@/core/types'
import type { AddedTeacher, ClassRosterRow, LeaderRow, Repository } from './repository'

/**
 * localStorage 版。**存的是最終的事件形狀**，所以之後換成 Supabase
 * 只是換一個實作，不用改資料結構——這是「現在不接後端也不會白工」的另一半。
 *
 * 每一個讀寫都包 try/catch：無痕視窗、清過網站資料、學校平板的隱私設定
 * 都會讓 localStorage 直接丟例外。壞掉時當作空的，遊戲照樣能玩。
 */

const NS = 'gep.v1'
const k = {
  student: (id: string) => `${NS}.student.${id}`,
  character: (id: string) => `${NS}.character.${id}`,
  progress: (id: string) => `${NS}.progress.${id}`,
  events: (id: string) => `${NS}.events.${id}`,
  roster: (code: string) => `${NS}.roster.${code}`,
  teacherOpen: (code: string) => `${NS}.teacherOpen.${code}`,
  byLogin: (login: string) => `${NS}.login.${login}`,
  password: (id: string) => `${NS}.pw.${id}`,
  session: `${NS}.session`,
  classes: `${NS}.classes`,
  staff: `${NS}.staff`,
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存不進去就算了，這一場還是能玩完
  }
}

/**
 * 本地版的密碼「雜湊」。
 *
 * **這不是安全機制，也沒打算是。** 本地版整份資料就攤在使用者自己的瀏覽器裡，
 * 打開開發者工具就看得到，再怎麼雜湊都沒有意義。它存在的唯一理由是讓本地版
 * 跟 Supabase 版走同一條流程（註冊、登入、改密碼會動到同一個欄位），
 * 這樣拿本地版測到的行為才算數。真正的密碼安全在資料庫那邊（bcrypt + RLS）。
 */
const scramble = (v: string): string => btoa(unescape(encodeURIComponent('gep:' + v)))

export class LocalRepository implements Repository {
  // ---------------------------------------------------------------- 學生帳號
  private remember(student: Student): Student {
    write(k.student(student.id), student)
    write(k.byLogin(student.loginId), student.id)
    write(k.session, student.id)
    if (student.classCode) {
      const roster = read<string[]>(k.roster(student.classCode), [])
      if (!roster.includes(student.id)) write(k.roster(student.classCode), [...roster, student.id])
    }
    return student
  }

  async register(
    loginId: string, password: string, nickname: string, classCode: string,
  ): Promise<Student> {
    const login = loginId.trim().toLowerCase()
    const code = classCode.trim().toUpperCase()
    if (read<string | null>(k.byLogin(login), null)) throw new Error('這個帳號已經有人用了，換一個')

    const id = studentId(code, login)
    write(k.password(id), scramble(password.toLowerCase()))
    return this.remember({ id, loginId: login, classCode: code, nickname: nickname.trim(), role: 'student' })
  }

  async login(
    loginId: string, password: string,
  ): Promise<{ student: Student | null; error: string | null }> {
    const login = loginId.trim().toLowerCase()
    const id = read<string | null>(k.byLogin(login), null)
    if (!id) return { student: null, error: '帳號或密碼不對' }
    if (read<string | null>(k.password(id), null) !== scramble(password.toLowerCase())) {
      return { student: null, error: '帳號或密碼不對' }
    }
    const student = read<Student | null>(k.student(id), null)
    if (!student) return { student: null, error: '帳號或密碼不對' }
    return { student: this.remember(student), error: null }
  }

  async currentStudent(): Promise<Student | null> {
    const id = read<string | null>(k.session, null)
    return id ? read<Student | null>(k.student(id), null) : null
  }

  async logout(): Promise<void> {
    write(k.session, null)
  }

  async setPassword(oldPassword: string, newPassword: string): Promise<void> {
    const id = read<string | null>(k.session, null)
    if (!id) throw new Error('請先登入')
    if (read<string | null>(k.password(id), null) !== scramble(oldPassword.toLowerCase())) {
      throw new Error('舊密碼不對')
    }
    write(k.password(id), scramble(newPassword.toLowerCase()))
  }

  async setNickname(nickname: string): Promise<string> {
    const id = read<string | null>(k.session, null)
    const student = id ? read<Student | null>(k.student(id), null) : null
    if (!student) throw new Error('請先登入')
    const next = nickname.trim()
    write(k.student(id!), { ...student, nickname: next })
    return next
  }

  async joinClass(classCode: string): Promise<string> {
    const id = read<string | null>(k.session, null)
    const student = id ? read<Student | null>(k.student(id), null) : null
    if (!student) throw new Error('請先登入')
    const code = classCode.trim().toUpperCase()
    this.remember({ ...student, classCode: code })
    return code
  }

  async loadCharacter(id: string): Promise<Character> {
    const existing = read<Character | null>(k.character(id), null)
    if (existing) return existing
    const student = read<Student | null>(k.student(id), null)
    const fresh = newCharacter(
      student ?? { id, loginId: '', classCode: null, nickname: '', role: 'student' })
    write(k.character(id), fresh)
    return fresh
  }

  async saveCharacter(c: Character): Promise<void> {
    write(k.character(c.studentId), c)
  }

  /**
   * 底下這四支在 Supabase 那邊是由資料庫把關的（價格、等級、餘額都在後端查）。
   * 本機版沒有後端可以把關，所以這裡只是把同一套規則再寫一次，
   * 讓沒接資料庫也玩得動——**它擋不住有心作弊的人，也不需要擋**，
   * 本機版的存檔本來就在自己的瀏覽器裡。
   */
  private current(): Character {
    const id = read<string | null>(k.session, null)
    const c = id ? read<Character | null>(k.character(id), null) : null
    if (!c) throw new Error('請先登入')
    return c
  }

  async setAvatar(avatar: string): Promise<void> {
    const c = this.current()
    write(k.character(c.studentId), { ...c, avatar })
  }

  async buyItem(itemId: string): Promise<{ coins: number; items: Record<string, number> }> {
    const c = this.current()
    const item = ITEMS.find((i) => i.id === itemId)
    if (!item) throw new Error('商店裡沒有這個東西')
    if (levelFromExp(c.exp) < item.unlockLevel) {
      throw new Error(`等級不夠，要 ${item.unlockLevel} 級才買得到`)
    }
    const r = buy(c, item)
    if (!r.ok) throw new Error(r.why)
    write(k.character(c.studentId), r.character)
    return { coins: r.character.coins, items: r.character.items }
  }

  async equipItem(itemId: string, on: boolean): Promise<string[]> {
    const c = this.current()
    const item = ITEMS.find((i) => i.id === itemId)
    if (!item) throw new Error('沒有這個東西')
    if (item.kind !== 'cosmetic') throw new Error('這個不是穿戴的東西')
    if (on && !count(c, itemId)) throw new Error('你還沒有這個東西')
    // 一個欄位一次只能穿一件。正式版這條規則是資料庫在管（equip_item），
    // 本地版要跟著做，不然本機測起來對、上線又是另一回事。
    const slot = item.slot ?? null
    const kept = slot
      ? c.equipped.filter((e) => ITEMS.find((i) => i.id === e)?.slot !== slot)
      : c.equipped
    const equipped = on
      ? [...new Set([...kept, itemId])]
      : c.equipped.filter((e) => e !== itemId)
    write(k.character(c.studentId), { ...c, equipped })
    return equipped
  }

  async consumeItem(itemId: string): Promise<Record<string, number>> {
    const c = this.current()
    const next = consume(c, itemId)
    if (!next) throw new Error('你沒有這個道具了')
    write(k.character(c.studentId), next)
    return next.items
  }

  async loadProgress(id: string): Promise<LevelProgress[]> {
    return read<LevelProgress[]>(k.progress(id), [])
  }

  async saveProgress(id: string, p: LevelProgress): Promise<void> {
    const all = read<LevelProgress[]>(k.progress(id), [])
    const i = all.findIndex((x) => x.levelId === p.levelId)
    if (i >= 0) all[i] = p
    else all.push(p)
    write(k.progress(id), all)
  }

  async appendEvents(events: AnswerEvent[]): Promise<void> {
    if (!events.length) return
    const byStudent = new Map<string, AnswerEvent[]>()
    for (const e of events) {
      const list = byStudent.get(e.studentId) ?? []
      list.push(e)
      byStudent.set(e.studentId, list)
    }
    for (const [id, list] of byStudent) {
      const all = read<AnswerEvent[]>(k.events(id), [])
      all.push(...list)
      // 一個學生一年大概三萬列，本地只留最近的，老師報表要完整資料要接後端
      write(k.events(id), all.slice(-5000))
    }
  }

  async loadEvents(id: string): Promise<AnswerEvent[]> {
    return read<AnswerEvent[]>(k.events(id), [])
  }

  async loadWordStats(id: string): Promise<WordStatEntry[]> {
    // 本地就是把事件跑一遍，沒有快取——資料量小，不值得多存一份會走鐘的東西
    return WordStat.from(read<AnswerEvent[]>(k.events(id), [])).entries()
  }

  async loadClassEvents(classCode: string): Promise<AnswerEvent[]> {
    const roster = read<string[]>(k.roster(classCode.trim().toUpperCase()), [])
    return roster.flatMap((id) => read<AnswerEvent[]>(k.events(id), []))
  }

  async loadTeacherOpen(classCode: string): Promise<string[]> {
    return read<string[]>(k.teacherOpen(classCode.trim().toUpperCase()), [])
  }

  async setTeacherOpen(classCode: string, levelIds: string[]): Promise<void> {
    write(k.teacherOpen(classCode.trim().toUpperCase()), levelIds)
  }

  // ------------------------------------------------------------ 老師與管理員
  //
  // 本地版沒有別人，所以這裡不做權限，只做「東西存得起來、讀得回來」。
  // 權限是資料庫的事，測權限要跑 ./tools/test/db.sh，不是拿本地版測。

  private staffRecord(): Staff {
    return read<Staff>(k.staff, {
      userId: 'local-staff', email: 'local@local', displayName: '老師', isAdmin: true,
    })
  }

  async staffSignUp(email: string, _password: string, displayName: string): Promise<Staff> {
    const staff: Staff = { userId: 'local-staff', email, displayName, isAdmin: true }
    write(k.staff, staff)
    return staff
  }

  async staffLogin(email: string, _password: string): Promise<Staff> {
    const staff = { ...this.staffRecord(), email }
    write(k.staff, staff)
    return staff
  }

  async currentStaff(): Promise<Staff | null> {
    return read<Staff | null>(k.staff, null)
  }

  async staffLogout(): Promise<void> {
    write(k.staff, null)
  }

  async listClasses(): Promise<ClassRoom[]> {
    return read<ClassRoom[]>(k.classes, [])
  }

  async createClass(code: string, name: string): Promise<ClassRoom> {
    const room: ClassRoom = { code: code.trim().toUpperCase(), name: name.trim(), open: true }
    const all = read<ClassRoom[]>(k.classes, []).filter((c) => c.code !== room.code)
    write(k.classes, [...all, room])
    return room
  }

  async setClassOpen(code: string, open: boolean): Promise<boolean> {
    const all = read<ClassRoom[]>(k.classes, [])
    write(k.classes, all.map((c) => (c.code === code ? { ...c, open } : c)))
    return open
  }

  async regenerateClassCode(code: string): Promise<string> {
    return code
  }

  async classLeaderboard(classCode?: string): Promise<LeaderRow[]> {
    const me = await this.currentStudent()
    const code = (classCode ?? me?.classCode ?? '').trim().toUpperCase()
    if (!code) return []
    const rows = read<string[]>(k.roster(code), []).map((id) => {
      const s = read<Student | null>(k.student(id), null)
      const c = read<Character | null>(k.character(id), null)
      const p = read<LevelProgress[]>(k.progress(id), [])
      return {
        nickname: s?.nickname ?? '?',
        coins: c?.coins ?? 0,
        exp: c?.exp ?? 0,
        stars: p.reduce((n, x) => n + x.stars, 0),
        avatar: c?.avatar ?? '',
        equipped: c?.equipped ?? [],
        me: id === me?.id,
      }
    })
    // 排序規則要跟後端那支 RPC 一樣，不然本機測起來是對的、上線是另一回事。
    return rows.sort((a, b) => b.exp - a.exp || b.coins - a.coins)
  }

  async loadClassRoster(classCode: string): Promise<ClassRosterRow[]> {
    const roster = read<string[]>(k.roster(classCode.trim().toUpperCase()), [])
    return roster.map((id) => {
      const s = read<Student | null>(k.student(id), null)
      const c = read<Character | null>(k.character(id), null)
      const p = read<LevelProgress[]>(k.progress(id), [])
      return {
        studentId: id,
        nickname: s?.nickname ?? '?',
        coins: c?.coins ?? 0,
        exp: c?.exp ?? 0,
        stars: p.reduce((n, x) => n + x.stars, 0),
        answers: read<AnswerEvent[]>(k.events(id), []).length,
      }
    })
  }

  async addStudent(
    classCode: string, loginId: string, password: string, nickname: string,
  ): Promise<void> {
    await this.register(loginId, password, nickname, classCode)
  }

  async removeStudent(studentId_: string): Promise<void> {
    const s = read<Student | null>(k.student(studentId_), null)
    if (s?.classCode) {
      const roster = read<string[]>(k.roster(s.classCode), [])
      write(k.roster(s.classCode), roster.filter((x) => x !== studentId_))
    }
  }

  async resetStudentPassword(studentId_: string, password: string): Promise<void> {
    write(k.password(studentId_), scramble(password.toLowerCase()))
  }

  async claimFirstAdmin(): Promise<void> {
    write(k.staff, { ...this.staffRecord(), isAdmin: true })
  }

  async inviteTeacher(email: string): Promise<string> {
    return email
  }

  async createTeacher(email: string): Promise<AddedTeacher> {
    // 本地版沒有第二個人，開了也沒地方登入
    return { email: email.trim().toLowerCase(), created: true }
  }

  async listAllClasses(): Promise<AdminClassRow[]> {
    const s = read<Staff | null>(k.staff, null)
    return read<ClassRoom[]>(k.classes, []).map((c) => ({
      code: c.code, name: c.name, open: c.open,
      ownerId: s?.userId ?? '', ownerName: s?.displayName ?? '老師', ownerActive: true,
      students: read<string[]>(k.roster(c.code), []).length,
    }))
  }

  async setClassOwner(): Promise<void> {
    // 本地版只有一個人，沒有別的老師可以換
  }

  async hasAdmin(): Promise<boolean> {
    return read<Staff | null>(k.staff, null)?.isAdmin ?? false
  }

  async listTeachers(): Promise<TeacherRow[]> {
    const s = read<Staff | null>(k.staff, null)
    if (!s) return []
    return [{
      userId: s.userId, displayName: s.displayName, isAdmin: s.isAdmin, active: true,
      classes: read<ClassRoom[]>(k.classes, []).length, students: 0,
    }]
  }

  async listInvites(): Promise<{ email: string; used: boolean }[]> {
    return []
  }

  async setTeacherActive(): Promise<void> {
    // 本地版只有一個人，沒有要停用誰
  }
}
