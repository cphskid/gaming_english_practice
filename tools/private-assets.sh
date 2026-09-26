#!/bin/sh
# 把私有素材 repo（cphskid/gaming_english_assets）的圖放回原位，build 之前要先跑。
#
#   sh tools/private-assets.sh [私有 repo 的本機路徑，預設 private-assets]
#
# 為什麼要這樣：Tiny Swords 在 2026-09 改了授權，「不得再散布，改過的也不行」，
# 付費素材包也都禁止散布。公開 repo 誰都下載得到，所以這些圖（原檔和裁出來的遊戲圖）
# 只放私有 repo，發佈時 .github/workflows/pages.yml 用 ASSETS_TOKEN 拉下來、這支放回原位再打包。
# 網站上照樣看得到圖，只是原檔不在公開 repo 裡。
#
# 私有 repo 的結構：
#   overlay/      照公開 repo 的路徑擺，整包蓋到 repo 根目錄（例：overlay/public/td-art/castle.png）
#   tiny-swords/  Tiny Swords 原檔，放到 assets/tiny-swords/ 給 tools/build-td-art.py 讀
#
# 放回來的檔案都寫在 .gitignore，不會被 commit 回公開 repo。
# 新增禁散布的圖：放進私有 repo 的 overlay/ 對應路徑，再把路徑加進 .gitignore。
set -eu

SRC=${1:-private-assets}
if [ ! -d "$SRC/overlay" ]; then
  # 沙箱或自己電腦：直接 clone（要有讀私有 repo 的權限）
  git clone --depth 1 https://github.com/cphskid/gaming_english_assets "$SRC"
fi

cp -R "$SRC/overlay/." .
mkdir -p assets/tiny-swords
cp -R "$SRC/tiny-swords/." assets/tiny-swords/

# 守塔的圖索引裡每一張都要在，缺一張遊戲就會少圖，寧可讓發佈失敗
node -e '
const fs = require("fs")
const idx = JSON.parse(fs.readFileSync("public/td-art.json", "utf8"))
const miss = Object.values(idx).filter((p) => !fs.existsSync("public/" + p))
if (miss.length) { console.error("缺圖：" + miss.join(" ")); process.exit(1) }
// 魔王團戰：raid-art.json 裡每隻魔王的每個動作＋頭像都要在（傳說、神話十隻在私有 repo）
const raid = JSON.parse(fs.readFileSync("src/data/raid-art.json", "utf8"))
const rmiss = Object.entries(raid).flatMap(([k, v]) =>
  [...Object.keys(v.anims), "face"].map((a) => "public/raid/" + k + "/" + a + ".png"))
  .filter((p) => !fs.existsSync(p))
if (rmiss.length) { console.error("缺魔王圖：" + rmiss.join(" ")); process.exit(1) }
// 介紹網頁（public/about/）的影片與截圖也在私有 repo
if (fs.existsSync("public/about/index.html") && !fs.existsSync("public/about/intro.mp4")) {
  console.error("缺介紹影片：public/about/intro.mp4"); process.exit(1)
}
console.log("私有素材放回原位，守塔圖 " + Object.keys(idx).length + " 張、魔王 " + Object.keys(raid).length + " 隻都在")
'
