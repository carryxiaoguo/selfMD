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
  const after = lineText[position + 1]
  return after === undefined || /\s/.test(after)
}

function isTerminator(lineText: string, position: number): boolean {
  return 硬终止符.test(lineText[position]) || 是英文句点(lineText, position)
}

/**
 * 找出包含 `偏移` 的那句话，返回行内区间。
 *
 * 边界取"上一个终止符之后"到"下一个终止符（含）"；找不到终止符时
 * 整行就是一句——这符合直觉：没有句号的一行本来就是一整句。
 */
export function sentenceRange(lineText: string, offset: number): { start: number; end: number } {
  let start = 0
  for (let i = Math.min(offset, lineText.length) - 1; i >= 0; i--) {
    if (isTerminator(lineText, i)) {
      start = i + 1
      break
    }
  }

  let end = lineText.length
  for (let i = Math.max(0, Math.min(offset, lineText.length)); i < lineText.length; i++) {
    if (isTerminator(lineText, i)) {
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

const cjkChar = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const latinWordChar = /[A-Za-z0-9_\u00c0-\u024f]/

/**
 * 找出包含 `偏移` 的那个词，返回行内区间；光标两侧都不是词时返回 null。
 *
 * 中日韩文字按**单字成词**处理。没有分词器的情况下这是唯一诚实的选择：
 * 按标点切会把"选中当前词"变成"选中整句"，反而更糟。
 */
export function wordSpan(lineText: string, offset: number): { start: number; end: number } | null {
  const atCursor = lineText[offset]
  const beforeCursor = offset > 0 ? lineText[offset - 1] : undefined

  // 中日韩：单字
  if (atCursor !== undefined && cjkChar.test(atCursor)) return { start: offset, end: offset + 1 }
  if (beforeCursor !== undefined && cjkChar.test(beforeCursor)) return { start: offset - 1, end: offset }

  // 拉丁词：向两侧扩展到非词字符
  const fromPos = atCursor !== undefined && latinWordChar.test(atCursor) ? offset : offset - 1
  if (fromPos < 0 || fromPos >= lineText.length || !latinWordChar.test(lineText[fromPos])) return null

  let start = fromPos
  let end = fromPos + 1
  while (start > 0 && latinWordChar.test(lineText[start - 1])) start -= 1
  while (end < lineText.length && latinWordChar.test(lineText[end])) end += 1
  return { start, end }
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/** 把行内区间映射为文档选区。 */
function inlineSelection(state: EditorState, position: number, range: { start: number; end: number }): EditorSelection {
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
export function selectLineOrSentence(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  const line = state.doc.lineAt(main.head)
  const range = sentenceRange(line.text, main.head - line.from)

  // 整行已经选中时再按一次，扩展为整行（含首尾空白），给用户一个"退路"。
  const 当前已满 = main.from === line.from + range.start && main.to === line.from + range.end
  const target = 当前已满
    ? EditorSelection.single(line.from, line.to)
    : inlineSelection(state, main.head, range)

  view.dispatch({ selection: target, userEvent: 'select' })
  return true
}

/** 选中光标所在或紧邻的词。 */
export function selectWord(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  const line = state.doc.lineAt(main.head)
  const range = wordSpan(line.text, main.head - line.from)
  if (!range) return false
  view.dispatch({
    selection: inlineSelection(state, main.head, range),
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
export function selectBlock(view: EditorView): boolean {
  const state = view.state
  const position = state.selection.main.head
  const tree = syntaxTree(state)

  // 向上找到 Document 的直接子节点，那就是一个"块"。
  let node = tree.resolveInner(position, -1)
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
export function deleteLineOrSentence(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main

  if (!main.empty) {
    view.dispatch({ changes: { from: main.from, to: main.to }, userEvent: 'delete' })
    return true
  }

  const line = state.doc.lineAt(main.head)
  const range = sentenceRange(line.text, main.head - line.from)
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
export function jumpToLineStart(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  const line = state.doc.lineAt(main.head)
  const firstNonBlankChar = line.from + (line.text.length - line.text.trimStart().length)
  const target = main.head === firstNonBlankChar ? line.from : firstNonBlankChar
  view.dispatch({
    selection: EditorSelection.cursor(target),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

/** 跳转到行尾。 */
export function jumpToLineEnd(view: EditorView): boolean {
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
export function jumpToDocStart(view: EditorView): boolean {
  view.dispatch({
    selection: EditorSelection.cursor(0),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

export function jumpToDocEnd(view: EditorView): boolean {
  view.dispatch({
    selection: EditorSelection.cursor(view.state.doc.length),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}
