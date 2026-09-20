import { LEVELS, LEVEL_IDS } from '@/data/levels'
import { THEME_NAME } from '@/data/words'
import { expIntoLevel, isUnlocked, levelFromExp } from '@/core/progress'
import type { Character, LevelData, LevelProgress, Student } from '@/core/types'
import { JOB_NAME } from '@/core/character'
import type { RoomState } from '@/net'
import { Avatar } from './Avatar'

export function LevelSelect({
  student, character, progress, teacherOpen, room, onPlay, onRoom, onSettings, onShop, onBoard,
}: {
  student: Student
  character: Character
  progress: Map<string, LevelProgress>
  teacherOpen: Set<string>
  /** 老師現在開著的那一場。沒有就是 null。 */
  room: RoomState | null
  onPlay: (level: LevelData) => void
  onRoom: () => void
  onSettings: () => void
  onShop: () => void
  onBoard: () => void
}) {
  const cleared = new Set([...progress.values()].filter((p) => p.clearedAt).map((p) => p.levelId))
  const lv = levelFromExp(character.exp)
  const { into, need } = expIntoLevel(character.exp)

  return (
    <div className="screen">
      <div className="topbar">
        <Avatar character={character} />
        <span className="who">{student.nickname}</span>
        <span className="stat">{JOB_NAME[character.job]}　Lv.{lv}　{into}/{need} exp</span>
        <span className="spacer" />
        <span className="stat">🪙 {character.coins}</span>
        <button className="btn ghost" onClick={onBoard}>排行榜</button>
        <button className="btn ghost" onClick={onShop}>商店</button>
        <button className="btn ghost" onClick={onSettings}>設定</button>
      </div>

      {room && <RoomBanner room={room} onRoom={onRoom} />}

      <div className="levels">
        {LEVELS.map((l) => {
          const p = progress.get(l.id)
          const unlocked = isUnlocked(l.no, LEVEL_IDS, { cleared, teacherOpen })
          const stars = p?.stars ?? 0
          return (
            <button key={l.id} className={'lv' + (l.isBoss ? ' boss' : '')}
              disabled={!unlocked} onClick={() => onPlay(l)}>
              {!unlocked && <span className="lock">🔒</span>}
              <div className="no">第 {l.no} 關{l.isBoss ? '・魔王' : ''}</div>
              <div className="nm">{l.name}</div>
              <div className="th">
                {l.themes.length ? l.themes.map((t) => THEME_NAME[t] ?? t).join('、') : '全部主題'}
              </div>
              <div className="st">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 「老師開了一場」。
 *
 * 這一條就是整個房間的入口——沒有代碼要抄、沒有東西要記，小朋友只要看到
 * 這一條、按一下，就跟全班在同一場裡了。所以它放在選關畫面最上面、最顯眼的地方。
 */
function RoomBanner({ room, onRoom }: { room: RoomState; onRoom: () => void }) {
  const level = LEVELS.find((l) => l.id === room.levelId)
  const me = room.members.find((m) => m.me)
  const what = !me ? '老師開了一場，一起玩'
    : me.finished ? '你打完了，看看大家打完沒'
      : room.status === 'playing' ? '這一場開打了，回去繼續'
        : '你已經在這一場裡了'
  return (
    <button className="roomcall" onClick={onRoom}>
      <span className="ico">🎮</span>
      <span className="txt">
        <b>{what}</b>
        <small>第 {level?.no ?? '?'} 關　{level?.name ?? ''}　{room.members.length} 人</small>
      </span>
      <span className="go">{me ? '進去' : '加入'}</span>
    </button>
  )
}
