from PIL import Image, ImageDraw, ImageFilter
import math, os

S, OUT = 1024, 256
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'icon-variants')
print('root:', ROOT)
os.makedirs(ROOT, exist_ok=True)


def vgrad(w, h, top, bottom):
    g = Image.new("RGBA", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return g.resize((w, h))


def plate():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pad = 28
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([pad, pad, S - pad, S - pad], radius=190, fill=255)
    img.paste(vgrad(S, S, (34, 26, 18, 255), (10, 12, 14, 255)), (0, 0), m)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=190, outline=(66, 54, 40, 255), width=6)
    return img, d


def leaf(d, cx, top, color=(118, 178, 68, 255), hi=(176, 228, 128, 255)):
    d.line([(cx, top + 16), (cx + 8, top - 52)], fill=color, width=14)
    for sign in (-1, 1):
        d.ellipse([cx + sign * 62 - 66, top - 112, cx + sign * 62 + 40, top - 34], fill=color)
        d.arc([cx + sign * 62 - 62, top - 108, cx + sign * 62 + 36, top - 38], 205, 335, fill=hi, width=7)


def face(d, cx, cy, rx, ry, eye_r_ratio=0.185, mouth_ratio=0.42):
    eye_dx, eye_dy = int(rx * 0.40), int(ry * 0.10)
    eye_r = int(rx * eye_r_ratio)
    for sign in (-1, 1):
        ex = cx + sign * eye_dx
        d.ellipse([ex - eye_r, cy + eye_dy - eye_r * 1.3, ex + eye_r, cy + eye_dy + eye_r * 1.3], fill=(52, 30, 14, 255))
        d.ellipse([ex - eye_r * 0.45, cy + eye_dy - eye_r * 1.05, ex - eye_r * 0.03, cy + eye_dy - eye_r * 0.45], fill=(255, 255, 255, 240))
    m = int(rx * mouth_ratio)
    d.arc([cx - m, cy + int(ry * 0.08), cx + m, cy + int(ry * 0.62)], 18, 162, fill=(72, 40, 16, 255), width=14)


def blush(img, cx, cy, rx, ry, color=(255, 110, 60, 105)):
    b = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(b)
    for sign in (-1, 1):
        bx, by = cx + sign * int(rx * 0.68), cy + int(ry * 0.33)
        bd.ellipse([bx - 56, by - 32, bx + 56, by + 32], fill=color)
    img.alpha_composite(b.filter(ImageFilter.GaussianBlur(20)))


def save(img, name):
    final = img.resize((OUT, OUT), Image.LANCZOS)
    final.save(os.path.join(ROOT, name + ".png"))
    final.save(os.path.join(ROOT, name + ".ico"),
               sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return final


# ── A 核桃：锯齿裂缝 + 露白果仁 ─────────────────────────────────
def walnut():
    img, d = plate()
    cx, cy = S // 2, int(S * 0.575)
    rx, ry = int(S * 0.305), int(S * 0.285)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(206, 160, 102, 255))
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(156, 110, 60, 255), width=8)
    for k in range(3):
        rr = 0.9 - k * 0.17
        d.arc([cx - rx * rr, cy - ry * rr, cx + rx * rr, cy + ry * rr], 195, 345, fill=(172, 122, 68, 170), width=5)
    # 锯齿裂缝：从顶到底的折线，两侧露浅色果仁
    pts = []
    for i in range(9):
        t = i / 8
        y = cy - ry * 0.94 + t * ry * 1.88
        x = cx + (18 if i % 2 == 0 else -14)
        pts.append((x, y))
    d.line(pts, fill=(104, 68, 34, 255), width=20, joint="curve")
    inner = [(x * 0.86 + cx * 0.14, y) for (x, y) in pts]
    d.line(inner, fill=(255, 244, 214, 240), width=8, joint="curve")
    hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hi).ellipse([cx - rx * 0.62, cy - ry * 0.8, cx - rx * 0.04, cy - ry * 0.08], fill=(255, 250, 226, 85))
    img.alpha_composite(hi.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(img)
    face(d, cx, cy, rx, ry)
    blush(img, cx, cy, rx, ry, (214, 120, 70, 100))
    return save(img, "A-walnut")


# ── B 石榴：顶部三角缺口 + 圆润红籽 ─────────────────────────────
def pomegranate():
    img, d = plate()
    cx, cy = S // 2, int(S * 0.585)
    rx, ry = int(S * 0.30), int(S * 0.28)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(200, 46, 56, 255))
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(158, 30, 42, 255), width=8)
    # 顶部花萼（小皇冠，短）
    for i in range(5):
        a = -math.pi / 2 + (i - 2) * 0.34
        tx, ty = cx + math.cos(a) * rx * 0.40, cy + math.sin(a) * ry * 0.40
        d.polygon([(tx - 24, ty + 8), (tx + 24, ty + 8), (tx, ty - 62)], fill=(150, 28, 38, 255))
    # 缺口（右上，三角），里面是籽
    notch = [(cx + rx * 0.06, cy - ry * 0.86), (cx + rx * 0.74, cy - ry * 0.34), (cx + rx * 0.30, cy + ry * 0.10)]
    d.polygon(notch, fill=(120, 18, 26, 255))
    inner = [(cx + rx * 0.14, cy - ry * 0.78), (cx + rx * 0.66, cy - ry * 0.32), (cx + rx * 0.30, cy + ry * 0.02)]
    d.polygon(inner, fill=(255, 214, 208, 255))
    for (sx, sy, r) in [(0.30, -0.50, 30), (0.46, -0.32, 28), (0.26, -0.20, 26), (0.42, -0.10, 24)]:
        ex, ey = cx + rx * sx, cy + ry * sy
        d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=(220, 24, 62, 255))
        d.ellipse([ex - r * 0.42, ey - r * 0.55, ex - r * 0.05, ey - r * 0.15], fill=(255, 196, 206, 235))
    face(d, cx, cy + int(ry * 0.14), rx, ry)
    blush(img, cx, cy + int(ry * 0.14), rx, ry, (255, 84, 112, 95))
    return save(img, "B-pomegranate")


