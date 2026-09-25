import { useState } from 'react'
import { count } from '@/core/inventory'
import { levelFromExp } from '@/core/progress'
import type { Character } from '@/core/types'
import { ITEMS } from '@/data/shop'
import { COLORS, FRAMES, colorOf, frameOf } from '@/data/cosmetics'
import { LEGIONS, TIERS, legionOf } from '@/data/legions'
import { LegionThumb } from './LegionThumb'
import { JOB_NAME } from '@/core/character'
import { repo } from '@/net'
import { AVATAR_TIERS, SHOP_AVATARS, avatarAfterJob, avatarSrc, jobAvatars } from '@/data/avatars'
import type { Job } from '@/core/types'
import { JobIcon, JobPicker } from './JobPicker'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import type { IconName } from '@/data/icons'

/**
 * 我的角色：換上買到的顏色和外框、看自己有幾個道具。
 *
 * 本來是商店的第二個分頁，2026-09-24 Chuck 說藏在商店裡不直覺，
 * 搬到選關畫面上方自己一顆鈕。換裝不是買東西，不該要先進賣場才找得到。
 *
 * 2026-09-25 職業和頭像也搬進來（本來在「我的設定」，小朋友找不到）。
 * 職業不用錢、隨時換；頭像每個職業送四張，其他的去商店買，買到的哪個職業都能戴。
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
  const wornLegion = legionOf(character.equipped)

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

  /** 換職業。頭像是舊職業送的就跟著換成新職業的第一張（資料庫 set_job 也這樣做）。 */
  const changeJob = (job: Job) => run(async () => {
    await repo.saveCharacter({ ...character, job })
    const avatar = avatarAfterJob(character.avatar, job)
    const seen = character.avatarsSeen ?? []
    onChanged({ ...character, job, avatar, avatarsSeen: seen.includes(avatar) ? seen : [...seen, avatar] })
    return avatar === character.avatar
      ? `換成${JOB_NAME[job]}了，下一關就會用新的`
      : `換成${JOB_NAME[job]}了，頭像也換成${JOB_NAME[job]}的`
  })

  const pickAvatar = (id: string) => run(async () => {
    await repo.setAvatar(id)
    const seen = character.avatarsSeen ?? []
    onChanged({ ...character, avatar: id, avatarsSeen: seen.includes(id) ? seen : [...seen, id] })
    return '頭像換好了'
  })

  /** 穿上或脫下。同一個欄位只能穿一件，換掉哪一件是資料庫決定的。 */
  const wear = (id: string, on: boolean, name: string) => run(async () => {
    const equipped = await repo.equipItem(id, on)
    onChanged({ ...character, equipped })
    return on ? `換上「${name}」了` : `脫下「${name}」了`
  })

  // 成就限定的外框不算進收集進度——那是另一面牆（徽章）的事；送的顏色也不算
  const cosmetics = ITEMS.filter((i) => i.kind === 'cosmetic' && !i.achievementOnly && !i.free)
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
            <b><JobIcon job={character.job} size={20} /> {JOB_NAME[character.job]}　Lv.{level}</b>
            <span>{wornLegion.usesColor ? `${wornLegion.name}．${wornColor.name}` : wornLegion.name}　{wornFrame ? wornFrame.name : '沒戴外框'}</span>
            <span className="i-tag">收集進度 {ownedCosmetics} / {cosmetics.length}</span>
          </div>
        </div>

        <h2 className="sec">職業<small>　不用錢，想換就換，進度和金幣都不會動</small></h2>
        <JobPicker job={character.job} disabled={busy} onPick={(j) => { if (j !== character.job) void changeJob(j) }} />

        <h2 className="sec">頭像<small>　{JOB_NAME[character.job]}送四張，其他的在商店</small></h2>
        <div className="avatars">
          {jobAvatars(character.job).map((a) => (
            <button key={a.id} type="button" className={'av' + (character.avatar === a.id ? ' on' : '')}
              disabled={busy} onClick={() => { if (character.avatar !== a.id) void pickAvatar(a.id) }} aria-label={a.name}>
              <img src={avatarSrc(a.id)} alt="" />
            </button>
          ))}
        </div>
        {(['common', 'rare', 'legend'] as const).map((tier) => {
          const t = AVATAR_TIERS[tier]
          const list = SHOP_AVATARS.filter((a) => a.tier === tier)
          const mine = list.filter((a) => has(a.id)).length
          return (
            <div className="av-shelf" key={tier}>
              <h3><b style={{ background: t.tint }}>{t.name}</b><small>買到 {mine} / {list.length}</small></h3>
              <div className="avatars">
                {list.map((a) => {
                  const owned = has(a.id)
                  return (
                    <button key={a.id} type="button" aria-label={a.name}
                      className={'av' + (character.avatar === a.id ? ' on' : '') + (owned ? '' : ' locked')}
                      disabled={busy} onClick={() => owned ? (character.avatar !== a.id && void pickAvatar(a.id)) : onShop()}>
                      <img src={avatarSrc(a.id)} alt="" />
                      {!owned && <span className="av-tag">{t.price}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <h2 className="sec">軍團<small>　兵推整套換；守塔換士兵和箭塔</small></h2>
        <div className="picks">
          {LEGIONS.map((l) => {
            const owned = !l.id || has(l.id)
            const on = wornLegion.id === l.id
            const t = TIERS[l.tier]
            return (
              <button key={l.id || 'default'} className={'pick' + (on ? ' on' : '') + (owned ? '' : ' locked')}
                disabled={busy || !owned || on}
                onClick={() => void (l.id ? wear(l.id, true, l.name)
                  : wornLegion.id && wear(wornLegion.id, false, wornLegion.name))}>
                <LegionThumb legion={l} size={30} />
                {l.name}
                {!owned && <small>Lv{t.unlockLevel}．<Icon name="coin" size={12} /> {t.price}</small>}
              </button>
            )
          })}
        </div>

        <h2 className="sec">陣營顏色<small>　送的，隨你換</small></h2>
        {!wornLegion.usesColor && (
          <p className="pick-note">顏色只有王國軍有，換回王國軍才看得到</p>
        )}
        <div className={'picks' + (wornLegion.usesColor ? '' : ' off')}>
          {COLORS.map((c) => {
            const on = wornColor.id === c.id
            return (
              <button key={c.id || 'default'} className={'pick' + (on ? ' on' : '')}
                disabled={busy || !wornLegion.usesColor}
                onClick={() => void (c.id ? wear(c.id, true, c.name)
                  : wornColor.id && wear(wornColor.id, false, wornColor.name))}>
                <span className="sw" style={{ background: c.swatch }} />
                {c.name}
              </button>
            )
          })}
        </div>

        <h2 className="sec">頭像外框</h2>
        <div className="picks">
          <button className={'pick' + (wornFrame ? '' : ' on')} disabled={busy || !wornFrame}
            onClick={() => void (wornFrame && wear(wornFrame.id, false, wornFrame.name))}>不戴</button>
          {FRAMES.filter((f) => !f.fromBoss || has(f.id)).map((f) => {
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
