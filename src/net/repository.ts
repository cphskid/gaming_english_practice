import type {
  AdminClassRow, AnswerEvent, Character, ClassRoom, LevelProgress, Mode, Move, Staff, Student,
  TeacherRow, WordStatEntry,
} from '@/core/types'

/**
 * 唯一知道資料存在哪裡的介面。core 只認這份契約，不知道 Supabase 存在。
 * 換資料庫＝換一個實作，不動其他任何地方。
 */
export interface Repository {
  // -------------------------------------------------------------- 學生帳號
  /**
   * 註冊。班級代碼同時是邀請碼：沒有一組有效而且開放加入的代碼就註冊不了。
   *
   * 學生刻意不走 email 註冊。Supabase 的帳號一定綁 email，每註冊一個就寄一封
   * 確認信，而內建寄信額度小到一整班同時註冊就會被擋（實測連五個就 429）。
   */
  register(loginId: string, password: string, nickname: string, classCode: string): Promise<Student>

  /**
   * 登入。**失敗不丟例外，回 error 字串**——後端要在密碼打錯時記下次數，
   * 而在 Postgres 裡丟例外會把同一筆交易的 update 一起回滾，鎖定就永遠不會生效。
   */
  login(loginId: string, password: string): Promise<{ student: Student | null; error: string | null }>

  /** 這台裝置上次是誰。沒有就回 null（要去登入）。 */
  currentStudent(): Promise<Student | null>
  logout(): Promise<void>

  setPassword(oldPassword: string, newPassword: string): Promise<void>
  /** 回傳實際存下來的暱稱 */
  setNickname(nickname: string): Promise<string>
  /** 換班或第一次加入班級。角色與進度完全不動。 */
  joinClass(classCode: string): Promise<string>

  // -------------------------------------------------------------- 角色與進度
  loadCharacter(studentId: string): Promise<Character>
  saveCharacter(c: Character): Promise<void>

  /** 創角：選頭像。職業走 saveCharacter。 */
  setAvatar(avatar: string): Promise<void>

  /**
   * 買東西。**只送品項 id**——價格、等級門檻、餘額全部由後端查。
   * 前端說「這個賣一塊」是不算數的。回傳買完之後的角色，畫面直接用。
   */
  buyItem(itemId: string): Promise<{ coins: number; items: Record<string, number> }>

  /** 穿脫裝飾品。回傳穿好之後的清單。 */
  equipItem(itemId: string, on: boolean): Promise<string[]>

  /**
   * 用掉一個消耗品。回傳用完之後的背包。
   *
   * 多帶「用在哪一場、哪一關」是給成就用的：背包只存剩幾個，用完歸零，
   * 事後完全看不出來他用過什麼（「空手過關」「道具三味」就是靠這個）。
   */
  consumeItem(itemId: string, sessionId?: string, levelId?: string): Promise<Record<string, number>>

  /**
   * 班內排行榜。**排名由後端算**，而且只回暱稱、分數和外觀——
   * 角色存檔本身別人是讀不到的（RLS 擋住），要比分數就得走這支。
   * 老師傳班級代碼可以看任何一班，學生不用傳，看的就是自己那一班。
   */
  classLeaderboard(classCode?: string): Promise<LeaderRow[]>

  loadProgress(studentId: string): Promise<LevelProgress[]>

  /**
   * 打完一關。
   *
   * **星星與答對數由伺服器算，這裡只送「哪一關、哪一場、守住了沒、城堡剩幾成」。**
   * 星星會上排行榜，排行榜一出現就值得作弊了，所以不能讓前端說「我三顆星」。
   * 伺服器自己去數那一場的答題事件，回傳算出來的結果——畫面顯示的是它回的那份。
   */
  saveResult(r: LevelResult): Promise<SavedResult>

  /**
   * 寫入答題事件。整個系統的地基：金幣、經驗、星星、排行榜、老師報表
   * 全都是從這裡算出來的。
   *
   * 接了 Supabase 之後這是一支 RPC，由資料庫從事件算出金幣與經驗，
   * **客戶端不能直接寫 coins 欄位**——小朋友真的會找漏洞。
   */
  appendEvents(events: AnswerEvent[]): Promise<void>
  loadEvents(studentId: string): Promise<AnswerEvent[]>

  /**
   * 掌握度。本地版是把事件跑一遍算出來的；接了後端之後改成直接讀資料庫算好的
   * 那張表，不然一個學生一年好幾萬列，每次登入都撈回來跑一遍，學校的平板會卡住。
   */
  loadWordStats(studentId: string): Promise<WordStatEntry[]>

