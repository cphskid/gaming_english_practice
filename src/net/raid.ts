/**
 * 魔王團戰的那一條線：每 0.4 秒叫一次 raid_sync，把我的新動作放上去、把大家的拿回來。
 * 跟 net/live.ts 同一套做法（見那邊開頭的兩件事），差在對面不是一個人而是一排座位，
 * 還有「誰斷線了」是伺服器說了算（見 games/boss-raid/lockstep.ts）。
 */
import type { LiveMove, RaidLink, RaidSeatInfo } from '@/core/types'
import { packLive, unpackLive, type PackedLive } from '@/core/opponent'
import type { Repository } from './repository'

const EVERY_MS = 400

export interface RaidInfo {
  roomId: string
  bossId: string
  seed: number
  seat: number
  seats: RaidSeatInfo[]
  noListen: boolean
}

export function raidLink(repo: Repository, info: RaidInfo): RaidLink {
  const n = info.seats.length
  const mine: PackedLive[] = []
  let serverHas = 0
  let mark = -1
  const feeds = info.seats.map(() => ({ moves: [] as LiveMove[], mark: -1, final: null as number | null }))
  let gone = false
  let busy = false
  let closed = false
  let leaving = false

  async function sync() {
    if (busy) return
    busy = true
    // 這三個一起拍下來：mark 跟那一批動作要是同一個瞬間的
    const base = serverHas
    const batch = mine.slice(base)
    const m = mark
    try {
      const r = await repo.raidSync(info.roomId, base, batch, m, feeds.map((f) => f.moves.length), leaving)
      serverHas = Math.min(r.mine, mine.length)
      if (r.gone && !leaving) gone = true
      for (let i = 0; i < n && i < r.seats.length; i++) {
        if (i === info.seat) continue
        const f = feeds[i]
        for (const raw of r.seats[i].moves) f.moves.push(unpackLive(raw))
        f.mark = Math.max(f.mark, r.seats[i].mark)
        if (f.final === null && r.seats[i].final !== null) f.final = r.seats[i].final
      }
    } catch {
      // 網路斷一下沒關係，下一輪再送；斷太久伺服器會判我出局，電腦接手
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => { if (!closed || leaving) void sync() }, EVERY_MS)
  void sync()

  return {
    roomId: info.roomId,
    bossId: info.bossId,
    seed: info.seed,
    seat: info.seat,
    seats: info.seats,
    noListen: info.noListen,
    send(m) { mine.push(packLive(m)) },
    mark(k) { mark = Math.max(mark, k) },
    feeds: () => feeds,
    kickedOut: () => gone,
    close(left) {
      if (closed) return
      closed = true
      if (left) {
        // 中途離開：跟大家說一聲，大家那邊馬上由電腦接手，不用乾等 12 秒
        leaving = true
        const send = () => { if (busy) setTimeout(send, 100); else void sync().then(() => clearInterval(timer)) }
        send()
        return
      }
      // 打完了：最後送一次「我不會再有動作了」（DONE_MARK），
      // 不然還沒算完的隊友會等我、12 秒後把我判斷線，算出不一樣的結局
      mark = 1_000_000_000
      const flush = (tries: number) => {
        if (busy) { setTimeout(() => flush(tries), 100); return }
        void sync().then(() => {
          if (serverHas >= mine.length || tries <= 0) clearInterval(timer)
          else setTimeout(() => flush(tries - 1), 400)
        })
      }
      flush(10)
    },
  }
}
