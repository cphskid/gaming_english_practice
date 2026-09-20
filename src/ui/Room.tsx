import { useCallback, useEffect, useState } from 'react'
import { LEVELS } from '@/data/levels'
import { avatarSrc } from '@/data/jobs'
import { frameOf } from '@/data/cosmetics'
import { repo, type RoomMember, type RoomState } from '@/net'

/**
 * 房間：一整班同時玩同一關。
 *
 * **學生不用輸入房間代碼。** 一個班同時只有一場，所以小朋友在選關畫面
 * 直接看到「老師開了一場」，按一下就進來了。叫三十個小朋友抄一組四位數字，
 * 換來的只會是一批舉手說「我打不進去」的人。
 *
 * 狀態靠輪詢，不用 Realtime：長連線在教室的 wifi 斷一下之後要自己處理重連，
 * 那是真的會在上課中出事的地方；每幾秒問一次則是斷了自己就會接回來。
 */

/** 幾秒問一次。太快會讓三十台平板一直打資料庫，太慢按了開始會等很久。 */
const POLL_MS = 3000

function useRoom(classCode: string | null, on: boolean): {
  room: RoomState | null; error: string | null; refresh: () => Promise<void>
} {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRoom(await repo.roomState(classCode ?? undefined))
      setError(null)
    } catch (e) {
      // 網路頓一下不要把畫面清空，留著上一次的樣子就好。
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [classCode])

  useEffect(() => {
    if (!on) return
    let alive = true
    const tick = () => { if (alive) void refresh() }
    tick()
    const t = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [on, refresh])

  return { room, error, refresh }
}

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
      <span className="nm">{m.nickname}{m.me && <small>　（你）</small>}</span>
      <span className="sc"><b>{state}</b></span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// 學生：等待室
// -----------------------------------------------------------------------------

/**
 * 進來之後就待在這裡等老師按開始。老師一按，`onStart` 會被叫起來自己開打——
 * 小朋友不用再按一次「我準備好了」，因為那一定會有人沒按到，然後整班等他。
 */
export function RoomLobby({ room, onStart, onLeave }: {
  room: RoomState
  onStart: (levelId: string) => void
  onLeave: () => void
}) {
  const level = LEVELS.find((l) => l.id === room.levelId)
  const me = room.members.find((m) => m.me)
  // 已經打完的人回到等待室不要又被推進去打一次——他只是回來看大家打完沒。
  const playing = room.status === 'playing' && !me?.finished

  useEffect(() => {
    if (playing) onStart(room.levelId)
  }, [playing, room.levelId, onStart])

  return (
    // wide＝從上面開始排。等待室的人會一個一個加進來，置中的話整份名單
    // 會隨著人數上下跳，看起來像畫面在抖。
    <div className="screen wide">
      <div className="topbar">
        <span className="who">🎮 全班一起玩</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onLeave}>先不玩了</button>
      </div>

      <h2 className="sec">
        第 {level?.no ?? '?'} 關　{level?.name ?? room.levelId}
        {level?.isBoss && <small>　魔王關</small>}
      </h2>
      <p className="lede">
        {me?.finished ? '你打完了，等其他人。'
          : playing ? '開始了，正在帶你進去⋯'
            : '等老師按開始。老師一按大家就會一起進去，你不用做什麼。'}
      </p>

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
  const { room, refresh } = useRoom(classCode, true)
  const [levelId, setLevelId] = useState(LEVELS[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (what: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await what(); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }, [refresh])

  const level = room ? LEVELS.find((l) => l.id === room.levelId) : null
  const here = room?.members.filter((m) => m.here).length ?? 0
  const done = room?.members.filter((m) => m.finished).length ?? 0

  return (
    <>
      <div>
        <h2>一起玩</h2>
        <p className="lede left">
          開一場之後，這一班的小朋友在選關畫面就會看到「老師開了一場」，
          按一下就進來了，不用抄代碼。人到齊你再按開始。
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
            onClick={() => void run(() => repo.openRoom(classCode, levelId, 'solo').then(() => {}))}>
            開一場
          </button>
        </div>
      )}

      {room && (
        <>
          <div className="codebox">
            <span className="code">第 {level?.no ?? '?'} 關</span>
            <span className="lede">
              {level?.name}
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
    </>
  )
}

export { useRoom }
