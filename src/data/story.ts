import type { LevelData } from '@/core/types'
import { SIDE_INFO, STAGES, stageOf } from './levels'
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
export type Speaker =
  | 'lumi' | 'morg' | 'shade' | 'boss1' | 'boss2' | 'boss3'
  | 'worm' | 'minotaur' | 'demon' | 'shadow' | 'lich' | 'frost' | 'cthulhu'
  | 'badger' | 'frog' | 'rex' | 'gorilla' | 'penguin'
export interface Line { who: Speaker; text: string }

/**
 * img：頭像用哪一張手繪（public/td-park/p-face-<img>.webp）。沒有手繪的（團戰魔王來守章尾的那幾隻）
 * 先用 face 的 emoji，美術解凍後再換。
 */
export const SPEAKERS: Record<Speaker, { name: string; face: string; img?: string }> = {
  lumi: { name: '露米', face: '🧚', img: 'lumi' },
  morg: { name: '暗影將軍莫爾格', face: '😈', img: 'morg' },
  shade: { name: '莫爾格的影子', face: '👤', img: 'morg' },
  boss1: { name: '哥布林大王', face: '👺', img: 'boss1' },
  boss2: { name: '冰霜雪怪王', face: '🥶', img: 'boss2' },
  boss3: { name: '犀牛酋長', face: '🦏', img: 'boss3' },
  worm: { name: '火焰巨蟲', face: '🐛' },
  minotaur: { name: '牛頭人', face: '🐂' },
  demon: { name: '惡魔史萊姆', face: '🟣' },
  shadow: { name: '暗影法師', face: '🌑' },
  lich: { name: '骷髏術士', face: '💀' },
  frost: { name: '寒冰守衛', face: '🧊' },
  cthulhu: { name: '深海克蘇魯', face: '🐙' },
  badger: { name: '蜜獾大王', face: '🦡' },
  frog: { name: '青蛙將軍', face: '🐸' },
  rex: { name: '暴龍', face: '🦖' },
  gorilla: { name: '大猩猩', face: '🦍' },
  penguin: { name: '企鵝老大', face: '🐧' },
}

/** 時光字典一共幾頁＝幾章，一隻章尾魔王拿著一頁 */
export const PAGES = STAGES.length

