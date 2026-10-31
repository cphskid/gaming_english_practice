import { useEffect, useState } from 'react'
import { prefetchMap } from '@/games/tower-defense/park'
import { CHAPTERS, LEVELS } from '@/data/levels'
import { THEME_NAME } from '@/data/words'
import { chapterCleared, expIntoLevel, isUnlocked, levelFromExp } from '@/core/progress'
import type { Character, LevelData, LevelProgress, Student } from '@/core/types'
import { JOB_NAME } from '@/core/character'
import type { RoomBrief } from '@/net'
import { BOSS_BY_ID } from '@/data/bosses'
import { BossFace } from './Room'
import { Avatar } from './Avatar'
import WORLD from '@/data/world-stops.json'
import { PARK_URL } from '@/net'
import { ui } from './park-ui'
import { CHAPTER_STORY, newcomers } from '@/data/story'
import { BOSS_SKILL_NAME } from '@/data/enemies'

/**
 * 選關大地圖（2026-10-10 改版，Kingdom Rush 那種戰役地圖）。
 *
 * 一章一張畫好的地圖（public/td-park/world/ch<章>.webp），路上的 14 個點跟產圖用的是同一份座標
 * （src/data/world-stops.json，產圖腳本 art/guardian/world_guide.py）。第一章剛好 14 關就一關一點；
 * 二、三章三十幾關，就沿著同一條路平均撒開——路是同一條曲線，所以撒在哪裡都還是在路上。
 *
 * 點旗子不會直接開打，先跳一張關卡卡片、按「出發！」才進去：小旗子在手機上很小，
 * 一點就開打很容易點錯關（跟蓋塔要點兩下同一個道理）。
 * 上面那排七顆鈕收成右下角三顆大鈕（英雄營、對戰、魔王團戰）；排行榜、徽章、商店、設定
 * 之後要交給樂園，改版期間先縮成右上角的小字鈕。
 *
 * 手機（2026-10-25，Chuck 選 A＋商店/排行/徽章另外收）：地圖鋪滿，上面只剩一排
 * （🏠、齒輪、一顆章節切換、名牌＋時光幣），底部一條木頭列放三顆大鈕＋「更多」，
 * 商店/排行/徽章收在「更多」裡；露米的故事看過就縮成左下角頭像。只靠 CSS 切，電腦版不變。
 */
type Pt = { x: number; y: number }

const STOPS: Pt[] = WORLD.stops.map(([x, y]) => ({ x, y }))
const CASTLE: Pt = { x: WORLD.castle[0], y: WORLD.castle[1] }

