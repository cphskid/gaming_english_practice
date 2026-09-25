import { useEffect, useRef, useState } from 'react'
import { RULES } from '@/games/tug-of-war/battle'
import { repo } from '@/net'
import type { GhostRow, LiveLobby, LiveMatchInfo } from '@/net/repository'
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

/** 排隊、邀請等多久沒回音就放棄。Chuck 定的 20 秒。 */
const WAIT_S = 20
/** 多久報到一次（live_poll）。伺服器 6 秒沒看到就當你不在了。 */
const POLL_MS = 1500

/**
 * 對戰前的那一頁。
 *
 * 最上面是真人對戰（2026-09-25）：隨機對戰當主按鈕，另外列出班上現在也在這一頁的同學，
 * 點頭像邀請。**隨機對戰沒有「拒絕」這一步**，不認識人、人緣比較差的小朋友也一定配得到；
 * 邀請沒人接只顯示「他現在沒空」，不說「被拒絕」。
 *
 * 下面兩種對手：同學的分身（重播他最近一場），和電腦。兩種都**老實寫出來**——
 * 小孩被騙到會更不爽，以為同學在線上跟他打、跑去問才發現不是，那更糟。
 * 之後的即時配對接在同一頁，對引擎來說都只是換一串答題（見 core/opponent.ts）。
 */