/** 選關大地圖上方那一條：這一章的故事（還在打寫 now，全破了寫 done） */
export const STAGE_STORY: Record<number, { now: string; done: string }> = {
  1: { now: '莫爾格打破了時光字典，哥布林大軍來搶草地城堡！火焰巨蟲拿著第一頁，躲在衣櫃那一站。',
    done: '拿回字典第 1 頁！哥布林往城外的路跑了。' },
  2: { now: '哥布林跑到城外的家、學校和街上。暴風雨裡的牛頭人抱著第 2 頁不放。',
    done: '拿回字典第 2 頁！最後一群哥布林躲進時間之塔。' },
  3: { now: '哥布林大王守在時間之塔頂端，打倒牠，草地城堡就安全了！',
    done: '草地城堡守住了！莫爾格帶著剩下的字典頁逃往北方的雪地神殿……' },
  4: { now: '雪地神殿是時光字典原本放的地方，現在整個結冰了。先從冰封的廚房開始，惡魔史萊姆黏在那裡。',
    done: '拿回字典第 4 頁！廚房的冰融了，裡面的房間還凍著。' },
  5: { now: '神殿裡的房間和住在裡面的人都被凍住了，暗影法師把大家的心情都變成黑的。',
    done: '拿回字典第 5 頁！大家醒過來了，說學校那邊也出事了。' },
  6: { now: '神殿的學校長滿冰柱，骷髏術士偷走了課本和節日。',
    done: '拿回字典第 6 頁！往神殿後山的路被暴風雪擋住了。' },
  7: { now: '暴風雪山道又長又冷，寒冰守衛把天氣和時間都凍住了。撐過去！',
    done: '拿回字典第 7 頁！山道後面是一片結冰的湖……湖面下好像有什麼在動。' },
  8: { now: '結冰的湖底，深海克蘇魯爬上來了，擋住通往神殿深處的路。',
    done: '拿回字典第 8 頁！湖對岸出現一個黑黑的影子……是莫爾格嗎？' },
  9: { now: '莫爾格終於出手了！雖然只是牠的影子，也很難纏。',
    done: '影子散掉了，可是莫爾格本人還在神殿最裡面。' },
  10: { now: '神殿最深處，冰霜雪怪王守著最後幾頁字典。把神殿整個解凍吧！',
    done: '神殿的冰融化了！可是莫爾格帶著最後幾頁字典，逃進南方的草原木堡。' },
  11: { now: '草原上的動物部落被莫爾格的黑魔法控制了。入口的蜜獾大王什麼都不怕。',
    done: '拿回字典第 11 頁！前面是一座木堡小鎮。' },
  12: { now: '木堡小鎮的學校被青蛙將軍佔了，舌頭一伸就把課本吞下去。',
    done: '拿回字典第 12 頁！天邊烏雲密布，風暴要來了。' },
  13: { now: '風暴草原上，戴著生日帽的暴龍脾氣一點都不可愛。',
    done: '拿回字典第 13 頁！風停了，遠處傳來咚咚咚的鼓聲。' },
  14: { now: '猛獸部落的大猩猩一拳就能把人嚇跑，牠也被黑魔法控制了。',
    done: '拿回字典第 14 頁！整片草原的動物開始往同一個方向跑……' },
  15: { now: '動物大遷徙！企鵝老大戴著墨鏡，指揮整群動物擋路。',
    done: '拿回字典第 15 頁！前面就是犀牛族的木堡。' },
  16: { now: '犀牛酋長守著木堡大門。牠看起來很兇，可是眼睛好像在發黑光……',
    done: '犀牛酋長清醒了，原來牠是被控制的！犀牛族幫你撞開最後一座木堡的門。' },
  17: { now: '最後的木堡，莫爾格就在裡面，最後一頁字典在牠手上。最後三站，衝！',
    done: '莫爾格被打敗，時光字典拼回來了，時空裂縫也關起來了。你是真正的守護者！' },
}

/** 舊名字：選關地圖以前一篇一條。現在照章，留著給還沒改的地方用。 */
export const CHAPTER_STORY: Record<1 | 2 | 3, { foe: string; now: string; done: string }> = {
  1: { foe: '👺', now: STAGE_STORY[1].now, done: STAGE_STORY[3].done },
  2: { foe: '🥶', now: STAGE_STORY[4].now, done: STAGE_STORY[10].done },
  3: { foe: '🦏', now: STAGE_STORY[11].now, done: STAGE_STORY[17].done },
}

const L = (who: Speaker, text: string): Line => ({ who, text })

/** 每一篇第一關（第 1、4、11 章的開頭） */
const REGION_OPENING: Record<1 | 2 | 3, Line[]> = {
  1: [
    L('lumi', '守護者，你終於來了！我是時光小精靈露米。'),
    L('morg', '哼哼……時光字典被我撕成十七頁了！沒有人讀得懂魔法單字，就沒有人擋得住我的大軍！'),
    L('lumi', '暗影將軍莫爾格把字典撕了，每一頁都被一隻魔王拿走。每打倒一隻，就拿回一頁！'),
    L('lumi', '看上面的中文，點出寫著那個英文字的怪，塔就會幫你射牠。我們一起守住城堡！'),
  ],
  2: [
    L('lumi', '好冷！莫爾格逃到北方，把雪地神殿整個凍起來了。'),
    L('boss2', '吼——神殿裡的單字魔法，全部是我的冰塊了！'),
    L('lumi', '這裡是字典本來放的地方，一共有七頁在神殿裡。這一篇開始可以蓋「冰霜塔」，還會遇到會飛的蝙蝠。'),
  ],
  3: [
    L('lumi', '神殿解凍了！可是莫爾格帶著最後七頁字典，跑進草原上的木堡。'),
    L('morg', '守護者，你走不到最後一座木堡的。我在那裡等你。'),
    L('lumi', '這一篇可以蓋「砲台」了，專門對付盾牌和魔王。草原的動物好像都被控制了，小心！'),
  ],
}

