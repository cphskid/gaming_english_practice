/**
 * 道具在兩個模式裡都真的有反應。
 *
 * 這支是為了 2026-09-21 Chuck 抓到的那件事寫的：道具列是容器畫的，
 * 每個遊戲都會長出來，但效果是各遊戲各自實作的——**兵推根本沒實作**，
 * 所以在對戰裡按道具完全沒反應：沒訊息、沒效果，道具也不會被扣掉。
 * 一個按了什麼都不會發生的按鈕，比沒有那個按鈕還糟。
 *
 * 所以每個道具在每個模式都要驗三件事：
 *   1. 按得到（道具列有列出來）
 *   2. 真的被扣掉（容器只在遊戲說「做得出來」的時候才扣）
 *   3. 效果量得到（不是只跳一行字）
 *
 * 跑在 localStorage 版，金幣和道具直接塞進本地存檔，不用先打十關：
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5177
 *   node tools/test/items-e2e.mjs http://localhost:5177/
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5177/'
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
// 橫拿：關卡和戰場都會要求轉成橫的
const page = await b.newPage({ viewport: { width: 844, height: 390 } })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))

/** 道具列上那一顆鈕。名字是圖示不是文字了，所以用 title 找。 */
const bagButton = (name) => page.locator(`.bagitem[title^="${name}"]`)

/** 還剩幾個。用完最後一個那顆鈕就不見了，所以「找不到」＝ 0。 */
async function bagCount(name) {
  const el = bagButton(name)
  if (!(await el.count())) return 0
  return Number((await el.locator('b').innerText()).replace(/\D/g, ''))
}

