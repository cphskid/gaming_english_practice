/**
 * 打完一關、後端出事的時候，畫面不可以就這樣定住。
 *
 * Chuck 回報的：第 4 關打到第五波，按下最後一隻怪之後畫面停住，只有返回鍵還會動。
 * 原因不是遊戲當掉——遊戲本來就該在那一刻停下來——是結算要打好幾趟後端，
 * 那段時間什麼都沒顯示，而且 `void finish(o)` 把失敗整個吞掉，
 * 只要有一趟失敗，人就永遠留在那一格畫面上。
 *
 * 這支把那件事重現出來：**讓伺服器收到答題事件、但讓瀏覽器以為失敗**
 * （route.fetch() 之後 abort），這是最危險的一種失敗——重試如果傻傻再送一次，
 * 金幣就變兩倍。要驗三件事：
 *   1. 結算中看得到「結算中」
 *   2. 失敗看得到原因，而且按得了重試
 *   3. 重試之後真的進得了結算畫面，**而且金幣沒有被算兩次**
 *
 * 一定要打**接著真 Supabase 的 dev server**：本機版不走網路攔不到，
 * 正式版 build 又沒有 window.__td（那段只在 DEV 存在），自動打不完一關。
 * 臨時班級的 SQL 在 scratchpad 的 mkfintest.sql / rmfintest.sql。
 *
 *   node tools/test/finish-retry.mjs http://localhost:5180/ ZZ9FIN
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5180/'
const CLASS = process.argv[3] || 'ZZ9FIN'
const PHONE = { width: 390, height: 844 }

let bad = 0
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.log('  ✗ ' + m); bad = 1; process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: PHONE })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  // ── 註冊一個新學生
  const id = 'zz' + Math.random().toString(36).slice(2, 8)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.start-btn').click({ force: true }); await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', CLASS)
  await page.fill('#lid', id)
  await page.fill('#pw', 'abc123')
  await page.fill('#nick', '結算' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 40000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 40000 })
  ok('學生註冊好了')

  // 新角色是從 120 塊起跳的（schema.sql 的 characters.coins default），
  // 所以要比的是「多了多少」，不是錢包的絕對值。
  const coinOf = async () =>
    Number(((await page.locator('.topbar').innerText()).match(/🪙\D*([\d,]+)/) ?? [])[1]?.replace(/,/g, '') ?? -1)
  const before = await coinOf()

  // ── 第一關打到通關
  await page.locator('.lv').first().click()
  await page.waitForSelector('.td-cv', { timeout: 30000 })
  await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(600)

  // 伺服器收得到、瀏覽器以為失敗——重試最容易重複算錢的那一種
  let blocked = process.env.NOFAIL ? 1 : 0   // NOFAIL=1 就不弄壞網路，只對帳金幣
  await page.route('**/rest/v1/rpc/submit_answers', async (route) => {
    if (blocked) return route.continue()
    blocked = 1
    await route.fetch().catch(() => {})   // 伺服器真的收到了
    await route.abort('failed')           // 但瀏覽器這邊是錯的
  })

  const played = await page.evaluate(async () => {
    const td = window.__td, S = td.S
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 4 && S.crystals >= 40; i++) td.tapSlot(i)
    td.startWave()
    const t0 = Date.now()
    while (S.phase !== 'done' && Date.now() - t0 < 180000) {
      if (S.phase === 'build') {
        for (let i = 0; i < td.SLOTS.length && S.crystals >= 40; i++) {
          if (!S.towers.some((t) => t.slot === i)) td.tapSlot(i)
        }
        td.startWave(); await sleep(50); continue
      }
      if (S.target) td.tapEnemy(S.target)
      await sleep(110)
    }
    return { phase: S.phase, correct: S.correct, asked: S.asked }
  })
  played.phase === 'done' ? ok(`第一關打完了（答對 ${played.correct}/${played.asked}）`)
    : fail('沒打完：' + JSON.stringify(played))

  if (!process.env.NOFAIL) {
    // ── 1. 失敗要看得見
    await page.waitForSelector('.settling', { timeout: 20000 })
    await page.waitForSelector('.settling >> text=結算沒成功', { timeout: 30000 })
    ok('結算失敗看得到，不是一個定住的畫面')
    const retry = page.locator('.settling button', { hasText: '重試' })
    await retry.count() ? ok('按得了重試') : fail('沒有重試可以按')

    // ── 2. 重試要進得了結算畫面
    await retry.click()
  }
  await page.waitForSelector('.result', { timeout: 60000 })
  ok(process.env.NOFAIL ? '進到結算畫面' : '重試之後進到結算畫面')

  // ── 3. 金幣不可以被算兩次
  const rows = (await page.locator('.result .rows').innerText()).replace(/\s+/g, ' ')
  const shown = Number((rows.match(/獲得銅幣\D*([\d,]+)/) ?? [])[1]?.replace(/,/g, '') ?? -1)
  await page.locator('.result button', { hasText: '回選關' }).click()
  await page.waitForSelector('.levels', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const after = await coinOf()
  const got = after - before
  // 錢包多的要剛好等於結算上寫的。多一倍就是重試把答題送進去兩次。
  if (after < 0 || before < 0 || shown < 0) fail(`讀不到金幣：結算 ${shown}、錢包 ${before}→${after}`)
  else if (got === shown) ok(`結算寫的跟實際入帳一樣：${got}`)
  else if (got >= shown * 1.5) fail(`金幣被算了兩次：結算 ${shown}、實際入帳 ${got}`)
  else fail(`金幣對不起來：結算 ${shown}、實際入帳 ${got}（錢包 ${before}→${after}）`)

  errors.length ? fail('畫面有錯誤：' + errors.join(' / ')) : ok('沒有畫面錯誤')
} catch (e) {
  fail('測試自己炸了：' + (e?.message ?? e))
} finally {
  await b.close()
  console.log(bad ? '\n有項目沒過' : '\n結算這一輪全過')
}
