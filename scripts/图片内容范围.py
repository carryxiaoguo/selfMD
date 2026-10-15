"""找出图片里"真正的图案"的包围盒。

用途：这张 LOGO 是 2048×1860 的不透明图，四角是近乎统一的浅米色。
要把它做成正方形图标，必须先知道图案占哪一块、周围留了多少背景，
否则要么把图案压扁，要么图标里图案小得看不清。

做法：以边框像素的中位色作为背景基准，逐像素算与基准的距离，
距离超过阈值的区域即为"内容"。
"""
import sys
from PIL import Image, ImageChops, ImageStat

路径 = sys.argv[-1]
图 = Image.open(路径).convert("RGB")
宽, 高 = 图.size

# --- 背景基准：取四条边的中位色 ---------------------------------------------
边像素 = []
for x in range(宽):
    边像素.append(图.getpixel((x, 0)))
    边像素.append(图.getpixel((x, 高 - 1)))
for y in range(高):
    边像素.append(图.getpixel((0, y)))
    边像素.append(图.getpixel((宽 - 1, y)))

各通道 = list(zip(*边像素))
基准 = tuple(sorted(通)[len(通) // 2] for 通 in 各通道)
print(f"背景基准色（四边中位）：rgb{基准}")

# 背景是否足够"平"：算边框像素与基准的平均偏差
偏差 = [max(abs(p[i] - 基准[i]) for i in range(3)) for p in 边像素]
偏差.sort()
print(f"边框偏差 中位={偏差[len(偏差)//2]}  90分位={偏差[int(len(偏差)*0.9)]}  最大={偏差[-1]}")
print()

# --- 内容包围盒：逐行逐列判断是否"偏离背景" ---------------------------------
def 是内容(像素, 阈值):
    return max(abs(像素[i] - 基准[i]) for i in range(3)) > 阈值

for 阈值 in (25, 40, 60):
    # 用缩略图加速：2048×1860 逐像素在 Python 里太慢
    小 = 图.resize((256, 232), Image.LANCZOS)
    左, 上, 右, 下 = 256, 232, -1, -1
    for y in range(232):
        for x in range(256):
            if 是内容(小.getpixel((x, y)), 阈值):
                左 = min(左, x); 右 = max(右, x)
                上 = min(上, y); 下 = max(下, y)
    if 右 < 0:
        print(f"阈值 {阈值}：没有找到内容")
        continue
    # 换算回原图坐标
    比例x, 比例y = 宽 / 256, 高 / 232
    x0, y0, x1, y1 = int(左 * 比例x), int(上 * 比例y), int((右 + 1) * 比例x), int((下 + 1) * 比例y)
    w, h = x1 - x0, y1 - y0
    print(
        f"阈值 {阈值}：图案包围盒 ({x0}, {y0}) - ({x1}, {y1})  "
        f"尺寸 {w} × {h}  "
        f"占画面 {w/宽:.1%} × {h/高:.1%}  "
        f"图案宽高比 {w/h:.3f}"
    )
