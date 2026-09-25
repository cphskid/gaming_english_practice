import { useCallback, useEffect, useState } from 'react'
import { avatarSrc } from '@/data/jobs'
import { frameOf } from '@/data/cosmetics'
import { BOSSES, BOSS_BY_ID, bossWords, raidUrl, type BossDef } from '@/data/bosses'
import { THEME_NAME } from '@/data/words'
import type { WordStat } from '@/core/wordStat'
import { MIN_PLAYERS, MAX_PLAYERS } from '@/games/boss-raid/raid'
import { repo, type RoomBrief, type RoomMember, type RoomState } from '@/net'

/**
 * 房間：魔王團戰（2026-09-25 起，原本「一起打同一關守塔」拿掉了）。
 *
 * **沒有房間代碼。** 房間掛在班級上，同班的人在選關畫面就看得到現在開著哪幾場，
 * 按一下就進去。私人房才要四位數密碼——有的小朋友會故意跑進別人的房間搗亂，
 * 那一團就一直開不成（Chuck 要的）；清單上掛鎖頭，房主看得到密碼好告訴要找的人。
 *
 * **老師和學生都開得了。** 老師那場排最前面並標示出來；老師看得到、關得掉每一場，不用密碼。
 *
 * 狀態靠輪詢，不用 Realtime：長連線在教室的 wifi 斷一下之後要自己處理重連，
 * 那是真的會在上課中出事的地方；每幾秒問一次則是斷了自己就會接回來。
 */

/** 幾秒問一次。等待室問快一點，房主按開始大家才不會等很久。 */
const POLL_MS = 3000
const LOBBY_POLL_MS = 1500

/** 班上開著哪幾場。選關畫面與「魔王團戰」那一頁用。 */
export function useRoomList(classCode: string | null, on: boolean): {
  rooms: RoomBrief[]; refresh: () => Promise<void>
} {
  const [rooms, setRooms] = useState<RoomBrief[]>([])

  const refresh = useCallback(async () => {
    try { setRooms(await repo.roomList(classCode ?? undefined)) }
    catch { /* 網路頓一下就留著上一次的樣子，不要把畫面清空 */ }
  }, [classCode])

  usePoll(refresh, on, POLL_MS)
  return { rooms, refresh }
}

/**
 * 某一場的細節。等待室與老師的面板用。
 *
 * `loaded` 是「問過了」不是「有東西」。少了它，剛進等待室的那一格畫面
 * room 還是 null，會被當成「這一場被收掉了」然後彈回選關畫面。
 */
export function useRoomState(roomId: string | null, on: boolean): {
  room: RoomState | null; loaded: boolean; refresh: () => Promise<void>
} {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { setLoaded(false); setRoom(null) }, [roomId])

  const refresh = useCallback(async () => {
    if (!roomId) { setRoom(null); return }
    try {
      setRoom(await repo.roomState(roomId))
      setLoaded(true)
    } catch { /* 網路頓一下就留著上一次的樣子 */ }
  }, [roomId])

  usePoll(refresh, on && !!roomId, LOBBY_POLL_MS)
  return { room, loaded, refresh }
}

function usePoll(refresh: () => Promise<void>, on: boolean, ms: number): void {
  useEffect(() => {
    if (!on) return
    let alive = true
    const tick = () => { if (alive) void refresh() }
    tick()
    const t = setInterval(tick, ms)
    return () => { alive = false; clearInterval(t) }
  }, [on, refresh, ms])
}

/**
 * 這隻魔王的字你認得幾成（有答對過的字 ÷ 牠考的字）。
 * **不寫難度、不標星等**：難度是看自己，不跟別人比（2026-09-25 定案）。
 */
