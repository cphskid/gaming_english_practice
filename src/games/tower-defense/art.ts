/**
 * 美術素材。public/td-art.json 是一份索引（鍵 → 檔名），圖檔本身放在
 * public/td-art/ 當一般 PNG。
 *
 * 本來整包是 data URI 塞在那個 JSON 裡。加了五色建築之後它會變成 711KB，
 * 而 base64 本身就多三成，又不能分開快取、不能平行下載。改成一般檔案之後
 * 小了四分之一，換一張圖也只有那一張要重抓。
 */
let cache: Promise<Record<string, HTMLImageElement>> | null = null

export function loadArt(): Promise<Record<string, HTMLImageElement>> {
  if (cache) return cache
  const base = import.meta.env.BASE_URL || '/'
  cache = fetch(`${base}td-art.json`.replace(/\/{2,}/g, '/'))
    .then((r) => r.json() as Promise<Record<string, string>>)
    .then(
      (raw) =>
        new Promise<Record<string, HTMLImageElement>>((resolve) => {
          const out: Record<string, HTMLImageElement> = {}
          const keys = Object.keys(raw)
          let left = keys.length
          if (!left) return resolve(out)
          for (const k of keys) {
            const img = new Image()
            img.onload = img.onerror = () => {
              if (--left === 0) resolve(out)
            }
            img.src = `${base}${raw[k]}`.replace(/([^:])\/{2,}/g, '$1/')
            out[k] = img
          }
        }),
    )
  return cache
}