/** 其他章的第一關：露米交代這一章要去哪 */
const STAGE_OPENING: Record<number, Line[]> = {
  2: [L('lumi', '哥布林往城外跑了！這一章去家裡、學校和街上把牠們趕走。')],
  3: [L('lumi', '最後一群哥布林躲進時間之塔，哥布林大王就在塔頂！')],
  5: [L('lumi', '廚房後面的房間也凍住了，住在裡面的人都睡著了。我們去叫醒他們！')],
  6: [L('lumi', '神殿的學校長滿了冰柱，課本都被偷走了。')],
  7: [L('lumi', '這條山道比較長，暴風雪很大。累了就休息一下，字典第 7 頁在山頂！')],
  8: [L('lumi', '湖結冰了……噓，冰下面好像有東西在游。')],
  9: [L('shade', '守護者，你拿回太多頁了。我先讓你看看我的影子有多強！'), L('lumi', '是莫爾格的影子！牠只是分身，打得倒的！')],
  10: [L('lumi', '神殿最深處到了。冰霜雪怪王守著這裡，打倒牠神殿就整個解凍！')],
  12: [L('lumi', '前面是木堡小鎮，鎮上的學校被佔了。')],
  13: [L('lumi', '風好大！暴風要來了，塔蓋穩一點。')],
  14: [L('lumi', '聽，咚咚咚的鼓聲……是猛獸部落。牠們眼睛都在發黑光，是被控制了！')],
  15: [L('lumi', '整片草原的動物都在跑！不要被嚇到，一隻一隻來。')],
  16: [L('lumi', '犀牛族的木堡到了。犀牛酋長好像也被控制了……打倒牠說不定能讓牠清醒。')],
  17: [L('morg', '居然走到這裡了？最後一頁在我手上，有本事就來拿！'), L('lumi', '最後三站！拿回最後一頁，時空裂縫就能關起來！')],
}

/** 章尾魔王開打前的嗆聲 */
const FOE_TAUNT: Record<number, string> = {
  1: '衣櫃裡的衣服都是我的點心！字典這一頁也是！',
  2: '暴風雨是我叫來的，這一頁你拿不走！',
  3: '這座塔是哥布林的！誰都別想上來！',
  4: '黏黏黏～廚房每個角落都是我的，字典也黏住了！',
  5: '大家的心情都是黑的，你也一起變黑吧！',
  6: '課本和節日都在我的骷髏手裡，想要就來搶啊！',
  7: '天氣和時間都凍住了，你也會被凍住！',
  8: '我從湖底爬上來，所有的路都被我擋住了！',
  9: '我只是影子，可是影子也能把你吞掉！',
  10: '吼——神殿最後的冰，是我最硬的冰！',
  11: '我什麼都不怕！字典？我拿來墊屁股！',
  12: '咕呱！課本好好吃，字典這一頁也吃掉！',
  13: '今天是我生日，這一頁字典是我的禮物！',
  14: '一拳！就一拳！把你嚇回家！',
  15: '整座城都歸我管，這片草原也是！',
  16: '這片草原是我們犀牛族的！想過去？先撞倒我再說！',
  17: '十七頁？你拿回再多頁也沒用，最後一頁永遠是我的！',
}

/** 章尾魔王倒下說的話 */
const FOE_DOWN: Record<number, string> = {
  1: '嗚……衣櫃還給你……', 2: '雨……停了……', 4: '黏、黏不住了……', 5: '心情……怎麼變亮了……',
  6: '骨頭……散了……', 7: '冰……化了……', 8: '我回湖底了啦……', 9: '影子……散了……',
  11: '好啦好啦，我怕了……', 12: '呱……吐出來了……', 13: '生日……不快樂……', 14: '你……比我還強……',
  15: '墨鏡……掉了……',
}

