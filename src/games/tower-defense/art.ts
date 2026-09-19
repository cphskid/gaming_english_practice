/**
 * 美術素材。data URI 放在 public/td-art.json 當一般檔案載入，不內嵌進 bundle——
 * 222KB 進 bundle 會讓首屏變慢，當檔案瀏覽器才會快取。
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
            img.src = raw[k]
            out[k] = img
          }
        }),
    )
  return cache
}
