import { useCallback, useEffect, useState } from 'react'
import { LEVELS, LEVEL_IDS } from '@/data/levels'
import { isUnlocked } from '@/core/progress'
import type { LevelProgress } from '@/core/types'
import { avatarSrc } from '@/data/jobs'
import { frameOf } from '@/data/cosmetics'
import { repo, type RoomBrief, type RoomMember, type RoomState } from '@/net'

/**
 * 房間：揪人一起打同一關。
 *
 * **沒有房間代碼。** 房間掛在班級上，同班的人在選關畫面就看得到現在開著哪幾場，
 * 按一下就進去。叫三十個小朋友抄一組四位數字，換來的只會是一批舉手說
 * 「我打不進去」的人。
 *
 * **老師和學生都開得了。** 上課是老師開場全班一起，下課和回家是誰想打誰開——
 * 同一套機制，老師那場排最前面並標示出來。
 *
 * 狀態靠輪詢，不用 Realtime：長連線在教室的 wifi 斷一下之後要自己處理重連，
 * 那是真的會在上課中出事的地方；每幾秒問一次則是斷了自己就會接回來。
 */

/** 幾秒問一次。太快會讓三十台平板一直打資料庫，太慢按了開始會等很久。 */
const POLL_MS = 3000

/** 班上開著哪幾場。選關畫面與「一起玩」那一頁用。 */
export function useRoomList(classCode: string | null, on: boolean): {
  rooms: RoomBrief[]; refresh: () => Promise<void>
} {
  const [rooms, setRooms] = useState<RoomBrief[]>([])

  const refresh = useCallback(async () => {
    try { setRooms(await repo.roomList(classCode ?? undefined)) }
    catch { /* 網路頓一下就留著上一次的樣子，不要把畫面清空 */ }
  }, [classCode])

  usePoll(refresh, on)
  return { rooms, refresh }
}

/**
 * 某一場的細節。等待室與老師的面板用。
 *
 * `loaded` 是「問過了」不是「有東西」。少了它，剛進等待室的那一格畫面
 * room 還是 null，會被當成「這一場被收掉了」然後彈回選關畫面——
 * 進得去卻馬上被踢出來，而且看起來像網路壞掉。
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

  usePoll(refresh, on && !!roomId)
  return { room, loaded, refresh }
}

function usePoll(refresh: () => Promise<void>, on: boolean): void {
  useEffect(() => {
    if (!on) return
    let alive = true
    const tick = () => { if (alive) void refresh() }
    tick()
    const t = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [on, refresh])
}

const levelOf = (id: string) => LEVELS.find((l) => l.id === id)
const levelName = (id: string) => {
  const l = levelOf(id)
  return l ? `第 ${l.no} 關　${l.name}` : id
}

/** 誰開的。老師那場要一眼認得出來，不然小朋友會跑去跟同學那場。 */
const hostLabel = (r: { byTeacher: boolean; hostName: string }) =>
  r.byTeacher ? '老師開的' : (r.hostName || '同學') + ' 開的'

function MemberRow({ m, playing }: { m: RoomMember; playing: boolean }) {
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
      </span>
      <span className="sc"><b>{state}</b></span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// 學生：一起玩（現在開著哪幾場、我要開一場）
// -----------------------------------------------------------------------------

export function RoomList({ rooms, progress, teacherOpen, onJoin, onOpen, onBack }: {
  rooms: RoomBrief[]
  progress: Map<string, LevelProgress>
  teacherOpen: Set<string>
  onJoin: (roomId: string) => void
  onOpen: (levelId: string) => Promise<string | null>
  onBack: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 只能揪自己解得開的關。不擋的話會有人揪第十四關，然後全部的人被打爆。
  const cleared = new Set([...progress.values()].filter((p) => p.clearedAt).map((p) => p.levelId))
  const mine = LEVELS.filter((l) => isUnlocked(l.no, LEVEL_IDS, { cleared, teacherOpen }))
  const [levelId, setLevelId] = useState(mine[0]?.id ?? '')

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">🎮 一起玩</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      {error && <p className="error">{error}</p>}

      <h2 className="sec">現在開著的<small>　按一下就進去，不用輸入代碼</small></h2>
      <div className="board">
        {rooms.length === 0 && <p className="lede">現在沒有人在揪。你可以自己開一場。</p>}
        {rooms.map((r) => (
          <div className={'rank' + (r.mine ? ' me' : '')} key={r.id}>
            <span className="rk">{r.byTeacher ? '🧑‍🏫' : '🙋'}</span>
            <span className="nm">
              {levelName(r.levelId)}
              <small>　{hostLabel(r)}　{r.here} 人{r.status === 'playing' ? '　已開打' : ''}</small>
            </span>
            <button className="btn small" onClick={() => onJoin(r.id)}>
              {r.mine ? '進去' : '加入'}
            </button>
          </div>
        ))}
      </div>

      <h2 className="sec">我要開一場<small>　開了同班的人就看得到</small></h2>
      <div className="row">
        <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
          {mine.map((l) => (
            <option key={l.id} value={l.id}>
              第 {l.no} 關　{l.name}{l.isBoss ? '（魔王）' : ''}
            </option>
          ))}
        </select>
        <button className="btn small" disabled={busy || !levelId} onClick={() => {
          setBusy(true); setError(null)
          void onOpen(levelId)
            .then((e) => setError(e))
            .finally(() => setBusy(false))
        }}>
          開一場
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
  onStart: (levelId: string) => void
  onLeave: () => void
}) {
  const level = levelOf(room.levelId)
  const me = room.members.find((m) => m.me)
  // 已經打完的人回到等待室不要又被推進去打一次——他只是回來看大家打完沒。
  const playing = room.status === 'playing' && !me?.finished
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (playing) onStart(room.levelId)
  }, [playing, room.levelId, onStart])

  return (
    // wide＝從上面開始排。等待室的人會一個一個加進來，置中的話整份名單
    // 會隨著人數上下跳，看起來像畫面在抖。
    <div className="screen wide">
      <div className="topbar">
        <span className="who">🎮 {hostLabel({
          byTeacher: room.byTeacher,
          hostName: room.members.find((m) => m.host)?.nickname ?? '',
        })}</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onLeave}>先不玩了</button>
      </div>

      <h2 className="sec">
        {levelName(room.levelId)}
        {level?.isBoss && <small>　魔王關</small>}
      </h2>
      <p className="lede">
        {me?.finished ? '你打完了，等其他人。'
          : playing ? '開始了，正在帶你進去⋯'
            : room.mine ? '人到齊就按開始，大家會一起進去。'
              : '等開始。一按大家就會一起進去，你不用做什麼。'}
      </p>

      {room.mine && room.status === 'lobby' && (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => {
            setBusy(true)
            void repo.startRoom(room.id).finally(() => setBusy(false))
          }}>▶️ 大家一起開始</button>
        </div>
      )}

      <div className="board">
        {room.members.map((m) => (
          <MemberRow key={m.studentId} m={m} playing={room.status === 'playing'} />
        ))}
        {room.members.length === 0 && <p className="lede">還沒有人進來。</p>}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// 老師：開一場
