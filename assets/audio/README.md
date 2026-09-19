# 音效與音樂

授權說明在專案根目錄的 `CREDITS.md`。**Minifantasy 那包禁止再散布整包**，所以這裡只放實際用到的檔案，不要把原始素材包倒進來。

## 格式

音效統一為 **單聲道、16-bit、22050Hz 的 WAV**（原檔是立體聲 24-bit 44100Hz，轉檔後 15 個音效共約 220KB）。
遊戲音效很短，22050Hz 聽不出差別，但檔案小四倍，學校共用 WiFi 才載得動。

音樂維持 mp3。之後若要再壓縮，整個 `assets/audio/` 目標控制在 10MB 以內。

## 檔案與用途

| 檔案 | 什麼時候播 | 來源 |
|---|---|---|
| `sfx/answer-correct.wav` | 答對 | Brackeys |
| `sfx/answer-wrong.wav` | 答錯 | Brackeys |
| `sfx/volley-1~3.wav` | 塔齊射（三個變體隨機挑，避免連續聽同一聲） | Minifantasy |
| `sfx/enemy-hit.wav` | 怪受傷 | Minifantasy |
| `sfx/enemy-die.wav` | 怪死亡 | Minifantasy |
| `sfx/castle-hit.wav` | 城堡被打 | Minifantasy |
| `sfx/tower-build.wav` | 蓋塔 | Minifantasy |
| `sfx/tower-sell.wav` | 拆塔 | Minifantasy |
| `sfx/wave-start.wav` | 開波 | Minifantasy |
| `sfx/star.wav` | 結算星星 | Minifantasy |
| `sfx/coin.wav` | 獲得金幣 | Brackeys |
| `sfx/ui-tap.wav` | 按鈕 | Brackeys |
| `sfx/explosion.wav` | TNT 哥布林爆炸 | Brackeys |
| `music/adventure.mp3` | 通用背景音樂 | Brackeys |

## 還缺的

- **勝利短曲、失敗短曲**（結算畫面）
- **戰鬥音樂、魔王音樂**（目前只有一首通用曲）

這幾個在補上檔案之前，由音訊模組用 Web Audio 合成佔位音，不會卡住開發。

## 給程式的注意事項

- **不要把音訊內嵌成 data URI**，當一般靜態檔案載入，瀏覽器才會快取。
- **iOS Safari 在使用者互動前不准播聲音**，第一次播放必須綁在「開始」那一下，由音訊模組統一解鎖。
- 教室預設值：**音效開、音樂關**，另給老師一個全班靜音開關。
