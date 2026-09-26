import { useEffect, useState } from 'react'

/**
 * 更新說明（2026-09-26）。點畫面右下角的版號打開。
 *
 * 內容在 public/changelog.json，改版號時在那裡加一筆。放 public 而不是包進程式，
 * 是因為**測試站要讀正式站那一份**：兩邊一比，測試站多出來的版本就是「待發布」，
 * 不用有人記得另外維護一張清單。
 */
interface Entry { version: string; date: string; title: string; items: string[] }

const STAGING = import.meta.env.MODE === 'staging'
/** 正式站還沒有 changelog.json 的時候（這個功能上線前），當作正式站停在這一版 */
const PROD_BEFORE_CHANGELOG = '0.15.0'

function cmp(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

async function load(url: string): Promise<Entry[] | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as { versions?: Entry[] }
    return j.versions ?? null
  } catch {
    return null
  }
}

export function Changelog({ onClose }: { onClose: () => void }) {
  const [mine, setMine] = useState<Entry[] | null>(null)
  const [prodTop, setProdTop] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    void load(new URL('changelog.json', document.baseURI).href).then((v) => {
      if (!alive) return
      if (v) setMine(v)
      else setError(true)
    })
    if (STAGING) {
      // 測試站在 /dev/，正式站在上一層
      void load(new URL('../changelog.json', document.baseURI).href).then((v) => {
        if (!alive) return
        setProdTop(v?.[0]?.version ?? PROD_BEFORE_CHANGELOG)
      })
    }
    return () => { alive = false }
  }, [])

  const pending = STAGING && mine && prodTop ? mine.filter((e) => cmp(e.version, prodTop) > 0) : []
  const released = mine ? mine.filter((e) => !pending.includes(e)) : []
  const short = (v: string) => v.replace(/\.0$/, '')

  return (
    <div className="confirm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="confirm-box panel changelog-box" onClick={(e) => e.stopPropagation()}>
        <h2>更新說明</h2>
        <div className="cl-list">
          {error && <p>讀不到更新說明，等一下再試試看。</p>}
          {!mine && !error && <p>讀取中…</p>}
          {STAGING && mine && prodTop && (
            <section className="cl-pending">
              <h3>待發布<small>正式站目前是 v{short(prodTop)}</small></h3>
              {pending.length === 0
                ? <p>測試區跟正式站一樣，沒有待發布的東西。</p>
                : pending.map((e) => <Version key={e.version} e={e} />)}
            </section>
          )}
          {released.length > 0 && STAGING && <h3>已經在正式站</h3>}
          {released.map((e) => <Version key={e.version} e={e} />)}
        </div>
        <div className="confirm-btns">
          <button className="btn" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  )
}

function Version({ e }: { e: Entry }) {
  return (
    <div className="cl-ver">
      <div className="cl-head"><b>v{e.version.replace(/\.0$/, '')}</b> {e.title}<small>{e.date}</small></div>
      <ul>{e.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
}
