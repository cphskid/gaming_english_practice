import { useCallback, useState } from 'react'
import { Quiz } from '@/core/quiz'
import { Session, type SessionResult } from '@/core/session'
import { WordStat } from '@/core/wordStat'
import { mergeProgress } from '@/core/progress'
import type { Character, GameOutcome, LevelData, LevelProgress, Student } from '@/core/types'
import { WORDS_BY_ID, wordsOfThemes } from '@/data/words'
import { towerDefense } from '@/games'
import { repo } from '@/net'
import { audio } from '@/audio'
import { Login } from './Login'
import { LevelSelect } from './LevelSelect'
import { GameHost } from './GameHost'
import { Result } from './Result'
import { Teacher } from './Teacher'

type Screen = 'login' | 'select' | 'play' | 'result' | 'teacher'

interface Playing {
  level: LevelData
  session: Session
  quiz: Quiz
}

export function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [student, setStudent] = useState<Student | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [progress, setProgress] = useState<Map<string, LevelProgress>>(new Map())
  const [teacherOpen, setTeacherOpen] = useState<Set<string>>(new Set())
  const [stat, setStat] = useState<WordStat>(() => new WordStat())
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [result, setResult] = useState<{ r: SessionResult; coins: number; exp: number } | null>(null)
  const [rotateOff, setRotateOff] = useState(false)

  const join = useCallback(async (classCode: string, nickname: string) => {
    audio.unlock() // iOS 的第一次播放一定要綁在使用者的某一下點擊
    const s = await repo.join(classCode, nickname)
    const [c, p, events, open] = await Promise.all([
      repo.loadCharacter(s.id),
      repo.loadProgress(s.id),
      repo.loadEvents(s.id),
      repo.loadTeacherOpen(s.classCode),
    ])
    setStudent(s)
    setCharacter(c)
    setProgress(new Map(p.map((x) => [x.levelId, x])))
    setStat(WordStat.from(events))
    setTeacherOpen(new Set(open))
    setScreen('select')
  }, [])

  const startLevel = useCallback((level: LevelData) => {
    if (!student) return
    audio.unlock()
    // 關卡描述地圖和怪，模式描述規則。這裡是 solo，但 Session 天生支援多人。
    const quiz = new Quiz({
      words: wordsOfThemes(level.themes),
      skill: towerDefense.skill,
      maxWordLevel: level.maxWordLevel,
      stat,
    })
    const session = new Session({
      mode: 'solo',
      gameId: towerDefense.id,
      level,
      participants: [{ studentId: student.id, nickname: student.nickname }],
      wordsById: WORDS_BY_ID,
      stat,
      alreadyCleared: !!progress.get(level.id)?.clearedAt,
    })
    setPlaying({ level, session, quiz })
    setScreen('play')
  }, [student, stat, progress])

  const finish = useCallback(async (outcome: GameOutcome) => {
    if (!playing || !student || !character) return
    const r = playing.session.finish(outcome)
    const me = r.scores[0]

    // 事件先寫，其他一切都是從事件算出來的
    await repo.appendEvents(r.events)
    const nextStat = WordStat.from([...(await repo.loadEvents(student.id))])

    const coins = me.coins + r.bonusCoins
    const nextChar: Character = {
      ...character,
      coins: character.coins + coins,
      exp: character.exp + me.exp,
    }
    await repo.saveCharacter(nextChar)

    const nextProgress = mergeProgress(progress.get(playing.level.id), {
      levelId: playing.level.id,
      stars: r.stars,
      bestCorrect: me.correct,
      clearedAt: outcome.win ? Date.now() : null,
    })
    await repo.saveProgress(student.id, nextProgress)

    setStat(nextStat)
    setCharacter(nextChar)
    setProgress((m) => new Map(m).set(playing.level.id, nextProgress))
    setResult({ r, coins, exp: me.exp })
    setScreen('result')
  }, [playing, student, character, progress])

  /**
   * 中途離開。已經答過的題目照樣寫進紀錄——學生真的答了那些題，
   * wordStat 和老師報表要看得到；金幣也照給，因為金幣本來就只從答對來。
   * 但不算通關：沒有星星、沒有首次通關獎勵。
   */
  const leave = useCallback(async () => {
    if (!playing || !student || !character) return
    const r = playing.session.finish({ win: false, survival: 0, detail: '中途離開' })
    const me = r.scores[0]

    await repo.appendEvents(r.events)
    const nextStat = WordStat.from(await repo.loadEvents(student.id))
    const nextChar: Character = {
      ...character,
      coins: character.coins + me.coins,
      exp: character.exp + me.exp,
    }
    await repo.saveCharacter(nextChar)

    setStat(nextStat)
    setCharacter(nextChar)
    setPlaying(null)
    setScreen('select')
  }, [playing, student, character])

  const toggleOpen = useCallback((levelId: string) => {
    if (!student) return
    setTeacherOpen((prev) => {
      const next = new Set(prev)
      if (next.has(levelId)) next.delete(levelId)
      else next.add(levelId)
      void repo.setTeacherOpen(student.classCode, [...next])
      return next
    })
  }, [student])

  const nextQuestion = useCallback(() => playing?.quiz.next() ?? null, [playing])

  return (
    <>
      <div className={'rotate' + (rotateOff ? ' off' : '')} onClick={() => setRotateOff(true)}>
        <div style={{ fontSize: 44 }}>📱↻</div>
        <div>請把裝置轉成橫的<br /><span style={{ color: '#a8b89a', fontSize: 13 }}>守塔的路是橫著走的，橫拿看得比較清楚</span></div>
        <div style={{ color: '#a8b89a', fontSize: 13 }}>（點一下這裡可以直接開始）</div>
      </div>

      {screen === 'login' && <Login onJoin={(c, n) => void join(c, n)} />}

      {screen === 'select' && student && character && (
        <LevelSelect
          student={student} character={character} progress={progress}
          teacherOpen={teacherOpen} onPlay={startLevel}
          onTeacher={() => setScreen('teacher')}
        />
      )}

      {screen === 'play' && playing && student && (
        <GameHost
          game={towerDefense} level={playing.level} session={playing.session}
          studentId={student.id} nextQuestion={nextQuestion}
          onFinish={(o) => void finish(o)}
          onLeave={() => void leave()}
        />
      )}

      {screen === 'result' && result && (
        <Result
          result={result.r} bonus={{ coins: result.coins, exp: result.exp }}
          onRetry={() => playing && startLevel(playing.level)}
          onBack={() => setScreen('select')}
        />
      )}

      {screen === 'teacher' && student && (
        <Teacher
          classCode={student.classCode} teacherOpen={teacherOpen}
          onToggleOpen={toggleOpen} onBack={() => setScreen('select')}
        />
      )}
    </>
  )
}
