import { useCallback, useEffect, useState } from 'react'
import type { AdminClassRow, TeacherRow } from '@/core/types'
import { repo } from '@/net'
import type { FeedbackRow, FeedbackStatus } from '@/net/repository'

/**
 * 管理員後台。管的是老師與班級，不是學生。
 *
 * 老師的帳號**由管理員直接開**，不走「加進名單→自己註冊」那條路：
 * Supabase 註冊會寄一封確認信，而這個專案的寄信額度是一小時兩封，
 * 幾位老師同一個下午一起註冊就會有人卡在收不到信。
 * email 在這裡只是登入用的名字，老師的權限本來就是管理員給的。
 *
 * 少了這道關卡的話，開放學生自由註冊之後，任何人拿 email 註冊都能開班當老師。
 */
export function Admin({ onBack }: { onBack: () => void }) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [invites, setInvites] = useState<{ email: string; used: boolean }[]>([])
  const [classes, setClasses] = useState<AdminClassRow[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [t, i, c] = await Promise.all([
      repo.listTeachers(), repo.listInvites(), repo.listAllClasses(),
    ])
    setTeachers(t)
    setInvites(i)
    setClasses(c)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const run = useCallback(async (what: () => Promise<string | void>) => {
    setError(null); setNote(null)
    try {
      const msg = await what()
      if (typeof msg === 'string') setNote(msg)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [refresh])

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  // 老師手上是整個班的資料，密碼要求比學生高
  const formOk = emailOk && password.length >= 8 && name.trim().length > 0
  // 停用中的老師不能接班——接了等於這個班沒人帶，畫面上卻看起來正常。
  const active = teachers.filter((t) => t.active)

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">管理員</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回老師後台</button>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <div className="teacher">
        <FeedbackInbox />

        <div>
          <h2>加一位老師</h2>
          <p className="lede left">
            帳號直接幫他開好，把 email 和密碼給他就能登入，不用等確認信。
            他如果已經自己註冊過（卡在進不去），這裡填一樣的 email 就會把他設成老師，
            密碼還是他自己原本那組。
          </p>
        </div>
        <form className="row" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const added = await repo.createTeacher(email, password, name)
            setEmail(''); setPassword(''); setName('')
            return added.created
              ? `${added.email} 的帳號開好了，把 email 和密碼給他`
              : `${added.email} 本來就有帳號，已經設成老師了，請他用原本的密碼登入`
          })
        }}>
          <input value={name} placeholder="他的名字（例如 王老師）"
            onChange={(e) => setName(e.target.value)} />
          <input type="email" value={email} placeholder="teacher@school.edu.tw"
            onChange={(e) => setEmail(e.target.value)} />
          <input value={password} placeholder="密碼，至少 8 個字"
            onChange={(e) => setPassword(e.target.value)} />
          <button className="btn small" type="submit" disabled={!formOk}>開帳號</button>
        </form>

        <div>
          <h2>老師（{teachers.length}）</h2>
        </div>
        <div className="roster">
          {teachers.map((t) => (
            <div className="r" key={t.userId}>
              <span className="n">
                {t.displayName}{t.isAdmin && <small>　管理員</small>}
              </span>
              <span className="s">
                {t.classes} 個班　{t.students} 位同學　{t.active ? '啟用中' : '已停用'}
              </span>
              {!t.isAdmin && (
                <button className="btn ghost small" onClick={() => void run(async () => {
                  await repo.setTeacherActive(t.userId, !t.active)
                  return t.active ? `${t.displayName} 已停用` : `${t.displayName} 已恢復`
                })}>
                  {t.active ? '停用' : '恢復'}
                </button>
              )}
            </div>
          ))}
        </div>

        <div>
          <h2>全部班級（{classes.length}）</h2>
          <p className="lede left">
            換老師只是換帶這一班的人。班級代碼、學生、進度都不動，沒有人會掉出去。
          </p>
        </div>
        <div className="roster">
          {classes.length === 0 && <p className="lede">還沒有人開班。</p>}
          {classes.map((c) => (
            <div className="r" key={c.code}>
              <span className="n">
                {c.name || '（沒有名字）'}<small>　{c.code}</small>
              </span>
              <span className="s">
                {/* 手機上這一行會折行，全形空白折起來會黏成一團，所以用點分隔 */}
                {c.ownerName}{!c.ownerActive && '（已停用）'}
                {' ・ '}{c.students} 位同學
                {' ・ '}{c.open ? '開放加入' : '不開放'}
              </span>
              <select value={c.ownerId} disabled={active.length < 2}
                onChange={(e) => {
                  const to = teachers.find((t) => t.userId === e.target.value)
                  if (!to || to.userId === c.ownerId) return
                  void run(async () => {
                    await repo.setClassOwner(c.code, to.userId)
                    return `${c.name || c.code} 交給 ${to.displayName} 了`
                  })
                }}>
                {active.map((t) => (
                  <option key={t.userId} value={t.userId}>{t.displayName}</option>
                ))}
                {!active.some((t) => t.userId === c.ownerId) && (
                  <option value={c.ownerId}>{c.ownerName}</option>
                )}
              </select>
            </div>
          ))}
        </div>

        <div>
          <h2>名單上還沒註冊的</h2>
          <p className="lede left">
            以前加進名單、還沒自己去註冊的人。他們照舊可以自己註冊，
            但那條路會收到一封確認信。
          </p>
        </div>
        <div className="roster">
          {invites.filter((i) => !i.used).length === 0 && (
            <p className="lede">沒有人卡在名單上。</p>
          )}
          {invites.filter((i) => !i.used).map((i) => (
            <div className="r" key={i.email}>
              <span className="n">{i.email}</span>
              <span className="s">還沒註冊</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const STATUS: { id: FeedbackStatus; label: string }[] = [
  { id: 'new', label: '還沒看' },
  { id: 'bug', label: 'Bug 要修' },
  { id: 'request', label: '需求' },
  { id: 'unclear', label: '要 Chuck 決定' },
  { id: 'fixed', label: '修好了' },
  { id: 'dup', label: '重複' },
  { id: 'wontfix', label: '不處理' },
]
const KIND_LABEL = { bug: '🐞 壞掉了', confusing: '❓ 看不懂', idea: '💡 想法' }

/**
 * 學生老師按「回報」送來的東西。Claude 排程會定期來分類，
 * 這裡是給管理員自己看、自己改分類用的。
 */
function FeedbackInbox() {
  const [filter, setFilter] = useState<FeedbackStatus | ''>('')
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await repo.listFeedback(filter || undefined)); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [filter])
  useEffect(() => { void load() }, [load])

  const fresh = rows.filter((r) => r.status === 'new' || r.status === 'unclear').length

  return (
    <>
      <div>
        <h2>回報{fresh > 0 && `（${fresh} 則待處理）`}</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as FeedbackStatus | '')}>
          <option value="">全部</option>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="fb-list">
        {rows.length === 0 && <p className="lede">沒有回報。</p>}
        {rows.slice(0, 50).map((r) => (
          <div className="fb-item" key={r.id}>
            <div className="fb-row">
              <b>{KIND_LABEL[r.kind]}</b>
              <span>{r.who}{r.classCode && `・${r.classCode}`}</span>
              <span className="spacer" />
              <select value={r.status} onChange={(e) => void (async () => {
                try {
                  await repo.triageFeedback(r.id, e.target.value as FeedbackStatus, '')
                  await load()
                } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
              })()}>
                {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>{r.message}</div>
            {r.note && <div className="fb-meta">處理說明：{r.note}</div>}
            <div className="fb-meta">
              {new Date(r.createdAt).toLocaleString('zh-TW')}・{r.screen}
              {typeof r.context.level === 'string' && `・${r.context.level}`}
              {typeof r.context.ver === 'string' && `・v${r.context.ver}`}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
