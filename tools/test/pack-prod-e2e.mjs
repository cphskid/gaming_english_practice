/**
 * 正式站的養成包實測。跑真的 Supabase，所以驗得到本機驗不到的事：
 * grant 有沒有給、RPC 在不在、RLS 會不會把自己人擋掉。
 * （本機驗不到 grant 是有前例的：老師名單少一個 grant，本機測試全綠，
 *   正式站一登入就變成「不是管理員」。）
 *
 * 分兩段跑，中間要用管理權限塞金幣給測試角色——金幣只能從答對來，
 * 不從資料庫塞的話得先打十關：
 *
 *   node tools/test/pack-prod-e2e.mjs a <url> <班級代碼>   註冊＋創角
 *   （用 SQL 把那個角色的 coins/exp 設好）
 *   node tools/test/pack-prod-e2e.mjs b <url>              商店、換裝、排行榜、道具
 *
 * 第一段會把帳號寫到 /tmp/pack-prod.json，第二段自己讀。
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const [phase, BASE = 'https://cphskid.github.io/gaming_english_practice/', CLASS = ''] = process.argv.slice(2)
const STATE = '/tmp/pack-prod.json'
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.error('  ✗ ' + m); process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail('畫面炸了：' + e.message))

try {
  if (phase === 'a') {
    const id = 'zz' + Date.now().toString().slice(-6)
    console.log('── 正式站註冊：' + id)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '第一次來' }).click()
    await page.fill('#cls', CLASS)
    await page.fill('#lid', id)
    await page.fill('#pw', 'abc123')
    await page.fill('#nick', '測試' + id.slice(-3))
    await page.locator('form button[type=submit]').click()

    await page.waitForSelector('.jobs .job', { timeout: 25000 })
    ok('註冊完被帶到創角')
    await page.locator('.jobs .job').nth(0).click()       // 騎士
    await page.locator('.avatars .av').nth(3).click()
    await page.locator('button.btn.big').click()
    await page.waitForSelector('.levels', { timeout: 25000 })
    ok('職業與頭像存進正式資料庫了（set_job / set_avatar）')
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.levels', { timeout: 25000 })
    const mug = await page.locator('.topbar .mugbox img').getAttribute('src')
    mug?.includes('av-soldier-f') ? ok('重新整理之後頭像還在：' + mug.split('/').pop())
      : fail('頭像沒存住：' + mug)
    writeFileSync(STATE, JSON.stringify({ id }))
    console.log('\n帳號 ' + id + '（密碼 abc123）')
  } else {
    const { id } = JSON.parse(readFileSync(STATE, 'utf8'))
    console.log('── 登入 ' + id + '，測商店')
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.fill('#lid', id)
    await page.fill('#pw', 'abc123')
    await page.locator('form button[type=submit]').click()
    await page.waitForSelector('.levels', { timeout: 25000 })

    await page.getByRole('button', { name: '商店' }).click()
    await page.waitForSelector('.items .item')
    const before = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
    await page.locator('.item', { hasText: '寒霜陷阱' }).locator('button.btn').click()
    await page.waitForSelector('.note, .error')
    const after = Number((await page.locator('.coins').innerText()).replace(/\D/g, ''))
    before - after === 60 ? ok(`買到了，金幣 ${before} → ${after}（價錢是資料庫算的）`)
      : fail(`買不成或扣錯：${before} → ${after}／${await page.locator('.error').innerText().catch(() => '')}`)

    // 這支腳本會對同一個帳號重跑，而裝飾品買過就買不了第二次（按鈕會變成「已擁有」）。
    // 所以已經有的就跳過，不然第二次跑一定卡在這裡。
    const buyOnce = async (name) => {
      const btn = page.locator('.item', { hasText: name }).locator('button.btn')
      if (await btn.isDisabled()) { ok(name + ' 之前就買過了，跳過'); return }
      await btn.click()
      await page.waitForSelector('.note, .error')
    }
    await buyOnce('金邊框')
    // 陣營顏色 2026-09-24 起免費送，不用買，下面直接在「我的角色」換

    await page.locator('.item', { hasText: '金邊框' }).locator('.i-go').click()
    await page.waitForSelector('.hero')
    await page.locator('.pick', { hasText: '金邊框' }).click()
    // 正式站是真的連線，按下去到畫面更新中間隔一趟往返，等結果出現再看
    await page.waitForSelector('.note, .error')
    const framed = await page.locator('.hero .mugbox').getAttribute('class')
    framed.includes('f-gold') ? ok('外框戴上去了（equip_item）') : fail('戴不上去：' + framed)

    await page.locator('.pick', { hasText: '紅軍' }).click()
    await page.waitForSelector('.note, .error')
    const redOn = await page.locator('.pick', { hasText: '紅軍' }).getAttribute('class')
    redOn.includes(' on') ? ok('換成紅軍了') : fail('顏色沒換成功：' + redOn)

    console.log('── 排行榜')
    await page.getByRole('button', { name: '回去' }).click()
    await page.waitForSelector('.levels')
    await page.getByRole('button', { name: '排行榜' }).click()
    await page.waitForSelector('.board .rank, .error', { timeout: 25000 })
    const err = await page.locator('.error').innerText().catch(() => '')
    if (err) fail('排行榜讀不到（class_leaderboard 的 grant？）：' + err)
    else {
      const me = page.locator('.rank.me')
      await me.first().waitFor({ timeout: 10000 })
      ok('排行榜讀得到，自己在上面：' + (await me.first().innerText()).replace(/\n/g, ' '))
      const n = await page.locator('.board .rank').count()
      ok('班上有 ' + n +' 個人有成績')
    }

    console.log('── 帶道具進關卡')
    await page.getByRole('button', { name: '回去' }).click()
    await page.waitForSelector('.levels')
    await page.locator('.lv').first().click()
    await page.waitForSelector('.td-cv', { timeout: 20000 })
    await page.locator('.rotate').click()
    await page.locator('.bagitem').first().waitFor({ timeout: 10000 })
    ok('關卡上看得到道具：' + (await page.locator('.bagitem').first().innerText()).replace('\n', ' '))
    // 正式版沒有 window.__td（DEV 才有），所以按畫面來：找一個蓋得起來的塔位。
    // 塔位座標是關卡資料算出來的，測試這邊猜不到，就沿著地面掃過去，
    // 水晶變少就代表塔蓋起來了。
    const box = await page.locator('.td-cv').boundingBox()
    const crystals = async () => Number((await page.locator('.td-coin').innerText()).replace(/\D/g, ''))
    const start = await crystals()
    let built = false
    for (let ry = 0.42; ry <= 0.82 && !built; ry += 0.08) {
      for (let rx = 0.1; rx <= 0.9 && !built; rx += 0.06) {
        await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry)
        await page.waitForTimeout(60)
        if (await crystals() < start) built = true
      }
    }
    built ? ok('蓋了一座塔') : fail('找不到蓋得起來的塔位')
    await page.getByRole('button', { name: /開始第/ }).click()
    await page.waitForTimeout(1500)
    await page.locator('.bagitem').first().click()
    await page.waitForTimeout(1200)
    const toast = await page.locator('.td-toast').innerText()
    toast.includes('結霜') ? ok('道具生效了（consume_item）：' + toast) : fail('道具沒生效：' + toast)
    const buff = page.locator('.td-buff')
    await buff.first().waitFor({ timeout: 5000 })
    const ticking = await buff.first().innerText()
    if (/\d+s/.test(ticking)) ok('上面那條在倒數：' + ticking.replace(/\n/g, ' '))
    else fail('狀態條沒有倒數：' + ticking)
    const left = await page.locator('.bagitem').count()
    ok('用掉之後道具列剩 ' + left + ' 種')
    await page.screenshot({ path: '/tmp/pack-prod.png' })
  }
} catch (e) {
  fail(String(e))
  await page.screenshot({ path: '/tmp/pack-prod-error.png' }).catch(() => {})
} finally {
  await b.close()
}
