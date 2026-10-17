"""从源 LOGO 生成应用图标集。

## 为什么需要"阈值"这个参数

源图是 2048×1860 的不透明 PNG：四周是浅米色背景（带渐变），中央是图案，
底部有一条深色横带。做图标要先把背景裁掉，而"哪里算图案"必须量化——
靠肉眼估会裁不紧，图案在图标里就显得小。

做法是：以边框像素的中位色为背景基准，逐像素算与基准的偏差，
偏差超过阈值的区域才算"内容"。阈值直接决定裁切紧致度：

    阈值  40   左留白 14.5%  上留白 15.9%    → 图案偏小（旧默认）
    阈值 100   左留白 21.5%  上留白 26.3%    → 图案明显更大（现默认）

**阈值调高不是"切掉内容"，而是"不再把淡到看不见的渐变当成内容"。**
阈值 40 会把背景本身的渐变算进来，于是裁出来的方框里塞满了近乎空白的区域。

源图的构图是**右下锚定**的：左侧与顶部有大片背景，右侧留白少，底部贴边。
所以单靠"居中裁方"无法解决，必须先把背景基准算准。

## 用法

    python scripts/generate-icon.py [阈值]

不传阈值时用默认值。想对比效果可以跑几次不同阈值，
生成结果会覆盖，但 `源图.png` 永远不会被改动。
"""
import sys
from pathlib import Path

from PIL import Image

项目根 = Path(__file__).resolve().parent.parent
源文件 = 项目根 / "resources" / "icon" / "源图.png"
输出目录 = 项目根 / "resources" / "icon"

# 只保留"实心图案"而不是"淡到看不见的渐变"，图案因此填满图标。
默认阈值 = 100

尺寸表 = [16, 24, 32, 48, 64, 128, 256, 512]
ICO尺寸 = [16, 24, 32, 48, 64, 128, 256]

# 缩略图边长：逐像素扫 2048×1860 在纯 Python 里太慢
缩宽, 缩高 = 256, 232


def 背景基准(图: Image.Image):
    """以四条边的中位色作为背景基准，返回 (基准色, 偏差中位数)。"""
    宽, 高 = 图.size
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
    return 基准, 偏差[len(偏差) // 2]


def 找包围盒(图: Image.Image, 基准, 阈值: int):
    宽, 高 = 图.size
    缩 = 图.resize((缩宽, 缩高), Image.LANCZOS)
    比例x, 比例y = 宽 / 缩宽, 高 / 缩高

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


def 主流程() -> int:
    if not 源文件.exists():
        print(f"找不到源文件：{源文件}")
        return 1

    阈值 = int(sys.argv[1]) if len(sys.argv) > 1 else 默认阈值

    输出目录.mkdir(parents=True, exist_ok=True)
    图 = Image.open(源文件).convert("RGB")
    宽, 高 = 图.size
    基准, 噪声 = 背景基准(图)

    print(f"源图：{源文件.name}  {宽} × {高}")
    print(f"背景基准 rgb{基准}   边框噪声中位 {噪声}   使用阈值 {阈值}")
    print()

    盒 = 找包围盒(图, 基准, 阈值)
    if not 盒:
        print("阈值过高，找不到任何内容。请调低阈值。")
        return 1

    # 顺便算一下旧默认（40）的尺寸，好告诉用户这次放大了多少
    旧盒 = 找包围盒(图, 基准, 40)

    w, h = 盒[2] - 盒[0], 盒[3] - 盒[1]
    print(f"图案包围盒：{盒}   尺寸 {w} × {h}")
    print(
        f"  四周留白  左 {(盒[0]/宽):.1%}  上 {(盒[1]/高):.1%}  "
        f"右 {((宽-盒[2])/宽):.1%}  下 {((高-盒[3])/高):.1%}"
    )

    图案 = 图.crop(盒)

    # 中心裁成正方形：取短边，避免任何补边带来的颜色接缝。
    # 源图背景本身有色差，补边容易补出痕迹。
    边 = min(图案.size)
    左 = (图案.width - 边) // 2
    上 = (图案.height - 边) // 2
    方形 = 图案.crop((左, 上, 左 + 边, 上 + 边))
    print(f"正方形图案：{方形.width} × {方形.height}")
    if 旧盒:
        旧边 = min(旧盒[2] - 旧盒[0], 旧盒[3] - 旧盒[1])
        print(f"  相比阈值 40 的裁切，图案放大 {(旧边 / 边 - 1):.1%}")
    print()

    母版 = 方形.resize((1024, 1024), Image.LANCZOS)
    母版.save(输出目录 / "logo-母版.png", optimize=True)
    print("  写出 logo-母版.png  1024×1024")

    for 尺 in 尺寸表:
        方形.resize((尺, 尺), Image.LANCZOS).save(输出目录 / f"icon-{尺}.png", optimize=True)
        print(f"  写出 icon-{尺}.png")

    方形.resize((256, 256), Image.LANCZOS).save(输出目录 / "icon.png", optimize=True)
    方形.resize((256, 256), Image.LANCZOS).save(
        输出目录 / "icon.ico", format="ICO", sizes=[(s, s) for s in ICO尺寸]
    )
    print(f"  写出 icon.ico  内嵌 {ICO尺寸}")

    print(f"\n全部输出到：{输出目录}")
    return 0


if __name__ == "__main__":
    sys.exit(主流程())
