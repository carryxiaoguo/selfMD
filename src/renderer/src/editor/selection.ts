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
function 是英文句点(行文本: string, 位置: number): boolean {
  if (行文本[位置] !== '.') return false
  const 后 = 行文本[位置 + 1]
  return 后 === undefined || /\s/.test(后)
}

function 是终止符(行文本: string, 位置: number): boolean {
  return 硬终止符.test(行文本[位置]) || 是英文句点(行文本, 位置)
}

/**
 * 找出包含 `偏移` 的那句话，返回行内区间。
 *
 * 边界取"上一个终止符之后"到"下一个终止符（含）"；找不到终止符时
 * 整行就是一句——这符合直觉：没有句号的一行本来就是一整句。
 */
export function 句子区间(行文本: string, 偏移: number): { 起: number; 终: number } {
  let 起 = 0
  for (let i = Math.min(偏移, 行文本.length) - 1; i >= 0; i--) {
    if (是终止符(行文本, i)) {
      起 = i + 1
      break
    }
  }

  let 终 = 行文本.length
  for (let i = Math.max(0, Math.min(偏移, 行文本.length)); i < 行文本.length; i++) {
    if (是终止符(行文本, i)) {
      终 = i + 1
      break
    }
  }

  // 去掉两端空白：选中" 你好 "时用户想要的是"你好"。
  while (起 < 终 && /\s/.test(行文本[起])) 起 += 1
  while (终 > 起 && /\s/.test(行文本[终 - 1])) 终 -= 1
  return { 起, 终 }
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
export function 词区间(行文本: string, 偏移: number): { 起: number; 终: number } | null {
  const 光标处 = 行文本[偏移]
  const 光标前 = 偏移 > 0 ? 行文本[偏移 - 1] : undefined

  // 中日韩：单字
  if (光标处 !== undefined && 中日韩.test(光标处)) return { 起: 偏移, 终: 偏移 + 1 }
  if (光标前 !== undefined && 中日韩.test(光标前)) return { 起: 偏移 - 1, 终: 偏移 }

  // 拉丁词：向两侧扩展到非词字符
  const 起点 = 光标处 !== undefined && 拉丁词字符.test(光标处) ? 偏移 : 偏移 - 1
  if (起点 < 0 || 起点 >= 行文本.length || !拉丁词字符.test(行文本[起点])) return null

  let 起 = 起点
  let 终 = 起点 + 1
  while (起 > 0 && 拉丁词字符.test(行文本[起 - 1])) 起 -= 1
  while (终 < 行文本.length && 拉丁词字符.test(行文本[终])) 终 += 1
  return { 起, 终 }
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/** 把行内区间映射为文档选区。 */
function 行内选区(状态: EditorState, 位置: number, 区间: { 起: number; 终: number }): EditorSelection {
  const 行 = 状态.doc.lineAt(位置)
  // EditorSelection.range() 返回的是单个 SelectionRange，不是 EditorSelection；
  // 单区间要用 single()。
  return EditorSelection.single(行.from + 区间.起, 行.from + 区间.终)
}

/**
 * 选中当前行或句。
 *
 * 与通行取舍一致：**优先按句选**。光标停在一句中间时选中整句；
 * 该行只有一句（或没有终止符）时，效果就等于选中整行。
 */
export function 选中当前行或句(视图: EditorView): boolean {
  const 状态 = 视图.state
  const 主 = 状态.selection.main
  const 行 = 状态.doc.lineAt(主.head)
  const 区间 = 句子区间(行.text, 主.head - 行.from)

  // 整行已经选中时再按一次，扩展为整行（含首尾空白），给用户一个"退路"。
  const 当前已满 = 主.from === 行.from + 区间.起 && 主.to === 行.from + 区间.终
  const 目标 = 当前已满
    ? EditorSelection.single(行.from, 行.to)
    : 行内选区(状态, 主.head, 区间)

  视图.dispatch({ selection: 目标, userEvent: 'select' })
  return true
}

/** 选中光标所在或紧邻的词。 */
export function 选中当前词(视图: EditorView): boolean {
  const 状态 = 视图.state
  const 主 = 状态.selection.main
  const 行 = 状态.doc.lineAt(主.head)
  const 区间 = 词区间(行.text, 主.head - 行.from)
  if (!区间) return false
  视图.dispatch({
    selection: 行内选区(状态, 主.head, 区间),
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
export function 选中当前块(视图: EditorView): boolean {
  const 状态 = 视图.state
  const 位置 = 状态.selection.main.head
  const 树 = syntaxTree(状态)

  // 向上找到 Document 的直接子节点，那就是一个"块"。
  let 节点 = 树.resolveInner(位置, -1)
  while (节点.parent && 节点.parent.name !== 'Document') 节点 = 节点.parent
  if (节点.name === 'Document') return false

  视图.dispatch({
    selection: EditorSelection.single(节点.from, 节点.to),
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
export function 删除当前行或句(视图: EditorView): boolean {
  const 状态 = 视图.state
  const 主 = 状态.selection.main

  if (!主.empty) {
    视图.dispatch({ changes: { from: 主.from, to: 主.to }, userEvent: 'delete' })
    return true
  }

  const 行 = 状态.doc.lineAt(主.head)
  const 区间 = 句子区间(行.text, 主.head - 行.from)
  const 起 = 行.from + 区间.起
  const 终 = 行.from + 区间.终

  // 整行被选中时，连同行尾换行一起删除。
  const 整行 = 区间.起 === 0 && 区间.终 === 行.text.length
  if (整行 && 行.number < 状态.doc.lines) {
    视图.dispatch({
      changes: { from: 行.from, to: 行.to + 1 },
      userEvent: 'delete'
    })
    return true
  }
  if (终 > 起) {
    视图.dispatch({ changes: { from: 起, to: 终 }, userEvent: 'delete' })
    return true
  }
  return false
}

/** 跳转到行首（第一次按到文字开头，已在文字开头时到行首缩进处）。 */
export function 跳转到行首(视图: EditorView): boolean {
  const 状态 = 视图.state
  const 主 = 状态.selection.main
  const 行 = 状态.doc.lineAt(主.head)
  const 首个非空白 = 行.from + (行.text.length - 行.text.trimStart().length)
  const 目标 = 主.head === 首个非空白 ? 行.from : 首个非空白
  视图.dispatch({
    selection: EditorSelection.cursor(目标),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

/** 跳转到行尾。 */
export function 跳转到行尾(视图: EditorView): boolean {
  const 状态 = 视图.state
  const 行 = 状态.doc.lineAt(状态.selection.main.head)
  视图.dispatch({
    selection: EditorSelection.cursor(行.to),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

/** 跳转到文首 / 文末。 */
export function 跳转到文首(视图: EditorView): boolean {
  视图.dispatch({
    selection: EditorSelection.cursor(0),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}

export function 跳转到文末(视图: EditorView): boolean {
  视图.dispatch({
    selection: EditorSelection.cursor(视图.state.doc.length),
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}
