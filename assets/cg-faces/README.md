# 48x48 Faces（角色頭像原圖）

## 來源與授權

作者 **Charles Gabriel**，OpenGameArt：

- <https://opengameart.org/content/48x48-faces-1st-sheet> → `sheet1.png`
- <https://opengameart.org/content/48x48-faces-2nd-sheet> → `sheet2.png`
- <https://opengameart.org/content/48x48-faces-3rd-sheet> → `sheet3.png`
- <https://opengameart.org/content/48x48-faces-4th-sheet> → `sheet4.png`

授權 **CC-BY 3.0**：可以再散布、可以改，**一定要署名 Charles Gabriel**（已寫在 `CREDITS.md`）。

## 用法

每張臉 48×48，對齊 48 格線。`tools/build-avatars.py` 挑出用到的 36 張，放大四倍存到 `public/avatars/`。
哪一格是哪個角色寫在那支腳本的 `PICK`，名字與價格在 `src/data/avatars.ts`。

沒用到的：兔女郎（不適合國小）、小孩與路人 NPC、神父修女與邪教徒（宗教題材先避開）。
