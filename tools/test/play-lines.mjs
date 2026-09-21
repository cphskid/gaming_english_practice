/**
 * 驗三條兵種線與戰場內升階真的接起來了。
 *
 * play-tug.mjs 驗的是「整套流程跑得完」，但它從頭到尾只用預設的認字線、
 * 一階兵。這一支專門戳新加的東西：換兵種鈕會不會真的換題型、拼字題的牌子
 * 是不是變成單一字母、升階之後是不是真的要連對 N 題才出一隻、
 * 以及手機橫拿的時候那一排鈕有沒有壓到戰場。
 *
 *   VITE_SUPABASE_URL= VITE_SUPABASE_KEY= npx vite --port 5191
 *   node tools/test/play-lines.mjs http://localhost:5191/
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5191/'
const SHOT = process.argv[3] || '/tmp/lines'

let bad = 0
const ok = (m) => console.log('  ✓ ' + m)
const fail = (m) => { console.log('  ✗ ' + m); bad = 1; process.exitCode = 1 }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
// Chuck 都用手機直拿再轉橫，所以量的是 844×390。
const page = await b.newPage({ viewport: { width: 844, height: 390 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  const id = 'zz' + Math.random().toString(36).slice(2, 8)
  await page.goto(BASE)
  await page.getByRole('button', { name: '第一次來' }).click()
  await page.fill('#cls', 'TEST1'); await page.fill('#lid', id); await page.fill('#pw', 'abc123')
  await page.fill('#nick', '兵線' + id.slice(-3))
  await page.locator('form button[type=submit]').click()
  await page.waitForSelector('.jobs .job', { timeout: 30000 })
  await page.locator('.jobs .job').first().click()
  await page.locator('.avatars .av').first().click()
  await page.locator('button.btn.big').click()
  await page.waitForSelector('.levels', { timeout: 30000 })
  await page.getByRole('button', { name: '對戰' }).click()
  await page.waitForSelector('.vs-foe', { timeout: 15000 })
  await page.locator('.vs-foe').first().click()
  await page.waitForSelector('.td-cv', { timeout: 20000 })
  await page.locator('.rotate').click().catch(() => {})
  await page.waitForTimeout(600)
  ok('進到戰場了')

  // ---- 那一排鈕有沒有壓到戰場
  const box = await page.evaluate(() => {
    const cv = document.querySelector('.td-cv').getBoundingClientRect()
    const bar = document.querySelector('.tw-bar').getBoundingClientRect()
    const btns = [...document.querySelectorAll('.tw-line,.tw-up')].map((b) => {
      const r = b.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    })
    return { cv: { x: cv.x, w: cv.width, right: cv.right }, bar: { x: bar.x, w: bar.width }, btns }
  })
  box.bar.x >= box.cv.right - 1
    ? ok(`那一排在戰場旁邊，沒有蓋住戰場（畫布右緣 ${Math.round(box.cv.right)}、面板左緣 ${Math.round(box.bar.x)}）`)
    : fail(`那一排壓在戰場上：畫布右緣 ${Math.round(box.cv.right)}、面板左緣 ${Math.round(box.bar.x)}`)
  const small = box.btns.filter((b) => b.h < 44)
  small.length === 0
    ? ok(`四顆鈕都夠大（最小 ${Math.min(...box.btns.map((b) => b.h))}px 高，手指按得到）`)
    : fail(`有 ${small.length} 顆鈕高度不到 44px：${JSON.stringify(small)}`)

  await page.screenshot({ path: SHOT + '-recognize.png' })

  // ---- 三條線各打幾題，看題型與牌子對不對
  const out = await page.evaluate(async () => {
    const g = window.__tug
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const seen = {}
    const answer = async (right) => {
      const ids = g.ids()
      const pick = right ? g.S.target : ids.find((i) => i !== g.S.target)
      if (!pick) return
      g.tapId(pick)
      await sleep(420)
    }
    for (const line of ['recognize', 'listen', 'spell']) {
      g.setLine(line)
      await sleep(250)
      const labels = [...g.S.targets.values()].map((t) => t.label)
      seen[line] = {
        skill: g.LINES[line].skill,
        zh: document.querySelector('.td-qzh').textContent,
        hint: document.querySelector('.td-qhint').textContent,
        labels,
        // 答對之後場上有沒有出現這條線的兵
        before: g.S.battle.units.filter((u) => u.side === 'me').length,
      }
      await answer(true)
      seen[line].lines = [...new Set(g.S.battle.units.filter((u) => u.side === 'me').map((u) => u.line))]
    }

    // ---- 升階：灌水晶、按鈕、確認真的要連對 N 題才出一隻
    g.S.battle.crystal.me = 999
    const tier1 = g.S.battle.tier.me
    g.buyTier()
    const tier2 = g.S.battle.tier.me
    g.setLine('recognize')
    await sleep(250)
    const n0 = g.S.battle.units.filter((u) => u.side === 'me').length
    await answer(true)                       // 第 1 題：只該累積，不該出兵
    const n1 = g.S.battle.units.filter((u) => u.side === 'me').length
    const pendingAfter1 = g.S.pending
    await answer(true)                       // 第 2 題：這時候才該出一隻二階
    const n2 = g.S.battle.units.filter((u) => u.side === 'me').length
    const ranks = g.S.battle.units.filter((u) => u.side === 'me').map((u) => u.rank)

    // ---- 累積到一半答錯，要結算成一階而不是整個沒收
    await answer(true)
    const before = g.S.battle.units.filter((u) => u.side === 'me').length
    await answer(false)
    const after = g.S.battle.units.filter((u) => u.side === 'me').length

    return {
      seen, tier1, tier2, n0, n1, n2, pendingAfter1, ranks,
      cashOut: { before, after },
      crystalSpent: 999 - g.S.battle.crystal.me,
    }
  })

  // 題型真的跟著換
  out.seen.recognize.skill === 'recognize' && out.seen.listen.skill === 'listen' && out.seen.spell.skill === 'spell'
    ? ok('三顆鈕各自對應認字／聽音／拼字三種題型')
    : fail('題型沒跟著換：' + JSON.stringify(Object.keys(out.seen).map((k) => out.seen[k].skill)))

  out.seen.listen.zh === '聽聽看'
    ? ok('聽音題不給看中文（不然用看的就答完了，根本沒在聽）')
    : fail('聽音題還是把中文寫出來了：' + out.seen.listen.zh)

  const spellLabels = out.seen.spell.labels
  spellLabels.length > 0 && spellLabels.every((l) => l.length === 1)
    ? ok(`拼字題的牌子是單一字母：${spellLabels.join(' / ')}`)
    : fail('拼字題的牌子不是單一字母：' + JSON.stringify(spellLabels))

  out.seen.spell.zh.includes('＿')
    ? ok(`拼字題有把字母挖掉：${out.seen.spell.zh}`)
    : fail('拼字題沒有挖字母：' + out.seen.spell.zh)

  const allLines = out.seen.spell.lines
  allLines.length === 3
    ? ok('三條線的兵都真的上場了：' + allLines.join('、'))
    : fail('場上只有 ' + allLines.join('、'))

  // 升階
  out.tier2 === out.tier1 + 1 && out.crystalSpent > 0
    ? ok(`升階鈕有用：${out.tier1} 階 → ${out.tier2} 階，花了 ${out.crystalSpent} 顆水晶`)
    : fail(`升階沒生效：${out.tier1} → ${out.tier2}`)

  out.n1 === out.n0 && out.pendingAfter1 === 1
    ? ok('二階的時候，答對第一題只累積、還不出兵')
    : fail(`答對一題就出兵了（${out.n0} → ${out.n1}，累積 ${out.pendingAfter1}）`)

  out.n2 > out.n1 && out.ranks.includes(2)
    ? ok('連對兩題才出一隻二階兵')
    : fail(`連對兩題沒出二階兵（${out.n1} → ${out.n2}，階級 ${JSON.stringify(out.ranks)}）`)

  out.cashOut.after > out.cashOut.before
    ? ok('累積到一半答錯，會結算成目前這一階出去（不是整個沒收）')
    : fail('答錯把累積的整個沒收了，沒有人敢按升階')

  await page.screenshot({ path: SHOT + '-spell.png' })

  errors.length === 0 ? ok('沒有畫面錯誤') : fail('畫面錯誤：' + errors.slice(0, 3).join(' / '))
} catch (e) {
  fail('測試自己爆了：' + String(e).slice(0, 300))
} finally {
  await b.close()
}
console.log(bad ? '\n有項目沒過' : '\n三條線這一輪全過')
