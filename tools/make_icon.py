# -*- coding: utf-8 -*-
"""Генерация иконок приложения CASHFLOW (тёмная тема КАВЕЛТ).
Запуск: py tools/make_icon.py  (создаёт icon.png 180px и icon-512.png)."""
from PIL import Image, ImageDraw, ImageFont

BG    = (20, 23, 28)     # графит
PANEL = (27, 31, 38)
ACC   = (232, 161, 58)   # сталь-оранж
GREEN = (63, 185, 100)
TEXT  = (231, 236, 242)

def rounded(size):
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(s * 0.22)
    d.rounded_rectangle([0, 0, s-1, s-1], radius=r, fill=BG)
    # рамка-акцент
    d.rounded_rectangle([int(s*0.06)]*2 + [s-int(s*0.06)]*2, radius=int(r*0.7),
                        outline=PANEL, width=max(2, s//90))

    # стрелка денежного потока (вверх) + символ рубля
    def font(px):
        for name in ("seguibl.ttf", "segoeuib.ttf", "arialbd.ttf", "arial.ttf"):
            try:
                return ImageFont.truetype(name, px)
            except OSError:
                continue
        return ImageFont.load_default()

    # большой ₽ по центру
    f = font(int(s*0.5))
    txt = "₽"
    bb = d.textbbox((0, 0), txt, font=f)
    w, h = bb[2]-bb[0], bb[3]-bb[1]
    d.text(((s-w)/2 - bb[0], (s-h)/2 - bb[1] - int(s*0.06)), txt, font=f, fill=ACC)

    # подпись CASHFLOW
    f2 = font(int(s*0.10))
    t2 = "CASHFLOW"
    bb2 = d.textbbox((0, 0), t2, font=f2)
    w2 = bb2[2]-bb2[0]
    d.text(((s-w2)/2 - bb2[0], int(s*0.74)), t2, font=f2, fill=TEXT)

    # стрелка вверх (поток) слева от ₽
    aw = int(s*0.5)
    return img

for size, name in [(180, "icon.png"), (512, "icon-512.png")]:
    rounded(size).save(name)
    print("written", name)
