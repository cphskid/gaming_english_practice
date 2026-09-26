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
  // 介紹網頁的「開始冒險」會帶 ?join=試玩班代碼 過來：直接打開「第一次來」、代碼先填好，
  // 陌生人不用知道什麼是班級代碼。只認英數，其他的當沒帶。
  const [joinCode] = useState(() => {
    const raw = new URLSearchParams(location.search).get('join') ?? ''
    return /^[A-Za-z0-9]{3,12}$/.test(raw) ? raw.toUpperCase() : ''
  })
  // 先給一個標題畫面，點一下才出登入框。不然背景一大半會被表單蓋住，看起來不像遊戲。
  const [opened, setOpened] = useState(joinCode !== '')
  const [tab, setTab] = useState<'login' | 'register'>(joinCode ? 'register' : 'login')
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState(joinCode)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * 填得不對的時候**講出哪裡不對**，而不是讓按鈕變暗。
   *
   * 使用者是國小學生。一顆按不動又不說話的按鈕，小朋友只會一直按，
   * 然後跑去跟老師說「壞掉了」。訊息也要寫成小朋友看得懂的話。
   */
  function problem(): string | null {
    const id = loginId.trim().toLowerCase()
    if (!id) return '要先填帳號喔'
    if (id.length < 3) return '帳號太短了，至少 3 個字'
    if (id.length > 16) return '帳號太長了，最多 16 個字'
    if (!/^[a-z0-9_]+$/.test(id)) return '帳號只能用英文字母、數字和底線'
    if (password.trim().length < 6) {
      return '密碼至少要 6 個字（現在 ' + password.trim().length + ' 個）'
    }
    if (tab === 'register') {
      if (!nickname.trim()) return '取一個暱稱吧，那是排行榜上會顯示的名字'
      if (code.trim().length < 3) return '要填老師給你的班級代碼'
    }
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const bad = problem()
    if (bad) { setError(bad); return }
    setBusy(true)
    setError(null)
    const msg = tab === 'login'
      ? await onLogin(loginId, password)
      : await onRegister(loginId, password, nickname, code)
    setBusy(false)
    if (msg) setError(msg)
  }

  const title = (
    <header className={'game-title' + (opened ? ' small' : '')}>
      <h1 lang="en">World Guardians</h1>
      <p className="zh">守護異世界</p>
      <p className="sub">用語言魔力來冒險吧！</p>
    </header>
  )

  if (!opened) {
    return (
      <div className="screen title-screen">
        <div className="title-bg" aria-hidden="true" />
        {title}
        <button className="start-btn" onClick={() => setOpened(true)}>點一下開始冒險</button>
        <button className="teacher-link" onClick={onStaff}>我是老師／家長 ›</button>
      </div>
    )
  }

  return (
    <div className="screen title-screen opened">
      <div className="title-bg" aria-hidden="true" />
      {title}

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

        <button className="btn" type="submit" disabled={busy}>
          {busy ? '請稍等…' : tab === 'login' ? '開始玩' : '建立帳號'}
        </button>
      </form>

      <p className="lede">
        {tab === 'login'
          ? '忘記密碼了嗎？請老師幫你重設一個。'
          : (joinCode && code === joinCode ? '班級代碼已經幫你填好了。' : '')
          + '帳號是登入用的，暱稱是大家看得到的名字，兩個可以不一樣。不會用到真實姓名，也不用填 email。'}
      </p>

      <button className="teacher-link" onClick={onStaff}>我是老師／家長 ›</button>
    </div>
  )
}
