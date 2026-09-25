import type { GameModule } from '@/core/types'
import { mountBossRaid } from './engine'

/**
 * 魔王團戰：二到六個人一起打一隻魔王（2026-09-25）。
 *
 * 出兵、三條兵種線、升階都跟兵推一樣，差在對面是魔王：牠派小兵來打每個人的城，
 * 每隔幾秒重擊一次身邊的兵。三分鐘內把牠的血打光就贏。
 * 規則 raid.ts、同步 lockstep.ts、畫面 engine.ts。
 */
export const bossRaid: GameModule = {
  id: 'boss-raid',
  name: '魔王團戰',
  emoji: '👹',
  skill: 'recognize',
  hasLevels: false,
  supportedModes: ['team'],
  mount: mountBossRaid,
}
