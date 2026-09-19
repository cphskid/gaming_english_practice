import { useState } from 'react'

/**
 * 老師與管理員的登入。**用真的 email**，跟學生完全分開。
 *
 * 理由：老師需要自己救得回密碼（寄重設信），而學生的密碼是由老師重設的。
 * 人數也差很多——老師幾個人，學生一整班，後者走 email 註冊會被寄信額度擋死。
 *
 * 註冊要管理員先把 email 加進名單。第一個註冊的人可以認領成管理員，
 * 之後那個按鈕就沒用了。
 */
export function StaffAuth({
  onLogin, onSignUp, onClaimFirstAdmin, onBack,
}: {
  onLogin: (email: string, password: string) => Promise<string | null>
  onSignUp: (email: string, password: string, displayName: string) => Promise<string | null>
  onClaimFirstAdmin: () => Promise<string | null>
  onBack: () => void
}) {
  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && password.length >= 8

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true); setError(null); setNote(null)
    const msg = tab === 'login'
      ? await onLogin(email, password)
      : await onSignUp(email, password, name)
    setBusy(false)
    if (msg) setError(msg)
  }

  async function claim() {
    setBusy(true); setError(null); setNote(null)
    const msg = await onClaimFirstAdmin()
    setBusy(false)
    if (msg) setError(msg)
    else setNote('你現在是管理員了。')
  }

  return (
    <div className="screen">
      <h1>老師登入</h1>

      <div className="tabs">
        <button className={tab === 'login' ? 'on' : ''}
          onClick={() => { setTab('login'); setError(null) }}>登入</button>
        <button className={tab === 'signup' ? 'on' : ''}
          onClick={() => { setTab('signup'); setError(null) }}>第一次使用</button>
      </div>

      <form className="form panel" onSubmit={submit}>
        <div>
          <label htmlFor="em">email</label>
          <input id="em" type="email" value={email} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu.tw" />
        </div>
        <div>
          <label htmlFor="spw">密碼</label>
          <input id="spw" type="password" value={password}
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 個字" />
        </div>
        {tab === 'signup' && (
          <div>
            <label htmlFor="dn">你的稱呼</label>
            <input id="dn" value={name} autoComplete="off" maxLength={20}
              onChange={(e) => setName(e.target.value)} placeholder="例如 王老師" />
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {note && <p className="note">{note}</p>}

        <button className="btn" type="submit" disabled={!ok || busy}>
          {busy ? '請稍等…' : tab === 'login' ? '登入' : '建立帳號'}
        </button>
      </form>

      <p className="lede">
        老師帳號要由管理員先把你的 email 加進名單才建得起來。
      </p>

      <div className="row">
        <button className="btn ghost small" onClick={onBack}>回學生登入</button>
        <button className="btn ghost small" onClick={() => void claim()} disabled={busy}>
          我是第一個使用者
        </button>
      </div>
      <p className="lede small">
        「我是第一個使用者」只有在系統還沒有任何管理員時有用，按一下就會把目前登入的
        帳號設成最高管理員。之後再按都會被拒絕。
      </p>
    </div>
  )
}
