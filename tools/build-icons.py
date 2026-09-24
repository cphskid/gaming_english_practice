"""把用到的 RPG 圖示挑出來，產生 public/icons/*.png。

原圖在 assets/rpg-icons/（7Soul1，496 張，CC0），檔名是 `I_GoldCoin` 這種
分類代號。畫面上要看的是「金幣」不是 I_GoldCoin，所以這支負責挑出用到的
那十幾張、改成看得懂的名字、順便把外面那一圈 1px 透明邊裁掉（裁掉之後
剛好 32×32，放大兩倍、四倍都對得整齊）。

城堡不在那包裡（整包沒有任何建築），改用 Tiny Swords 已經切好的那張縮小。

要多用一張圖示就在 PICK 加一行再重跑：

    python3 tools/build-icons.py
"""
from PIL import Image
import os

SRC = 'assets/rpg-icons'
OUTDIR = 'public/icons'

# 畫面上的名字 → 素材檔名。左邊這一欄是程式和 shop.ts 用的鍵。
PICK = {
    'coin':    'I_GoldCoin',    # 金幣（角色存款，跨遊戲）
    # 水晶（戰場貨幣，每場歸零）。**不用 I_Crystal01 那叢結晶**：
    # 它在 15px 的狀態列裡糊成一團（那是散開的細碎筆畫，縮小就整條消失）。
    # I_Sapphire 有整圈金邊、形狀是一整塊，縮到 15px 還看得出來是什麼。
    'crystal': 'I_Sapphire',
    'heart':   'S_Holy01',      # 城堡血量。整包只有這一顆心
    'frost':   'S_Ice02',       # 寒霜陷阱
    'repair':  'S_Holy03',      # 城牆修補
    'bow':     'W_Bow01',       # 箭塔
    'shield':  'E_Metal04',     # 軍營。同系列還有木盾 E_Wood03、金盾 E_Gold01
    'clock':   'I_Clock',       # 對戰倒數
    'eye':     'I_Eye',         # 認字線
    'quill':   'I_Feather01',   # 拼字線
    'medal1':  'Ac_Medal01',    # 排行榜第一
    'medal2':  'Ac_Medal02',
    'medal3':  'Ac_Medal03',
}


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    for key, name in PICK.items():
        im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
        # 外面一圈本來就是透明的，裁掉只是為了讓邊長變成 2 的次方。
        # 真的有畫到邊的話就整張留著，寧可多一圈也不要把圖切掉。
        inner = im.crop((1, 1, im.width - 1, im.height - 1))
        box = im.getbbox()
        if box and (box[0] < 1 or box[1] < 1 or box[2] > im.width - 1 or box[3] > im.height - 1):
            inner = im
        inner.save(os.path.join(OUTDIR, key + '.png'), optimize=True)

    # 城堡：那包沒有建築，用 Tiny Swords 切好的那張縮成圖示大小。
    castle = Image.open('public/td-art/castle.png').convert('RGBA')
    castle.thumbnail((64, 64), Image.LANCZOS)
    castle.save(os.path.join(OUTDIR, 'castle.png'), optimize=True)

    total = sum(os.path.getsize(os.path.join(OUTDIR, f)) for f in os.listdir(OUTDIR))
    print('寫出 %d 張圖示，共 %.1fKB' % (len(PICK) + 1, total / 1024))


if __name__ == '__main__':
    main()
