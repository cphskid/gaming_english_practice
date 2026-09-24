import { useState } from 'react'
import { count, MODE_LABEL } from '@/core/inventory'
import { levelFromExp } from '@/core/progress'
import type { Character } from '@/core/types'
import type { ItemDef } from '@/core/inventory'
import { ITEMS } from '@/data/shop'
import { COLORS, FRAMES } from '@/data/cosmetics'
import { JOB_NAME } from '@/core/character'
import { repo } from '@/net'
import { Avatar } from './Avatar'
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
