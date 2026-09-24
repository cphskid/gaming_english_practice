import type { LegionDef } from '@/data/legions'

/** public/td-art 裡某張圖的網址。正式站掛在子路徑下，BASE_URL 要帶上。 */
function artUrl(key: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}td-art/${key}.png`.replace(/([^:])\/{2,}/g, '$1/')
}

/**
 * 軍團的縮圖：三條線的一階兵並排站。
 *
 * 跟外框、顏色同一個道理，**一套軍團最好的縮圖就是它自己的兵**。
 * 兵的圖是 112 方框、人站在正中間，這裡只露出中間那一塊（最高的扛箱豬也放得下），
 * 所以不用另外切縮圖。
 */
export function LegionThumb({ legion, size = 40 }: { legion: LegionDef; size?: number }) {
  // 兵的身高在方框裡大約 26 像素，豬扛箱子的最高到 40；縮到整隻都放得進去
  const scale = size / 42
  return (
    <span className="lg-thumb" aria-hidden="true">
      {['u_spear', 'u_bow', 'u_shield'].map((k) => (
        <span key={k} className="lg-u" style={{
          width: size, height: size,
          backgroundImage: `url(${artUrl(legion.prefix + k)})`,
          backgroundSize: `${112 * scale}px ${112 * scale}px`,
          // 人站在方框 (56, 57) 附近，腳底在 70：讓腳底貼著縮圖底邊往上一點
          backgroundPosition: `${size / 2 - 56 * scale}px ${size - 2 - 70 * scale}px`,
        }} />
      ))}
    </span>
  )
}