try {
  console.log('── 準備一個有道具的學生')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '第一次來' }).click()
  const id = 'it' + Date.now().toString().slice(-6)
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', '道具' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 30000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 30000 })

  // 三個道具各塞兩個（守塔用一個、對戰用一個），等級也拉高讓商店全開
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gep.v1.character.'))
    const c = JSON.parse(localStorage.getItem(key))
    c.coins = 900; c.exp = 900
    c.items = { ...c.items, 'slow-30': 2, 'heal-5': 2, 'crystal-40': 2 }
    localStorage.setItem(key, JSON.stringify(c))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.levels', { timeout: 30000 })
  ok('學生手上三個道具各兩個')

  // ------------------------------------------------------------------ 商店
  console.log('── 商店有沒有寫清楚哪個道具用在哪個模式')
  await page.getByRole('button', { name: '商店' }).click()
  await page.waitForSelector('.items', { timeout: 15000 })
  const modes = await page.locator('.item .i-modes').allInnerTexts()
  modes.length === 3 && modes.every((m) => m.includes('守塔') && m.includes('對戰'))
    ? ok('三個道具都標了「守塔」「對戰」：' + modes[0].replace(/\s+/g, ' '))
    : fail('商店沒有標出道具用在哪個模式：' + JSON.stringify(modes))
  await page.getByRole('button', { name: '回去' }).click()
  await page.waitForSelector('.levels', { timeout: 15000 })

  // ------------------------------------------------------------------ 守塔
  console.log('── 守塔')
  await page.locator('.levels .lv').first().click()
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(400)

  const tdBag = await page.locator('.bagitem').count()
  tdBag === 3 ? ok('守塔的道具列看得到三個道具') : fail('守塔的道具列只有 ' + tdBag + ' 個')

  // 水晶補給：備戰階段就用得掉，而且水晶要真的變多
  const before = await page.evaluate(() => window.__td.S.crystals)
  await bagButton('水晶補給').click()
  await page.waitForTimeout(350)
  const after = await page.evaluate(() => window.__td.S.crystals)
  after === before + 40 ? ok(`守塔的水晶補給：${before} → ${after}`)
    : fail(`守塔的水晶補給沒生效：${before} → ${after}`)
  await bagCount('水晶補給') === 1 ? ok('守塔用掉的道具有被扣掉') : fail('守塔用掉的道具沒被扣掉')

  // 要先有一座塔才開得了戰（引擎的規則），所以先蓋一座再開波
  await page.evaluate(() => { window.__td.tapSlot(0); window.__td.startWave() })
  await page.waitForFunction(() => window.__td.S.phase === 'battle', null, { timeout: 15000 })
  await bagButton('寒霜陷阱').click()
  await page.waitForTimeout(350)
  const chilled = await page.evaluate(() => window.__td.S.buffs.map((x) => x.id))
  chilled.includes('slow-30') ? ok('守塔的寒霜陷阱：地面結霜，上面那條在倒數')
    : fail('守塔的寒霜陷阱沒生效：' + JSON.stringify(chilled))

  await page.locator('.leave').click()
  await page.locator('.confirm-btns .btn:not(.ghost)').click()
  await page.waitForSelector('.levels', { timeout: 20000 })

  // ------------------------------------------------------------------ 對戰
  console.log('── 對戰（這一段以前整段是壞的）')
  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-foe', { timeout: 15000 })
  await page.locator('.vs-foe').first().click()
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(600)

  const vsBag = await page.locator('.bagitem').count()
  vsBag === 3 ? ok('對戰的道具列看得到三個道具') : fail('對戰的道具列只有 ' + vsBag + ' 個')

  // 寒霜：對方全軍凍住，前線要停下來
  await bagButton('寒霜陷阱').click()
  await page.waitForTimeout(300)
  const chill = await page.evaluate(() => window.__tug.S.battle.chill.foe)
  chill > 0 ? ok(`對戰的寒霜陷阱：對方被凍住 ${chill.toFixed(1)} 秒`)
    : fail('對戰的寒霜陷阱沒生效，chill.foe = ' + chill)
  // 守塔用掉一個、這裡再一個，兩個都用完了，那顆鈕就該消失
  await bagCount('寒霜陷阱') === 0
    ? ok('對戰用掉的道具有被扣掉，用完最後一個鈕就收起來')
    : fail('對戰用掉的道具沒被扣掉')

  // 凍住的那段時間，對方的兵不准往前走（打得到的照樣打，所以只看 x）
  const froze = await page.evaluate(async () => {
    const g = window.__tug
    const x0 = g.S.battle.units.filter((u) => u.side === 'foe').map((u) => u.x)
    await new Promise((r) => setTimeout(r, 1500))
    const b = g.S.battle
    const moved = b.units.filter((u) => u.side === 'foe')
      .map((u, i) => Math.abs(u.x - (x0[i] ?? u.x)))
    return { chill: b.chill.foe, maxMoved: moved.length ? Math.max(...moved) : 0 }
  })
  froze.maxMoved < 2 ? ok(`凍住期間對方一步都沒走（最多動了 ${froze.maxMoved.toFixed(1)}px）`)
    : fail(`凍住期間對方還在前進：${froze.maxMoved.toFixed(1)}px`)

  // 水晶補給：對戰用的是同一套水晶（升階就是花它）
  const c0 = await page.evaluate(() => window.__tug.S.battle.crystal.me)
  await bagButton('水晶補給').click()
  await page.waitForTimeout(300)
  const c1 = await page.evaluate(() => window.__tug.S.battle.crystal.me)
  c1 >= c0 + 40 ? ok(`對戰的水晶補給：${Math.floor(c0)} → ${Math.floor(c1)}`)
    : fail(`對戰的水晶補給沒生效：${c0} → ${c1}`)

  // 城牆修補：滿血的時候不准扣道具（不然就是白花錢）
  const full = await page.evaluate(() => {
    const B = window.__tug.S.battle
    return { hp: B.castleHp.me, max: 100 }
  })
  if (full.hp >= full.max) {
    await bagButton('城牆修補').click()
    await page.waitForTimeout(300)
    await bagCount('城牆修補') === 2
      ? ok('城堡滿血時按修補不會被扣掉（用了會浪費）')
      : fail('城堡滿血時修補還是被扣掉了')
  }
  // 扣一點血再補，確認真的補得回來
  await page.evaluate(() => { window.__tug.S.battle.castleHp.me = 40 })
  await bagButton('城牆修補').click()
  await page.waitForTimeout(300)
  const hp = await page.evaluate(() => window.__tug.S.battle.castleHp.me)
  hp >= 55 ? ok(`對戰的城牆修補：40 → ${Math.round(hp)}`)
    : fail(`對戰的城牆修補沒生效：40 → ${hp}`)

  console.log(process.exitCode ? '\n有項目沒過' : '\n道具在兩個模式都有反應')
} finally {
  await b.close()
}
