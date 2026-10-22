/**
 * 把遊戲裡的成就徽章畫成 SVG，給樂園的徽章牆用（2026-10-10 徽章搬到樂園）。
 * 也順便印出 park_guardian.sql 裡那一段 park_stamps 的 values（跟過關章重複的四格要手動拿掉：
 * first-clear、all-clear、all-clear-2、all-clear-3）。
 *
 *   npx esbuild tools/build-park-badges.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/bpb.mjs
 *   node /tmp/bpb.mjs ../park/img/stamp
 *
 * 圖示來自 game-icons.net（CC BY 3.0），作者清單在 CREDITS.md。
 */
import { ACHIEVEMENTS, CATEGORIES } from '@/data/achievements'
import { BADGE_ICONS } from '@/ui/icons'
import { writeFileSync, mkdirSync } from 'node:fs'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })
const rows: string[] = []
const mix = (hex: string, to: number, t: number) => {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255]
  return '#' + c.map((v) => Math.round(v + (to - v) * t).toString(16).padStart(2, '0')).join('')
}
let i = 0
for (const a of ACHIEVEMENTS) {
  const hue = CATEGORIES.find((c) => c.key === a.category)!.hue
  const paths = (BADGE_ICONS[a.id] ?? BADGE_ICONS[a.id.replace(/-\d+$/, '')] ?? []).map((d) => `<path d="${d}"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="g" cx="30%" cy="18%" r="120%"><stop offset="0" stop-color="${mix(hue, 255, .28)}"/><stop offset=".55" stop-color="${hue}"/><stop offset="1" stop-color="${mix(hue, 0, .38)}"/></radialGradient></defs>`
    + `<circle cx="256" cy="256" r="240" fill="url(#g)" stroke="${mix(hue, 0, .45)}" stroke-width="16"/>`
    + `<g transform="translate(112 112) scale(.5625)" fill="#000" opacity=".3"><g transform="translate(0 12)">${paths}</g></g>`
    + `<g transform="translate(112 112) scale(.5625)" fill="#fff">${paths}</g></svg>`
  writeFileSync(`${OUT}/guardian-a-${a.id}.svg`, svg)
  const kind = a.secret ? 'egg' : a.category === 'collect' ? 'collect' : a.category === 'learn' || a.category === 'skill' ? 'master' : a.category === 'habit' ? 'story' : 'clear'
  const rarity = a.secret ? 'gold' : a.rewardItem ? 'gold' : a.tiers ? 'silver' : 'bronze'
  const q = (s: string) => "'" + s.replace(/'/g, "''") + "'"
  const hint = a.secret ? '彩蛋：自己找找看' : (a.hint ?? a.desc).replace(/\{n\}/g, a.tiers ? String(a.tiers[0] === -1 ? '全部' : a.tiers[0]) : '')
  rows.push(`  ('guardian', ${q('a-' + a.id)}, ${q(a.name)}, ${q(hint)}, ${q('img/stamp/guardian-a-' + a.id + '.svg')}, ${100 + i++}, true, ${q(kind)}, ${q(rarity)}, null, null)`)
}
writeFileSync('/tmp/park-badge-rows.sql', rows.join(',\n') + '\n')
console.log(ACHIEVEMENTS.length, 'badges')