  // -------------------------------------------------------------- 老師
  /** 老師與管理員用真的 email 登入，跟學生走不同的路。 */
  staffSignUp(email: string, password: string, displayName: string): Promise<Staff>
  staffLogin(email: string, password: string): Promise<Staff>
  currentStaff(): Promise<Staff | null>
  staffLogout(): Promise<void>

  listClasses(): Promise<ClassRoom[]>
  createClass(code: string, name: string): Promise<ClassRoom>
  /** 開關「可不可以加入」。班級代碼就是邀請碼，上課時開、註冊完關。 */
  setClassOpen(code: string, open: boolean): Promise<boolean>
  /** 代碼流出去了就換一組。班上的人會跟著走，不會被踢掉。 */
  regenerateClassCode(code: string): Promise<string>

  /** 老師報表用：整個班的事件 */
  loadClassEvents(classCode: string): Promise<AnswerEvent[]>
  /** 班上每個人的概況 */
  loadClassRoster(classCode: string): Promise<ClassRosterRow[]>
  addStudent(classCode: string, loginId: string, password: string, nickname: string): Promise<void>
  removeStudent(studentId: string): Promise<void>
  /** 忘記密碼。順便解鎖，因為忘記的人通常已經試到被鎖住了。 */
  resetStudentPassword(studentId: string, password: string): Promise<void>

  /** 老師額外開放的關卡 */
  loadTeacherOpen(classCode: string): Promise<string[]>
  setTeacherOpen(classCode: string, levelIds: string[]): Promise<void>

  // -------------------------------------------------------------- 房間
  /**
   * 老師開一場：全班同一關、同時開始。
   *
   * **沒有房間代碼。** 房間掛在班級上，同班的人在選關畫面就看得到現在開著哪幾場，
   * 按一下就進去——叫三十個小朋友抄一組四位數字，得到的只會是一批
   * 「我打不進去」的手。老師再開一場就是換一關重開，老師自己的舊場自動收掉。
   */
  openRoom(classCode: string, levelId: string, mode: Mode): Promise<string>
  /**
   * 學生自己揪一場。上課是老師開場，下課和回家是誰想打誰開，同一套機制。
   * 開完就算他已經進來了，而且一個人同時只能開一場。
   */
  studentOpenRoom(levelId: string, mode: Mode): Promise<string>
  /** 人到齊了，大家一起開始。老師或開這一場的學生才按得動。 */
  startRoom(roomId: string): Promise<void>
  /** 收掉這一場。收掉之後就從班上的清單消失了。 */
  closeRoom(roomId: string): Promise<void>

  /**
   * 加入班上的某一場，回傳房間 id。已經開始的也進得去（遲到的人照樣要能玩）。
   * 不指定就進老師那場，沒有老師的場就進最新的一場。
   */
  joinRoom(roomId?: string): Promise<string>
  /** 離開。開這一場的人離開就等於收掉，不然會留下一個沒人按得了開始的房間。 */
  leaveRoom(roomId: string): Promise<void>
  /** 班上現在開著哪幾場。老師開的排最前面。老師要傳班級代碼，學生不用。 */
  roomList(classCode?: string): Promise<RoomBrief[]>
  /**
   * 某一場現在長什麼樣。等待室與老師的面板都是問這一支，每幾秒一次。
   * 順便當心跳：關掉分頁的人 here 會變成 false。已經收掉的場回 null。
   */
  roomState(roomId: string): Promise<RoomState | null>
  /** 我開打了，這是我這一場的 Session.id。分數之後從答題事件算，靠它對起來。 */
  roomPlaying(roomId: string, sessionId: string): Promise<void>
  roomFinished(roomId: string): Promise<void>

  // -------------------------------------------------------------- 管理員
  /** 還沒有任何管理員的時候，第一個呼叫的人就是管理員。之後永遠拒絕。 */
  claimFirstAdmin(): Promise<void>
  /**
   * 直接幫老師開好帳號。**不寄確認信**——Supabase 的寄信額度是一小時兩封，
   * 幾位老師同一個下午一起註冊就會有人卡在收不到信，而且不知道自己在等什麼。
   *
   * 已經自己註冊過、卻因為不在名單上而進不去的人很常見，那種情況不會再開一個
   * 帳號，直接把他設成老師，密碼還是他自己那組（`created` 會是 false）。
   */
  createTeacher(email: string, password: string, displayName: string): Promise<AddedTeacher>

