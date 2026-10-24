import type { LevelData } from '@/core/types'
import { ENEMIES, ENEMY_KINDS, BOSS_SKILL_NAME } from './enemies'
import { TOWERS, TOWER_ORDER } from './towers'

/**
 * 劇情（2026-10-24，「讓守護異世界玩法更有變化」串，Chuck 選方案五）。
 *
 * 給「繼續往下打」一個理由：暗影將軍莫爾格打開時空裂縫，三章各佔了一個地方，
 * 時光小精靈露米陪你一路把它們搶回來，第 85 關跟莫爾格本人決戰。
 *
 * 只在三種時候說話，免得每一關都被對話卡住：
 *   1. 每章第一關、每章最後一關
 *   2. 魔王關（開打前魔王嗆聲＋露米提醒招式，打贏後一句）
 *   3. 有新怪或新塔登場的那一關（露米介紹）
 * 同一關的劇情只自動播一次（看過記在瀏覽器裡），之後可以從關卡裡的「📜」再看。
 *
 * 頭像先用 emoji 暫代，美術解凍後換成手繪頭像（清單在提案文件最後一節）。
 */
export type Speaker = 'lumi' | 'morg' | 'boss1' | 'boss2' | 'boss3'
export interface Line { who: Speaker; text: string }

export const SPEAKERS: Record<Speaker, { name: string; face: string }> = {
  lumi: { name: '露米', face: '🧚' },
  morg: { name: '暗影將軍莫爾格', face: '😈' },
  boss1: { name: '哥布林大王', face: '👺' },
  boss2: { name: '冰霜雪怪王', face: '🥶' },
  boss3: { name: '犀牛酋長', face: '🦏' },
}

/** 選關大地圖上方那一條：這一章的故事 */
export const CHAPTER_STORY: Record<1 | 2 | 3, { foe: string; now: string; done: string }> = {
  1: {
    foe: '👺',
    now: '莫爾格打開了時空裂縫，哥布林大軍正在搶草地城堡！一站一站把旗子插回去吧。',
    done: '草地城堡守住了！莫爾格逃往北方的雪地神殿……',
  },
  2: {
    foe: '🥶',
    now: '雪地神殿被冰霜雪怪王凍住了，神殿裡的單字魔法全部結冰。把它們一個一個解凍！',
    done: '神殿的冰融化了！莫爾格帶著殘兵躲進草原上的木堡。',
  },
  3: {
    foe: '🦏',
    now: '草原木堡被犀牛酋長和鬣狗強盜佔領，莫爾格就躲在最後一座木堡裡。',
    done: '莫爾格被打敗，時空裂縫關起來了。你是真正的守護者！',
  },
}

const L = (who: Speaker, text: string): Line => ({ who, text })
const bossOf = (ch: 1 | 2 | 3): Speaker => (ch === 1 ? 'boss1' : ch === 2 ? 'boss2' : 'boss3')

/** 每章第一關 */
const OPENING: Record<1 | 2 | 3, Line[]> = {
  1: [
    L('lumi', '守護者，你終於來了！我是時光小精靈露米。'),
    L('morg', '哼哼……沒有人讀得懂魔法單字，就沒有人擋得住我的大軍！'),
    L('lumi', '暗影將軍莫爾格打開了時空裂縫，哥布林要來搶草地城堡了！'),
    L('lumi', '看上面的中文，點出寫著那個英文字的怪，塔就會幫你射牠。我們一起守住城堡！'),
  ],
  2: [
    L('lumi', '好冷！莫爾格逃到北方，把雪地神殿整個凍起來了。'),
    L('boss2', '吼——神殿裡的單字魔法，全部是我的冰塊了！'),
    L('lumi', '別擔心，這一章開始可以蓋「冰霜塔」，還會遇到會飛的蝙蝠。我會在旁邊提醒你。'),
  ],
  3: [
    L('lumi', '神殿解凍了！可是莫爾格帶著殘兵跑進草原上的木堡。'),
    L('boss3', '這片草原是我們犀牛族的！想過去？先撞倒我再說！'),
    L('morg', '守護者，你走不到最後一座木堡的。我在那裡等你。'),
    L('lumi', '這一章可以蓋「砲台」了，專門對付盾牌和魔王。最後一站就是莫爾格！'),
  ],
}

