/**
 * 真人即時對戰的那一條線：每 0.4 秒叫一次 live_sync，把我的新動作放上去、把對方的拿回來。
 *
 * 不用 Realtime、不用長連線，跟房間同一個理由：教室的 wifi 斷一下，
 * 長連線要自己處理重連，輪詢下一次就自己接上了。
 *
 * 兩件事一定要對：
 *   1. 「第幾格以前都送了」（mark）跟那一批動作是**同一個瞬間**拍下來的。
 *      先拍 mark、後面又多一筆同一格的動作，對方就會少算那一筆，兩支手機算歪。
 *   2. 伺服器說它只有 n 筆，就從第 n 筆重送。漏掉一筆也會算歪。
 * 對方的動作收到就照順序接在後面，一筆都不丟（看不懂的也留著，見 unpackLive）。
 */
import type { LiveLink, LiveMove, Opponent } from '@/core/types'
import { packLive, unpackLive, type PackedLive } from '@/core/opponent'
import type { LiveMatchInfo, Repository } from './repository'

const EVERY_MS = 400

export function liveLink(repo: Repository, info: LiveMatchInfo, fallback: Opponent): LiveLink {
  const mine: PackedLive[] = []
  let serverHas = 0
  let mark = -1
  const theirs: LiveMove[] = []
  let theirMark = -1
  let theirLeft = false
  let busy = false
  let closed = false
  let leaving = false

  async function sync() {
    if (busy) return
    busy = true
    // 這三個一起拍下來（見上面第 1 條）
    const base = serverHas
    const batch = mine.slice(base)
    const m = mark
    try {
      const r = await repo.liveSync(info.id, base, batch, m, theirs.length, leaving)
      serverHas = Math.min(r.mine, mine.length)
      for (const raw of r.theirs) theirs.push(unpackLive(raw))
      theirMark = Math.max(theirMark, r.theirMark)
      if (r.theirLeft) theirLeft = true
    } catch {
      // 網路斷一下沒關係，下一輪再送；真的斷太久戰場那邊會改打分身
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => { if (!closed) void sync() }, EVERY_MS)
  void sync()

  return {
    seat: info.seat,
    matchId: info.id,
    fallback,
    send(m) { mine.push(packLive(m)) },
    mark(k) { mark = Math.max(mark, k) },
    theirMoves: () => theirs,
    theirMark: () => theirMark,
    theirGone: () => theirLeft,
    close(left) {
      if (closed) return
      closed = true
      clearInterval(timer)
      // 中途離開要讓對方知道（他那邊改打分身），打完了就不用再送什麼
      if (left) {
        leaving = true
        const send = () => { if (busy) setTimeout(send, 100); else void sync() }
        send()
      }
    },
  }
}
