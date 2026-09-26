import { useState } from 'react'
import { repo } from '@/net'
import { backend } from '@/net'
import type { FeedbackKind } from '@/net/repository'

/**
 * 回報問題。
 *
 * 小朋友描述 bug 通常只會寫「壞掉了」，所以真正有用的是**自動附上的東西**：
 * 在哪個畫面、哪一關、哪一版、什麼手機、螢幕多大、最近有沒有跳錯誤。
 * 這些都塞在 context 裡，讀回報的人（Claude 或 Chuck）拿來重現。
 */

/** 最近幾個錯誤訊息。main.tsx 一開始就掛上，回報時一起送。 */
const recentErrors: string[] = []
export function watchErrors(): void {
  const keep = (msg: string) => {
    recentErrors.push(`${new Date().toISOString().slice(11, 19)} ${msg}`.slice(0, 300))
    if (recentErrors.length > 5) recentErrors.shift()
  }
  window.addEventListener('error', (e) => keep(e.message || String(e.error)))
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    keep(r instanceof Error ? r.message : String(r))
  })
}

const KINDS: { id: FeedbackKind; label: string; hint: string }[] = [
  { id: 'bug', label: '🐞 壞掉了', hint: '例如：按了沒反應、畫面卡住、金幣不對' },
  { id: 'confusing', label: '❓ 看不懂', hint: '例如：不知道這個按鈕要做什麼' },
  { id: 'idea', label: '💡 我有想法', hint: '例如：希望多一個什麼功能' },
]

export function FeedbackButton({ screen, levelId }: { screen: string; levelId?: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="feedback-fab" onClick={() => setOpen(true)} aria-label="回報問題">💬 回報</button>
      {open && <FeedbackForm screen={screen} levelId={levelId} onClose={() => setOpen(false)} />}
    </>
  )
}

function FeedbackForm({ screen, levelId, onClose }: {
  screen: string; levelId?: string | null; onClose: () => void
}) {
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [text, setText] = useState('')
  const [state, setState] = useState<'edit' | 'sending' | 'done'>('edit')
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setState('sending'); setError(null)
    try {
      await repo.submitFeedback(kind, text, screen, {
        ver: __APP_VERSION__,
        level: levelId ?? null,
        ua: navigator.userAgent,
        view: `${window.innerWidth}x${window.innerHeight}`,
        backend,
        errors: [...recentErrors],
      })
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('edit')
    }
  }

  return (
    <div className="confirm" role="dialog" aria-modal="true">
      <div className="confirm-box panel feedback-box">
        {state === 'done' ? (
          <>
            <h2>收到了，謝謝你！</h2>
            <p>我們會看過之後處理。</p>
            <div className="confirm-btns">
              <button className="btn" onClick={onClose}>好</button>
            </div>
          </>
        ) : (
          <>
            <h2>回報問題</h2>
            <div className="feedback-kinds">
              {KINDS.map((k) => (
                <button key={k.id} className={'btn small' + (kind === k.id ? '' : ' ghost')}
                  onClick={() => setKind(k.id)}>{k.label}</button>
              ))}
            </div>
            <textarea value={text} maxLength={500} rows={4}
              placeholder={KINDS.find((k) => k.id === kind)!.hint}
              onChange={(e) => setText(e.target.value)} />
            <p className="feedback-note">會自動附上你在哪個畫面、版本和裝置，不用另外寫。</p>
            {error && <p className="error">{error}</p>}
            <div className="confirm-btns">
              <button className="btn ghost" onClick={onClose}>取消</button>
              <button className="btn" disabled={!text.trim() || state === 'sending'}
                onClick={() => void send()}>{state === 'sending' ? '送出中…' : '送出'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
