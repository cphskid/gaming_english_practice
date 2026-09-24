/**
 * 美術素材。public/td-art.json 是一份索引（鍵 → 檔名），圖檔本身放在
 * public/td-art/ 當一般 PNG。
 *
 * 本來整包是 data URI 塞在那個 JSON 裡。加了五色建築之後它會變成 711KB，
 * 而 base64 本身就多三成，又不能分開快取、不能平行下載。改成一般檔案之後
 * 小了四分之一，換一張圖也只有那一張要重抓。
 *
 * 2026-09-21 修「進關卡時地圖只有綠色」：
 * 舊版是**全部 46 張到齊才算數**，中間誰都拿不到圖，所以第一次進關卡
 * 整張地圖就是那塊備用的綠色；而且**失敗會被記住**——fetch 一掛，
 * 這個 Promise 就永遠是 rejected，同一個分頁之後每次進關卡都只有綠色，
 * 只有重新整理才會好。（Chuck 說的「重複進去後**可能**會好」就是這兩件事。）
 *
 * 現在改成：
 * - 圖是**一張一張進來的**，`ART` 這個物件就地長大，畫面拿得到就畫得出來。
 * - 地形要用的那幾張**排在最前面**先抓，地圖比怪和塔早出現。
 * - 抓失敗會重試，重試完還是不行就把狀態清掉，下次再呼叫就重來一遍。
 * - 壞掉的圖不收進來（壞圖的 complete 也是 true，畫下去會丟例外把整個迴圈打斷）。
 */

/** 一張一張長大的素材表。拿到參考就好，不用每次重新問。 */
export const ART: Record<string, HTMLImageElement> = {}

/** 地形是先畫在一張暫存畫布上再整張貼的，用到這幾張；它們到了就得重畫一次。 */
export const TERRAIN_KEYS = [
  'water', 'tiles', 'rock1', 'rock2', 'rock3', 'rock4', 'tree1', 'tree2',
  // 豬軍團兵推戰場的城堡室內（見 tug-of-war/engine.ts 的 buildCastleHall）
  'pig_wall', 'pig_floor', 'pig_under', 'pig_window',
]

const listeners = new Set<(key: string) => void>()
let running: Promise<void> | null = null
let complete = false

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 每多一張圖就叫一次，參數是那張圖的鍵。回傳退訂用的函式。 */
export function onArt(cb: (key: string) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * 開始抓（或繼續抓）素材。可以重複呼叫：正在抓就跟著同一趟，
 * 上一趟放棄了就重開一趟。所以進關卡時每隔幾秒再叫一次就等於自動重試。
 */
export function loadArt(): Promise<Record<string, HTMLImageElement>> {
  if (complete) return Promise.resolve(ART)
  if (!running) {
    // 這裡刻意不會 reject：呼叫端都是 `void loadArt()`，丟出去也沒有人接，
    // 只會在主控台留一筆沒人處理的錯誤。抓不到就是這趟沒抓到，下一趟重來。
    running = run().catch(() => {}).finally(() => { running = null })
  }
  return running.then(() => ART)
}

async function run() {
  const base = import.meta.env.BASE_URL || '/'
  const index = await fetchIndex(`${base}td-art.json`.replace(/([^:])\/{2,}/g, '$1/'))
  if (!index) return

  const url = (v: string) => `${base}${v}`.replace(/([^:])\/{2,}/g, '$1/')
  const keys = Object.keys(index)
  // 地形先。HTTP/1.1 一次只開得了六條連線，排在後面的圖會等很久，
  // 而玩家最先看的就是地圖。
  const first = keys.filter((k) => TERRAIN_KEYS.includes(k))
  const rest = keys.filter((k) => !TERRAIN_KEYS.includes(k))

  await Promise.all(first.map((k) => grab(k, url(index[k]))))
  await Promise.all(rest.map((k) => grab(k, url(index[k]))))
  if (keys.every((k) => ART[k])) complete = true
}

/** 索引抓不到就退讓幾次再試；還是不行就這趟放棄，下一趟重來。 */
async function fetchIndex(src: string): Promise<Record<string, string> | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(src)
      if (r.ok) return (await r.json()) as Record<string, string>
    } catch { /* 網路斷一下而已，等等再說 */ }
    await sleep(600 * 2 ** i)
  }
  return null
}

async function grab(key: string, src: string) {
  if (ART[key]) return
  for (let i = 0; i < 3; i++) {
    if (await once(key, src)) return
    await sleep(600 * 2 ** i)
  }
}

function once(key: string, src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => {
      // 壞掉的圖 complete 也是 true，但 drawImage 畫下去會丟 InvalidStateError，
      // 那會把整個 requestAnimationFrame 迴圈打斷，畫面直接定住。只收畫得出來的。
      if (im.naturalWidth <= 0) return resolve(false)
      ART[key] = im
      for (const cb of listeners) { try { cb(key) } catch { /* 訂閱者的事不該拖垮載入 */ } }
      resolve(true)
    }
    im.onerror = () => resolve(false)
    im.src = src
  })
}
