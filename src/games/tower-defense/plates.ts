/**
 * 字牌排版。
 *
 * 牌子是拿來點的，所以它有兩個要求：**不能互相蓋住**（蓋住就點不到），
 * 而且**不能抖**（會動的東西點不準）。
 *
 * 舊版本每一格畫面都把位置和層數從頭算一次，而層數是照前後順序推出來的
 * （前面那個是第 0 層，我就是第 1 層）。怪一直在走，順序一換層數就整排翻，
 * 看起來就是牌子在飄。第 14 關最明顯：三條路在轉角會合，一堆怪擠在很窄的
 * 一段 x 裡，前後順序每一格都在變——而那正是最需要點得到的時候。
 *
 * 現在的做法：
 * 1. 先算一個「目標位置」，牌子每一格只往目標挪一小段，不瞬移。
 * 2. 層數用「站得住就別動」：原本那一層真的被擋住才換，旁邊的人走了才掉回來。
 * 3. 擠不擠是比兩個方框有沒有疊到，不是只比左右——左右一樣但差一層的
 *    兩塊牌子並沒有蓋住彼此。
 * 4. 不分路線一起算。分開算的話，會合處不同路線的牌子會直接疊在一起。
 *
 * 這一支故意不碰畫布也不碰遊戲狀態，因為「會不會飄」是量得出來的，
 * 不該靠眼睛看：tools/test/plate-jitter.mjs 直接餵它一段轉角的軌跡。
 */

/** 排版看得到的部分。真正的 Enemy 欄位更多，這裡只要這幾個。 */
export interface Plate {
  /** 本體在哪 */
  x: number
  y: number
  /** 牌子多寬 */
  pw: number
  /** 牌子現在畫在哪（會被改） */
  px: number
  /** 牌子這一格該去哪（會被改） */
  ptx: number
  /**
   * 牌子離本體左右多遠（會被改）。慢慢追的是這個，不是 px 本身：
   * 追 px 的話本體一直在走，牌子永遠落後一截，一轉彎落後的量就變，看起來就是在滑。
   */
  ox: number
  /** 牌子現在畫在本體下面多深（會被改）。換層的時候是滑過去，不是一格跳 32px。 */
  ty: number
  /** 第幾層（會被改） */
  tier: number
  /** 進場後第一次排版：牌子要直接出現在本體上，不能從畫面左邊滑進來 */
  laid: boolean
  /** 低的那一層已經空了幾格。掉層要等一下，不然兩塊牌子會互相讓來讓去 */
  hold: number
}

export interface PlateRules {
  /** 畫布寬度，牌子不能超出去 */
  width: number
  /** 牌子高度 */
  height: number
  /** 上下兩層差多少 */
  tierGap: number
  /** 牌子最多能離本體多遠 */
  reach: number
  /** 最多疊幾層 */
  tiers: number
  /** 每一格往目標挪多少（0~1）。1 就是瞬移，也就是舊版本的行為。 */
  ease: number
  /** 低的那一層要連續空這麼多格，牌子才掉下去 */
  settle: number
  /**
   * 掉層要多空出這麼多 px 才算「真的空了」。
   * 只有時間上的等待不夠：牌子在剛好擦邊的位置會一直在「空了／又不空」之間跳，
   * 等多久都一樣。要往下掉就得空得夠明顯。
   */
  slack: number
}

export const PLATE_RULES: PlateRules = {
  width: 1088, height: 28, tierGap: 32, reach: 46, tiers: 3, ease: 0.3, settle: 20, slack: 26,
}

/** 第 t 層的牌子畫在哪個高度 */
export function tierY(p: Plate, t: number, r: PlateRules = PLATE_RULES): number {
  return p.y + 4 + t * r.tierGap
}

/** 牌子這一格實際畫在哪個高度（換層途中會在兩層之間）。點擊也用這個，點得到看得到的地方。 */
export function plateY(p: Plate): number {
  return p.y + 4 + p.ty
}

/**
 * 把這一格的牌子排好。傳進來的東西會被就地改掉（每格都要跑，不配置新物件）。
 */
