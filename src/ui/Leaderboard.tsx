import { useEffect, useState } from 'react'
import { levelFromExp } from '@/core/progress'
import type { Student } from '@/core/types'
import { repo } from '@/net'
import type { BadgeCount, LeaderRow, WeeklySlot, WeeklyStar } from '@/net/repository'
import { Badge, BadgePlate, hueOf, rarityText } from './Profile'
import { ACH_BY_ID, badgeLabel } from '@/data/achievements'
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
  // 金幣分頁 2026-09-26 拿掉：顯示的是餘額，一買東西名次就掉，等於叫小朋友別花錢
  const [sort, setSort] = useState<'exp' | 'stars'>('exp')
  const [counts, setCounts] = useState<BadgeCount[] | null>(null)
  const [stars, setStars] = useState<WeeklyStar[] | null>(null)

  useEffect(() => {
    let alive = true
    repo.classLeaderboard()
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    // 主徽章旁邊的「全班幾人」。拿不到就不顯示，不擋排行榜。
    void repo.classBadgeCounts().then((c) => { if (alive) setCounts(c) }).catch(() => {})
    // 本週之星拿不到就整排不顯示，一樣不擋排行榜
    void repo.classWeeklyStars().then((s) => { if (alive) setStars(s) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // 後端是照經驗排的，換成星星時在前端重排就好——同一份資料，不用再打一次。
  const sorted = rows ? [...rows].sort((a, b) => (
    sort === 'stars' ? b.stars - a.stars || b.exp - a.exp : b.exp - a.exp || b.coins - a.coins
  )) : null

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">🏆 {student.classCode || '還沒加入班級'}</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      {stars && <WeeklyStars stars={stars} onOpen={onOpen} />}

      <div className="tabs">
        <button className={sort === 'exp' ? 'on' : ''} onClick={() => setSort('exp')}>經驗</button>
        <button className={sort === 'stars' ? 'on' : ''} onClick={() => setSort('stars')}>星星</button>
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
                  <small>⭐ {r.stars}</small>
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

/**
 * 本週之星：一排五格，每格比不一樣的東西，每週一歸零，一個人最多上一格（後端挑）。
 * 長期榜玩最多的人永遠第一，這一排讓每週都有不同的人被看見。
 * 沒人的格子也畫出來寫「等你來拿」——知道有這一格，才會想去拿。
 */
const SLOTS: { slot: WeeklySlot; icon: string; name: string }[] = [
  { slot: 'most', icon: '🎯', name: '答對最多' },
  { slot: 'improve', icon: '📈', name: '進步最多' },
  { slot: 'rare', icon: '💎', name: '稀有徽章' },
  { slot: 'raid', icon: '🐉', name: '魔王 MVP' },
  { slot: 'mystery', icon: '❓', name: '神祕格' },
]
const MYSTERY: Record<string, string> = { spell: '拼字最多', listen: '聽音最多', days: '天天來' }

function WeeklyStars({ stars, onOpen }: { stars: WeeklyStar[]; onOpen: (id: string) => void }) {
  return (
    <div className="wk">
      <div className="wk-head">⭐ 本週之星<small>每週一重新開始</small></div>
      <div className="wk-strip">
        {SLOTS.map(({ slot, icon, name }) => {
          const s = stars.find((x) => x.slot === slot)
          const title = slot === 'mystery' && s ? MYSTERY[s.extra] ?? name : name
          if (!s) {
            return (
              <div className="wk-card empty" key={slot}>
                <span className="wk-name">{icon} {name}</span>
                <span className="wk-who">等你來拿</span>
              </div>
            )
          }
          const frame = frameOf(s.equipped)
          return (
            <div className={'wk-card' + (s.me ? ' me' : '') + (s.viewable ? ' link' : '')} key={slot}
              role={s.viewable ? 'button' : undefined} tabIndex={s.viewable ? 0 : undefined}
              onClick={() => { if (s.viewable) onOpen(s.studentId) }}
              onKeyDown={(e) => {
                if (s.viewable && (e.key === 'Enter' || e.key === ' ')) onOpen(s.studentId)
              }}>
              <span className="wk-name">{icon} {title}</span>
              <span className={'mugbox' + (frame ? ' ' + frame.className : '')}>
                <img src={avatarSrc(s.avatar)} alt="" />
                {frame?.badge && <i className="mugbadge">{frame.badge}</i>}
              </span>
              <span className="wk-who">{s.nickname}{s.me && <small>（你）</small>}</span>
              <span className="wk-val">{starText(s)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function starText(s: WeeklyStar) {
  switch (s.slot) {
    case 'most': return `${s.value} 題`
    case 'improve': return `比上週多 ${s.value} 題`
    case 'raid': return `${s.value} 傷害・贏 ${s.extra} 場`
    case 'mystery': return s.extra === 'days' ? `來了 ${s.value} 天` : `${s.value} 題`
    case 'rare': {
      const [id, t] = s.extra.split(':')
      const def = ACH_BY_ID.get(id)
      if (!def) return ''
      const tier = def.tiers ? Number(t) : 0
      return (
        <>
          <Badge def={def} got tier={Number(t)} size={18} hue={hueOf(def)} />
          {' '}{badgeLabel(def, tier)}
          <small>{s.value <= 1 ? '全班只有 1 人' : `全班 ${s.value} 人`}</small>
        </>
      )
    }
  }
}

/** 前三名給獎牌。第四名以後看數字就好，不然整頁都是圖案反而看不出順序。 */
const MEDAL: Record<number, IconName> = { 0: 'medal1', 1: 'medal2', 2: 'medal3' }
