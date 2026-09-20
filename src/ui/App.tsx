import { useCallback, useEffect, useState } from 'react'
import { Quiz } from '@/core/quiz'
import { Session, type SessionResult } from '@/core/session'
import { WordStat } from '@/core/wordStat'
import { needsCreation } from '@/core/character'
import { colorOf } from '@/data/cosmetics'
import type {
  Character, GameOutcome, LevelData, LevelProgress, Staff, Student,
} from '@/core/types'
import { WORDS_BY_ID, wordsOfThemes } from '@/data/words'
import { towerDefense } from '@/games'
import { repo } from '@/net'
import { audio } from '@/audio'
import { Login } from './Login'
import { StaffAuth } from './StaffAuth'
import { LevelSelect } from './LevelSelect'
import { GameHost } from './GameHost'
import { Result } from './Result'
import { Teacher } from './Teacher'
import { Admin } from './Admin'
import { Settings } from './Settings'
import { CreateCharacter } from './CreateCharacter'
import { Shop } from './Shop'
import { Leaderboard } from './Leaderboard'

type Screen =
  | 'login' | 'staff' | 'create' | 'select' | 'shop' | 'board'
  | 'play' | 'result' | 'teacher' | 'admin' | 'settings'

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
  const [staff, setStaff] = useState<Staff | null>(null)

  /** 載入一位學生的全部東西並進到選關畫面。登入、註冊、換班都走這裡。 */
  const enter = useCallback(async (s: Student) => {
    const [c, p, stats, open] = await Promise.all([
      repo.loadCharacter(s.id),
      repo.loadProgress(s.id),
      repo.loadWordStats(s.id),
      s.classCode ? repo.loadTeacherOpen(s.classCode) : Promise.resolve([]),
    ])
    setStudent(s)
    setCharacter(c)
    setProgress(new Map(p.map((x) => [x.levelId, x])))
    setStat(WordStat.fromEntries(stats))
    setTeacherOpen(new Set(open))
    // 還沒選過職業和頭像的人先去創角，不然他永遠不知道自己可以選
    setScreen(needsCreation(c) ? 'create' : 'select')
  }, [])

  /**
   * 開機時接回上次的身分。
   * 學生的 session 存在瀏覽器裡，所以小朋友不用每節課重打一次密碼。
   */
  useEffect(() => {
    void (async () => {
      const s = await repo.currentStudent()
      if (s) { await enter(s); return }
      const t = await repo.currentStaff()
      if (t) { setStaff(t); setScreen('teacher') }
    })()
  }, [enter])

  const login = useCallback(async (loginId: string, password: string) => {
    audio.unlock() // iOS 的第一次播放一定要綁在使用者的某一下點擊
    const { student: s, error } = await repo.login(loginId, password)
    if (error || !s) return error ?? '登入失敗'
    await enter(s)
    return null
  }, [enter])

  const register = useCallback(async (
    loginId: string, password: string, nickname: string, classCode: string,
  ) => {
    audio.unlock()
    try {
      await enter(await repo.register(loginId, password, nickname, classCode))
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, [enter])

  const logout = useCallback(async () => {
    await repo.logout()
    await repo.staffLogout()
    setStudent(null); setCharacter(null); setStaff(null)
    setProgress(new Map()); setTeacherOpen(new Set()); setStat(new WordStat())
    setScreen('login')
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
    const nextStat = WordStat.fromEntries(await repo.loadWordStats(student.id))

    const nextChar: Character = {
      ...character,
      coins: character.coins + me.coins,
      exp: character.exp + me.exp,
    }
    await repo.saveCharacter(nextChar)

    // 星星、通關、首通獎金都由伺服器從這一場的答題事件算，畫面顯示的是它回的那份，
    // 不是我們自己算的。前端算出來的 r.stars 只拿來畫結算動畫。
    const saved = await repo.saveResult({
      levelId: playing.level.id,
      sessionId: playing.session.id,
      win: outcome.win,
      survival: outcome.survival,
    })
    const nextProgress = saved.progress
    const coins = me.coins + saved.bonusCoins

    setStat(nextStat)
    // 金幣以資料庫為準再讀一次回來。接了後端之後真正算數的是伺服器，
    // nextChar 只是為了讓數字立刻跳出來給小朋友看；兩邊算式一致（有對帳測試），
    // 萬一哪天漂移了，這一行會讓它立刻現形，而不是默默越差越多。
    setCharacter(await repo.loadCharacter(student.id))
    setProgress((m) => new Map(m).set(playing.level.id, nextProgress))
    // 結算畫面上的星星也要是伺服器那一份，不然畫面上三顆、選關畫面上一顆，
    // 小朋友只會覺得星星會不見。
    setResult({
      r: { ...r, stars: nextProgress.stars, bonusCoins: saved.bonusCoins },
      coins, exp: me.exp,
    })
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
    const nextStat = WordStat.fromEntries(await repo.loadWordStats(student.id))
    const nextChar: Character = {
      ...character,
      coins: character.coins + me.coins,
      exp: character.exp + me.exp,
    }
    await repo.saveCharacter(nextChar)

    setStat(nextStat)
    setCharacter(await repo.loadCharacter(student.id))
    setPlaying(null)
    setScreen('select')
  }, [playing, student, character])

  /**
   * 道具真的生效了才扣。扣的動作走 repo，跟買一樣由伺服器算數，
   * 前端只是把回來的角色狀態換上去。
   */
  const useItem = useCallback(async (itemId: string) => {
    if (!character) return
    try {
      const items = await repo.consumeItem(itemId)
      setCharacter((c) => (c ? { ...c, items } : c))
    } catch (e) {
      // 道具在戰場上已經生效了，這裡只是記帳失敗。不要把遊戲打斷，
      // 下一次讀角色就會回到伺服器的版本。
      console.warn('扣道具失敗', e)
    }
  }, [character])

  const nextQuestion = useCallback(() => playing?.quiz.next() ?? null, [playing])

  return (
    <>
      {/*
        只有真的在玩的時候才勸人把手機轉橫的——守塔的路是橫著走的。
        登入、註冊、選關、老師後台這些都是直的表單和清單，直拿剛剛好。
        本來這塊蓋在每一個畫面上，手機直拿的人會看到一片黑幕蓋住登入畫面，
        以為網站壞了（第一個用的人就是這樣卡住的）。
      */}
      {screen === 'play' && (
        <div className={'rotate' + (rotateOff ? ' off' : '')} onClick={() => setRotateOff(true)}>
          <div style={{ fontSize: 44 }}>📱↻</div>
          <div>請把裝置轉成橫的<br /><span style={{ color: '#a8b89a', fontSize: 13 }}>守塔的路是橫著走的，橫拿看得比較清楚</span></div>
          <div style={{ color: '#a8b89a', fontSize: 13 }}>（點一下這裡可以直接開始）</div>
        </div>
      )}

      {screen === 'login' && (
        <Login onLogin={login} onRegister={register} onStaff={() => setScreen('staff')} />
      )}

      {screen === 'staff' && (
        <StaffAuth
          onLogin={async (em, pw) => {
            try { setStaff(await repo.staffLogin(em, pw)); setScreen('teacher'); return null }
            catch (e) { return e instanceof Error ? e.message : String(e) }
          }}
          onSignUp={async (em, pw, dn) => {
            try { setStaff(await repo.staffSignUp(em, pw, dn)); setScreen('teacher'); return null }
            catch (e) { return e instanceof Error ? e.message : String(e) }
          }}
          onClaimFirstAdmin={async () => {
            try { await repo.claimFirstAdmin(); return null }
            catch (e) { return e instanceof Error ? e.message : String(e) }
          }}
          onBack={() => setScreen('login')}
        />
      )}

      {screen === 'create' && character && (
        <CreateCharacter
          character={character}
          onDone={async (job, avatar) => {
            try {
              await repo.saveCharacter({ ...character, job })
              await repo.setAvatar(avatar)
              setCharacter({ ...character, job, avatar })
              setScreen('select')
              return null
            } catch (e) {
              return e instanceof Error ? e.message : String(e)
            }
          }}
        />
      )}

      {screen === 'shop' && character && (
        <Shop
          character={character}
          onChanged={setCharacter}
          onBack={() => setScreen('select')}
        />
      )}

      {screen === 'board' && student && (
        <Leaderboard student={student} onBack={() => setScreen('select')} />
      )}

      {screen === 'select' && student && character && (
        <LevelSelect
          student={student} character={character} progress={progress}
          teacherOpen={teacherOpen} onPlay={startLevel}
          onSettings={() => setScreen('settings')}
          onShop={() => setScreen('shop')}
          onBoard={() => setScreen('board')}
        />
      )}

      {screen === 'settings' && student && character && (
        <Settings
          student={student} character={character}
          onChanged={(s) => { setStudent(s); void enter(s) }}
          onCharacter={setCharacter}
          onBack={() => setScreen('select')}
          onLogout={() => void logout()}
        />
      )}

      {screen === 'play' && playing && student && character && (
        <GameHost
          game={towerDefense} level={playing.level} session={playing.session}
          studentId={student.id} job={character.job}
          color={colorOf(character.equipped).suffix} items={character.items}
          nextQuestion={nextQuestion}
          onFinish={(o) => void finish(o)}
          onLeave={() => void leave()}
          onUseItem={(id) => void useItem(id)}
        />
      )}

      {screen === 'result' && result && (
        <Result
          result={result.r} bonus={{ coins: result.coins, exp: result.exp }}
          onRetry={() => playing && startLevel(playing.level)}
          onBack={() => setScreen('select')}
        />
      )}

      {screen === 'teacher' && staff && (
        <Teacher
          staff={staff}
          onAdmin={() => setScreen('admin')}
          onClaimAdmin={async () => {
            await repo.claimFirstAdmin()
            // 認領完要重新讀一次自己，不然畫面上還是「不是管理員」
            setStaff(await repo.currentStaff())
          }}
          onBack={() => setScreen(student ? 'select' : 'login')}
          onLogout={() => void logout()}
        />
      )}

      {screen === 'admin' && staff?.isAdmin && (
        <Admin onBack={() => setScreen('teacher')} />
      )}
    </>
  )
}
