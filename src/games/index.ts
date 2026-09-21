import type { GameModule } from '@/core/types'
import { towerDefense } from './tower-defense'
import { tugOfWar } from './tug-of-war'

/**
 * 遊戲清單。加一個新遊戲就是多一個資料夾、在這裡多一行。
 * core、經濟、資料庫、老師後台都不用動——報表會自動涵蓋新遊戲，
 * 因為答題事件的形狀是一樣的。
 */
export const GAMES: GameModule[] = [towerDefense, tugOfWar]

export function gameById(id: string): GameModule | undefined {
  return GAMES.find((g) => g.id === id)
}

export { towerDefense, tugOfWar }
