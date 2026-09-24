import { useEffect, useState } from 'react'
import { RULES } from '@/games/tug-of-war/battle'
import { repo } from '@/net'
import type { GhostRow } from '@/net/repository'
import { avatarSrc } from '@/data/jobs'
import { legionById } from '@/data/legions'

/** 「3 分鐘前」「昨天」這種講法。小朋友看不懂日期時間戳。 */
function ago(at: number): string {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小時前`
  const d = Math.round(h / 24)
  return d === 1 ? '昨天' : `${d} 天前`
}

/**
 * 對戰前的那一頁。
 *
 * 兩種對手：同學的分身（重播他最近一場），和電腦。兩種都**老實寫出來**——
 * 小孩被騙到會更不爽，以為同學在線上跟他打、跑去問才發現不是，那更糟。
 * 之後的即時配對接在同一頁，對引擎來說都只是換一串答題（見 core/opponent.ts）。
 */
export function Versus({
  myRate, onStart, onGhost, onBack,
}: {
  /** 我現在大概每分鐘答得完幾題，拿來說明對手有多快 */
  myRate: number
  onStart: (hardness: number, name: string) => void
  /** 挑戰某個同學的分身。回傳錯誤訊息（抓不到那一場）或 null */
  onGhost: (studentId: string) => Promise<string | null>
  onBack: () => void
}) {
  const [ghosts, setGhosts] = useState<GhostRow[] | null>(null)
  const [ghostErr, setGhostErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    repo.listGhosts()
      .then((g) => { if (alive) setGhosts(g) })
      .catch(() => { if (alive) { setGhosts([]); setGhostErr('同學名單讀不到，網路好一點再回來看看') } })
    return () => { alive = false }
  }, [])

  async function challenge(id: string) {
    if (busy) return
    setBusy(id)
    setGhostErr(null)
    const err = await onGhost(id)
    if (err) { setGhostErr(err); setBusy(null) }
  }

  const rate = (h: number) => Math.max(8, Math.min(30, Math.round(myRate * h)))
  const foes: { name: string; hardness: number; desc: string }[] = [
    { name: '見習兵', hardness: 0.75, desc: '比你慢一點，先熟悉怎麼推' },
    { name: '同班同學', hardness: 1.0, desc: '跟你差不多快，會一路拉鋸' },
    { name: '隔壁班高手', hardness: 1.3, desc: '比你快，要專心才推得回去' },
  ]

  return (
    <div className="screen wide">
      <div className="topbar">
        <h2>⚔️ 兵推對戰</h2>
        <span className="spacer" />
        <button className="btn ghost" onClick={onBack}>回選關</button>
      </div>

      <div className="panel vs-intro">
        <p>
          答對一題就派一隻兵往對面走。兩邊的兵在中間打架，誰的兵撐不住，
          <b>前線就往誰那邊退</b>。推到對方城堡就開始打城堡。
        </p>
        <p className="muted">
          一場 {RULES.seconds / 60} 分鐘。時間到的時候，城堡被打得比較兇的人輸；
          城堡一樣就看前線推到哪。<b>答對一次就是一隻兵，按再快也不會變多</b>——
          比的是英文，不是手速。
        </p>
      </div>

      <h3 className="vs-h">👥 挑戰同學的分身</h3>
      <p className="vs-sub muted">
        分身＝同學最近一場的重播，他本人不在線上。打完你的這一場也會變成你的分身，讓同學來挑戰。
      </p>
      <div className="vs-ghosts">
        {ghosts === null && <p className="vs-sub muted">讀取同學名單中…</p>}
        {ghosts?.length === 0 && !ghostErr && (
          <p className="vs-sub muted">班上還沒有人打過兵推。先打一場電腦，你就是第一個分身！</p>
        )}
        {ghosts?.map((g) => (
          <button key={g.studentId} className="panel vs-ghost" disabled={!!busy}
            onClick={() => void challenge(g.studentId)}>
            <span className="mugbox vs-mug"><img src={avatarSrc(g.avatar)} alt="" /></span>
            <span className="txt">
              <b>{g.nickname}的分身</b>
              <small className="muted">
                {ago(g.endedAt)}那一場・答對 {g.correct} 題・{legionById(g.legion).name}
              </small>
            </span>
            <span className="go">{busy === g.studentId ? '載入中' : '挑戰'}</span>
          </button>
        ))}
        {ghostErr && <p className="vs-sub err">{ghostErr}</p>}
      </div>

      <h3 className="vs-h">🤖 打電腦</h3>
      <div className="vs-foes">
        {foes.map((f) => (
          <button key={f.name} className="panel vs-foe" onClick={() => onStart(f.hardness, f.name)}>
            <span className="ic">🤖</span>
            <span className="txt">
              <b>{f.name}</b>
              <small>{f.desc}</small>
              <small className="muted">電腦對手・每分鐘約答對 {rate(f.hardness)} 題</small>
            </span>
            <span className="go">開打</span>
          </button>
        ))}
      </div>

      <p className="vs-note muted">
        打贏電腦或分身不會記進戰旗勝場，金幣和經驗照樣拿得到（那本來就只從答對來）。
      </p>
    </div>
  )
}
