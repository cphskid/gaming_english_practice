import { newCharacter, studentId } from '@/core/character'
import { buy, consume, count } from '@/core/inventory'
import { firstClearBonus, levelFromExp, mergeProgress, starsFor } from '@/core/progress'
import { LEVELS } from '@/data/levels'
import type { LevelData } from '@/core/types'
import { ITEMS } from '@/data/shop'
import { colorOf } from '@/data/cosmetics'
import { legionOf } from '@/data/legions'
import { AVATAR_BY_ID, avatarAfterJob } from '@/data/avatars'
import { WordStat } from '@/core/wordStat'
import type {
  AdminClassRow, AnswerEvent, Character, ClassRoom, LevelProgress, Staff, Student,
  TeacherRow, WordStatEntry,
} from '@/core/types'
import type {
  AchievementRow, AddedTeacher, BadgeCount, ClassRosterRow, LeaderRow, LevelResult, PublicProfile, WeeklySlot, WeeklyStar,
  Repository, RoomBrief, RoomMember, RoomState, RaidSeat, RaidSyncResult, RaidResult, SavedResult, VersusMatchInput, Ghost, GhostRow,
  LiveLobby, LiveMatchInfo, LiveSyncResult, LivePerson, FeedbackKind, FeedbackRow, FeedbackStatus,
} from './repository'
import { packMoves, unpackMoves, type PackedMove } from '@/core/opponent'
import { evaluateAchievements, tierOf, type AchValue, type VersusRecord } from '@/core/achievements'

/** 本地版存的徽章。舊資料沒有 tier，當成 1。 */
interface LocalAch { id: string; at: number; tier?: number; tierAt?: number }
import { ACHIEVEMENTS, ACH_BY_ID, CATEGORIES } from '@/data/achievements'

/** 本地版的真人對戰「伺服器」（見 livePoll） */
interface LocalLiveLobby {
  classCode: string; seeking: boolean; rate: number
  inviteTo: string | null; inviteAt: number; matchId: string | null; seen: number
}
interface LocalLive {
  lobby: Record<string, LocalLiveLobby>
  matches: Record<string, {
    p1: string; p2: string; classCode: string; how: 'random' | 'invite'; createdAt: number
    moves1: unknown[]; moves2: unknown[]; mark1: number; mark2: number; left1: boolean; left2: boolean
  }>
}

/** 本地版存的分身（最近一場） */
interface LocalGhost { legion: string; endedAt: number; correct: number; moves: PackedMove[] }

/** 本地版存下來的一場。跟 RoomState 差在沒有 here／me，那兩個是讀的時候才算的。 */
interface StoredRoom {
  id: string
  classCode: string
  bossId: string
  pass: string | null
  status: 'lobby' | 'playing' | 'done'
  startedAt: number | null
  seed: number | null
  /** 開這一場的學生。null＝老師開的。 */
  hostStudent: string | null
  hostName: string
  members: Omit<RoomMember, 'here' | 'me'>[]
  seats: Omit<RaidSeat, 'me'>[]
}

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
  rooms: (code: string) => `${NS}.rooms.${code}`,
  raidKills: (id: string) => `${NS}.raidKills.${id}`,
  raidDone: (id: string) => `${NS}.raidDone.${id}`,
  achievements: (id: string) => `${NS}.ach.${id}`,
  achProgress: (id: string) => `${NS}.achp.${id}`,
  matches: (id: string) => `${NS}.versus.${id}`,
  /** 最近一場的答題串（分身）。只留一場，跟正式版一樣只重播最近那一場。 */
  ghost: (id: string) => `${NS}.ghost.${id}`,
  itemUses: (id: string) => `${NS}.itemuses.${id}`,
  staff: `${NS}.staff`,
  live: `${NS}.live`,
  feedback: `${NS}.feedback`,
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
 * 現在登入的是誰。**每個分頁先看自己的**（sessionStorage），沒有才看整個瀏覽器共用的。
 *
 * 本地版原本一個瀏覽器只能是一個人；真人對戰要兩個人，本機測試就開兩個分頁
 * 各登入一個學生（tools/test/live-e2e.mjs）。平常只開一個分頁，行為跟以前一樣。
 */
function sessionOf(): string | null {
  try {
    const tab = sessionStorage.getItem(k.session)
    if (tab) return JSON.parse(tab) as string | null
  } catch { /* 讀不到就看共用的 */ }
  return read<string | null>(k.session, null)
}

