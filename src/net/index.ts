import { LocalRepository } from './local'
import { SupabaseRepository } from './supabase'
import type { ClassRosterRow, Repository, RoomBrief, RoomMember, RoomState } from './repository'

export type { ClassRosterRow, Repository, RoomBrief, RoomMember, RoomState }
export { LocalRepository, SupabaseRepository }

/**
 * 換資料庫就是換這一行。
 *
 * .env 有填 Supabase 就走 Supabase，沒填就走 localStorage——
 * 所以沒有金鑰的人（包含 CI 與自動試玩機器人）照樣跑得起來，
 * 而整班上線只要把 .env 填好，其他地方一個字都不用改。
 */
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_KEY

export const repo: Repository =
  url && key ? new SupabaseRepository(url, key) : new LocalRepository()

/** 目前存在哪裡。換裝置看不到紀錄的時候，第一個要問的就是這個。 */
export const backend: 'supabase' | 'local' = url && key ? 'supabase' : 'local'
