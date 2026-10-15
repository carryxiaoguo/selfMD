"""读取图片元数据，供决定"能不能当图标用"。

只回答几个决策相关的问题：尺寸是否正方、有没有透明通道、
四角是不是同一个纯色（能否安全地抠掉背景）。
"""
import sys
from collections import Counter
from PIL import Image

路径 = sys.argv[-1]
图 = Image.open(路径)
rgba = 图.convert("RGBA")
宽, 高 = rgba.size

print(f"格式：{图.format}    模式：{图.mode}    尺寸：{宽} × {高}")
print(f"宽高比：{宽 / 高:.3f}    {'正方形' if 宽 == 高 else '非正方形'}")
print()

# --- 透明通道 ---------------------------------------------------------------
alpha = list(rgba.getchannel("A").getdata())
不透明数 = sum(1 for a in alpha if a == 255)
全透明数 = sum(1 for a in alpha if a == 0)
print(f"Alpha：不透明 {不透明数 / len(alpha):.1%}   全透明 {全透明数 / len(alpha):.1%}")
print(f"结论：{'无透明通道（图标会是不透明方块）' if 全透明数 == 0 else '含透明区域'}")
print()

# --- 四角取样，判断是否有纯色背景 -------------------------------------------
角 = {
    "左上": rgba.getpixel((0, 0)),
    "右上": rgba.getpixel((宽 - 1, 0)),
    "左下": rgba.getpixel((0, 高 - 1)),
    "右下": rgba.getpixel((宽 - 1, 高 - 1)),
}
print("四角像素：")
for 名, 值 in 角.items():
    print(f"  {名}：{值}")
同色 = len(set(角.values())) == 1
print(f"结论：{'四角同色，可能是纯色背景' if 同色 else '四角不同色，没有统一背景'}")
print()

# --- 边缘是否统一 -----------------------------------------------------------
边 = []
for x in range(0, 宽, max(1, 宽 // 64)):
    边.append(rgba.getpixel((x, 0)))
    边.append(rgba.getpixel((x, 高 - 1)))
for y in range(0, 高, max(1, 高 // 64)):
    边.append(rgba.getpixel((0, y)))
    边.append(rgba.getpixel((宽 - 1, y)))
边计数 = Counter(边).most_common(3)
print(f"边缘取样最频繁的三种颜色（共 {len(边)} 个采样点）：")
for 色, 次 in 边计数:
    print(f"  {色}   {次 / len(边):.1%}")
print()

# --- 颜色丰富度：判断是"平面标志"还是"照片" ---------------------------------
小图 = rgba.resize((64, 64))
颜色数 = len(set(小图.getdata()))
print(f"缩到 64×64 后的不同颜色数：{颜色数}")
print(f"结论：{'平面设计（颜色少，适合做图标）' if 颜色数 < 512 else '颜色丰富，可能是照片或渐变较重的图'}")
print()

# --- 缩到 16×16 看是否还认得出 ----------------------------------------------
极小 = rgba.resize((16, 16), Image.LANCZOS)
小颜色数 = len(set(极小.getdata()))
print(f"缩到 16×16 后的不同颜色数：{小颜色数}")
print(f"结论：{'小尺寸下仍有结构' if 小颜色数 >= 24 else '小尺寸下细节基本丢失'}")