// -----------------------------------------------------------------------------

export function TeacherRoom({ classCode }: { classCode: string }) {
  const { rooms, refresh: refreshList } = useRoomList(classCode, true)
  // 老師管的是自己那場；學生自己揪的場列在下面，老師看得到但不插手。
  const teacherRoom = rooms.find((r) => r.byTeacher) ?? null
  const { room, refresh: refreshRoom } = useRoomState(teacherRoom?.id ?? null, true)
  const [levelId, setLevelId] = useState(LEVELS[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (what: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await what(); await refreshList(); await refreshRoom() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }, [refreshList, refreshRoom])

  const here = room?.members.filter((m) => m.here).length ?? 0
  const done = room?.members.filter((m) => m.finished).length ?? 0
  const kidRooms = rooms.filter((r) => !r.byTeacher)

  return (
    <>
      <div>
        <h2>一起玩</h2>
        <p className="lede left">
          開一場之後，這一班的小朋友在選關畫面就會看到，按一下就進來了，不用抄代碼。
          人到齊你再按開始。小朋友自己揪的場也會列在下面。
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      {!room && (
        <div className="row">
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                第 {l.no} 關　{l.name}{l.isBoss ? '（魔王）' : ''}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={busy || !levelId}
            onClick={() => void run(async () => { await repo.openRoom(classCode, levelId, 'solo') })}>
            開一場
          </button>
        </div>
      )}

      {room && (
        <>
          <div className="codebox">
            <span className="code">第 {levelOf(room.levelId)?.no ?? '?'} 關</span>
            <span className="lede">
              {levelOf(room.levelId)?.name}
              <br />
              {room.status === 'lobby'
                ? `${here} 個人進來了，在等你按開始`
                : `開打了，${done} / ${room.members.length} 個人打完`}
            </span>
          </div>
          <div className="row">
            {room.status === 'lobby' && (
              <button className="btn small" disabled={busy}
                onClick={() => void run(() => repo.startRoom(room.id))}>
                ▶️ 大家一起開始
              </button>
            )}
            <button className="btn ghost small" disabled={busy}
              onClick={() => void run(() => repo.closeRoom(room.id))}>
              結束這一場
            </button>
          </div>
          <div className="board">
            {room.members.map((m) => (
              <MemberRow key={m.studentId} m={m} playing={room.status === 'playing'} />
            ))}
            {room.members.length === 0 && <p className="lede">還沒有人進來。</p>}
          </div>
        </>
      )}

      {kidRooms.length > 0 && (
        <>
          <div><h2>小朋友自己揪的（{kidRooms.length}）</h2></div>
          <div className="board">
            {kidRooms.map((r) => (
              <div className="rank" key={r.id}>
                <span className="rk">🙋</span>
                <span className="nm">
                  {levelName(r.levelId)}
                  <small>　{hostLabel(r)}　{r.here} 人{r.status === 'playing' ? '　已開打' : ''}</small>
                </span>
                <button className="btn ghost small" disabled={busy}
                  onClick={() => void run(() => repo.closeRoom(r.id))}>收掉</button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