/** 每章最後一關打贏 */
const FINALE: Record<1 | 2 | 3, Line[]> = {
  1: [
    L('boss1', '可、可惡……城堡居然守住了……'),
    L('morg', '沒用的傢伙！我去北方的神殿，看你們追不追得上！'),
    L('lumi', '草地城堡安全了！下一站：雪地神殿。'),
  ],
  2: [
    L('boss2', '冰……冰在融化……'),
    L('lumi', '神殿的單字魔法都回來了！莫爾格往草原逃了，我們追！'),
  ],
  3: [
    L('morg', '不可能……這麼多單字，你全部都讀得懂？'),
    L('lumi', '時空裂縫關起來了！你學會的每一個字，都是守護這個世界的魔法。'),
    L('lumi', '謝謝你，守護者。以後隨時回來，我們再一起冒險！'),
  ],
}

/** 中途莫爾格出來嗆一下（不是魔王關、也不是新東西登場的時候才用得到） */
const TAUNT: Record<number, Line[]> = {
  8: [L('morg', '城堡外面的路有好幾條，你顧得過來嗎？'), L('lumi', '塔蓋在兩條路中間，兩邊都打得到！')],
  37: [L('morg', '神殿越裡面，單字越難。你遲早會讀錯的！'), L('lumi', '讀錯沒關係，再看一次就好。我們繼續！')],
  70: [L('morg', '我的木堡只剩一半了？哼，最後那幾座你過不去的。'), L('lumi', '快到了！把塔升級，留水晶給魔王關。')],
}

const SKILL_LINE: Record<string, (b: Speaker) => Line[]> = {
  summon: (b) => [L(b, '出來吧，我的狼群！'), L('lumi', '牠會一直叫快跑狼出來，狼一出現就先點狼！')],
  shield: (b) => [L(b, '血少一半，我就張開冰盾！'), L('lumi', '冰盾跟盾牌兵一樣：兩座塔一起打，或用砲台打，一下就碎。')],
  charge: (b) => [L(b, '看我衝過去！'), L('lumi', '牠會突然往前衝，塔要蓋在靠近城堡的地方接住牠。')],
}

/** 這一關新登場的東西（新怪、新塔），露米來介紹 */
export function newcomers(level: LevelData): { badge: string; name: string; desc: string; tower: boolean }[] {
  const out: { badge: string; name: string; desc: string; tower: boolean }[] = []
  for (const k of ENEMY_KINDS) {
    const e = ENEMIES[k]
    if (e.from === level.no) out.push({ badge: e.badge, name: e.name, desc: e.desc, tower: false })
  }
  for (const k of TOWER_ORDER) {
    const t = TOWERS[k]
    if (t.from === level.no) out.push({ badge: t.badge ?? t.emoji, name: t.name, desc: t.desc, tower: true })
  }
  return out
}

/** 開打前要說的話 */
export function storyBefore(level: LevelData): Line[] {
  const ch = level.chapter
  const first = level.no === (ch === 1 ? 1 : ch === 2 ? 15 : 53)
  const out: Line[] = first ? [...OPENING[ch]] : []
  for (const n of newcomers(level)) {
    out.push(L('lumi', `${n.tower ? '新的塔可以蓋了' : '小心，新的怪出現了'}：${n.badge} ${n.name}！${n.desc}`))
  }
  if (level.isBoss && level.rules.boss) {
    const b = bossOf(ch)
    out.push(L(b, `「${level.name.replace(/魔王$/, '')}」這一站歸我管，誰都別想過去！`))
    for (const s of level.rules.boss.skills ?? []) out.push(...SKILL_LINE[s](b))
    if ((level.rules.boss.skills?.length ?? 0) > 1)
      out.push(L('lumi', `這隻魔王會兩招：${level.rules.boss.skills!.map((s) => BOSS_SKILL_NAME[s]).join('和')}。塔多蓋幾座、多升級！`))
  }
  if (!out.length && TAUNT[level.no]) out.push(...TAUNT[level.no])
  return out
}

/** 每章最後一關的編號 */
const LAST: Record<1 | 2 | 3, number> = { 1: 14, 2: 52, 3: 85 }

/** 打贏之後要說的話 */
export function storyAfter(level: LevelData): Line[] {
  const ch = level.chapter
  if (level.no === LAST[ch]) return FINALE[ch]
  if (level.isBoss) {
    return [
      L(bossOf(ch), '嗚……這一站讓給你了……'),
      L('lumi', '打贏魔王了！這一站的旗子插回來了。'),
    ]
  }
  return []
}
