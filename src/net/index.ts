import { LocalRepository } from './local'
import type { Repository } from './repository'

export type { Repository }
export { LocalRepository }

/**
 * 換資料庫就是換這一行。
 * 之後接 Supabase：`new SupabaseRepository(client)`，其他地方一個字都不用改。
 */
export const repo: Repository = new LocalRepository()
