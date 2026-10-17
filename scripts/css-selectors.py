"""提取 CSS 里的选择器清单，用于摸清主题真正挂钩的 DOM 契约。

思路：主题作者写的是 `#write h1 { ... }`、`.md-fences { ... }` 这类规则。
把这些选择器统计出来，就知道一份主题"必须知道的类名与 id"有哪些，
也就知道了要复刻主题系统必须提供哪些 DOM 锚点。

用法：python scripts/css-selectors.py <文件或目录> [...]
"""
import re
import sys
from collections import Counter
from pathlib import Path

# 去掉注释，避免把注释里的示例选择器算进来
注释 = re.compile(r"/\*.*?\*/", re.S)
# 规则头：`选择器 {`；只取 { 之前的部分
规则头 = re.compile(r"([^{}]+)\{")
# 从选择器里抽出 #id 与 .class
标识 = re.compile(r"[#.]([A-Za-z_][-\w]*)")


def 收集(路径: Path) -> Counter:
    计数 = Counter()
    for 文件 in ([路径] if 路径.is_file() else sorted(路径.rglob("*.css"))):
        文本 = 注释.sub("", 文件.read_text(encoding="utf-8", errors="replace"))
        for 头 in 规则头.findall(文本):
            for 名 in 标识.findall(头):
                计数[名] += 1
    return 计数


def 主流程() -> int:
    总表 = Counter()
    各来源 = {}
    for 参数 in sys.argv[1:]:
        路径 = Path(参数)
        if not 路径.exists():
            print(f"跳过不存在的路径：{路径}")
            continue
        计数 = 收集(路径)
        各来源[路径.name] = 计数
        总表.update(计数)

    for 名, 计数 in 各来源.items():
        print(f"{名:<24} 出现 {len(计数)} 个不同的 id/class")

    print()
    print(f"合并后共 {len(总表)} 个不同的 id/class，按出现次数排序：")
    print()
    for 名, 次 in 总表.most_common(80):
        print(f"  {次:>4}  {名}")
    return 0


if __name__ == "__main__":
    sys.exit(主流程())
