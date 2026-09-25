import type { Job } from '@/core/types'

/**
 * 職業效果。
 *
 * **鐵則：職業改的是「答對之後那一發怎麼分配」，不是「你有多強」。**
 * 十四關的難度是用「每分鐘要答對幾題」回推出來的，血量與出怪間隔都是從
 * 齊射傷害算的（見 data/levels.ts 的 volleyOf）。所以職業不能單純加傷害，
 * 不然十四關的數值全部要重算，而且弱的那個職業會變成沒人選。
 *
 * 兩個職業的**輸出總量相當**，差在形狀：
 * - 騎士打魔王特別痛，小兵照常
 * - 法師把同一發散給附近的怪，一次清一群小兵快，但單打獨鬥比較弱
 *
 * 數字由 tools/test/job-balance.mjs 實際跑十四關量出來，不是憑感覺訂的。
 * 量到的第一件事就推翻了原本的想法：騎士只要「每一發乘 1.05」，
 * 十四關的通關門檻就整整掉了快兩題／分——單純加倍率這條路是死的，
 * 差別只能做在**什麼時候強**，不能做在**一直比較強**。
 *
 * 現在這組量到的結果（門檻＝每分鐘要答對幾題才過得去，跟無職業的基準比）：
 *   騎士 -0.14 題／分，法師 0.00 題／分  ← 十四關的難度沒被職業改掉
 *   法師在怪多的關卡省 2~11 題／分，三個魔王關各多花 7 題／分
 *   騎士整條線都跟基準一樣，差別在魔王掉得快（1.8 倍）
 * 改這裡的數字之後請重跑一次 job-balance.mjs，不要用手感決定。
 */
export interface JobEffect {
  /** 主要目標吃到的倍率 */
  focus: number
  /** 濺射半徑，0 代表沒有濺射 */
  splash: number
  /** 濺射範圍內其他怪吃到的倍率 */
  splashShare: number
  /** 最多濺射到幾隻，避免一發清場 */
  splashMax: number
  /** 打魔王時額外乘這個倍率。騎士的專長就在這裡。 */
  bossBonus: number
}

export const JOB_EFFECT: Record<Job, JobEffect> = {
  // 這兩組數字是 --tune 掃出來的：兩個職業跑完十四關，通關門檻跟
  // 「沒有職業」的基準相比分別差 -0.14 與 0.00 題／分，等於沒動到難度。
  knight: { focus: 1, splash: 0, splashShare: 0, splashMax: 0, bossBonus: 1.8 },
  mage: { focus: 0.85, splash: 140, splashShare: 0.3, splashMax: 3, bossBonus: 1 },
}

/** 給小朋友看的說明，不要寫倍率，寫「什麼時候好用」。 */
export const JOB_BLURB: Record<Job, string> = {
  knight: '一劍砍一隻。打魔王特別痛，魔王關好用。',
  mage: '一發打一片，旁邊的怪也會受傷。怪很多的時候好用，單挑比較吃力。',
}

/** 頭像搬到 data/avatars.ts 了（2026-09-25 換成職業各四張＋商店賣）。 */
export { avatarSrc } from './avatars'
