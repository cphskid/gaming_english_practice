// 自動跑一遍守塔：蓋塔、開波、依照題目點正確的怪。
// 用來驗證出題漏洞修好了、拆塔會退錢、難度曲線合理。
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173'
const LEVEL = Number(process.argv[3] || 1)
const ACCURACY = Number(process.argv[4] || 1)   // 模擬小朋友的正確率
// 接了 Supabase 之後班級是資料庫裡真的存在的東西，所以要能指定
const CLASS = process.env.TD_CLASS || 'TEST1'

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

// 老師開放全部關卡，測試才進得去後面的關
await page.addInitScript((code) => {
  const ids = Array.from({ length: 14 }, (_, i) => `td-${String(i + 1).padStart(2, '0')}`)
  try {
    localStorage.setItem(`gep.v1.teacherOpen.${code}`, JSON.stringify(ids))
    localStorage.setItem('gep.v1.classes', JSON.stringify([{ code, name: '測試班', open: true }]))
  } catch {}
}, CLASS)

await page.goto(BASE)
// 每次都是乾淨的瀏覽器，所以走註冊。帳號帶亂數，重跑才不會撞到上一次的。
const BOT = 'bot' + Math.random().toString(36).slice(2, 8)
await page.click('.tabs button:nth-child(2)')
await page.fill('#cls', CLASS)
await page.fill('#lid', BOT)
await page.fill('#pw', 'robot42')
await page.fill('#nick', '機器人')
await page.click('button[type=submit]')
await page.waitForSelector('.levels', { timeout: 20000 })
await page.locator('.lv').nth(LEVEL - 1).click()
await page.waitForSelector('.td-cv')
await page.waitForTimeout(700)

const out = await page.evaluate(async ({ accuracy }) => {
  const td = window.__td
  const S = td.S
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const log = { spamWins: 0, spamTries: 0, waves: [], errors: [] }

  // 先蓋四座塔
  for (let i = 0; i < 4 && S.crystals >= 40; i++) td.tapSlot(i)
  const coinsBeforeSell = S.crystals
  td.tapSlot(0)                    // 選取
  td.sellSelected()                // 拆掉，這一波還沒打應該全額退
  log.refund = S.crystals - coinsBeforeSell
  td.tapSlot(0)                    // 蓋回來

  td.startWave()

  const t0 = Date.now()
  let lastWave = S.wave
  let waveStart = Date.now()
  let waveCorrect = 0

  while (S.phase !== 'done' && Date.now() - t0 < 180000) {
    if (S.phase === 'build') {
      // 真人會把每一波賺到的錢再投進去蓋塔，機器人也要，不然難度會被高估
      for (let i = 0; i < td.SLOTS.length && S.crystals >= 40; i++) {
        if (!S.towers.some((t) => t.slot === i)) td.tapSlot(i)
      }
      td.startWave(); await sleep(50); continue
    }

    if (S.target) {
      // 出題漏洞檢查：出題的時候，還沒走進畫面的怪不可以被抽中，
      // 因為牠的字牌根本還沒畫出來
      const ready = S.enemies.filter((e) => e.entered)
      log.spamTries++
      if (!S.target.entered) log.spamWins++
      if (ready.length < 2) log.soloAsks = (log.soloAsks ?? 0) + 1

      const wrong = Math.random() > accuracy
      const pick = wrong
        ? ready.find((e) => e !== S.target) ?? S.target
        : S.target
      td.tapEnemy(pick)
      if (pick === S.target) waveCorrect++
    }
    if (S.wave !== lastWave) {
      log.waves.push({ wave: lastWave, seconds: +((Date.now() - waveStart) / 1000).toFixed(1), correct: waveCorrect })
      lastWave = S.wave; waveStart = Date.now(); waveCorrect = 0
    }
    await sleep(120)
  }

  log.waves.push({ wave: lastWave, seconds: +((Date.now() - waveStart) / 1000).toFixed(1), correct: waveCorrect })
  log.final = { phase: S.phase, hp: S.hp, wave: S.wave, correct: S.correct, asked: S.asked, coins: S.crystals }
  return log
}, { accuracy: ACCURACY })

await page.waitForTimeout(400)
const resultVisible = await page.locator('.result').count()
const stars = await page.locator('.result .stars').textContent().catch(() => null)
const rows = await page.locator('.result .rows').textContent().catch(() => null)

console.log(JSON.stringify({ level: LEVEL, accuracy: ACCURACY, ...out, resultVisible, stars, rows, errors }, null, 1))
await browser.close()
