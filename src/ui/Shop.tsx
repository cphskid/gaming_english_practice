import { useEffect, useState } from 'react'
import { count, MODE_LABEL } from '@/core/inventory'
import { levelFromExp } from '@/core/progress'
import type { Character } from '@/core/types'
import type { ItemDef } from '@/core/inventory'
import { ITEMS } from '@/data/shop'
import { COLORS, FRAMES } from '@/data/cosmetics'
import { LEGIONS, TIERS, TIER_ORDER, legionNeed, type LegionDef } from '@/data/legions'
import { ACH_BY_ID } from '@/data/achievements'
import { LegionThumb } from './LegionThumb'
import { JOB_NAME } from '@/core/character'
import { repo } from '@/net'
import { Avatar } from './Avatar'
import { AVATAR_BY_ID, AVATAR_TIERS, avatarSrc } from '@/data/avatars'
import { Icon } from './Icon'
import type { IconName } from '@/data/icons'

/**
 * 商店。（「我的角色」原本是這裡的第二個分頁，2026-09-24 搬到選關畫面上方
 * 自己一顆鈕，見 MyCharacter.tsx——換裝不是買東西，藏在商店裡找不到。）
 *
 * **買賣一律走後端**：這裡只送品項 id，價格、等級門檻、餘額都是資料庫查的。
 * 前端這份 ITEMS 只負責顯示名字和說明，就算被改掉也買不到便宜貨。
 *
 * 裝飾品純外觀不給數值——付錢變強的話，這就不是練英文的遊戲了。
 */
/**
 * 商店那一格左上角的縮圖。
 *
 * **裝飾品不給圖示，給它自己**——顏色就畫那塊顏色，外框就套一張小頭像。
 * 一個外觀品項最好的縮圖就是它自己，另外找一張圖來代表它只會對不起來
 * （而且素材包裡根本沒有皇冠跟彩虹）。「我的角色」那一頁本來就是這樣做的。
 */
function thumb(i: ItemDef) {
  if (i.slot === 'color') {
    const c = COLORS.find((x) => x.id === i.id)
    return <span className="sw" style={{ background: c?.swatch }} />
  }
  if (i.slot === 'frame') {
    const f = FRAMES.find((x) => x.id === i.id)
    return (
      <span className={'mugbox ' + (f?.className ?? '')} style={{ width: 22, height: 22 }}>
        {f?.badge && <i className="mugbadge" style={{ fontSize: 9 }}>{f.badge}</i>}
      </span>
    )
  }
  if (i.slot === 'avatar') {
    return <span className="mugbox" style={{ width: 34, height: 34 }}><img src={avatarSrc(i.id)} alt="" /></span>
  }
  return <Icon name={i.icon as IconName} size={20} />
}

