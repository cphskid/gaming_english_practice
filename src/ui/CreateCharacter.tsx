import { useState } from 'react'
import { JOB_NAME } from '@/core/character'
import type { Character, Job } from '@/core/types'
import { AVATARS, JOB_BLURB, avatarSrc } from '@/data/jobs'

/**
 * 創角：選職業、選頭像。註冊完第一次進來會看到。
 *
 * 職業講的是「什麼時候好用」不是倍率——小朋友看不懂 ×1.35，
 * 但看得懂「魔王關好用」。兩個職業沒有強弱之分，只有場合之分。
 *
 * 職業之後可以在「我的設定」裡改。十歲小孩選錯不該被綁一整個學期，
 * 而且職業不是花錢買的，改了也不會弄壞經濟。
 */
export function CreateCharacter({
  character, onDone,
}: {
  character: Character
  onDone: (job: Job, avatar: string) => Promise<string | null>
}) {
  const [job, setJob] = useState<Job>(character.job)
  const [avatar, setAvatar] = useState<string>(AVATARS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    if (busy) return
    setBusy(true); setError(null)
    const msg = await onDone(job, avatar)
    setBusy(false)
    if (msg) setError(msg)
  }

  return (
    <div className="screen">
      <h1>捏一個角色</h1>
      <p className="lede">選好之後就可以出發了。之後想改都還改得回來。</p>
      {error && <p className="error">{error}</p>}

      <h2 className="sec">要當哪一種？</h2>
      <div className="jobs">
        {(['knight', 'mage'] as Job[]).map((j) => (
          <button key={j} className={'job' + (job === j ? ' on' : '')}
            onClick={() => setJob(j)}>
            <span className="job-name">{JOB_NAME[j]}</span>
            <span className="job-blurb">{JOB_BLURB[j]}</span>
          </button>
        ))}
      </div>
      <p className="lede left small">
        兩個沒有誰比較強，差在打法：騎士把力氣集中在一隻身上，法師把同樣的力氣散開。
      </p>

      <h2 className="sec">長什麼樣子？</h2>
      <div className="avatars">
        {AVATARS.map((a) => (
          <button key={a} className={'av' + (avatar === a ? ' on' : '')}
            onClick={() => setAvatar(a)} aria-label={a}>
            <img src={avatarSrc(a)} alt="" />
          </button>
        ))}
      </div>

      <button className="btn big" onClick={() => void go()} disabled={busy}>
        {busy ? '請稍等…' : '就是這個，出發！'}
      </button>
    </div>
  )
}
