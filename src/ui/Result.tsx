import type { SessionResult } from '@/core/session'
import type { RaidResult } from '@/net/repository'
import { BOSS_BY_ID } from '@/data/bosses'
import { BossFace } from './Room'
import { useState } from 'react'
import { ACH_BY_ID, CATEGORIES, TIER_NAMES, badgeLabel, parseUnlock } from '@/data/achievements'
import { Badge } from './Profile'
import { Icon } from './Icon'

export function Result({
  result, bonus, unlocked = [], raid, onRetry, onBack,
}: {
  result: SessionResult
  /** 魔王團戰：伺服器認了沒、打倒幾次、是不是第一次（外框就是這一場拿到的） */
  raid?: RaidResult & { bossId: string }
  bonus: { coins: number; exp: number }
  /** 這一場解開的徽章。整個成就系統唯一會主動找上門的時刻，所以放在最顯眼的地方。 */
  unlocked?: string[]
  onRetry: () => void
  onBack: () => void
}) {
  const me = result.scores[0]
  const acc = me && me.asked ? Math.round((me.correct / me.asked) * 100) : 0
  // 對戰沒有關卡，所以沒有星星。照樣畫三顆空星會讓人以為自己打得很爛。
  const versus = result.levelId === null

  return (
    <div className="screen">
      <div className="result panel">
        <h1>
          {versus
            ? (result.outcome.win ? '贏了！' : '這場輸了')
            : (result.outcome.win ? '守住了！' : '城堡被攻破了')}
        </h1>
        {versus
          ? <div className="stars">{result.outcome.win ? '🏆' : '⚔️'}</div>
          : <div className="stars">{'★'.repeat(result.stars)}{'☆'.repeat(3 - result.stars)}</div>}
        <p className="lede">{result.outcome.detail}</p>
        <div className="rows">
          <div className="row"><span>答對</span><b>{me?.correct ?? 0} / {me?.asked ?? 0} 題（{acc}%）</b></div>
          <div className="row"><span>最長連擊</span><b>{me?.bestCombo ?? 0}</b></div>
          <div className="row"><span>獲得銅幣</span><b><Icon name="coin" size={15} /> {bonus.coins}</b></div>
          <div className="row"><span>獲得經驗</span><b>{bonus.exp} exp</b></div>
          {result.bonusCoins > 0 && (
            <div className="row"><span>首次通關獎勵</span><b><Icon name="coin" size={15} /> {result.bonusCoins}</b></div>
          )}
        </div>
        {raid && raid.confirmed && <RaidWin raid={raid} />}
        {unlocked.length > 0 && <Unlocked ids={unlocked} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={onBack}>回選關</button>
          <button className="btn" onClick={onRetry}>{raid ? '再揪一團' : versus ? '再來一場' : '再玩一次'}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * 這一場解開或升階的徽章。名字一定要寫出來——不然小朋友不知道自己做對了什麼。
 *
 * 第一次進結算畫面先蓋一個大章（最高的那一個），點一下收起來，下面那一排留著。
 * 升到鑽石跟第一次拿到一樣值得大張旗鼓，所以升階也蓋。
 */
function Unlocked({ ids }: { ids: string[] }) {
  const list = ids.map(parseUnlock)
    .map((u) => ({ ...u, def: ACH_BY_ID.get(u.id) }))
    .filter((u) => !!u.def)
  /**
   * 大章一次蓋一個，點一下換下一個，最後一個點掉才收起來。
   * 以前寫「還有 6 個，點一下看」卻是點一下就整個收掉，下面那排又在畫面外，
   * 小朋友以為按了沒反應（2026-09-26 🌙 回報）。
   */
  const [stampAt, setStampAt] = useState(0)
  if (!list.length) return null
  // 階級高的先蓋；同階照原本順序
  const order = [...list].sort((a, b) => b.tier - a.tier)
  const top = order[Math.min(stampAt, order.length - 1)]
  const hue = (id: string) => CATEGORIES.find((c) => c.key === ACH_BY_ID.get(id)!.category)!.hue
  const verb = (u: typeof top) => (u.def!.tiers && u.tier > 1 ? `升到${TIER_NAMES[u.tier - 1]}階` : '解開')
  return (
    <>
      {stampAt < order.length && (
        <div className="stamp-back" onClick={() => setStampAt((i) => i + 1)} role="dialog" aria-modal="true">
          <div key={stampAt} className={'stamp' + (top.def!.tiers ? ' t' + top.tier : '')}>
            <Badge def={top.def!} got tier={top.tier} size={120} hue={hue(top.id)} />
            <b>{badgeLabel(top.def!, top.def!.tiers ? top.tier : 0)}</b>
            <span>{verb(top)}！</span>
            <small>{stampAt < order.length - 1 ? `還有 ${order.length - 1 - stampAt} 個，點一下看下一個` : '點一下收起來'}</small>
          </div>
        </div>
      )}
      <div className="unlocked">
        <div className="ttl">🏅 這一場拿到 {list.length} 個徽章</div>
        <div className="row">
          {list.map((u) => (
            <div className="one" key={u.id}>
              <Badge def={u.def!} got tier={u.tier} size={44} hue={hue(u.id)} />
              <b>{badgeLabel(u.def!, u.def!.tiers ? u.tier : 0)}</b>
              <small>{verb(u)}</small>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/** 打倒魔王：第一次的話外框已經放進背包了，要講出來（不然小朋友不知道要去穿） */
function RaidWin({ raid }: { raid: RaidResult & { bossId: string } }) {
  const b = BOSS_BY_ID.get(raid.bossId)
  if (!b) return null
  return (
    <div className="unlocked">
      <span className="ttl">{raid.first ? `第一次打倒${b.name}！` : `打倒${b.name} ${raid.kills} 次了`}</span>
      <div className="row">
        <span className="one">
          <BossFace b={b} size={52} />
          {raid.first ? <small>拿到「{b.name}框」，去「我的角色」戴上</small> : <small>個人檔案記了一筆</small>}
        </span>
      </div>
    </div>
  )
}
