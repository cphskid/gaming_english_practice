// 帳號系統走一遍真的資料庫：老師登入 → 開班 → 學生註冊 → 老師看得到這個學生。
//
// 這一支是為了回答「為什麼建不了帳號」而寫的。db.sh 測的是權限規則對不對，
// 它測的是畫面上真的按得動——兩者會分開壞，所以兩支都要留著。
//
// 跑法（要先有一個老師帳號，帳密從環境變數給）：
//   npm run dev &
//   E2E_TEACHER=... E2E_TEACHER_PW=... node tools/test/accounts-e2e.mjs
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const CODE = 'E2E' + Math.random().toString(36).slice(2, 6).toUpperCase()
const KID  = 'kid' + Math.random().toString(36).slice(2, 7)
const TEACHER = process.env.E2E_TEACHER || 'e2e-teacher@example.test'
const TEACHER_PW = process.env.E2E_TEACHER_PW || 'e2e-password-9174'
// 學生的登出在「設定」裡，不在關卡畫面上。
const logout = async (pg) => {
  await pg.click('text=設定')
  await pg.waitForSelector('text=我的設定', { timeout: 15000 })
  await pg.click('.topbar >> text=登出')
  await pg.waitForSelector('.tabs', { timeout: 15000 })
}
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ok = []
const bad = []
const say = (c, w) => (c ? ok : bad).push(w)

// ── 老師
let p = await b.newPage({ viewport: { width: 1280, height: 900 } })
p.on('pageerror', (e) => bad.push('JS 例外：' + e))
await p.goto(BASE)
await p.click('text=我是老師')
await p.fill('#em', TEACHER)
await p.fill('#spw', TEACHER_PW)
await p.click('button[type=submit]')
await p.waitForSelector('.teacher', { timeout: 25000 })
say(true, '老師登入進得了後台')
await p.fill('input[placeholder^="班級代碼"]', CODE)
await p.fill('input[placeholder^="班級名稱"]', '測試班')
await p.click('text=開一個新班')
await p.waitForSelector(`.codebox .code:has-text("${CODE}")`, { timeout: 20000 })
say(true, '老師開得了班，看得到班級代碼 ' + CODE)
const openBtn = p.locator('.row button', { hasText: '加入' }).first()
if ((await openBtn.innerText()).includes('已關閉')) await openBtn.click()
await p.waitForTimeout(800)
say((await openBtn.innerText()).includes('開放加入中'), '班級開放加入')
await p.close()

// ── 學生（另一個乾淨的瀏覽器，等於另一台平板）
p = await b.newPage({ viewport: { width: 1280, height: 900 } })
p.on('pageerror', (e) => bad.push('JS 例外：' + e))
await p.goto(BASE)
await p.click('.tabs button:nth-child(2)')
await p.fill('#cls', CODE)
await p.fill('#lid', KID)
await p.fill('#pw', 'kid123')
await p.fill('#nick', '小測試')
await p.click('button[type=submit]')
await p.waitForSelector('.levels', { timeout: 25000 })
say(true, '學生註冊得了，而且直接進到關卡畫面')
// 登出再登入，確認密碼真的存下去了
await logout(p)
await p.click('.tabs button:nth-child(1)')
await p.fill('#lid', KID)
await p.fill('#pw', 'kid123')
await p.click('button[type=submit]')
await p.waitForSelector('.levels', { timeout: 25000 })
say(true, '學生登出後用同一組帳密登得回來')
// 密碼打錯要被擋
await logout(p)
await p.click('.tabs button:nth-child(1)')
await p.fill('#lid', KID)
await p.fill('#pw', 'wrongpw')
await p.click('button[type=submit]')
await p.waitForSelector('.error', { timeout: 15000 })
say(true, '密碼打錯被擋下來：' + (await p.locator('.error').first().innerText()).trim())
await p.close()

// ── 老師看得到這個學生
p = await b.newPage({ viewport: { width: 1280, height: 900 } })
p.on('pageerror', (e) => bad.push('JS 例外：' + e))
await p.goto(BASE)
await p.click('text=我是老師')
await p.fill('#em', TEACHER)
await p.fill('#spw', TEACHER_PW)
await p.click('button[type=submit]')
await p.waitForSelector('.chips', { timeout: 25000 })
// 老師可能有好幾班，先點到這次開的那一班
await p.click(`.chips button:has-text("測試班")`).catch(() => {})
await p.waitForSelector(`.codebox .code:has-text("${CODE}")`, { timeout: 20000 }).catch(() => {})
await p.waitForSelector('.roster', { timeout: 25000 })
const names = await p.locator('.roster .r .n').allInnerTexts()
say(names.some((n) => n.includes('小測試')), '老師的名單上看得到「小測試」，名單：' + JSON.stringify(names))
await p.close()

await b.close()
for (const w of ok) console.log('  ✓ ' + w)
for (const w of bad) console.log('  ✗ ' + w)
console.log(bad.length ? `\n${bad.length} 條沒過` : `\n${ok.length} 條全過`)
process.exit(bad.length ? 1 : 0)
