import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * 选区与跳转命令。
 *
 * 这一组是"写作手感"里最容易被低估的部分：写长文时，选中一句、选中一段、
 * 跳到行首行尾的频率远高于加粗斜体。通行做法把它们放在编辑菜单里，
 * 本模块负责让那些菜单项真正生效。
 *
 * 区间计算全部做成**吃字符串、吐偏移**的纯函数，再用一层薄封装映射到文档位置。
 * 这样"句子边界怎么算"这种最容易出错的地方可以被逐条断言，而不必靠手敲文档试。
 */

// ---------------------------------------------------------------------------
// 句子
// ---------------------------------------------------------------------------

/** 中日韩句末标点，以及英文分号——出现即断句。 */
const 硬终止符 = /[。！？；]/

/** 英文句点只有在"后面是空白或行尾"时才算断句，"3.14" 里的不算。 */
function 是英文句点(lineText: string, position: number): boolean {
  if (lineText[position] !== '.') return false
  const 后 = lineText[position + 1]
  return 后 === undefined || /\s/.test(后)
}

function 是终止符(lineText: string, position: number): boolean {
  return 硬终止符.test(lineText[position]) || 是英文句点(lineText, position)
}

/**
 * 找出包含 `偏移` 的那句话，返回行内区间。
 *
 * 边界取"上一个终止符之后"到"下一个终止符（含）"；找不到终止符时
 * 整行就是一句——这符合直觉：没有句号的一行本来就是一整句。
 */
export function 句子区间(lineText: string, offset: number): { start: number; end: number } {
  let start = 0
  for (let i = Math.min(offset, lineText.length) - 1; i >= 0; i--) {
    if (是终止符(lineText, i)) {
      start = i + 1
      break
    }
  }

  let end = lineText.length
  for (let i = Math.max(0, Math.min(offset, lineText.length)); i < lineText.length; i++) {
    if (是终止符(lineText, i)) {
      end = i + 1
      break
    }
  }

  // 去掉两端空白：选中" 你好 "时用户想要的是"你好"。
  while (start < end && /\s/.test(lineText[start])) start += 1
  while (end > start && /\s/.test(lineText[end - 1])) end -= 1
  return { start, end }
}

// ---------------------------------------------------------------------------
// 词
// ---------------------------------------------------------------------------

const 中日韩 = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const 拉丁词字符 = /[A-Za-z0-9_\u00c0-\u024f]/

/**
 * 找出包含 `偏移` 的那个词，返回行内区间；光标两侧都不是词时返回 null。
 *
 * 中日韩文字按**单字成词**处理。没有分词器的情况下这是唯一诚实的选择：
 * 按标点切会把"选中当前词"变成"选中整句"，反而更糟。
 */
