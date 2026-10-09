import { useCallback, useEffect, useState } from 'react'
import { repo } from '@/net'
import type { FeedbackRow, FeedbackStatus } from '@/net/repository'

/**
 * 回報收件匣（2026-10-01 從管理員後台搬出來）。兩個地方用：
 * 管理員後台最上面，和管理員／老師按「💬 問題回報」的第一頁。
 *
 * - 管理員（canManage）：看全部、改分類、寫回覆給本人、刪除（＝隱藏，可救回）。
 * - 老師：只看得到自己帶的班的學生回報，唯讀。過濾是伺服器做的（list_feedback）。
 */

export const STATUS: { id: FeedbackStatus; label: string }[] = [
  { id: 'new', label: '還沒看' },
  { id: 'bug', label: 'Bug 要修' },
  { id: 'request', label: '需求' },
  { id: 'unclear', label: '要 Chuck 決定' },
  { id: 'fixed', label: '修好了' },
  { id: 'dup', label: '重複' },
  { id: 'wontfix', label: '不處理' },
]
const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.id, s.label])) as Record<FeedbackStatus, string>
const KIND_LABEL = { bug: '🐞 壞掉了', confusing: '❓ 看不懂', idea: '💡 想法' }

/** 待處理＝還沒看，或留給 Chuck 決定的 */
export const isPending = (r: FeedbackRow) => r.status === 'new' || r.status === 'unclear'

/** 寫給回報的人看的話；本人在「我的回報」看得到，按鈕會亮紅點 */
function FeedbackReply({ id, reply, onDone, onError }: {
  id: number; reply: string | null; onDone: () => Promise<void>; onError: (m: string) => void
}) {
  const [text, setText] = useState(reply ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = text.trim() !== (reply ?? '')
  return (
    <div className="fb-row">
      <input className="fb-reply-input" value={text} maxLength={300} placeholder="回覆給本人（他看得到）"
        onChange={(e) => setText(e.target.value)} />
      <button className="btn small" disabled={!dirty || busy} onClick={() => void (async () => {
        setBusy(true)
        try { await repo.replyFeedback(id, text); await onDone() }
        catch (err) { onError(err instanceof Error ? err.message : String(err)) }
        finally { setBusy(false) }
      })()}>{busy ? '送出中…' : reply ? '改回覆' : '回覆'}</button>
    </div>
  )
}

type Filter = FeedbackStatus | '' | 'pending' | 'hidden'

export function FeedbackInbox({ canManage = false, onPending }: {
  canManage?: boolean
  /** 待處理幾則，給按鈕亮紅點用 */
  onPending?: (n: number) => void
}) {
  const [filter, setFilter] = useState<Filter>('')
  const [rows, setRows] = useState<FeedbackRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 按了一次「刪除」的那一則，再按一次才真的刪 */
  const [arming, setArming] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const status = filter === '' || filter === 'pending' || filter === 'hidden' ? undefined : filter
      const all = await repo.listFeedback(status, filter === 'hidden')
      setRows(filter === 'pending' ? all.filter(isPending) : all)
      if (filter === '') onPending?.(all.filter(isPending).length)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [filter, onPending])
  useEffect(() => { void load() }, [load])

  const act = (f: () => Promise<void>) => void (async () => {
    try { await f(); await load() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })()

  const fresh = rows?.filter(isPending).length ?? 0

  return (
    <div className="fb-inbox">
      <div className="fb-row">
        <h2>{canManage ? '回報' : '班上的回報'}{filter !== 'hidden' && fresh > 0 && `（${fresh} 則待處理）`}</h2>
        <span className="spacer" />
        <select value={filter} onChange={(e) => { setArming(null); setFilter(e.target.value as Filter) }}>
          <option value="">全部</option>
          <option value="pending">待處理</option>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          {canManage && <option value="hidden">🗑 已刪除</option>}
        </select>
      </div>
      {!canManage && <p className="feedback-note">你班上學生送的回報。處理進度由管理員更新。</p>}
      {error && <p className="error">{error}</p>}
      <div className="fb-list">
        {rows === null && <p className="lede">讀取中…</p>}
        {rows?.length === 0 && <p className="lede">{filter === 'hidden' ? '沒有刪除的回報。' : '沒有回報。'}</p>}
        {rows?.slice(0, 50).map((r) => (
          <div className="fb-item" key={r.id}>
            <div className="fb-row">
              <b>{KIND_LABEL[r.kind]}</b>
              <span>{r.who}{r.classCode && `・${r.classCode}`}</span>
              <span className="spacer" />
              {canManage && filter !== 'hidden' ? (
                <select value={r.status}
                  onChange={(e) => act(() => repo.triageFeedback(r.id, e.target.value as FeedbackStatus, ''))}>
                  {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              ) : <span className="fb-meta">{STATUS_LABEL[r.status]}</span>}
            </div>
            <div className="fb-msg">{r.message}</div>
            {canManage && r.note && <div className="fb-meta">內部筆記：{r.note}</div>}
            {canManage && filter !== 'hidden' && (
              <FeedbackReply id={r.id} reply={r.reply} onDone={load} onError={setError} />
            )}
            {!canManage && r.reply && <div className="fb-reply">💌 {r.reply}</div>}
            <div className="fb-row">
              <span className="fb-meta">
                {new Date(r.createdAt).toLocaleString('zh-TW')}・{r.screen}
                {typeof r.context.level === 'string' && `・${r.context.level}`}
                {typeof r.context.ver === 'string' && `・v${r.context.ver}`}
              </span>
              <span className="spacer" />
              {canManage && (filter === 'hidden' ? (
                <button className="btn small ghost" onClick={() => act(() => repo.hideFeedback(r.id, false))}>救回</button>
              ) : arming === r.id ? (
                <>
                  <button className="btn small ghost" onClick={() => setArming(null)}>取消</button>
                  <button className="btn small danger" onClick={() => { setArming(null); act(() => repo.hideFeedback(r.id, true)) }}>確定刪除</button>
                </>
              ) : (
                <button className="btn small ghost" onClick={() => setArming(r.id)}>🗑 刪除</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