export function Versus({
  myRate, onStart, onGhost, onLive, onBack,
}: {
  /** 我現在大概每分鐘答得完幾題，拿來說明對手有多快 */
  myRate: number
  onStart: (hardness: number, name: string) => void
  /** 挑戰某個同學的分身。回傳錯誤訊息（抓不到那一場）或 null */
  onGhost: (studentId: string) => Promise<string | null>
  /** 真人對戰配到人了 */
  onLive: (m: LiveMatchInfo) => void
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

  // ------------------------------------------------------------ 真人對戰
  const [lobby, setLobby] = useState<LiveLobby | null>(null)
  const [lobbyErr, setLobbyErr] = useState(false)
  /** 按了隨機對戰的時間（Date.now），沒在排是 0 */
  const [seekAt, setSeekAt] = useState(0)
  /** 我邀了誰、什麼時候邀的 */
  const [invite, setInvite] = useState<{ id: string; at: number } | null>(null)
  /** 邀請過期的人（他現在沒空），下面那一列改成「打他的分身」 */
  const [noAnswer, setNoAnswer] = useState<string | null>(null)
  /** 按了「現在不要」的邀請，這一輪不再跳出來 */
  const [dismissed, setDismissed] = useState<string[]>([])
  const [liveMsg, setLiveMsg] = useState<string | null>(null)
  const [, setNow] = useState(0)
  const started = useRef(false)
  const seekRef = useRef(0)
  seekRef.current = seekAt
  const onLiveRef = useRef(onLive)
  onLiveRef.current = onLive

  useEffect(() => {
    let alive = true
    const poll = async () => {
      if (started.current) return
      try {
        const l = await repo.livePoll(seekRef.current > 0, myRate)
        if (!alive || started.current) return
        setLobby(l)
        setLobbyErr(false)
        if (l.match) { started.current = true; onLiveRef.current(l.match) }
      } catch {
        if (alive) setLobbyErr(true)
      }
    }
    void poll()
    const t = setInterval(() => { void poll(); setNow(Date.now()) }, POLL_MS)
    // 離開這一頁：收回邀請、退出隊伍（伺服器 6 秒沒看到也會自己當你不在）
    return () => { alive = false; clearInterval(t); if (!started.current) void repo.liveInvite(null).catch(() => {}) }
  }, [myRate])

  // 排隊 20 秒還沒配到：改打一位程度接近的同學的分身，沒有分身就打跟你差不多快的電腦
  const left = (at: number) => Math.max(0, WAIT_S - Math.floor((Date.now() - at) / 1000))
  useEffect(() => {
    if (!seekAt || left(seekAt) > 0 || started.current) return
    setSeekAt(0)
    const want = myRate * (RULES.seconds / 60)
    const near = [...(ghosts ?? [])].sort((a, b) => Math.abs(a.correct - want) - Math.abs(b.correct - want))[0]
    if (near) {
      setLiveMsg(`現在沒有同學在排隊，改打${near.nickname}的分身`)
      void challenge(near.studentId)
    } else {
      setLiveMsg('現在沒有同學在排隊，先打一場電腦')
      onStart(1.0, '同班同學')
    }
  })
  useEffect(() => {
    if (!invite || left(invite.at) > 0) return
    setNoAnswer(invite.id)
    setInvite(null)
    void repo.liveInvite(null).catch(() => {})
  })

  function seek() {
    if (seekAt) { setSeekAt(0); return }
    setInvite(null); setNoAnswer(null); setLiveMsg(null)
    setSeekAt(Date.now())
  }

  async function inviteOne(id: string) {
    setSeekAt(0); setNoAnswer(null); setLiveMsg(null)
    const ok = await repo.liveInvite(id).catch(() => false)
    if (ok) setInvite({ id, at: Date.now() })
    else setLiveMsg('他剛離開對戰頁了')
  }

  async function accept(id: string) {
    const m = await repo.liveAccept(id).catch(() => null)
    if (m && !started.current) { started.current = true; onLiveRef.current(m); return }
    setLiveMsg('這個邀請過期了，換你邀他看看')
    setDismissed((d) => [...d, id])
  }

  const invites = (lobby?.invites ?? []).filter((p) => !dismissed.includes(p.id))
  const online = lobby?.online ?? []
  const ghostOf = (id: string) => ghosts?.find((g) => g.studentId === id)

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

      <h3 className="vs-h">⚡ 真人對戰</h3>
      {invites.map((p) => (
        <div key={p.id} className="panel vs-invite">
          <span className="mugbox vs-mug"><img src={avatarSrc(p.avatar)} alt="" /></span>
          <span className="txt"><b>{p.nickname}</b> 邀你對戰！</span>
          <button className="btn small" onClick={() => void accept(p.id)}>接受</button>
          <button className="btn ghost small" onClick={() => setDismissed((d) => [...d, p.id])}>現在不要</button>
        </div>
      ))}
      <div className="vs-live">
        <button className={'panel vs-seek' + (seekAt ? ' on' : '')} onClick={seek}>
          <span className="ic">🎲</span>
          <span className="txt">
            <b>{seekAt ? `配對中…還有 ${left(seekAt)} 秒` : '隨機對戰'}</b>
            <small>{seekAt
              ? '找班上也在排隊、程度跟你差不多的同學。沒配到就改打分身（再按一下取消）'
              : '系統幫你配一位班上的同學，跟本人即時對打'}</small>
          </span>
        </button>
        <p className="vs-sub muted">
          {online.length ? `班上現在在這一頁的同學（${online.length}）：點「邀請」找他對打` : '現在班上沒有其他同學在這一頁。按隨機對戰等一下，或先挑戰分身。'}
        </p>
        {online.map((p) => {
          const waiting = invite?.id === p.id
          const busyNo = noAnswer === p.id
          const g = ghostOf(p.id)
          return (
            <div key={p.id} className="panel vs-person">
              <span className="mugbox vs-mug"><img src={avatarSrc(p.avatar)} alt="" /></span>
              <span className="txt">
                <b>{p.nickname}</b>
                <small className="muted">
                  {p.busy ? '正在對戰中' : waiting ? `等他回應…${left(invite!.at)}` : busyNo ? '他現在沒空' : '在線上'}
                  {p.fresh && <span className="fresh">　✨ 還沒跟你對打過</span>}
                </small>
              </span>
              {busyNo && g
                ? <button className="btn ghost small" onClick={() => void challenge(p.id)}>打他的分身</button>
                : <button className="btn small" disabled={p.busy || waiting}
                    onClick={() => void inviteOne(p.id)}>{waiting ? '邀請中' : '邀請'}</button>}
            </div>
          )
        })}
        {lobbyErr && <p className="vs-sub err">連不上對戰大廳，網路好一點會自己接上</p>}
        {liveMsg && <p className="vs-sub">{liveMsg}</p>}
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
        只有跟同學真人對戰打贏才記進戰旗勝場；打贏電腦或分身不算，金幣和經驗照樣拿得到（那本來就只從答對來）。
        真人對戰不能用道具。
      </p>
    </div>
  )
}
