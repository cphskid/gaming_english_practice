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

async function start() {
  clearInterval(timer)
  if (!want || document.hidden) return
  id = await repo.playStart(PARK_FACILITY, 'enter', '守護異世界')
  if (!want || id === null) return
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
