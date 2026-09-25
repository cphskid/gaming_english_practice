"""把角色頭像從 Charles Gabriel 的四張原圖切出來，產生 public/avatars/<id>.png。

    python3 tools/build-avatars.py

原圖在 assets/cg-faces/sheet1~4.png（OpenGameArt「48x48 Faces」1st～4th sheet，
CC-BY 3.0，要署名，見 CREDITS.md）。每張臉 48×48，對齊 48 的格線：
左到右是第幾欄，上下兩列通常是同一個角色的男、女版（藍底男、粉底女）。

切出來放大四倍（192×192，最近鄰），畫面上縮小成 36～96px 都還對得齊。
**id 要跟 src/data/avatars.ts 一樣**，加一張就兩邊各加一行。
"""
from PIL import Image
import os

SRC = 'assets/cg-faces'
OUT = 'public/avatars'
SCALE = 4

# id → (第幾張原圖, 第幾欄, 上緣 y)。y 是用每一列藍／粉底色的起點量出來的。
PICK = {
    'av-warrior-m':  (1, 0, 144), 'av-warrior-f':  (1, 0, 192),
    'av-soldier-m':  (2, 3, 192), 'av-soldier-f':  (2, 3, 240),
    'av-magician-m': (1, 1, 144), 'av-magician-f': (1, 1, 192),
    'av-healer-m':   (1, 2, 144), 'av-healer-f':   (1, 2, 192),

    'av-monk-m':     (2, 0, 192), 'av-monk-f':     (2, 0, 240),
    'av-ranger-m':   (1, 4, 144), 'av-ranger-f':   (1, 4, 192),
    'av-ninja-m':    (1, 3, 144), 'av-ninja-f':    (1, 3, 192),
    'av-berserk-m':  (2, 1, 192), 'av-berserk-f':  (2, 1, 240),
    'av-pirate':     (3, 4, 192), 'av-merchant':   (3, 2, 192),
    'av-bard':       (4, 1, 384),

    'av-samurai-m':  (4, 0, 288), 'av-samurai-f':  (4, 0, 336),
    'av-dknight-m':  (2, 2, 192), 'av-dknight-f':  (2, 2, 240),
    'av-paladin':    (4, 2, 384), 'av-dancer':     (4, 5, 288),
    'av-captain':    (3, 5, 192), 'av-vampire':    (4, 0, 384),

    'av-el-fire':    (3, 0, 144), 'av-el-water':   (3, 1, 144),
    'av-el-wind':    (3, 2, 144), 'av-el-earth':   (3, 3, 144),
    'av-el-light':   (3, 4, 144), 'av-el-dark':    (3, 5, 144),
    'av-angel':      (4, 2, 288), 'av-king':       (4, 3, 288),
    'av-queen':      (4, 3, 336),
}

os.makedirs(OUT, exist_ok=True)
sheets = {i: Image.open(f'{SRC}/sheet{i}.png').convert('RGBA') for i in (1, 2, 3, 4)}
for name in os.listdir(OUT):
    if name.endswith('.png') and name[:-4] not in PICK:
        os.remove(os.path.join(OUT, name))
for aid, (s, col, y) in PICK.items():
    face = sheets[s].crop((col * 48, y, col * 48 + 48, y + 48))
    face.resize((48 * SCALE, 48 * SCALE), Image.NEAREST).save(f'{OUT}/{aid}.png', optimize=True)
print(len(PICK), 'avatars ->', OUT)
