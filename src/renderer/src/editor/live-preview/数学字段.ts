import { RangeSet, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { 识别块级公式 } from '@shared/数学'
import { 检测数学块 } from './block'
import { 数学公式 } from './widgets'

/**
 * 块级数学公式的替换装饰。
 *
 * ## 为什么不能和其余装饰放在一起
 *
 * 其余装饰由一个 ViewPlugin 提供，但 **CodeMirror 禁止插件提供块级装饰**：
 *
 *   - 跨行的普通替换 → "Decorations that replace line breaks may not be
 *     specified via plugins"
 *   - 加上 `block: true`  → "Block decorations may not be specified via plugins"
 *
 * 两条都试过，都不行。块级装饰只能来自 **StateField**——它在状态层声明，
 * 生命周期与文档一致，CodeMirror 才能安全地把它当块处理（影响行的布局）。
 * 插件是视图层的，随时可能被销毁重建，让它左右行的结构不安全。
 *
 * 所以这里单独开一个字段，只负责 `$$…$$` 这一件事。
 * 其余装饰仍留在插件里——那里能拿到 `view.visibleRanges`，
 * 长文档可以只处理视口内的内容，这个优势不该为了这一处丢掉。
 *
 * ## 成本
 *
 * 扫 `$$` 是逐行 `startsWith` 判断，很便宜；真正贵的是那份**公式的渲染**，
 * 而它只在公式进入视口时才发生。
 */
function 构建公式(状态: EditorState): DecorationSet {
  const 区间: ReturnType<Decoration['range']>[] = []
  const 光标 = 状态.selection.main

  for (const 块 of 检测数学块(状态)) {
    // 光标落在块内时露出源码——正在改公式的人需要看到 `\frac`，
    // 而不是排版结果。
    //
    // 判断用"光标是否在这个块的区间内"而不是"是否在这一行"：
    // 块级公式常常跨好几行，按行判断会让只要光标在其中一行上、
    // 整个公式就变回源码，编辑体验很割裂。
    if (光标.from >= 块.from && 光标.to <= 块.to) continue

    const 公式 = 识别块级公式(状态.sliceDoc(块.from, 块.to))
    if (!公式) continue

    区间.push(
      Decoration.replace({
        widget: new 数学公式(公式, true),
        block: true,
        // 块级替换**必须落在行边界上**，否则 CodeMirror 会拒绝。
        // 检测数学块返回的 from/to 正是行首与行尾，这里天然满足。
      }).range(块.from, 块.to)
    )
  }

  // 空集合要显式返回 Decoration.none：RangeSet.of([]) 在某些版本上
  // 会产出一个非空但不含区间的集合，比较与复用都会多绕一圈。
  return 区间.length === 0 ? Decoration.none : RangeSet.of(区间, true)
}

export const 数学字段 = StateField.define<DecorationSet>({
  create: (状态) => 构建公式(状态),
  update: (旧值, 事务) => {
    // 文档变了要重扫；光标挪出/挪进公式也要重算（决定显示源码还是排版结果）。
    if (!事务.docChanged && !事务.selection) return 旧值
    return 构建公式(事务.state)
  },
  provide: (字段) => EditorView.decorations.from(字段)
})
