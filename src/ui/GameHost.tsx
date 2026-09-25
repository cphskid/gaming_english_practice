import { useEffect, useRef, useState } from 'react'
import type {
  GameContext, GameHandle, GameModule, GameOutcome, Job, LevelData, Opponent, Question, RaidLink, Skill,
} from '@/core/types'
import type { Session } from '@/core/session'
import { audio } from '@/audio'
import { ITEMS } from '@/data/shop'
import { bagFor } from '@/core/inventory'
import { Icon } from './Icon'
import type { IconName } from '@/data/icons'

/**
 * 把 GameModule 掛到畫面上。
 *
 * 這裡就是那條依賴界線：遊戲拿到的只有 ctx，它不知道 React、不知道 net、
 * 不知道自己在哪一個模式裡。換一個遊戲，這個元件一個字都不用改。
 *
 * **離開鍵放在這裡，不放在遊戲裡**——「離開」不是守塔的事，是容器的事，
 * 所以每一個新遊戲都自動有返回路徑，不用各寫一次。
 */
export function GameHost({
  game, level, session, studentId, job, color, legion, items, opponent, raid,
  nextQuestion, onFinish, onLeave, onUseItem,
}: {
  game: GameModule
  level: LevelData | null
  /** 對戰模式的對手。單人遊戲不用給。 */
  opponent?: Opponent | null
  /** 魔王團戰才有 */
  raid?: RaidLink
  session: Session
  studentId: string
  job: Job
  /** 陣營顏色的美術後綴，由身上穿的裝飾品決定 */
  color: string
  /** 身上那一套軍團的品項 id，王國軍是空字串 */
  legion: string
  /** 背包裡的東西，key 是 item id。道具列就是從這裡長出來的。 */
  items: Record<string, number>
  nextQuestion: (skill?: Skill) => Question | null
  onFinish: (o: GameOutcome) => void
  onLeave: () => void
  /** 遊戲說這個道具真的用掉了，容器才把它從背包扣掉 */
  onUseItem: (itemId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const handleRef = useRef<GameHandle | null>(null)
  const [asking, setAsking] = useState(false)

  // 用 ref 保存，避免 onFinish 換了身分就把遊戲重新掛載一次
  const finishRef = useRef(onFinish)
  finishRef.current = onFinish
  const nextRef = useRef(nextQuestion)
  nextRef.current = nextQuestion

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let done = false

    const ctx: GameContext = {
      level,
      job,
      color,
      legion,
      opponent: opponent ?? null,
      raid,
      nextQuestion: (skill) => nextRef.current(skill),
      report: (r) => { session.report(studentId, { ...r, combo: session.comboOf(studentId) }) },
      audio,
      finish: (o) => { if (!done) { done = true; finishRef.current(o) } },
    }

    const handle = game.mount(el, ctx)
    handleRef.current = handle
    return () => { handleRef.current = null; handle.destroy() }
  }, [game, level, session, studentId, job, color, legion, opponent, raid])

  /**
   * 道具列放在容器，不放在遊戲裡——跟離開鍵同一個道理：
   * 「我有什麼道具」是角色的事，不是守塔的事，換一個遊戲也該有這一排。
   * 遊戲只回答「這個效果現在做得出來嗎」，做不出來就不扣。
   *
   * **只列這個遊戲做得出效果的道具**（ItemDef.modes）。本來是有就列，
   * 於是兵推也長出三顆按鈕，但兵推根本沒實作 useItem——按下去完全沒反應，
   * 沒訊息也不扣道具。列不出來比列出來但沒用好。
   */
  const bag = bagFor(items, ITEMS, game.id)

  function use(id: string) {
    audio.play('ui-tap')
    if (handleRef.current?.useItem?.(id)) onUseItem(id)
  }

  function ask(on: boolean) {
    setAsking(on)
    handleRef.current?.setPaused?.(on)
    audio.play('ui-tap')
  }

  return (
    <div className="play">
      <div className="leavebar">
        <button className="leave" onClick={() => ask(true)}>← 離開</button>
        {level && <span className="leavebar-name">第 {level.no} 關・{level.name}</span>}
        {bag.length > 0 && (
          <span className="bagbar">
            {bag.map((it) => (
              <button key={it.id} className="bagitem" onClick={() => use(it.id)}
                title={it.name + '：' + it.desc}>
                <span className="ic"><Icon name={it.icon as IconName} size={16} /></span>
                <span className="nm">{it.name}</span>
                <b>×{items[it.id]}</b>
              </button>
            ))}
          </span>
        )}
      </div>

      <div ref={ref} style={{ display: 'contents' }} />

      {asking && (
        <div className="confirm" role="dialog" aria-modal="true">
          <div className="confirm-box panel">
            <h2>要離開這一關嗎？</h2>
            <p>這一場不算通關，也不會拿到星星。<br />但已經答對的題目和金幣都會留著。</p>
            <div className="confirm-btns">
              <button className="btn ghost" onClick={() => ask(false)}>繼續玩</button>
              <button className="btn" onClick={onLeave}>離開</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