export function Shop({
  character, onChanged, onBack, onCharacter,
}: {
  character: Character
  onChanged: (c: Character) => void
  onBack: () => void
  /** 買到裝飾品之後直接去「我的角色」換上 */
  onCharacter: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const level = levelFromExp(character.exp)
  const has = (id: string) => count(character, id) > 0
  // 拿到哪些成就。稀有級軍團要先拿到指定成就才開放購買（真正擋的是 buy_item）。
  const [badges, setBadges] = useState<Set<string> | null>(null)
  useEffect(() => {
    let alive = true
    repo.loadAchievements()
      .then((rows) => { if (alive) setBadges(new Set(rows.filter((r) => r.unlockedAt).map((r) => r.id))) })
      .catch(() => { if (alive) setBadges(new Set()) })
    return () => { alive = false }
  }, [])

  async function run(what: () => Promise<string>) {
    if (busy) return
    setBusy(true); setError(null); setNote(null)
    try {
      setNote(await what())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const buy = (id: string, name: string) => run(async () => {
    const r = await repo.buyItem(id)
    onChanged({ ...character, coins: r.coins, items: r.items })
    return `買了「${name}」`
  })

  return (
    <div className="screen wide">
      <div className="topbar">
        <Avatar character={character} />
        <span className="who">{JOB_NAME[character.job]}　Lv.{level}</span>
        <span className="spacer" />
        <span className="coins"><Icon name="coin" size={15} /> {character.coins}</span>
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <div className="shopwrap">
        <section>
          <h2 className="sec">軍團<small>　一次換整套：兵推的兵、城堡、塔、戰場，守塔的士兵和箭塔</small></h2>
          {TIER_ORDER.map((tier) => (
            <LegionShelf key={tier} tier={tier} level={level} coins={character.coins} badges={badges}
              owned={(l) => !l.id || has(l.id)} busy={busy} onBuy={(l) => void buy(l.id, l.name)}
              onCharacter={onCharacter} />
          ))}
        </section>

        {[
          { key: 'consumable', title: '道具', hint: '帶進關卡裡用，用掉就沒了' },
          // 頭像（2026-09-25）：每個職業送四張，其他的分三層在這裡賣
          ...(['common', 'rare', 'legend'] as const).map((t) => ({
            key: 'avatar-' + t, title: AVATAR_TIERS[t].name + '頭像',
            hint: AVATAR_TIERS[t].unlockLevel > 1
              ? `${AVATAR_TIERS[t].unlockLevel} 級開放，買了哪個職業都能用`
              : '買了哪個職業都能用',
          })),
          // 陣營顏色 2026-09-24 起免費送，不上架，在「我的角色」直接換
          { key: 'frame', title: '頭像外框', hint: '套在頭像外面，同學也看得到' },
        ].map((g) => (
          <section key={g.key}>
            <h2 className="sec">{g.title}<small>　{g.hint}</small></h2>
            <div className="items">
              {ITEMS.filter((i) => !i.achievementOnly && !i.free
                && (g.key === 'consumable' ? i.kind === 'consumable'
                  : g.key.startsWith('avatar-') ? i.slot === 'avatar' && 'avatar-' + AVATAR_BY_ID.get(i.id)?.tier === g.key
                    : i.slot === g.key))
                .map((i) => {
                  const locked = level < i.unlockLevel
                  const owned = has(i.id)
                  const poor = character.coins < i.price
                  return (
                    <div className={'item' + (locked ? ' locked' : '')} key={i.id}>
                      <span className="i-name">{thumb(i)} {i.name}</span>
                      <span className="i-desc">{i.desc}</span>
                      {i.modes && (
                        <span className="i-modes">
                          {i.modes.map((m) => <em key={m}>{MODE_LABEL[m]}</em>)}
                          都用得到
                        </span>
                      )}
                      {owned && i.kind === 'cosmetic'
                        ? <button className="i-tag i-go" onClick={onCharacter}>已經有了，去「我的角色」換上 ›</button>
                        : <span className="i-tag">{owned ? `已有 ${count(character, i.id)} 個` : ''}</span>}
                      <button className="btn small" disabled={busy || locked || (owned && i.kind === 'cosmetic')}
                        onClick={() => void buy(i.id, i.name)}>
                        {locked ? `${i.unlockLevel} 級解鎖`
                          : owned && i.kind === 'cosmetic' ? '已擁有'
                            : <><Icon name="coin" size={13} /> {i.price}</>}
                      </button>
                      {!locked && poor && !owned && <span className="i-poor">還差 {i.price - character.coins}</span>}
                    </div>
                  )
                })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/**
 * 軍團的一層架子。四級＝四層：預設、普通、稀有、傳說。
 *
 * **門檻跟著那一層走**（data/legions.ts 的 TIERS），所以每一層的標題就寫著要什麼，
 * 小朋友一眼看得到「再升三級、再拿一個成就就能買豬」。
 * 之後加新軍團就是往某一層多放一張卡，這裡不用改。
 */
function LegionShelf({
  tier, level, coins, badges, owned, busy, onBuy, onCharacter,
}: {
  tier: keyof typeof TIERS
  level: number
  coins: number
  /** 拿到的成就；還沒讀到是 null */
  badges: Set<string> | null
  owned: (l: LegionDef) => boolean
  busy: boolean
  onBuy: (l: LegionDef) => void
  onCharacter: () => void
}) {
  const t = TIERS[tier]
  const list = LEGIONS.filter((l) => l.tier === tier)
  const needs = [
    t.unlockLevel > 1 && `Lv${t.unlockLevel}`,
    t.needAchievement && `成就「${ACH_BY_ID.get(t.needAchievement)?.name ?? t.needAchievement}」`,
    t.badgeLater && '指定成就',
    t.price > 0 && `${t.price} 金`,
  ].filter(Boolean).join('＋')
  return (
    <div className="lg-shelf" style={{ borderColor: t.tint }}>
      <div className="lg-head">
        <b style={{ background: t.tint }}>{t.name}</b>
        <small>{needs || '免費，一開始就有'}</small>
      </div>
      {list.length === 0 && <p className="lg-soon">還沒上架，之後會有最帥的那一套</p>}
      {list.map((l) => {
        const mine = owned(l)
        const need = legionNeed(l)
        const lowLevel = level < t.unlockLevel
        const noBadge = !!need && badges !== null && !badges.has(need)
        const poor = coins < t.price
        return (
          <div className={'item lg-item' + (!mine && (lowLevel || noBadge) ? ' locked' : '')} key={l.id || 'default'}>
            <span className="i-name"><LegionThumb legion={l} /> {l.name}</span>
            <span className="i-desc">{l.desc}</span>
            {mine
              ? <button className="i-tag i-go" onClick={onCharacter}>
                  {l.id ? '已經有了，去「我的角色」換上 ›' : '預設就有，去「我的角色」換 ›'}
                </button>
              : <span className="i-tag">
                  {lowLevel && `還要升到 ${t.unlockLevel} 級`}
                  {lowLevel && noBadge && '，'}
                  {noBadge && `先拿到成就「${ACH_BY_ID.get(need!)?.name ?? need}」`}
                </span>}
            <button className="btn small" disabled={busy || mine || lowLevel || noBadge || badges === null && !!need}
              onClick={() => onBuy(l)}>
              {mine ? '已擁有'
                : lowLevel ? `${t.unlockLevel} 級解鎖`
                  : noBadge ? '先拿成就'
                    : <><Icon name="coin" size={13} /> {t.price}</>}
            </button>
            {!mine && !lowLevel && !noBadge && poor && <span className="i-poor">還差 {t.price - coins}</span>}
          </div>
        )
      })}
    </div>
  )
}