function setSession(id: string | null): void {
  write(k.session, id)
  try { sessionStorage.setItem(k.session, JSON.stringify(id)) } catch { /* 存不進去就算了 */ }
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
    setSession(student.id)
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
    return this.remember({
      id, loginId: login, classCode: code, nickname: nickname.trim(), role: 'student',
      createdAt: Date.now(),
    })
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
    const id = sessionOf()
    return id ? read<Student | null>(k.student(id), null) : null
  }

  async logout(): Promise<void> {
    setSession(null)
  }

  async setPassword(oldPassword: string, newPassword: string): Promise<void> {
    const id = sessionOf()
    if (!id) throw new Error('請先登入')
    if (read<string | null>(k.password(id), null) !== scramble(oldPassword.toLowerCase())) {
      throw new Error('舊密碼不對')
    }
    write(k.password(id), scramble(newPassword.toLowerCase()))
  }

  async setNickname(nickname: string): Promise<string> {
    const id = sessionOf()
    const student = id ? read<Student | null>(k.student(id), null) : null
    if (!student) throw new Error('請先登入')
    const next = nickname.trim()
    write(k.student(id!), { ...student, nickname: next })
    return next
  }

  async joinClass(classCode: string): Promise<string> {
    const id = sessionOf()
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
    // 頭像跟著職業走：跟資料庫 set_job 做同一件事
    const prev = read<Character | null>(k.character(c.studentId), null)
    const avatar = c.avatar ? avatarAfterJob(c.avatar, c.job) : c.avatar
    const seen = c.avatarsSeen ?? prev?.avatarsSeen ?? []
    write(k.character(c.studentId), {
      ...c, avatar, avatarsSeen: !avatar || seen.includes(avatar) ? seen : [...seen, avatar],
    })
  }

  /**
   * 底下這四支在 Supabase 那邊是由資料庫把關的（價格、等級、餘額都在後端查）。
   * 本機版沒有後端可以把關，所以這裡只是把同一套規則再寫一次，
   * 讓沒接資料庫也玩得動——**它擋不住有心作弊的人，也不需要擋**，
   * 本機版的存檔本來就在自己的瀏覽器裡。
   */
  private current(): Character {
    const id = sessionOf()
    const c = id ? read<Character | null>(k.character(id), null) : null
    if (!c) throw new Error('請先登入')
    return c
  }

  async setAvatar(avatar: string): Promise<void> {
    const c = this.current()
    const def = AVATAR_BY_ID.get(avatar)
    if (!def) throw new Error('沒有這張頭像')
    if (def.job && def.job !== c.job) throw new Error('這張是別的職業的頭像，換職業才能用')
    if (!def.job && count(c, avatar) <= 0) throw new Error('這張頭像要先去商店買')
    // 換過哪些頭像要留著：avatar 只存現在這一個，成就數的是種類
    const seen = c.avatarsSeen ?? []
    write(k.character(c.studentId), {
      ...c, avatar, avatarsSeen: seen.includes(avatar) ? seen : [...seen, avatar],
    })
  }

  async buyItem(itemId: string): Promise<{ coins: number; items: Record<string, number> }> {
    const c = this.current()
    const item = ITEMS.find((i) => i.id === itemId)
    if (!item) throw new Error('商店裡沒有這個東西')
    if (item.free) throw new Error('這個是送的，不用買，去「我的角色」直接換上')
    if (levelFromExp(c.exp) < item.unlockLevel) {
      throw new Error(`等級不夠，要 ${item.unlockLevel} 級才買得到`)
    }
    if (item.needAchievement
      && !read<LocalAch[]>(k.achievements(c.studentId), []).some((a) => a.id === item.needAchievement)) {
      throw new Error('要先拿到指定的成就才買得到')
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
    if (on && !count(c, itemId) && !item.free) throw new Error('你還沒有這個東西')
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

  async consumeItem(
    itemId: string, sessionId?: string, levelId?: string,
  ): Promise<Record<string, number>> {
    const c = this.current()
    const next = consume(c, itemId)
    if (!next) throw new Error('你沒有這個道具了')
    write(k.character(c.studentId), next)
    // 用在哪一場要留著：背包只存剩幾個，用完歸零就看不出來用過什麼
    const uses = read<{ itemId: string; sessionId: string | null; levelId: string | null }[]>(
      k.itemUses(c.studentId), [])
    uses.push({ itemId, sessionId: sessionId ?? null, levelId: levelId ?? null })
    write(k.itemUses(c.studentId), uses)
    return next.items
  }

  async loadProgress(id: string): Promise<LevelProgress[]> {
    return read<LevelProgress[]>(k.progress(id), [])
  }

  /**
   * 星星在這裡也是算出來的，不是接收來的——規則要跟資料庫那支
   * save_progress 一模一樣，不然本機測起來對、上線是另一回事。
   */
  async saveResult(r: LevelResult): Promise<SavedResult> {
    const c = this.current()
    const id = c.studentId
    const level = LEVELS.find((l) => l.id === r.levelId)
    if (!level) throw new Error('沒有這一關：' + r.levelId)

    const mine = read<AnswerEvent[]>(k.events(id), [])
      .filter((e) => e.sessionId === r.sessionId && e.levelId === r.levelId)
    const correct = mine.filter((e) => e.correct).length
    // 怪只會被齊射打死，齊射只有答對才會發生——答對數連下限都不到就不是真的打過的
    const win = r.win && correct >= minCorrectOf(level)
    const next: LevelProgress = {
      levelId: r.levelId,
      stars: starsFor({ outcome: { win, survival: r.survival, detail: '' }, correct, asked: mine.length }),
      bestCorrect: correct,
      clearedAt: win ? Date.now() : null,
      bestSurvival: win ? Math.max(0, Math.min(1, r.survival)) : 0,
      lastWinSession: win ? r.sessionId : null,
    }

    const all = read<LevelProgress[]>(k.progress(id), [])
    const i = all.findIndex((x) => x.levelId === r.levelId)
    const was = i >= 0 ? all[i] : undefined
    const merged = mergeProgress(was, next)
    if (i >= 0) all[i] = merged
    else all.push(merged)
    write(k.progress(id), all)

    // 用哪個職業通關過。職業隨時能改，所以要在通關那一刻記（「雙修」要用）。
    if (win) {
      const cur = this.current()
      if (!(cur.jobsCleared ?? []).includes(cur.job)) {
        write(k.character(id), { ...cur, jobsCleared: [...(cur.jobsCleared ?? []), cur.job] })
      }
    }

    // 真的有答題才算「穿著這個顏色打過一場」（跟資料庫的 note_color_played 同一條）
    if (mine.length > 0) this.noteColorPlayed()

    // 首通獎金也在這裡發，跟資料庫那邊同一條規則：第一次真的通關才有
    const bonusCoins = win && !was?.clearedAt ? firstClearBonus(level, false) : 0
    if (bonusCoins) write(k.character(id), { ...this.current(), coins: this.current().coins + bonusCoins })
    return { progress: merged, bonusCoins }
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
      // 同一題不可以進來兩次。結算失敗時人可以按重試，重試會把整場再送一遍——
      // 後端是靠 (學生, 這一場, 第幾題) 擋的，本機版也要擋，不然兩邊行為不一樣，
      // 本機測起來對、上線是另一回事。
      const seen = new Set(all.map((e) => `${e.sessionId}:${e.ord}`))
      for (const e of list) {
        const key = `${e.sessionId}:${e.ord}`
        if (seen.has(key)) continue
        seen.add(key)
        all.push(e)
      }
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

  // ------------------------------------------------------------------ 房間（魔王團戰）
  //
  // 本地版只有一個人，所以房間在這裡沒什麼戲唱：開得起來、進得去、狀態會變，
  // 就夠讓選關畫面與老師後台在沒有後端的情況下也跑得動（keyless 的開發伺服器
  // 與版面測試都靠這個）。真正的多人在 Supabase 版，要測就得打真的資料庫。
  //
  // 魔王團戰至少要兩個人，本地版開打時補一位「練習夥伴」，
  // 他一開場就算斷線、由電腦接手（跟正式版斷線接手走同一條路），
  // 一個人也打得起來，畫面測試才跑得動。

  private rooms(code: string): StoredRoom[] {
    // 2026-09-25 以前存的舊房間（一起打同一關）沒有 bossId，當作不存在
    return read<StoredRoom[]>(k.rooms(code), []).filter((r) => r.status !== 'done' && r.bossId)
  }

  private putRooms(code: string, rooms: StoredRoom[]): void {
    write(k.rooms(code), rooms)
  }

  /** 房間是照班級存的，但外面拿在手上的是房間 id，所以要先找出是哪一班的。 */
  private async classOfRoom(roomId: string): Promise<string | null> {
    const codes = [...read<ClassRoom[]>(k.classes, []).map((c) => c.code),
                   (await this.currentStudent())?.classCode ?? '']
    for (const code of codes) {
      if (code && this.rooms(code).some((r) => r.id === roomId)) return code
    }
    return null
  }

  private async patchRoom(roomId: string, f: (r: StoredRoom) => StoredRoom): Promise<void> {
    const code = await this.classOfRoom(roomId)
    if (!code) return
    this.putRooms(code, this.rooms(code).map((r) => (r.id === roomId ? f(r) : r)))
  }

  private async roomOf(roomId: string): Promise<StoredRoom | null> {
    const code = await this.classOfRoom(roomId)
    return code ? this.rooms(code).find((r) => r.id === roomId) ?? null : null
  }

  async openRaid(
    bossId: string, pass: string | null, classCode?: string, rate = 14, familiar?: number,
  ): Promise<string> {
    if (pass && !/^[0-9]{4}$/.test(pass)) throw new Error('密碼要四位數字')
    const me = classCode ? null : await this.currentStudent()
    const code = classCode ? classCode.trim().toUpperCase() : me?.classCode
    if (!code) throw new Error('還沒加入班級，沒辦法揪人')
    const room: StoredRoom = {
      id: 'room-' + Math.random().toString(36).slice(2, 10),
      classCode: code, bossId, pass: pass || null, status: 'lobby', startedAt: null, seed: null,
      hostStudent: me?.id ?? null, hostName: me?.nickname ?? '', members: [], seats: [],
    }
    if (me) {
      const c = await this.loadCharacter(me.id)
      room.members = [{
        studentId: me.id, nickname: me.nickname, host: true, team: null,
        avatar: c.avatar, equipped: c.equipped, finished: false, rate, familiar: familiar ?? null,
      }, {
        // 本地版只有一個人，補一位練習夥伴湊滿兩個人（見上面的說明）
        studentId: 'local-buddy', nickname: '練習夥伴', host: false, team: null,
        avatar: '', equipped: [], finished: false, rate, familiar: null,
      }]
    }
    this.putRooms(code, [...this.rooms(code).filter((r) => !me || r.hostStudent !== me.id), room])
    return room.id
  }

  async kickFromRoom(roomId: string, studentId: string): Promise<void> {
    await this.patchRoom(roomId, (r) => ({ ...r, members: r.members.filter((m) => m.studentId !== studentId) }))
  }

  async startRoom(roomId: string): Promise<void> {
    await this.patchRoom(roomId, (r) => {
      const seats: StoredRoom['seats'] = r.members.slice(0, 6).map((m, i) => ({
        seat: i, studentId: m.studentId, nickname: m.nickname, rate: m.rate,
        avatar: m.avatar, equipped: m.equipped,
      }))
      return { ...r, status: 'playing', startedAt: Date.now(), seed: 1 + ((Math.random() * 2e9) | 0), seats }
    })
  }

  async closeRoom(roomId: string): Promise<void> {
    await this.patchRoom(roomId, (r) => ({ ...r, status: 'done' }))
  }

  async joinRoom(roomId?: string, pass?: string, rate = 14, familiar?: number): Promise<string> {
    const me = await this.currentStudent()
    if (!me?.classCode) throw new Error('還沒加入班級')
    const open = this.rooms(me.classCode)
    // 不指定就進老師那場，沒有就進最新的一場。
    const room = roomId ? open.find((r) => r.id === roomId)
      : open.find((r) => !r.hostStudent) ?? open[open.length - 1]
    if (!room) throw new Error('這一場已經結束了')
    if (!room.members.some((m) => m.studentId === me.id)) {
      if (room.status !== 'lobby') throw new Error('這一場已經開打了，等下一場')
      if (room.pass && room.pass !== (pass ?? '').trim()) throw new Error('密碼不對')
      if (room.members.length >= 6) throw new Error('這一場滿了（最多六個人）')
      const c = await this.loadCharacter(me.id)
      room.members.push({
        studentId: me.id, nickname: me.nickname, host: room.hostStudent === me.id,
        team: null, avatar: c.avatar, equipped: c.equipped, finished: false, rate,
        familiar: familiar ?? null,
      })
    }
    // 同時只在一場裡
    this.putRooms(me.classCode, open.map((r) => (r.id === room.id ? room : {
      ...r, members: r.members.filter((m) => m.studentId !== me.id),
    })))
    return room.id
  }

  async leaveRoom(roomId: string): Promise<void> {
    const me = await this.currentStudent()
    await this.patchRoom(roomId, (r) => (
      r.hostStudent && r.hostStudent === me?.id
        ? { ...r, status: 'done' }
        : { ...r, members: r.members.filter((m) => m.studentId !== me?.id) }
    ))
  }

  async roomList(classCode?: string): Promise<RoomBrief[]> {
    const me = await this.currentStudent()
    const code = classCode ? classCode.trim().toUpperCase() : me?.classCode ?? null
    if (!code) return []
    return this.rooms(code)
      .map((r) => ({
        id: r.id, bossId: r.bossId, locked: !!r.pass, members: r.members.length, mode: 'raid' as const,
        status: r.status as 'lobby' | 'playing',
        hostName: r.hostName, byTeacher: !r.hostStudent,
        mine: r.members.some((m) => m.studentId === me?.id),
        here: r.members.length,
      }))
      .sort((a, b) => Number(b.byTeacher) - Number(a.byTeacher))
  }

  async roomState(roomId: string): Promise<RoomState | null> {
    const me = await this.currentStudent()
    const room = await this.roomOf(roomId)
    if (!room) return null
    return {
      id: room.id, classCode: room.classCode, bossId: room.bossId, locked: !!room.pass,
      pass: room.pass, seed: room.seed, noListen: true,
      mode: 'raid', status: room.status, startedAt: room.startedAt,
      byTeacher: !room.hostStudent,
      // 本地版沒有老師與學生之分，開得了就作得了主。
      mine: true,
      // 本地版沒有別台裝置，所以在不在線上永遠是「在」。
      members: room.members.map((m) => ({ ...m, here: true, me: m.studentId === me?.id })),
      seats: room.seats.map((s) => ({ ...s, me: s.studentId === me?.id })),
    }
  }

  async roomPlaying(roomId: string, _sessionId: string): Promise<void> {
    await this.markMe(roomId, false)
  }

  async roomFinished(roomId: string): Promise<void> {
    await this.markMe(roomId, true)
  }

  private async markMe(roomId: string, finished: boolean): Promise<void> {
    const me = await this.currentStudent()
    await this.patchRoom(roomId, (r) => ({
      ...r,
      members: r.members.map((m) => (m.studentId === me?.id ? { ...m, finished } : m)),
    }))
  }

  /** 本地版的同步：只有我一個真人，其他座位開場就算斷線（由電腦接手）。 */
  private raidMoves = new Map<string, unknown[]>()

  async raidSync(
    roomId: string, base: number, moves: unknown[], mark: number, from: number[], _left: boolean,
  ): Promise<RaidSyncResult> {
    const room = await this.roomOf(roomId)
    const me = await this.currentStudent()
    const mySeat = room?.seats.find((s) => s.studentId === me?.id)?.seat ?? 0
    const mine = this.raidMoves.get(roomId) ?? []
    if (base <= mine.length) mine.push(...moves.slice(mine.length - base))
    this.raidMoves.set(roomId, mine)
    return {
      mine: mine.length, gone: false,
      seats: (room?.seats ?? []).map((s) => (s.seat === mySeat
        ? { moves: mine.slice(from[s.seat] ?? 0), mark, final: null }
        : { moves: [], mark: -1, final: -1 })),
    }
  }

  async raidResult(
    roomId: string, won: boolean, _dealt: number, _correct: number, _sessionId: string,
  ): Promise<RaidResult> {
    const me = await this.currentStudent()
    const room = await this.roomOf(roomId)
    if (!me || !room) return { confirmed: false, kills: 0, first: false }
    const kills = read<Record<string, number>>(k.raidKills(me.id), {})
    const done = read<string[]>(k.raidDone(me.id), [])
    let first = false
    if (won && !done.includes(roomId)) {
      kills[room.bossId] = (kills[room.bossId] ?? 0) + 1
      first = kills[room.bossId] === 1
      write(k.raidKills(me.id), kills)
      write(k.raidDone(me.id), [...done, roomId].slice(-50))
      const c = await this.loadCharacter(me.id)
      const frame = 'frame-boss-' + room.bossId
      if (!c.items[frame]) write(k.character(me.id), { ...c, items: { ...c.items, [frame]: 1 } })
    }
    await this.closeRoom(roomId)
    return { confirmed: won, kills: kills[room.bossId] ?? 0, first }
  }

  async raidKills(studentId?: string): Promise<Record<string, number>> {
    const id = studentId ?? (await this.currentStudent())?.id
    return id ? read<Record<string, number>>(k.raidKills(id), {}) : {}
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

  async setClassLiveListen(code: string, on: boolean): Promise<boolean> {
    const all = read<ClassRoom[]>(k.classes, [])
    write(k.classes, all.map((c) => (c.code === code ? { ...c, liveListen: on } : c)))
    return on
  }

  // ---------------------------------------------------------------- 成就
  //
  // **本地版是鏡像，不是真相。** 真正算數的是 supabase/schema.sql 的
  // refresh_achievements()；這裡照 src/core/achievements.ts 那份規則算一次，
  // 讓沒有金鑰的開發環境也看得到徽章牆。

  async loadAchievements(): Promise<AchievementRow[]> {
    const c = this.current()
    const got = new Map(read<LocalAch[]>(k.achievements(c.studentId), []).map((x) => [x.id, x]))
    const vals = read<Record<string, AchValue>>(k.achProgress(c.studentId), {})
    return ACHIEVEMENTS.map((a) => {
      const g = got.get(a.id)
      return {
        id: a.id, category: a.category, unlockedAt: g?.at ?? null,
        tier: g ? g.tier ?? 1 : 0, tierAt: g ? g.tierAt ?? g.at : null,
        value: vals[a.id]?.value ?? 0, goalAll: vals[a.id]?.all ?? 0,
      }
    })
  }

  async refreshAchievements(): Promise<string[]> {
    const c = this.current()
    const id = c.studentId
    const have = read<LocalAch[]>(k.achievements(id), [])
    const byId = new Map(have.map((x) => [x.id, { ...x }]))
    const student = read<Student | null>(k.student(id), null)

    const { got, values } = evaluateAchievements({
      events: read<AnswerEvent[]>(k.events(id), []),
      stats: (await this.loadWordStats(id)),
      progress: read<LevelProgress[]>(k.progress(id), []),
      character: c,
      matches: read<VersusRecord[]>(k.matches(id), []),
      itemUses: read<{ itemId: string; sessionId: string | null }[]>(k.itemUses(id), []),
      createdAt: student?.createdAt ?? 0,
      raidKills: read<Record<string, number>>(k.raidKills(id), {}),
      bossCount: ITEMS.filter((x) => x.id.startsWith('frame-boss-')).length,
    })
    write(k.achProgress(id), values)

    const now = Date.now()
    const out: string[] = []
    for (const x of got) {
      if (byId.has(x) || !ACH_BY_ID.has(x) || ACH_BY_ID.get(x)!.tiers) continue
      byId.set(x, { id: x, at: now, tier: 1 })
      out.push(x)
    }
    // 分階：只升不降，跟 SQL 的 ach_put 一樣
    for (const [x, v] of Object.entries(values)) {
      if (!ACH_BY_ID.get(x)?.tiers) continue
      const t = tierOf(x, v)
      const old = byId.get(x)
      if (t > 0 && t > (old?.tier ?? 0)) {
        byId.set(x, { id: x, at: old?.at ?? now, tier: t, tierAt: now })
        out.push(`${x}:${t}`)
      }
    }

    // 全能生：每一個大類都至少一個（它自己不算）
    const cats = new Set(ACHIEVEMENTS.filter((a) => byId.has(a.id) && a.id !== 'all-rounder')
      .map((a) => a.category))
    if (cats.size >= CATEGORIES.length && !byId.has('all-rounder')) {
      byId.set('all-rounder', { id: 'all-rounder', at: now, tier: 1 })
      out.push('all-rounder')
    }

    if (out.length) {
      write(k.achievements(id), [...byId.values()])
      // 獎品：成就限定的外框直接放進背包，不用去商店領（分階的要到 rewardTier）
      let next = this.current()
      for (const a of byId.values()) {
        const def = ACH_BY_ID.get(a.id)
        const item = def?.rewardItem
        if (item && (a.tier ?? 1) >= (def.rewardTier ?? 1) && !(next.items[item] > 0)) {
          next = { ...next, items: { ...next.items, [item]: 1 } }
        }
      }
      write(k.character(id), next)
    }
    return out
  }

  /**
   * 本地版的本週之星，規則照 schema.sql 的 class_weekly_stars 抄。
   * 本地版沒有記魔王團戰是哪一週打的，所以少了「魔王 MVP」那一格。
   */
  async classWeeklyStars(classCode?: string): Promise<WeeklyStar[]> {
    const me = await this.currentStudent()
    const code = (classCode ?? me?.classCode ?? '').trim().toUpperCase()
    if (!code) return []
    const roster = read<string[]>(k.roster(code), [])
    const now = Date.now()
    const TW = 8 * 3600_000, DAY = 86400_000
    const tw = new Date(now + TW)
    const start = Math.floor((now + TW) / DAY) * DAY - ((tw.getUTCDay() + 6) % 7) * DAY - TW
    // ISO 週數（跟 Postgres 的 extract(week) 一樣），神祕格照它輪
    const th = new Date(start + TW + 3 * DAY)
    const jan4 = new Date(Date.UTC(th.getUTCFullYear(), 0, 4))
    const week = 1 + Math.round((th.getTime() - jan4.getTime()) / (7 * DAY)
      - ((jan4.getUTCDay() + 6) % 7 - 3) / 7)
    const mys = (['spell', 'listen', 'days'] as const)[week % 3]
    // 有效答對：同字同技能同一天最多 5 次
    const ok = (sid: string, from: number, to: number, skill?: string) => {
      const n = new Map<string, number>()
      for (const e of read<AnswerEvent[]>(k.events(sid), [])) {
        if (!e.correct || e.at < from || e.at >= to || (skill && e.skill !== skill)) continue
        const key = `${e.wordId}|${e.skill}|${Math.floor((e.at + TW) / DAY)}`
        n.set(key, Math.min(5, (n.get(key) ?? 0) + 1))
      }
      return {
        n: [...n.values()].reduce((a, b) => a + b, 0),
        days: new Set([...n.keys()].map((x) => x.split('|')[2])).size,
      }
    }
    const nick = (sid: string) => read<Student | null>(k.student(sid), null)?.nickname ?? '?'
    const byNick = (a: { sid: string }, b: { sid: string }) => nick(a.sid).localeCompare(nick(b.sid))
    const used = new Set<string>()
    const out: WeeklyStar[] = []
    const put = (slot: WeeklySlot, cands: { sid: string; value: number; extra: string; rank: number }[]) => {
      const best = cands.filter((c) => !used.has(c.sid))
        .sort((a, b) => b.rank - a.rank || byNick(a, b))[0]
      if (!best) return
      used.add(best.sid)
      const c = read<Character | null>(k.character(best.sid), null)
      out.push({
        slot, studentId: best.sid, nickname: nick(best.sid), avatar: c?.avatar ?? '',
        equipped: c?.equipped ?? [], value: best.value, extra: best.extra, me: best.sid === me?.id,
        viewable: best.sid === me?.id || (c?.publicProfile ?? true),
      })
    }
    const week1 = roster.map((sid) => ({ sid, ...ok(sid, start, now) }))
    put('most', week1.filter((w) => w.n > 0).map((w) => ({ sid: w.sid, value: w.n, extra: '', rank: w.n })))
    put('improve', week1.flatMap((w) => {
      const last = ok(w.sid, start - 7 * DAY, now - 7 * DAY).n
      return w.n >= 10 && w.n > last ? [{ sid: w.sid, value: w.n - last, extra: String(last), rank: w.n - last }] : []
    }))
    const achs = new Map(roster.map((sid) => [sid, read<LocalAch[]>(k.achievements(sid), [])]))
    const holders = (id: string, tier: number) =>
      [...achs.values()].filter((l) => l.some((a) => a.id === id && (a.tier ?? 1) >= tier)).length
    put('rare', [...achs.entries()].flatMap(([sid, list]) => list
      .filter((a) => (a.tierAt ?? a.at) >= start)
      .map((a) => {
        const h = holders(a.id, a.tier ?? 1)
        return { sid, value: h, extra: `${a.id}:${a.tier ?? 1}`, rank: -h * 10 + (a.tier ?? 1) }
      })))
    put('mystery', roster.flatMap((sid) => {
      const w = ok(sid, start, now, mys === 'days' ? undefined : mys)
      const v = mys === 'days' ? w.days : w.n
      return w.n > 0 ? [{ sid, value: v, extra: mys, rank: v * 100000 + w.n }] : []
    }))
    return out
  }

  async classBadgeCounts(classCode?: string): Promise<BadgeCount[]> {
    const me = await this.currentStudent()
    const code = (classCode ?? me?.classCode ?? '').trim().toUpperCase()
    if (!code) return []
    const roster = read<string[]>(k.roster(code), [])
    const n = new Map<string, number>()
    for (const sid of roster) {
      for (const a of read<LocalAch[]>(k.achievements(sid), [])) {
        for (let t = 1; t <= (a.tier ?? 1); t++) n.set(a.id + ':' + t, (n.get(a.id + ':' + t) ?? 0) + 1)
      }
    }
    return [...n.entries()].map(([key, holders]) => {
      const [aid, t] = key.split(':')
      return { id: aid, tier: Number(t), holders, classSize: roster.length }
    })
  }

  async setPinned(ids: string[]): Promise<string[]> {
    const c = this.current()
    const mine = new Set(read<{ id: string }[]>(k.achievements(c.studentId), []).map((x) => x.id))
    const pinned = ids.filter((x) => mine.has(x)).slice(0, 3)
    write(k.character(c.studentId), { ...c, pinned })
    return pinned
  }

  async setTitle(achievementId: string): Promise<string> {
    const c = this.current()
    const mine = new Set(read<{ id: string }[]>(k.achievements(c.studentId), []).map((x) => x.id))
    const title = achievementId && mine.has(achievementId)
      ? ACH_BY_ID.get(achievementId)?.rewardTitle ?? '' : ''
    write(k.character(c.studentId), { ...c, title })
    return title
  }

  async setPublicProfile(open: boolean): Promise<boolean> {
    const c = this.current()
    write(k.character(c.studentId), { ...c, publicProfile: open })
    return open
  }

  async publicProfile(studentId: string): Promise<PublicProfile> {
    const me = await this.currentStudent()
    const s = read<Student | null>(k.student(studentId), null)
    const c = read<Character | null>(k.character(studentId), null)
    if (!s || !c) throw new Error('沒有這個人')
    if (studentId !== me?.id && !(c.publicProfile ?? true)) {
      throw new Error('這位同學把檔案關起來了')
    }
    const p = read<LevelProgress[]>(k.progress(studentId), [])
    return {
      nickname: s.nickname,
      avatar: c.avatar,
      equipped: c.equipped,
      title: c.title ?? '',
      pinned: c.pinned ?? [],
      badges: read<LocalAch[]>(k.achievements(studentId), []).map((x) => x.id),
      tiers: Object.fromEntries(read<LocalAch[]>(k.achievements(studentId), [])
        .map((x) => [x.id, x.tier ?? 1])),
      stars: p.reduce((n, x) => n + x.stars, 0),
      level: levelFromExp(c.exp),
    }
  }

  async recordVersusMatch(m: VersusMatchInput): Promise<void> {
    const c = this.current()
    const all = read<VersusRecord[]>(k.matches(c.studentId), [])
    // 同一場重送不會變成兩筆
    if (all.some((x) => x.sessionId === m.sessionId)) return
    all.push({
      sessionId: m.sessionId,
      opponentKind: m.opponentKind,
      opponentName: m.opponentName,
      opponentStudent: m.opponentStudent,
      liveMatch: m.liveMatch,
      won: m.won,
      front: m.front,
      lowestFront: m.lowestFront,
      linesUsed: m.linesUsed as VersusRecord['linesUsed'],
      topTier: m.topTier,
      endedAt: Date.now(),
    })
    write(k.matches(c.studentId), all)
    if (m.moves.length) {
      write(k.ghost(c.studentId), {
        legion: legionOf(c.equipped).id, endedAt: Date.now(),
        correct: m.moves.filter((x) => x.act === 'answer' && x.correct).length,
        moves: packMoves(m.moves),
      })
    }
    this.noteColorPlayed()
  }

  async listGhosts(): Promise<GhostRow[]> {
    const me = await this.currentStudent()
    if (!me?.classCode) return []
    return read<string[]>(k.roster(me.classCode), []).flatMap((id) => {
      if (id === me.id) return []
      const g = read<LocalGhost | null>(k.ghost(id), null)
      if (!g) return []
      const s = read<Student | null>(k.student(id), null)
      const c = read<Character | null>(k.character(id), null)
      return [{
        studentId: id, nickname: s?.nickname ?? '?', avatar: c?.avatar ?? '',
        legion: g.legion, endedAt: g.endedAt, correct: g.correct,
      }]
    }).sort((a, b) => b.endedAt - a.endedAt)
  }

  // ------------------------------------------------------------ 真人即時對戰
  //
  // 本機版的「伺服器」就是 localStorage 裡的一包（同一個瀏覽器的分頁共用），
  // 規則照 schema.sql 的 live_poll / live_invite / live_accept / live_sync 抄一份。
  // 只有同一個瀏覽器開兩個分頁才打得起來——本來就只拿來測。

  private liveState(): LocalLive {
    return read<LocalLive>(k.live, { lobby: {}, matches: {} })
  }

  private liveMatchFor(st: LocalLive, id: string, me: string): LiveMatchInfo | null {
    const m = st.matches[id]
    if (!m || (m.p1 !== me && m.p2 !== me)) return null
    const foe = m.p1 === me ? m.p2 : m.p1
    const s = read<Student | null>(k.student(foe), null)
    const c = read<Character | null>(k.character(foe), null)
    const cls = read<ClassRoom[]>(k.classes, []).find((x) => x.code === m.classCode)
    return {
      id, seat: m.p1 === me ? 1 : 2, foe, foeName: s?.nickname ?? '?', foeAvatar: c?.avatar ?? '',
      foeLegion: c ? legionOf(c.equipped).id : '', foeRate: st.lobby[foe]?.rate ?? 14,
      noListen: !cls?.liveListen, how: m.how,
    }
  }

  private person(id: string): LivePerson {
    const s = read<Student | null>(k.student(id), null)
    const c = read<Character | null>(k.character(id), null)
    return { id, nickname: s?.nickname ?? '?', avatar: c?.avatar ?? '' }
  }

  async livePoll(seeking: boolean, rate: number): Promise<LiveLobby> {
    const me = await this.currentStudent()
    if (!me?.classCode) throw new Error('還沒加入班級')
    const now = Date.now()
    const st = this.liveState()
    const row = st.lobby[me.id] ?? { classCode: me.classCode, seeking, rate, inviteTo: null, inviteAt: 0, matchId: null, seen: now }
    Object.assign(row, { classCode: me.classCode, seeking, rate, seen: now })
    st.lobby[me.id] = row
    if (row.matchId && !(st.matches[row.matchId]?.createdAt > now - 20000)) row.matchId = null
    if (!row.matchId && seeking) {
      const other = Object.entries(st.lobby)
        .filter(([id, l]) => id !== me.id && l.classCode === me.classCode && l.seeking && !l.matchId && l.seen > now - 6000)
        .sort((a, b) => Math.abs(a[1].rate - rate) - Math.abs(b[1].rate - rate))[0]
      if (other) this.liveOpen(st, other[0], me.id, me.classCode, 'random')
    }
    write(k.live, st)
    return {
      match: row.matchId ? this.liveMatchFor(st, row.matchId, me.id) : null,
      inviting: row.inviteAt > now - 20000 ? row.inviteTo : null,
      invites: Object.entries(st.lobby)
        .filter(([, l]) => l.inviteTo === me.id && l.inviteAt > now - 20000 && l.seen > now - 6000 && !l.matchId)
        .map(([id]) => this.person(id)),
      online: Object.entries(st.lobby)
        .filter(([id, l]) => id !== me.id && l.classCode === me.classCode && l.seen > now - 6000)
        .map(([id, l]) => ({ ...this.person(id), busy: !!l.matchId })),
    }
  }

  private liveOpen(st: LocalLive, p1: string, p2: string, classCode: string, how: 'random' | 'invite'): string {
    const id = `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    st.matches[id] = {
      p1, p2, classCode, how, createdAt: Date.now(),
      moves1: [], moves2: [], mark1: -1, mark2: -1, left1: false, left2: false,
    }
    for (const who of [p1, p2]) Object.assign(st.lobby[who], { matchId: id, seeking: false, inviteTo: null, inviteAt: 0 })
    return id
  }

  async liveInvite(to: string | null): Promise<boolean> {
    const me = await this.currentStudent()
    if (!me?.classCode) throw new Error('還沒加入班級')
    const st = this.liveState()
    const row = st.lobby[me.id]
    if (!row) return false
    const target = to ? st.lobby[to] : null
    if (!to || !target || to === me.id || target.classCode !== me.classCode || target.seen < Date.now() - 6000) {
      row.inviteTo = null; row.inviteAt = 0
      if (!to) row.seeking = false
      write(k.live, st)
      return false
    }
    Object.assign(row, { inviteTo: to, inviteAt: Date.now(), seeking: false })
    write(k.live, st)
    return true
  }

  async liveAccept(from: string): Promise<LiveMatchInfo | null> {
    const me = await this.currentStudent()
    if (!me?.classCode) throw new Error('還沒加入班級')
    const st = this.liveState()
    const now = Date.now()
    const a = st.lobby[from]
    const b = st.lobby[me.id]
    const free = (l: LocalLiveLobby) => !l.matchId || !(st.matches[l.matchId]?.createdAt > now - 20000)
    if (!a || !b || from === me.id || a.inviteTo !== me.id || a.inviteAt < now - 20000
        || a.seen < now - 6000 || !free(a) || !free(b)) return null
    const id = this.liveOpen(st, from, me.id, me.classCode, 'invite')
    write(k.live, st)
    return this.liveMatchFor(st, id, me.id)
  }

  async liveSync(
    matchId: string, base: number, moves: unknown[], mark: number, theirFrom: number, left: boolean,
  ): Promise<LiveSyncResult> {
    const me = await this.currentStudent()
    const st = this.liveState()
    const m = st.matches[matchId]
    if (!me || !m || (m.p1 !== me.id && m.p2 !== me.id)) throw new Error('不是你的對戰')
    const one = m.p1 === me.id
    const mine = one ? m.moves1 : m.moves2
    if (st.lobby[me.id]?.matchId === matchId) st.lobby[me.id].matchId = null
    if (base <= mine.length) {
      mine.push(...moves.slice(mine.length - base))
      if (one) m.mark1 = Math.max(m.mark1, mark); else m.mark2 = Math.max(m.mark2, mark)
    }
    if (left) { if (one) m.left1 = true; else m.left2 = true }
    write(k.live, st)
    const theirs = one ? m.moves2 : m.moves1
    return {
      mine: mine.length, theirs: theirs.slice(Math.max(0, theirFrom)),
      theirMark: one ? m.mark2 : m.mark1, theirLeft: one ? m.left2 : m.left1,
    }
  }

  async loadGhost(studentId: string): Promise<Ghost | null> {
    const me = await this.currentStudent()
    const s = read<Student | null>(k.student(studentId), null)
    const g = read<LocalGhost | null>(k.ghost(studentId), null)
    if (!me?.classCode || !s || s.classCode !== me.classCode || !g) return null
    return { studentId, nickname: s.nickname, legion: g.legion, moves: unpackMoves(g.moves) }
  }

  /** 記下穿著哪個顏色打了一場。換上別的軍團時顏色沒作用，不算。 */
  private noteColorPlayed() {
    const c = this.current()
    if (legionOf(c.equipped).id) return
    const color = colorOf(c.equipped).id || 'blue'
    const seen = c.colorsPlayed ?? []
    if (!seen.includes(color)) write(k.character(c.studentId), { ...c, colorsPlayed: [...seen, color] })
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
        studentId: id,
        nickname: s?.nickname ?? '?',
        coins: c?.coins ?? 0,
        exp: c?.exp ?? 0,
        stars: p.reduce((n, x) => n + x.stars, 0),
        avatar: c?.avatar ?? '',
        equipped: c?.equipped ?? [],
        me: id === me?.id,
        title: c?.title ?? '',
        badges: read<LocalAch[]>(k.achievements(id), []).length,
        pins: (c?.pinned ?? []).flatMap((pid) => {
          const a = read<LocalAch[]>(k.achievements(id), []).find((x) => x.id === pid)
          return a ? [{ id: pid, tier: a.tier ?? 1 }] : []
        }),
        // 本地版沒有老師身分，自己的一定看得到，別人的看他有沒有關起來
        viewable: id === me?.id || (c?.publicProfile ?? true),
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

  async setStudentNickname(studentId_: string, nickname: string): Promise<string> {
    const s = read<Student | null>(k.student(studentId_), null)
    if (!s) throw new Error('找不到這個學生')
    const next = nickname.trim()
    write(k.student(studentId_), { ...s, nickname: next })
    return next
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

  // 禁用字只在伺服器上比對，本地版不擋
  async listBannedWords(): Promise<{ word: string; whole: boolean }[]> { return [] }
  async addBannedWord(word: string): Promise<string> { return word }
  async removeBannedWord(): Promise<void> {}
  async listFlaggedNicknames() { return [] }

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

  // ---------------------------------------------------------------- 回報問題
  // 本地版沒有別人會看，存著只是讓畫面走得通、測得到。

  async submitFeedback(kind: FeedbackKind, message: string, screen: string,
    context: Record<string, unknown>): Promise<void> {
    const all = read<FeedbackRow[]>(k.feedback, [])
    const text = message.trim()
    if (!text) throw new Error('請寫一下發生什麼事')
    all.unshift({
      id: (all[0]?.id ?? 0) + 1, createdAt: new Date().toISOString(), who: '本機', role: 'student',
      classCode: null, kind, message: text.slice(0, 500), screen, context, status: 'new', note: null,
    })
    write(k.feedback, all.slice(0, 200))
  }

  async listFeedback(status?: FeedbackStatus): Promise<FeedbackRow[]> {
    return read<FeedbackRow[]>(k.feedback, []).filter((f) => !status || f.status === status)
  }

  async triageFeedback(id: number, status: FeedbackStatus, note: string): Promise<void> {
    write(k.feedback, read<FeedbackRow[]>(k.feedback, []).map((f) =>
      (f.id === id ? { ...f, status, note: note.trim() || f.note } : f)))
  }

}

/**
 * 這一關至少要答對幾題才可能通關。跟 tools/gen-levels-seed.mjs 灌進資料庫的
 * 那個數字同一套算法：怪的總數打對折。刻意訂得寬鬆——擋的是
 * 「一題都沒答就說自己通關」，不是去評誰打得好。
 */
function minCorrectOf(l: LevelData): number {
  const enemies = l.rules.waves.reduce((n, w) => n + w.count, 0) + (l.rules.boss ? 1 : 0)
  return Math.ceil(enemies * 0.5)
}
