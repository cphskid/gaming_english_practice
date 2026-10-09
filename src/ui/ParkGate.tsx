import { useState } from 'react'
import { PARK_URL } from '@/net'

/**
 * 樂園說「現在不能進來」時的畫面（park_can_enter 回 ok=false）。
 *
 * 會走到這裡的原因都是小朋友自己解決不了、但說得出口的：設施維修中、班上還沒開放、
 * 還沒加入班級。所以畫面只做三件事：把原因講清楚、給一條回樂園的路、讓他按得了重試
 * （老師剛按開放，小朋友不用登出再登入）。
 */
export function ParkGate({ nickname, reason, onRetry, onLogout }: {
  nickname: string
  reason: string
  onRetry: () => Promise<void>
  onLogout: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="screen">
      <h1>城堡的門還關著</h1>
      <p className="lede">{nickname}，{reason}</p>
      <button className="btn big" disabled={busy} onClick={() => void (async () => {
        setBusy(true)
        try { await onRetry() } finally { setBusy(false) }
      })()}>{busy ? '問問看…' : '再試一次'}</button>
      {/* 帶 #map 直接回樂園的島嶼地圖，不要停在 Start Game 開場 */}
      {PARK_URL && <a className="btn ghost" href={PARK_URL + '#map'}>回時空冒險樂園</a>}
      <button className="btn ghost small" onClick={onLogout}>換一個帳號</button>
    </div>
  )
}