  /** 指定某個 email 可以成為老師。對方自己註冊、自己設密碼（會收到確認信）。 */
  inviteTeacher(email: string): Promise<string>
  /** 整間學校的班級，含各班是誰在帶。老師只看得到自己的班，管理員看得到全部。 */
  listAllClasses(): Promise<AdminClassRow[]>
  /**
   * 把一個班交給另一位老師。班級代碼、學生、進度都不動——
   * 學生是掛在班級代碼上的，不是掛在老師身上。
   */
  setClassOwner(code: string, userId: string): Promise<void>
  /** 這套系統有沒有管理員。沒有的話老師後台要讓人認領，不然誰都進不去。 */
  hasAdmin(): Promise<boolean>

  // -------------------------------------------------------------- 成就
  /**
   * 我的徽章牆。**沒拿到的也會回**，畫面要畫得出灰色剪影和「還差多少」。
   * 誰拿到什麼是伺服器說了算，前端只負責畫。
   */
  loadAchievements(): Promise<AchievementRow[]>

  /**
   * 重算一次成就，回傳「這一次新解開或升階的」：一次性徽章是 'id'，
   * 分階徽章是 'id:階'（'hundred:3'＝萬題升到金）。用 parseUnlock() 拆。
   *
   * 打完一場、開個人檔案、開機各叫一次。**重算而不是答對時加一**：
   * 規則改了、資料補了，下一次重算就自己對了；少算一次也不會永久漏掉。
   */
  refreshAchievements(): Promise<string[]>

  /**
   * 全班每一格、每一階有幾個人拿到。不傳就是自己班；老師傳班級代碼。
   * 只有人數，沒有名字。
   */
  classBadgeCounts(classCode?: string): Promise<BadgeCount[]>

  /** 別在名字旁邊的徽章，最多三個。只能別自己拿到的。 */
  setPinned(ids: string[]): Promise<string[]>
  /** 選稱號。傳空字串＝不掛。回傳實際掛上的稱號文字。 */
  setTitle(achievementId: string): Promise<string>
  /** 檔案給不給同學看 */
  setPublicProfile(open: boolean): Promise<boolean>

  /**
   * 看同學的檔案。**一定要走這支**：別人的角色存檔讀不到（RLS 擋著），
   * 而且對方可以把檔案關起來。
   */
  publicProfile(studentId: string): Promise<PublicProfile>

  /**
   * 記一場兵推。打電腦也記（有些成就要算），但勝場只認同學。
   * 同一場重送不會變成兩筆。
   */
  recordVersusMatch(m: VersusMatchInput): Promise<void>

  /**
   * 同班可以挑戰的分身：每個同學最近一場有錄下來的兵推。不含自己。
   * 只有摘要，答題串要挑了才用 loadGhost 抓。
   */
  listGhosts(): Promise<GhostRow[]>
  /** 某個同學最近一場的答題串。不同班、或是還沒打過，回 null。 */
  loadGhost(studentId: string): Promise<Ghost | null>

  listTeachers(): Promise<TeacherRow[]>
  listInvites(): Promise<{ email: string; used: boolean }[]>
  setTeacherActive(userId: string, active: boolean): Promise<void>
}

export interface ClassRosterRow {
  studentId: string
  nickname: string
  coins: number
  exp: number
  stars: number
  answers: number
}

export interface LeaderRow {
  /** 點進去看他的徽章牆要用 */
  studentId: string
  nickname: string
  coins: number
  exp: number
  stars: number
  avatar: string
  /** 身上的裝飾品，畫頭像外框用 */
  equipped: string[]
  /** 這一列是不是自己。把自己那一行標出來，找起來才快 */
  me: boolean
  /** 稱號，解成就拿到的 */
  title: string
  /** 拿到幾個徽章 */
  badges: number
  /** 別在名字旁邊的，連同階級 */
  pins: Pin[]
  /** 他的檔案讓不讓我點進去看 */
  viewable: boolean
}

/** 班上開著的一場，清單上那一列。 */
export interface RoomBrief {
  id: string
  levelId: string
  mode: Mode
  status: 'lobby' | 'playing'
  /** 開這一場的人。老師開的是空字串。 */
  hostName: string
  /** 老師開的那場要一眼認得出來，不然小朋友會跑去跟同學那場。 */
  byTeacher: boolean
  /** 我已經在這一場裡了 */
  mine: boolean
  /** 現在有幾個人在線上 */
  here: number
}

