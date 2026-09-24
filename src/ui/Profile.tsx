import { useEffect, useState } from 'react'
import type { Character, Student } from '@/core/types'
import { repo } from '@/net'
import type { AchievementRow, PublicProfile } from '@/net/repository'
import {
  ACHIEVEMENTS, ACH_BY_ID, CATEGORIES, type AchCategory, type AchDef,
} from '@/data/achievements'
import { BADGE_ICONS } from './icons'
import { avatarSrc } from '@/data/jobs'
import { frameOf } from '@/data/cosmetics'
import { levelFromExp } from '@/core/progress'

/**
 * 個人檔案與徽章牆。
 *
 * **牆是給人看的，不是清單。** 拿到的畫成彩色徽記，沒拿到的畫成灰色剪影
 * 加一句「還差什麼」——看得到路才會想拿；只有彩蛋類不給提示，那是驚喜。
 *
 * 別在名字旁邊的三個徽章是最有動力的一格：排行榜上同學看得到。
 * 跟外框同一個道理，收集品要**同學看得到**才有意義（見 data/cosmetics.ts）。
 *
 * 誰拿到什麼由伺服器說了算（schema.sql 的 refresh_achievements()），
 * 這一頁只負責畫。
 */

/** 一個徽章。拿到的是彩色底板加白色徽記，沒拿到的是灰色剪影。 */
export function Badge({
  def, got, size = 56, hue,
}: { def: AchDef; got: boolean; size?: number; hue: string }) {
  const paths = BADGE_ICONS[def.id] ?? []
  return (
    <span className={'badge' + (got ? ' got' : '')}
      style={{ width: size, height: size, ['--hue' as string]: hue }}
      title={got ? def.name : (def.secret ? '???' : def.hint ?? '')}>
      <svg viewBox="0 0 512 512" aria-hidden="true">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    </span>
  )
}

/** 名字旁邊別著的那幾個。排行榜和個人檔案都用這個。 */
export function PinnedBadges({ ids, size = 22 }: { ids: string[]; size?: number }) {
  const defs = ids.map((id) => ACH_BY_ID.get(id)).filter((a): a is AchDef => !!a)
  if (!defs.length) return null
  return (
    <span className="pins">
      {defs.map((d) => (
        <Badge key={d.id} def={d} got size={size}
          hue={CATEGORIES.find((c) => c.key === d.category)!.hue} />
      ))}
    </span>
  )
}

