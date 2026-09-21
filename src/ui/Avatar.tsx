import type { Character } from '@/core/types'
import { avatarSrc } from '@/data/jobs'
import { frameOf } from '@/data/cosmetics'

/**
 * 頭像 ＋ 外框。**所有會出現頭像的地方都要用這個元件**，
 * 因為「同學看得到才叫收集」——外框在上面那一條、選關、商店、排行榜
 * 都要長一樣，散在各處各畫一次遲早會有一個忘記加。
 *
 * 外框走 CSS 不走圖片（除了緞帶那一個），所以任何尺寸都不會糊，
 * 也不用為了 25 張頭像各畫一套。
 */
export function Avatar({ character, size = 36 }: { character: Character; size?: number }) {
  const frame = frameOf(character.equipped)
  return (
    <span className={'mugbox' + (frame ? ' ' + frame.className : '')}
      style={{ width: size, height: size }}>
      <img src={avatarSrc(character.avatar)} alt="" />
      {frame?.badge && <i className="mugbadge" style={{ fontSize: Math.round(size * 0.42) }}>{frame.badge}</i>}
    </span>
  )
}
