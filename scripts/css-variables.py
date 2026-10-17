"""提取 CSS 自定义属性（变量）的完整契约。

变量往往分散在多个样式表里：基础样式表只定义少数几个，主题文件里却会出现十几个。
所以必须把目录下所有 CSS 都扫一遍，才知道"主题作者到底能覆盖什么"。

同时扫描非标准的 at-rule 指令（例如 @include-when-export），
这些是编辑器自有的预处理语法，浏览器不认识。
"""
import re
import sys
from collections import OrderedDict
from pathlib import Path

注释 = re.compile(r"/\*.*?\*/", re.S)
# --变量名: 值;   值里允许分号之外的任意字符
变量 = re.compile(r"(--[-\w]+)\s*:\s*([^;}]+)")
# 专有 at-rule：@foo 后面跟的不是标准关键字
专有at = re.compile(r"@([-\w]+)")


def 主流程() -> int:
    变量表 = OrderedDict()   # 变量名 -> [(来源, 默认值)]
    指令表 = OrderedDict()

    for 参数 in sys.argv[1:]:
        路径 = Path(参数)
        文件们 = [路径] if 路径.is_file() else sorted(路径.rglob("*.css"))
        for 文件 in 文件们:
            文本 = 注释.sub("", 文件.read_text(encoding="utf-8", errors="replace"))
            for 名, 值 in 变量.findall(文本):
                变量表.setdefault(名, []).append((文件.name, 值.strip()[:48]))
            for 名 in 专有at.findall(文本):
                指令表.setdefault(名, set()).add(文件.name)

    标准at = {"media", "import", "font-face", "keyframes", "supports", "charset",
              "namespace", "page", "font-feature-values", "-webkit-keyframes"}

    print(f"=== CSS 自定义属性：共 {len(变量表)} 个 ===")
    print()
    for 名, 出现 in 变量表.items():
        来源 = "、".join(sorted({s for s, _ in 出现}))
        默认 = 出现[0][1]
        print(f"  {名:<32} 默认 {默认:<50} 出现于 {来源}")

    print()
    print("=== 非标准 at-rule（浏览器不认识） ===")
    for 名, 文件们 in 指令表.items():
        if 名 in 标准at:
            continue
        print(f"  @{名:<28} 出现于 {len(文件们)} 个文件：{'、'.join(sorted(文件们)[:4])}")
    return 0


if __name__ == "__main__":
    sys.exit(主流程())
