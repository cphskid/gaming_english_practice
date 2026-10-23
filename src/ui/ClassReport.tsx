import { useEffect, useMemo, useState } from 'react'
import { CHAPTERS, LEVELS } from '@/data/levels'
import { WORDS_BY_ID } from '@/data/words'
import { SKILL_NAME, type Skill } from '@/core/types'
import { repo, type ClassDetail } from '@/net'

/**
 * 老師・家長細節頁（2026-10-23，跟島嶼開拓者那頁同一套）。
 *
 * 上面是全班：進度表（每章過了幾關、答對率、最常錯的字），每一章收起來只看答對率紅黃綠，
 * 打開看每一關幾個人玩、幾個人過、答對多少、這章全班最常錯的字。
 * 點孩子的名字看他一個人的白話報告：哪些字要陪他再練、每一關打得怎樣。
 *
 * 資料來自 supabase/park_guardian.sql 的 guardian_class_detail（樂園班級名單），
 * 章節和關卡照 data/levels.ts 的 CHAPTERS，以後加章不用改這頁。
 */

type Row = ClassDetail['levels'][number]
type WordRow = ClassDetail['words'][number]

const LEVEL = new Map(LEVELS.map((l) => [l.id, l]))
const CH_NO = '一二三四五'
const GAME_NAME: Record<string, string> = { 'tug-of-war': '真人對戰', 'boss-raid': '魔王團戰' }

const pctOf = (ok: number, n: number) => (n ? Math.round((100 * ok) / n) : null)
// 答對率紅黃綠：80% 以上綠、60~79% 黃、不到 60% 紅（先看紅的）
const tone = (p: number | null) => (p === null ? 'none' : p >= 80 ? 'good' : p >= 60 ? 'mid' : 'bad')
const Pct = ({ ok, n, pre = '答對 ' }: { ok: number; n: number; pre?: string }) => {
  const p = pctOf(ok, n)
  return <span className={`cr-pct ${tone(p)}`}>{p === null ? '還沒作答' : `${pre}${p}%`}</span>
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n)
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)

/** 把錯過的字合成一份「錯幾次」排行（同一個字不同題型分開算，因為要練的東西不一樣） */
function topWords(rows: WordRow[], limit: number) {
  const m = new Map<string, { w: number; k: Skill; n: number; bad: number; kids: Set<string> }>()
  for (const r of rows) {
    const key = `${r.w}:${r.k}`
    const x = m.get(key) ?? { w: r.w, k: r.k, n: 0, bad: 0, kids: new Set<string>() }
    x.n += r.n; x.bad += r.bad; x.kids.add(r.s)
    m.set(key, x)
  }
  return [...m.values()].sort((a, b) => b.bad - a.bad || b.kids.size - a.kids.size).slice(0, limit)
}

