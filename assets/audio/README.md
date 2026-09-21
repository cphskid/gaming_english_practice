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

## 要轉檔的時候

這個環境預設沒有 ffmpeg，而且**不要把它加進 package.json**——它是 77MB，
每次 CI 部署都要多抓一次，只為了偶爾轉一次音檔不划算。要用的時候臨時裝：

    npm i --no-save ffmpeg-static
    FF=node_modules/ffmpeg-static/ffmpeg

轉音樂（單聲道、80kbps，一分半的曲子大約 900KB）：

    $FF -y -i 原檔.wav -ac 1 -c:a libvorbis -b:a 80k public/audio/music/名字.ogg

轉音效（裁短、尾巴淡出、單聲道）：

    $FF -y -i 原檔.ogg -t 3.4 -af "afade=t=out:st=2.9:d=0.5" -ac 1 -c:a libvorbis -b:a 96k public/audio/sfx/名字.ogg

## 素材抓得到嗎

2026-09-21 實測：**itch.io、kenney.nl、opengameart.org 現在都連得到**
（以前是 403，所以之前的素材都是請 Chuck 下載後上傳的）。
opengameart 可以直接抓檔，而且搜尋可以指定授權，是目前最省事的來源：

    https://opengameart.org/art-search-advanced?keys=關鍵字&field_art_licenses_tid%5B%5D=4

`field_art_licenses_tid[]=4` 就是 CC0。**本專案 repo 是公開的，所以只收 CC0
或可散布的授權**，理由見 CREDITS.md 裡 Minifantasy 那一段。
