import type { Character } from '@/core/types'
import { avatarSrc } from '@/data/jobs'
import { frameOf } from '@/data/cosmetics'
import { PARK_URL } from '@/net'
import { useLook } from './looks'

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
      {character.look && PARK_URL
        ? <TravellerHead look={character.look} />
        : <img src={avatarSrc(character.avatar)} alt="" />}
      {frame?.badge && <i className="mugbadge" style={{ fontSize: Math.round(size * 0.42) }}>{frame.badge}</i>}
    </span>
  )
}

/**
 * 頭像框裡面那張臉：有樂園旅人就畫旅人，沒有才用舊的像素頭像。
 * 給 id 就去問那個人的旅人（同學）；自己的直接把 look 傳進來。
 */
export function Face({ id, avatar, look }: { id?: string; avatar: string; look?: Record<string, string | null> | null }) {
  const asked = useLook(look ? null : id)
  const l = look ?? asked
  return l && PARK_URL ? <TravellerHead look={l} /> : <img src={avatarSrc(avatar)} alt="" />
}

/**
 * 樂園時空旅人的大頭（2026-10-10 頭像改跟樂園一樣）。
 * 跟樂園 js/traveller.js 的 dollHtml 同一套：448×600 的圖照順序疊起來，只露出頭到肩膀。
 */
const DOLL_ORDER = ['back', 'base', 'face', 'bottom', 'top', 'hair', 'hat', 'hand']
function TravellerHead({ look }: { look: Record<string, string | null> }) {
  const base = PARK_URL!.replace(/\/?$/, '/') + 'img/traveller/'
  return (
    <span className="trav-head">
      {DOLL_ORDER.map((s) => {
        const code = s === 'base' ? 'base' : look[s]
        return code ? <img key={s} src={base + code + '.webp'} alt="" draggable={false} /> : null
      })}
    </span>
  )
}
