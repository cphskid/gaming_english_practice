import { useEffect, useState } from 'react'
import { PARK_URL, repo } from '@/net'

/**
 * 同學的時空旅人大頭（2026-10-12）。排行榜、對戰、團戰名單一次會出現好幾個人，
 * 同一個畫面裡要的 id 先收起來，下一拍一次問伺服器（guardian_class_looks），問過的就記著。
 * 沒有旅人（或本地版）記成 null，畫面照舊用像素頭像。
 */
type Look = Record<string, string | null>
const cache = new Map<string, Look | null>()
const waiting = new Set<string>()
const subs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

export function seedLook(id: string, look: Look | null | undefined) {
  if (id && look) { cache.set(id, look); subs.forEach((f) => f()) }
}

function ask(id: string) {
  if (!PARK_URL || !repo.classLooks || cache.has(id) || waiting.has(id)) return
  waiting.add(id)
  timer ??= setTimeout(async () => {
    timer = null
    const ids = [...waiting].slice(0, 60)
    ids.forEach((i) => waiting.delete(i))
    const got = await repo.classLooks!(ids).catch(() => ({} as Record<string, Look>))
    ids.forEach((i) => cache.set(i, got[i] ?? null))
    subs.forEach((f) => f())
    if (waiting.size) { const next = [...waiting][0]; waiting.delete(next); ask(next) }
  }, 30)
}

export function useLook(id: string | null | undefined): Look | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    subs.add(f)
    if (id) ask(id)
    return () => { subs.delete(f) }
  }, [id])
  return id ? cache.get(id) ?? null : null
}
