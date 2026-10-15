import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { EditorState, Extension } from '@codemirror/state'
import type { 语法节点 } from './syntax-node'

/**
 * 专注模式与打字机模式。
 *
 * ## 专注模式
 *
 * 只让光标所在的那一块保持清晰，其余淡化。类名沿用通用命名：
 * `body.on-focus-mode` + 当前块上的 `.md-focus`（`.md-focus` 在内置主题里
 * 出现 37 次，是除 `#write` 之外最常被主题挂钩的选择器）。
 *
 * **通行的实现是 100ms 轮询**：
 *
 *     exitFocusModeTimer = setTimeout(enterFocusMode, 100)
 *
 * 进入专注模式后每 100 毫秒把自己重新跑一遍，靠反复重刷来跟上光标移动。
 * 这里不需要——CodeMirror 会把文档与选区的变化推给我们，直接在 update 里
 * 重算即可。轮询既费电又会在快速移动光标时慢半拍。
 *
 * ## 打字机模式
 *
 * 让光标所在行始终停在视口垂直中央。
 *
 * **通行的做法是动态注入内联样式**：算出
 * `(内容高度 - 单行高度) / 2`，把它塞进一个 `<style id="write-style">` 的
 * `#write { padding-top: …; padding-bottom: … }`。靠加内边距把首行"顶"到中间。
 *
 * 这里直接用 CodeMirror 的 `scrollIntoView(pos, { y: 'center' })`——
 * 语义就是"把这一行滚到垂直中央"，不必自己算高度，也不会在窗口尺寸变化时失准。
 */

/** 参与"专注"的块级节点。命中最内层的那个，而不是最外层的容器。 */
const 可专注块 = new Set([
  'Paragraph',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'FencedCode',
  'IndentedCode',
  'HorizontalRule',
  'HTMLBlock',
  // 表格整体专注：只高亮一个单元格反而看不出在编辑哪张表
  'Table',
  // 引用块整体专注：它通常只有一两行，拆开意义不大
  'Blockquote'
])

/** 当前光标所在的块。找不到时返回整行。 */
function 取当前块(状态: EditorState): { from: number; to: number } | null {
  const 位置 = 状态.selection.main.head
  const 行 = 状态.doc.lineAt(位置)

  let 节点: 语法节点 | null = syntaxTree(状态).resolveInner(位置, -1) as unknown as 语法节点
  while (节点) {
    if (可专注块.has(节点.name)) {
      // 空行、或在列表标记上时，节点可能是整个 Item 之外的东西；
      // 用节点区间，但如果它跨了多行而只有一行属于光标，就退回单行。
      return { from: 节点.from, to: 节点.to }
    }
    节点 = 节点.parent
  }

  return { from: 行.from, to: 行.to }
}

const 专注行 = Decoration.line({ class: 'md-focus' })

function 计算专注(状态: EditorState): DecorationSet {
  const 块 = 取当前块(状态)
  if (!块) return Decoration.none

  const 首行 = 状态.doc.lineAt(块.from).number
  const 末行 = 状态.doc.lineAt(块.to).number
  const 区间 = []
  for (let 号 = 首行; 号 <= 末行; 号++) {
    const 行 = 状态.doc.line(号)
    区间.push(专注行.range(行.from))
  }
  return Decoration.set(区间, true)
}

const 专注插件 = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(查看: EditorView) {
      this.decorations = 计算专注(查看.state)
    }
    update(更新: ViewUpdate): void {
      // 文档、选区、视口任一变化都要重算：视口变化时新进入视野的行
      // 也需要带上（或去掉）`md-focus`，否则滚动后高亮会停在旧位置。
      if (更新.docChanged || 更新.selectionSet || 更新.viewportChanged) {
        this.decorations = 计算专注(更新.state)
      }
    }
  },
  { decorations: (插件) => 插件.decorations }
)

/** 专注模式的编辑器扩展。是否启用由 body 类控制显示，所以扩展常驻即可。 */
export function 专注模式扩展(): Extension {
  return 专注插件
}

/** 把某一行滚到视口垂直中央。 */
export function 居中光标行(视图: EditorView): void {
  const 位置 = 视图.state.selection.main.head
  视图.dispatch({
    effects: EditorView.scrollIntoView(位置, { y: 'center', yMargin: 0 })
  })
}
