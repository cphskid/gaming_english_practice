import { useCallback, useEffect, useState } from 'react'
import type { AdminClassRow, TeacherRow } from '@/core/types'
import { repo } from '@/net'
import type { FeedbackRow, FeedbackStatus } from '@/net/repository'

/**
 * 管理員後台。管的是開班帳號（老師或家長）與班級，不是學生。
 *
 * 老師和家長可以自己註冊，不用經過管理員（見 register_teacher）；
 * 管理員這裡看得到誰新註冊、開了幾班，看起來不對就停用，也能調個別帳號的上限。
 * 「幫人開帳號」還留著，給不方便自己註冊的老師用。
 */
const WEEK = 7 * 24 * 3600 * 1000

/** 自己註冊、而且是最近 7 天的帳號：管理員要看一眼的那些。 */
function isFresh(t: TeacherRow): boolean {
  return !!t.selfSignup && !!t.createdAt && Date.now() - Date.parse(t.createdAt) < WEEK
}

export function Admin({ onBack }: { onBack: () => void }) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [invites, setInvites] = useState<{ email: string; used: boolean }[]>([])
  const [classes, setClasses] = useState<AdminClassRow[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [t, i, c] = await Promise.all([
      repo.listTeachers(), repo.listInvites(), repo.listAllClasses(),
    ])
    setTeachers(t)
    setInvites(i)
    setClasses(c)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const run = useCallback(async (what: () => Promise<string | void>) => {
    setError(null); setNote(null)
    try {
      const msg = await what()
      if (typeof msg === 'string') setNote(msg)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [refresh])

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  // 老師手上是整個班的資料，密碼要求比學生高
  const formOk = emailOk && password.length >= 8 && name.trim().length > 0
  // 停用中的老師不能接班——接了等於這個班沒人帶，畫面上卻看起來正常。
  const active = teachers.filter((t) => t.active)
  const fresh = teachers.filter(isFresh).length

  return (
    <div className="screen wide">
      <div className="topbar">
        <span className="who">管理員</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回老師後台</button>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <div className="teacher">
        <FeedbackInbox />

        <NicknameGuard />

        <div>
          <h2>幫人開帳號</h2>
          <p className="lede left">
            老師和家長現在可以自己在「我是老師／家長」註冊，通常不用你開。
            真的要幫人開的話，帳號直接開好，把 email 和密碼給他就能登入，不用等確認信。
            他如果已經自己註冊過（卡在進不去），這裡填一樣的 email 就會把他設成老師，
            密碼還是他自己原本那組。
          </p>
        </div>
        <form className="row" onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            const added = await repo.createTeacher(email, password, name)
            setEmail(''); setPassword(''); setName('')
            return added.created
              ? `${added.email} 的帳號開好了，把 email 和密碼給他`
              : `${added.email} 本來就有帳號，已經設成老師了，請他用原本的密碼登入`
          })
        }}>
          <input value={name} placeholder="他的名字（例如 王老師）"
            onChange={(e) => setName(e.target.value)} />
          <input type="email" value={email} placeholder="teacher@school.edu.tw"
            onChange={(e) => setEmail(e.target.value)} />
          <input value={password} placeholder="密碼，至少 8 個字"
            onChange={(e) => setPassword(e.target.value)} />
          <button className="btn small" type="submit" disabled={!formOk}>開帳號</button>
        </form>

        <div>
          <h2>開班帳號（{teachers.length}）{fresh > 0 && `　${fresh} 個新的`}</h2>
          <p className="lede left">
            老師和家長自己註冊的，最近 7 天內會標「新」。看起來不對（例如小朋友自己開的）就按停用，
            停用之後開不了班也看不到班上資料。一般帳號最多 3 個班、每班 40 人，按「上限」可以調。
          </p>
        </div>
        <div className="roster">
          {teachers.map((t) => (
            <div className="r" key={t.userId}>
              <span className="n">
                {t.displayName}
                {isFresh(t) && <span className="tag-new">新</span>}
                {t.isAdmin && <small>　管理員</small>}
                {t.email && <small className="email">{t.email}</small>}
              </span>
              <span className="s">
                {t.classes} 個班 ・ {t.students} 位同學 ・ {t.active ? '啟用中' : '已停用'}
                {!t.isAdmin && t.maxClasses !== undefined &&
                  ` ・ 上限 ${t.maxClasses} 班／每班 ${t.maxStudents} 人`}
              </span>
              {!t.isAdmin && (
                <span className="row">
                  <button className="btn ghost small" onClick={() => {
                    const ans = window.prompt(
                      `${t.displayName} 的上限，格式「班數/每班人數」`,
                      `${t.maxClasses ?? 3}/${t.maxStudents ?? 40}`)
                    const m = ans?.match(/^\s*(\d+)\s*[\/／]\s*(\d+)\s*$/)
                    if (!ans) return
                    if (!m) { setError('格式要像 3/40：前面是班數，後面是每班人數'); return }
                    void run(async () => {
                      await repo.setTeacherLimits(t.userId, Number(m[1]), Number(m[2]))
                      return `${t.displayName} 改成最多 ${m[1]} 個班、每班 ${m[2]} 人`
                    })
                  }}>上限</button>
                  <button className="btn ghost small" onClick={() => void run(async () => {
                    await repo.setTeacherActive(t.userId, !t.active)
                    return t.active ? `${t.displayName} 已停用` : `${t.displayName} 已恢復`
                  })}>
                    {t.active ? '停用' : '恢復'}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>

        <div>
          <h2>全部班級（{classes.length}）</h2>
          <p className="lede left">
            換老師只是換帶這一班的人。班級代碼、學生、進度都不動，沒有人會掉出去。
          </p>
        </div>
        <div className="roster">
          {classes.length === 0 && <p className="lede">還沒有人開班。</p>}
          {classes.map((c) => (
            <div className="r" key={c.code}>
              <span className="n">
                {c.name || '（沒有名字）'}<small>　{c.code}</small>
              </span>
              <span className="s">
                {/* 手機上這一行會折行，全形空白折起來會黏成一團，所以用點分隔 */}
                {c.ownerName}{!c.ownerActive && '（已停用）'}
                {' ・ '}{c.students} 位同學
                {' ・ '}{c.open ? '開放加入' : '不開放'}
              </span>
              <select value={c.ownerId} disabled={active.length < 2}
                onChange={(e) => {
                  const to = teachers.find((t) => t.userId === e.target.value)
                  if (!to || to.userId === c.ownerId) return
                  void run(async () => {
                    await repo.setClassOwner(c.code, to.userId)
                    return `${c.name || c.code} 交給 ${to.displayName} 了`
                  })
                }}>
                {active.map((t) => (
                  <option key={t.userId} value={t.userId}>{t.displayName}</option>
                ))}
                {!active.some((t) => t.userId === c.ownerId) && (
                  <option value={c.ownerId}>{c.ownerName}</option>
                )}
              </select>
            </div>
          ))}
        </div>

        <div>
          <h2>名單上還沒註冊的</h2>
          <p className="lede left">
            以前加進名單、還沒自己去註冊的人。他們現在直接在「我是老師／家長」註冊就好，
            不會收到確認信。
          </p>
        </div>
        <div className="roster">
          {invites.filter((i) => !i.used).length === 0 && (
            <p className="lede">沒有人卡在名單上。</p>
          )}
          {invites.filter((i) => !i.used).map((i) => (
            <div className="r" key={i.email}>
              <span className="n">{i.email}</span>
              <span className="s">還沒註冊</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 暱稱禁用字。註冊、改暱稱時伺服器會拿這份清單比對；比對前會去掉空白符號、
 * 全形轉半形、大小寫當成一樣，所以這裡存的字看起來都是「擠在一起、小寫」的樣子。
 * 新加的字不會把已經在用的名字變不見，所以下面把「現在會被擋的暱稱」列出來讓你改。
 */
function NicknameGuard() {
  const [words, setWords] = useState<{ word: string; whole: boolean }[]>([])
  const [flagged, setFlagged] = useState<Awaited<ReturnType<typeof repo.listFlaggedNicknames>>>([])
  const [word, setWord] = useState('')
  const [whole, setWhole] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [w, f] = await Promise.all([repo.listBannedWords(), repo.listFlaggedNicknames()])
    setWords(w)
    setFlagged(f)
  }, [])
  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e))) }, [refresh])

  const run = async (what: () => Promise<string | void>) => {
    setError(null); setNote(null)
    try {
      const msg = await what()
      if (typeof msg === 'string') setNote(msg)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <div>
        <h2>暱稱禁用字（{words.length}）</h2>
        <p className="lede left">
          註冊和改暱稱時會擋掉含這些字的名字，空白、符號、全形、大小寫都繞不過去。
          勾「整個名字才擋」的字只擋剛好叫這個名字的人，給 ass 這種短字用，不然 class 也會被擋。
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}
      {flagged.length > 0 && (
        <div className="roster">
          <p className="lede left">這些人的暱稱現在會被擋，幫他們換一個：</p>
          {flagged.map((f) => (
            <div className="r" key={f.studentId}>
              <span className="n">{f.nickname}</span>
              <span className="s">{f.className || f.classCode || '沒有班級'}</span>
              <button className="btn ghost small" onClick={() => {
                const nick = prompt(`幫「${f.nickname}」換一個暱稱`)
                if (nick) void run(async () => {
                  const next = await repo.setStudentNickname(f.studentId, nick)
                  return `${f.nickname} 改名叫 ${next} 了`
                })
              }}>改暱稱</button>
            </div>
          ))}
        </div>
      )}
      <form className="row" onSubmit={(e) => {
        e.preventDefault()
        if (!word.trim()) return
        void run(async () => {
          const saved = await repo.addBannedWord(word, whole)
          setWord(''); setWhole(false)
          return `加進去了：${saved}`
        })
      }}>
        <input value={word} placeholder="要擋的字" onChange={(e) => setWord(e.target.value)} />
        <label className="small">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> 整個名字才擋
        </label>
        <button className="btn small" type="submit" disabled={!word.trim()}>加入</button>
        <button className="btn ghost small" type="button" onClick={() => setOpen(!open)}>
          {open ? '收起清單' : '看清單'}
        </button>
      </form>
      {open && (
        <div className="chips">
          {words.map((w) => (
            <button key={w.word} title="點一下刪掉"
              onClick={() => {
                if (confirm(`把「${w.word}」從禁用字拿掉？`)) void run(async () => {
                  await repo.removeBannedWord(w.word)
                  return `拿掉了：${w.word}`
                })
              }}>
              {w.word}{w.whole ? '（整個）' : ''} ✕
            </button>
          ))}
        </div>
      )}
    </>
  )
}

const STATUS: { id: FeedbackStatus; label: string }[] = [
  { id: 'new', label: '還沒看' },
  { id: 'bug', label: 'Bug 要修' },
  { id: 'request', label: '需求' },
  { id: 'unclear', label: '要 Chuck 決定' },
  { id: 'fixed', label: '修好了' },
  { id: 'dup', label: '重複' },
  { id: 'wontfix', label: '不處理' },
]
const KIND_LABEL = { bug: '🐞 壞掉了', confusing: '❓ 看不懂', idea: '💡 想法' }

/**
 * 學生老師按「回報」送來的東西。Claude 排程會定期來分類，
 * 這裡是給管理員自己看、自己改分類用的。
 */
function FeedbackInbox() {
  const [filter, setFilter] = useState<FeedbackStatus | ''>('')
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await repo.listFeedback(filter || undefined)); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [filter])
  useEffect(() => { void load() }, [load])

  const fresh = rows.filter((r) => r.status === 'new' || r.status === 'unclear').length

  return (
    <>
      <div>
        <h2>回報{fresh > 0 && `（${fresh} 則待處理）`}</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as FeedbackStatus | '')}>
          <option value="">全部</option>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="fb-list">
        {rows.length === 0 && <p className="lede">沒有回報。</p>}
        {rows.slice(0, 50).map((r) => (
          <div className="fb-item" key={r.id}>
            <div className="fb-row">
              <b>{KIND_LABEL[r.kind]}</b>
              <span>{r.who}{r.classCode && `・${r.classCode}`}</span>
              <span className="spacer" />
              <select value={r.status} onChange={(e) => void (async () => {
                try {
                  await repo.triageFeedback(r.id, e.target.value as FeedbackStatus, '')
                  await load()
                } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
              })()}>
                {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>{r.message}</div>
            {r.note && <div className="fb-meta">處理說明：{r.note}</div>}
            <div className="fb-meta">
              {new Date(r.createdAt).toLocaleString('zh-TW')}・{r.screen}
              {typeof r.context.level === 'string' && `・${r.context.level}`}
              {typeof r.context.ver === 'string' && `・v${r.context.ver}`}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
