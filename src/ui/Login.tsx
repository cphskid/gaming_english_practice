import { useState } from 'react'

/**
 * 班級代碼＋暱稱。**不收真實姓名、不收 email**——使用者是國小學生。
 * 這組東西只用來認人，不用來授權；防作弊在後端做，不在這裡。
 */
export function Login({ onJoin }: { onJoin: (classCode: string, nickname: string) => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const ok = code.trim().length >= 2 && name.trim().length >= 1

  return (
    <div className="screen">
      <h1>🏰 單字守塔</h1>
      <p className="lede">輸入老師給的班級代碼，取一個你喜歡的暱稱就可以開始。</p>
      <form
        className="form panel"
        onSubmit={(e) => { e.preventDefault(); if (ok) onJoin(code, name) }}
      >
        <div>
          <label htmlFor="cls">班級代碼</label>
          <input id="cls" value={code} autoComplete="off" maxLength={12}
            onChange={(e) => setCode(e.target.value)} placeholder="例如 3A2025" />
        </div>
        <div>
          <label htmlFor="nick">暱稱</label>
          <input id="nick" value={name} autoComplete="off" maxLength={10}
            onChange={(e) => setName(e.target.value)} placeholder="例如 小雷" />
        </div>
        <button className="btn" type="submit" disabled={!ok}>進入教室</button>
      </form>
      <p className="lede">不會用到真實姓名，也不用填 email。</p>
    </div>
  )
}
