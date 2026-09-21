# Treasure Hunters 素材（海盜主題軍團候選）

## 來源與授權

作者 **Pixel Frog**（跟 Tiny Swords 同一位），來自 <https://pixelfrog-assets.itch.io/treasure-hunters>。

素材頁面上的授權原文：

> These assets are released under a Creative Commons Zero (CC0) license.
> You can distribute, remix, adapt, and build upon the material in any medium or format,
> even for commercial purposes. Attribution is not required.

**CC0，可以再散布**，所以放進公開 repo 沒有問題。壓縮檔裡沒有附授權檔，授權條文只在上面
那個網頁上，所以這份 README 就是專案內的授權紀錄。

## 內容

| 資料夾 | 內容 |
| --- | --- |
| `The Crusty Crew/` | 三個小兵：**Crabby**（大螃蟹）、**Fierce Tooth**（匕首海盜）、**Pink Star**（粉紅海星） |
| `Captain Clown Nose/` | 船長，可以當頂階或魔王。有「拿劍／不拿劍」兩套，還有丟劍動作 |
| `Shooter Traps/` | **Cannon**（大砲，會發射砲彈）、Totems（三種石像，會噴東西）、Seashell |
| `Pirate Ship/`、`Merchant Ship/` | 兩艘船，可以當城堡 |
| `Palm Tree Island/` | 這個主題自己的地形圖塊與背景 |
| `Wood and Paper UI/` | 木頭與紙張風格的整套 UI（按鈕、橫幅、對話框、血條、地圖） |
| `Pirate Treasure/` | 鑽石、金幣、寶箱、藥水 |

每個角色的動畫組都一樣：Idle、Run、Jump、Fall、Ground、Anticipation、Attack、Hit、
Dead Hit、Dead Ground、Attack Effect。

## 拿來當兵推的主題軍團要注意兩件事

**1. 這包裡沒有現成的遠程小兵。** 三個小兵（Crabby、Fierce Tooth、Pink Star）的
Attack Effect 都是近身揮擊。兵推的三條線要湊的話：

- 認字（長槍）→ Fierce Tooth
- 拼字（盾兵、厚）→ Crabby，體型本來就比較寬
- 聽音（遠程）→ 沒有現成的。要嘛借 Captain 的 Throw Sword 動作，要嘛用 Cannon 改成會走路的

**2. 像素密度跟 Tiny Swords 對不起來。** 這包的小兵每幀是 34×30（Crabby 72×32、
Captain 64×40），而 Tiny Swords 是每幀 192×192、在遊戲裡縮成 64px 顯示。
也就是說這裡的兵放到現在的戰場上要放大兩倍，顆粒會比周圍的草地粗一倍。

→ 所以這套要用就**連地形一起換**（這包自己附 `Palm Tree Island/` 和整套 UI，換得起來）。

## 說明

- 只收錄 `.png`，`.aseprite` 原始檔沒有放進來，需要編輯素材時再從 itch.io 重新下載
- 檔名與資料夾結構維持作者原樣，之後對照官方頁面或更新版本時比較好找