export function Profile({
  student, character, onCharacter, onBack,
}: {
  student: Student
  character: Character
  onCharacter: (c: Character) => void
  onBack: () => void
}) {
  const [rows, setRows] = useState<AchievementRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [pinned, setPinned] = useState<string[]>(character.pinned ?? [])
  const [open, setOpen] = useState(character.publicProfile ?? true)

  useEffect(() => {
    let alive = true
    // 進來先重算一次：打完那一場如果剛好結算失敗，這裡會把它補上
    void repo.refreshAchievements()
      .catch(() => [])
      .then(() => repo.loadAchievements())
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const unlocked = new Set((rows ?? []).filter((r) => r.unlockedAt).map((r) => r.id))
  const frame = frameOf(character.equipped)

  async function togglePin(id: string) {
    const next = pinned.includes(id)
      ? pinned.filter((x) => x !== id)
      : [...pinned, id].slice(-3)
    setPinned(next)
    try {
      const saved = await repo.setPinned(next)
      setPinned(saved)
      onCharacter({ ...character, pinned: saved })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function togglePublic() {
    const next = !open
    setOpen(next)
    try {
      await repo.setPublicProfile(next)
      onCharacter({ ...character, publicProfile: next })
    } catch (e) {
      setOpen(!next)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">徽章牆</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      <div className="profile-head panel">
        <span className={'mugbox' + (frame ? ' ' + frame.className : '')}
          style={{ width: 64, height: 64 }}>
          <img src={avatarSrc(character.avatar)} alt="" />
          {frame?.badge && <i className="mugbadge">{frame.badge}</i>}
        </span>
        <div className="profile-who">
          <div className="nm">
            {student.nickname}
            {character.title && <span className="title-chip">{character.title}</span>}
          </div>
          <div className="sub">Lv.{levelFromExp(character.exp)}　🏅 {unlocked.size} / {ACHIEVEMENTS.length}</div>
          <div className="pinrow">
            <PinnedBadges ids={pinned} />
            <button className="btn ghost small" onClick={() => setPicking((p) => !p)}>
              {picking ? '選好了' : '別徽章'}
            </button>
          </div>
        </div>
      </div>

      {picking && (
        <p className="lede">
          點徽章可以別在名字旁邊，最多三個——同學在排行榜上看得到的就是這三個。
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="lede">正在數你的徽章…</p>}

      {rows && CATEGORIES.map((cat) => (
        <CategoryBlock
          key={cat.key} cat={cat.key} hue={cat.hue} name={cat.name}
          unlocked={unlocked} picking={picking} pinned={pinned}
          onPick={(id) => void togglePin(id)}
        />
      ))}

      {rows && (
        <div className="panel pubrow">
          <div>
            <b>讓同學從排行榜點進來看我的徽章</b>
            <small>關起來的話，同學只看得到排行榜上的名字。老師一律看得到。</small>
          </div>
          <button className={'toggle' + (open ? ' on' : '')} onClick={() => void togglePublic()}
            aria-pressed={open}>
            <i />
          </button>
        </div>
      )}
    </div>
  )
}

function CategoryBlock({
  cat, hue, name, unlocked, picking, pinned, onPick,
}: {
  cat: AchCategory
  hue: string
  name: string
  unlocked: Set<string>
  picking: boolean
  pinned: string[]
  onPick: (id: string) => void
}) {
  const list = ACHIEVEMENTS.filter((a) => a.category === cat)
  const got = list.filter((a) => unlocked.has(a.id)).length
  return (
    <div className="achblock">
      <div className="achhead" style={{ ['--hue' as string]: hue }}>
        <i className="dot" />
        <b>{name}</b>
        <span className="n">{got} / {list.length}</span>
      </div>
      <div className="achgrid">
        {list.map((a) => {
          const has = unlocked.has(a.id)
          // 彩蛋沒拿到就連名字都不給——那是驚喜，不是清單上的待辦事項
          const label = has || !a.secret ? a.name : '？？？'
          const note = has ? a.desc : (a.secret ? '彩蛋' : a.hint ?? '')
          const pin = picking && has
          return (
            <button key={a.id} className={'achcell' + (pinned.includes(a.id) ? ' pinned' : '')}
              disabled={!pin} onClick={() => onPick(a.id)}>
              <Badge def={a} got={has} hue={hue} />
              <b>{label}</b>
              <small>{note}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 同學的檔案。**一定要走 publicProfile()**：別人的角色存檔讀不到，
 * 而且對方可以把檔案關起來。這裡只看得到暱稱、頭像、外框、稱號和徽章。
 */
export function PeerProfile({ studentId, onBack }: { studentId: string; onBack: () => void }) {
  const [p, setP] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    repo.publicProfile(studentId)
      .then((x) => { if (alive) setP(x) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [studentId])

  const badges = new Set(p?.badges ?? [])
  const frame = frameOf(p?.equipped ?? [])

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">同學的徽章牆</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回去</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!p && !error && <p className="lede">正在看…</p>}

      {p && (
        <>
          <div className="profile-head panel">
            <span className={'mugbox' + (frame ? ' ' + frame.className : '')}
              style={{ width: 64, height: 64 }}>
              <img src={avatarSrc(p.avatar)} alt="" />
              {frame?.badge && <i className="mugbadge">{frame.badge}</i>}
            </span>
            <div className="profile-who">
              <div className="nm">
                {p.nickname}
                {p.title && <span className="title-chip">{p.title}</span>}
              </div>
              <div className="sub">Lv.{p.level}　⭐ {p.stars}　🏅 {badges.size} / {ACHIEVEMENTS.length}</div>
              <div className="pinrow"><PinnedBadges ids={p.pinned} /></div>
            </div>
          </div>

          {CATEGORIES.map((cat) => (
            <div className="achblock" key={cat.key}>
              <div className="achhead" style={{ ['--hue' as string]: cat.hue }}>
                <i className="dot" />
                <b>{cat.name}</b>
                <span className="n">
                  {ACHIEVEMENTS.filter((a) => a.category === cat.key && badges.has(a.id)).length}
                  {' / '}
                  {ACHIEVEMENTS.filter((a) => a.category === cat.key).length}
                </span>
              </div>
              <div className="achgrid">
                {ACHIEVEMENTS.filter((a) => a.category === cat.key).map((a) => {
                  const has = badges.has(a.id)
                  return (
                    <div key={a.id} className="achcell">
                      <Badge def={a} got={has} hue={cat.hue} />
                      <b>{has || !a.secret ? a.name : '？？？'}</b>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
