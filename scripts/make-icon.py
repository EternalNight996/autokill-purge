# 图标生成脚本（与 mengbot 的「水果角色」同构：圆角底板 + 拟物水果 + 萌表情）
# 重跑：python scripts/make-icon.py     （需要 Pillow）
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
OUT = 256
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(ROOT, exist_ok=True)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))


def vgrad_box(w, h, top, bottom):
    g = Image.new("RGBA", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return g.resize((w, h))


# 底板
pad = 28
plate = vgrad_box(S, S, (34, 26, 18, 255), (10, 12, 14, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius=190, fill=255)
img.paste(plate, (0, 0), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=190, outline=(66, 54, 40, 255), width=6)

# 榴莲主体
cx, cy = S // 2, int(S * 0.575)
rx, ry = int(S * 0.312), int(S * 0.292)
SPIKE_BASE = (236, 124, 22, 255)
SPIKE_TIP = (255, 208, 120, 255)
BODY_TOP = (255, 178, 74, 255)

n = 20
for i in range(n):
    a = 2 * math.pi * i / n + 0.08
    bx = cx + math.cos(a) * rx * 0.86
    by = cy + math.sin(a) * ry * 0.86
    tipx = cx + math.cos(a) * rx * 1.10
    tipy = cy + math.sin(a) * ry * 1.10
    w = rx * 0.20
    px, py = -math.sin(a) * w, math.cos(a) * w
    d.polygon([(bx + px, by + py), (bx - px, by - py), (tipx, tipy)], fill=SPIKE_BASE)
    d.line([(bx + px * 0.15, by + py * 0.15), (tipx, tipy)], fill=SPIKE_TIP, width=6)

body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(body)
bd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=BODY_TOP)
shade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shade).ellipse([cx - rx, cy - ry * 0.15, cx + rx, cy + ry], fill=(196, 74, 0, 150))
body.alpha_composite(shade.filter(ImageFilter.GaussianBlur(60)))
img.alpha_composite(body)
d = ImageDraw.Draw(img)
d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(240, 128, 22, 255), width=7)

hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(hi).ellipse([cx - rx * 0.60, cy - ry * 0.80, cx - rx * 0.02, cy - ry * 0.10], fill=(255, 246, 214, 95))
img.alpha_composite(hi.filter(ImageFilter.GaussianBlur(30)))
d = ImageDraw.Draw(img)

# 叶子
d.line([(cx, cy - ry + 16), (cx + 8, cy - ry - 52)], fill=(118, 178, 68, 255), width=14)
for sign in (-1, 1):
    d.ellipse([cx + sign * 62 - 66, cy - ry - 112, cx + sign * 62 + 40, cy - ry - 34], fill=(128, 198, 88, 255))
    d.arc([cx + sign * 62 - 62, cy - ry - 108, cx + sign * 62 + 36, cy - ry - 38], 205, 335, fill=(176, 228, 128, 255), width=7)

# 表情
eye_dx, eye_dy = int(rx * 0.40), int(ry * 0.10)
eye_r = int(rx * 0.185)
for sign in (-1, 1):
    ex = cx + sign * eye_dx
    d.ellipse([ex - eye_r, cy + eye_dy - eye_r * 1.3, ex + eye_r, cy + eye_dy + eye_r * 1.3], fill=(52, 30, 14, 255))
    d.ellipse([ex - eye_r * 0.45, cy + eye_dy - eye_r * 1.05, ex - eye_r * 0.03, cy + eye_dy - eye_r * 0.45], fill=(255, 255, 255, 240))
m = int(rx * 0.42)
d.arc([cx - m, cy + int(ry * 0.08), cx + m, cy + int(ry * 0.62)], 18, 162, fill=(72, 40, 16, 255), width=14)

blush = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bdd = ImageDraw.Draw(blush)
for sign in (-1, 1):
    bx = cx + sign * int(rx * 0.68)
    by = cy + int(ry * 0.33)
    bdd.ellipse([bx - 56, by - 32, bx + 56, by + 32], fill=(255, 110, 60, 105))
img.alpha_composite(blush.filter(ImageFilter.GaussianBlur(20)))

final = img.resize((OUT, OUT), Image.LANCZOS)
final.save(os.path.join(ROOT, "autokill-purge.png"))
final.save(os.path.join(ROOT, "autokill-purge.ico"),
           sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote", os.path.join(ROOT, "autokill-purge.ico"))
