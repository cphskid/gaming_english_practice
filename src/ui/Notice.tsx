import { useEffect, useState } from 'react'

/**
 * 網站公告（2026-09-26）：上方橫幅、維修模式、停止營運，三種共用一個開關。
 *
 * 內容在 public/notice.json，改完推上去就生效（正式站推 BetaRun、測試站推 dev，兩份各自獨立）。
 * **故意不放資料庫**：要掛維修公告的時候，往往就是資料庫在改或出事的時候，
 * 放在網站本身的檔案才保證還讀得到。
 *
 * - banner：非遊戲畫面最上方一條，學生按 ✕ 收起來（同一段文字不會再跳）
 * - maintenance：整個畫面擋住。正在玩的人等這一場結束才擋，不會打斷到一半
 * - closed：停止營運，一樣整個擋住
 * 網址加 ?notice=off 可以略過擋畫面（這個分頁有效），維修時管理員自己進去測試用。
 */
export type NoticeMode = 'off' | 'banner' | 'maintenance' | 'closed'
export interface Notice { mode: NoticeMode; title?: string; message?: string; until?: string }

/** 開著的時候多久重讀一次。上課中切到維修，最慢這麼久所有人都會看到 */
const POLL_MS = 2 * 60 * 1000
const DISMISS_KEY = 'notice-dismissed'
const BYPASS_KEY = 'notice-bypass'

function bypassed(): boolean {
  try {
    if (new URLSearchParams(location.search).get('notice') === 'off') sessionStorage.setItem(BYPASS_KEY, '1')
    return sessionStorage.getItem(BYPASS_KEY) === '1'
  } catch {
    return false
  }
}

async function load(): Promise<Notice | null> {
  try {
    const r = await fetch(new URL('notice.json', document.baseURI).href, { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as Partial<Notice>
    const mode = (['banner', 'maintenance', 'closed'] as const).find((m) => m === j.mode) ?? 'off'
    return { mode, title: j.title, message: j.message, until: j.until }
  } catch {
    // 讀不到公告不是錯誤：照常玩
    return null
  }
}

/** 橫幅被收起來的判斷依據：文字一改就會再跳出來 */
const keyOf = (n: Notice) => `${n.title ?? ''}|${n.message ?? ''}|${n.until ?? ''}`

export function NoticeLayer({ playing }: { playing: boolean }) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY) } catch { return null }
  })
  const [skip] = useState(bypassed)

  useEffect(() => {
    let alive = true
    const tick = () => void load().then((n) => { if (alive) setNotice(n) })
    tick()
    const t = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (!notice || notice.mode === 'off') return null

  if (notice.mode === 'banner') {
    if (playing || dismissed === keyOf(notice)) return null
    return (
      <div className="notice-banner" role="status">
        <span className="txt">
          📢 {notice.title && <b>{notice.title}</b>} {notice.message}
          {notice.until && <small>{notice.until}</small>}
        </span>
        <button aria-label="收起公告" onClick={() => {
          const k = keyOf(notice)
          setDismissed(k)
          try { localStorage.setItem(DISMISS_KEY, k) } catch { /* 無痕模式：這次收起來就好 */ }
        }}>✕</button>
      </div>
    )
  }

  // 維修／停止營運
  if (skip || playing) return null
  const closed = notice.mode === 'closed'
  return (
    <div className="notice-block" role="alertdialog" aria-modal="true">
      <div className="panel notice-box">
        <div className="ic">{closed ? '🏰' : '🛠️'}</div>
        <h2>{notice.title || (closed ? '感謝大家的陪伴' : '城堡維修中')}</h2>
        {notice.message && <p>{notice.message}</p>}
        {notice.until && <p className="until">{notice.until}</p>}
        {!closed && <p className="hint">修好之後這個畫面會自己消失，不用重新整理。</p>}
      </div>
    </div>
  )
}
