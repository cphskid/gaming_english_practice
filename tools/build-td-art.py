"""把 Tiny Swords 素材裁切、縮放並轉成 data URI，產生 games/tower-defense/art.js。

素材原圖每格 192×192，遊戲裡只畫到 64 上下，所以先縮小可以讓
產出的檔案小一個數量級。需要換素材或調大小時重跑這支就好。

    python3 tools/build-td-art.py
"""
from PIL import Image
import base64, io, json, os

B = 'assets/tiny-swords/'
OUT = 'games/tower-defense/art.js'


def to_data_uri(im):
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    art = {}

    # 哥布林走路：Torch 圖表第 0 列是面向右的 7 格循環
    for name, path in [
        ('goblinRed', 'update-010/Factions/Goblins/Troops/Torch/Red/Torch_Red.png'),
        ('goblinPurple', 'update-010/Factions/Goblins/Troops/Torch/Purple/Torch_Purple.png'),
    ]:
        sheet = Image.open(B + path)
        strip = Image.new('RGBA', (192 * 7, 192))
        for c in range(7):
            strip.paste(sheet.crop((c * 192, 0, (c + 1) * 192, 192)), (c * 192, 0))
        art[name] = to_data_uri(strip.resize((64 * 7, 64), Image.LANCZOS))

    # 建築是單張圖，縮一半就夠用
    for name, path in [
        ('archery', 'free-pack/Buildings/Blue Buildings/Archery.png'),
        ('barracks', 'free-pack/Buildings/Blue Buildings/Barracks.png'),
        ('castle', 'free-pack/Buildings/Blue Buildings/Castle.png'),
    ]:
        im = Image.open(B + path)
        art[name] = to_data_uri(im.resize((im.width // 2, im.height // 2), Image.LANCZOS))

    # 軍營派出的士兵，取待機動畫第一格
    w = Image.open(B + 'free-pack/Units/Blue Units/Warrior/Warrior_Idle.png')
    art['warrior'] = to_data_uri(w.crop((0, 0, 192, 192)).resize((64, 64), Image.LANCZOS))

    with open(OUT, 'w') as f:
        f.write('// 由 assets/tiny-swords 裁切縮放產生，見 tools/build-td-art.py\n')
        f.write('window.TD_ART = ' + json.dumps(art) + ';\n')

    print('%s  (%.0f KB)' % (OUT, os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
