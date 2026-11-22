"""生成桌面应用的图标：琥珀渐变圆角方块 + 「题」字。

输出 launcher/app.ico（多尺寸，Windows 快捷方式和任务栏都用它）。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / 'app.ico'
SIZE = 256

# 和 app/src/styles/tokens.css 的 --accent / --accent-deep 对齐
TOP = (0xF5, 0xA5, 0x24)
BOTTOM = (0xC9, 0x82, 0x0F)
INK = (0x20, 0x16, 0x07)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
    r'C:\Windows\Fonts\seguisb.ttf',
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def build() -> Image.Image:
    image = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # 竖向渐变
    for y in range(SIZE):
        t = y / (SIZE - 1)
        color = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (SIZE, y)], fill=(*color, 255))

    # 圆角遮罩
    mask = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=58, fill=255)
    image.putalpha(mask)

    # 顶部高光，做出一点立体感
    gloss = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).rounded_rectangle(
        [10, 8, SIZE - 10, SIZE // 2], radius=44, fill=(255, 255, 255, 26)
    )
    image = Image.alpha_composite(image, gloss)

    # 字形
    font = load_font(150)
    draw = ImageDraw.Draw(image)
    draw.text((SIZE / 2, SIZE / 2 + 4), '题', font=font, fill=(*INK, 255), anchor='mm')

    return image


def main() -> None:
    image = build()
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    image.save(OUT, format='ICO', sizes=sizes)
    print(f'icon written: {OUT} ({OUT.stat().st_size} bytes)')

    # 顺手留一张 png，方便以后做安装包/宣传图
    image.save(HERE / 'app.png')

    # 网页应用图标（manifest 用）：192 / 512，外加一张带安全边距的 maskable
    public = HERE.parent / 'app' / 'public'
    public.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        image.resize((size, size), Image.LANCZOS).save(public / f'icon-{size}.png')
    maskable = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    inner = image.resize((410, 410), Image.LANCZOS)
    maskable.paste(inner, (51, 51), inner)
    maskable.save(public / 'icon-maskable-512.png')
    print('web icons written: icon-192.png / icon-512.png / icon-maskable-512.png')


if __name__ == '__main__':
    main()
