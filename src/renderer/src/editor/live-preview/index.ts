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
import { scanManualBlocks, handleBlock } from './block'
import { handleInline } from './inline'
import { mathFieldExt } from './math-field'
import { createDiagramField } from './diagram-field'
import type { BuildContext, DecoEntry, SyntaxNode } from './types'

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
function computeActiveLines(state: EditorState): Set<number> {
  const lineSetBox = new Set<number>()
  if (state.readOnly) return lineSetBox
  for (const selection of state.selection.ranges) {
    const firstLine = state.doc.lineAt(selection.from).number
    const lastLine = state.doc.lineAt(selection.to).number
    // 选区可能跨越成千上万行，设一个上限避免全量展开。
    const spanWidth = Math.min(lastLine - firstLine, 200)
    for (let n = firstLine; n <= firstLine + spanWidth; n++) lineSetBox.add(n)
  }
  return lineSetBox
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state
  const context: BuildContext = {
    activeLines: computeActiveLines(state),
    usedDecoLanes: new Set<number>(),
    headerReplaced: new Set<number>(),
    entry: [] as DecoEntry[]
  }

  // 第一遍：语法树里不存在的块（YAML 前置元数据、`$$` 数学块）。
  const manualScan = scanManualBlocks(state, context)

  // 第二遍：按语法树分派。只遍历可视范围——CodeMirror 会虚拟化长文档，
  // 视口外的内容根本没有 DOM，为其构建装饰纯属浪费。
  const tree = syntaxTree(state)
  for (const rangeBounds of view.visibleRanges) {
    tree.iterate({
      from: rangeBounds.from,
      to: rangeBounds.to,
      enter: (quote) => {
        const node = quote.node as unknown as SyntaxNode
        handleBlock(node, state, context, manualScan)
        handleInline(node, state, context)
        // 始终返回 true：需要继续下沉到子节点，否则标记折叠不会生效。
        return true
      }
    })
  }

  // 排序：先按起点，同起点按 rank（行装饰必须最先），最后按终点。
  context.entry.sort((alpha, beta) => alpha.from - beta.from || alpha.rank - beta.rank || alpha.to - beta.to)

  // 去重：同一位置、同一 rank 的零宽装饰只保留一条，避免 widget 重复渲染。
  const seenSet = new Set<string>()
  const range: Range<Decoration>[] = []
  for (const entry of context.entry) {
    if (entry.from === entry.to) {
      const key = `${entry.from}:${entry.to}:${entry.rank}`
      if (seenSet.has(key)) continue
      seenSet.add(key)
    }
    range.push(entry.deco.range(entry.from, entry.to))
  }

  // 必须用 RangeSet.of 而不是 RangeSetBuilder。
  //
  // RangeSetBuilder 只接受**互不重叠**的区间，一旦遇到嵌套就抛
  // "Ranges must be added sorted by `from` position and `startSide`"。
  // 而嵌套是这里的常态：`**加粗里的 *斜体***` 就是 StrongEmphasis 套着
  // Emphasis，两者区间天然重叠。RangeSet.of(..., true) 会自行排序，
  // 既允许嵌套，也免去手工维护顺序。
  return RangeSet.of(range, true)
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

class livePreviewExt implements PluginValue {
  decorations: DecorationSet
  private lastError = ''

  constructor(view: EditorView) {
    this.decorations = this.safeBuild(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = this.safeBuild(update.view)
    }
  }

  private safeBuild(view: EditorView): DecorationSet {
    try {
      this.lastError = ''
      return buildDecorations(view)
    } catch (error) {
      const docText = error instanceof Error ? error.message : String(error)
      // 同一条错误只打印一次，避免每次按键刷屏。
      if (docText !== this.lastError) {
        this.lastError = docText
        console.error('[实时预览] 装饰构建失败，已降级为纯文本显示：', error)
      }
      return Decoration.none
    }
  }
}

const livePreviewPlugin = ViewPlugin.fromClass(livePreviewExt, {
  decorations: (instance) => instance.decorations
})

/**
 * 实时预览扩展。
 *
 * @param 启用 为 false 时返回空扩展，编辑器退化为带语法高亮的纯 Markdown
 *             ——即 "源码模式"。
 * @param 是暗色 当前配色是否为深色，供 Mermaid 选择主题。
 */
export function livePreview(enable: boolean, isDarkFlag: () => boolean = () => false): Extension {
  if (!enable) return []
  // 块级替换（数学公式、Mermaid 图表）来自 StateField——插件不能提供块级装饰；
  // 其余装饰来自插件，因为那里能拿到 view.visibleRanges 做视口虚拟化。
  // 两类都通过 EditorView.decorations 汇入，CodeMirror 会把它们合并。
  return [livePreviewPlugin, mathFieldExt, createDiagramField({ isDarkFlag })]
}
