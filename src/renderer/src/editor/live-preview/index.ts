import { syntaxTree } from '@codemirror/language'
import { RangeSet, type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  type ViewUpdate
} from '@codemirror/view'
import { 扫描手工块, 处理块级 } from './block'
import { 处理行内 } from './inline'
import { 数学字段 } from './数学字段'
import { 建立图表字段 } from './图表字段'
import type { 构建上下文, 装饰条目, 语法节点 } from './types'

/**
 * 实时预览装饰层——对应渲染层里那套"brush / styler"。
 *
 * 三条不可动摇的规则：
 *
 * 1. **文档永远是纯 Markdown。** 装饰只影响视图，绝不改写文本。
 *    保存、diff、源码模式看到的都是用户敲下的原始字节。
 * 2. **光标所在块保持源码形态。** 隐藏是按"行"判定的，不是按节点。
 *    这样光标永远不会落进一个被折叠掉的标记里——这正是按行判定存在的理由。
 * 3. **出问题要降级，不能崩。** 装饰构建失败时退回空集合并打印错误，
 *    编辑器仍可正常输入，而不是整块白屏。
 */

// ---------------------------------------------------------------------------
// 活动行
// ---------------------------------------------------------------------------

/**
 * 光标（或选区）所触及的行号，1 基。
 *
 * 只读状态直接返回空集：只读时没有光标，全部按渲染态显示。
 */
function 计算活动行(状态: EditorState): Set<number> {
  const 行集合 = new Set<number>()
  if (状态.readOnly) return 行集合
  for (const 选区 of 状态.selection.ranges) {
    const 首行 = 状态.doc.lineAt(选区.from).number
    const 末行 = 状态.doc.lineAt(选区.to).number
    // 选区可能跨越成千上万行，设一个上限避免全量展开。
    const 跨度 = Math.min(末行 - 首行, 200)
    for (let n = 首行; n <= 首行 + 跨度; n++) 行集合.add(n)
  }
  return 行集合
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

function 构建装饰(view: EditorView): DecorationSet {
  const 状态 = view.state
  const 上下文: 构建上下文 = {
    活动行: 计算活动行(状态),
    行装饰已用: new Set<number>(),
    条目: [] as 装饰条目[]
  }

  // 第一遍：语法树里不存在的块（YAML 前置元数据、`$$` 数学块）。
  const 手工 = 扫描手工块(状态, 上下文)

  // 第二遍：按语法树分派。只遍历可视范围——CodeMirror 会虚拟化长文档，
  // 视口外的内容根本没有 DOM，为其构建装饰纯属浪费。
  const 树 = syntaxTree(状态)
  for (const 范围 of view.visibleRanges) {
    树.iterate({
      from: 范围.from,
      to: 范围.to,
      enter: (引用) => {
        const 节点 = 引用.node as unknown as 语法节点
        处理块级(节点, 状态, 上下文, 手工)
        处理行内(节点, 状态, 上下文)
        // 始终返回 true：需要继续下沉到子节点，否则标记折叠不会生效。
        return true
      }
    })
  }

  // 排序：先按起点，同起点按 rank（行装饰必须最先），最后按终点。
  上下文.条目.sort((甲, 乙) => 甲.from - 乙.from || 甲.rank - 乙.rank || 甲.to - 乙.to)

  // 去重：同一位置、同一 rank 的零宽装饰只保留一条，避免 widget 重复渲染。
  const 已见 = new Set<string>()
  const 区间: Range<Decoration>[] = []
  for (const 条目 of 上下文.条目) {
    if (条目.from === 条目.to) {
      const 键 = `${条目.from}:${条目.to}:${条目.rank}`
      if (已见.has(键)) continue
      已见.add(键)
    }
    区间.push(条目.deco.range(条目.from, 条目.to))
  }

  // 必须用 RangeSet.of 而不是 RangeSetBuilder。
  //
  // RangeSetBuilder 只接受**互不重叠**的区间，一旦遇到嵌套就抛
  // "Ranges must be added sorted by `from` position and `startSide`"。
  // 而嵌套是这里的常态：`**加粗里的 *斜体***` 就是 StrongEmphasis 套着
  // Emphasis，两者区间天然重叠。RangeSet.of(..., true) 会自行排序，
  // 既允许嵌套，也免去手工维护顺序。
  return RangeSet.of(区间, true)
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

class 实时预览 implements PluginValue {
  decorations: DecorationSet
  private 上次出错 = ''

  constructor(view: EditorView) {
    this.decorations = this.安全构建(view)
  }

  update(更新: ViewUpdate): void {
    if (更新.docChanged || 更新.selectionSet || 更新.viewportChanged) {
      this.decorations = this.安全构建(更新.view)
    }
  }

  private 安全构建(view: EditorView): DecorationSet {
    try {
      this.上次出错 = ''
      return 构建装饰(view)
    } catch (错误) {
      const 文本 = 错误 instanceof Error ? 错误.message : String(错误)
      // 同一条错误只打印一次，避免每次按键刷屏。
      if (文本 !== this.上次出错) {
        this.上次出错 = 文本
        console.error('[实时预览] 装饰构建失败，已降级为纯文本显示：', 错误)
      }
      return Decoration.none
    }
  }
}

const 实时预览插件 = ViewPlugin.fromClass(实时预览, {
  decorations: (实例) => 实例.decorations
})

/**
 * 实时预览扩展。
 *
 * @param 启用 为 false 时返回空扩展，编辑器退化为带语法高亮的纯 Markdown
 *             ——即 "源码模式"。
 * @param 是暗色 当前配色是否为深色，供 Mermaid 选择主题。
 */
export function livePreview(启用: boolean, 是暗色: () => boolean = () => false): Extension {
  if (!启用) return []
  // 块级替换（数学公式、Mermaid 图表）来自 StateField——插件不能提供块级装饰；
  // 其余装饰来自插件，因为那里能拿到 view.visibleRanges 做视口虚拟化。
  // 两类都通过 EditorView.decorations 汇入，CodeMirror 会把它们合并。
  return [实时预览插件, 数学字段, 建立图表字段({ 是暗色 })]
}
