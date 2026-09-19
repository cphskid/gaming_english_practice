import { useEffect, useRef, useState } from 'react'
import type { GameContext, GameHandle, GameModule, GameOutcome, LevelData, Question } from '@/core/types'
import type { Session } from '@/core/session'
import { audio } from '@/audio'

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
  game, level, session, studentId, nextQuestion, onFinish, onLeave,
}: {
  game: GameModule
  level: LevelData | null
  session: Session
  studentId: string
  nextQuestion: () => Question | null
  onFinish: (o: GameOutcome) => void
  onLeave: () => void
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
      nextQuestion: () => nextRef.current(),
      report: (r) => { session.report(studentId, { ...r, combo: session.comboOf(studentId) }) },
      audio,
      finish: (o) => { if (!done) { done = true; finishRef.current(o) } },
    }

    const handle = game.mount(el, ctx)
    handleRef.current = handle
    return () => { handleRef.current = null; handle.destroy() }
  }, [game, level, session, studentId])

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
