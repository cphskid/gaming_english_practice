import { useCallback, useEffect, useRef, useState } from 'react'
import { Quiz, type QuizOptions } from '@/core/quiz'
import { Session, type SessionResult } from '@/core/session'
import { WordStat } from '@/core/wordStat'
import { needsCreation } from '@/core/character'
import { colorOf } from '@/data/cosmetics'
import type {
  Character, GameModule, GameOutcome, LevelData, LevelProgress, Opponent, Skill, Staff, Student,
} from '@/core/types'
import { botOpponent } from '@/core/opponent'
import { LEVELS } from '@/data/levels'
import { WORDS, WORDS_BY_ID, wordsOfThemes } from '@/data/words'
import { towerDefense, tugOfWar } from '@/games'
import { loadArt } from '@/games/tower-defense/art'
import { repo } from '@/net'
import type { SavedResult } from '@/net/repository'
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
import { MyCharacter } from './MyCharacter'
import { Leaderboard } from './Leaderboard'
import { PeerProfile, Profile } from './Profile'
import { RoomList, RoomLobby, useRoomList, useRoomState } from './Room'
import { Versus } from './Versus'

type Screen =
  | 'login' | 'staff' | 'create' | 'select' | 'shop' | 'character' | 'board'
  | 'play' | 'result' | 'teacher' | 'admin' | 'settings' | 'rooms' | 'lobby' | 'versus'
  | 'profile' | 'peer'

interface Playing {
  /** 對戰沒有關卡 */
  level: LevelData | null
  game: GameModule
  session: Session
  /**
   * 每種題型一份出題器，用到才開。
   *
   * 守塔只用得到一種（認得出來），兵推三種都用——三條兵種線就是三種題型。
   * **分開存而不是共用一份**：出題器裡有「剛出過的字」與複習權重，
   * 混在一起的話，剛用認字考過的字馬上又被拿來考拼寫，複習策略就亂了。
   */
  quizzes: Map<Skill, Quiz>
  /** 開新出題器用的條件（題庫、關卡難度上限、掌握度） */
  quizOpts: Omit<QuizOptions, 'skill'>
  /** 對戰模式才有 */
  opponent: Opponent | null
}

