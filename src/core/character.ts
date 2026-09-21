import type { Character, Job, Student } from './types'

export const JOB_NAME: Record<Job, string> = { knight: '騎士', mage: '法師' }
export const JOB_DESC: Record<Job, string> = {
  knight: '單體傷害高，適合專心打一隻',
  mage: '範圍攻擊，適合一次清一群',
}

export function newCharacter(student: Student, job: Job = 'knight'): Character {
  // avatar 留空是「還沒創角」的意思，登入後會被帶去創角畫面。
  return { studentId: student.id, job, avatar: '', exp: 0, coins: 120, items: {}, equipped: [] }
}

/** 還沒選過職業和頭像的人，要先去創角。 */
export function needsCreation(c: Character): boolean {
  return !c.avatar
}

/** 暱稱做為顯示名稱，不存真實姓名 */
export function displayName(s: Student): string {
  return s.nickname.trim() || '無名英雄'
}

/**
 * 班級代碼＋暱稱不是真的憑證，只用來認人，不用來授權。
 * 真正要防作弊的是「金幣不能由客戶端直接寫」，見 net/。
 */
export function studentId(classCode: string, nickname: string): string {
  return `${classCode.trim().toUpperCase()}:${nickname.trim()}`
}
