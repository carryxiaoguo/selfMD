"""把图片渲染成字符密度图，用于在看不到图的情况下判断构图。

原理：把图缩到很小的网格，每个格子用亮度映射成一个字符。
能看出"图案在中间、底部有没有一条文字带、四周留白多少"这类版面信息，
但看不出颜色与细节——它只用来做版面决策，不用来评价设计。
"""
import sys
from PIL import Image

路径 = sys.argv[1]
列数 = int(sys.argv[2]) if len(sys.argv) > 2 else 72
行数 = int(sys.argv[3]) if len(sys.argv) > 3 else 32

图 = Image.open(路径).convert("L").resize((列数, 行数), Image.LANCZOS)
宽, 高 = Image.open(路径).size

# 深到浅的字符梯度：深色用密字符
梯度 = "@%#*+=-:. "
最低, 最高 = 图.getextrema()

print(f"源图 {宽} × {高}    亮度范围 {最低} - {最高}")
print(f"字符图 {列数} × {行数}（每格约 {宽/列数:.0f} × {高/行数:.0f} 像素）")
print()
print("    " + "".join(str(i // 10 % 10) for i in range(列数)))
print("    " + "".join(str(i % 10) for i in range(列数)))

for y in range(行数):
    行 = ""
    for x in range(列数):
        亮 = 图.getpixel((x, y))
        # 归一化到梯度下标；亮度越低字符越密
        比 = (亮 - 最低) / max(1, 最高 - 最低)
        行 += 梯度[min(len(梯度) - 1, int(比 * (len(梯度) - 1)))]
    # 左侧标注该行对应的原图 y 坐标，方便定位
    print(f"{int(y * 高 / 行数):>4}{行}")

print()
print("图例：@ 最暗  空格 最亮    左侧数字为该行在原图中的 y 像素坐标")
