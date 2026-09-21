/**
 * 驗三條兵種線與戰場內升階真的接起來了。
 *
 * play-tug.mjs 驗的是「整套流程跑得完」，但它從頭到尾只用預設的認字線、
 * 一階兵。這一支專門戳新加的東西：換兵種鈕會不會真的換題型、字牌是不是
 * 變成上面那三塊固定木板、拼字是不是真的一個字母一個字母挖、
 * 升階之後是不是真的要連對 N 題才出一隻、
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
    const mine = () => g.S.battle.units.filter((u) => u.side === 'me')

    /**
     * 照小朋友的方式答一題。
     *
     * 認字／聽音是點木板（一次點完）；**拼字要照順序把字母磚一塊一塊點出來**，
     * 這正是 Chuck 說「變成填空題」之後改掉的地方。要答錯就先故意點一塊
     * 不對的磚——整題會繼續拼完，但結算時算錯。
     */
    const answer = async (right) => {
      if (g.S.line === 'spell') {
        const need = () => g.S.spell.word.word.toLowerCase()
        if (!right) {
          const bad = g.S.spell.bank.findIndex((t) => !t.used && t.ch !== need()[g.S.spell.filled])
          if (bad >= 0) g.tapLetter(bad)
        }
        for (let guard = 0; guard < 20 && g.S.spell.filled < need().length; guard++) {
          const k = g.S.spell.bank.findIndex((t) => !t.used && t.ch === need()[g.S.spell.filled])
          if (k < 0) break
          g.tapLetter(k)
          await sleep(30)
        }
        await sleep(520)
        return
      }
      const ids = g.ids()
      const pick = right ? g.S.target : ids.find((i) => i !== g.S.target)
      if (!pick) return
      g.tapId(pick)
      await sleep(420)
    }

    for (const line of ['recognize', 'listen', 'spell']) {
      g.setLine(line)
      await sleep(250)
      const row = {
        skill: g.LINES[line].skill,
        zh: document.querySelector('.td-qzh').textContent,
        hint: document.querySelector('.td-qhint').textContent,
        labels: [...g.S.targets.values()].map((t) => t.label),
        slots: [...g.S.targets.values()].map((t) => t.slot),
      }
      if (line === 'spell') {
        row.word = g.S.spell.word?.word ?? null
        row.bank = g.S.spell.bank.map((t) => t.ch)
      }
      await answer(true)
      row.lines = [...new Set(mine().map((u) => u.line))]
      if (line === 'spell') {
        // 換到下一個字之後才戳「點錯一塊」，不然這一題會被判錯、拼字線就不會出兵，
        // 下面那條「三條線的兵都上場了」就驗不到。
        const w = g.S.spell.word?.word ?? ''
        const bad = g.S.spell.bank.findIndex((t) => t.ch !== w.toLowerCase()[0])
        if (bad >= 0) g.tapLetter(bad)
        row.afterSlip = { slips: g.S.spell.slips, filled: g.S.spell.filled, word: g.S.spell.word?.word, was: w }
      }
      seen[line] = row
    }

    // ---- 三塊木板的位置（字牌不該再黏在兵身上滑來滑去）
    const board = {
      y: g.BOARD.y, w: g.BOARD.w, h: g.BOARD.h,
      xs: [0, 1, 2].map((i) => {
        const total = g.BOARD.w * 3 + g.BOARD.gap * 2
        return (1088 - total) / 2 + i * (g.BOARD.w + g.BOARD.gap)
      }),
      gap: g.BOARD.gap,
    }

    // ---- 升階：灌水晶、按鈕、確認真的要連對 N 題才出一隻
    g.setLine('recognize')
    await sleep(250)
    g.S.battle.crystal.me = 999
    const tier1 = g.S.battle.tier.me
    g.buyTier()
    const tier2 = g.S.battle.tier.me
    await sleep(120)
    const n0 = mine().length
    await answer(true)                       // 第 1 題：只該累積，不該出兵
    const n1 = mine().length
    const pendingAfter1 = g.S.pending
    await answer(true)                       // 第 2 題：這時候才該出一隻二階
    const n2 = mine().length
    const ranks = mine().map((u) => u.rank)

    // ---- 累積到一半答錯，要結算成一階而不是整個沒收
    await answer(true)
    const before = mine().length
    await answer(false)
    const after = mine().length

    // ---- 頂階是三階，買不到第四階
    g.S.battle.crystal.me = 999
    g.buyTier(); g.buyTier(); g.buyTier()
    const topTier = g.S.battle.tier.me

    return {
      seen, board, tier1, tier2, n0, n1, n2, pendingAfter1, ranks, topTier,
      maxTier: g.MAX_TIER ?? null,
      cashOut: { before, after },
    }
  })

  // 題型真的跟著換
  out.seen.recognize.skill === 'recognize' && out.seen.listen.skill === 'listen' && out.seen.spell.skill === 'spell'
    ? ok('三顆鈕各自對應認字／聽音／拼字三種題型')
    : fail('題型沒跟著換：' + JSON.stringify(Object.keys(out.seen).map((k) => out.seen[k].skill)))

  out.seen.listen.zh === '聽聽看'
    ? ok('聽音題不給看中文（不然用看的就答完了，根本沒在聽）')
    : fail('聽音題還是把中文寫出來了：' + out.seen.listen.zh)

  // ---- 木板：三塊固定的，字牌不再黏在兵身上
  const slots = out.seen.recognize.slots
  const words = out.seen.recognize.labels
  slots.length > 0 && slots.every((s) => s === 0 || s === 1 || s === 2) && new Set(slots).size === slots.length
    ? ok(`字牌排在上面三塊木板上，一塊一個（格位 ${slots.join('/')}）`)
    : fail('木板的格位不對：' + JSON.stringify(slots))

  words.every((w) => w.length > 1)
    ? ok(`木板上寫的是整個單字：${words.join(' / ')}`)
    : fail('木板上不是完整單字：' + JSON.stringify(words))

  const gaps = out.board.xs.slice(1).map((x, i) => x - (out.board.xs[i] + out.board.w))
  gaps.every((g) => g >= 12)
    ? ok(`三塊木板彼此不會疊到（間隔 ${gaps.join('、')}px）`)
    : fail('木板疊在一起了：間隔 ' + JSON.stringify(gaps))

  // ---- 拼字：字母磚，不是填空題
  const sp = out.seen.spell
  const need = (sp.word || '').toLowerCase().split('')
  sp.bank && sp.bank.length >= 5 && sp.bank.length <= 8
    ? ok(`拼字題給 ${sp.bank.length} 塊字母磚（「${sp.word}」：${sp.bank.join(' ')}）`)
    : fail('字母磚的數量不對：' + JSON.stringify(sp.bank))

  need.every((c) => sp.bank.filter((x) => x === c).length >= need.filter((x) => x === c).length)
    ? ok('字母磚湊得出這個字（含重複的字母）')
    : fail(`字母磚拼不出「${sp.word}」：${JSON.stringify(sp.bank)}`)

  !sp.zh.includes('＿') && !sp.hint.includes('＿')
    ? ok('拼字題不再是填空題，題目直接寫中文要你拼出來')
    : fail('拼字題還是挖空格的填空題：' + sp.zh + ' / ' + sp.hint)

  sp.afterSlip && sp.afterSlip.slips === 1 && sp.afterSlip.word === sp.afterSlip.was
    ? ok('點錯一塊磚只記一筆，這個字還是繼續拼（不會整題作廢）')
    : fail('點錯一塊磚就換題了：' + JSON.stringify(sp.afterSlip))

  const allLines = out.seen.spell.lines
  allLines.length === 3
    ? ok('三條線的兵都真的上場了：' + allLines.join('、'))
    : fail('場上只有 ' + allLines.join('、'))

  // 升階
  out.tier2 === out.tier1 + 1
    ? ok(`升階鈕有用：${out.tier1} 階 → ${out.tier2} 階`)
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

  out.topTier === 3
    ? ok('頂階是三階，錢再多也買不到第四階')
    : fail(`頂階不是三階，變成 ${out.topTier} 階`)

  await page.screenshot({ path: SHOT + '-spell.png' })

  errors.length === 0 ? ok('沒有畫面錯誤') : fail('畫面錯誤：' + errors.slice(0, 3).join(' / '))
} catch (e) {
  fail('測試自己爆了：' + String(e).slice(0, 300))
} finally {
  await b.close()
}
console.log(bad ? '\n有項目沒過' : '\n三條線這一輪全過')
