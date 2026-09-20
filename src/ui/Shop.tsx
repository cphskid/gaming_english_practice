import { useState } from 'react'
import { count } from '@/core/inventory'
import { levelFromExp } from '@/core/progress'
import type { Character } from '@/core/types'
import { ITEMS } from '@/data/shop'
import { avatarSrc } from '@/data/jobs'
import { JOB_NAME } from '@/core/character'
import { repo } from '@/net'

/**
 * 商店與背包。
 *
 * **買賣一律走後端**：這裡只送品項 id，價格、等級門檻、餘額都是資料庫查的。
 * 前端這份 ITEMS 只負責顯示名字和說明，就算被改掉也買不到便宜貨。
 *
 * 裝飾品純外觀不給數值——付錢變強的話，這就不是練英文的遊戲了。
 */
export function Shop({
  character, onChanged, onBack,
}: {
  character: Character
  onChanged: (c: Character) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<'shop' | 'bag'>('shop')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const level = levelFromExp(character.exp)

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

  const owned = ITEMS.filter((i) => count(character, i.id) > 0)

  return (
    <div className="screen">
      <div className="topbar">
        <img className="mug" src={avatarSrc(character.avatar)} alt="" />
        <span className="who">{JOB_NAME[character.job]}　Lv.{level}</span>
        <span className="spacer" />
        <span className="coins">🪙 {character.coins}</span>
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      <div className="tabs">
        <button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>商店</button>
        <button className={tab === 'bag' ? 'on' : ''} onClick={() => setTab('bag')}>背包</button>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      {tab === 'shop' && (
        <div className="items">
          {ITEMS.map((i) => {
            const locked = level < i.unlockLevel
            const poor = character.coins < i.price
            return (
              <div className={'item' + (locked ? ' locked' : '')} key={i.id}>
                <span className="i-name">{i.name}</span>
                <span className="i-desc">{i.desc}</span>
                <span className="i-tag">
                  {i.kind === 'cosmetic' ? '純裝飾，不會變強' : '道具'}
                  {count(character, i.id) > 0 && `　已有 ${count(character, i.id)}`}
                </span>
                <button className="btn small" disabled={busy || locked}
                  onClick={() => void run(async () => {
                    const r = await repo.buyItem(i.id)
                    onChanged({ ...character, coins: r.coins, items: r.items })
                    return `買了「${i.name}」`
                  })}>
                  {locked ? `${i.unlockLevel} 級解鎖` : `🪙 ${i.price}`}
                </button>
                {!locked && poor && <span className="i-poor">還差 {i.price - character.coins}</span>}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'bag' && (
        <div className="items">
          {owned.length === 0 && (
            <p className="lede">背包還是空的。答對題目賺金幣，就可以去商店買東西了。</p>
          )}
          {owned.map((i) => {
            const on = character.equipped.includes(i.id)
            return (
              <div className="item" key={i.id}>
                <span className="i-name">{i.name}　<small>×{count(character, i.id)}</small></span>
                <span className="i-desc">{i.desc}</span>
                {i.kind === 'cosmetic' ? (
                  <button className={'btn small' + (on ? '' : ' ghost')} disabled={busy}
                    onClick={() => void run(async () => {
                      const eq = await repo.equipItem(i.id, !on)
                      onChanged({ ...character, equipped: eq })
                      return on ? `脫下「${i.name}」` : `戴上「${i.name}」`
                    })}>
                    {on ? '穿在身上' : '穿起來'}
                  </button>
                ) : (
                  <span className="i-tag">打的時候在最上面那一排點它</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
