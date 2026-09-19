import { useEffect, useRef } from 'react'
import type { GameContext, GameModule, GameOutcome, LevelData, Question } from '@/core/types'
import type { Session } from '@/core/session'
import { audio } from '@/audio'

/**
 * 把 GameModule 掛到畫面上。
 *
 * 這裡就是那條依賴界線：遊戲拿到的只有 ctx，它不知道 React、不知道 net、
 * 不知道自己在哪一個模式裡。換一個遊戲，這個元件一個字都不用改。
 */
export function GameHost({
  game, level, session, studentId, nextQuestion, onFinish,
}: {
  game: GameModule
  level: LevelData | null
  session: Session
  studentId: string
  nextQuestion: () => Question | null
  onFinish: (o: GameOutcome) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
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
    return () => handle.destroy()
  }, [game, level, session, studentId])

  return (
    <div className="play">
      <div ref={ref} style={{ display: 'contents' }} />
    </div>
  )
}
