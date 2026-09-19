import type { Word } from '@/core/types'
import raw from '../../data/core300.json'

/**
 * 300 字核心題庫，取自十二年國教課綱附錄五。
 * **程式一律用 id 當鍵，不要用單字字串**——同一個字之後可能有不同詞性或不同題型。
 */
export const WORDS: Word[] = (raw as { words: Word[] }).words

export const WORDS_BY_ID: Map<number, Word> = new Map(WORDS.map((w) => [w.id, w]))

export const THEMES: string[] = [...new Set(WORDS.map((w) => w.theme))]

export const THEME_NAME: Record<string, string> = {
  numbers: '數字', colors: '顏色', body: '身體', animals: '動物',
  food: '食物', tableware: '餐具', clothing: '衣服', house: '家裡',
  family: '家人', school: '學校', places: '地方', transportation: '交通',
  sports: '運動', jobs: '職業', weather: '天氣', feelings: '感覺',
  adjectives: '形容詞', verbs: '動作', time: '時間', 'wh-words': '疑問詞',
}

export function wordsOfThemes(themes: string[]): Word[] {
  if (!themes.length) return WORDS
  return WORDS.filter((w) => themes.includes(w.theme))
}
