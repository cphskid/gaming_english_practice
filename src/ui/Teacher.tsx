import { useEffect, useState } from 'react'
import { LEVELS } from '@/data/levels'
import { WORDS_BY_ID } from '@/data/words'
import { WordStat } from '@/core/wordStat'
import { SKILL_NAME } from '@/core/types'
import { repo } from '@/net'

/**
 * 老師後台第一版。
 *
 * 「全班最常錯的字」對老師最有價值，而它只是把答題事件 group 一下就有了——
 * 這就是「事件是唯一真相來源」換來的東西：新報表是一句查詢，不用改資料結構。
 */
export function Teacher({
  classCode, teacherOpen, onToggleOpen, onBack,
}: {
  classCode: string
  teacherOpen: Set<string>
  onToggleOpen: (levelId: string) => void
  onBack: () => void
}) {
  const [stat, setStat] = useState<WordStat | null>(null)
  const [students, setStudents] = useState(0)
  const [answers, setAnswers] = useState(0)

  useEffect(() => {
    void repo.loadClassEvents(classCode).then((events) => {
      setStat(WordStat.from(events))
      setStudents(new Set(events.map((e) => e.studentId)).size)
      setAnswers(events.length)
    })
  }, [classCode])

  const missed = stat?.mostMissed(10) ?? []

  return (
    <div className="screen">
      <div className="topbar">
        <span className="who">老師後台</span>
        <span className="stat">{classCode}</span>
        <span className="spacer" />
        <button className="btn ghost" onClick={onBack}>回遊戲</button>
      </div>

      <div className="teacher">
        <div>
          <h2>全班最常錯的字</h2>
          <p className="lede" style={{ textAlign: 'left', maxWidth: 'none' }}>
            {students} 位同學，累計 {answers} 題。
          </p>
        </div>

        <div className="miss">
          {missed.length === 0 && <p className="lede">還沒有人答錯過，或是還沒有人玩。</p>}
          {missed.map((m) => {
            const w = WORDS_BY_ID.get(m.wordId)
            if (!w) return null
            return (
              <div className="m" key={`${m.wordId}:${m.skill}`}>
                <span className="w">{w.word}</span>
                <span className="zh">{w.emoji} {w.zh}　<small>{SKILL_NAME[m.skill]}</small></span>
                <span className="n">錯 {m.wrong} / {m.seen}</span>
              </div>
            )
          })}
        </div>

        <div>
          <h2>這禮拜開放的關卡</h2>
          <p className="lede" style={{ textAlign: 'left', maxWidth: 'none' }}>
            點一下就額外開放，不受學生自己的進度限制。
          </p>
        </div>
        <div className="open">
          {LEVELS.map((l) => (
            <button key={l.id} className={teacherOpen.has(l.id) ? 'on' : ''}
              onClick={() => onToggleOpen(l.id)}>
              {l.no}. {l.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
