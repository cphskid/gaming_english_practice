import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAPTERS, LEVELS } from '@/data/levels'
import { WORDS_BY_ID } from '@/data/words'
import { WordStat } from '@/core/wordStat'
import { SKILL_NAME, type ClassRoom, type Staff } from '@/core/types'
import { PARK_URL, repo, type ClassDetail, type ClassRosterRow } from '@/net'
import { TeacherRoom } from './Room'
import { ClassReport, classCsv } from './ClassReport'
import { Icon } from './Icon'
import { ui } from './park-ui'

/**
 * 老師後台。
 *
 * 「全班最常錯的字」對老師最有價值，而它只是把答題事件 group 一下就有了——
 * 這就是「事件是唯一真相來源」換來的東西：新報表是一句查詢，不用改資料結構。
 *
 * 班級代碼同時是邀請碼：上課時打開「可以加入」讓全班註冊，註冊完關起來，
 * 代碼之後流出去也沒用。真的流出去了就換一組，班上的人會跟著走不會被踢掉。
 */
export function Teacher({
  staff, onAdmin, onClaimAdmin, onBack, onLogout,
}: {
  staff: Staff
  onAdmin: () => void
  onClaimAdmin: () => Promise<void>
  onBack: () => void
  onLogout: () => void
}) {
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [active, setActive] = useState<string | null>(null)
  // run() 做完動作後要重讀「現在這一班」。換代碼會在動作裡改掉 active，閉包裡的
  // 還是舊代碼，拿舊代碼去讀會把名單洗成空的，看起來像全班被踢掉。
  const activeRef = useRef(active)
  activeRef.current = active
  const [roster, setRoster] = useState<ClassRosterRow[]>([])
  const [stat, setStat] = useState<WordStat | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // 有新的細節頁（樂園班級）就不再另外列「全班最常錯的字」，細節頁裡有
  const [detail, setDetail] = useState<ClassDetail | null>(null)
  const hasDetail = !!detail
  // 看哪個孩子的報告；網址帶 ?kid=（跟島嶼開拓者一樣，報告頁可以直接分享、列印）
  const [kid, setKid] = useState<string | null>(() => new URLSearchParams(location.search).get('kid'))
  const pickKid = (id: string | null) => {
    setKid(id)
    const u = new URL(location.href)
    if (id) u.searchParams.set('kid', id); else u.searchParams.delete('kid')
    history.replaceState(null, '', u)
    window.scrollTo(0, 0)
  }
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /**
   * 這套系統還沒有管理員。
   *
   * 「我是第一個使用者」本來只長在老師登入畫面上，但它要求你**已經登入**，
   * 而登入成功畫面就跳走了——於是那顆按鈕永遠按不到，誰都當不成管理員。
   * 所以這裡再放一顆：已經是老師、系統又還沒有管理員，才會出現。
   */
  const [noAdmin, setNoAdmin] = useState(false)

  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')

  const room = classes.find((c) => c.code === active) ?? null

  const refreshClasses = useCallback(async () => {
    const all = await repo.listClasses()
    setClasses(all)
    // 樂園「細節頁」連過來會帶 ?class=代碼，直接打開那一班
    const want = new URLSearchParams(location.search).get('class')?.toUpperCase()
    setActive((prev) => prev ?? (all.find((c) => c.code === want) ?? all[0])?.code ?? null)
  }, [])

  useEffect(() => { void refreshClasses() }, [refreshClasses])

  useEffect(() => {
    // 接上樂園時管理員由樂園管，不用問
    if (staff.isAdmin || PARK_URL) { setNoAdmin(false); return }
    void repo.hasAdmin().then((has) => setNoAdmin(!has)).catch(() => setNoAdmin(false))
  }, [staff.isAdmin])

  const refreshClass = useCallback(async (code: string) => {
    const [rows, events, opened] = await Promise.all([
      repo.loadClassRoster(code),
      repo.loadClassEvents(code),
      repo.loadTeacherOpen(code),
    ])
    setRoster(rows)
    setStat(WordStat.from(events))
    setOpen(new Set(opened))
  }, [])

  useEffect(() => { if (active) void refreshClass(active) }, [active, refreshClass])

  /** 每個會改到資料的動作都走這裡，錯誤就顯示出來而不是默默失敗。 */
  const run = useCallback(async (what: () => Promise<string | void>) => {
    setError(null); setNote(null)
    try {
      const msg = await what()
      if (typeof msg === 'string') setNote(msg)
      await refreshClasses()
      if (activeRef.current) await refreshClass(activeRef.current)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [refreshClass, refreshClasses])

  /**
   * 開放關卡。按下去**先亮起來**再慢慢存，而且只重讀開放清單。
   *
   * 以前按一下要等存檔＋重讀班級、名單、全班答題紀錄才亮，手機上要好幾秒，
   * 看起來就是按了沒反應；錯誤訊息又印在頁面最上面，捲到下面的關卡區看不到。
   * 連按幾關時，每次都從上一次按完的狀態算，不會把前一關蓋掉。
   */
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])
  const saving = useRef<Promise<void>>(Promise.resolve())
  const [openError, setOpenError] = useState<string | null>(null)

  const toggleOpen = (levelId: string) => {
    if (!room) return
    const code = room.code
    const next = new Set(openRef.current)
    if (next.has(levelId)) next.delete(levelId)
    else {
      // 開第二、三章的關會讓還沒升章的小朋友直接跳進國中字，先問一聲，免得捲動時誤點。
      const lv = LEVELS.find((l) => l.id === levelId)
      if (lv && lv.chapter > 1
        && !window.confirm(`要開放第${'一二三'[lv.chapter - 1]}章第 ${lv.no} 關「${lv.name}」嗎？\n還沒打完前面章節的學生也能直接進去打。`)) return
      next.add(levelId)
    }
    openRef.current = next
    setOpen(next)
    setOpenError(null)
    saving.current = saving.current
      .then(() => repo.setTeacherOpen(code, [...next]))
      .catch(async (e) => {
        setOpenError(e instanceof Error ? e.message : String(e))
        // 存失敗就照資料庫的樣子顯示，不要留著一個假的「已開放」
        try { setOpen(new Set(await repo.loadTeacherOpen(code))) } catch { /* 留著 */ }
      })
  }

  const missed = stat?.mostMissed(10) ?? []

  return (
    <div className="screen wide kr tch">
      {/* 2026-10-23 版面跟樂園一樣（木牌標題、奶油卡片、可收合），細節頁放最上面，管理的東西收起來 */}
      <div className="kr-top">
        <img className="kr-badge" src={ui('rank')} alt="" />
        <h2>老師・家長細節頁</h2>
        <span className="kr-sub">{staff.displayName}</span>
        <span className="spacer" />
        {/*
          2026-10-24 按鈕跟島嶼開拓者的細節頁一樣：接上樂園時只有一顆「樂園教師入口」（左上角那顆就是回去）。
          以前這裡還有登出（被樣式排到最左邊加了箭頭，看起來像返回，一按整個樂園都登出）、
          管理員（開的是英文版舊管理頁）、回遊戲（老師沒有學生帳號會掉到登入畫面），都拿掉了：
          登出、管理員頁都在樂園教師入口裡。
          .kr-top 最後一顆 .kr-back 會被排到最左邊加「←」，所以「回去」那顆一定要放最後。
        */}
        {PARK_URL ? (
          <a className="kr-back park" href={PARK_URL + 'teacher.html'}>
            <img src={PARK_URL + 'img/admin/park.webp'} alt="" />樂園教師入口
          </a>
        ) : <>
          {staff.isAdmin && <button className="kr-back" onClick={onAdmin}>管理員</button>}
          {noAdmin && (
            <button className="kr-back" onClick={() => void run(async () => {
              await onClaimAdmin()
              setNoAdmin(false)
              return '你現在是最高管理者了'
            })}>我是這裡的管理員</button>
          )}
          <button className="kr-back" onClick={onLogout}>登出</button>
          <button className="kr-back" onClick={onBack}>回遊戲</button>
        </>}
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <div className="kr-body teacher">
        <div className="kr-card tch-card">
          <div className="chips">
            {classes.map((c) => (
              <button key={c.code} className={c.code === active ? 'on' : ''}
                onClick={() => {
                  setActive(c.code); setDetail(null); pickKid(null)
                  const u = new URL(location.href); u.searchParams.set('class', c.code); history.replaceState(null, '', u)
                }}>
                {c.name || c.code}
              </button>
            ))}
            {classes.length === 0 && <span className="muted">還沒有班級{PARK_URL ? '，請到樂園教師入口開班' : '，在下面開一個'}。</span>}
          </div>

          {/* 第二列跟島嶼開拓者一樣：看全班／某個孩子、列印、匯出 CSV */}
          {room && detail && (
            <div className="tch-tools">
              {detail.kids.length > 0 && (
                <label>看
                  <select value={kid ?? ''} onChange={(e) => pickKid(e.target.value || null)}>
                    <option value="">全班（{detail.kids.length} 人）</option>
                    {detail.kids.map((k) => <option key={k.id} value={k.id}>{k.nickname} 的報告</option>)}
                  </select>
                </label>
              )}
              <span className="spacer" />
              <button className="btn small ghost" onClick={() => window.print()}>列印</button>
              <button className="btn small" onClick={() => {
                const url = URL.createObjectURL(new Blob([classCsv(detail)], { type: 'text/csv' }))
                const a = document.createElement('a')
                a.href = url
                a.download = `守護異世界_${room.name || room.code}.csv`
                a.click()
                URL.revokeObjectURL(url)
              }}>匯出 CSV</button>
            </div>
          )}

          {/* 開班在樂園做；沒有樂園（本機版）才留這裡的表單 */}
          {!PARK_URL && <form className="row" onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const code = newCode.trim().toUpperCase()
              await repo.createClass(newCode, newName)
              setNewCode(''); setNewName('')
              // 剛開的班直接選起來，不然畫面還停在舊的那一班，
              // 看起來像沒開成功。
              setActive(code)
              return '班級開好了'
            })
          }}>
            <input value={newCode} maxLength={12} placeholder="班級代碼 例如 3A2025"
              onChange={(e) => setNewCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
            <input value={newName} maxLength={20} placeholder="班級名稱 例如 三年二班"
              onChange={(e) => setNewName(e.target.value)} />
            <button className="btn small" type="submit" disabled={newCode.trim().length < 3}>
              開一個新班
            </button>
          </form>}
        </div>

        {room && (
          <>
            <ClassReport code={room.code} kid={kid} onKid={pickKid} onData={setDetail} />

            {/* 下面是守護異世界自己的老師工具（島嶼沒有），收起來，列印時不印 */}
            <h3 className="tch-tools-h">老師工具</h3>

            {/* 代碼、開放加入、換代碼在樂園教師入口做（樂園的班級資料），這裡只留守護異世界自己的設定 */}
            {PARK_URL ? (
            <details className="kr-sec">
              <summary>遊戲設定<small>真人對戰聽音題</small></summary>
              <div className="kr-card tch-card">
              <div className="row">
                <button className={'btn small' + (room.liveListen ? '' : ' ghost')}
                  onClick={() => void run(async () => {
                    await repo.setClassLiveListen(room.code, !room.liveListen)
                    return room.liveListen ? '真人對戰不出聽音題了' : '真人對戰會出聽音題（旁邊的人聽得到答案，在家比較適合）'
                  })}>
                  {room.liveListen ? '🔊 真人對戰有聽音題（點一下關掉）' : '🔇 真人對戰不出聽音題（點一下打開）'}
                </button>
              </div>
              <p className="muted">班級代碼、開放加入、換代碼請到<a href={PARK_URL + 'teacher.html'}>樂園教師入口</a>。</p>
              </div>
            </details>
            ) : (
            <details className="kr-sec">
              <summary>班級設定<small>代碼、開放加入、真人對戰聽音題</small></summary>
              <div className="kr-card tch-card">
              <div className="codebox">
                <span className="code">{room.code}</span>
                <span className="lede">
                  這組代碼就是邀請碼。小朋友註冊時要填它，沒有它就註冊不了。
                </span>
              </div>
              <div className="row">
                <button className={'btn small' + (room.open ? '' : ' ghost')}
                  onClick={() => void run(async () => {
                    await repo.setClassOpen(room.code, !room.open)
                    return room.open ? '關起來了，新的人進不來' : '打開了，現在可以註冊'
                  })}>
                  {room.open ? '✅ 開放加入中（點一下關起來）' : '🔒 已關閉（點一下開放）'}
                </button>
                <button className={'btn small' + (room.liveListen ? '' : ' ghost')}
                  onClick={() => void run(async () => {
                    await repo.setClassLiveListen(room.code, !room.liveListen)
                    return room.liveListen ? '真人對戰不出聽音題了' : '真人對戰會出聽音題（旁邊的人聽得到答案，在家比較適合）'
                  })}>
                  {room.liveListen ? '🔊 真人對戰有聽音題（點一下關掉）' : '🔇 真人對戰不出聽音題（點一下打開）'}
                </button>
                <button className="btn ghost small" onClick={() => void run(async () => {
                  const next = await repo.regenerateClassCode(room.code)
                  activeRef.current = next
                  setActive(next)
                  return '換成新代碼 ' + next + '，班上的人都還在'
                })}>
                  換一組代碼
                </button>
              </div>
              </div>
            </details>
            )}

            <details className="kr-sec">
              <summary>老師開場對戰<small>全班一起打</small></summary>
              <TeacherRoom classCode={room.code} />
            </details>

            {/*
              名單管理（重設密碼、改暱稱、移出）在樂園教師入口做。這裡的「移除」是英文版舊功能，
              會把學生帳號整個刪掉（樂園的「移出」只是移出班級），接上樂園時不放。
            */}
            {!PARK_URL && <>
            <details className="kr-sec">
              <summary>班上同學（{roster.length}）<small>重設密碼、改暱稱</small></summary>
              <div className="kr-card tch-card">
              <p className="muted">
                小朋友忘記密碼的時候在這裡重設。重設會順便解鎖，因為忘記密碼的人
                通常已經試到被鎖住了。暱稱取得不好也可以在這裡直接幫他改。
              </p>
            <div className="roster">
              {roster.length === 0 && <p className="lede">還沒有人加入。</p>}
              {roster.map((r) => (
                <div className="r" key={r.studentId}>
                  <span className="n">{r.nickname}</span>
                  <span className="s">⭐ {r.stars}　<Icon name="coin" size={13} /> {r.coins}　答過 {r.answers} 題</span>
                  <button className="btn ghost small" onClick={() => {
                    const pw = prompt(`幫「${r.nickname}」設一個新密碼（6 個以上英文或數字）`)
                    if (pw) void run(async () => {
                      await repo.resetStudentPassword(r.studentId, pw)
                      return `${r.nickname} 的新密碼是 ${pw}`
                    })
                  }}>重設密碼</button>
                  <button className="btn ghost small" onClick={() => {
                    const nick = prompt(`幫「${r.nickname}」換一個暱稱`, r.nickname)
                    if (nick && nick.trim() !== r.nickname) void run(async () => {
                      const next = await repo.setStudentNickname(r.studentId, nick)
                      return `${r.nickname} 改名叫 ${next} 了`
                    })
                  }}>改暱稱</button>
                  <button className="btn ghost small" onClick={() => {
                    if (confirm(`把「${r.nickname}」從這一班移除？他的紀錄會一起消失。`)) {
                      void run(() => repo.removeStudent(r.studentId))
                    }
                  }}>移除</button>
                </div>
              ))}
            </div>
              </div>
            </details>
            </>}

            {!hasDetail && <>
            <div>
              <h2>全班最常錯的字</h2>
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
            </>}

            <details className="kr-sec">
              <summary>額外開放關卡<small>{open.size ? `目前開了 ${open.size} 關` : '目前沒有'}</small></summary>
              <div className="kr-card tch-card">
              <p className="muted">點一下就額外開放，不受學生自己的進度限制。</p>
              {openError && <p className="error">{openError}</p>}
              {/* 85 顆按鈕在手機上一捲就容易誤點，開了哪幾關要一眼看得到（2026-09-26 誤開第 61 關）。
                  點這裡的也是關掉。 */}
              <div className="opennow">
                {open.size === 0 ? '目前沒有另外開放的關卡。' : <>
                  目前開放（點一下關掉）：
                  <div className="open">
                    {LEVELS.filter((l) => open.has(l.id)).map((l) => (
                      <button key={l.id} className="on" onClick={() => toggleOpen(l.id)}>
                        第{'一二三'[l.chapter - 1]}章　{l.no}. {l.name}　✕
                      </button>
                    ))}
                  </div>
                </>}
              </div>
            {CHAPTERS.map((ch, ci) => (
              <div key={ch.no}>
                <h3 className="opench">第{'一二三'[ci]}章　{ch.name}</h3>
                <div className="open">
                  {ch.levels.map((l) => (
                    <button key={l.id} className={open.has(l.id) ? 'on' : ''}
                      onClick={() => toggleOpen(l.id)}>
                      {l.no}. {l.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
