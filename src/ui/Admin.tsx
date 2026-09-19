import { useCallback, useEffect, useState } from 'react'
import type { TeacherRow } from '@/core/types'
import { repo } from '@/net'

/**
 * 管理員後台。管的是老師，不是學生。
 *
 * 老師不能自己註冊成老師：管理員先把 email 加進名單，對方註冊完才認領得到。
 * 這樣管理員不用經手別人的密碼，老師也不用等人按核准。
 *
 * 少了這道關卡的話，開放學生自由註冊之後，任何人拿 email 註冊都能開班當老師。
 */
export function Admin({ onBack }: { onBack: () => void }) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [invites, setInvites] = useState<{ email: string; used: boolean }[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [t, i] = await Promise.all([repo.listTeachers(), repo.listInvites()])
    setTeachers(t)
    setInvites(i)
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
        <div>
          <h2>加一位老師</h2>
          <p className="lede left">
            填他的 email 就好。他自己去註冊、自己設密碼，你不會碰到他的密碼。
          </p>
        </div>
        <form className="row" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const added = await repo.inviteTeacher(email)
            setEmail('')
            return `${added} 可以去註冊了`
          })
        }}>
          <input type="email" value={email} placeholder="teacher@school.edu.tw"
            onChange={(e) => setEmail(e.target.value)} />
          <button className="btn small" type="submit" disabled={!emailOk}>加進名單</button>
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
          <h2>名單上還沒註冊的</h2>
        </div>
        <div className="roster">
          {invites.filter((i) => !i.used).length === 0 && (
            <p className="lede">名單上的人都註冊完了。</p>
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
