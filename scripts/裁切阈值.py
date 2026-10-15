"""为图标裁切挑选合适的内容阈值。

要回答的问题是：源图里"真正的图案"边界在哪？
阈值定低了会把背景渐变也算成内容（裁不紧，图案显得小），
定高了会把图案的柔和边缘（阴影、抗锯齿）切掉。

输出每个阈值下的包围盒，以及换算成正方形图标后的**内容填充率**——
填充率就是"图案占图标面积的比例"，这才是"看起来大不大"的直接指标。
"""
import sys
from pathlib import Path

from PIL import Image

路径 = Path(sys.argv[1])
图 = Image.open(路径).convert("RGB")
宽, 高 = 图.size

# 背景基准与噪声水平：从四条边取样
边 = []
for x in range(宽):
    边.append(图.getpixel((x, 0)))
    边.append(图.getpixel((x, 高 - 1)))
for y in range(高):
    边.append(图.getpixel((0, y)))
    边.append(图.getpixel((宽 - 1, y)))
各通道 = list(zip(*边))
基准 = tuple(sorted(通)[len(通) // 2] for 通 in 各通道)
偏差 = sorted(max(abs(p[i] - 基准[i]) for i in range(3)) for p in 边)
print(f"源图 {宽} × {高}    背景基准 rgb{基准}")
print(f"边框偏差：中位 {偏差[len(偏差)//2]}  75分位 {偏差[int(len(偏差)*0.75)]}  "
      f"90分位 {偏差[int(len(偏差)*0.9)]}  最大 {偏差[-1]}")
print()

# 缩略图加速：逐像素扫原图在纯 Python 里太慢
缩宽, 缩高 = 256, 232
缩 = 图.resize((缩宽, 缩高), Image.LANCZOS)
比例x, 比例y = 宽 / 缩宽, 高 / 缩高


def 包围盒(阈值):
    左, 上, 右, 下 = 缩宽, 缩高, -1, -1
    for y in range(缩高):
        for x in range(缩宽):
            p = 缩.getpixel((x, y))
            if max(abs(p[i] - 基准[i]) for i in range(3)) > 阈值:
                左 = min(左, x); 右 = max(右, x)
                上 = min(上, y); 下 = max(下, y)
    if 右 < 0:
        return None
    return (int(左 * 比例x), int(上 * 比例y), int((右 + 1) * 比例x), int((下 + 1) * 比例y))


print(f"{'阈值':>5}  {'包围盒坐标':>26}  {'尺寸':>13}  {'四周留白（左/上/右/下）':>24}")
for 阈值 in (20, 30, 40, 50, 60, 80, 100, 120, 150):
    盒 = 包围盒(阈值)
    if not 盒:
        print(f"{阈值:>5}  （无内容）")
        continue
    w, h = 盒[2] - 盒[0], 盒[3] - 盒[1]
    左白 = 盒[0] / 宽
    上白 = 盒[1] / 高
    右白 = (宽 - 盒[2]) / 宽
    下白 = (高 - 盒[3]) / 高
    print(
        f"{阈值:>5}  ({盒[0]:>4},{盒[1]:>4})-({盒[2]:>4},{盒[3]:>4})  "
        f"{w:>6} × {h:<5}  "
        f"{左白:>7.1%} {上白:>5.1%} {右白:>5.1%} {下白:>5.1%}"
    )
