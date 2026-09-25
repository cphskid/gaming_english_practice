import type { Word } from '@/core/types'
import raw from '../../data/words2000.json'

/**
 * 題庫：課綱附錄五的 2,000 字，分三層（三章）。
 *   第 1 層 id 1～300：國小核心 300 字（data/core300.json 的原樣）
 *   第 2 層：基本 1,200 字裡剩下的
 *   第 3 層：其他常用 800 字
 * **程式一律用 id 當鍵，不要用單字字串**——May／may、Miss／miss 這種在題庫裡是兩個字。
 * 字數不要寫死：之後題庫還會再調，數字一律從這裡算。
 */
export const WORDS: Word[] = (raw as unknown as { words: Word[] }).words

export const WORDS_BY_ID: Map<number, Word> = new Map(WORDS.map((w) => [w.id, w]))

/**
 * 國小核心 300 字。守塔以外的遊戲（兵推、分身、真人對戰、魔王團戰）先只出這一層：
 * 那些遊戲不分章，全部 2,000 字丟進去的話，國小生會在對戰裡一直撞到國中字。
 */
export const CORE_WORDS: Word[] = WORDS.filter((w) => w.tier === 1)

export const THEMES: string[] = [...new Set(WORDS.map((w) => w.theme))]

export const THEME_NAME: Record<string, string> = {
  numbers: '數字', colors: '顏色', body: '身體', animals: '動物',
  food: '食物', tableware: '餐具', clothing: '衣服', house: '家裡',
  family: '家人', school: '學校', places: '地方', transportation: '交通',
  sports: '運動', jobs: '職業', weather: '天氣', feelings: '感覺',
  adjectives: '形容詞', verbs: '動作', time: '時間', 'wh-words': '疑問詞',
  // 第二、三章多出來的主題（課綱表三）
  people: '人物', traits: '個性外表', health: '健康', money: '金錢',
  sizes: '大小與形狀', countries: '國家語言', holidays: '節慶', geography: '地理',
  nouns: '名詞', adverbs: '副詞',
  pronouns: '代名詞', auxiliaries: '助動詞', prepositions: '介系詞', conjunctions: '連接詞',
}

/** 只看核心 300 字：守塔以外的遊戲用（見 CORE_WORDS）。 */
export function wordsOfThemes(themes: string[]): Word[] {
  if (!themes.length) return CORE_WORDS
  return CORE_WORDS.filter((w) => themes.includes(w.theme))
}

/** 這一關要考的字：第二、三章照 wordIds，第一章照主題。 */
export function wordsOfLevel(l: { themes: string[]; wordIds?: number[] }): Word[] {
  if (l.wordIds?.length) return l.wordIds.map((id) => WORDS_BY_ID.get(id)!).filter(Boolean)
  return wordsOfThemes(l.themes)
}
