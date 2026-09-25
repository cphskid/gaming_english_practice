"""第二、三章的地形與城堡：從第一章的圖調色出來，產生 public/td-art/ 的新圖並併進索引。

    python3 tools/build-chapter-art.py      （要先跑過 tools/build-td-art.py）

2026-09-25 跟 Chuck 定的三章外觀：
- 第一章 草地城堡：原樣。
- 第二章 雪地神殿：Tiny Swords 的草地調成雪地（同一套圖，畫風一致），
  城堡換成神殿（Monastery，五色都有），屋頂蓋一層雪。
- 第三章 草原木堡：草地調成乾草原的黃綠色。**木堡**要用 Tiny Swords 舊版（CC0）的城堡，
  那包還沒進 repo，先沿用第一章的城堡，拿到之後在這裡加一段就好。

只調色、不重畫，所以地磚的切法、樹的尺寸都跟第一章一模一樣，引擎不用改拼法。
"""
import colorsys, json, os
import numpy as np
from PIL import Image

OUT = 'public/td-art'
IDX = 'public/td-art.json'
B = 'assets/tiny-swords/free-pack/'
COLORS = ['Blue', 'Red', 'Purple', 'Yellow', 'Black']


def hsv_arrays(im):
    a = np.asarray(im.convert('RGBA')).astype(np.float32) / 255.0
    rgb, al = a[..., :3], a[..., 3:]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn + 1e-6
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-6), 0)
    return h, s, mx, al


def to_rgb(h, s, v, al):
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    out = np.concatenate([np.stack([r, g, b], -1), al], -1)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA')


def green_mask(h, s, lo=0.14):
    # 草和樹葉：黃綠到青綠。石壁（青灰、低彩度）和樹幹（棕）不動。
    # 樹葉的亮面偏黃（h≈0.1），樹要把下限放寬，不然樹頂會留一撮黃綠色
    return (h > lo) & (h < 0.36) & (s > 0.22)


def snow(im, lo=0.14):
    h, s, v, al = hsv_arrays(im)
    m = green_mask(h, s, lo)
    # 亮度保留原圖的明暗（草的紋理變成雪的起伏），整體拉到很亮、偏一點點藍
    v2 = np.where(m, 0.80 + 0.20 * v, v)
    s2 = np.where(m, 0.05 + 0.10 * (1 - v), s)
    h2 = np.where(m, 0.58, h)
    return to_rgb(h2, s2, v2, al)


def meadow(im, lo=0.14):
    h, s, v, al = hsv_arrays(im)
    m = green_mask(h, s, lo)
    # 乾草原：往黃綠推一點、彩度壓低一點（太黃會跟土路糊在一起）
    h2 = np.where(m, h - 0.03, h)
    s2 = np.where(m, s * 0.82, s)
    v2 = np.where(m, np.minimum(1, v * 1.02), v)
    return to_rgb(h2, s2, v2, al)


def icy_water(im):
    h, s, v, al = hsv_arrays(im)
    return to_rgb(np.full_like(h, 0.54), s * 0.55, np.minimum(1, v * 1.08 + 0.05), al)


def snow_cap(im, depth=5, upto=0.72):
    """每一欄最上面那幾個不透明的像素蓋成雪。只蓋上面 72%，門和牆腳不會積雪。"""
    a = np.asarray(im.convert('RGBA')).copy()
    H, W = a.shape[:2]
    for x in range(W):
        col = np.nonzero(a[:, x, 3] > 128)[0]
        if not len(col): continue
        y0 = col[0]
        if y0 > H * upto: continue
        for k in range(depth + (x * 7 % 3)):
            y = y0 + k
            if y >= H or a[y, x, 3] < 128: break
            shade = 255 - k * 7
            a[y, x, :3] = (shade - 12, shade - 4, shade)
    # 屋簷那一格斜面：有不透明像素、正上方透明的地方也蓋一點（斜屋頂每一階都有雪）
    for y in range(1, int(H * upto)):
        for x in range(W):
            if a[y, x, 3] > 128 and a[y - 1, x, 3] < 60:
                a[y, x, :3] = (236, 244, 252)
    return Image.fromarray(a, 'RGBA')


def main():
    idx = json.load(open(IDX))

    def put(key, im):
        im.save('%s/%s.png' % (OUT, key), 'PNG', optimize=True)
        idx[key] = 'td-art/%s.png' % key

    for name in ('tiles', 'tree1', 'tree2'):
        src = Image.open('%s/%s.png' % (OUT, name))
        lo = 0.14 if name == 'tiles' else 0.07
        put(name + '_snow', snow(src, lo))
        put(name + '_meadow', meadow(src, lo))
    put('water_snow', icy_water(Image.open('%s/water.png' % OUT)))

    # 神殿：跟城堡一樣五色，縮一半（引擎照圖的比例畫，不會壓扁）
    for color in COLORS:
        suffix = '' if color == 'Blue' else '_' + color.lower()
        im = Image.open(B + 'Buildings/%s Buildings/Monastery.png' % color).convert('RGBA')
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        put('temple' + suffix, snow_cap(im, depth=5))

    with open(IDX, 'w') as f:
        json.dump(idx, f, indent=1, sort_keys=True)
    print('ok', len(idx))


main()
