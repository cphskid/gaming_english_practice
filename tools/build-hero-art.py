#!/usr/bin/env python3
"""
職業英雄的動畫條：戰場上那位「你本人」（2026-09-25）。

    python3 tools/build-hero-art.py

原圖在 assets/heroes/（LuizMelo 的 Hero Knight 與 Wizard Pack，都是 CC0）。
輸出：
  public/heroes/<職業>/<動作>.png   一條橫的動畫條，每格一樣大
  src/data/hero-art.json            每個職業每個動作幾格、每格多大、腳底與身體中心在哪

跟魔王一樣，**同一個職業的所有動作共用一個方框**（全部格子的聯集），
換動作時人物才不會跳一下。兩套原圖都面向右，英雄站在左邊朝右打，不用翻。
攻擊的刀光和光球是原圖本來就畫好的，所以方框會比身體大很多，
畫面上靠 cx／foot 對齊，不要拿方框中心當身體中心。
"""
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'heroes')
OUT = os.path.join(ROOT, 'public', 'heroes')

# 職業 → (資料夾, 每格寬, {動作: 檔名})
HEROES = {
    'knight': ('hero-knight', 180, {'idle': 'Idle', 'run': 'Run', 'attack': 'Attack1', 'attack2': 'Attack2'}),
    'mage':   ('wizard-pack', 231, {'idle': 'Idle', 'run': 'Run', 'attack': 'Attack2', 'attack2': 'Attack1'}),
}


def strip(path, fw):
    im = Image.open(path).convert('RGBA')
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(im.width // fw)]


def build(job, folder, fw, files):
    anims = {a: strip(os.path.join(SRC, folder, f + '.png'), fw) for a, f in files.items()}
    box = None
    for fr in anims.values():
        for f in fr:
            b = f.getbbox()
            if b:
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    w, h = box[2] - box[0], box[3] - box[1]
    idle = anims['idle'][0].getbbox()
    meta = {'w': w, 'h': h, 'foot': idle[3] - box[1], 'cx': (idle[0] + idle[2]) / 2 - box[0],
            'body': idle[3] - idle[1], 'anims': {}}
    os.makedirs(os.path.join(OUT, job), exist_ok=True)
    for a, fr in anims.items():
        sheet = Image.new('RGBA', (w * len(fr), h))
        for i, f in enumerate(fr):
            sheet.paste(f.crop(box), (i * w, 0))
        sheet.save(os.path.join(OUT, job, a + '.png'), optimize=True)
        meta['anims'][a] = len(fr)
    return meta


meta = {job: build(job, *spec) for job, spec in HEROES.items()}
with open(os.path.join(ROOT, 'src', 'data', 'hero-art.json'), 'w') as f:
    json.dump(meta, f, indent=1)
print(json.dumps(meta))
