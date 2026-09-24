# Pirate Bomb 素材（炸彈海盜軍團，普通級）

## 來源與授權

作者 **Pixel Frog**（跟 Tiny Swords、Kings and Pigs 同一位），來自 <https://pixelfrog-assets.itch.io/pirate-bomb>。

素材頁面上的授權原文：

> These assets are released under a Creative Commons Zero (CC0) license.
> You can distribute, remix, adapt, and build upon the material in any medium or format,
> even for commercial purposes. Attribution is not required.

**CC0，可以再散布**，放進公開 repo 沒有問題。壓縮檔沒附授權檔，這份 README 就是專案內的授權紀錄。

## 內容

每個動作一個資料夾、**一張 PNG 一幀**（跟 Kings and Pigs 的橫向連續圖不同），每隻角色幀大小不同（約 63×67～80×72，鯨魚 68×46）。

| 資料夾 | 內容 |
| --- | --- |
| `1-Player-Bomb Guy/` | 主角炸彈人（沒有攻擊動作，只會放炸彈） |
| `2-Enemy-Bald Pirate/` | 禿頭海盜，會踢炸彈 |
| `3-Enemy-Cucumber/` | 黃瓜，會吹熄引信 |
| `4-Enemy-Big Guy/` | 大塊頭，會撿炸彈丟回去（`8-Pick`、`11-Throw (Bomb)`） |
| `5-Enemy-Captain/` | 船長 |
| `6-Enemy-Whale/` | 鯨魚，會吞炸彈（`8-Swalow (Bomb)`，拼字是作者原樣） |
| `7-Objects/` | 炸彈、門、血條、蠟燭、鐵鍊、**`16-Enemy-Cannon` 大砲**（可當塔） |
| `8-Tile-Sets/` | 船艙地形（64×64 圖塊） |

## 對兵推三條線

- 認字（近戰）→ `2-Enemy-Bald Pirate`（`7-Attack`）
- 聽音（遠程）→ `4-Enemy-Big Guy`（`11-Throw (Bomb)`，丟出去的炸彈用 `7-Objects/1-BOMB`）
- 拼字（耐打）→ `6-Enemy-Whale`
- 頂階 → `5-Enemy-Captain`；`3-Enemy-Cucumber` 可當隨從
- 塔 → `7-Objects/16-Enemy-Cannon`
- 死亡 → 各角色的 `Dead Hit` + `Dead Ground`

跟豬軍團一樣是側視船艙室內，兵推要連地形一起換。只收 `.png`，`.aseprite` 沒放進來。
