import type { Job } from '@/core/types'

/**
 * 角色頭像（2026-09-25 換成 Charles Gabriel 的「48x48 Faces」，CC-BY 3.0）。
 *
 * **每個職業送四張，兩男兩女**；其他的上商店賣（Chuck 要的）。
 * 送的四張跟著職業走：換職業時頭像也換成新職業那四張的第一張，
 * 除非現在戴的是商店買的——買來的不管哪個職業都能用。
 *
 * 原本那 25 張是 Tiny Swords 的，那包的授權約 9/16 改成不准散布，
 * 公開 repo 放不得，這次一起換掉。舊存檔裡的 `Avatars_XX` 由資料庫搬家
 * （schema.sql 的 set_job 附近），前端 avatarSrc 對不到的一律畫預設那張。
 *
 * 圖是 tools/build-avatars.py 從 assets/cg-faces/ 的四張原圖切的，
 * 加一張就是在那支加一行、這裡加一行。**id 同時也是商店的品項 id**
 * （資料庫的 set_avatar 就是靠「背包裡有沒有這個 id」判斷買過沒）。
 */
export type AvatarTier = 'common' | 'rare' | 'legend'

export interface AvatarDef {
  id: string
  name: string
  /** 哪個職業送的。沒填的是商店賣的。 */
  job?: Job
  tier?: AvatarTier
}

export const AVATAR_TIERS: Record<AvatarTier, { name: string; price: number; unlockLevel: number; tint: string }> = {
  common: { name: '普通', price: 300, unlockLevel: 1, tint: '#6f9b4f' },
  rare: { name: '稀有', price: 800, unlockLevel: 4, tint: '#3f7fc4' },
  legend: { name: '傳說', price: 1500, unlockLevel: 8, tint: '#c98a1f' },
}

export const AVATAR_LIST: AvatarDef[] = [
  // 騎士送的四張
  { id: 'av-warrior-m', name: '戰士（男）', job: 'knight' },
  { id: 'av-warrior-f', name: '戰士（女）', job: 'knight' },
  { id: 'av-soldier-m', name: '重甲兵（男）', job: 'knight' },
  { id: 'av-soldier-f', name: '重甲兵（女）', job: 'knight' },
  // 法師送的四張
  { id: 'av-magician-m', name: '魔法師（男）', job: 'mage' },
  { id: 'av-magician-f', name: '魔法師（女）', job: 'mage' },
  { id: 'av-healer-m', name: '白袍法師（男）', job: 'mage' },
  { id: 'av-healer-f', name: '白袍法師（女）', job: 'mage' },

  // 商店・普通
  { id: 'av-monk-m', name: '武僧（男）', tier: 'common' },
  { id: 'av-monk-f', name: '武僧（女）', tier: 'common' },
  { id: 'av-ranger-m', name: '遊俠（男）', tier: 'common' },
  { id: 'av-ranger-f', name: '遊俠（女）', tier: 'common' },
  { id: 'av-ninja-m', name: '忍者（男）', tier: 'common' },
  { id: 'av-ninja-f', name: '忍者（女）', tier: 'common' },
  { id: 'av-berserk-m', name: '狂戰士（男）', tier: 'common' },
  { id: 'av-berserk-f', name: '狂戰士（女）', tier: 'common' },
  { id: 'av-pirate', name: '海盜', tier: 'common' },
  { id: 'av-merchant', name: '商人', tier: 'common' },
  { id: 'av-bard', name: '吟遊詩人', tier: 'common' },

  // 商店・稀有
  { id: 'av-samurai-m', name: '武士（男）', tier: 'rare' },
  { id: 'av-samurai-f', name: '武士（女）', tier: 'rare' },
  { id: 'av-dknight-m', name: '黑騎士（男）', tier: 'rare' },
  { id: 'av-dknight-f', name: '黑騎士（女）', tier: 'rare' },
  { id: 'av-paladin', name: '聖騎士', tier: 'rare' },
  { id: 'av-dancer', name: '舞者', tier: 'rare' },
  { id: 'av-captain', name: '海盜船長', tier: 'rare' },
  { id: 'av-vampire', name: '吸血鬼', tier: 'rare' },

  // 商店・傳說
  { id: 'av-el-fire', name: '火元素', tier: 'legend' },
  { id: 'av-el-water', name: '水元素', tier: 'legend' },
  { id: 'av-el-wind', name: '風元素', tier: 'legend' },
  { id: 'av-el-earth', name: '土元素', tier: 'legend' },
  { id: 'av-el-light', name: '光元素', tier: 'legend' },
  { id: 'av-el-dark', name: '暗元素', tier: 'legend' },
  { id: 'av-angel', name: '天使', tier: 'legend' },
  { id: 'av-king', name: '國王', tier: 'legend' },
  { id: 'av-queen', name: '女王', tier: 'legend' },
]

export const AVATAR_BY_ID = new Map(AVATAR_LIST.map((a) => [a.id, a]))

/** 這個職業送的四張，順序就是畫面上的順序；第一張是預設。 */
export function jobAvatars(job: Job): AvatarDef[] {
  return AVATAR_LIST.filter((a) => a.job === job)
}

export function defaultAvatar(job: Job): string {
  return jobAvatars(job)[0].id
}

/** 商店賣的頭像 */
export const SHOP_AVATARS = AVATAR_LIST.filter((a) => a.tier)

/**
 * 換職業之後頭像該變成什麼：戴的是舊職業送的就換成新職業的第一張，
 * 買來的照舊。資料庫 set_job 做的是同一件事，**改一邊要改另一邊**。
 */
export function avatarAfterJob(avatar: string, job: Job): string {
  const a = AVATAR_BY_ID.get(avatar)
  if (a && !a.job) return avatar
  if (a && a.job === job) return avatar
  return defaultAvatar(job)
}

export function avatarSrc(id: string): string {
  // 對不到的（舊存檔的 Avatars_XX、還沒創角的空字串）一律畫預設那張，不能破圖
  return import.meta.env.BASE_URL + 'avatars/' + (AVATAR_BY_ID.has(id) ? id : AVATAR_LIST[0].id) + '.png'
}
