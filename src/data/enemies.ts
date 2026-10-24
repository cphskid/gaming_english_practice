/**
 * 怪物種類（2026-10-24，「讓守護異世界玩法更有變化」串，Chuck 選方案一）。
 *
 * 原本整個遊戲只有「每章一隻哥布林（紅紫換色）＋放大的食人魔王」，玩到第 15 關之後
 * 就沒有新東西要想了。這裡加六種怪，**每一種都要讓玩家改變「先答哪一隻、塔蓋哪裡」**，
 * 但攻擊還是只來自答對——沒有任何一種怪可以不讀字就打掉。
 *
 * 難度怎麼守住：血量與速度都是乘在那一關原本算好的數字上（見 data/levels.ts 的 waves），
 * 倍率由 `node tools/test/job-balance.mjs --variety` 量出來，不是憑手感。
 *
 * 美術還在暫停（Chuck 2026-10-08：守護異世界美術先緩），所以先用現有的哥布林換色＋
 * 頭上一個小圖示當暫代。要畫的正式圖列在「讓中後段不膩的提案」那份文件最後一節。
 */
export type EnemyKind = '' | 'wolf' | 'shield' | 'bat' | 'slime' | 'shaman' | 'ghost'

export interface EnemySpec {
  name: string
  /** 暫代圖示（正式圖出來之前畫在頭上） */
  badge: string
  /** 給小朋友看的一句話：牠會做什麼、你該怎麼辦 */
  desc: string
  hpMul: number
  speedMul: number
  /** 畫多大（1＝一般哥布林） */
  scale: number
  /** 暫代換色：蓋在哥布林圖上的顏色 */
  tint: string
  /** 從第幾關開始出現 */
  from: number
}

export const ENEMIES: Record<Exclude<EnemyKind, ''>, EnemySpec> = {
  wolf: {
    name: '快跑狼', badge: '🐺', tint: '#8a8a9a', scale: 0.85, from: 6,
    desc: '跑得很快、血比較少。牠一出現就先點牠！',
    hpMul: 0.6, speedMul: 1.55,
  },
  shield: {
    name: '盾牌兵', badge: '🛡️', tint: '#7b8fa8', scale: 1.05, from: 11,
    desc: '拿著盾牌：只有一座塔打牠，那一發只會打破盾。兩座以上的塔一起打，盾直接碎掉。',
    hpMul: 0.8, speedMul: 0.9,
  },
  bat: {
    name: '飛行蝙蝠', badge: '🦇', tint: '#5a3d7a', scale: 0.8, from: 16,
    desc: '會飛，軍營的士兵擋不住牠，只能靠塔打下來。',
    hpMul: 0.8, speedMul: 1.1,
  },
  slime: {
    name: '分裂史萊姆', badge: '🟢', tint: '#4fbf5a', scale: 1, from: 23,
    desc: '打倒之後會分成兩隻小的，各自帶一個新的字。',
    hpMul: 0.5, speedMul: 0.9,
  },
  shaman: {
    name: '治療巫師', badge: '🔮', tint: '#b05ad0', scale: 1, from: 33,
    desc: '每隔幾秒幫旁邊的怪補血。看到牠要優先打！',
    hpMul: 0.9, speedMul: 0.85,
  },
  ghost: {
    name: '聽音幽靈', badge: '👻', tint: '#cfe6ff', scale: 1, from: 42,
    desc: '問到牠的時候不給中文，只念英文給你聽：聽到哪個字，就點寫著那個字的怪。',
    hpMul: 1, speedMul: 1,
  },
}

export const ENEMY_KINDS = Object.keys(ENEMIES) as Exclude<EnemyKind, ''>[]

/**
 * 史萊姆分裂出來的小史萊姆：各帶原本最大血量的幾成、走得多慢。
 * 小的一定一發就倒，難的是「多兩個字要讀」，所以走慢一點，留時間讀
 * （量過：小史萊姆跟大的一樣快時，牠登場那幾關門檻多 5～8 題／分）。
 */
export const SLIME_CHILD_HP = 0.2
export const SLIME_CHILD_SPEED = 0.65
/** 巫師多久補一次血、補多遠、補最大血量的幾成 */
export const SHAMAN = { every: 4, radius: 130, heal: 0.15 }

/**
 * 魔王招式。魔王原本只是一隻血很厚的大哥布林，現在每一章的魔王會一招：
 *   第一章 召喚：每隔一段時間叫兩隻快跑狼出來
 *   第二章 冰盾：血掉到一半時張開冰盾（跟盾牌兵一樣要打破）
 *   第三章 衝刺：每隔一段時間往前衝一小段
 * 第 10 關之後的魔王（難度刻度 > 9）會兩招。
 */
export type BossSkill = 'summon' | 'shield' | 'charge'
export const BOSS_SKILL_NAME: Record<BossSkill, string> = {
  summon: '召喚小狼', shield: '冰盾', charge: '衝刺',
}
export const BOSS_SKILL = {
  summonEvery: 11,
  chargeEvery: 7,
  chargeSeconds: 1.2,
  chargeSpeed: 2.6,
}

/** 這一關有哪些怪（不含一般哥布林），新登場介紹卡用 */
export function kindsUnlockedAt(levelNo: number): Exclude<EnemyKind, ''>[] {
  return ENEMY_KINDS.filter((k) => ENEMIES[k].from <= levelNo)
}
