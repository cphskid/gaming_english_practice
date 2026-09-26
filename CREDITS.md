# 致謝

## 美術素材

> 只收 CC0 或允許再散布的素材。「可以用但禁止散布」的素材（Tiny Swords、多數付費包）放私有 repo `cphskid/gaming_english_assets` 的 `overlay/`，路徑照這個 repo 擺，再把路徑加進 `.gitignore`，詳見 `tools/private-assets.sh`。

**Tiny Swords** — [Pixel Frog](https://pixelfrog-assets.itch.io/tiny-swords)

角色、建築、地形、UI 與特效素材皆出自此素材包。作者授權可自由用於個人與商業專案並可修改，且不強制標註；此處仍列出以示感謝。

**但授權也寫明「不得再散布、轉售或重新包裝，改過的也一樣」**，所以原檔和裁出來的遊戲圖都不放在這個公開 repo，改放私有 repo `cphskid/gaming_english_assets`，發佈時才拉進來打包（見 `tools/private-assets.sh`）。2026-09-25 以前的 commit 裡還有舊的副本。

**Treasure Hunters** — [Pixel Frog](https://pixelfrog-assets.itch.io/treasure-hunters)

`assets/treasure-hunters/` 的海盜角色、船隻、陷阱、地形與 UI 出自此素材包。授權為 Creative Commons Zero (CC0)，不強制標註；此處仍列出以示感謝。

**Pirate Bomb** — [Pixel Frog](https://pixelfrog-assets.itch.io/pirate-bomb)

`assets/pirate-bomb/` 的海盜角色、大砲與船艙地形出自此素材包。授權為 Creative Commons Zero (CC0)，不強制標註；此處仍列出以示感謝。

**Monsters Creatures Fantasy** — [LuizMelo](https://luizmelo.itch.io/monsters-creatures-fantasy)

`assets/monsters-creatures-fantasy/` 的哥布林、飛眼、骷髏、蘑菇出自此素材包。授權為 Creative Commons Zero (CC0)，不強制標註；此處仍列出以示感謝。

**Elementals（Fire Knight、Leaf Ranger、Crystal Mauler）** — [chierit](https://chierit.itch.io/elementals-bundle)

`assets/elementals/` 的三位元素大師出自此系列。授權為 Creative Commons Attribution 4.0 (CC BY 4.0)，**須標註作者 chierit 並附連結**。

**魔王團戰的魔王** — `public/raid/<魔王>/` 的動畫條由 `tools/build-raid-art.py` 從原始素材切出：

- 寒冰守衛、惡魔史萊姆、牛頭人、深海克蘇魯 — [chierit](https://chierit.itch.io/)（Frost Guardian、Boss Demon Slime、Minotaur、Cthulu）。授權為 Creative Commons Attribution 4.0 (CC BY 4.0)，**須標註作者 chierit 並附連結**。
- 邪惡巫師（三款）、火焰巨蟲、暴君國王、寶箱怪 — [LuizMelo](https://luizmelo.itch.io/)（Evil Wizard 1/2/3、Fire Worm、Medieval King Pack、Monsters Creatures Fantasy 2）。授權為 Creative Commons Zero (CC0)，不強制標註；此處仍列出以示感謝。

傳說、神話十隻（2026-09-25）是**免費、可商用但禁止再散布**的素材：原檔與切好的圖只放私有 repo
`cphskid/gaming_english_assets`（`raid-bosses/` 原檔、`overlay/public/raid/<魔王>/` 遊戲圖），
發佈時由 `tools/private-assets.sh` 放回來，公開 repo 裡沒有這些圖。

- 蜜獾大王、暴龍、青蛙將軍、大猩猩、企鵝老大 — [admurin](https://admurin.itch.io/)（Bosses：Badger、Dino Rex、Frogger、Gollux、Pengu）。可用於個人與商業專案，不可再散布或轉賣素材。
- 飛天惡魔 — [xzany](https://xzany.itch.io/flying-demon-2d-pixel-art)（Flying Demon 2D Pixel Art）。可用於個人與商業遊戲，不可當素材再散布或轉賣，不得做成 NFT；不強制標註。
- 骷髏巫師、翼魔 — [oliveiramiro2](https://oliveiramiro2.itch.io/)（Necromancer Skeleton Boss、Crawller Winged Boss）。作者頁面寫可免費用在你的專案。
- 機械石魔像、亡靈處刑者 — [darkpixel-kronovi](https://darkpixel-kronovi.itch.io/)（Mecha-stone Golem、Undead Executioner）。可商用，不可再散布。

**魔王團戰的戰場背景** — [ansimuz](https://ansimuz.itch.io/)

`public/raid/bg/` 的十張背景由 Gothicvania Cemetery／Town、Magic Cliffs、Sunnyland Forest、Warped Caves、Super Grotto Escape、Underwater Diving 等素材包合成。授權為 Creative Commons Zero (CC0)，不強制標註；此處仍列出以示感謝。

**Kings and Pigs** — [Pixel Frog](https://pixelfrog-assets.itch.io/kings-and-pigs)

`assets/kings-and-pigs/` 的豬兵、豬王、大砲與地形出自此素材包。授權為 Creative Commons Zero (CC0)，不強制標註；此處仍列出以示感謝。

**496 pixel art icons for medieval/fantasy RPG** — [Henrique Lazarini（7Soul1）](https://opengameart.org/content/496-pixel-art-icons-for-medievalfantasy-rpg)

授權為 Creative Commons Zero (CC0)。`assets/rpg-icons/` 完整收錄這 496 張 34×34 像素圖示，
道具系統的圖示（寒霜陷阱、城牆修補、水晶、金幣、血量、箭塔、軍營等）出自此包。
實際用到的十四張由 `tools/build-icons.py` 產生到 `public/icons/`，對照表見 `docs/icon-map.md`。

**game-icons.net 徽記** — [game-icons.net](https://game-icons.net/)

授權為 [Creative Commons BY 3.0](https://creativecommons.org/licenses/by/3.0/)：可自由使用、修改與再散布，**但必須署名**。`src/ui/icons.ts` 內嵌的 51 個成就徽章圖示與 2 個職業圖示（騎士的頭盔 visored-helm、法師的帽子 pointy-hat）出自此站（只取路徑資料，顏色改由畫面控制）。哪一張是誰畫的標在 `src/ui/icons.ts` 每一張上面，也可用 `tools/gen-badge-icons.py` 重新抓取。作者：

- **Lorc** — https://lorcblog.blogspot.com/ （32 張，含魔王剋星的 crowned-skull、合作類的 sword-clash 與 crossed-sabres、兩個職業圖示）
- **Delapouite** — https://delapouite.com/ （17 張，含合作類的 shaking-hands、three-friends、meeple-group）
- **Skoll** （2 張）
- **Carl Olsen** — https://twitter.com/unstoppableCarl （1 張）
- **Caro Asercion** （1 張）

**48x48 Faces（角色頭像）** — Charles Gabriel，[OpenGameArt 1st](https://opengameart.org/content/48x48-faces-1st-sheet)、[2nd](https://opengameart.org/content/48x48-faces-2nd-sheet)、[3rd](https://opengameart.org/content/48x48-faces-3rd-sheet)、[4th sheet](https://opengameart.org/content/48x48-faces-4th-sheet)

授權為 [Creative Commons BY 3.0](https://creativecommons.org/licenses/by/3.0/)，**須標註作者 Charles Gabriel**。`assets/cg-faces/` 收錄四張原圖，
遊戲裡的 36 張頭像（職業送的八張與商店的二十八張）由 `tools/build-avatars.py` 切到 `public/avatars/`。

**Hero Knight、Wizard Pack（職業英雄）** — [LuizMelo](https://luizmelo.itch.io/)

`assets/heroes/` 的騎士與法師出自 [Hero Knight](https://luizmelo.itch.io/hero-knight) 與 [Wizard Pack](https://luizmelo.itch.io/wizard-pack)，
由 `tools/build-hero-art.py` 切到 `public/heroes/`。授權為 Creative Commons Zero (CC0)，不強制標註；此處仍列出以示感謝。

## 單字題庫

**十二年國民基本教育課程綱要 語文領域－英語文**，中華民國教育部。

題庫中的字彙取自該課綱附錄五「參考字彙表」，屬政府公開資料。

## 音效

**Minifantasy – Dungeon Audio Pack** — [Leohpaz](https://leohpaz.itch.io/minifantasy-dungeon-sfx-pack)

`assets/audio/sfx/` 中的 volley、enemy-hit、enemy-die、castle-hit、tower-build、tower-sell、star、wave-start 出自此素材包（已改名、轉為單聲道並重新取樣）。

作者授權可用於個人與商業專案，署名非必要但作者歡迎。**作者禁止再散布素材包本身**（原文：「you may not sell it or distribute the asset pack for free, please redirect people to this page」），因此本專案只收錄實際使用的少數音效，未收錄完整素材包。想取得完整素材請前往上方連結。

**Brackeys Platformer Assets** — [Brackeys](https://brackeysgames.itch.io/brackeys-platformer-bundle)

授權為 Creative Commons Zero (CC0)。本專案使用其中的：

- 音效 answer-correct、answer-wrong、coin、ui-tap、explosion — 由 Brackeys（Asbjørn Thirslund）製作
- 音樂 `assets/audio/music/adventure.mp3` — 由 Brackeys（Sofia Thirslund）製作
- 字型 `assets/fonts/PixelOperator8*.ttf` — 由 Jayvee Enaguas（HarvettFox96）製作

**Determined Pursuit (epic orchestra loop)** — [Emma_MA](https://opengameart.org/content/determined-pursuit-epic-orchestra-loop)

授權為 Creative Commons Zero (CC0)。對戰模式的背景音樂 `public/audio/music/battle.ogg`，已轉為單聲道 Ogg Vorbis 以縮小檔案（原檔為 108 秒立體聲 WAV，19MB）。

**Their Coming (generic horn sound)** — [StumpyStrust](https://opengameart.org/content/their-coming-generic-horn-sound)

授權為 Creative Commons Zero (CC0)。對戰開場的號角 `public/audio/sfx/battle-horn.ogg`，已裁切為 3.4 秒並轉為單聲道。

**Epic Boss Battle** — [Juhani Junkala](https://opengameart.org/content/boss-battle-music)

授權為 Creative Commons Zero (CC0)。魔王團戰的背景音樂 `public/audio/music/boss.ogg`，已轉為單聲道 Ogg Vorbis。

**Mixed fantasy backgrounds** — [ulfus](https://opengameart.org/content/mixed-fantasy-backgrounds)

授權為 Creative Commons Zero (CC0)。標題畫面的浮空城背景 `public/title/floating-city.jpg`。

**MedievalSharp** — wmk69，[SIL Open Font License 1.1](public/title/OFL-MedievalSharp.txt)

標題「World Guardians」的英文字型 `public/title/title-latin.woff2`。只留英文字母並轉成 woff2；依 OFL 保留字型名稱的規定，改過的檔案改名為「WG Title Latin」。

**霞鶩文楷 TC（LXGW WenKai TC）** — The LXGW WenKai Project Authors，[SIL Open Font License 1.1](public/title/OFL-LXGWWenKaiTC.txt)

標題「守護異世界」與副標的中文字型 `public/title/title-cjk.woff2`。只留標題用到的 14 個字並轉成 woff2，改名為「WG Title CJK」。
