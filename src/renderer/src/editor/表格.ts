import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * 表格编辑。
 *
 * ## 为什么按文本处理，不按语法树
 *
 * 表格的单元格边界在文本里就是**竖线**，判起来没有歧义。走语法树的话，
 * 每次插入一行都要等解析器重新解析，光标位置还得随树节点映射——
 * 而这一层只要知道"这一行的第几个格子在哪"就够。
 *
 * 代码块的头部栏、提示框那几处用语法树，是因为它们要判断"这个节点是不是
 * 围栏 / 引用"；表格不需要，用最轻的办法。
 */

/** 一个单元格在行内的区间（相对行首，不含两侧竖线）。 */
export interface cell {
  start: number
  end: number
}

/** 判断一行像不像表格行：至少有一个竖线，且不是空行。 */
export function isTableRow(lineText: string): boolean {
  return /\|/.test(lineText) && lineText.trim().length > 0
}

/** 判断一行是不是对齐定义行（`| --- | :---: |`）。 */
export function isAlignRow(lineText: string): boolean {
  const piece = lineText.split('|').filter((segment) => segment.trim().length > 0)
  return piece.length > 0 && piece.every((segment) => /^\s*:?-{2,}:?\s*$/.test(segment))
}

/**
 * 切出一行里的每个单元格。
 *
 * 转义的竖线（`\|`）不算分隔符——这是 GFM 的规定，不处理的话
 * 单元格里写一个竖线就把整行切错了。
 */
export function cellRanges(lineText: string): cell[] {
  const result: cell[] = []
  let start = -1
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i]
    if (ch === '\\') {
      // 跳过被转义的那个字符，它的竖线不参与分隔
      i++
      continue
    }
    if (ch === '|') {
      if (start >= 0) result.push({ start, end: i })
      start = i + 1
    }
  }
  // 末尾没有闭合竖线时，最后一段也算一个单元格。
  // **但行尾那条竖线后面不是单元格。** `| 甲 | 乙 |` 是两格不是三格——
  // 漏掉这个判断会凭空多出一个空格子，Tab 跳进去、再往后跳才加行，
  // 表现为"在最后一格按 Tab 没反应"。
  if (start >= 0 && start < lineText.length) result.push({ start, end: lineText.length })
  // 去掉两头空白留给调用方处理，这里只保证区间本身准确
  return result
}

/** 光标所在单元格的序号；不在表格行上时返回 -1。 */
export function currentCellIndex(lineText: string, 行内偏移: number): number {
  const ranges = cellRanges(lineText)
  for (let i = 0; i < ranges.length; i++) {
    const cellBox = ranges[i]
    if (行内偏移 >= cellBox.start && 行内偏移 <= cellBox.end) return i
  }
  // 落在最后一个竖线之后（行尾没有闭合竖线的情况）
  return ranges.length > 0 ? ranges.length - 1 : -1
}

/** 找出光标所在的整张表（连续若干行表格行）。 */
function wholeTable(
  state: EditorState,
  lineNo: number
): { head: number; tail: number } | null {
  if (!isTableRow(state.doc.line(lineNo).text)) return null
  let head = lineNo
  let tail = lineNo
  while (head > 1 && isTableRow(state.doc.line(head - 1).text)) head--
  while (tail < state.doc.lines && isTableRow(state.doc.line(tail + 1).text)) tail++
  return { head, tail }
}

/**
 * 按一整行的单元格数量，补出一行空单元格。
 *
 * 新行沿用**原行的竖线位置与缩进**，这样列宽不会因为插入而跳。
 * 直接拼 `| | | |` 会让所有列宽重算，视觉上"跳一下"。
 */