export function familiarity(b: BossDef, stat: WordStat): number {
  const words = bossWords(b)
  if (!words.length) return 0
  const known = new Set(stat.entries().filter((e) => e.correct > 0).map((e) => e.wordId))
  return words.filter((w) => known.has(w.id)).length / words.length
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const themesOf = (b: BossDef) =>
  b.themes.length ? b.themes.map((t) => THEME_NAME[t] ?? t).join('、') : '全部的字'

/** 誰開的。老師那場要一眼認得出來，不然小朋友會跑去跟同學那場。 */
const hostLabel = (r: { byTeacher: boolean; hostName: string }) =>
  r.byTeacher ? '老師開的' : (r.hostName || '同學') + ' 開的'

export function BossFace({ b, size = 44 }: { b: BossDef; size?: number }) {
  return (
    <span className="bossface" style={{ width: size, height: size, borderColor: b.color }}>
      <img src={raidUrl(`${b.id}/face.png`)} alt="" />
    </span>
  )
}

function MemberRow({ m, playing, canKick, onKick }: {
  m: RoomMember; playing: boolean; canKick: boolean; onKick: () => void
}) {
  const frame = frameOf(m.equipped)
  const state = m.finished ? '✅ 打完了'
    : !m.here ? '💤 不在'
      : playing ? '⚔️ 進行中'
        : '👋 到了'
  return (
    <div className={'rank' + (m.me ? ' me' : '')}>
      <span className={'mugbox' + (frame ? ' ' + frame.className : '')}>
        <img src={avatarSrc(m.avatar)} alt="" />
        {frame?.badge && <i className="mugbadge">{frame.badge}</i>}
      </span>
      <span className="nm">
        {m.nickname}{m.host && <small>　👑</small>}{m.me && <small>　（你）</small>}
        {m.familiar !== null && <small>　認得 {pct(m.familiar)}</small>}
      </span>
      <span className="sc"><b>{state}</b></span>
      {canKick && <button className="btn ghost small" onClick={onKick}>請離開</button>}
    </div>
  )
}

/** 清單上的一場 */
function RoomRow({ r, children }: { r: RoomBrief; children: React.ReactNode }) {
  const b = BOSS_BY_ID.get(r.bossId)
  return (
    <div className={'rank' + (r.mine ? ' me' : '')}>
      {b ? <BossFace b={b} size={40} /> : <span className="rk">👹</span>}
      <span className="nm">
        {r.locked && '🔒 '}{b?.name ?? r.bossId}
        <small>　{hostLabel(r)}　{r.members}/{MAX_PLAYERS} 人{r.status === 'playing' ? '　已開打' : ''}</small>
      </span>
      {children}
    </div>
  )
}

/** 四位數密碼輸入。數字鍵盤、自動只留數字。 */
function PinInput({ value, onChange, autoFocus }: {
  value: string; onChange: (v: string) => void; autoFocus?: boolean
}) {
  return (
    <input className="pin" inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="四位數字"
      value={value} autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} />
  )
}

/** 選魔王的格子。每一格寫牠考哪些主題、你認得幾成。 */
function BossGrid({ pick, onPick, stat }: {
  pick: string; onPick: (id: string) => void; stat: WordStat | null
}) {
  return (
    <div className="bossgrid">
      {BOSSES.map((b) => (
        <button key={b.id} className={'bosspick' + (pick === b.id ? ' on' : '')}
          style={{ ['--boss' as string]: b.color }} onClick={() => onPick(b.id)}>
          <BossFace b={b} size={46} />
          <span className="txt">
            <b>{b.name}</b>
            <small>{themesOf(b)}</small>
            {stat && <small className="fam">你認得 {pct(familiarity(b, stat))}</small>}
          </span>
        </button>
      ))}
    </div>
  )
}

const randomPin = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0')

// -----------------------------------------------------------------------------
// 學生：魔王團戰（現在開著哪幾場、我要開一場）
// -----------------------------------------------------------------------------

