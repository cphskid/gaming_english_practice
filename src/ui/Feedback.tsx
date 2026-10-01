import { useCallback, useEffect, useState } from 'react'
import { repo } from '@/net'
import { backend } from '@/net'
import type { FeedbackKind, FeedbackStatus, MyFeedbackRow } from '@/net/repository'
import { FeedbackInbox, isPending } from './FeedbackInbox'

/**
 * 回報問題。
 *
 * 小朋友描述 bug 通常只會寫「壞掉了」，所以真正有用的是**自動附上的東西**：
 * 在哪個畫面、哪一關、哪一版、什麼手機、螢幕多大、最近有沒有跳錯誤。
 * 這些都塞在 context 裡，讀回報的人（Claude 或 Chuck）拿來重現。
 */

/** 最近幾個錯誤訊息。main.tsx 一開始就掛上，回報時一起送。 */
const recentErrors: string[] = []
/** 最後點過的幾個按鈕。小朋友寫「按了沒反應」時，看這個才知道是按哪一顆。 */
const recentTaps: string[] = []
export function watchErrors(): void {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.('button, a, [role=button]')
    if (!el || el.closest('.feedback-fab, .feedback-box')) return
    const label = (el.textContent || el.getAttribute('aria-label') || el.className || '?').trim().replace(/\s+/g, ' ')
    recentTaps.push(`${new Date().toISOString().slice(11, 19)} ${label.slice(0, 40)}${(el as HTMLButtonElement).disabled ? '（停用中）' : ''}`)
    if (recentTaps.length > 5) recentTaps.shift()
  }, true)
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

/**
 * 回報的人看到的處理狀態（2026-09-27）。內部分類給小朋友看不懂，
 * 所以只分四種說法；沒寫回覆的時候，就用這裡的預設話。
 */
const MY_STATUS: Record<FeedbackStatus, { label: string; tone: 'wait' | 'work' | 'done' | 'close'; say: string }> = {
  new: { label: '已收到', tone: 'wait', say: '我們收到了，會盡快來看。' },
  bug: { label: '處理中', tone: 'work', say: '我們確認這是問題，正在修。' },
  unclear: { label: '處理中', tone: 'work', say: '我們正在討論要怎麼處理。' },
  request: { label: '好點子', tone: 'work', say: '謝謝你的想法！已經放進想做的清單。' },
  fixed: { label: '修好了', tone: 'done', say: '修好了！重新整理網頁就會是新版。謝謝你幫忙！' },
  dup: { label: '已處理', tone: 'close', say: '已經有人回報過一樣的問題，我們會一起處理。' },
  wontfix: { label: '看過了', tone: 'close', say: '我們看過了，這次先不改，謝謝你告訴我們。' },
}

const isUnread = (r: MyFeedbackRow) =>
  !!r.updatedAt && (!r.seenAt || Date.parse(r.updatedAt) > Date.parse(r.seenAt))

/** 管理員與老師按「問題回報」先看到收件匣（2026-10-01）；管理員能管，老師只看自己班 */
export type FeedbackInboxRole = 'admin' | 'teacher' | null

export function FeedbackButton({ screen, levelId, mode, inbox = null }: {
  screen: string; levelId?: string | null; mode?: string | null; inbox?: FeedbackInboxRole
}) {
  const [open, setOpen] = useState(false)
  const [mine, setMine] = useState<MyFeedbackRow[] | null>(null)
  /** 管理員：待處理幾則（還沒看＋要 Chuck 決定），按鈕上亮紅點 */
  const [pending, setPending] = useState(0)
  useEffect(() => {
    if (inbox !== 'admin') return
    void repo.listFeedback().then((rows) => setPending(rows.filter(isPending).length)).catch(() => {})
  }, [inbox])

  const loadMine = useCallback(async () => {
    try { setMine(await repo.myFeedback()) } catch { /* 讀不到就不亮紅點，不擋回報 */ }
  }, [])
  useEffect(() => { void loadMine() }, [loadMine])

  const unread = mine?.filter(isUnread).length ?? 0
  const dot = unread + pending
  return (
    <>
      <button className="feedback-fab" onClick={() => setOpen(true)} aria-label="回報問題">
        💬 問題回報{dot > 0 && <span className="feedback-dot" aria-label={`${dot} 則有新消息`} />}
      </button>
      {open && <FeedbackForm screen={screen} levelId={levelId} mode={mode} mine={mine} unread={unread}
        inbox={inbox} pending={pending} onPending={setPending}
        onSeen={() => {
          void repo.seenMyFeedback().catch(() => {})
          const now = new Date().toISOString()
          setMine((m) => m?.map((r) => ({ ...r, seenAt: now })) ?? m)
        }}
        onSent={() => void loadMine()}
        onClose={() => setOpen(false)} />}
    </>
  )
}

