"""测量图标的"内容占比"，并渲染字符预览。

用途：判断"图标里图案看起来小"到底是哪种原因——
  a) 裁切后仍留了大片背景（虚线外还有空白）
  b) 图案本身在画面里就小（画心内容稀疏）
  c) 图案贴边但视觉重心偏移

只靠肉眼看是分不清的，必须量出"偏离背景的像素占多少比例"。
"""
import sys
from pathlib import Path

from PIL import Image

路径 = Path(sys.argv[1])
列数 = int(sys.argv[2]) if len(sys.argv) > 2 else 64
行数 = int(sys.argv[3]) if len(sys.argv) > 3 else 32

图 = Image.open(路径).convert("RGB")
宽, 高 = 图.size

# 背景基准：取四条边的中位色
边 = []
for x in range(宽):
    边.append(图.getpixel((x, 0)))
    边.append(图.getpixel((x, 高 - 1)))
for y in range(高):
    边.append(图.getpixel((0, y)))
    边.append(图.getpixel((宽 - 1, y)))
各通道 = list(zip(*边))
基准 = tuple(sorted(通)[len(通) // 2] for 通 in 各通道)

print(f"文件：{路径.name}   尺寸 {宽} × {高}")
print(f"背景基准色：rgb{基准}  #{基准[0]:02X}{基准[1]:02X}{基准[2]:02X}")

# --- 内容占比：逐像素算与背景的偏差 -----------------------------------------
小 = 图.resize((200, 200), Image.LANCZOS)
print()
print("阈值   偏离背景的像素占比   内容包围盒（相对 200×200 的百分比）")
for 阈值 in (20, 40, 60, 90, 120):
    命中 = 0
    左, 上, 右, 下 = 200, 200, -1, -1
    for y in range(200):
        for x in range(200):
            p = 小.getpixel((x, y))
            if max(abs(p[i] - 基准[i]) for i in range(3)) > 阈值:
                命中 += 1
                左 = min(左, x); 右 = max(右, x)
                上 = min(上, y); 下 = max(下, y)
    占比 = 命中 / (200 * 200)
    if 右 < 0:
        print(f"{阈值:>4}   {占比:>6.1%}               （无内容）")
        continue
    print(
        f"{阈值:>4}   {占比:>6.1%}               "
        f"x {左/2:.0f}%–{(右+1)/2:.0f}%   y {上/2:.0f}%–{(下+1)/2:.0f}%"
    )

# --- 字符预览 ---------------------------------------------------------------
亮度 = 图.convert("L").resize((列数, 行数), Image.LANCZOS)
最低, 最高 = 亮度.getextrema()
梯度 = "@%#*+=-:. "
print()
print(f"字符预览 {列数}×{行数}（@ 最暗，空格 最亮）")
for y in range(行数):
    行 = ""
    for x in range(列数):
        比 = (亮度.getpixel((x, y)) - 最低) / max(1, 最高 - 最低)
        行 += 梯度[min(len(梯度) - 1, int(比 * (len(梯度) - 1)))]
    print(f"  {行}")
