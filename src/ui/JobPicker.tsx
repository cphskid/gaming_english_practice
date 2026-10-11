import type { Job } from '@/core/types'
import { JOB_NAME } from '@/core/character'
import { JOB_BLURB } from '@/data/jobs'
import HERO_ART from '@/data/hero-art-park.json'
import { BADGE_ICONS } from './icons'

/**
 * 選職業的兩張大卡：職業圖示、會動的英雄、一句「什麼時候好用」。
 * 創角和「我的角色」共用（2026-09-25 從「我的設定」搬出來——
 * 放在設定裡，Chuck 的女兒根本沒發現可以換）。
 */

const JOBS: Job[] = ['knight', 'mage']
/** 騎士藍、法師紫，跟職業圖示的底色一樣 */
export const JOB_TINT: Record<Job, string> = { knight: '#3a6fb8', mage: '#7a4ab0' }

/** 職業圖示：game-icons 的頭盔／法師帽，白色剪影放在職業色的底板上。 */
export function JobIcon({ job, size = 28 }: { job: Job; size?: number }) {
  const paths = BADGE_ICONS['job-' + job] ?? []
  return (
    <span className="job-icon" style={{ width: size, height: size, background: JOB_TINT[job] }}
      aria-label={JOB_NAME[job]}>
      <svg viewBox="0 0 512 512" aria-hidden="true">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    </span>
  )
}

interface Meta { w: number; h: number; foot: number; cx: number; body: number; anims: Record<string, number> }

/**
 * 職業卡上的英雄：提案二手繪那一張站姿（public/td-park/heroes/<job>/idle.webp，2026-10-11 換掉像素版），
 * 用 CSS 輕輕上下呼吸。
 */
export function HeroIdle({ job, height = 64 }: { job: Job; height?: number }) {
  const m = (HERO_ART as Record<Job, Meta>)[job]
  const sc = height / m.body
  const w = Math.round(m.w * sc), h = Math.round(m.h * sc)
  return (
    <span className="hero-idle park" style={{
      width: w, height: h,
      backgroundImage: `url(${import.meta.env.BASE_URL}td-park/heroes/${job}/idle.webp)`,
      backgroundSize: `${w}px ${h}px`,
      // 方框比身體大（攻擊的刀光也算在裡面），挪一下讓身體在正中間
      ['--dx' as string]: `${Math.round(w / 2 - m.cx * sc)}px`,
      marginBottom: Math.round((m.foot - m.h) * sc),
    }} />
  )
}

export function JobPicker({ job, onPick, disabled }: {
  job: Job
  onPick: (j: Job) => void
  disabled?: boolean
}) {
  return (
    <div className="jobs">
      {JOBS.map((j) => (
        <button key={j} type="button" className={'job' + (job === j ? ' on' : '')}
          disabled={disabled} onClick={() => onPick(j)}>
          <span className="job-top">
            <JobIcon job={j} size={30} />
            <span className="job-name">{JOB_NAME[j]}</span>
          </span>
          <span className="job-stage"><HeroIdle job={j} height={70} /></span>
          <span className="job-blurb">{JOB_BLURB[j]}</span>
        </button>
      ))}
    </div>
  )
}
