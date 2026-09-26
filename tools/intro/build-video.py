"""
把錄好的遊戲畫面剪成介紹影片（1280×720，字幕＋音樂，沒有旁白）。

    node tools/intro/rec-td.mjs 9 $W/vid 40      → 改名 td09.webm
    node tools/intro/rec-tug.mjs $W/vid          → tug.webm
    node tools/intro/rec-raid.mjs $W/vid golem   → raid.webm
    python3 tools/intro/build-video.py $W        → $W/out/intro.mp4

$W 底下要有 vid/（上面三段）、shots/01-title.png、fonts/（NotoSansTC.ttf、MedievalSharp.ttf，都是 OFL）。
ffmpeg 用 pip 的 imageio-ffmpeg 那一支就夠（要有 libx264）。字幕用 Pillow 畫成透明圖再疊上去，
因為那支 ffmpeg 沒有 drawtext。
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
REPO = Path(__file__).resolve().parents[2]
PF = Path('/mnt/project-files')
TMP = W / 'build'
OUT = W / 'out'
TMP.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)

VW, VH, FPS = 1280, 720, 30
# 遊戲畫面縮成 85%，下面留一條字幕帶，才不會蓋到答題板
GW, GH, GX = 1088, 612, 96
BG = (18, 26, 37)
GOLD = (255, 214, 107)
FADE = 0.35


def font(size, weight='Black'):
    f = ImageFont.truetype(str(W / 'fonts/NotoSansTC.ttf'), size)
    f.set_variation_by_name(weight)
    return f


def ff(*args):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)


def caption_frame(name, main, sub):
    """整張 1280×720 的框：中間挖空放遊戲，左右與下方是深色，下方寫字幕。"""
    im = Image.new('RGBA', (VW, VH), BG + (255,))
    d = ImageDraw.Draw(im)
    d.rectangle([GX, 0, GX + GW - 1, GH - 1], fill=(0, 0, 0, 0))
    d.rectangle([0, GH, VW, GH + 4], fill=GOLD + (255,))
    f1, f2 = font(44), font(26, 'Medium')
    w1 = d.textlength(main, font=f1)
    d.text((GX, GH + 22), main, font=f1, fill=GOLD)
    d.text((GX + w1 + 28, GH + 38), sub, font=f2, fill=(235, 240, 248))
    p = TMP / f'cap-{name}.png'
    im.save(p)
    return p


def game_seg(name, src, start, dur, main, sub):
    cap = caption_frame(name, main, sub)
    out = TMP / f'{name}.mp4'
    ff('-ss', str(start), '-t', str(dur), '-i', str(W / 'vid' / src), '-i', str(cap),
       '-filter_complex',
       f'[0:v]fps={FPS},scale={GW}:{GH}:flags=lanczos,pad={VW}:{VH}:{GX}:0:color=0x121a25[g];'
       f'[g][1:v]overlay=0:0,format=yuv420p[v]',
       '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', str(out))
    return out, dur


def still_seg(name, img, dur, zoom=0.05):
    """一張圖慢慢推近（Ken Burns）。先放大兩倍再 zoompan，才不會抖。"""
    out = TMP / f'{name}.mp4'
    n = int(dur * FPS)
    ff('-loop', '1', '-i', str(img), '-filter_complex',
       f'[0:v]scale={VW * 2}:{VH * 2},zoompan=z=\'1+{zoom}*on/{n}\':d={n}:'
       f'x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s={VW}x{VH}:fps={FPS},format=yuv420p[v]',
       '-map', '[v]', '-t', str(dur), '-c:v', 'libx264', '-crf', '18', str(out))
    return out, dur


def rounded(im, r):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    im.putalpha(mask)
    return im


def collect_card():
    """三支手機並排：我的角色（軍團）、徽章牆、本週之星。"""
    im = Image.new('RGB', (VW, VH), BG)
    shots = [PF / 'legion-v1/我的角色.png', PF / 'achievements-v2/徽章牆.png', PF / 'economy-balance/本週之星.png']
    labels = ['職業與軍團', '徽章牆', '本週之星']
    ph = 540
    pw = int(ph * 390 / 844)
    gap = 70
    x0 = (VW - (3 * pw + 2 * gap)) // 2
    d = ImageDraw.Draw(im)
    for i, (s, lab) in enumerate(zip(shots, labels)):
        x = x0 + i * (pw + gap)
        y = 28
        d.rounded_rectangle([x - 8, y - 8, x + pw + 8, y + ph + 8], 26, fill=(40, 52, 70))
        ph_im = rounded(Image.open(s).convert('RGB').resize((pw, ph), Image.LANCZOS).convert('RGBA'), 18)
        im.paste(ph_im, (x, y), ph_im)
        f = font(24, 'Bold')
        tw = d.textlength(lab, font=f)
        d.text((x + (pw - tw) / 2, y + ph + 12), lab, font=f, fill=(235, 240, 248))
    p = TMP / 'collect-bg.png'
    im.save(p)
    return p


def collect_seg(dur):
    bg = collect_card()
    cap = caption_frame('collect', '收集與成就', '每週重新比，每個人都有機會上榜')
    # 字幕框中間是挖空的，這裡整張都要露出來，所以只取下面那條
    c = Image.open(cap)
    base = Image.open(bg).convert('RGBA')
    strip = c.crop((0, GH, VW, VH))
    base.paste(strip, (0, GH), strip)
    full = TMP / 'collect.png'
    base.convert('RGB').save(full)
    return still_seg('collect', full, dur, zoom=0.03)


def end_card():
    bg = Image.open(REPO / 'public/title/floating-city.jpg').convert('RGB')
    s = max(VW / bg.width, VH / bg.height)
    bg = bg.resize((int(bg.width * s) + 1, int(bg.height * s) + 1), Image.LANCZOS)
    bg = bg.crop(((bg.width - VW) // 2, (bg.height - VH) // 2, (bg.width - VW) // 2 + VW, (bg.height - VH) // 2 + VH))
    bg = bg.filter(ImageFilter.GaussianBlur(6))
    dark = Image.new('RGBA', (VW, VH), (8, 14, 30, 150))
    im = Image.alpha_composite(bg.convert('RGBA'), dark)
    d = ImageDraw.Draw(im)

    def center(y, text, f, fill, shadow=True):
        tw = d.textlength(text, font=f)
        if shadow:
            d.text(((VW - tw) / 2 + 3, y + 3), text, font=f, fill=(0, 0, 0, 180))
        d.text(((VW - tw) / 2, y), text, font=f, fill=fill)

    center(150, 'World Guardians', ImageFont.truetype(str(W / 'fonts/MedievalSharp.ttf'), 96), (235, 245, 255))
    center(280, '守 護 異 世 界', font(72), GOLD)
    center(390, '用語言魔力來冒險吧！', font(40, 'Bold'), (255, 255, 255))
    center(480, '85 關  ・  國中小 2000 字  ・  讀字 聽字 拼字', font(30, 'Medium'), (220, 230, 245))
    center(600, 'cphskid.github.io/gaming_english_practice', font(28, 'Medium'), (200, 215, 235))
    p = TMP / 'end.png'
    im.convert('RGB').save(p)
    return p


segs = [
    still_seg('title', W / 'shots/01-title.png', 4.5, zoom=0.06),
    game_seg('td', 'td09.webm', 15, 10, '守塔闖關', '點出寫著這個字的怪，所有箭塔一起發射'),
    game_seg('read', 'tug.webm', 18, 5, '兵推對戰・讀字', '看中文，點對的英文，派兵往前推'),
    game_seg('listen', 'tug.webm', 51, 5, '聽字', '聽發音，找出對的字'),
    game_seg('spell', 'tug.webm', 62.5, 6.5, '拼字', '一個字母一個字母拼出來'),
    game_seg('raid1', 'raid.webm', 9.3, 2.8, '魔王團戰', '全班一起打，四級共 20 隻魔王'),
    game_seg('raid2', 'raid.webm', 54, 7, '魔王團戰', '神話魔王打到半血會變身'),
    game_seg('raidwin', 'raid.webm', 88.2, 3.4, '打贏了！', '徽章分五階：銅、銀、金、白金、鑽石'),
    collect_seg(7),
    still_seg('end', end_card(), 6.5, zoom=0.04),
]

# 串起來：每一段之間淡入淡出
inputs, chain = [], []
for p, _ in segs:
    inputs += ['-i', str(p)]
t = segs[0][1]
prev = '[0:v]'
for i in range(1, len(segs)):
    off = t - FADE
    lab = f'[x{i}]'
    chain.append(f'{prev}[{i}:v]xfade=transition=fade:duration={FADE}:offset={off:.3f}{lab}')
    prev = lab
    t = off + segs[i][1]
total = t
music = REPO / 'public/audio/music/battle.ogg'
chain.append(f'[{len(segs)}:a]atrim=0:{total:.3f},afade=t=in:d=0.6,afade=t=out:st={total - 2.5:.3f}:d=2.5,'
             f'pan=stereo|c0=c0|c1=c0,volume=0.9[a]')
out = OUT / 'intro.mp4'
ff(*inputs, '-i', str(music), '-filter_complex', ';'.join(chain),
   '-map', prev, '-map', '[a]', '-c:v', 'libx264', '-crf', '21', '-preset', 'slow', '-pix_fmt', 'yuv420p',
   '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(out))
# 網頁用的封面
ff('-ss', '2', '-i', str(out), '-frames:v', '1', '-q:v', '3', str(OUT / 'intro-poster.jpg'))
print(f'{out}  {total:.1f} 秒')