/** 「我的回報」：自己送過的，處理到哪了、我們回了什麼 */
function MyFeedbackList({ rows, fresh }: { rows: MyFeedbackRow[] | null; fresh: Set<number> }) {
  if (rows === null) return <p className="feedback-note">讀取中…</p>
  if (rows.length === 0) return <p className="feedback-note">你還沒有回報過。遇到問題或有想法，隨時告訴我們！</p>
  return (
    <div className="fb-list fb-mine">
      {rows.map((r) => {
        const st = MY_STATUS[r.status]
        return (
          <div className={'fb-item' + (fresh.has(r.id) ? ' fb-new' : '')} key={r.id}>
            <div className="fb-row">
              <span className={'fb-badge fb-' + st.tone}>{st.label}</span>
              <span className="fb-meta">{new Date(r.createdAt).toLocaleDateString('zh-TW')}</span>
              {fresh.has(r.id) && <span className="fb-newtag">新消息</span>}
            </div>
            <div className="fb-msg">{r.message}</div>
            <div className="fb-reply">{r.reply ? <>💌 {r.reply}</> : st.say}</div>
          </div>
        )
      })}
    </div>
  )
}

function FeedbackForm({ screen, levelId, mode, mine, unread, inbox, pending, onPending, onSeen, onSent, onClose }: {
  screen: string; levelId?: string | null; mode?: string | null
  mine: MyFeedbackRow[] | null; unread: number
  inbox: FeedbackInboxRole; pending: number; onPending: (n: number) => void
  onSeen: () => void; onSent: () => void; onClose: () => void
}) {
  // 有新消息就直接打開「我的回報」
  // 管理員／老師先看收件匣；其他人有新消息就直接打開「我的回報」
  const [tab, setTab] = useState<'inbox' | 'write' | 'mine'>(
    inbox ? 'inbox' : unread > 0 ? 'mine' : 'write')
  // 打開當下還沒看過的那幾則；標成看過以後，這次打開的期間仍然框起來
  const [fresh] = useState(() => new Set((mine ?? []).filter(isUnread).map((r) => r.id)))
  useEffect(() => { if (tab === 'mine' && unread > 0) onSeen() }, [tab, unread, onSeen])
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
        mode: mode ?? null,
        taps: [...recentTaps],
        ua: navigator.userAgent,
        view: `${window.innerWidth}x${window.innerHeight}`,
        backend,
        errors: [...recentErrors],
      })
      setState('done')
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('edit')
    }
  }

  return (
    <div className="confirm" role="dialog" aria-modal="true">
      <div className={'confirm-box panel feedback-box' + (tab === 'inbox' ? ' feedback-inbox' : '')}>
        {state === 'done' ? (
          <>
            <h2>收到了，謝謝你！</h2>
            <p>我們會看過之後處理。處理的進度和回覆，之後按「💬 問題回報」→「我的回報」就看得到。</p>
            <div className="confirm-btns">
              <button className="btn" onClick={onClose}>好</button>
            </div>
          </>
        ) : (
          <>
            <h2>問題回報</h2>
            <div className="feedback-tabs">
              {inbox && (
                <button className={'btn small' + (tab === 'inbox' ? '' : ' ghost')} onClick={() => setTab('inbox')}>
                  📥 {inbox === 'admin' ? '收件匣' : '班上的'}{pending > 0 && <span className="feedback-dot" />}
                </button>
              )}
              <button className={'btn small' + (tab === 'write' ? '' : ' ghost')} onClick={() => setTab('write')}>✏️ 寫新的</button>
              <button className={'btn small' + (tab === 'mine' ? '' : ' ghost')} onClick={() => setTab('mine')}>
                📬 我的回報{unread > 0 && <span className="feedback-dot" />}
              </button>
            </div>
            {tab === 'inbox' ? (
              <>
                <FeedbackInbox canManage={inbox === 'admin'} onPending={onPending} />
                <div className="confirm-btns">
                  <button className="btn" onClick={onClose}>關閉</button>
                </div>
              </>
            ) : tab === 'mine' ? (
              <>
                <MyFeedbackList rows={mine} fresh={fresh} />
                <div className="confirm-btns">
                  <button className="btn" onClick={onClose}>關閉</button>
                </div>
              </>
            ) : (<>
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
            </>)}
          </>
        )}
      </div>
    </div>
  )
}