export function layoutPlates(list: Plate[], r: PlateRules = PLATE_RULES): void {
  if (!list.length) return
  // 這一格才第一次排到的牌子。它們不跟著慢慢挪，直接就位——
  // 不然剛出現的那一格會停在本體正上方，跟旁邊那塊疊到（量得到：兵推那邊 0.3% 的畫面）。
  const fresh = new Set<Plate>()
  for (const p of list) if (!p.laid) { p.laid = true; fresh.add(p); p.px = p.x; p.ptx = p.x; p.ox = 0 }

  // 推開要照左右順序算；**排層數不可以**——那是舊版本會飄的原因：
  // 兩隻怪一超車，前後順序就換，層數跟著整排翻。層數照傳進來的順序排
  // （＝出場順序，不會變），先來的先佔低的那一層。
  // 同一個 x 的時候用出場順序，**不可以用 y**：兩條路交叉（第 8 關）時兩隻怪 x 一樣、
  // y 一格一格交錯，用 y 排的話推開的方向每一格都在換，牌子就左右甩。
  const rank = new Map(list.map((p, i) => [p, i]))
  const order = [...list].sort((a, b) => a.x - b.x || rank.get(a)! - rank.get(b)!)

  // 目標位置：先貼著本體，再把擠在同一條高度帶上的往兩邊推開。
  for (const p of order) p.ptx = p.x
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = order[i], b = order[j]
        // 比的是**牌子那一排**的高度，不是本體的 y：已經分到上下兩層的牌子本來就沒蓋到，
        // 再左右推一次只會讓牌子平白離開本體——S 形路轉角那種「牌子掛在旁邊不回來」就是這樣。
        if (Math.abs(tierY(a, a.tier, r) - tierY(b, b.tier, r)) >= r.height + 4) continue
        const need = (a.pw + b.pw) / 2 + 6
        const gap = b.ptx - a.ptx
        if (Math.abs(gap) >= need) continue
        const push = (need - Math.abs(gap)) / 2
        // 往哪邊推：照牌子**現在畫在哪**，誰在左邊就繼續待左邊。只看本體的話，
        // 兩隻怪 x 幾乎一樣的時候（轉角、交叉）左右每一格都可能換，兩塊牌子就互甩。
        const side = Math.abs(b.px - a.px) > 2 ? b.px - a.px : gap
        if (side >= 0) { a.ptx -= push; b.ptx += push } else { a.ptx += push; b.ptx -= push }
      }
    }
    for (const p of order) {
      // 不能超出畫布，也不能離本體太遠——兩個夾限的順序很重要，
      // 反過來的話牌子會被拉進畫面裡，變成本體還沒出現就看得到答案。
      p.ptx = Math.max(p.pw / 2 + 3, Math.min(r.width - p.pw / 2 - 3, p.ptx))
      p.ptx = Math.max(p.x - r.reach, Math.min(p.x + r.reach, p.ptx))
    }
  }

  // 慢慢挪過去。怪一直在動，目標本來就一直在變，直接套上去就是抖。
  // 追過去的過程中也不准離本體太遠，不然轉角那一下會被甩出去。
  for (const p of order) {
    const want = p.ptx - p.x
    if (fresh.has(p)) p.ox = want
    else p.ox += (want - p.ox) * r.ease
    p.ox = Math.max(-r.reach, Math.min(r.reach, p.ox))
    p.px = p.x + p.ox
  }

  // 層數。排好的人佔住位置，後面的人先試自己原本那一層。
  const done: Plate[] = []
  for (const p of list) {
    const free = (t: number, margin = 0, at: 'px' | 'ptx' = 'px') => !done.some((o) =>
      Math.abs(o[at] - p[at]) < (o.pw + p.pw) / 2 + 2 + margin &&
      Math.abs(tierY(o, o.tier, r) - tierY(p, t, r)) < r.height + 4)
    // 擋住了沒，看的是**要去的位置**（ptx）不是現在的位置：左右推開要幾格才滑到，
    // 用現在的位置判斷的話，兩條路交叉時推開還沒滑到就先換層，牌子被往反方向拖下去再彈回來。
    // 推得開就讓它滑過去；推不開（離本體太遠了）才換層。
    if (!free(p.tier, 0, 'ptx')) {
      // 真的被擋住了才動，而且馬上就要動——蓋住的那一格就是點不到的那一格。
      // **先往上找**：被擋住就一路掉到底的話，會跟下面那塊立刻換位子再換回來。
      let t = -1
      for (let k = p.tier + 1; k < r.tiers; k++) if (free(k, 0, 'ptx')) { t = k; break }
      if (t < 0) for (let k = 0; k < p.tier; k++) if (free(k, 0, 'ptx')) { t = k; break }
      if (t >= 0) p.tier = t           // 每一層都被佔滿就先擠著，下一格通常就散了
      p.hold = 0
    } else {
      // 旁邊的人走了就掉回低的一層，不然牌子會一直飄在半空中。
      // 但要等一下再掉：擦身而過的那零點幾秒就掉下去，等一下又得讓回來。
      let t = 0
      while (t < p.tier && !free(t, r.slack)) t++
      if (t < p.tier && ++p.hold >= r.settle) { p.tier = t; p.hold = 0 }
      else if (t >= p.tier) p.hold = 0
    }
    done.push(p)
  }

  // 換層用滑的。層數本身（碰撞用的）是馬上換，畫面上的位置跟過去。
  for (const p of list) {
    const want = p.tier * r.tierGap
    p.ty = fresh.has(p) ? want : p.ty + (want - p.ty) * r.ease
    if (Math.abs(want - p.ty) < 0.3) p.ty = want
  }
}
