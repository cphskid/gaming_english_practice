#!/usr/bin/env python3
"""
魔王團戰的美術：十隻魔王的動畫條、十張戰場背景。

用法：python3 tools/build-raid-art.py <素材解壓縮的資料夾>
（原始 zip 在專案共用資料夾 boss-raid/boss-zips/，背景是 ansimuz 的 CC0 包，
下載法見 CREDITS.md。）

輸出：
  public/raid/<魔王>/<動作>.png   一條橫的動畫條，每格一樣大
  public/raid/bg/<背景>.png       背景合成一張（原生解析度，遊戲裡用最近鄰放大）
  src/data/raid-art.json          每隻魔王每個動作幾格、每格多大、腳底在哪

**每隻魔王的所有動作共用同一個方框**（取全部格子的聯集再裁），
換動作的時候人物才不會跳一下。原圖面向右的不翻，面向左的翻過來——
戰場上魔王在左邊，一律要面向右邊（朝著小朋友的兵）。
"""
import json, os, sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/s'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'raid')

def strip(path, n=None, fw=None):
    im = Image.open(os.path.join(SRC, path)).convert('RGBA')
    w = fw or (im.width // n if n else im.height)
    return [im.crop((i * w, 0, (i + 1) * w, im.height)) for i in range(im.width // w)]

def folder(path, prefix=None):
    d = os.path.join(SRC, path)
    fs = [f for f in os.listdir(d) if f.endswith('.png')]
    num = lambda f: int(''.join(c for c in f.rsplit('_', 1)[-1] if c.isdigit()) or 0)
    return [Image.open(os.path.join(d, f)).convert('RGBA') for f in sorted(fs, key=num)]

C = 'boss-frost-guardian/Frost_Guardian_FREE_v1.0/PNG files/'
D = 'boss-demon-slime/boss_demon_slime_FREE_v1.0/individual sprites/'
M = 'boss-minotaur/mino_v1.1_free/animations/'
Q = 'free-cthulu/free_cthulu/animations/PNG/'
E1 = 'evil-wizard/Evil Wizard/Sprites/'
E2 = 'evil-wizard-2/EVil Wizard 2/Sprites/'
E3 = 'evil-wizard-3/Evil Wizard 3/Sprites/'
FW = 'fire-worm/Fire Worm/Sprites/Worm/'
K = 'medieval-king-pack/Medieval King Pack/'
MI = 'monsters-creatures-fantasy-2/Monsters Creatures Fantasy 2/Mimic/'

# flip＝原圖面向左，要翻成面向右
BOSSES = {
    'mimic':    dict(flip=False, idle=lambda: strip(MI + 'idle_transformed.png', fw=146),
                     attack=lambda: strip(MI + 'attack_1.png', fw=146),
                     hurt=lambda: strip(MI + 'hurt.png', fw=146), death=lambda: strip(MI + 'death.png', fw=146)),
    'minotaur': dict(flip=True, idle=lambda: folder(M + 'idle'), attack=lambda: folder(M + 'atk_1')),
    'worm':     dict(flip=False, idle=lambda: strip(FW + 'Idle.png', fw=90), attack=lambda: strip(FW + 'Attack.png', fw=90),
                     hurt=lambda: strip(FW + 'Get Hit.png', fw=90), death=lambda: strip(FW + 'Death.png', fw=90)),
    'king':     dict(flip=True, idle=lambda: strip(K + 'Idle.png', 6), attack=lambda: strip(K + 'Attack_1.png', 6),
                     hurt=lambda: strip(K + 'Hit.png', 4), death=lambda: strip(K + 'Death.png', 11)),
    'wizard':   dict(flip=False, idle=lambda: strip(E1 + 'Idle.png', 8), attack=lambda: strip(E1 + 'Attack.png', 8),
                     hurt=lambda: strip(E1 + 'Take Hit.png', 4), death=lambda: strip(E1 + 'Death.png', 5)),
    'cthulhu':  dict(flip=False, idle=lambda: folder(Q + 'idle'), attack=lambda: folder(Q + '1atk'),
                     hurt=lambda: folder(Q + 'hurt'), death=lambda: folder(Q + 'death')),
    'demon':    dict(flip=True, idle=lambda: folder(D + '01_demon_idle'), attack=lambda: folder(D + '03_demon_cleave'),
                     hurt=lambda: folder(D + '04_demon_take_hit'), death=lambda: folder(D + '05_demon_death')),
    'frost':    dict(flip=True, idle=lambda: folder(C + 'idle'), attack=lambda: folder(C + '1_atk'),
                     hurt=lambda: folder(C + 'take_hit'), death=lambda: folder(C + 'death')),
    'shadow':   dict(flip=False, idle=lambda: strip(E2 + 'Idle.png', 8), attack=lambda: strip(E2 + 'Attack1.png', 8),
                     hurt=lambda: strip(E2 + 'Take hit.png', 3), death=lambda: strip(E2 + 'Death.png', 7)),
    'lich':     dict(flip=False, idle=lambda: strip(E3 + 'Idle.png', 10), attack=lambda: strip(E3 + 'Attack.png', 13),
                     hurt=lambda: strip(E3 + 'Get hit.png', 3), death=lambda: strip(E3 + 'Death.png', 18)),
}

GC = 'bg-gothicvania-cemetery/gothicvania-cemetery-files/Assets/Environment/'
GT = 'bg-gothicvania-town/GothicVania-town-files/PNG/environment/layers/'
SG = 'bg-super-grotto-escape-pack/Super Grotto Escape Files/Assets/Environment/Layers/'
SF = 'bg-sunnyland-forest/Sunny-land-forest-files/Assets/PNG/environment/layers/'
UW = 'bg-underwater-diving/underwater-diving-files/PNG/environment/'
MC = 'bg-magic-cliffs-environment/Magic-Cliffs-Gamekit/Assets/Environment/PNG/'
WC = 'bg-warped-caves/warped-files/Assets/PNG/environment/layers/'
BGS = {
    'grotto':   [SG + 'back.png', SG + 'far.png'],
    'forest':   [SF + 'background.png', SF + 'middleground.png'],
    'caves':    [WC + 'background.png', WC + 'middleground-no-fungus.png'],
    'town':     [GT + 'background.png', GT + 'middleground.png'],
    'cemetery': [GC + 'background.png', GC + 'graveyard.png'],
    'sea':      [UW + 'background.png'],
    'fungus':   [WC + 'background.png', WC + 'middleground.png'],
    'cliffs':   [MC + 'sky.png', MC + 'clouds.png'],
    'crystal':  [SG + 'back.png', SG + 'far.png', SG + 'middle.png'],
    'dusk':     [GT + 'background.png'],
}
BG_H = 216                 # 所有背景統一這個高度
BG_W = round(BG_H * 1088 / 576)

def build_boss(key, spec):
    anims = {}
    for a in ('idle', 'attack', 'hurt', 'death'):
        if a in spec:
            fr = spec[a]()
            if spec['flip']:
                fr = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in fr]
            anims[a] = fr
    # 所有格子的聯集方框
    box = None
    for fr in anims.values():
        for f in fr:
            b = f.getbbox()
            if not b:
                continue
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    # 腳底：idle 第一格最下面那一列不透明的地方
    idle_box = anims['idle'][0].getbbox()
    w, h = box[2] - box[0], box[3] - box[1]
    os.makedirs(os.path.join(OUT, key), exist_ok=True)
    meta = {'w': w, 'h': h, 'foot': idle_box[3] - box[1], 'anims': {}}
    # 身體中心（idle 第一格），畫面上用來對齊血條與被打的位置
    meta['cx'] = (idle_box[0] + idle_box[2]) / 2 - box[0]
    for a, fr in anims.items():
        sheet = Image.new('RGBA', (w * len(fr), h))
        for i, f in enumerate(fr):
            sheet.paste(f.crop(box), (i * w, 0))
        sheet.save(os.path.join(OUT, key, a + '.png'), optimize=True)
        meta['anims'][a] = len(fr)
    face(anims['idle'][0]).save(os.path.join(OUT, key, 'face.png'), optimize=True)
    return meta


def face(img):
    """外框角落那顆小頭像（48×48）：idle 第一格，高的只取上半身。"""
    img = img.crop(img.getbbox())
    w, h = img.size
    # 高的（人形）只取上半身，才看得出臉；寬的（寶箱、蟲）整隻放進去
    s = int(max(w * 0.8, h * 0.55)) if h > w * 0.9 else max(w, h)
    s = min(s, max(w, h))
    cx = w // 2
    box = (cx - s // 2, 0, cx - s // 2 + s, s) if h > w * 0.9 else (0, 0, w, h)
    img = img.crop(box)
    sq = Image.new('RGBA', (max(img.size),) * 2)
    sq.paste(img, ((sq.size[0] - img.size[0]) // 2, sq.size[1] - img.size[1]))
    return sq.resize((48, 48), Image.LANCZOS)

def build_bg(key, layers):
    out = Image.new('RGBA', (BG_W, BG_H))
    for p in layers:
        im = Image.open(os.path.join(SRC, p)).convert('RGBA')
        im = im.resize((max(1, round(im.width * BG_H / im.height)), BG_H), Image.NEAREST)
        t = Image.new('RGBA', (BG_W, BG_H))
        x = 0
        while x < BG_W:
            t.paste(im, (x, 0)); x += im.width
        out = Image.alpha_composite(out, t)
    os.makedirs(os.path.join(OUT, 'bg'), exist_ok=True)
    out.convert('RGB').save(os.path.join(OUT, 'bg', key + '.png'), optimize=True)

if __name__ == '__main__':
    meta = {k: build_boss(k, s) for k, s in BOSSES.items()}
    for k, l in BGS.items():
        build_bg(k, l)
    with open(os.path.join(ROOT, 'src', 'data', 'raid-art.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(json.dumps({k: (v['w'], v['h'], v['anims']) for k, v in meta.items()}, ensure_ascii=False))
