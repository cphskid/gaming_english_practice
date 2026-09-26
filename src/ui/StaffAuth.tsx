import { useState } from 'react'

/**
 * 開班的人（老師或家長）與管理員的登入。**用真的 email**，跟學生完全分開。
 *
 * 開班的人可以自己註冊、馬上能用，不用等管理員也不收確認信。
 * 不審核是因為開班帳號只管得到自己的班；防濫用靠「年滿 18 歲」的勾選、
 * 班數與人數上限，以及管理員看得到名單、可以停用（見 register_teacher）。
 *
 * 「我是第一個使用者」（認領管理員）只放在老師後台，系統還沒有管理員時才出現，
 * 不放這裡：家長會好奇按下去，然後看到一句看不懂的拒絕。
 */
export function StaffAuth({
  onLogin, onSignUp, onBack,
}: {
  onLogin: (email: string, password: string) => Promise<string | null>
  onSignUp: (email: string, password: string, displayName: string, adult: boolean) => Promise<string | null>
  onBack: () => void
}) {
  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [adult, setAdult] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * 填得不對的時候**回傳原因**，而不是讓按鈕變暗。
   *
   * 本來是暗的，結果第一個用的人按了半天沒反應，也不知道是密碼太短——
   * 一顆按不動又不說話的按鈕，使用者只會覺得壞了。
   */
  function problem(): string | null {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return 'email 看起來不太對，再檢查一下'
    if (password.length < 8) return '密碼至少要 8 個字（現在 ' + password.length + ' 個）'
    if (tab === 'signup' && !name.trim()) return '填一下你的稱呼，學生會看到'
    if (tab === 'signup' && !adult) return '請勾選「我是老師或家長，年滿 18 歲」'
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const bad = problem()
    if (bad) { setError(bad); setNote(null); return }
    setBusy(true); setError(null); setNote(null)
    const msg = tab === 'login'
      ? await onLogin(email, password)
      : await onSignUp(email, password, name, adult)
    setBusy(false)
    if (msg) setError(msg)
  }


  return (
    <div className="screen">
      <h1>老師／家長登入</h1>

      <div className="tabs">
        <button className={tab === 'login' ? 'on' : ''}
          onClick={() => { setTab('login'); setError(null) }}>登入</button>
        <button className={tab === 'signup' ? 'on' : ''}
          onClick={() => { setTab('signup'); setError(null) }}>第一次使用</button>
      </div>

      {/* noValidate：瀏覽器內建的 email 檢查會搶在送出之前擋掉，
          我們自己的訊息就永遠不會出現，畫面上還會留著上一次的錯誤。 */}
      <form className="form panel" onSubmit={submit} noValidate>
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
            <input id="dn" value={name} autoComplete="off" maxLength={16}
              onChange={(e) => setName(e.target.value)} placeholder="例如 王老師、小明媽媽" />
          </div>
        )}
        {tab === 'signup' && (
          <label className="switch">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            我是老師或家長，年滿 18 歲
          </label>
        )}

        {error && <p className="error">{error}</p>}
        {note && <p className="note">{note}</p>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? '請稍等…' : tab === 'login' ? '登入' : '建立帳號'}
        </button>
      </form>

      <p className="lede">
        老師或家長都可以開班：點上面的「第一次使用」建帳號，馬上就能開班、拿到班級代碼給孩子。
        一個帳號最多開 3 個班、每班 40 人，不夠用請按「問題回報」告訴我們。
      </p>

      <div className="row">
        <button className="btn ghost small" onClick={onBack}>回學生登入</button>
      </div>
    </div>
  )
}
