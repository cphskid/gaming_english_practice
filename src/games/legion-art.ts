import type { LegionDef, LegionLine } from '@/data/legions'
import { legionUnitArt } from '@/data/legions'
import VS_UNITS from '@/data/vs-units.json'

/**
 * 軍團的提案二手繪圖（2026-10-11 Chuck：「都換吧」）。對戰、團戰、守塔共用。
 * 圖在 public/td-park/vs/（art/guardian/gen_vs.py、gen_legions.py → cut_vs_units.py、cut_legions.py），
 * td-art.json 的鍵＝vs-<檔名>：
 *   兵   vs-u-spear（王國軍）、vs-pig-u-bow3（豬軍團聽音三階＝大砲）…，6 格：0 站、1-2 走、3-5 打
 *   小圖 vs-icon-<同上去掉 vs->，選兵鈕用
 *   城堡 vs-<軍團>-castle、塔 vs-<軍團>-tower（怪物小隊、元素大師沒有，用王國軍的）
 *   戰場 vs-<軍團>-field（豬、兩套海盜這種室內系的）；其他用 vs-field
 * 王國軍當對手時是紅的（-red，cut_vs.py 換色）。
 */
const UNITS = VS_UNITS as Record<string, { frames: number; anchor: number }>

/** 'pig_' → 'pig-'，王國軍是空字串 */
export const legionSlug = (l: LegionDef) => l.prefix.replace(/_$/, '-')

/** 某軍團某條線第幾階的兵：動作表的鍵（不含 -red）。art 是 LINES[line].art（u_spear…） */
export function unitKey(l: LegionDef, line: LegionLine, art: string, rank: number): string {
  const base = legionUnitArt(l, line, art, rank).slice(l.prefix.length)   // u_bow3
  return 'vs-' + legionSlug(l) + base.replace(/_/g, '-')
}
/** 腳底在一格裡的橫向位置（量過的），沒量過就 0.45 */
export const unitAnchor = (key: string) => UNITS[key]?.anchor ?? 0.45
export const iconKey = (key: string) => key.replace(/^vs-/, 'vs-icon-')

export const castleKey = (l: LegionDef, foe: boolean) => {
  const s = legionSlug(l)
  return s && UNITS_HAS_BASE.has(s) ? `vs-${s}castle` : foe ? 'vs-castle-red' : 'p-castle'
}
export const towerKey = (l: LegionDef, foe: boolean) => {
  const s = legionSlug(l)
  return s && UNITS_HAS_BASE.has(s) ? `vs-${s}tower` : foe ? 'vs-archery-red' : 'p-archery'
}
export const fieldKey = (l: LegionDef) => (l.field === 'castle' ? `vs-${legionSlug(l)}field` : 'vs-field')
/** 有自己城堡和塔的軍團 */
const UNITS_HAS_BASE = new Set(['gob-', 'pig-', 'pb-', 'th-'])

/** 這個 td-art 鍵是不是只屬於別的軍團（載圖時跳過，不跟這一場搶頻寬） */
const ALL_SLUGS = ['gob-', 'pig-', 'pb-', 'th-', 'mc-', 'el-']
export function otherLegionKey(k: string, mine: string[]): boolean {
  const s = ALL_SLUGS.find((x) => k.startsWith('vs-' + x) || k.startsWith('vs-icon-' + x))
  return !!s && !mine.includes(s)
}
