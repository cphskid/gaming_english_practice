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

    legions()

    with open(OUT, 'w') as f:
        json.dump(art, f, indent=1, sort_keys=True)

    total = sum(os.path.getsize('%s/%s.png' % (OUTDIR, k)) for k in art)
    print('%d 張圖，合計 %.0f KB' % (len(art), total / 1024))


# ---------------------------------------------------------------------------
# 軍團包（2026-09-24）。一套軍團＝一個鍵名前綴，換的東西是固定那幾張：
#   u_spear / u_bow / u_shield   兵推三條線（有的軍團每一階長得不一樣，就多 2、3 兩張）
#   castle / archery             兵推的城堡與塔；archery 同時是守塔的箭塔
#   warrior                      守塔軍營派出來的士兵
# 引擎找不到某張就退回王國軍那張，所以新軍團缺一張不會開天窗。
# 哪一套叫什麼、放在商店哪一級，寫在 src/data/legions.ts。

# 王國軍三條線在 112 方框裡腳底落在第 70 列、人站在正中間。
# 別的軍團一律照這個對齊，換軍團時整排兵才不會浮起來或陷進地裡。
FOOT, MID = 70, 56


def unit_box(im, scale, nearest=False, flip=False):
    """裁掉透明邊、縮放、腳底對齊王國軍，貼進 112 方框。"""
    im = im.crop(im.getbbox())
    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    if nearest:
        # 像素圖不是整數倍的時候：先整數倍放大到比目標大，再平滑縮回來，
        # 邊緣才不會一格粗一格細。
        big = im.resize((im.width * 4, im.height * 4), Image.NEAREST)
        im = big.resize((w, h), Image.LANCZOS)
    else:
        im = im.resize((w, h), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    box = Image.new('RGBA', (112, 112), (0, 0, 0, 0))
    box.paste(im, (MID - w // 2, FOOT - h), im)
    return box


def fit_bottom(im, size, max_w, max_h, nearest=False, scale=None):
    """整張縮進 size 大小的畫布，貼底置中。建築用（城堡 160×128、塔 96×128）。"""
    im = im.crop(im.getbbox())
    s = scale or min(max_w / im.width, max_h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.NEAREST if nearest else Image.LANCZOS)
    out = Image.new('RGBA', size, (0, 0, 0, 0))
    out.paste(im, ((size[0] - im.width) // 2, size[1] - im.height - 1), im)
    return out


def frame(path, w, h=None, i=0, row=0):
    """橫向連續圖的第 i 格（Kings and Pigs 的檔名就寫著每格多大）。"""
    im = Image.open(path).convert('RGBA')
    h = h or im.height
    return im.crop((i * w, row * h, (i + 1) * w, (row + 1) * h))


def stack(*parts):
    """由下往上疊：[(圖, x 偏移, 跟下面那張重疊幾列)]，回傳合成的一張（原尺寸）。"""
    parts = [(p.crop(p.getbbox()), dx, ov) for p, dx, ov in parts]
    width = max(dx + p.width for p, dx, _ in parts) - min(dx for _, dx, _ in parts)
    x0 = -min(dx for _, dx, _ in parts)
    height = sum(p.height - ov for p, _, ov in parts)
    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    y = height
    for p, dx, ov in parts:
        y -= p.height
        out.alpha_composite(p, (x0 + dx, y))
        y += ov
    return out


def side(*parts):
    """左右並排、腳底對齊：[(圖, 疊到前一張多少像素)]。後面的畫在上面。"""
    parts = [(p.crop(p.getbbox()), ov) for p, ov in parts]
    width = sum(p.width - ov for p, ov in parts)
    height = max(p.height for p, _ in parts)
    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    x = 0
    for p, ov in parts:
        x -= ov
        out.alpha_composite(p, (x, height - p.height))
        x += p.width
    return out


def legions():
    # ---- 哥布林軍團（普通級）。Tiny Swords 同一位作者、同一個像素密度，
    # 跟草地放在一起完全不違和，所以兵推的戰場不用換地形。藍色那一套。
    G = B + 'update-010/Factions/Goblins/'
    torch = Image.open(G + 'Troops/Torch/Blue/Torch_Blue.png').crop((0, 0, 192, 192))
    tnt = Image.open(G + 'Troops/TNT/Blue/TNT_Blue.png').crop((0, 0, 192, 192))
    barrel = Image.open(G + 'Troops/Barrel/Blue/Barrel_Blue.png').crop((4 * 128, 128, 5 * 128, 256))
    # 認字＝拿火把的小兵、聽音＝丟炸藥的（遠程）、拼字＝躲在木桶裡的（耐打）
    put('gob_u_spear', unit_box(torch, 1 / 3))
    put('gob_u_bow', unit_box(tnt, 1 / 3))
    put('gob_u_shield', unit_box(barrel, 1 / 2.4))
    put('gob_castle', fit_bottom(Image.open(G + 'Buildings/Wood_House/Goblin_House.png'), (160, 128), 150, 124))
    put('gob_archery', fit_bottom(
        Image.open(G + 'Buildings/Wood_Tower/Wood_Tower_Blue.png').crop((0, 0, 256, 192)), (96, 128), 96, 110))
    w = torch.crop(torch.getbbox()).resize((32, 34), Image.LANCZOS)
    s = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    s.paste(w, (34 - 16, 48 - 34), w)
    put('gob_warrior', s)

    # ---- 豬軍團（稀有級）。Kings and Pigs，CC0。一格只有 26~38 像素，
    # **一律整數倍放大（NEAREST）**，不然像素會糊掉。豬原本全部面向左邊，
    # 我方要面向右，所以都翻過來（對手那邊引擎會再翻一次）。
    P = 'assets/kings-and-pigs/Sprites/'
    pig = frame(P + '03-Pig/Idle (34x28).png', 34)
    boxpig = frame(P + '04-Pig Throwing a Box/Idle (26x30).png', 26)
    bombpig = frame(P + '05-Pig Thowing a Bomb/Idle (26x26).png', 26)
    matchpig = frame(P + '07-Pig With a Match/Match On (26x18).png', 26)
    hide = frame(P + '06-Pig Hide in the Box/Looking Out (26x20).png', 26, i=1)
    king = frame(P + '02-King Pig/Jump (38x28).png', 38)
    cannon = Image.open(P + '10-Cannon/Idle.png').convert('RGBA')
    box = Image.open(P + '08-Box/Idle.png').convert('RGBA')
    door = Image.open(P + '11-Door/Idle.png').convert('RGBA')

    # 豬一格才 17 像素高，放大 1.5 倍剛好跟王國軍的兵一樣高（26 上下）。
    # 放兩倍的話豬看起來比對手大一號，小朋友會以為豬比較強。
    PS = 1.5

    # 九格升階（Chuck 2026-09-24 定案）：
    #   認字 豬兵 → 豬兵帶隨從 → 大豬兵帶兩個隨從（同一種豬，隨從是引擎畫的）
    #   聽音 丟箱子豬 → 丟炸彈豬 → 火柴豬推大砲（三階都不一樣）
    #   拼字 箱中豬 → 箱中豬帶隨從 → 豬王從箱子裡跳出來
    put('pig_u_spear', unit_box(pig, PS, True, True))
    put('pig_u_bow', unit_box(boxpig, PS, True, True))
    put('pig_u_bow2', unit_box(bombpig, PS, True, True))
    # 大砲原本也朝左（砲口在左）。火柴豬站在砲後面點火，整組翻過來就是朝右開砲。
    put('pig_u_bow3', unit_box(side((cannon, 0), (matchpig, 6)), PS, True, True))
    put('pig_u_shield', unit_box(hide, PS, True, True))
    # 豬王的下半身藏在箱子後面，看起來像從箱子裡跳出來
    k, b = king.crop(king.getbbox()), box.crop(box.getbbox())
    jump = Image.new('RGBA', (max(k.width, b.width), k.height + b.height - 12), (0, 0, 0, 0))
    jump.alpha_composite(k, ((jump.width - k.width) // 2, 0))
    jump.alpha_composite(b, ((jump.width - b.width) // 2, jump.height - b.height))
    put('pig_u_shield3', unit_box(jump, PS, True, True))

    # 兵推的城堡＝那扇門，塔＝疊兩個箱子當台子、上面架大砲（火柴豬在旁邊點火）。
    put('pig_castle', fit_bottom(door, (160, 128), 0, 0, True, 2))
    gun = side((matchpig.transpose(Image.FLIP_LEFT_RIGHT), 0), (cannon.transpose(Image.FLIP_LEFT_RIGHT), 6))
    put('pig_archery', fit_bottom(stack((box, 1, 0), (box, 1, 0), (gun, 0, 0)), (96, 128), 0, 0, True, 2))
    # 守塔的士兵：64 方框，腳底在 48 那一列（跟王國軍的 warrior 一樣），一樣放 1.5 倍
    p = pig.crop(pig.getbbox()).transpose(Image.FLIP_LEFT_RIGHT)
    p = p.resize((p.width * 4, p.height * 4), Image.NEAREST).resize(
        (round(p.width * PS), round(p.height * PS)), Image.LANCZOS)
    s = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    s.paste(p, (34 - p.width // 2, 48 - p.height), p)
    put('pig_warrior', s)

    # 兵推的戰場：側視的城堡室內。32 像素的格子放大兩倍剛好是遊戲的 64 格。
    T = Image.open(P + '14-TileSets/Terrain (32x32).png').convert('RGBA')
    tile = lambda c, r: T.crop((c * 32, r * 32, c * 32 + 32, r * 32 + 32)).resize((64, 64), Image.NEAREST)
    put('pig_wall', tile(2, 8))        # 背後那面粉紅磚牆
    put('pig_floor', tile(2, 1))       # 地板最上面那一排（亮色的石頭邊）
    put('pig_under', tile(2, 2))       # 地板底下的暗色
    D = Image.open(P + '14-TileSets/Decorations (32x32).png').convert('RGBA')
    win = D.crop((64, 96, 128, 160))
    win = win.crop(win.getbbox())
    put('pig_window', win.resize((win.width * 2, win.height * 2), Image.NEAREST))


if __name__ == '__main__':
    main()
