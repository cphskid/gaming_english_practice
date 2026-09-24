/**
 * 畫面上的圖示。檔案在 public/icons/，由 tools/build-icons.py 從
 * assets/rpg-icons/（7Soul1，CC0）挑出來產生。
 *
 * **為什麼不繼續用 emoji**：同一個 🧊 在 iOS 和 Android 是兩張完全不同的圖，
 * 學校的平板、家裡的手機、老師的電腦各長各的樣子；而且 emoji 是彩色字，
 * 跟 Tiny Swords 的像素畫擺在一起永遠像貼上去的。
 *
 * **哪些留著不換**：
 * - 通關星星用的是文字 `★ ☆`，不是 emoji，本來就每支手機一樣、放大也不糊。
 * - 聽音的 👂 和鎖住關卡的 🔒 在素材包裡沒有對應的圖（有鑰匙沒有鎖，意思相反）。
 * - 音量 🔊、電腦對手 🤖、轉向提示 📱 這些是**介面功能鍵不是遊戲內容**，
 *   換成中世紀像素畫只會更難懂。
 */
export type IconName =
  | 'coin' | 'crystal' | 'heart' | 'castle'
  | 'frost' | 'repair'
  | 'bow' | 'shield'
  | 'clock' | 'eye' | 'quill'
  | 'medal1' | 'medal2' | 'medal3'

/** 圖示的網址。BASE_URL 要帶上，正式站是掛在子路徑下的。 */
export function iconUrl(name: IconName): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}icons/${name}.png`.replace(/([^:])\/{2,}/g, '$1/')
}

/**
 * 給畫布外的 HTML 用的一小段字串（遊戲引擎是拿 innerHTML 組畫面的，
 * 那裡沒有 React）。`size` 是 CSS 像素。
 */
export function iconImg(name: IconName, size = 16): string {
  return `<img class="ic-img" src="${iconUrl(name)}" alt="" width="${size}" height="${size}">`
}
