import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAPTERS, LEVELS } from '@/data/levels'
import { WORDS_BY_ID } from '@/data/words'
import { WordStat } from '@/core/wordStat'
import { SKILL_NAME, type ClassRoom, type Staff } from '@/core/types'
import { repo, type ClassRosterRow } from '@/net'
import { TeacherRoom } from './Room'
import { Icon } from './Icon'

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
    setActive((prev) => prev ?? all[0]?.code ?? null)
  }, [])

  useEffect(() => { void refreshClasses() }, [refreshClasses])

  useEffect(() => {
    if (staff.isAdmin) { setNoAdmin(false); return }
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
    <div className="screen wide">
      <div className="topbar">
        <span className="who">{staff.displayName}</span>
        {staff.isAdmin && <button className="btn ghost small" onClick={onAdmin}>管理員</button>}
        {noAdmin && (
          <button className="btn small" onClick={() => void run(async () => {
            await onClaimAdmin()
            setNoAdmin(false)
            return '你現在是最高管理者了'
          })}>我是這裡的管理員</button>
        )}
        <span className="spacer" />
        <button className="btn ghost small" onClick={onBack}>回遊戲</button>
        <button className="btn ghost small" onClick={onLogout}>登出</button>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="note">{note}</p>}

      <div className="teacher">
        <div>
          <h2>我的班級</h2>
          <div className="chips">
            {classes.map((c) => (
              <button key={c.code} className={c.code === active ? 'on' : ''}
                onClick={() => setActive(c.code)}>
                {c.name || c.code}
              </button>
            ))}
            {classes.length === 0 && <span className="lede">還沒有班級，在下面開一個。</span>}
          </div>

          <form className="row" onSubmit={(e) => {
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
          </form>
        </div>

        {room && (
          <>
            <div>
              <h2>{room.name || room.code}</h2>
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

            <TeacherRoom classCode={room.code} />

            <div>
              <h2>班上同學（{roster.length}）</h2>
              <p className="lede left">
                小朋友忘記密碼的時候在這裡重設。重設會順便解鎖，因為忘記密碼的人
                通常已經試到被鎖住了。
              </p>
            </div>
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
                    if (confirm(`把「${r.nickname}」從這一班移除？他的紀錄會一起消失。`)) {
                      void run(() => repo.removeStudent(r.studentId))
                    }
                  }}>移除</button>
                </div>
              ))}
            </div>

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

            <div>
              <h2>這禮拜開放的關卡</h2>
              <p className="lede left">點一下就額外開放，不受學生自己的進度限制。</p>
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
          </>
        )}
      </div>
    </div>
  )
}
