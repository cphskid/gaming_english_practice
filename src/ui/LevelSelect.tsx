import { LEVELS, LEVEL_IDS } from '@/data/levels'
import { THEME_NAME } from '@/data/words'
import { expIntoLevel, isUnlocked, levelFromExp } from '@/core/progress'
import type { Character, LevelData, LevelProgress, Student } from '@/core/types'
import { JOB_NAME } from '@/core/character'
import { Avatar } from './Avatar'

export function LevelSelect({
  student, character, progress, teacherOpen, onPlay, onSettings, onShop, onBoard,
}: {
  student: Student
  character: Character
  progress: Map<string, LevelProgress>
  teacherOpen: Set<string>
  onPlay: (level: LevelData) => void
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