# ── C 血橙：切面 + 果瓣（脸在切面之上） ─────────────────────────
def bloodorange():
    img, d = plate()
    cx, cy = S // 2, int(S * 0.59)
    rx, ry = int(S * 0.305), int(S * 0.285)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(255, 132, 30, 255))
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(226, 96, 12, 255), width=8)
    ir = 0.84
    d.ellipse([cx - rx * ir, cy - ry * ir, cx + rx * ir, cy + ry * ir], fill=(255, 208, 146, 255))
    d.ellipse([cx - rx * 0.72, cy - ry * 0.72, cx + rx * 0.72, cy + ry * 0.72], fill=(255, 156, 60, 255))
    for i in range(8):
        a = 2 * math.pi * i / 8 + 0.39
        d.line([(cx, cy), (cx + math.cos(a) * rx * 0.70, cy + math.sin(a) * ry * 0.70)], fill=(255, 222, 176, 255), width=6)
    leaf(d, cx, cy - ry - 4, (108, 172, 64, 255), (168, 220, 120, 255))
    face(d, cx, cy, rx * 0.9, ry * 0.9, 0.20)
    blush(img, cx, cy, rx * 0.9, ry * 0.9, (255, 96, 40, 90))
    return save(img, "C-bloodorange")


# ── D 火龙果：短宽绿鳞（贴皮外翻） ─────────────────────────────
def dragonfruit():
    img, d = plate()
    cx, cy = S // 2, int(S * 0.585)
    rx, ry = int(S * 0.30), int(S * 0.285)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(232, 62, 126, 255))
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(188, 34, 96, 255), width=8)
    for i in range(9):
        a = 2 * math.pi * i / 9 + 0.18
        bx = cx + math.cos(a) * rx * 0.88
        by = cy + math.sin(a) * ry * 0.88
        tipx = cx + math.cos(a) * rx * 1.12
        tipy = cy + math.sin(a) * ry * 1.12
        w = rx * 0.22
        px, py = -math.sin(a) * w, math.cos(a) * w
        d.polygon([(bx + px, by + py), (bx - px, by - py), (tipx, tipy)], fill=(112, 192, 96, 255))
        d.line([(bx, by), (tipx, tipy)], fill=(176, 230, 148, 255), width=6)
    hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hi).ellipse([cx - rx * 0.62, cy - ry * 0.78, cx - rx * 0.02, cy - ry * 0.12], fill=(255, 226, 240, 95))
    img.alpha_composite(hi.filter(ImageFilter.GaussianBlur(28)))
    d = ImageDraw.Draw(img)
    face(d, cx, cy, rx, ry)
    blush(img, cx, cy, rx, ry, (255, 130, 180, 110))
    return save(img, "D-dragonfruit")


imgs = [walnut(), pomegranate(), bloodorange(), dragonfruit()]
sheet = Image.new("RGBA", (760, 800), (16, 18, 22, 255))
for i, im in enumerate(imgs):
    sheet.alpha_composite(im, (20 + (i % 2) * 370, 20 + (i // 2) * 380))
sheet.save(os.path.join(ROOT, "compare.png"))
print("ok")

