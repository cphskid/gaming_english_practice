"""把 Tiny Swords 素材裁切、縮放，產生 public/td-art/*.png 與索引 public/td-art.json。

單位與建築的原圖每格 192×192，遊戲裡只畫到 64 上下，所以先縮小可以讓
產出的檔案小一個數量級。地形圖塊維持原生 64 像素不縮放，因為地圖就是
以 64 為一格鋪出來的。需要換素材或調大小時重跑這支就好。

    python3 tools/build-td-art.py
"""
from PIL import Image
import json, os

B = 'assets/tiny-swords/'
# 藍色是預設陣營，其他四色靠「陣營顏色」裝飾品解鎖
COLORS = ['Blue', 'Red', 'Purple', 'Yellow', 'Black']
OUT = 'public/td-art.json'


OUTDIR = 'public/td-art'
art = {}


def put(key, im):
    """存成一般的 PNG 檔，索引只放檔名。

    本來是存成 data URI 全部塞進一個 JSON。加了五色建築之後那個 JSON 會到 711KB，
    而 base64 本身就多 33%，又不能分開快取、不能平行下載。
    改成一般檔案之後小了四分之一，而且換一張圖只有那一張要重抓。
    """
    os.makedirs(OUTDIR, exist_ok=True)
    im.save('%s/%s.png' % (OUTDIR, key), 'PNG', optimize=True)
    art[key] = 'td-art/%s.png' % key


def main():

    # 地形圖塊整張帶走，切格的事交給遊戲裡的 autotile 處理。
    # 576×384 = 9×6 格，左上 4×4 是「草地接水」，中間 4×4 是「高地草皮」，
    # 右下兩列是高地的石壁。
    put('tiles', Image.open(B + 'free-pack/Terrain/Tileset/Tilemap_color1.png'))
    put('water', Image.open(B + 'free-pack/Terrain/Tileset/Water Background color.png'))

    # 哥布林走路：Torch 圖表第 0 列是面向右的 7 格循環
    for name, path in [
        ('goblinRed', 'update-010/Factions/Goblins/Troops/Torch/Red/Torch_Red.png'),
        ('goblinPurple', 'update-010/Factions/Goblins/Troops/Torch/Purple/Torch_Purple.png'),
    ]:
        sheet = Image.open(B + path)
        strip = Image.new('RGBA', (192 * 7, 192))
        for c in range(7):
            strip.paste(sheet.crop((c * 192, 0, (c + 1) * 192, 192)), (c * 192, 0))
        put(name, strip.resize((64 * 7, 64), Image.LANCZOS))

    # 建築是單張圖，縮一半就夠用。
    #
    # **五種顏色全部帶進來**：素材包每一棟建築都有藍紅紫黃黑五色，
    # 這就是「陣營顏色」那個裝飾品的全部成本——一張新圖都不用畫，
    # 小朋友買了之後整個戰場（城堡、箭塔、軍營、士兵）都會變成他的顏色。
    # 藍色是預設，所以鍵名不帶顏色；其他四色是 castle_red 這種形式。
    for color in COLORS:
        suffix = '' if color == 'Blue' else '_' + color.lower()
        for name, f in [('archery', 'Archery'), ('barracks', 'Barracks'), ('castle', 'Castle')]:
            im = Image.open(B + 'free-pack/Buildings/%s Buildings/%s.png' % (color, f))
            put(name + suffix, im.resize((im.width // 2, im.height // 2), Image.LANCZOS))
        # 軍營派出的士兵，取待機動畫第一格
        w = Image.open(B + 'free-pack/Units/%s Units/Warrior/Warrior_Idle.png' % color)
        put('warrior' + suffix, w.crop((0, 0, 192, 192)).resize((64, 64), Image.LANCZOS))

    # 兵推的三條兵種線。**跟守塔的 warrior 分開存**，因為這三張要互相對齊：
    #
    # 三條線＝三種英文技能（認字／聽音／拼字），所以一眼要分得出是哪一種。
    # 靠的是剪影不是顏色（顏色被陣營佔用了）：長槍是一條橫線、弓手是圓的、
    # 盾劍士有一面盾。素材包三種都有，而且五色都有，一張新圖都不用畫。
    #
    # 難處是三張圖的格子大小不一樣（長槍兵 320，另外兩個 192），直接縮到同樣
    # 寬高的話人會一大一小。作法是**一律縮成三分之一再置中貼進 112 的方框**，
    # 這樣三張的人物比例一致，腳底也自動對齊（實測差 1 像素）。
    UNIT_BOX = 112
    for color in COLORS:
        suffix = '' if color == 'Blue' else '_' + color.lower()
        for key, path, cell in [
            # 認字線：便宜、快、成群。長槍的橫線剪影在小尺寸最好認。
            ('u_spear', 'Lancer/Lancer_Right_Defence.png', 320),
            # 聽音線：遠程。素材包沒有法師，弓手是唯一的遠程兵。
            ('u_bow', 'Archer/Archer_Idle.png', 192),
            # 拼字線：耐打。盾牌加盔甲，三張裡看起來最重的一個。
            ('u_shield', 'Warrior/Warrior_Idle.png', 192),
        ]:
            src = Image.open(B + 'free-pack/Units/%s Units/%s' % (color, path))
            frame = src.crop((0, 0, cell, cell)).resize((cell // 3, cell // 3), Image.LANCZOS)
            box = Image.new('RGBA', (UNIT_BOX, UNIT_BOX), (0, 0, 0, 0))
            box.paste(frame, ((UNIT_BOX - frame.width) // 2, (UNIT_BOX - frame.height) // 2), frame)
            put(key + suffix, box)

    # 治療特效：修士的 Heal_Effect 是 11 格 192×192 的綠色爆開，
    # 拿來當「城牆修補」道具的特效，不用另外找素材。
    heal = Image.open(B + 'free-pack/Units/Blue Units/Monk/Heal_Effect.png')
    frames = heal.width // 192
    strip = Image.new('RGBA', (96 * frames, 96))
    for c in range(frames):
        cell = heal.crop((c * 192, 0, (c + 1) * 192, 192)).resize((96, 96), Image.LANCZOS)
        strip.paste(cell, (c * 96, 0))
    put('heal', strip)

    # 裝飾：樹取搖擺動畫第一格，石頭本來就是單張 64×64
    for name, path, box in [
        ('tree1', 'free-pack/Terrain/Resources/Wood/Trees/Tree1.png', (0, 0, 192, 256)),
        ('tree2', 'free-pack/Terrain/Resources/Wood/Trees/Tree3.png', (0, 0, 192, 192)),
    ]:
        im = Image.open(B + path).crop(box)
        im = im.crop(im.getbbox())          # 去掉四周透明留白，才能用底部對齊放進地圖
        put(name, im.resize((im.width // 2, im.height // 2), Image.LANCZOS))
    for i in (1, 2, 3, 4):
        rk = Image.open(B + 'free-pack/Terrain/Decorations/Rocks/Rock%d.png' % i)
        put('rock' + str(i), rk.crop(rk.getbbox()))

    with open(OUT, 'w') as f:
        json.dump(art, f, indent=1, sort_keys=True)

    total = sum(os.path.getsize('%s/%s.png' % (OUTDIR, k)) for k in art)
    print('%d 張圖，合計 %.0f KB' % (len(art), total / 1024))


if __name__ == '__main__':
    main()
