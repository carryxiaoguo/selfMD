"""采样图片各区域的平均色，用于确定"背景该用什么颜色填充"。"""
import sys
from PIL import Image

路径 = sys.argv[1]
图 = Image.open(路径).convert("RGB")
宽, 高 = 图.size


def 区域均值(x0, y0, x1, y1):
    """取区域内缩 10% 后的平均色，避开边缘抗锯齿。"""
    w, h = x1 - x0, y1 - y0
    x0, y0 = x0 + w // 10, y0 + h // 10
    x1, y1 = x1 - w // 10, y1 - h // 10
    块 = 图.crop((x0, y0, x1, y1)).resize((16, 16))
    像素 = list(块.getdata())
    r = sum(p[0] for p in 像素) // len(像素)
    g = sum(p[1] for p in 像素) // len(像素)
    b = sum(p[2] for p in 像素) // len(像素)
    return (r, g, b)


区域 = {
    "左上角": (0, 0, 280, 280),
    "右上角": (宽 - 280, 0, 宽, 280),
    "左下角": (0, 高 - 220, 280, 高),
    "右下角": (宽 - 280, 高 - 220, 宽, 高),
    "上边中段": (宽 // 2 - 200, 0, 宽 // 2 + 200, 200),
    "左边中段": (0, 高 // 2 - 200, 260, 高 // 2 + 200),
    "右边中段": (宽 - 260, 高 // 2 - 200, 宽, 高 // 2 + 200),
    "底部横带": (300, 1680, 宽 - 300, 高 - 20),
    "正中区域": (宽 // 2 - 300, 高 // 2 - 300, 宽 // 2 + 300, 高 // 2 + 300),
}

print(f"源图 {宽} × {高}")
print()
print(f"{'区域':<10} {'平均色':<20} 十六进制")
for 名, 坐标 in 区域.items():
    r, g, b = 区域均值(*坐标)
    print(f"{名:<10} rgb({r:>3},{g:>3},{b:>3})      #{r:02X}{g:02X}{b:02X}")

print()
# 四边最外一圈像素的众数色——填充背景时最该参考的就是它
from collections import Counter

最外圈 = []
for x in range(宽):
    最外圈.append(图.getpixel((x, 0)))
    最外圈.append(图.getpixel((x, 高 - 1)))
for y in range(高):
    最外圈.append(图.getpixel((0, y)))
    最外圈.append(图.getpixel((宽 - 1, y)))

众数 = Counter(最外圈).most_common(5)
print("最外一圈像素的众数色：")
for 色, 次 in 众数:
    print(f"  rgb{色}  #{色[0]:02X}{色[1]:02X}{色[2]:02X}   {次 / len(最外圈):.1%}")
