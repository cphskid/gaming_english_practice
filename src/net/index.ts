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

/**
 * 時空冒險樂園（cphskid.github.io）。樂園管帳號、班級、老師後台，這個遊戲是樂園裡的一個設施。
 * 只有接了資料庫才算接上樂園——localStorage 模式（本機開發、自動試玩）照舊自己一套。
 * 樂園跟遊戲在同一個網域，登入狀態是共用的，所以跳過去不用再登入一次。
 */
export const PARK_URL: string | null =
  backend === 'supabase' ? import.meta.env.VITE_PARK_URL || null : null

/** 這個遊戲在樂園的設施代碼（park_facilities.code） */
export const PARK_FACILITY = 'guardian'