export function RoomList({ rooms, stat, onJoin, onOpen, onBack }: {
  rooms: RoomBrief[]
  stat: WordStat
  onJoin: (roomId: string, pass?: string) => Promise<string | null>
  onOpen: (bossId: string, pass: string | null) => Promise<string | null>
  onBack: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState(BOSSES[0].id)
  const [priv, setPriv] = useState(false)
  const [pin, setPin] = useState(randomPin)
  /** 正在輸入哪一場私人房的密碼 */
  const [asking, setAsking] = useState<string | null>(null)
  const [guess, setGuess] = useState('')

  const run = (f: () => Promise<string | null>) => {
    setBusy(true); setError(null)
    void f().then((e) => setError(e)).finally(() => setBusy(false))
  }

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">👹 魔王團戰</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>
      <p className="lede left">
        {MIN_PLAYERS} 到 {MAX_PLAYERS} 個人一起打一隻魔王，三分鐘內把牠的血打光。
        每個人守一座城，城被攻破就先答對題目修好，再繼續出兵。
      </p>

      {error && <p className="error">{error}</p>}

      <h2 className="sec">現在開著的<small>　按一下就進去</small></h2>
      <div className="board">
        {rooms.length === 0 && <p className="lede">現在沒有人在揪。你可以自己開一場。</p>}
        {rooms.map((r) => (
          <RoomRow key={r.id} r={r}>
            {asking === r.id ? (
              <span className="pinask">
                <PinInput value={guess} onChange={setGuess} autoFocus />
                <button className="btn small" disabled={busy || guess.length !== 4}
                  onClick={() => run(() => onJoin(r.id, guess))}>進去</button>
              </span>
            ) : (
              <button className="btn small"
                disabled={busy || (!r.mine && (r.status === 'playing' || r.members >= MAX_PLAYERS))}
                onClick={() => {
                  if (r.locked && !r.mine) { setAsking(r.id); setGuess(''); return }
                  run(() => onJoin(r.id))
                }}>
                {r.mine ? '進去' : r.status === 'playing' ? '開打了' : r.members >= MAX_PLAYERS ? '滿了' : '加入'}
              </button>
            )}
          </RoomRow>
        ))}
      </div>

      <h2 className="sec">我要開一場<small>　先選一隻魔王</small></h2>
      <BossGrid pick={pick} onPick={setPick} stat={stat} />
      <div className="row raidopen">
        <button className={'btn small' + (priv ? ' ghost' : '')} onClick={() => setPriv(false)}>🌐 公開房</button>
        <button className={'btn small' + (priv ? '' : ' ghost')} onClick={() => setPriv(true)}>🔒 私人房</button>
        {priv && <PinInput value={pin} onChange={setPin} />}
      </div>
      <p className="lede left small">
        {priv ? '私人房要打密碼才進得來，把密碼告訴你要找的同學。' : '公開房同班的人都進得來。'}
      </p>
      <div className="row">
        <button className="btn" disabled={busy || (priv && pin.length !== 4)}
          onClick={() => run(() => onOpen(pick, priv ? pin : null))}>
          開一場打{BOSS_BY_ID.get(pick)?.name}
        </button>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// 學生：等待室
// -----------------------------------------------------------------------------

/**
 * 進來之後就待在這裡等開始。一按開始，`onStart` 會被叫起來自己開打——
 * 小朋友不用再按一次「我準備好了」，因為那一定會有人沒按到，然後整場等他。
 */
export function RoomLobby({ room, onStart, onLeave }: {
  room: RoomState
  onStart: (room: RoomState) => void
  onLeave: () => void
}) {
  const b = BOSS_BY_ID.get(room.bossId) ?? BOSSES[0]
  const me = room.members.find((m) => m.me)
  const mySeat = room.seats.find((s) => s.me)
  const playing = room.status === 'playing' && !!mySeat && !me?.finished
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const here = room.members.filter((m) => m.here).length
  const fam = room.members.map((m) => m.familiar).filter((x): x is number => x !== null)
  const avg = fam.length ? fam.reduce((a, x) => a + x, 0) / fam.length : null

  useEffect(() => {
    if (playing) onStart(room)
  }, [playing, room, onStart])

  const act = (f: () => Promise<void>) => {
    setBusy(true); setError(null)
    void f().catch((e) => setError(e instanceof Error ? e.message.replace(/^.*?：/, '') : String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">👹 {hostLabel({
          byTeacher: room.byTeacher,
          hostName: room.members.find((m) => m.host)?.nickname ?? '',
        })}</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onLeave}>先不玩了</button>
      </div>

      <div className="bosscard" style={{ ['--boss' as string]: b.color }}>
        <BossFace b={b} size={64} />
        <span className="txt">
          <b>{b.name}</b>
          <small>{b.tagline}</small>
          <small>考：{themesOf(b)}</small>
          {avg !== null && <small className="fam">全隊平均認得 {pct(avg)}</small>}
        </span>
      </div>

      {room.pass && room.mine && (
        <p className="lede left">🔒 私人房，密碼 <b className="pinshow">{room.pass}</b>　告訴要一起打的同學</p>
      )}
      {error && <p className="error">{error}</p>}

      <p className="lede">
        {room.status === 'playing' && !mySeat ? '這一場已經開打了，你沒趕上，等下一場吧。'
          : playing ? '開始了，正在帶你進去⋯'
            : room.mine ? (here < MIN_PLAYERS ? `至少要 ${MIN_PLAYERS} 個人才能開打，等同學進來。` : '人到齊就按開始，大家會一起進去。')
              : '等房主按開始。一按大家就會一起進去，你不用做什麼。'}
      </p>

      {room.mine && room.status === 'lobby' && (
        <div className="row">
          <button className="btn" disabled={busy || here < MIN_PLAYERS}
            onClick={() => act(() => repo.startRoom(room.id))}>
            ▶️ 大家一起開打（{here} 人）
          </button>
        </div>
      )}

      <div className="board">
        {room.members.map((m) => (
          <MemberRow key={m.studentId} m={m} playing={room.status === 'playing'}
            canKick={room.mine && room.status === 'lobby' && !m.me && !m.host}
            onKick={() => act(() => repo.kickFromRoom(room.id, m.studentId))} />
        ))}
        {room.members.length === 0 && <p className="lede">還沒有人進來。</p>}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// 老師：開一場、看全部的場
// -----------------------------------------------------------------------------

export function TeacherRoom({ classCode }: { classCode: string }) {
  const { rooms, refresh: refreshList } = useRoomList(classCode, true)
  // 老師管的是自己那場；學生自己揪的場列在下面，老師看得到、關得掉、也請得動人。
  const teacherRoom = rooms.find((r) => r.byTeacher) ?? null
  const [openId, setOpenId] = useState<string | null>(null)
  const watching = openId && rooms.some((r) => r.id === openId) ? openId : teacherRoom?.id ?? null
  const { room, refresh: refreshRoom } = useRoomState(watching, true)
  const [pick, setPick] = useState(BOSSES[0].id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (what: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await what(); await refreshList(); await refreshRoom() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }, [refreshList, refreshRoom])

  const here = room?.members.filter((m) => m.here).length ?? 0
  const others = rooms.filter((r) => r.id !== room?.id)
  const b = room ? BOSS_BY_ID.get(room.bossId) : null

  return (
    <>
      <div>
        <h2>魔王團戰</h2>
        <p className="lede left">
          開一場之後，這一班的小朋友在選關畫面就會看到，按一下就進來了，不用抄代碼。
          兩到六個人一場，人到齊你再按開始。小朋友自己開的場也列在下面，
          你不用密碼就看得到、關得掉。
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      {!teacherRoom && (
        <>
          <BossGrid pick={pick} onPick={setPick} stat={null} />
          <div className="row">
            <button className="btn small" disabled={busy}
              onClick={() => void run(async () => {
                setOpenId(await repo.openRaid(pick, null, classCode))
              })}>
              開一場打{BOSS_BY_ID.get(pick)?.name}
            </button>
          </div>
        </>
      )}

      {room && b && (
        <>
          <div className="bosscard" style={{ ['--boss' as string]: b.color }}>
            <BossFace b={b} size={56} />
            <span className="txt">
              <b>{b.name}{room.pass && <small>　🔒 {room.pass}</small>}</b>
              <small>{hostLabel({ byTeacher: room.byTeacher, hostName: room.members.find((m) => m.host)?.nickname ?? '' })}</small>
              <small>{room.status === 'lobby' ? `${here} 個人進來了，在等開打` : `開打了，${room.seats.length} 個人在打`}</small>
            </span>
          </div>
          <div className="row">
            {room.status === 'lobby' && (
              <button className="btn small" disabled={busy || here < MIN_PLAYERS}
                onClick={() => void run(() => repo.startRoom(room.id))}>
                ▶️ 大家一起開打
              </button>
            )}
            <button className="btn ghost small" disabled={busy}
              onClick={() => void run(() => repo.closeRoom(room.id))}>
              結束這一場
            </button>
          </div>
          <div className="board">
            {room.members.map((m) => (
              <MemberRow key={m.studentId} m={m} playing={room.status === 'playing'}
                canKick={room.status === 'lobby'}
                onKick={() => void run(() => repo.kickFromRoom(room.id, m.studentId))} />
            ))}
            {room.members.length === 0 && <p className="lede">還沒有人進來。</p>}
          </div>
        </>
      )}

      {others.length > 0 && (
        <>
          <div><h2>其他開著的場（{others.length}）</h2></div>
          <div className="board">
            {others.map((r) => (
              <RoomRow key={r.id} r={r}>
                <button className="btn ghost small" onClick={() => setOpenId(r.id)}>看</button>
                <button className="btn ghost small" disabled={busy}
                  onClick={() => void run(() => repo.closeRoom(r.id))}>收掉</button>
              </RoomRow>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/**
 * 個人檔案上的「魔王戰績」：打倒過哪幾隻、各幾次。一隻都還沒打倒就不顯示，
 * 不然一排十隻灰色的魔王看起來像在數落人。
 */
export function RaidKills({ studentId }: { studentId?: string }) {
  const [kills, setKills] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let alive = true
    repo.raidKills(studentId).then((k) => { if (alive) setKills(k) }).catch(() => {})
    return () => { alive = false }
  }, [studentId])
  const got = BOSSES.filter((b) => (kills?.[b.id] ?? 0) > 0)
  if (!got.length) return null
  return (
    <div className="raidkills panel">
      <b>👹 打倒過的魔王　{got.length} / {BOSSES.length}</b>
      <div className="row">
        {got.map((b) => (
          <span key={b.id} className="one" title={b.name}>
            <BossFace b={b} size={40} />
            <small>{b.name} ×{kills![b.id]}</small>
          </span>
        ))}
      </div>
    </div>
  )
}
