import { useState } from 'react'

/**
 * 學生的登入與註冊。**不收真實姓名、不收 email**——使用者是國小學生。
 *
 * 登入帳號跟暱稱是兩件事：帳號全站唯一、只有登入時用得到；
 * 暱稱是排行榜上顯示的名字，可以改、可以跟別班的人重複。
 *
 * 班級代碼在註冊時同時是邀請碼，所以網址流出去也不會變成誰都能進的公開網站。
 */
export function Login({
  onLogin, onRegister, onStaff,
}: {
  onLogin: (loginId: string, password: string) => Promise<string | null>
  onRegister: (loginId: string, password: string, nickname: string, classCode: string)
    => Promise<string | null>
  onStaff: () => void
}) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const idOk = /^[a-z0-9_]{3,16}$/.test(loginId.trim().toLowerCase())
  const pwOk = password.trim().length >= 6
  const ok = tab === 'login'
    ? idOk && pwOk
    : idOk && pwOk && nickname.trim().length >= 1 && code.trim().length >= 3

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    setError(null)
    const msg = tab === 'login'
      ? await onLogin(loginId, password)
      : await onRegister(loginId, password, nickname, code)
    setBusy(false)
    if (msg) setError(msg)
  }

  return (
    <div className="screen">
      <h1>🏰 單字守塔</h1>

      <div className="tabs">
        <button className={tab === 'login' ? 'on' : ''}
          onClick={() => { setTab('login'); setError(null) }}>我有帳號</button>
        <button className={tab === 'register' ? 'on' : ''}
          onClick={() => { setTab('register'); setError(null) }}>第一次來</button>
      </div>

      <form className="form panel" onSubmit={submit}>
        {tab === 'register' && (
          <div>
            <label htmlFor="cls">班級代碼</label>
            <input id="cls" value={code} autoComplete="off" maxLength={12}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="老師給你的代碼" />
          </div>
        )}

        <div>
          <label htmlFor="lid">帳號</label>
          <input id="lid" value={loginId} autoComplete="username" maxLength={16}
            onChange={(e) => setLoginId(e.target.value.replace(/[^A-Za-z0-9_]/g, '').toLowerCase())}
            placeholder="英文或數字，例如 ming123" />
        </div>

        <div>
          <label htmlFor="pw">密碼</label>
          <input id="pw" type="password" value={password} maxLength={32}
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6 個以上的英文或數字" />
        </div>

        {tab === 'register' && (
          <div>
            <label htmlFor="nick">暱稱</label>
            <input id="nick" value={nickname} autoComplete="off" maxLength={16}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="排行榜上顯示的名字，例如 小雷" />
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <button className="btn" type="submit" disabled={!ok || busy}>
          {busy ? '請稍等…' : tab === 'login' ? '開始玩' : '建立帳號'}
        </button>
      </form>

      <p className="lede">
        {tab === 'login'
          ? '忘記密碼了嗎？請老師幫你重設一個。'
          : '帳號是登入用的，暱稱是大家看得到的名字，兩個可以不一樣。不會用到真實姓名，也不用填 email。'}
      </p>

      <button className="btn ghost small" onClick={onStaff}>我是老師</button>
    </div>
  )
}
