import { useEffect, useState } from 'react'
import { levelFromExp } from '@/core/progress'
import type { Student } from '@/core/types'
import { repo } from '@/net'
import type { BadgeCount, LeaderRow } from '@/net/repository'
import { BadgePlate, rarityText } from './Profile'
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
export function Leaderboard({ student, onOpen, onBack }: {
  student: Student
  /** 點一列就去看那位同學的徽章牆。他把檔案關起來的話就點不下去。 */
  onOpen: (studentId: string) => void
  onBack: () => void
}) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<'exp' | 'stars' | 'coins'>('exp')
  const [counts, setCounts] = useState<BadgeCount[] | null>(null)

  useEffect(() => {
    let alive = true
    repo.classLeaderboard()
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    // 主徽章旁邊的「全班幾人」。拿不到就不顯示，不擋排行榜。
    void repo.classBadgeCounts().then((c) => { if (alive) setCounts(c) }).catch(() => {})
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
              <div className={'rank' + (r.me ? ' me' : '') + (r.viewable ? ' link' : '')}
                key={r.studentId || r.nickname + i}
                role={r.viewable ? 'button' : undefined}
                tabIndex={r.viewable ? 0 : undefined}
                onClick={() => { if (r.viewable) onOpen(r.studentId) }}
                onKeyDown={(e) => {
                  if (r.viewable && (e.key === 'Enter' || e.key === ' ')) onOpen(r.studentId)
                }}>
                <span className="rk">
                  {i < 3 ? <Icon name={MEDAL[i]} size={24} alt={`第 ${i + 1} 名`} /> : i + 1}
                </span>
                <span className={'mugbox' + (frame ? ' ' + frame.className : '')}>
                  <img src={avatarSrc(r.avatar)} alt="" />
                  {frame?.badge && <i className="mugbadge">{frame.badge}</i>}
                </span>
                <span className="nm">
                  {r.nickname}{r.me && <small>　（你）</small>}
                  {r.title && <small className="badges">　{r.title}</small>}
                  {r.badges > 0 && <small className="badges">　🏅 {r.badges}</small>}
                </span>
                <span className="sc">
                  <b>Lv.{levelFromExp(r.exp)}</b>
                  <small>⭐ {r.stars}　<Icon name="coin" size={13} /> {r.coins}</small>
                </span>
                {/* 排行榜只放主徽章（Chuck 2026-09-24：比較乾淨）。另起一行排在名字底下，
                    才放得下名字和階級；三個都看得到的是個人檔案。 */}
                {r.pins.length > 0 && (
                  <span className="pinline">
                    <BadgePlate pin={r.pins[0]} main
                      note={rarityText(counts, r.pins[0].id, r.pins[0].tier)} />
                  </span>
                )}
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
