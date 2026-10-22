import type { LegionDef } from '@/data/legions'
import { iconKey, unitKey } from '@/games/legion-art'

/** 手繪兵的選兵小圖（public/td-park/vs/icon-*.webp，96 方框、腳貼底邊） */
function iconUrl(key: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}td-park/vs/${iconKey(key).replace(/^vs-/, '')}.webp`.replace(/([^:])\/{2,}/g, '$1/')
}

/**
 * 軍團的縮圖：三條線的一階兵並排站。
 *
 * 跟外框、顏色同一個道理，**一套軍團最好的縮圖就是它自己的兵**。
 * 2026-10-11 起用提案二手繪兵的小圖（legion-art.ts），跟對戰選兵鈕同一張。
 */
export function LegionThumb({ legion, size = 40 }: { legion: LegionDef; size?: number }) {
  return (
    <span className="lg-thumb" aria-hidden="true">
      {(['recognize', 'listen', 'spell'] as const).map((line, i) => (
        <span key={line} className="lg-u" style={{
          width: size, height: size,
          backgroundImage: `url(${iconUrl(unitKey(legion, line, ['u_spear', 'u_bow', 'u_shield'][i], 1))})`,
          backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center bottom',
          imageRendering: 'auto',
        }} />
      ))}
    </span>
  )
}
