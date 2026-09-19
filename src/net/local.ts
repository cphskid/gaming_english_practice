import { newCharacter, studentId } from '@/core/character'
import { WordStat } from '@/core/wordStat'
import type { AnswerEvent, Character, LevelProgress, Student, WordStatEntry } from '@/core/types'
import type { Repository } from './repository'

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

export class LocalRepository implements Repository {
  async join(classCode: string, nickname: string): Promise<Student> {
    const code = classCode.trim().toUpperCase()
    const id = studentId(code, nickname)
    const student: Student = { id, classCode: code, nickname: nickname.trim(), role: 'student' }
    write(k.student(id), student)

    const roster = read<string[]>(k.roster(code), [])
    if (!roster.includes(id)) write(k.roster(code), [...roster, id])
    return student
  }

  async loadCharacter(id: string): Promise<Character> {
    const existing = read<Character | null>(k.character(id), null)
    if (existing) return existing
    const student = read<Student | null>(k.student(id), null)
    const fresh = newCharacter(student ?? { id, classCode: '', nickname: '', role: 'student' })
    write(k.character(id), fresh)
    return fresh
  }

  async saveCharacter(c: Character): Promise<void> {
    write(k.character(c.studentId), c)
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
}
