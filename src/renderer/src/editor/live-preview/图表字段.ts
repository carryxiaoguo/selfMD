import { syntaxTree } from '@codemirror/language'
import { RangeSet, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { 图表 } from './widgets'

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
const 图表语言 = new Set(['mermaid', 'sequence', 'flow', 'flowchart', 'gantt', 'class'])

/** 取围栏的语言标识。 */
function 取围栏语言(状态: EditorState, 节点: { firstChild: unknown }): string {
  let 子 = 节点.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null
  while (子) {
    if (子.name === 'CodeInfo') {
      return 状态.sliceDoc(子.from, 子.to).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    }
    子 = 子.nextSibling as typeof 子
  }
  return ''
}

/** 取围栏里的代码正文（排除围栏标记本身）。 */
function 取围栏正文(状态: EditorState, 节点: { firstChild: unknown; from: number; to: number }): string {
  const 段: string[] = []
  let 子 = 节点.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null
  while (子) {
    if (子.name === 'CodeText') 段.push(状态.sliceDoc(子.from, 子.to))
    子 = 子.nextSibling as typeof 子
  }
  if (段.length > 0) return 段.join('\n')

  // 兜底：没有 CodeText 子节点时，去掉首尾两行围栏
  const 行们 = 状态.sliceDoc(节点.from, 节点.to).split('\n')
  return 去掉围栏行(行们).join('\n')
}

/** 去掉首尾两行围栏标记。行数不足时返回空数组。 */
function 去掉围栏行(行们: string[]): string[] {
  return 行们.length > 2 ? 行们.slice(1, -1) : []
}

export interface 图表字段选项 {
  /** 当前是否深色模式；决定 Mermaid 用哪套配色。 */
  是暗色: () => boolean
}

/**
 * 建立图表字段。
 *
 * 用工厂函数而不是模块级常量：暗色与否随设置变化，字段需要能读到最新值。
 * 直接把布尔值捕进来会在切换主题后失效——图表仍用旧配色。
 */
export function 建立图表字段(选项: 图表字段选项): Extension {
  function 构建(状态: EditorState): DecorationSet {
    const 区间: ReturnType<Decoration['range']>[] = []
    const 光标 = 状态.selection.main
    const 暗色 = 选项.是暗色()

    树遍历(状态, (节点) => {
      if (节点.name !== 'FencedCode') return
      // 光标落在围栏内时露出源码——正在写图表的人需要看到 DSL，
      // 而不是一张渲染失败的图。
      if (光标.from >= 节点.from && 光标.to <= 节点.to) return

      const 语言 = 取围栏语言(状态, 节点)
      if (!图表语言.has(语言)) return
      const 源码 = 取围栏正文(状态, 节点).trim()
      if (源码.length === 0) return

      区间.push(
        Decoration.replace({
          widget: new 图表(源码, 暗色),
          block: true
        }).range(节点.from, 节点.to)
      )
    })

    return 区间.length === 0 ? Decoration.none : RangeSet.of(区间, true)
  }

  return StateField.define<DecorationSet>({
    create: (状态) => 构建(状态),
    update: (旧值, 事务) => {
      if (!事务.docChanged && !事务.selection) return 旧值
      return 构建(事务.state)
    },
    provide: (字段) => EditorView.decorations.from(字段)
  })
}

/** 遍历语法树找围栏。抽出来只是为了让上面的逻辑读起来清楚些。 */
function 树遍历(
  状态: EditorState,
  回调: (节点: { name: string; from: number; to: number; firstChild: unknown }) => void
): void {
  syntaxTree(状态).iterate({
    enter: (引用) => {
      回调(引用.node as unknown as {
        name: string
        from: number
        to: number
        firstChild: unknown
      })
      return true
    }
  })
}
