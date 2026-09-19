import type { AnswerEvent, Character, LevelProgress, Student, WordStatEntry } from '@/core/types'

/**
 * 唯一知道資料存在哪裡的介面。core 只認這份契約，不知道 Supabase 存在。
 * 換資料庫＝換一個實作，不動其他任何地方。
 */
export interface Repository {
  /** 班級代碼＋暱稱進場。不收真實姓名與 email。 */
  join(classCode: string, nickname: string): Promise<Student>

  loadCharacter(studentId: string): Promise<Character>
  saveCharacter(c: Character): Promise<void>

  loadProgress(studentId: string): Promise<LevelProgress[]>
  saveProgress(studentId: string, p: LevelProgress): Promise<void>

  /**
   * 寫入答題事件。整個系統的地基：金幣、經驗、星星、排行榜、老師報表
   * 全都是從這裡算出來的。
   *
   * 注意接 Supabase 之後這會變成一支 RPC，由資料庫從事件算出金幣與經驗，
   * **客戶端不能直接寫 coins 欄位**——學生的班級代碼不是真憑證，小朋友會找漏洞。
   */
  appendEvents(events: AnswerEvent[]): Promise<void>
  loadEvents(studentId: string): Promise<AnswerEvent[]>

  /**
   * 掌握度。本地版是把事件跑一遍算出來的，所以跟 loadEvents 等價；
   * 接了後端之後改成直接讀資料庫算好的那張表，不然一個學生一年好幾萬列，
   * 每次登入都撈回來跑一遍，學校的平板會卡住。
   */
  loadWordStats(studentId: string): Promise<WordStatEntry[]>

  /** 老師報表用：整個班的事件 */
  loadClassEvents(classCode: string): Promise<AnswerEvent[]>

  /** 老師額外開放的關卡 */
  loadTeacherOpen(classCode: string): Promise<string[]>
  setTeacherOpen(classCode: string, levelIds: string[]): Promise<void>
}