function WordList({ rows, kids }: { rows: ReturnType<typeof topWords>; kids?: boolean }) {
  if (!rows.length) return <p className="lede left small">還沒有人答錯過。</p>
  return (
    <div className="cr-words">
      {rows.map((x) => {
        const w = WORDS_BY_ID.get(x.w)
        if (!w) return null
        return (
          <div key={`${x.w}:${x.k}`}>
            <b>{w.word}</b><span className="zh">{w.emoji} {w.zh}</span><small>{SKILL_NAME[x.k]}</small>
            <span className="bad">錯 {x.bad}／{x.n}{kids && x.kids.size > 1 ? `（${x.kids.size} 人）` : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

export function ClassReport({ code, onLoaded }: { code: string; onLoaded?: (has: boolean) => void }) {
  const [d, setD] = useState<ClassDetail | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [kid, setKid] = useState<string | null>(null)
  useEffect(() => {
    setD(undefined); setKid(null); setErr(null)
    repo.loadClassDetail(code)
      .then((x) => { setD(x); onLoaded?.(!!x) })
      .catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setD(null); onLoaded?.(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const byKid = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of d?.levels ?? []) m.set(r.s, [...(m.get(r.s) ?? []), r])
    return m
  }, [d])

  if (d === undefined) return <p className="lede left">讀取學習細節中…</p>
  if (err) return <p className="error">{err}</p>
  if (!d) return null
  const k = kid ? d.kids.find((x) => x.id === kid) : null
  if (k) return <KidReport kid={k} d={d} rows={byKid.get(k.id) ?? []} onBack={() => setKid(null)} />
  return <ClassView d={d} byKid={byKid} onPick={setKid} />
}

function ClassView({ d, byKid, onPick }: { d: ClassDetail; byKid: Map<string, Row[]>; onPick: (id: string) => void }) {
  const [openAll, setOpenAll] = useState(false)
  const week = Date.now() - 7 * 86400e3
  const lastOf = (id: string) => Math.max(0, ...[...(byKid.get(id) ?? []), ...d.games.filter((g) => g.s === id)]
    .map((r) => (r.last ? new Date(r.last).getTime() : 0)))
  const cleared = (id: string) => (byKid.get(id) ?? []).filter((r) => r.cleared).length
  const played = d.kids.filter((x) => lastOf(x.id) > 0)
  const avg = played.length ? sum(played, (x) => cleared(x.id)) / played.length : 0
  const order = [...d.kids].sort((a, b) => lastOf(b.id) - lastOf(a.id) || a.nickname.localeCompare(b.nickname, 'zh-TW'))

  return (
    <div className="cr">
      <div className="cr-cards">
        <div><b>{played.length}</b><span>/ {d.kids.length} 人玩過</span></div>
        <div><b>{d.kids.filter((x) => lastOf(x.id) > week).length}</b><span>人最近 7 天有玩</span></div>
        <div><b>{avg.toFixed(1)}</b><span>關：玩過的人平均過了幾關（共 {LEVELS.length} 關）</span></div>
      </div>

      <h2>全班進度</h2>
      <p className="lede left small">每章「過了幾關」和全班答對率。點名字看那個孩子的報告（可以給家長看）。</p>
      <div className="cr-wrap">
        <table className="cr-table">
          <thead><tr><th>暱稱</th>{CHAPTERS.map((c, i) => <th key={c.no}>第{CH_NO[i]}章</th>)}<th>答對率</th><th>最近在打</th><th>最後玩</th></tr></thead>
          <tbody>
            {order.map((x) => {
              const rows = byKid.get(x.id) ?? []
              const last = [...rows].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))[0]
              const lv = last && LEVEL.get(last.l)
              const t = lastOf(x.id)
              return (
                <tr key={x.id} className={t ? '' : 'idle'}>
                  <td><button className="cr-link" onClick={() => onPick(x.id)}>{x.nickname}</button></td>
                  {CHAPTERS.map((c) => {
                    const n = rows.filter((r) => r.cleared && LEVEL.get(r.l)?.chapter === c.no).length
                    return <td key={c.no}>{n ? `${n}/${c.levels.length}` : ''}</td>
                  })}
                  <td>{rows.length ? <Pct ok={sum(rows, (r) => r.ok)} n={sum(rows, (r) => r.n)} pre="" /> : ''}</td>
                  <td>{lv ? `${lv.no}. ${lv.name}` : ''}</td>
                  <td>{t ? when(new Date(t).toISOString()) : '還沒玩'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2>每一章：上課可以加強的地方</h2>
      <p className="cr-legend">
        <span className="cr-pct good">80% 以上</span><span className="cr-pct mid">60～79%</span><span className="cr-pct bad">不到 60%</span>
        <span>＝全班答對率，紅色的先看。</span>
        <button className="cr-link" onClick={() => setOpenAll((o) => !o)}>{openAll ? '全部收起' : '全部展開'}</button>
      </p>
      {CHAPTERS.map((c, i) => {
        const rows = d.levels.filter((r) => LEVEL.get(r.l)?.chapter === c.no)
        const kidsIn = new Set(rows.map((r) => r.s))
        const ok = sum(rows, (r) => r.ok), n = sum(rows, (r) => r.n)
        // 這章的字：一章一層字庫（tier），對戰、團戰答錯的也算進它那一層
        const words = d.words.filter((w) => WORDS_BY_ID.get(w.w)?.tier === c.no)
        return (
          <details key={`${c.no}-${openAll}`} className={`cr-ch ${tone(pctOf(ok, n))}`} open={openAll}>
            <summary>
              <b>第{CH_NO[i]}章 {c.name}</b><Pct ok={ok} n={n} />
              <span>{kidsIn.size ? `${kidsIn.size} 人玩過、過了 ${rows.filter((r) => r.cleared).length} 關次` : '還沒有人玩'}</span>
            </summary>
            {kidsIn.size > 0 && <>
              <div className="cr-wrap">
                <table className="cr-table">
                  <thead><tr><th>關卡</th><th>玩過</th><th>過關</th><th>答對率</th></tr></thead>
                  <tbody>
                    {c.levels.map((l) => {
                      const lr = rows.filter((r) => r.l === l.id)
                      if (!lr.length) return null
                      return (
                        <tr key={l.id}>
                          <td>{l.no}. {l.name}</td><td>{lr.length} 人</td><td>{lr.filter((r) => r.cleared).length} 人</td>
                          <td><Pct ok={sum(lr, (r) => r.ok)} n={sum(lr, (r) => r.n)} pre="" /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="cr-sub">這章全班最常錯的字</p>
              <WordList rows={topWords(words, 10)} kids />
            </>}
          </details>
        )
      })}

      {d.games.length > 0 && <>
        <h2>對戰與團戰</h2>
        <ul className="cr-ul">
          {Object.entries(GAME_NAME).map(([g, name]) => {
            const rs = d.games.filter((x) => x.g === g)
            if (!rs.length) return null
            return <li key={g}><b>{name}</b>：{rs.length} 人玩過、共 {sum(rs, (r) => r.plays)} 場，<Pct ok={sum(rs, (r) => r.ok)} n={sum(rs, (r) => r.n)} /></li>
          })}
        </ul>
      </>}

      <h2>全班最常錯的字</h2>
      <WordList rows={topWords(d.words, 12)} kids />
    </div>
  )
}

function KidReport({ kid, d, rows, onBack }: { kid: { id: string; nickname: string }; d: ClassDetail; rows: Row[]; onBack: () => void }) {
  const words = d.words.filter((w) => w.s === kid.id)
  const games = d.games.filter((g) => g.s === kid.id)
  const all = [...rows, ...games]
  const n = sum(all, (r) => r.n), ok = sum(all, (r) => r.ok)
  const last = [...rows].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))[0]
  const lv = last && LEVEL.get(last.l)
  const cleared = rows.filter((r) => r.cleared)
  // 三種題型各錯幾次（答錯紀錄只有錯過的字）
  const bySkill = (['recognize', 'spell', 'listen'] as Skill[]).map((k) => {
    const ws = words.filter((w) => w.k === k)
    return { k, bad: sum(ws, (w) => w.bad), words: ws.length }
  }).filter((x) => x.words)
  const weak = rows.filter((r) => r.n >= 10 && (pctOf(r.ok, r.n) ?? 100) < 60)

  return (
    <div className="cr">
      <button className="cr-link" onClick={onBack}>‹ 回全班</button>
      <h2>{kid.nickname} 的學習報告</h2>
      {!all.length ? <p className="lede left">還沒開始玩守護異世界。</p> : (
        <p className="cr-sum">
          過了 <b>{cleared.length}／{LEVELS.length}</b> 關
          （{CHAPTERS.map((c, i) => `第${CH_NO[i]}章 ${cleared.filter((r) => LEVEL.get(r.l)?.chapter === c.no).length}/${c.levels.length}`).join('、')}）。
          {lv && <>最近在打第{CH_NO[lv.chapter - 1]}章第 {lv.no} 關「{lv.name}」（{when(last.last)}）。</>}
          總共答了 {n} 題，<Pct ok={ok} n={n} />。
          {bySkill.length > 0 && <>答錯的題目裡，{bySkill.map((x) => `${SKILL_NAME[x.k]}錯 ${x.bad} 次`).join('、')}。</>}
        </p>
      )}

      {words.length > 0 && <>
        <h2>可以陪他再練的字</h2>
        <p className="lede left small">照錯的次數排。「認字」是看英文選中文，「拼字」是自己拼出來，「聽音」是聽發音選字。</p>
        <WordList rows={topWords(words, 15)} />
      </>}
      {weak.length > 0 && <>
        <h2>答對率比較低的關卡</h2>
        <ul className="cr-ul">
          {weak.map((r) => { const l = LEVEL.get(r.l)!; return <li key={r.l}>第{CH_NO[l.chapter - 1]}章第 {l.no} 關「{l.name}」：打了 {r.plays} 場，<Pct ok={r.ok} n={r.n} />{r.cleared ? '，已經過關' : '，還沒過關'}。可以陪他把這關的字先念一遍再打。</li> })}
        </ul>
      </>}

      {rows.length > 0 && CHAPTERS.map((c, i) => {
        const cr = rows.filter((r) => LEVEL.get(r.l)?.chapter === c.no)
        if (!cr.length) return null
        const cok = sum(cr, (r) => r.ok), cn = sum(cr, (r) => r.n)
        return (
          <details key={c.no} className={`cr-ch ${tone(pctOf(cok, cn))}`}>
            <summary><b>第{CH_NO[i]}章 {c.name}</b><Pct ok={cok} n={cn} /><span>過了 {cr.filter((r) => r.cleared).length}/{c.levels.length} 關</span></summary>
            <div className="cr-wrap">
              <table className="cr-table">
                <thead><tr><th>關卡</th><th>星星</th><th>打了幾場</th><th>答對率</th><th>最後玩</th></tr></thead>
                <tbody>
                  {c.levels.map((l) => {
                    const r = cr.find((x) => x.l === l.id)
                    if (!r) return null
                    return <tr key={l.id}><td>{l.no}. {l.name}</td><td>{r.cleared ? stars(r.stars) : '還沒過'}</td><td>{r.plays}</td>
                      <td>{r.n ? <Pct ok={r.ok} n={r.n} pre="" /> : ''}</td><td>{when(r.last)}</td></tr>
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )
      })}

      {games.length > 0 && <ul className="cr-ul">
        {games.map((g) => <li key={g.g}><b>{GAME_NAME[g.g] ?? g.g}</b>：{g.plays} 場，<Pct ok={g.ok} n={g.n} /></li>)}
      </ul>}
    </div>
  )
}
