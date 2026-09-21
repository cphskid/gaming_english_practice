import { useState } from 'react'
import type { Character, Job, Student } from '@/core/types'
import { repo } from '@/net'
import { JOB_NAME } from '@/core/character'
import { AVATARS, JOB_BLURB, avatarSrc } from '@/data/jobs'
import { audio } from '@/audio'

/**
 * 學生自己的設定：改密碼、改暱稱、換班。
 *
 * 改密碼要先打對舊的，免得別人拿到一台沒鎖的平板就把密碼換掉。
 * 暱稱一週只能改一次，不然一定有人整節課都在改名字玩。
 *
 * 職業和頭像**隨時都能改，也不用錢**：職業不是買來的，十歲小孩選錯不該
 * 被綁一整個學期；而且兩個職業的通關門檻是量過的，改來改去也不會變強。
 */
export function Settings({
  student, character, onChanged, onCharacter, onBack, onLogout,
}: {
  student: Student
  character: Character
  onChanged: (s: Student) => void
  onCharacter: (c: Character) => void
  onBack: () => void
  onLogout: () => void
}) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [nickname, setNickname] = useState(student.nickname)
  const [code, setCode] = useState('')
  const [job, setJob] = useState<Job>(character.job)
  const [avatar, setAvatar] = useState(character.avatar || AVATARS[0])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 音樂開關記在這台裝置上，跟帳號無關——同一個孩子換一台就是另一個環境。
  const [music, setMusic] = useState(audio.isMusicOn)

  async function run(what: () => Promise<string>) {
    setBusy(true); setError(null); setNote(null)
    try {
      setNote(await what())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <div className="screen">
      <div className="topbar">
        <span className="who">{student.nickname}</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回遊戲</button>
        <button className="btn ghost small" onClick={onLogout}>登出</button>
      </div>

      <h1>我的設定</h1>
      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <div className="form panel">
        <h2>聲音</h2>
        <label className="switch">
          <input type="checkbox" checked={music}
            onChange={(e) => { setMusic(e.target.checked); audio.unlock(); audio.setMusicEnabled(e.target.checked) }} />
          <span>對戰時播放音樂</span>
        </label>
        <p className="hint">
          只有兵推對戰那三分鐘會有音樂，關卡裡不會。在教室裡覺得吵就關掉，答對答錯的音效不受影響。
        </p>
      </div>

      <div className="form panel">
        <h2>換職業、換長相</h2>
        <div className="jobs">
          {(['knight', 'mage'] as Job[]).map((j) => (
            <button key={j} type="button" className={'job' + (job === j ? ' on' : '')}
              onClick={() => setJob(j)}>
              <span className="job-name">{JOB_NAME[j]}</span>
              <span className="job-blurb">{JOB_BLURB[j]}</span>
            </button>
          ))}
        </div>
        <div className="avatars">
          {AVATARS.map((a) => (
            <button key={a} type="button" className={'av' + (avatar === a ? ' on' : '')}
              onClick={() => setAvatar(a)} aria-label={a}>
              <img src={avatarSrc(a)} alt="" />
            </button>
          ))}
        </div>
        <p className="lede left small">職業想改就改，不用錢，進度和金幣都不會動。</p>
        <button className="btn" type="button"
          disabled={busy || (job === character.job && avatar === character.avatar)}
          onClick={() => void run(async () => {
            if (job !== character.job) await repo.saveCharacter({ ...character, job })
            if (avatar !== character.avatar) await repo.setAvatar(avatar)
            onCharacter({ ...character, job, avatar })
            return '改好了，下一關就會用新的'
          })}>
          存起來
        </button>
      </div>

      <form className="form panel" onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          await repo.setPassword(oldPw, newPw)
          setOldPw(''); setNewPw('')
          return '密碼改好了，下次登入用新的'
        })
      }}>
        <h2>換密碼</h2>
        <div>
          <label htmlFor="op">現在的密碼</label>
          <input id="op" type="password" value={oldPw} autoComplete="current-password"
            onChange={(e) => setOldPw(e.target.value)} />
        </div>
        <div>
          <label htmlFor="np">新的密碼</label>
          <input id="np" type="password" value={newPw} autoComplete="new-password"
            onChange={(e) => setNewPw(e.target.value)} placeholder="6 個以上的英文或數字" />
        </div>
        <button className="btn" type="submit"
          disabled={busy || oldPw.length < 6 || newPw.length < 6}>換密碼</button>
      </form>

      <form className="form panel" onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          const next = await repo.setNickname(nickname)
          onChanged({ ...student, nickname: next })
          return '暱稱改成「' + next + '」了'
        })
      }}>
        <h2>換暱稱</h2>
        <div>
          <label htmlFor="nn">排行榜上顯示的名字</label>
          <input id="nn" value={nickname} maxLength={16}
            onChange={(e) => setNickname(e.target.value)} />
        </div>
        <p className="lede left small">一週只能改一次，而且同一班裡不能跟別人一樣。</p>
        <button className="btn" type="submit"
          disabled={busy || nickname.trim() === student.nickname || !nickname.trim()}>
          換暱稱
        </button>
      </form>

      <form className="form panel" onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          const next = await repo.joinClass(code)
          onChanged({ ...student, classCode: next })
          setCode('')
          return '加入 ' + next + ' 了，你的角色和進度都還在'
        })
      }}>
        <h2>換班級</h2>
        <div>
          <label htmlFor="cc">新的班級代碼</label>
          <input id="cc" value={code} maxLength={12}
            onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
            placeholder={student.classCode ?? '還沒加入任何班級'} />
        </div>
        <p className="lede left small">
          換班不會弄丟你的角色、金幣和進度，只是換一個排行榜比。
        </p>
        <button className="btn" type="submit" disabled={busy || code.trim().length < 3}>
          換班
        </button>
      </form>
    </div>
  )
}
