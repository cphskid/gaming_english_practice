import { useState } from 'react'
import { count, MODE_LABEL } from '@/core/inventory'
import { levelFromExp } from '@/core/progress'
import type { Character } from '@/core/types'
import type { ItemDef } from '@/core/inventory'
import { ITEMS } from '@/data/shop'
import { COLORS, FRAMES, colorOf, frameOf } from '@/data/cosmetics'
import { JOB_NAME } from '@/core/character'
import { repo } from '@/net'
import { avatarSrc } from '@/data/jobs'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import type { IconName } from '@/data/icons'

/**
 * 商店與「我的角色」。
 *
 * **買賣一律走後端**：這裡只送品項 id，價格、等級門檻、餘額都是資料庫查的。
 * 前端這份 ITEMS 只負責顯示名字和說明，就算被改掉也買不到便宜貨。
 *
 * 裝飾品純外觀不給數值——付錢變強的話，這就不是練英文的遊戲了。
 *
 * 「我的角色」這一頁是**收集感的主場**：買到的排在前面、沒買到的畫成灰色剪影
 * 並標上價錢。看得到自己還缺什麼，才會想再打一關。
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
  return <Icon name={i.icon as IconName} size={20} />
}

export function Shop({
  character, onChanged, onBack,
}: {
  character: Character
  onChanged: (c: Character) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<'shop' | 'me'>('shop')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const level = levelFromExp(character.exp)
  const has = (id: string) => count(character, id) > 0
  const wornColor = colorOf(character.equipped)
  const wornFrame = frameOf(character.equipped)

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

  /** 穿上或脫下。同一個欄位只能穿一件，換掉哪一件是資料庫決定的。 */
  const wear = (id: string, on: boolean, name: string) => run(async () => {
    const equipped = await repo.equipItem(id, on)
    onChanged({ ...character, equipped })
    return on ? `換上「${name}」了` : `脫下「${name}」了`
  })

  // 成就限定的外框不進商店——買不到的東西擺在賣場只會讓人一直按
  const cosmetics = ITEMS.filter((i) => i.kind === 'cosmetic' && !i.achievementOnly)
  const ownedCosmetics = cosmetics.filter((i) => has(i.id)).length

  return (
    <div className="screen wide">
      <div className="topbar">
        <Avatar character={character} />
        <span className="who">{JOB_NAME[character.job]}　Lv.{level}</span>
        <span className="spacer" />
        <span className="coins"><Icon name="coin" size={15} /> {character.coins}</span>
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      <div className="tabs">
        <button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>商店</button>
        <button className={tab === 'me' ? 'on' : ''} onClick={() => setTab('me')}>我的角色</button>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      {tab === 'shop' && (
        <div className="shopwrap">
          {[
            { key: 'consumable', title: '道具', hint: '帶進關卡裡用，用掉就沒了' },
            { key: 'color', title: '陣營顏色', hint: '城堡、塔、士兵整套變色' },
            { key: 'frame', title: '頭像外框', hint: '套在頭像外面，同學也看得到' },
          ].map((g) => (
            <section key={g.key}>
              <h2 className="sec">{g.title}<small>　{g.hint}</small></h2>
              <div className="items">
                {ITEMS.filter((i) => !i.achievementOnly
                  && (g.key === 'consumable' ? i.kind === 'consumable' : i.slot === g.key))
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
                          ? <span className="i-tag">已經有了，去「我的角色」換上</span>
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
      )}

      {tab === 'me' && (
        <div className="shopwrap">
          <div className="hero">
            <Avatar character={character} size={96} />
            <div className="hero-txt">
              <b>{JOB_NAME[character.job]}　Lv.{level}</b>
              <span>{wornColor.name}　{wornFrame ? wornFrame.name : '沒戴外框'}</span>
              <span className="i-tag">收集進度 {ownedCosmetics} / {cosmetics.length}</span>
            </div>
          </div>

          <h2 className="sec">陣營顏色<small>　換了之後整個戰場都是你的顏色</small></h2>
          <div className="picks">
            {COLORS.map((c) => {
              const owned = !c.id || has(c.id)
              const on = wornColor.id === c.id
              const price = ITEMS.find((i) => i.id === c.id)?.price
              return (
                <button key={c.id || 'default'} className={'pick' + (on ? ' on' : '') + (owned ? '' : ' locked')}
                  disabled={busy || !owned}
                  onClick={() => void (c.id ? wear(c.id, true, c.name)
                    : wornColor.id && wear(wornColor.id, false, wornColor.name))}>
                  <span className="sw" style={{ background: c.swatch }} />
                  {c.name}
                  {!owned && <small><Icon name="coin" size={12} /> {price}</small>}
                </button>
              )
            })}
          </div>

          <h2 className="sec">頭像外框</h2>
          <div className="picks">
            <button className={'pick' + (wornFrame ? '' : ' on')} disabled={busy || !wornFrame}
              onClick={() => void (wornFrame && wear(wornFrame.id, false, wornFrame.name))}>不戴</button>
            {FRAMES.map((f) => {
              const owned = has(f.id)
              const on = wornFrame?.id === f.id
              const item = ITEMS.find((i) => i.id === f.id)
              const price = item?.price
              return (
                <button key={f.id} className={'pick' + (on ? ' on' : '') + (owned ? '' : ' locked')}
                  disabled={busy || !owned} onClick={() => void wear(f.id, true, f.name)}>
                  <span className={'mugbox ' + f.className} style={{ width: 26, height: 26 }}>
                    <img src={avatarSrc(character.avatar)} alt="" />
                    {f.badge && <i className="mugbadge" style={{ fontSize: 11 }}>{f.badge}</i>}
                  </span>
                  {f.name}
                  {!owned && (item?.achievementOnly
                    ? <small>解成就</small>
                    : <small><Icon name="coin" size={12} /> {price}</small>)}
                </button>
              )
            })}
          </div>

          <h2 className="sec">道具<small>　在關卡最上面那一排點它</small></h2>
          <div className="picks">
            {ITEMS.filter((i) => i.kind === 'consumable').map((i) => (
              <span key={i.id} className={'pick' + (has(i.id) ? '' : ' locked')}>
                <Icon name={i.icon as IconName} size={20} /> {i.name}
                <small>{has(i.id) ? `×${count(character, i.id)}` : '沒有'}</small>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
