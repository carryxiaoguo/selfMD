import { syntaxTree } from '@codemirror/language'
import { RangeSet, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { diagramWidget } from './widgets'

/**
 * Mermaid 图表的块级替换装饰。
 *
 * 与数学公式同一个道理：` ```mermaid ` 围栏通常跨多行，替换它属于**块级装饰**，
 * 而 CodeMirror 明确禁止插件提供块级装饰（"Block decorations may not be
 * specified via plugins"）。所以只能由 StateField 提供。
 *
 * 好消息是：围栏在语法树里是标准的 `FencedCode` 节点，不必像 `$$` 那样手工扫行——
 * 直接遍历语法树找 `CodeInfo` 为 `mermaid` 的节点即可，准确得多
 * （缩进的围栏、用了波浪线 `~~~` 的围栏都能正确识别）。
 */

/** 支持的图表语言标识。常见解析器认 `mermaid`，也认 `sequence` 与 `flow`。 */
const DIAGRAM_LANGS = new Set(['mermaid', 'sequence', 'flow', 'flowchart', 'gantt', 'class'])

/** 取围栏的语言标识。 */
function takeFenceLang(state: EditorState, node: { firstChild: unknown }): string {
  let child = node.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null
  while (child) {
    if (child.name === 'CodeInfo') {
      return state.sliceDoc(child.from, child.to).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    }
    child = child.nextSibling as typeof child
  }
  return ''
}

/** 取围栏里的代码正文（排除围栏标记本身）。 */
function takeFenceBody(state: EditorState, node: { firstChild: unknown; from: number; to: number }): string {
  const segment: string[] = []
  let child = node.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null
  while (child) {
    if (child.name === 'CodeText') segment.push(state.sliceDoc(child.from, child.to))
    child = child.nextSibling as typeof child
  }
  if (segment.length > 0) return segment.join('\n')

  // 兜底：没有 CodeText 子节点时，去掉首尾两行围栏
  const lines = state.sliceDoc(node.from, node.to).split('\n')
  return stripFenceLines(lines).join('\n')
}

/** 去掉首尾两行围栏标记。行数不足时返回空数组。 */
function stripFenceLines(lines: string[]): string[] {
  return lines.length > 2 ? lines.slice(1, -1) : []
}

export interface DiagramFieldOptions {
  /** 当前是否深色模式；决定 Mermaid 用哪套配色。 */
  isDarkFlag: () => boolean
}

/**
 * 建立图表字段。
 *
 * 用工厂函数而不是模块级常量：暗色与否随设置变化，字段需要能读到最新值。
 * 直接把布尔值捕进来会在切换主题后失效——图表仍用旧配色。
 */
export function createDiagramField(options: DiagramFieldOptions): Extension {
  function build(state: EditorState): DecorationSet {
    const range: ReturnType<Decoration['range']>[] = []
    const cursor = state.selection.main
    const darkMode = options.isDarkFlag()

    walkTree(state, (node) => {
      if (node.name !== 'FencedCode') return
      // 光标落在围栏内时露出源码——正在写图表的人需要看到 DSL，
      // 而不是一张渲染失败的图。
      if (cursor.from >= node.from && cursor.to <= node.to) return

      const language = takeFenceLang(state, node)
      if (!DIAGRAM_LANGS.has(language)) return
      const sourceCode = takeFenceBody(state, node).trim()
      if (sourceCode.length === 0) return

      range.push(
        Decoration.replace({
          widget: new diagramWidget(sourceCode, darkMode),
          block: true
        }).range(node.from, node.to)
      )
    })

    return range.length === 0 ? Decoration.none : RangeSet.of(range, true)
  }

  return StateField.define<DecorationSet>({
    create: (state) => build(state),
    update: (prevValue, txn) => {
      if (!txn.docChanged && !txn.selection) return prevValue
      return build(txn.state)
    },
    provide: (fieldName) => EditorView.decorations.from(fieldName)
  })
}

/** 遍历语法树找围栏。抽出来只是为了让上面的逻辑读起来清楚些。 */
function walkTree(
  state: EditorState,
  callback: (node: { name: string; from: number; to: number; firstChild: unknown }) => void
): void {
  syntaxTree(state).iterate({
    enter: (quote) => {
      callback(quote.node as unknown as {
        name: string
        from: number
        to: number
        firstChild: unknown
      })
      return true
    }
  })
}