export function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [student, setStudent] = useState<Student | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [progress, setProgress] = useState<Map<string, LevelProgress>>(new Map())
  const [teacherOpen, setTeacherOpen] = useState<Set<string>>(new Set())
  const [stat, setStat] = useState<WordStat>(() => new WordStat())
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [result, setResult] = useState<
    { r: SessionResult; coins: number; exp: number; unlocked: string[] } | null>(null)
  const [rotateOff, setRotateOff] = useState(false)
  const [staff, setStaff] = useState<Staff | null>(null)
  /** 現在在哪一場房間裡。null＝沒參加。 */
  const [roomId, setRoomId] = useState<string | null>(null)
  /** 正在看誰的徽章牆（從排行榜點進去的） */
  const [peerId, setPeerId] = useState<string | null>(null)

  /**
   * 班上開著哪幾場，以及我在的那一場。玩的時候都不問——戰場那個迴圈不該被
   * 網路請求打斷，而且那時候也沒有東西需要更新。
   */
  const { rooms, refresh: refreshRooms } = useRoomList(
    student?.classCode ?? null,
    !!student && (screen === 'select' || screen === 'rooms'),
  )
  const { room, loaded: roomLoaded } = useRoomState(roomId, screen === 'lobby')

  /**
   * 結算中。打完一關要打好幾趟後端，這段時間遊戲已經停了、畫面是定住的，
   * 以前什麼都不顯示——小朋友按掉最後一隻怪之後看到的就是一個當掉的畫面。
   * error 不是 null 就是結算失敗，讓他按得了重試而不是被困在那裡。
   */
  const [settling, setSettling] = useState<{ error: string | null } | null>(null)
  const retryRef = useRef<(() => void) | null>(null)
  const settleRef = useRef<{ session: string; events: boolean; saved: SavedResult | null } | null>(null)

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
    // 開機重算一次成就。不等它——徽章晚幾秒出現沒關係，但登入不能被它卡住。
    void repo.refreshAchievements().catch(() => {})
    // 還沒選過職業和頭像的人先去創角，不然他永遠不知道自己可以選
    setScreen(needsCreation(c) ? 'create' : 'select')
  }, [])

  /**
   * 選關畫面一出現就先去抓地圖素材。
   *
   * 以前是進關卡的那一刻才開始抓，46 張圖在手機上要好幾秒，
   * 這幾秒地圖就是一塊純綠色——Chuck 回報的就是這個。
   * 挑關卡的那段時間網路本來就是閒的，先抓完進去就直接有圖。
   */
  useEffect(() => {
    if (screen === 'select') void loadArt()
  }, [screen])

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
    setRoomId(null)
    setScreen('login')
  }, [])

  const startLevel = useCallback((level: LevelData): Session | null => {
    if (!student) return null
    audio.unlock()
    // 關卡描述地圖和怪，模式描述規則。這裡是 solo，但 Session 天生支援多人。
    const quizOpts = {
      words: wordsOfThemes(level.themes),
      maxWordLevel: level.maxWordLevel,
      stat,
    }
    const session = new Session({
      mode: 'solo',
      gameId: towerDefense.id,
      level,
      participants: [{ studentId: student.id, nickname: student.nickname }],
      wordsById: WORDS_BY_ID,
      stat,
      alreadyCleared: !!progress.get(level.id)?.clearedAt,
    })
    setPlaying({ level, game: towerDefense, session, quizzes: new Map(), quizOpts, opponent: null })
    setScreen('play')
    return session
  }, [student, stat, progress])

  /** 老師按了開始，等待室把我們推進來。回報這一場的 session，老師那邊才看得到誰在打。 */
  const startFromRoom = useCallback((levelId: string) => {
    const level = LEVELS.find((l) => l.id === levelId)
    if (!level) return
    const session = startLevel(level)
    if (session && roomId) void repo.roomPlaying(roomId, session.id).catch(() => {})
  }, [startLevel, roomId])

  /** 加入某一場。不指定就進老師那場（選關畫面那一條就是這樣用的）。 */
  const joinRoom = useCallback(async (id?: string) => {
    try {
      setRoomId(await repo.joinRoom(id))
      setScreen('lobby')
    } catch {
      // 那一場剛好被收掉了。回去看清單，下一次輪詢就會發現。
      setScreen('rooms')
    }
  }, [])

  /** 自己揪一場。成功就直接進等待室，失敗把訊息交回畫面顯示。 */
  const openRoom = useCallback(async (levelId: string): Promise<string | null> => {
    try {
      setRoomId(await repo.studentOpenRoom(levelId, 'solo'))
      setScreen('lobby')
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, [])

  /**
   * 我大概多快。拿自己答對過的字的平均反應時間回推「每分鐘答得完幾題」，
   * 電腦對手的速度就照這個調。
   *
   * **為什麼不用固定難度**：量出來的結果是，一分鐘差四題勝率就到九成
   * （tools/test/tug-balance.mjs）。固定難度等於讓快的孩子每場都輾過去、
   * 慢的孩子每場都被輾，兩邊都不會想再玩。
   */
  const myRate = useCallback((): number => {
    const seen = stat.entries().filter((e) => e.correct > 0 && e.avgMs > 0)
    if (seen.length < 5) return 14      // 還沒資料就先當中等
    const avg = seen.reduce((n, e) => n + e.avgMs, 0) / seen.length / 1000
    return Math.max(8, Math.min(30, Math.round(60 / (avg + 0.6))))
  }, [stat])

  /** 開一場對戰。v1 只打電腦，但對手是一串答題，之後換成真人這裡只改一行。 */
  const startVersus = useCallback((hardness: number, name: string) => {
    if (!student) return
    audio.unlock()
    const rate = Math.max(8, Math.min(30, Math.round(myRate() * hardness)))
    const quizOpts = { words: WORDS, stat }
    const session = new Session({
      mode: 'versus',
      gameId: tugOfWar.id,
      level: null,
      participants: [{ studentId: student.id, nickname: student.nickname }],
      wordsById: WORDS_BY_ID,
      stat,
      alreadyCleared: false,
    })
    setPlaying({
      level: null, game: tugOfWar, session, quizzes: new Map(), quizOpts,
      opponent: botOpponent({ name, rate, accuracy: 0.85, seed: Date.now() & 0xffff }),
    })
    setScreen('play')
  }, [student, stat, myRate])

  /** 這一場被收掉了（開場的人離開、老師按結束）。等待室沒東西好等，回選關畫面。 */
  useEffect(() => {
    if (screen === 'lobby' && roomId && roomLoaded && !room) {
      setRoomId(null); setScreen('select')
    }
  }, [screen, room, roomLoaded, roomId])

  const finish = useCallback(async (outcome: GameOutcome) => {
    if (!playing || !student || !character) return
    const r = playing.session.finish(outcome)
    const me = r.scores[0]
    retryRef.current = () => void finish(outcome)
    setSettling({ error: null })

    // 重試時答題事件不能再送一次——submit_answers 是照單全收的，
    // 送兩次金幣就變兩倍。所以記住送到哪一步了，重按只跑還沒成功的那幾步。
    const step = settleRef.current?.session === playing.session.id
      ? settleRef.current
      : (settleRef.current = { session: playing.session.id, events: false, saved: null })

    try {
      // 事件先寫，其他一切都是從事件算出來的
      if (!step.events) { await repo.appendEvents(r.events); step.events = true }

      // 這三趟彼此不相干，一起送。本來是一趟等一趟，手機網路差的時候
      // 小朋友要對著一個定住的畫面等上好幾秒。
      //
      // 星星、通關、首通獎金都由伺服器從這一場的答題事件算，畫面顯示的是它回的那份，
      // 不是我們自己算的。前端算出來的 r.stars 只拿來畫結算動畫。
      //
      // 對戰沒有關卡，所以沒有星星也沒有通關可存——但金幣、經驗、掌握度照算，
      // 因為那三個本來就只從答對來，跟你在玩哪個遊戲無關。
      const lv = playing.level
      const [saved, stats] = await Promise.all([
        !lv ? null : step.saved ?? repo.saveResult({
          levelId: lv.id,
          sessionId: playing.session.id,
          win: outcome.win,
          survival: outcome.survival,
        }),
        repo.loadWordStats(student.id),
        repo.saveCharacter({
          ...character,
          coins: character.coins + me.coins,
          exp: character.exp + me.exp,
        }),
      ])
      step.saved = saved
      const nextProgress = saved?.progress

      setStat(WordStat.fromEntries(stats))
      // 金幣以資料庫為準再讀一次回來。接了後端之後真正算數的是伺服器，
      // 前端那份只是為了讓數字立刻跳出來給小朋友看；兩邊算式一致（有對帳測試），
      // 萬一哪天漂移了，這一行會讓它立刻現形，而不是默默越差越多。
      setCharacter(await repo.loadCharacter(student.id))
      if (lv && nextProgress) setProgress((m) => new Map(m).set(lv.id, nextProgress))
      // 結算畫面上的星星也要是伺服器那一份，不然畫面上三顆、選關畫面上一顆，
      // 小朋友只會覺得星星會不見。
      // 兵推：把這一場的輸贏記下來。答題事件看不出「三線通吃」「逆轉勝」
      // 這些事，所以戰報要另外存一筆；同一場重送不會變成兩筆。
      if (!lv && outcome.versus && playing.opponent) {
        await repo.recordVersusMatch({
          sessionId: playing.session.id,
          // v1 只打電腦。**打電腦不算勝場**，換成真人時這裡改成 'student'。
          opponentKind: 'cpu',
          opponentName: playing.opponent.name,
          won: outcome.win,
          front: outcome.versus.front,
          lowestFront: outcome.versus.lowestFront,
          linesUsed: outcome.versus.linesUsed,
          topTier: outcome.versus.topTier,
        }).catch((e) => { console.warn('記戰績失敗', e) })
      }

      // 成就重算。放在最後而且吞掉錯誤：徽章晚一點出現沒關係，
      // 但不能因為它失敗就讓小朋友看不到結算畫面。
      const unlocked = await repo.refreshAchievements().catch(() => [] as string[])
      // 解到新徽章就把角色再讀一次——成就限定的外框是直接放進背包的
      if (unlocked.length) setCharacter(await repo.loadCharacter(student.id))

      const bonusCoins = saved?.bonusCoins ?? 0
      setResult({
        r: { ...r, stars: nextProgress?.stars ?? 0, bonusCoins },
        coins: me.coins + bonusCoins, exp: me.exp, unlocked,
      })
      setSettling(null)
      setScreen('result')
      // 在房間裡的話，跟老師說我打完了。不等它——晚一點才看到沒關係，
      // 但不能因為它慢就把結算畫面卡在後面。
      if (roomId) void repo.roomFinished(roomId).catch(() => {})
    } catch (e) {
      // 這裡以前沒有 catch：後端一失敗，畫面就永遠定在那一格，
      // 小朋友只看得到一個不會動的戰場。現在至少看得到發生什麼事、按得了重試。
      setSettling({ error: e instanceof Error ? e.message : String(e) })
    }
  }, [playing, student, character, progress, roomId])

  /**
   * 中途離開。已經答過的題目照樣寫進紀錄——學生真的答了那些題，
   * wordStat 和老師報表要看得到；金幣也照給，因為金幣本來就只從答對來。
   * 但不算通關：沒有星星、沒有首次通關獎勵。
   */
  const leave = useCallback(async () => {
    if (!playing || !student || !character) return
    const r = playing.session.finish({ win: false, survival: 0, detail: '中途離開' })
    const me = r.scores[0]

    retryRef.current = () => void leave()
    setSettling({ error: null })

    const step = settleRef.current?.session === playing.session.id
      ? settleRef.current
      : (settleRef.current = { session: playing.session.id, events: false, saved: null })

    try {
      if (!step.events) { await repo.appendEvents(r.events); step.events = true }
      const [stats] = await Promise.all([
        repo.loadWordStats(student.id),
        repo.saveCharacter({
          ...character,
          coins: character.coins + me.coins,
          exp: character.exp + me.exp,
        }),
      ])
      setStat(WordStat.fromEntries(stats))
      // 中途離開一樣重算成就：他真的答了那些題，該拿的就要拿得到
      await repo.refreshAchievements().catch(() => [])
      setCharacter(await repo.loadCharacter(student.id))
      setSettling(null)
      setPlaying(null)
      // 中途離開就是退出這一場。掛在名單上顯示「進行中」卻其實沒在打，
      // 老師會一直等他，不如直接消失，想玩再從選關畫面按一次加入。
      if (roomId) { void repo.leaveRoom(roomId).catch(() => {}); setRoomId(null) }
      setScreen('select')
    } catch (e) {
      setSettling({ error: e instanceof Error ? e.message : String(e) })
    }
  }, [playing, student, character, roomId])

  /**
   * 道具真的生效了才扣。扣的動作走 repo，跟買一樣由伺服器算數，
   * 前端只是把回來的角色狀態換上去。
   */
  const useItem = useCallback(async (itemId: string) => {
    if (!character) return
    try {
      // 帶上「用在哪一場、哪一關」：成就要分得出通關的那一場有沒有用道具
      const items = await repo.consumeItem(
        itemId, playing?.session.id, playing?.level?.id)
      setCharacter((c) => (c ? { ...c, items } : c))
    } catch (e) {
      // 道具在戰場上已經生效了，這裡只是記帳失敗。不要把遊戲打斷，
      // 下一次讀角色就會回到伺服器的版本。
      console.warn('扣道具失敗', e)
    }
  }, [character, playing])

  const nextQuestion = useCallback((skill?: Skill) => {
    if (!playing) return null
    const want = skill ?? playing.game.skill
    let quiz = playing.quizzes.get(want)
    if (!quiz) {
      quiz = new Quiz({ ...playing.quizOpts, skill: want })
      playing.quizzes.set(want, quiz)
    }
    return quiz.next()
  }, [playing])

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
          onCharacter={() => setScreen('character')}
        />
      )}

      {screen === 'character' && character && (
        <MyCharacter
          character={character}
          onChanged={setCharacter}
          onBack={() => setScreen('select')}
          onShop={() => setScreen('shop')}
        />
      )}

      {screen === 'board' && student && (
        <Leaderboard
          student={student}
          onOpen={(id) => { setPeerId(id); setScreen('peer') }}
          onBack={() => setScreen('select')}
        />
      )}

      {screen === 'profile' && student && character && (
        <Profile
          student={student} character={character}
          onCharacter={setCharacter}
          onBack={() => setScreen('select')}
        />
      )}

      {screen === 'peer' && peerId && (
        <PeerProfile studentId={peerId} onBack={() => setScreen('board')} />
      )}

      {screen === 'rooms' && student && (
        <RoomList
          rooms={rooms} progress={progress} teacherOpen={teacherOpen}
          onJoin={(id) => void joinRoom(id)}
          onOpen={openRoom}
          onBack={() => setScreen('select')}
        />
      )}

      {screen === 'lobby' && room && (
        <RoomLobby
          room={room}
          onStart={startFromRoom}
          onLeave={() => void (async () => {
            if (roomId) await repo.leaveRoom(roomId).catch(() => {})
            setRoomId(null)
            await refreshRooms()
            setScreen('select')
          })()}
        />
      )}

      {screen === 'select' && student && character && (
        <LevelSelect
          student={student} character={character} progress={progress}
          teacherOpen={teacherOpen} rooms={rooms}
          onPlay={(l) => { startLevel(l) }}
          // 那一條寫的是哪一場，按下去就進哪一場——它上面就寫著「加入」，
          // 按了卻跳到一份清單會讓人以為按錯了。要挑別場就按上面那顆「一起玩」。
          onRoom={() => {
            const top = rooms.find((r) => r.mine) ?? rooms[0]
            if (top) void joinRoom(top.id)
          }}
          onRooms={() => setScreen('rooms')}
          onVersus={() => setScreen('versus')}
          onSettings={() => setScreen('settings')}
          onShop={() => setScreen('shop')}
          onCharacter={() => setScreen('character')}
          onBoard={() => setScreen('board')}
          onProfile={() => setScreen('profile')}
        />
      )}

      {screen === 'versus' && student && (
        <Versus
          myRate={myRate()}
          onStart={startVersus}
          onBack={() => setScreen('select')}
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
          game={playing.game} level={playing.level} session={playing.session}
          studentId={student.id} job={character.job}
          color={colorOf(character.equipped).suffix} items={character.items}
          opponent={playing.opponent}
          nextQuestion={nextQuestion}
          onFinish={(o) => void finish(o)}
          onLeave={() => void leave()}
          onUseItem={(id) => void useItem(id)}
        />
      )}

      {screen === 'play' && settling && <Settling error={settling.error} onRetry={() => retryRef.current?.()} />}

      {screen === 'result' && result && (
        <Result
          result={result.r} bonus={{ coins: result.coins, exp: result.exp }}
          unlocked={result.unlocked}
          onRetry={() => {
            if (!playing) return
            if (playing.level) startLevel(playing.level)
            else setScreen('versus')
          }}
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

/**
 * 「結算中」。
 *
 * 打完一關到結算畫面出現之間要打好幾趟後端。遊戲那一刻已經停了，畫面定在
 * 最後一格——沒有這一層的話，小朋友按掉最後一隻怪看到的就是一個當掉的畫面
 * （返回鍵還能按，因為那顆在容器上，更像當掉）。
 *
 * 失敗時不自己重試：網路不好的時候自動重試只會讓他繼續盯著同一個畫面。
 * 直接告訴他發生什麼事，按鈕交給他。
 */
function Settling({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="confirm settling" role="status" aria-live="polite">
      <div className="confirm-box panel">
        {error === null ? (
          <>
            <h2>結算中…</h2>
            <p>正在算這一場的星星和金幣。</p>
            <div className="dots"><i /><i /><i /></div>
          </>
        ) : (
          <>
            <h2>結算沒成功</h2>
            <p>{error}<br />答題紀錄還在，按一下重試就好。</p>
            <div className="confirm-btns">
              <button className="btn" onClick={onRetry}>重試</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