/** 現在這一場。房間只管「誰在、什麼時候一起開始」，分數不存在這裡。 */
export interface RoomState {
  id: string
  classCode: string
  levelId: string
  mode: Mode
  /** lobby＝在等人，playing＝開打了。收掉的場讀不到，所以不會有 done。 */
  status: 'lobby' | 'playing' | 'done'
  startedAt: number | null
  byTeacher: boolean
  /** 這一場是我作主的：老師看自己班的每一場，學生看自己開的那場。 */
  mine: boolean
  members: RoomMember[]
}

export interface RoomMember {
  studentId: string
  nickname: string
  /** 開這一場的人 */
  host: boolean
  /** 團隊模式才有 */
  team: string | null
  avatar: string
  equipped: string[]
  finished: boolean
  /** 最近還有在回報。關掉分頁的人會變成 false，老師才看得出誰不在了。 */
  here: boolean
  me: boolean
}

export interface AddedTeacher {
  email: string
  /** true 代表帳號是這次開的；false 代表本來就有，只是設成老師 */
  created: boolean
}

export interface LevelResult {
  levelId: string
  /** 這一場的 id（Session.id），伺服器靠它數這一場答對幾題 */
  sessionId: string
  /** 守住了嗎。城堡有沒有破不重跑一場算不出來，所以這件事還是信前端，
   *  但答對的題數不到這一關的下限就不算數（見 schema.sql 的 save_progress）。 */
  win: boolean
  /** 城堡剩幾成血，0~1。只影響第三顆星。 */
  survival: number
}

export interface SavedResult {
  progress: LevelProgress
  /** 首次通關獎金。也是伺服器發的，畫面上的數字要跟著它，不要自己算一份。 */
  bonusCoins: number
}

/** 徽章牆上的一格。unlockedAt 是 null 就是還沒拿到。 */
export interface AchievementRow {
  id: string
  category: string
  /** epoch 毫秒 */
  unlockedAt: number | null
  /** 第幾階（1＝銅 … 5＝鑽石）。一次性徽章拿到是 1，沒拿到是 0。 */
  tier: number
  /** 升到現在這一階的時間，epoch 毫秒 */
  tierAt: number | null
  /** 分階徽章現在的數字，「還差多少」用 */
  value: number
  /** 「全部」那一階現在是多少（題庫幾個字、幾關） */
  goalAll: number
}

/** 別在名字旁邊的一個。第一個是主徽章。 */
export interface Pin { id: string; tier: number }

/** 全班有幾個人拿到某一格的某一階 */
export interface BadgeCount { id: string; tier: number; holders: number; classSize: number }

/** 同學的個人檔案。只有看得到的東西，沒有登入帳號也沒有答題明細。 */
export interface PublicProfile {
  nickname: string
  avatar: string
  equipped: string[]
  title: string
  /** 別在名字旁邊的三個 */
  pinned: string[]
  /** 拿到的徽章 id，照拿到的先後 */
  badges: string[]
  /** 每一格到第幾階 */
  tiers: Record<string, number>
  stars: number
  level: number
}

/** 一場兵推的結果。欄位跟資料庫的 versus_matches 一樣。 */
export interface VersusMatchInput {
  sessionId: string
  /**
   * 打電腦是 'cpu'、打同學的分身是 'ghost'。**勝場只認 'student'**（真人即時對戰），
   * 不然贏電腦就能刷戰績；分身也先不算，免得一直挑同一個弱的同學刷。
   */
  opponentKind: 'cpu' | 'ghost' | 'student'
  opponentName: string
  /** 打分身時，分身是誰 */
  opponentStudent?: string
  /** 這一場自己做過的事。存起來就是別人挑戰你時的分身。 */
  moves: Move[]
  won: boolean
  /** 前線最後推到哪，0＝自己城牆、1＝對方城牆 */
  front: number
  /** 整場最落後的時候。逆轉勝要用。 */
  lowestFront: number
  /** 用過哪幾條兵種線 */
  linesUsed: string[]
  /** 這一場推出過的最高兵階 */
  topTier: number
}

/** 選對手那一頁的一列：一個可以挑戰的同學分身。 */
export interface GhostRow {
  studentId: string
  nickname: string
  avatar: string
  /** 那一場穿的軍團（品項 id，王國軍是空字串） */
  legion: string
  /** 那一場打完的時間，epoch 毫秒 */
  endedAt: number
  /** 那一場答對幾題。讓挑戰的人大概知道對方多快 */
  correct: number
}

/** 挑下去之後抓回來的那一整場 */
export interface Ghost {
  studentId: string
  nickname: string
  legion: string
  moves: Move[]
}
