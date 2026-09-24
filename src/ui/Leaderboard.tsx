import { useEffect, useState } from 'react'
import { levelFromExp } from '@/core/progress'
import type { Student } from '@/core/types'
import { repo } from '@/net'
import type { LeaderRow } from '@/net/repository'
import { avatarSrc } from '@/data/jobs'
import { frameOf } from '@/data/cosmetics'
import { Icon } from './Icon'
import type { IconName } from '@/data/icons'

/**
 * 班內排行榜。
 *
 * **只比自己班**：全國排名對一個三年級的小朋友沒有意義，旁邊那個同學有沒有
 * 追上來才有意義。排名、分數都是後端算的（class_leaderboard），
 * 前端連別人的角色存檔都讀不到。
 *
 * 這裡是**收集品的展示場**：頭像外框在這一頁會被全班看到，
 * 「同學看得到」正是買外框的理由（見 src/data/cosmetics.ts）。
 */
export function Leaderboard({ student, onBack }: { student: Student; onBack: () => void }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<'exp' | 'stars' | 'coins'>('exp')

  useEffect(() => {
    let alive = true
    repo.classLeaderboard()
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  // 後端是照經驗排的，換成星星或金幣時在前端重排就好——同一份資料，不用再打一次。
  const sorted = rows ? [...rows].sort((a, b) => (
    sort === 'stars' ? b.stars - a.stars || b.exp - a.exp
      : sort === 'coins' ? b.coins - a.coins || b.exp - a.exp
        : b.exp - a.exp || b.coins - a.coins
  )) : null

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">🏆 {student.classCode || '還沒加入班級'}</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      <div className="tabs">
        <button className={sort === 'exp' ? 'on' : ''} onClick={() => setSort('exp')}>經驗</button>
        <button className={sort === 'stars' ? 'on' : ''} onClick={() => setSort('stars')}>星星</button>
        <button className={sort === 'coins' ? 'on' : ''} onClick={() => setSort('coins')}>金幣</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="lede">正在數大家的分數…</p>}
      {rows && !rows.length && (
        <p className="lede">班上還沒有人有成績。去打一關，第一名就是你的。</p>
      )}

      {sorted && sorted.length > 0 && (
        <div className="board">
          {sorted.map((r, i) => {
            const frame = frameOf(r.equipped)
            return (
              <div className={'rank' + (r.me ? ' me' : '')} key={r.nickname + i}>
                <span className="rk">
                  {i < 3 ? <Icon name={MEDAL[i]} size={24} alt={`第 ${i + 1} 名`} /> : i + 1}
                </span>
                <span className={'mugbox' + (frame ? ' ' + frame.className : '')}>
                  <img src={avatarSrc(r.avatar)} alt="" />
                  {frame?.badge && <i className="mugbadge">{frame.badge}</i>}
                </span>
                <span className="nm">{r.nickname}{r.me && <small>　（你）</small>}</span>
                <span className="sc">
                  <b>Lv.{levelFromExp(r.exp)}</b>
                  <small>⭐ {r.stars}　<Icon name="coin" size={13} /> {r.coins}</small>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 前三名給獎牌。第四名以後看數字就好，不然整頁都是圖案反而看不出順序。 */
const MEDAL: Record<number, IconName> = { 0: 'medal1', 1: 'medal2', 2: 'medal3' }
