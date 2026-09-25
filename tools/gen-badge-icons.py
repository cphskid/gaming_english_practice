#!/usr/bin/env python3
"""把 game-icons.net 的徽記抓下來，產生 src/ui/icons.ts。

    python3 tools/gen-badge-icons.py

**授權**：game-icons.net 是 CC BY 3.0，可以再散布（所以公開 repo 收得住），
但一定要署名到「哪一張是誰畫的」，所以下面的表把作者一起記著，產生出來的
檔案每一張上面都會標。署名同時也寫在 CREDITS.md。

只取路徑資料不存 .svg 檔：徽章要跟著狀態變色（拿到白色、沒拿到灰色），
<img> 染不了色，一定要是行內的 <svg>；四十二張內嵌也省掉四十二個檔案請求。
"""
import re
import sys
import urllib.request

# 成就 id → (game-icons 的圖名, 作者)。作者是核對過的：同一個圖名在不同作者
# 底下可能各有一張（castle 就是），所以不能只記圖名。
ICONS = [
    ('first-answer', 'sprout', 'lorc'),
    ('hundred', 'book-cover', 'lorc'),
    ('nemesis', 'target-arrows', 'lorc'),
    ('theme-king', 'treasure-map', 'lorc'),
    ('mastered-50', 'brain', 'lorc'),
    ('literate', 'laurel-crown', 'lorc'),
    ('read-100', 'eye-target', 'delapouite'),
    ('listen-100', 'sound-waves', 'skoll'),
    ('spell-100', 'keyboard', 'delapouite'),
    ('triple-day', 'three-leaves', 'lorc'),
    ('long-words', 'measure-tape', 'delapouite'),
    ('balanced', 'scales', 'lorc'),
    ('combo', 'lightning-trio', 'lorc'),
    ('first-clear', 'tower-flag', 'delapouite'),
    ('three-star', 'star-medal', 'delapouite'),
    ('no-damage', 'brick-wall', 'delapouite'),
    ('boss-slayer', 'dragon-head', 'lorc'),
    ('stars-30', 'stars-stack', 'delapouite'),
    ('all-clear', 'castle', 'lorc'),
    ('first-match', 'crossed-swords', 'lorc'),
    ('veteran', 'swords-emblem', 'lorc'),
    ('all-lines', 'trident', 'lorc'),
    ('top-tier', 'crown', 'lorc'),
    ('comeback', 'anticlockwise-rotation', 'delapouite'),
    ('never-quit', 'muscle-up', 'lorc'),
    ('war-flag', 'flying-flag', 'lorc'),
    ('raid-slayer', 'crowned-skull', 'lorc'),
    ('dressed', 't-shirt', 'delapouite'),
    ('five-colors', 'palette', 'delapouite'),
    ('all-frames', 'wood-frame', 'delapouite'),
    ('avatar-10', 'carnival-mask', 'delapouite'),
    ('dual-job', 'wizard-staff', 'lorc'),
    ('item-taster', 'round-potion', 'caro-asercion'),
    ('week-3', 'hourglass', 'lorc'),
    ('days', 'sun-radiations', 'lorc'),
    ('weekend', 'sunrise', 'lorc'),
    ('replay', 'cycle', 'lorc'),
    ('month-12', 'calendar-half-year', 'delapouite'),
    ('old-friend', 'sands-of-time', 'lorc'),
    ('week-5', 'calendar', 'delapouite'),
    ('persistent', 'turtle', 'lorc'),
    ('quick-hand', 'sprint', 'lorc'),
    ('so-close', 'broken-heart', 'lorc'),
    ('bare-handed', 'open-palm', 'skoll'),
    ('combo-20', 'flame', 'carl-olsen'),
    ('all-rounder', 'rainbow-star', 'lorc'),
]

URL = 'https://game-icons.net/icons/ffffff/000000/1x1/{author}/{name}.svg'
# 每張圖的第一條路徑是黑色底板，畫面上不要（底板是我們自己用 CSS 畫的）。
PLATE = 'M0 0h512v512H0z'

HEAD = '''/**
 * 徽章圖示。
 *
 * 來源：game-icons.net，**CC BY 3.0**——允許再散布（所以公開 repo 可以收），
 * 但**一定要署名**：每一張上面都標了作者，完整清單在 CREDITS.md。
 *
 * 為什麼是內嵌的路徑資料不是 .svg 檔：四十六張各一到五 KB，內嵌省掉四十二個
 * 檔案請求；而且徽章要跟著文字一起變色（拿到的畫白色、沒拿到畫灰色），
 * 用 <img> 就染不了色，一定要是行內的 <svg>。
 *
 * 這份檔案是工具產生的，不要手改：tools/gen-badge-icons.py
 */

/** 每個圖示是一到多條路徑，viewBox 都是 0 0 512 512。 */
export const BADGE_ICONS: Record<string, string[]> = {
'''


def fetch(name, author):
    with urllib.request.urlopen(URL.format(author=author, name=name), timeout=30) as r:
        svg = r.read().decode('utf-8')
    paths = [d for d in re.findall(r'd="([^"]+)"', svg) if d != PLATE]
    if not paths:
        raise SystemExit(f'{author}/{name}：抓不到路徑，圖名或作者是不是換了？')
    return paths


def main():
    out = [HEAD]
    for ach, name, author in ICONS:
        paths = fetch(name, author)
        print(f'  {ach:<14} {author}/{name}  {len(paths)} 條', file=sys.stderr)
        out.append(f'  // {name} — {author}\n  {ach!r}: [\n'.replace("'", "'"))
        for d in paths:
            out.append(f"    '{d}',\n")
        out.append('  ],\n')
    out.append('}\n')
    with open('src/ui/icons.ts', 'w', encoding='utf-8') as f:
        f.write(''.join(out).replace("'" + "'", "'"))
    print(f'寫進 src/ui/icons.ts：{len(ICONS)} 張', file=sys.stderr)


if __name__ == '__main__':
    main()
