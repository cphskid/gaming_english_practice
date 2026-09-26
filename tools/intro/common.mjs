// 介紹影片錄影共用：本機版（沒有 Supabase）註冊一個學生、把關卡全開
import { chromium } from 'playwright'
export const BASE = process.env.BASE || 'http://localhost:5190/'
export async function launch(opts = {}) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...opts })
  await ctx.addInitScript(() => {
    const ids = Array.from({ length: 85 }, (_, i) => `td-${String(i + 1).padStart(2, '0')}`)
    try {
      localStorage.setItem('gep.v1.teacherOpen.LOCAL1', JSON.stringify(ids))
      localStorage.setItem('gep.v1.classes', JSON.stringify([{ code: 'LOCAL1', name: '東門509', open: true }]))
    } catch {}
  })
  return { b, ctx }
}
export async function register(page, { nick = '小勇者', job = 0, av = 3, cleared = 0 } = {}) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.start-btn').click({ force: true })
  await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', 'LOCAL1')
  await page.fill('#lid', 'kid' + Math.random().toString(36).slice(2, 7))
  await page.fill('#pw', 'abc123')
  await page.fill('#nick', nick)
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 20000 })
  await page.locator('.jobs .job').nth(job).click()
  await page.locator('.avatars .av').nth(av).click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 20000 })
  if (cleared) {
    await page.evaluate((n) => {
      const key = Object.keys(localStorage).find((x) => x.startsWith('gep.v1.student.'))
      const id = key.slice('gep.v1.student.'.length)
      const all = Array.from({ length: n }, (_, i) => ({
        levelId: 'td-' + String(i + 1).padStart(2, '0'), stars: 3, bestCorrect: 20, clearedAt: Date.now(),
      }))
      localStorage.setItem('gep.v1.progress.' + id, JSON.stringify(all))
    }, cleared)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.levels', { timeout: 20000 })
  }
}