export function 词区间(lineText: string, offset: number): { start: number; end: number } | null {
  const 光标处 = lineText[offset]
  const 光标前 = offset > 0 ? lineText[offset - 1] : undefined

  // 中日韩：单字
  if (光标处 !== undefined && 中日韩.test(光标处)) return { start: offset, end: offset + 1 }
  if (光标前 !== undefined && 中日韩.test(光标前)) return { start: offset - 1, end: offset }

  // 拉丁词：向两侧扩展到非词字符
  const 起点 = 光标处 !== undefined && 拉丁词字符.test(光标处) ? offset : offset - 1
  if (起点 < 0 || 起点 >= lineText.length || !拉丁词字符.test(lineText[起点])) return null

  let start = 起点
  let end = 起点 + 1
  while (start > 0 && 拉丁词字符.test(lineText[start - 1])) start -= 1
  while (end < lineText.length && 拉丁词字符.test(lineText[end])) end += 1
  return { start, end }
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/** 把行内区间映射为文档选区。 */
function 行内选区(state: EditorState, position: number, range: { start: number; end: number }): EditorSelection {
  const line = state.doc.lineAt(position)
  // EditorSelection.range() 返回的是单个 SelectionRange，不是 EditorSelection；
  // 单区间要用 single()。
  return EditorSelection.single(line.from + range.start, line.from + range.end)
}

/**
 * 选中当前行或句。
 *
 * 与通行取舍一致：**优先按句选**。光标停在一句中间时选中整句；
 * 该行只有一句（或没有终止符）时，效果就等于选中整行。
 */
export function 选中当前行或句(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  const line = state.doc.lineAt(main.head)
  const range = 句子区间(line.text, main.head - line.from)

  // 整行已经选中时再按一次，扩展为整行（含首尾空白），给用户一个"退路"。
  const 当前已满 = main.from === line.from + range.start && main.to === line.from + range.end
  const target = 当前已满
    ? EditorSelection.single(line.from, line.to)
    : 行内选区(state, main.head, range)

  view.dispatch({ selection: target, userEvent: 'select' })
  return true
}

/** 选中光标所在或紧邻的词。 */
export function 选中当前词(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  const line = state.doc.lineAt(main.head)
  const range = 词区间(line.text, main.head - line.from)
  if (!range) return false
  view.dispatch({
    selection: 行内选区(state, main.head, range),
    userEvent: 'select'
  })
  return true
}

/**
 * 选中光标所在的整个块。
 *
 * 块的范围直接取自语法树顶层节点，因此"选中这段引用"、"选中这个表格"
 * 这类操作对任何块级语法都自动成立，不需要逐个语法写规则。
 */
export function 选中当前块(view: EditorView): boolean {
  const state = view.state
  const position = state.selection.main.head
  const 树 = syntaxTree(state)

  // 向上找到 Document 的直接子节点，那就是一个"块"。
  let node = 树.resolveInner(position, -1)
  while (node.parent && node.parent.name !== 'Document') node = node.parent
  if (node.name === 'Document') return false

  view.dispatch({
    selection: EditorSelection.single(node.from, node.to),
    userEvent: 'select'
  })
  return true
}

/**
 * 删除当前行或句。
 *
 * 有选区时删选区；无选区时按句删。行内容被删空后连同换行一并吃掉，
 * 避免留下一个空行——这与"删除当前行"的常见观感一致。
 */
export function 删除当前行或句(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main

  if (!main.empty) {
    view.dispatch({ changes: { from: main.from, to: main.to }, userEvent: 'delete' })
    return true
  }

  const line = state.doc.lineAt(main.head)
  const range = 句子区间(line.text, main.head - line.from)
  const start = line.from + range.start
  const end = line.from + range.end

  // 整行被选中时，连同行尾换行一起删除。
  const 整行 = range.start === 0 && range.end === line.text.length
  if (整行 && line.number < state.doc.lines) {
    view.dispatch({
      changes: { from: line.from, to: line.to + 1 },
      userEvent: 'delete'
    })
    return true
  }
  if (end > start) {
    view.dispatch({ changes: { from: start, to: end }, userEvent: 'delete' })
    return true
  }
  return false
}

/** 跳转到行首（第一次按到文字开头，已在文字开头时到行首缩进处）。 */
export function 跳转到行首(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  const line = state.doc.lineAt(main.head)
  const 首个非空白 = line.from + (line.text.length - line.text.trimStart().length)
  const target = main.head === 首个非空白 ? line.from : 首个非空白
  view.dispatch({
    selection: EditorSelection.cursor(target),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

/** 跳转到行尾。 */
export function 跳转到行尾(view: EditorView): boolean {
  const state = view.state
  const line = state.doc.lineAt(state.selection.main.head)
  view.dispatch({
    selection: EditorSelection.cursor(line.to),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

/** 跳转到文首 / 文末。 */
export function 跳转到文首(view: EditorView): boolean {
  view.dispatch({
    selection: EditorSelection.cursor(0),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

export function 跳转到文末(view: EditorView): boolean {
  view.dispatch({
    selection: EditorSelection.cursor(view.state.doc.length),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}
