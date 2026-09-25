import { LEVELS, LEVEL_IDS } from '@/data/levels'
import { THEME_NAME } from '@/data/words'
import { expIntoLevel, isUnlocked, levelFromExp } from '@/core/progress'
import type { Character, LevelData, LevelProgress, Student } from '@/core/types'
import { JOB_NAME } from '@/core/character'
import type { RoomBrief } from '@/net'
import { BOSS_BY_ID } from '@/data/bosses'
import { BossFace } from './Room'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

export function LevelSelect({
  student, character, progress, teacherOpen, rooms,
  onPlay, onRoom, onRooms, onVersus, onSettings, onShop, onCharacter, onBoard, onProfile,
}: {
  student: Student
  character: Character
  progress: Map<string, LevelProgress>
  teacherOpen: Set<string>
  /** 班上現在開著的場次。老師開的排在最前面。 */
  rooms: RoomBrief[]
  onPlay: (level: LevelData) => void
  /** 按選關畫面那一條：直接進去，或是去「一起玩」那一頁挑 */
  onRoom: () => void
  /** 上面那排的「一起玩」：現在開著哪幾場、我要開一場 */
  onRooms: () => void
  onSettings: () => void
  onShop: () => void
  onCharacter: () => void
  onBoard: () => void
  onVersus: () => void
  /** 我的徽章牆 */
  onProfile: () => void
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
        <span className="stat"><Icon name="coin" size={15} /> {character.coins}</span>
        <button className="btn ghost" onClick={onVersus}>對戰</button>
        <button className="btn ghost" onClick={onRooms}>魔王團戰</button>
        <button className="btn ghost" onClick={onBoard}>排行榜</button>
        <button className="btn ghost" onClick={onProfile}>徽章</button>
        <button className="btn ghost" onClick={onCharacter}>我的角色</button>
        <button className="btn ghost" onClick={onShop}>商店</button>
        <button className="btn ghost" onClick={onSettings}>設定</button>
      </div>

      {rooms.length > 0 && <RoomBanner rooms={rooms} onRoom={onRoom} />}

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
 * 「有人開了一場魔王團戰」。
 *
 * 這一條就是整個房間的入口——沒有代碼要抄、沒有東西要記，小朋友只要看到
 * 這一條、按一下就進去了。所以它放在選關畫面最上面、最顯眼的地方。
 *
 * 有好幾場時只寫最前面那一場（老師的優先），其餘用「還有 N 場」帶過——
 * 選關畫面不該被一串房間淹掉，要挑就進「魔王團戰」那一頁挑。
 * 私人房（🔒）按下去是帶到那一頁打密碼。
 */
function RoomBanner({ rooms, onRoom }: { rooms: RoomBrief[]; onRoom: () => void }) {
  const top = rooms.find((r) => r.mine) ?? rooms[0]
  const boss = BOSS_BY_ID.get(top.bossId)
  const who = top.byTeacher ? '老師' : (top.hostName || '同學')
  const what = top.mine
    ? (top.status === 'playing' ? '這一場開打了' : '你已經在這一場裡了')
    : `${who}開了魔王團戰，一起打！`
  const more = rooms.length - 1
  return (
    <button className="roomcall" onClick={onRoom}>
      <span className="ico">{boss ? <BossFace b={boss} size={38} /> : '👹'}</span>
      <span className="txt">
        <b>{what}</b>
        <small>
          {top.locked && '🔒 '}{boss?.name ?? ''}　{top.members} 人
          {more > 0 && `　・還有 ${more} 場`}
        </small>
      </span>
      <span className="go">{top.mine ? '進去' : '加入'}</span>
    </button>
  )
}