function makeEmptyRow(模板行文本: string): string {
  const ranges = cellRanges(模板行文本)
  if (ranges.length === 0) return 模板行文本
  const 左缩进 = /^\s*/.exec(模板行文本)?.[0] ?? ''
  const 前导竖线 = 模板行文本.trimStart().startsWith('|')
  const 尾部竖线 = 模板行文本.trimEnd().endsWith('|')

  const 段们: string[] = []
  for (let i = 0; i < ranges.length; i++) {
    const cellBox = ranges[i]
    // 保留每格原来多宽，只把内容换成空格
    const width = Math.max(1, cellBox.end - cellBox.start)
    段们.push(' '.repeat(width))
  }
  const 体 = 段们.join('|')
  return 左缩进 + (前导竖线 ? '|' : '') + 体 + (尾部竖线 ? '|' : '')
}

/**
 * 跳到下一个 / 上一个单元格（Tab / Shift+Tab）。
 *
 * 在**最后一个单元格**上继续往后跳时，自动补一行——这是表格编辑里
 * 最顺手的那个行为：一直按 Tab 就能一直往下写，不用先插行。
 */
export function moveToAdjacentCell(view: EditorView, direction: 1 | -1): boolean {
  const state = view.state
  const selection = state.selection.main
  if (!selection.empty) return false

  const line = state.doc.lineAt(selection.head)
  if (!isTableRow(line.text) || isAlignRow(line.text)) return false

  const ranges = cellRanges(line.text)
  if (ranges.length === 0) return false

  const current = currentCellIndex(line.text, selection.head - line.from)
  if (current < 0) return false

  const target = current + direction
  if (target >= 0 && target < ranges.length) {
    const cellBox = ranges[target]
    // 落在单元格内容区的起点：跳过 `| ` 之后的空白，光标贴在第一个字上
    const 内容起 = line.from + cellBox.start + (/^\s*/.exec(line.text.slice(cellBox.start))?.[0].length ?? 0)
    view.dispatch({ selection: { anchor: 内容起 }, scrollIntoView: true, userEvent: 'select' })
    return true
  }

  // 越界：向右越界时补一行再落到它的第一个格子
  if (direction === 1) {
    const tbl = wholeTable(state, line.number)
    if (!tbl) return false
    // 对齐行不参与"按 Tab 续写"，从它下面那行取模板
    const template = state.doc.line(Math.max(tbl.head, line.number)).text
    const newLine = makeEmptyRow(template)
    const insertAt = state.doc.line(tbl.tail).to
    view.dispatch({
      changes: { from: insertAt, insert: `\n${newLine}` },
      selection: { anchor: insertAt + 1 + (/^\s*\|?\s*/.exec(newLine)?.[0].length ?? 0) },
      scrollIntoView: true,
      userEvent: 'input.addRow'
    })
    return true
  }

  return false
}

/** 在当前行之后插入一行空单元格。 */
export function 表格增行(view: EditorView): boolean {
  const state = view.state
  const line = state.doc.lineAt(state.selection.main.head)
  if (!isTableRow(line.text)) return false
  const newLine = makeEmptyRow(line.text)
  view.dispatch({
    changes: { from: line.to, insert: `\n${newLine}` },
    selection: { anchor: line.to + 1 + (/^\s*\|?\s*/.exec(newLine)?.[0].length ?? 0) },
    userEvent: 'input.addRow'
  })
  return true
}

/** 删除光标所在的行。表头与对齐行不动——删掉它们整张表就散了。 */
export function 表格删行(view: EditorView): boolean {
  const state = view.state
  const line = state.doc.lineAt(state.selection.main.head)
  if (!isTableRow(line.text)) return false
  const tbl = wholeTable(state, line.number)
  if (!tbl) return false
  // 至少保留表头 + 对齐行两行
  if (line.number <= tbl.head + 1 || tbl.tail - tbl.head + 1 <= 2) return false

  const start = line.number === tbl.head ? line.from : line.from - 1
  const end = line.number === tbl.head ? line.to + 1 : line.to
  const 新位置 = Math.min(start, state.doc.length)
  view.dispatch({
    changes: { from: start, to: Math.min(end, state.doc.length) },
    selection: { anchor: 新位置 },
    userEvent: 'delete'
  })
  return true
}