/** 跟 world_guide.py 一樣的 Catmull-Rom，地圖上的路就是照這條畫的 */
function curve(pts: Pt[], n = 24): Pt[] {
  const P = [pts[0], ...pts, pts[pts.length - 1]]
  const out: Pt[] = []
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]]
    for (let k = 0; k < n; k++) {
      const t = k / n
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** n 個關卡點：剛好 14 個就用畫好的空地；多的話沿著第一點到最後一點的路，照長度平均撒 */
function stopsFor(n: number): Pt[] {
  if (n === STOPS.length) return STOPS
  // 長寬比 16:9，量長度要用畫面上的距離
  const line = curve(STOPS)
  const d = [0]
  for (let i = 1; i < line.length; i++) d.push(d[i - 1] + Math.hypot((line[i].x - line[i - 1].x) * 16, (line[i].y - line[i - 1].y) * 9))
  const L = d[d.length - 1]
  return Array.from({ length: n }, (_, k) => {
    const want = (L * k) / Math.max(1, n - 1)
    let i = d.findIndex((v) => v >= want)
    if (i <= 0) return line[0]
    const t = (want - d[i - 1]) / (d[i] - d[i - 1] || 1)
    return { x: line[i - 1].x + (line[i].x - line[i - 1].x) * t, y: line[i - 1].y + (line[i].y - line[i - 1].y) * t }
  })
}

const base = import.meta.env.BASE_URL
const pic = (k: string) => `${base}td-park/p-${k}.webp`.replace(/([^:])\/{2,}/g, '$1/')

export function LevelSelect({
  student, character, progress, teacherOpen, rooms,
  onPlay, onRoom, onRooms, onVersus, onSettings, onShop, onCharacter, onBoard, onProfile,
}: {
  student: Student
  character: Character
  progress: Map<string, LevelProgress>
  teacherOpen: Set<string>
  /** 班上現在開著的場次。老師開的排在最前面。 */
  rooms: RoomBrief[]
  onPlay: (level: LevelData) => void
  /** 按選關畫面那一條：直接進去，或是去「一起玩」那一頁挑 */
  onRoom: () => void
  /** 上面那排的「一起玩」：現在開著哪幾場、我要開一場 */
  onRooms: () => void
  onSettings: () => void
  onShop: () => void
  onCharacter: () => void
  onBoard: () => void
  onVersus: () => void
  /** 我的徽章牆 */
  onProfile: () => void
}) {
  const cleared = new Set([...progress.values()].filter((p) => p.clearedAt).map((p) => p.levelId))
  const lv = levelFromExp(character.exp)
  const { into, need } = expIntoLevel(character.exp)
  // 預設攤開「正在打的那一章」：已經打開、而且還沒全破的最後一章；三章都破了就攤開第三章。
  const [openCh, setOpenCh] = useState<number>(() => {
    const live = CHAPTERS.filter((c) => c.no === 1 || chapterCleared(c.no - 1, LEVELS, cleared))
    const cur = live.find((c) => !chapterCleared(c.no, LEVELS, cleared)) ?? live[live.length - 1]
    return cur?.no ?? 1
  })
  const [card, setCard] = useState<LevelData | null>(null)
  /** 手機底部列的「更多」（商店、排行、徽章） */
  const [more, setMore] = useState(false)

  const ch = CHAPTERS.find((c) => c.no === openCh) ?? CHAPTERS[0]
  const ci = ch.no - 1
  const open = ch.no === 1 || chapterCleared(ch.no - 1, LEVELS, cleared)
  const byTeacher = open ? 0 : ch.levels.filter((l) => teacherOpen.has(l.id)).length
  const stars = ch.levels.reduce((n, l) => n + (progress.get(l.id)?.stars ?? 0), 0)
  const pts = stopsFor(ch.levels.length)
  const unlockedOf = (l: LevelData) => isUnlocked(l.no, LEVELS, { cleared, teacherOpen })
  // 「現在該打這一關」：打得到、還沒過的第一關，旗子會跳、會發光
  const next = ch.levels.find((l) => unlockedOf(l) && !cleared.has(l.id))
  const dense = ch.levels.length > 20
  // 選關畫面閒著的時候先把「該打的那一關」的地圖抓好；點開卡片時再補抓那一關的
  useEffect(() => { if (next) prefetchMap(next) }, [next])
  useEffect(() => { if (card) prefetchMap(card) }, [card])

  // 露米的章節故事：手機上每段只自動攤開一次，看完縮成頭像，想再看點頭像（電腦版一直攤開）
  const chDone = chapterCleared(ch.no, LEVELS, cleared)
  const storyKey = `td-wm-story:${ch.no}:${chDone ? 'done' : 'now'}`
  const [storyOpen, setStoryOpen] = useState(false)
  useEffect(() => {
    let seen = false
    try { seen = localStorage.getItem(storyKey) === '1' } catch { /* 私密模式讀不到就當沒看過 */ }
    setStoryOpen(!seen)
  }, [storyKey])
  const closeStory = () => {
    setStoryOpen(false)
    try { localStorage.setItem(storyKey, '1') } catch { /* 存不了就下次再跳一次 */ }
  }
  const goCh = (d: number) => {
    const n = ch.no + d
    if (n < 1 || n > CHAPTERS.length) return
    setOpenCh(n); setCard(null)
  }

  return (
    <div className="screen wm">
      {/* 上面那一條照樂園的排法：左邊齒輪（設定）、名牌＋時光幣，右邊一條木頭功能列 */}
      <div className="wm-top">
        {/* 回樂園用樂園共用的按鈕（樂園 css/park-back.css）：左上第一顆、手機也有字，回到樂園地圖上的守護異世界（#map/castle） */}
        {PARK_URL && character.time && <link rel="stylesheet" href={PARK_URL + 'css/park-back.css'} />}
        {PARK_URL && character.time && (
          <a className="park-back" href={PARK_URL + '#map/castle'}>
            <img src={PARK_URL + 'img/admin/park.webp'} alt="" />回樂園
          </a>
        )}
        <button className="pk-gear" onClick={onSettings} aria-label="設定"><img src={ui('gear')} alt="" /></button>
        <div className="pk-me">
          <Avatar character={character} size={40} />
          <div className="wm-who">
            <b>{student.nickname}</b>
            <span data-lv={`Lv.${lv}`}>{JOB_NAME[character.job]}　Lv.{lv}</span>
            <i className="wm-exp"><i style={{ width: `${Math.round((into / Math.max(1, need)) * 100)}%` }} /></i>
          </div>
        </div>
        {/* 點時光幣直接去商店：手機上商店收進「更多」，想買東西的人還是一下就到 */}
        <button className="wm-coin pk-coin" onClick={onShop} aria-label={`時光幣 ${character.coins}，去商店`}>
          <img src={pic('coin')} alt="" />{character.coins}
        </button>
        <span className="spacer" />
        {/* 手機才有：三個章節頁籤合成一顆，左右切章，星星也併進來 */}
        <div className={'wm-chsw' + (open ? '' : ' locked')}>
          <button onClick={() => goCh(-1)} disabled={ch.no === 1} aria-label="上一章">‹</button>
          <span className="wm-chsw-nm">{ch.name}</span>
          {open
            ? <span className="wm-chsw-st">{ch.levels.filter((l) => cleared.has(l.id)).length}/{ch.levels.length}
              <img src={pic('star')} alt="星星" />{stars}</span>
            : <img className="wm-chsw-lock" src={pic('lock')} alt="未開放" />}
          <button onClick={() => goCh(1)} disabled={ch.no === CHAPTERS.length} aria-label="下一章">›</button>
        </div>
        <nav className="wm-mini pk-dock">
          <button onClick={onShop}><img src={ui('shop')} alt="" /><b>商店</b></button>
          <button onClick={onBoard}><img src={ui('rank')} alt="" /><b>排行榜</b></button>
          <button onClick={onProfile}><img src={ui('passport')} alt="" /><b>徽章</b></button>
        </nav>
      </div>

      {rooms.length > 0 && <RoomBanner rooms={rooms} onRoom={onRoom} />}

      <div className="wm-tabs" role="tablist">
        {CHAPTERS.map((c, i) => {
          const o = c.no === 1 || chapterCleared(c.no - 1, LEVELS, cleared)
          const done = c.levels.filter((l) => cleared.has(l.id)).length
          return (
            <button key={c.no} className={'chhead wm-tab' + (c.no === openCh ? ' on' : '') + (o ? '' : ' locked')}
              aria-expanded={c.no === openCh} onClick={() => { setOpenCh(c.no); setCard(null) }}>
              <span className="chno">第{'一二三'[i]}章</span>
              <span className="chnm">{c.name}</span>
              <span className="chst">{o ? `${done}/${c.levels.length}` : <img src={pic('lock')} alt="未開放" />}</span>
            </button>
          )
        })}
      </div>

      <div className="wm-scroll">
        <div className={'levels wm-map' + (dense ? ' dense' : '')}
          style={{ backgroundImage: `url(${base}td-park/world/ch${ch.no}.webp)`.replace(/([^:])\/{2,}/g, '$1/') }}
          onClick={() => setCard(null)}>
          <div className="wm-stars-total"><img src={pic('star')} alt="" /> {stars} / {ch.levels.length * 3}</div>
          {/* 這一章的故事（data/story.ts）：還在打寫現況，全破了寫結局 */}
          {open && (
            <div className={'wm-story' + (storyOpen ? ' open' : '')} onClick={(ev) => { ev.stopPropagation(); closeStory() }}>
              <img src={pic('face-lumi')} alt="露米" />
              {chDone ? CHAPTER_STORY[ch.no].done : CHAPTER_STORY[ch.no].now}
            </div>
          )}
          <img className="wm-castle" src={pic('castle')} alt=""
            style={{ left: `${CASTLE.x * 100}%`, top: `${CASTLE.y * 100}%` }} />
          {ch.levels.map((l, k) => {
            const p = progress.get(l.id)
            const unlocked = unlockedOf(l)
            const st = p?.stars ?? 0
            const done = cleared.has(l.id)
            const icon = l.isBoss ? 'stop-boss' : done ? 'stop-flag' : 'stop'
            return (
              <button key={l.id}
                className={'lv wm-stop' + (l.isBoss ? ' boss' : '') + (done ? ' done' : '') + (l === next ? ' next' : '') + (card === l ? ' sel' : '')}
                style={{ left: `${pts[k].x * 100}%`, top: `${pts[k].y * 100}%` }}
                disabled={!unlocked}
                onClick={(ev) => { ev.stopPropagation(); setCard(l) }}>
                <img className="wm-base" src={pic(icon)} alt="" />
                <span className="wm-no">{l.no}</span>
                <span className="sr">第 {l.no} 關</span>
                {done && <span className="wm-stars">{[0, 1, 2].map((i) => <img key={i} src={pic('star')} alt="" className={i < st ? '' : 'off'} />)}</span>}
                {!unlocked && <img className="wm-lock" src={pic('lock')} alt="未開放" />}
                {/* 還沒搶回來的站有敵人佔著（暫代圖示，美術解凍後換手繪小兵） */}
                {!done && <img className="wm-foe" src={pic('face-boss' + ch.no)} alt="" aria-hidden />}
                {unlocked && !open && teacherOpen.has(l.id) && <span className="byteacher">老師開放</span>}
                {l === next && <span className="wm-here">▼</span>}
              </button>
            )
          })}

          {!open && (
            <div className="chlock wm-locknote">
              <img src={pic('lock')} alt="" />
              把第{'一二三'[ci - 1]}章的 {CHAPTERS[ci - 1].levels.length} 關全部打過，就會打開這一章
              （還差 {CHAPTERS[ci - 1].levels.filter((l) => !cleared.has(l.id)).length} 關）
              {byTeacher > 0 && `。老師先開放了 ${byTeacher} 關`}
            </div>
          )}

          {card && (
            <div className="wm-card" onClick={(ev) => ev.stopPropagation()}
              style={{
                left: `${Math.min(78, Math.max(22, pts[ch.levels.indexOf(card)].x * 100))}%`,
                top: `${pts[ch.levels.indexOf(card)].y * 100}%`,
              }}
              data-below={pts[ch.levels.indexOf(card)].y < 0.45 ? '1' : '0'}>
              <button className="wm-x" onClick={() => setCard(null)} aria-label="關閉">×</button>
              <div className="wm-cno">第 {card.no} 關{card.isBoss ? '・魔王' : ''}</div>
              <div className="wm-cnm">{card.name}</div>
              <div className="wm-cth">
                {card.themes.length ? card.themes.slice(0, 3).map((t) => THEME_NAME[t] ?? t).join('、') : '全部主題'}
              </div>
              {newcomers(card).length > 0 && (
                <div className="wm-new">新登場：{newcomers(card).map((n) => `${n.badge} ${n.name}`).join('、')}</div>
              )}
              {card.isBoss && (card.rules.boss?.skills?.length ?? 0) > 0 && (
                <div className="wm-new boss">魔王招式：{card.rules.boss!.skills!.map((k) => BOSS_SKILL_NAME[k]).join('、')}</div>
              )}
              <div className="wm-cst">
                {[0, 1, 2].map((i) => <img key={i} src={pic('star')} alt="" className={i < (progress.get(card.id)?.stars ?? 0) ? '' : 'off'} />)}
              </div>
              <button className="btn lvgo" onClick={() => onPlay(card)}>出發！</button>
            </div>
          )}
        </div>
      </div>

      {/* 手機：故事收起來時左下角只留露米頭像 */}
      {open && !storyOpen && (
        <button className="wm-lumi" onClick={() => setStoryOpen(true)} aria-label="看露米說的故事">
          <img src={pic('face-lumi')} alt="" />
        </button>
      )}

      <nav className="wm-big">
        <button onClick={onCharacter}><img src={pic('btn-hero')} alt="" /><b>英雄營</b></button>
        <button onClick={onVersus}><img src={pic('btn-vs')} alt="" /><b>對戰</b></button>
        <button onClick={onRooms}><img src={pic('btn-raid')} alt="" /><b>魔王團戰</b></button>
        {/* 手機才有：商店、排行、徽章收在這裡 */}
        <button className={'wm-more' + (more ? ' on' : '')} onClick={() => setMore((m) => !m)}
          aria-expanded={more} aria-label="更多">
          <i aria-hidden>⋯</i><b>更多</b>
        </button>
        {more && (
          <div className="wm-morepop" role="menu">
            <button role="menuitem" onClick={() => { setMore(false); onShop() }}><img src={ui('shop')} alt="" /><b>商店</b></button>
            <button role="menuitem" onClick={() => { setMore(false); onBoard() }}><img src={ui('rank')} alt="" /><b>排行榜</b></button>
            <button role="menuitem" onClick={() => { setMore(false); onProfile() }}><img src={ui('passport')} alt="" /><b>徽章</b></button>
          </div>
        )}
      </nav>
    </div>
  )
}

/**
 * 「有人開了一場魔王團戰」。
 *
 * 這一條就是整個房間的入口——沒有代碼要抄、沒有東西要記，小朋友只要看到
 * 這一條、按一下就進去了。所以它放在選關畫面最上面、最顯眼的地方。
 *
 * 有好幾場時只寫最前面那一場（老師的優先），其餘用「還有 N 場」帶過——
 * 選關畫面不該被一串房間淹掉，要挑就進「魔王團戰」那一頁挑。
 * 私人房（🔒）按下去是帶到那一頁打密碼。
 */
function RoomBanner({ rooms, onRoom }: { rooms: RoomBrief[]; onRoom: () => void }) {
  const top = rooms.find((r) => r.mine) ?? rooms[0]
  const boss = BOSS_BY_ID.get(top.bossId)
  const who = top.byTeacher ? '老師' : (top.hostName || '同學')
  const what = top.mine
    ? (top.status === 'playing' ? '這一場開打了' : '你已經在這一場裡了')
    : `${who}開了魔王團戰，一起打！`
  const more = rooms.length - 1
  return (
    <button className="roomcall" onClick={onRoom}>
      <span className="ico">{boss ? <BossFace b={boss} size={38} /> : '👹'}</span>
      <span className="txt">
        <b>{what}</b>
        <small>
          {top.locked && '🔒 '}{boss?.name ?? ''}　{top.members} 人
          {more > 0 && `　・還有 ${more} 場`}
        </small>
      </span>
      <span className="go">{top.mine ? '進去' : '加入'}</span>
    </button>
  )
}
