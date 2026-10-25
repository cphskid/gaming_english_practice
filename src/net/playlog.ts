import { PARK_FACILITY, repo } from '@/net'

/**
 * 樂園的遊玩紀錄：學生進到守護異世界就記一趟，玩的時候每 30 秒送一次心跳，
 * 切到別的 App、關掉分頁、登出就收尾；切回來又是新的一趟（2 分鐘內回來算同一趟）。
 * 打了哪一關、答對多少樂園自己從 answer_events 看，這裡只管「什麼時候在、待了多久」。
 */
const BEAT_MS = 30_000
let want = false
let id: number | null = null
let timer = 0
let hooked = false
let noted = false
const pending: string[] = []   // 還沒拿到這一趟的編號時先排著的事

/** 手機／平板／電腦 */
function device(): string {
  if (!matchMedia('(pointer:coarse)').matches) return 'desktop'
  return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet'
}

async function start() {
  clearInterval(timer)
  if (!want || document.hidden) return
  id = await repo.playStart(PARK_FACILITY, 'enter', '守護異世界')
  if (!want || id === null) return
  // 這一頁的第一趟記下裝置、從開網頁到能玩花多久（2026-10-25：看手機或等太久是不是比較容易走掉）
  if (!noted) { noted = true; void repo.playNote(id, { device: device(), loadMs: Math.round(performance.now()) }) }
  for (const m of pending.splice(0)) void repo.playNote(id, { mark: m })
  timer = window.setInterval(() => { if (id !== null) void repo.playBeat(id, false) }, BEAT_MS)
}

function stop() {
  clearInterval(timer)
  if (id !== null) void repo.playBeat(id, true)
  id = null
}

/** 學生在遊戲裡（true）或離開了（false，例如登出、被擋在門口） */
export function playlogActive(on: boolean) {
  if (on === want) return
  want = on
  if (!hooked) {
    hooked = true
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : void start()))
    addEventListener('pagehide', stop)
  }
  if (on) void start()
  else stop()
}

/**
 * 這一趟裡發生的事：'create'（建角色）、'battle:td-01'（開打）、'win:td-01'／'lose:td-01'。
 * 答題紀錄要一場打完才送，靠這個才分得出「沒開打就走」還是「打一半走掉」。
 */
export function playMark(mark: string) {
  if (!want) return
  if (id !== null) void repo.playNote(id, { mark })
  else pending.push(mark)
}