/** 在每行的第 N 列插入一个空单元格（含对齐行，否则表格结构会错位）。 */
export function 表格增列(view: EditorView): boolean {
  const state = view.state
  const line = state.doc.lineAt(state.selection.main.head)
  if (!isTableRow(line.text)) return false
  const tbl = wholeTable(state, line.number)
  if (!tbl) return false

  const ranges = cellRanges(line.text)
  if (ranges.length === 0) return false
  const 列 = Math.max(0, currentCellIndex(line.text, state.selection.main.head - line.from))

  const changes: { from: number; to: number; insert: string }[] = []
  for (let n = tbl.head; n <= tbl.tail; n++) {
    const thisLine = state.doc.line(n)
    const thisRange = cellRanges(thisLine.text)
    if (thisRange.length === 0) continue
    // 插在目标列单元格的**前面**：竖线位置对齐，视觉上不会错位
    const target = thisRange[Math.min(列, thisRange.length - 1)]
    const insertAt = thisLine.from + target.start
    // 对齐行插 `---`，其余插空格，宽度与本列一致
    const width = Math.max(3, target.end - target.start)
    const content = isAlignRow(thisLine.text) ? '-'.repeat(width) : ' '.repeat(width)
    changes.push({ from: insertAt, to: insertAt, insert: `${content}| ` })
  }
  if (changes.length === 0) return false
  view.dispatch({ changes: changes, userEvent: 'input.addColumn' })
  return true
}

/** 删除光标所在的列（含对齐行）。最后一列删不掉。 */
export function 表格删列(view: EditorView): boolean {
  const state = view.state
  const line = state.doc.lineAt(state.selection.main.head)
  if (!isTableRow(line.text)) return false
  const tbl = wholeTable(state, line.number)
  if (!tbl) return false

  const ranges = cellRanges(line.text)
  if (ranges.length <= 1) return false
  const 列 = Math.max(0, currentCellIndex(line.text, state.selection.main.head - line.from))

  const changes: { from: number; to: number }[] = []
  for (let n = tbl.head; n <= tbl.tail; n++) {
    const thisLine = state.doc.line(n)
    const thisRange = cellRanges(thisLine.text)
    if (thisRange.length === 0) continue
    const target = thisRange[Math.min(列, thisRange.length - 1)]
    // 连同前面那条竖线一起删，否则会留下 `||`
    let start = thisLine.from + target.start
    if (start > thisLine.from && thisLine.text[target.start - 1] === '|') start--
    changes.push({ from: start, to: thisLine.from + target.end })
  }
  if (changes.length === 0) return false
  view.dispatch({ changes: changes, userEvent: 'delete' })
  return true
}

/** 设置列对齐。`对齐` 取 `left` / `center` / `right`。 */
export function 表格对齐(view: EditorView, 对齐: 'left' | 'center' | 'right'): boolean {
  const state = view.state
  const line = state.doc.lineAt(state.selection.main.head)
  if (!isTableRow(line.text)) return false
  const tbl = wholeTable(state, line.number)
  if (!tbl) return false

  // 对齐定义行是表头下面那一行
  const 定义行号 = tbl.head + 1
  if (定义行号 > tbl.tail) return false
  const 定义行 = state.doc.line(定义行号)
  if (!isAlignRow(定义行.text)) return false

  const ranges = cellRanges(定义行.text)
  const 列 = Math.max(0, currentCellIndex(line.text, state.selection.main.head - line.from))
  const target = ranges[Math.min(列, ranges.length - 1)]
  if (!target) return false

  const mark = 对齐 === 'left' ? ':---' : 对齐 === 'center' ? ':---:' : '---:'
  // 用标记填满该格原来的宽度，列宽不变
  const width = Math.max(3, target.end - target.start)
  const content = mark.padEnd(width, '-')
  view.dispatch({
    changes: { from: 定义行.from + target.start, to: 定义行.from + target.end, insert: content },
    userEvent: 'input.align'
  })
  return true
}

/** 光标是否在一张表里。给右键菜单判断用。 */
export function 在表格里(state: EditorState): boolean {
  return isTableRow(state.doc.lineAt(state.selection.main.head).text)
}
