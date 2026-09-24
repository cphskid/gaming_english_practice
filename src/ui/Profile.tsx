import { useEffect, useState } from 'react'
import type { Character, Student } from '@/core/types'
import { repo } from '@/net'
import type { AchievementRow, BadgeCount, Pin, PublicProfile } from '@/net/repository'
import {
  ACHIEVEMENTS, ACH_BY_ID, CATEGORIES, TIER_NAMES, badgeLabel, fillN, tierGoal,
  type AchCategory, type AchDef,
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
 * 別在名字旁邊的三個徽章是最有動力的一格：排行榜上同學看得到。第一個是主徽章，
 * 三個都帶名字和階級——只剩一個小圖示的話誰都看不出那是什麼（第二版改的）。
 * 跟外框同一個道理，收集品要**同學看得到**才有意義（見 data/cosmetics.ts）。
 *
 * 誰拿到什麼由伺服器說了算（schema.sql 的 refresh_achievements()），
 * 這一頁只負責畫。
 */

/** 一個徽章。拿到的是彩色底板加白色徽記，沒拿到的是灰色剪影；分階的外圈是階級色。 */
export function Badge({
  def, got, size = 56, hue, tier = 0,
}: { def: AchDef; got: boolean; size?: number; hue: string; tier?: number }) {
  const paths = BADGE_ICONS[def.id] ?? []
  const ring = got && def.tiers && tier > 0 ? ' t' + tier : ''
  return (
    <span className={'badge' + (got ? ' got' : '') + ring}
      style={{ width: size, height: size, ['--hue' as string]: hue }}
      title={got ? badgeLabel(def, tier) : (def.secret ? '???' : def.hint ?? '')}>
      <svg viewBox="0 0 512 512" aria-hidden="true">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    </span>
  )
}

const hueOf = (d: AchDef) => CATEGORIES.find((c) => c.key === d.category)!.hue

/**
 * 名牌：徽章＋名字＋階級（「萬題·金」）。**只放圖示看不出是什麼**——這是第二版
 * 最主要改的地方。主徽章大一號，兩個副徽章小一號但一樣寫名字。
 */
export function BadgePlate({ pin, main, note }: { pin: Pin; main?: boolean; note?: string }) {
  const def = ACH_BY_ID.get(pin.id)
  if (!def) return null
  const tier = def.tiers ? pin.tier : 0
  return (
    <span className={'plate' + (main ? ' main' : '') + (tier ? ' t' + tier : '')}>
      <Badge def={def} got tier={pin.tier} size={main ? 30 : 22} hue={hueOf(def)} />
      <b>{badgeLabel(def, tier)}</b>
      {note && <small>{note}</small>}
    </span>
  )
}

/** 名字旁邊別著的那三個，第一個是主徽章。排行榜和個人檔案都用這個。 */
export function PinnedBadges({ pins, mainNote }: { pins: Pin[]; mainNote?: string }) {
  const ok = pins.filter((p) => ACH_BY_ID.has(p.id))
  if (!ok.length) return null
  return (
    <span className="pins">
      {ok.map((p, i) => <BadgePlate key={p.id} pin={p} main={i === 0} note={i === 0 ? mainNote : undefined} />)}
    </span>
  )
}

/** 「全班 23 人裡有 4 人」。自己班才有意義，所以數字是後端按班算的。 */
export function rarityText(counts: BadgeCount[] | null, id: string, tier: number): string {
  const c = counts?.find((x) => x.id === id && x.tier === Math.max(tier, 1))
  if (!c || !c.classSize) return ''
  return c.holders <= 1 ? `全班只有 1 人` : `全班 ${c.holders} 人`
}

/** 這一格下一階要多少、現在多少。已經最高階就回 null。 */
function nextStep(def: AchDef, row: AchievementRow): { tier: number; goal: number; now: number } | null {
  if (!def.tiers) return null
  const next = row.tier + 1
  const goal = tierGoal(def, next, row.goalAll)
  if (goal === null) return null
  return { tier: next, goal, now: Math.min(row.value, goal) }
}

const fmtDate = (ms: number | null) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
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
  const [counts, setCounts] = useState<BadgeCount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string[]>(character.pinned ?? [])
  const [open, setOpen] = useState(character.publicProfile ?? true)
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // 進來先重算一次：打完那一場如果剛好結算失敗，這裡會把它補上
    void repo.refreshAchievements()
      .catch(() => [])
      .then(() => repo.loadAchievements())
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    // 稀有度拿不到就不顯示，不擋整頁
    void repo.classBadgeCounts().then((c) => { if (alive) setCounts(c) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const byId = new Map((rows ?? []).map((r) => [r.id, r]))
  const unlocked = new Set((rows ?? []).filter((r) => r.unlockedAt).map((r) => r.id))
  const frame = frameOf(character.equipped)
  const pins: Pin[] = pinned.filter((id) => unlocked.has(id))
    .map((id) => ({ id, tier: byId.get(id)?.tier ?? 1 }))
  const nearest = rows ? closestNext(rows) : null

  async function savePins(next: string[]) {
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

  const detailDef = detail ? ACH_BY_ID.get(detail) : undefined
  const detailRow = detail ? byId.get(detail) : undefined

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
            {pins.length
              ? <PinnedBadges pins={pins} />
              : <small className="muted">點下面的徽章，可以別在名字旁邊（最多三個）</small>}
          </div>
        </div>
      </div>

      {nearest && (
        <div className="nearest panel" role="button" tabIndex={0}
          onClick={() => setDetail(nearest.def.id)}
          onKeyDown={(e) => { if (e.key === 'Enter') setDetail(nearest.def.id) }}>
          <Badge def={nearest.def} got={nearest.row.tier > 0} tier={nearest.row.tier}
            size={36} hue={hueOf(nearest.def)} />
          <div>
            <b>再 {(nearest.goal - nearest.now).toLocaleString('en-US')} 就升{' '}
              {badgeLabel(nearest.def, nearest.tier)}</b>
            <div className="bar"><span style={{ width: pct(nearest.now, nearest.goal) }} /></div>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="lede">正在數你的徽章…</p>}

      {rows && CATEGORIES.map((cat) => (
        <CategoryBlock
          key={cat.key} cat={cat.key} hue={cat.hue} name={cat.name}
          byId={byId} pinned={pinned} onOpen={setDetail}
        />
      ))}

      {rows && (
        <div className="panel pubrow">
          <div>
            <b>讓同學從排行榜點進來看我的徽章</b>
            <small>關起來的話，同學只看得到排行榜上的名字和別著的徽章。老師一律看得到。</small>
          </div>
          <button className={'toggle' + (open ? ' on' : '')} onClick={() => void togglePublic()}
            aria-pressed={open}>
            <i />
          </button>
        </div>
      )}

      {detailDef && detailRow && (
        <BadgeSheet def={detailDef} row={detailRow} counts={counts}
          pinIndex={pinned.indexOf(detailDef.id)}
          onPin={(how) => {
            const id = detailDef.id
            const rest = pinned.filter((x) => x !== id)
            // 主徽章放第一個；副徽章滿了就換掉最後一個，主徽章不會被擠掉
            const next = how === 'off' ? rest
              : how === 'main' ? [id, ...rest].slice(0, 3)
                : rest.length >= 3 ? [...rest.slice(0, 2), id] : [...rest, id]
            void savePins(next)
          }}
          onClose={() => setDetail(null)} />
      )}
    </div>
  )
}

const pct = (a: number, b: number) => `${Math.round(Math.min(1, b ? a / b : 0) * 100)}%`

/** 離下一階最近的那一格（照比例），牆最上面那一條「再 12 題就升銀階」。 */
function closestNext(rows: AchievementRow[]) {
  let best: { def: AchDef; row: AchievementRow; tier: number; goal: number; now: number } | null = null
  for (const r of rows) {
    const def = ACH_BY_ID.get(r.id)
    if (!def?.tiers) continue
    const n = nextStep(def, r)
    if (!n || n.goal <= 0 || n.now <= 0) continue
    if (!best || n.now / n.goal > best.now / best.goal) best = { def, row: r, ...n }
  }
  return best
}

/** 點一個徽章跳出來的那一張：說明、哪天拿到、全班幾人有、下一階還差多少。 */
function BadgeSheet({
  def, row, counts, pinIndex, onPin, onClose,
}: {
  def: AchDef
  row: AchievementRow
  counts: BadgeCount[] | null
  pinIndex: number
  onPin: (how: 'main' | 'sub' | 'off') => void
  onClose: () => void
}) {
  const has = row.tier > 0
  const hidden = !has && def.secret
  const shownTier = def.tiers ? Math.max(row.tier, 1) : 1
  const goal = def.tiers ? tierGoal(def, shownTier, row.goalAll) : null
  const next = nextStep(def, row)
  const count = has ? counts?.find((x) => x.id === def.id && x.tier === row.tier) : undefined
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-top">
          <Badge def={def} got={has} tier={row.tier} size={76} hue={hueOf(def)} />
          <div>
            <b className="sheet-name">{hidden ? '？？？' : badgeLabel(def, has ? row.tier : 0)}</b>
            <p>{hidden ? '彩蛋。做到了就知道。' : has ? fillN(def.desc, goal) : fillN(def.hint ?? def.desc, goal)}</p>
            {has && <small>{fmtDate(row.tierAt ?? row.unlockedAt)} 拿到</small>}
            {count && count.classSize > 0 && (
              <small className="rare">
                全班 {count.classSize} 人裡{count.holders <= 1 ? '只有你' : `有 ${count.holders} 人`}拿到{def.tiers ? '這一階' : ''}
              </small>
            )}
          </div>
        </div>

        {def.tiers && (
          <div className="tierline">
            {def.tiers.map((_, i) => (
              <span key={i} className={'tdot t' + (i + 1) + (row.tier > i ? ' on' : '')}>
                {TIER_NAMES[i]}
                <small>{(tierGoal(def, i + 1, row.goalAll) ?? 0).toLocaleString('en-US')}</small>
              </span>
            ))}
          </div>
        )}
        {next && (
          <div className="sheet-next">
            <span>下一階 {TIER_NAMES[next.tier - 1]}：{next.now.toLocaleString('en-US')} / {next.goal.toLocaleString('en-US')}，還差 {(next.goal - next.now).toLocaleString('en-US')}</span>
            <div className="bar"><span style={{ width: pct(next.now, next.goal) }} /></div>
          </div>
        )}
        {def.tiers && has && !next && <p className="sheet-next">已經是最高階了。</p>}

        <div className="sheet-actions">
          {has && pinIndex !== 0 && <button className="btn small" onClick={() => onPin('main')}>設成主徽章</button>}
          {has && pinIndex < 0 && <button className="btn ghost small" onClick={() => onPin('sub')}>別在旁邊</button>}
          {has && pinIndex >= 0 && <button className="btn ghost small" onClick={() => onPin('off')}>拿下來</button>}
          <span className="spacer" />
          <button className="btn ghost small" onClick={onClose}>關掉</button>
        </div>
      </div>
    </div>
  )
}

function CategoryBlock({
  cat, hue, name, byId, pinned, onOpen,
}: {
  cat: AchCategory
  hue: string
  name: string
  byId: Map<string, AchievementRow>
  pinned: string[]
  onOpen: (id: string) => void
}) {
  const list = ACHIEVEMENTS.filter((a) => a.category === cat)
  const got = list.filter((a) => (byId.get(a.id)?.tier ?? 0) > 0).length
  return (
    <div className="achblock">
      <div className="achhead" style={{ ['--hue' as string]: hue }}>
        <i className="dot" />
        <b>{name}</b>
        <span className="n">{got} / {list.length}</span>
      </div>
      <div className="achgrid">
        {list.map((a) => {
          const row = byId.get(a.id)
          const tier = row?.tier ?? 0
          const has = tier > 0
          // 彩蛋沒拿到就連名字都不給——那是驚喜，不是清單上的待辦事項
          const label = has ? badgeLabel(a, tier) : a.secret ? '？？？' : a.name
          const next = row ? nextStep(a, row) : null
          const note = a.secret && !has ? '彩蛋'
            : next ? `${next.now.toLocaleString('en-US')} / ${next.goal.toLocaleString('en-US')}`
              : has ? (a.tiers ? '最高階' : fillN(a.desc, null)) : a.hint ?? ''
          return (
            <button key={a.id} className={'achcell' + (pinned.includes(a.id) ? ' pinned' : '')}
              onClick={() => onOpen(a.id)}>
              <Badge def={a} got={has} tier={tier} hue={hue} />
              <b>{label}</b>
              {next && <span className="minibar"><span style={{ width: pct(next.now, next.goal) }} /></span>}
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
  const tiers = p?.tiers ?? {}
  const frame = frameOf(p?.equipped ?? [])
  const pins: Pin[] = (p?.pinned ?? []).filter((id) => badges.has(id))
    .map((id) => ({ id, tier: tiers[id] ?? 1 }))

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
              <div className="pinrow"><PinnedBadges pins={pins} /></div>
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
                  const tier = has ? tiers[a.id] ?? 1 : 0
                  return (
                    <div key={a.id} className="achcell">
                      <Badge def={a} got={has} tier={tier} hue={cat.hue} />
                      <b>{has ? badgeLabel(a, tier) : a.secret ? '？？？' : a.name}</b>
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
