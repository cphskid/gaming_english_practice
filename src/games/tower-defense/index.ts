import type { GameModule } from '@/core/types'
import { mountTowerDefense } from './engine'

/**
 * 單字守塔。主線遊戲，有關卡、給星星與進度。
 *
 * 注意這個檔案有多薄：遊戲只宣告自己是什麼，然後把畫面交出去。
 * 它不知道金幣怎麼算、不知道資料存在哪、不知道老師後台的存在。
 */
export const towerDefense: GameModule = {
  id: 'tower-defense',
  name: '單字守塔',
  emoji: '🏰',
  skill: 'recognize',
  hasLevels: true,
  supportedModes: ['solo', 'versus', 'team'],
  mount: mountTowerDefense,
}
