// 驗「進關卡時地圖只有綠色」這件事修好了。
//
// 量的東西只有一個：**進關卡之後，地圖有多久是那塊備用的純色。**
// 畫布上那塊備用色是 #6ea84f（守塔）／#3f6b39（對戰），地形一畫出來就再也找不到，
// 所以「採樣點有幾成是備用色」就能分辨地形到底畫出來了沒有。
//
//   node tools/test/art-load.mjs [dev server 網址]
//
// 跑三個情境：
//   1 慢網路            地形那幾張 +300ms，其餘 46 張裡的另外 38 張 +2500ms
//   2 索引第一次抓不到    td-art.json 第一次直接失敗
//   3 地形圖第一次抓不到  tiles.png 第一次直接失敗
//
// 情境 1 的延遲是**不平均**的，這是故意的：手機上 46 張圖在搶同一條線，
// 誰先被要到誰才先進來。舊版是「全部到齊才算數」，所以會被最慢的那張拖住；
// 新版先要地形那幾張，所以地圖比怪和塔早出現。
// 舊版的結果：情境 1 綠 2.5 秒以上，情境 2、3 **退出去重進還是綠的**，只有重新整理才會好。
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173'
const FALLBACK = [110, 168, 79]        // #6ea84f，守塔地圖的備用色
const LIMIT_MS = 1500                  // 純色畫面容許多久

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const results = []

// 地形畫出來要用到的圖；其餘的慢一點也沒關係
const TERRAIN = ['td-art.json', 'water.png', 'tiles.png', 'rock1.png', 'rock2.png', 'rock3.png',
  'rock4.png', 'tree1.png', 'tree2.png']

for (const scene of [
  { name: '慢網路（地形 +300ms、其餘 +2500ms）', delay: (u) => (TERRAIN.some((f) => u.includes(f)) ? 300 : 2500), kill: null },
  { name: '素材索引第一次抓不到', delay: () => 60, kill: 'td-art.json' },
  { name: '地形圖第一次抓不到', delay: () => 60, kill: 'tiles.png' },
]) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const killed = new Set()
  await page.route(/td-art/, async (route) => {
    const url = route.request().url()
    if (scene.kill && url.includes(scene.kill) && !killed.has(scene.kill)) {
      killed.add(scene.kill)
      return route.abort('failed')
    }
    await new Promise((r) => setTimeout(r, scene.delay(url)))
    await route.continue()
  })

  await page.addInitScript(() => {
    const ids = Array.from({ length: 14 }, (_, i) => `td-${String(i + 1).padStart(2, '0')}`)
    try {
      localStorage.setItem('gep.v1.teacherOpen.TEST1', JSON.stringify(ids))
      localStorage.setItem('gep.v1.classes', JSON.stringify([{ code: 'TEST1', name: '測試班', open: true }]))
    } catch {}
  })

  await page.goto(BASE)
  const bot = 'bot' + Math.random().toString(36).slice(2, 8)
  await page.locator('.start-btn').click({ force: true }); await page.click('.tabs button:nth-child(2)')
  await page.fill('#cls', 'TEST1')
  await page.fill('#lid', bot)
  await page.fill('#pw', 'robot42')
  await page.fill('#nick', '機器人')
  await page.click('button[type=submit]')
  await page.waitForSelector('.jobs .job, .levels', { timeout: 30000 })
  if (await page.locator('.jobs .job').count()) {
    await page.locator('.jobs .job').first().click()
    await page.locator('.avatars .av').first().click()
    await page.locator('button.btn.big').click()
  }
  await page.waitForSelector('.levels', { timeout: 30000 })

  const probe = () => page.evaluate((rgb) => {
    const cv = document.querySelector('canvas.td-cv')
    if (!cv) return null
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let hit = 0, n = 0
    for (let i = 0; i < d.length; i += 4 * 37) {
      n++
      if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) hit++
    }
    return Math.round((hit / n) * 100)
  }, FALLBACK)

  // 第一次進關卡：這就是 Chuck 回報的那一次
  const t0 = Date.now()
  await page.locator('.lv').first().click()
  await page.waitForSelector('canvas.td-cv', { timeout: 30000 })
  let blank = 0
  for (let i = 0; i < 60; i++) {
    const pct = await probe()
    if (pct !== null && pct < 40) break          // 地形畫出來了
    blank = Date.now() - t0
    await page.waitForTimeout(200)
  }
  const end = await probe()

  results.push({ scene: scene.name, blank, end, errors: errors.length })
  await page.close()
}

await browser.close()

let bad = 0
for (const r of results) {
  const ok = r.blank <= LIMIT_MS && r.end < 40
  if (!ok) bad++
  console.log(
    `${ok ? '✅' : '❌'} ${r.scene}：純色畫面 ${r.blank}ms、最後純色佔 ${r.end}%` +
    (r.errors ? `（頁面錯誤 ${r.errors} 則）` : ''),
  )
}
console.log(bad ? `\n${bad} 個情境沒過。` : `\n三個情境都過了（純色畫面都在 ${LIMIT_MS}ms 以內）。`)
process.exit(bad ? 1 : 0)
