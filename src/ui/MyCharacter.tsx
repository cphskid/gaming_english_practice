import { useState } from 'react'
import { count } from '@/core/inventory'
import { levelFromExp } from '@/core/progress'
import type { Character } from '@/core/types'
import { ITEMS } from '@/data/shop'
import { COLORS, FRAMES, colorOf, frameOf } from '@/data/cosmetics'
import { JOB_NAME } from '@/core/character'
import { repo } from '@/net'
import { avatarSrc } from '@/data/jobs'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import type { IconName } from '@/data/icons'

/**
 * 我的角色：換上買到的顏色和外框、看自己有幾個道具。
 *
 * 本來是商店的第二個分頁，2026-09-24 Chuck 說藏在商店裡不直覺，
 * 搬到選關畫面上方自己一顆鈕。換裝不是買東西，不該要先進賣場才找得到。
 *
 * 這一頁是**收集感的主場**：買到的排在前面、沒買到的畫成灰色剪影
 * 並標上價錢。看得到自己還缺什麼，才會想再打一關。
 */
export function MyCharacter({
  character, onChanged, onBack, onShop,
}: {
  character: Character
  onChanged: (c: Character) => void
  onBack: () => void
  /** 看到還缺的東西，一鍵去商店買 */
  onShop: () => void
}) {
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

  /** 穿上或脫下。同一個欄位只能穿一件，換掉哪一件是資料庫決定的。 */
  const wear = (id: string, on: boolean, name: string) => run(async () => {
    const equipped = await repo.equipItem(id, on)
    onChanged({ ...character, equipped })
    return on ? `換上「${name}」了` : `脫下「${name}」了`
  })

  // 成就限定的外框不算進收集進度——那是另一面牆（徽章）的事
  const cosmetics = ITEMS.filter((i) => i.kind === 'cosmetic' && !i.achievementOnly)
  const ownedCosmetics = cosmetics.filter((i) => has(i.id)).length

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">我的角色</span>
        <span className="spacer" />
        <span className="coins"><Icon name="coin" size={15} /> {character.coins}</span>
        <button className="btn ghost small" onClick={onShop}>商店</button>
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

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
    </div>
  )
}