/** 每篇最後一章打贏 */
const REGION_FINALE: Record<number, Line[]> = {
  3: [
    L('boss1', '可、可惡……城堡居然守住了……'),
    L('morg', '沒用的傢伙！我去北方的神殿，看你們追不追得上！'),
    L('lumi', '拿回字典第 3 頁，草地城堡安全了！下一站：雪地神殿。'),
  ],
  10: [
    L('boss2', '冰……冰在融化……'),
    L('lumi', '拿回字典第 10 頁，神殿的單字魔法都回來了！莫爾格往草原逃了，我們追！'),
  ],
  16: [
    L('boss3', '咦？我怎麼了……原來我被莫爾格的黑魔法控制了！'),
    L('boss3', '謝謝你，守護者！犀牛族幫你撞開最後一座木堡的門！'),
    L('lumi', '拿回字典第 16 頁，還交到新朋友！只剩最後一頁了。'),
  ],
  17: [
    L('morg', '不可能……這麼多單字，你全部都讀得懂？'),
    L('lumi', '十七頁全部拿回來了！時光字典拼好，時空裂縫關起來了！'),
    L('lumi', '你學會的每一個字，都是守護這個世界的魔法。謝謝你，守護者。以後隨時回來，我們再一起冒險！'),
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

/** 這一章的章尾魔王（levels.ts STAGES 的 foe 就是 Speaker 的名字） */
const foeOf = (stage: number): Speaker => STAGES[stage - 1].foe as Speaker

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
  const side = level.rules.side
  if (side) {
    const info = SIDE_INFO[side.kind]
    const out = [L('lumi', `${info.icon} 趣味關「${info.name}」！${info.rule}`)]
    if (side.kind === 'rescue') out.unshift(L('morg', '露米是我的了！把露米關進籠子，運回我的城堡！'))
    if (side.kind === 'gold') out.push(L('lumi', '這一關不考你守城，考你手快。答對越多，時光幣越多！'))
    return out
  }
  const st = stageOf(level.no)
  const out: Line[] = []
  if (level.no === st.from) {
    if (st.no === 1 || st.no === 4 || st.no === 11) out.push(...REGION_OPENING[st.region])
    else out.push(...(STAGE_OPENING[st.no] ?? []))
  }
  for (const n of newcomers(level)) {
    out.push(L('lumi', `${n.tower ? '新的塔可以蓋了' : '小心，新的怪出現了'}：${n.badge} ${n.name}！${n.desc}`))
  }
  if (level.isBoss && level.rules.boss) {
    const b = foeOf(st.no)
    out.push(L(b, FOE_TAUNT[st.no] ?? '這一站歸我管，誰都別想過去！'))
    for (const s of level.rules.boss.skills ?? []) out.push(...SKILL_LINE[s](b))
    if ((level.rules.boss.skills?.length ?? 0) > 1)
      out.push(L('lumi', `這隻魔王會兩招：${level.rules.boss.skills!.map((s) => BOSS_SKILL_NAME[s]).join('和')}。塔多蓋幾座、多升級！`))
  }
  if (!out.length && TAUNT[level.no]) out.push(...TAUNT[level.no])
  return out
}

/** 打贏之後要說的話：章尾魔王倒下、拿回一頁字典、丟一個下一章的鉤子 */
export function storyAfter(level: LevelData): Line[] {
  if (level.rules.side) {
    return [L('lumi', level.rules.side.kind === 'rescue' ? '謝謝你救了我！我們回主線繼續冒險吧！' : '好好玩！趣味關打完了，回主線繼續冒險吧！')]
  }
  const st = stageOf(level.no)
  if (level.no === st.to && REGION_FINALE[st.no]) return REGION_FINALE[st.no]
  if (level.isBoss) {
    const out: Line[] = [
      L(foeOf(st.no), FOE_DOWN[st.no] ?? '嗚……這一站讓給你了……'),
      L('lumi', `拿回時光字典第 ${st.no} 頁了！（${st.no}／${PAGES}）`),
    ]
    if (level.no === st.to) {
      const hook = STAGE_STORY[st.no].done.replace(/^拿回字典第 \d+ 頁！/, '')
      if (hook) out.push(L('lumi', hook))
    }
    return out
  }
  return []
}
