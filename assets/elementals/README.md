# Elementals 素材（元素大師軍團，傳說級）

## 來源與授權

作者 **chierit**，系列頁 <https://chierit.itch.io/elementals-bundle>。這裡收的是三位角色的**免費版**：

- Fire Knight <https://chierit.itch.io/elementals-fire-knight>（免費版 v1.1）
- Leaf Ranger <https://chierit.itch.io/elementals-leaf-ranger>（免費版 v1.0）
- Crystal Mauler <https://chierit.itch.io/elementals-crystal-mauler>（免費版 v1.0）

素材頁面上的授權原文：

> License CC-BY 4.0 - can be edited to fit your game (aseprite file included), can also be used
> commercially, only credit "chierit" in your game's credits or add a link somewhere to my itch page.
> Please don't resell

**CC-BY 4.0，可以再散布，但一定要署名**：遊戲裡的製作名單（`CREDITS.md`）要寫 chierit 並附 itch 頁連結。

## 內容

每個動作一個資料夾、**一張 PNG 一幀，每幀 288×128**（角色本身約 45px 高，站在圖的下緣中央，兩側留白給攻擊特效）。

| 角色 | 資料夾 | 動作 |
| --- | --- | --- |
| 火焰騎士 | `fire-knight/` | `01_idle`、`02_run`、`05_1_atk`～`08_sp_atk`、`09_defend`、`10_take_hit`、`11_death` 等 |
| 森林遊俠 | `leaf-ranger/` | `idle`、`run`、`1_atk`～`3_atk`、`sp_atk`、`defend`、`take_hit`、`death`，箭與特效在 `projectiles_and_effects/` |
| 水晶巨鎚 | `crystal-mauler/` | `idle`、`run`、`1_atk`～`3_atk`、`sp_atk`、`defend`、`take_hit`、`death` |

## 對兵推三條線

- 認字（近戰）→ 火焰騎士
- 聽音（遠程）→ 森林遊俠（射箭，箭用 `leaf-ranger/projectiles_and_effects/arrow`）
- 拼字（耐打）→ 水晶巨鎚（有 `defend` 格擋）
- 頂階 → 免費版沒有變身動作。付費版（每位 $7.50，十位全套 $50）多「元素變身」一整組動作，
  要用的話由 Chuck 購買後下載給我們；**付費版同樣是 CC-BY 4.0，可以放 repo**。
  還沒買之前，頂階先用 `sp_atk` 特殊攻擊當招牌動作。

沒附地形，兵推背景要另外配。只收 `.png`，`.aseprite` 與 gif 範例沒放進來。
