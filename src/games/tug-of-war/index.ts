import type { GameModule } from '@/core/types'
import { mountTugOfWar } from './engine'

/**
 * 兵推：一對一對推。
 *
 * 答對一題就派一隻兵往對面走，兩邊的兵在中間打架，誰的兵撐不住線就往誰那邊退。
 * 推到對方城堡就打城堡，限時三分鐘。
 *
 * **對手是一串答題**（見 core/opponent.ts），所以「打電腦」「打好友的紀錄」
 * 「打線上的好友」在這裡是同一件事，引擎完全不知道差別。
 */
export const tugOfWar: GameModule = {
  id: 'tug-of-war',
  name: '兵推對戰',
  emoji: '⚔️',
  skill: 'recognize',
  hasLevels: false,
  supportedModes: ['versus'],
  mount: mountTugOfWar,
}
