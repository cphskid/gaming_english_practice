import { iconUrl, type IconName } from '@/data/icons'

/**
 * 一個圖示。**所有圖示一律走這裡**——跟頭像走 Avatar.tsx 是同一個道理：
 * 散在各處各寫一次 `<img>`，之後要調大小或換素材就一定會漏掉一個。
 *
 * `alt` 預設是空的：圖示旁邊幾乎都已經有中文字了，讀螢幕的人再聽一次
 * 「金幣 金幣」只是吵。真的只有圖沒有字的時候才傳 alt 進來。
 */
export function Icon({ name, size = 18, alt = '' }: { name: IconName; size?: number; alt?: string }) {
  return <img className="ic-img" src={iconUrl(name)} width={size} height={size} alt={alt} />
}
