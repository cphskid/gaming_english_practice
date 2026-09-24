import type { SessionResult } from '@/core/session'
import { useState } from 'react'
import { ACH_BY_ID, CATEGORIES, TIER_NAMES, badgeLabel, parseUnlock } from '@/data/achievements'
import { Badge } from './Profile'
import { Icon } from './Icon'

export function Result({
  result, bonus, unlocked = [], onRetry, onBack,
}: {
  result: SessionResult
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
        {unlocked.length > 0 && <Unlocked ids={unlocked} />}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={onBack}>回選關</button>
          <button className="btn" onClick={onRetry}>{versus ? '再來一場' : '再玩一次'}</button>
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
  const [stamp, setStamp] = useState(true)
  if (!list.length) return null
  // 大章蓋階級最高的那一個；同階就蓋第一個
  const top = [...list].sort((a, b) => b.tier - a.tier)[0]
  const hue = (id: string) => CATEGORIES.find((c) => c.key === ACH_BY_ID.get(id)!.category)!.hue
  const verb = (u: typeof top) => (u.def!.tiers && u.tier > 1 ? `升到${TIER_NAMES[u.tier - 1]}階` : '解開')
  return (
    <>
      {stamp && (
        <div className="stamp-back" onClick={() => setStamp(false)} role="dialog" aria-modal="true">
          <div className={'stamp' + (top.def!.tiers ? ' t' + top.tier : '')}>
            <Badge def={top.def!} got tier={top.tier} size={120} hue={hue(top.id)} />
            <b>{badgeLabel(top.def!, top.def!.tiers ? top.tier : 0)}</b>
            <span>{verb(top)}！</span>
            {list.length > 1 && <small>還有 {list.length - 1} 個，點一下看</small>}
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
