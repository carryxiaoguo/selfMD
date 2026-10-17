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
export interface 单元格 {
  起: number
  终: number
}

/** 判断一行像不像表格行：至少有一个竖线，且不是空行。 */
export function 是表格行(行文本: string): boolean {
  return /\|/.test(行文本) && 行文本.trim().length > 0
}

/** 判断一行是不是对齐定义行（`| --- | :---: |`）。 */
export function 是对齐行(行文本: string): boolean {
  const 片 = 行文本.split('|').filter((段) => 段.trim().length > 0)
  return 片.length > 0 && 片.every((段) => /^\s*:?-{2,}:?\s*$/.test(段))
}

/**
 * 切出一行里的每个单元格。
 *
 * 转义的竖线（`\|`）不算分隔符——这是 GFM 的规定，不处理的话
 * 单元格里写一个竖线就把整行切错了。
 */
export function 单元格区间(行文本: string): 单元格[] {
  const 结果: 单元格[] = []
  let 起 = -1
  for (let i = 0; i < 行文本.length; i++) {
    const 字符 = 行文本[i]
    if (字符 === '\\') {
      // 跳过被转义的那个字符，它的竖线不参与分隔
      i++
      continue
    }
    if (字符 === '|') {
      if (起 >= 0) 结果.push({ 起, 终: i })
      起 = i + 1
    }
  }
  // 末尾没有闭合竖线时，最后一段也算一个单元格
  if (起 >= 0 && 起 <= 行文本.length) 结果.push({ 起, 终: 行文本.length })
  // 去掉两头空白留给调用方处理，这里只保证区间本身准确
  return 结果
}

/** 光标所在单元格的序号；不在表格行上时返回 -1。 */
export function 当前单元格序号(行文本: string, 行内偏移: number): number {
  const 区间们 = 单元格区间(行文本)
  for (let i = 0; i < 区间们.length; i++) {
    const 格 = 区间们[i]
    if (行内偏移 >= 格.起 && 行内偏移 <= 格.终) return i
  }
  // 落在最后一个竖线之后（行尾没有闭合竖线的情况）
  return 区间们.length > 0 ? 区间们.length - 1 : -1
}

/** 找出光标所在的整张表（连续若干行表格行）。 */
function 整张表(
  状态: EditorState,
  行号: number
): { 首: number; 末: number } | null {
  if (!是表格行(状态.doc.line(行号).text)) return null
  let 首 = 行号
  let 末 = 行号
  while (首 > 1 && 是表格行(状态.doc.line(首 - 1).text)) 首--
  while (末 < 状态.doc.lines && 是表格行(状态.doc.line(末 + 1).text)) 末++
  return { 首, 末 }
}

/**
 * 按一整行的单元格数量，补出一行空单元格。
 *
 * 新行沿用**原行的竖线位置与缩进**，这样列宽不会因为插入而跳。
 * 直接拼 `| | | |` 会让所有列宽重算，视觉上"跳一下"。
 */
function 造空行(模板行文本: string): string {
  const 区间们 = 单元格区间(模板行文本)
  if (区间们.length === 0) return 模板行文本
  const 左缩进 = /^\s*/.exec(模板行文本)?.[0] ?? ''
  const 前导竖线 = 模板行文本.trimStart().startsWith('|')
  const 尾部竖线 = 模板行文本.trimEnd().endsWith('|')

  const 段们: string[] = []
  for (let i = 0; i < 区间们.length; i++) {
    const 格 = 区间们[i]
    // 保留每格原来多宽，只把内容换成空格
    const 宽 = Math.max(1, 格.终 - 格.起)
    段们.push(' '.repeat(宽))
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
export function 跳到相邻单元格(view: EditorView, 方向: 1 | -1): boolean {
  const 状态 = view.state
  const 选区 = 状态.selection.main
  if (!选区.empty) return false

  const 行 = 状态.doc.lineAt(选区.head)
  if (!是表格行(行.text) || 是对齐行(行.text)) return false

  const 区间们 = 单元格区间(行.text)
  if (区间们.length === 0) return false

  const 当前 = 当前单元格序号(行.text, 选区.head - 行.from)
  if (当前 < 0) return false

  const 目标 = 当前 + 方向
  if (目标 >= 0 && 目标 < 区间们.length) {
    const 格 = 区间们[目标]
    // 落在单元格内容区的起点：跳过 `| ` 之后的空白，光标贴在第一个字上
    const 内容起 = 行.from + 格.起 + (/^\s*/.exec(行.text.slice(格.起))?.[0].length ?? 0)
    view.dispatch({ selection: { anchor: 内容起 }, scrollIntoView: true, userEvent: 'select' })
    return true
  }

  // 越界：向右越界时补一行再落到它的第一个格子
  if (方向 === 1) {
    const 表 = 整张表(状态, 行.number)
    if (!表) return false
    // 对齐行不参与"按 Tab 续写"，从它下面那行取模板
    const 模板 = 状态.doc.line(Math.max(表.首, 行.number)).text
    const 新行 = 造空行(模板)
    const 插在 = 状态.doc.line(表.末).to
    view.dispatch({
      changes: { from: 插在, insert: `\n${新行}` },
      selection: { anchor: 插在 + 1 + (/^\s*\|?\s*/.exec(新行)?.[0].length ?? 0) },
      scrollIntoView: true,
      userEvent: 'input.addRow'
    })
    return true
  }

  return false
}

/** 在当前行之后插入一行空单元格。 */
export function 表格增行(view: EditorView): boolean {
  const 状态 = view.state
  const 行 = 状态.doc.lineAt(状态.selection.main.head)
  if (!是表格行(行.text)) return false
  const 新行 = 造空行(行.text)
  view.dispatch({
    changes: { from: 行.to, insert: `\n${新行}` },
    selection: { anchor: 行.to + 1 + (/^\s*\|?\s*/.exec(新行)?.[0].length ?? 0) },
    userEvent: 'input.addRow'
  })
  return true
}

/** 删除光标所在的行。表头与对齐行不动——删掉它们整张表就散了。 */
export function 表格删行(view: EditorView): boolean {
  const 状态 = view.state
  const 行 = 状态.doc.lineAt(状态.selection.main.head)
  if (!是表格行(行.text)) return false
  const 表 = 整张表(状态, 行.number)
  if (!表) return false
  // 至少保留表头 + 对齐行两行
  if (行.number <= 表.首 + 1 || 表.末 - 表.首 + 1 <= 2) return false

  const 起 = 行.number === 表.首 ? 行.from : 行.from - 1
  const 终 = 行.number === 表.首 ? 行.to + 1 : 行.to
  const 新位置 = Math.min(起, 状态.doc.length)
  view.dispatch({
    changes: { from: 起, to: Math.min(终, 状态.doc.length) },
    selection: { anchor: 新位置 },
    userEvent: 'delete'
  })
  return true
}

/** 在每行的第 N 列插入一个空单元格（含对齐行，否则表格结构会错位）。 */
export function 表格增列(view: EditorView): boolean {
  const 状态 = view.state
  const 行 = 状态.doc.lineAt(状态.selection.main.head)
  if (!是表格行(行.text)) return false
  const 表 = 整张表(状态, 行.number)
  if (!表) return false

  const 区间们 = 单元格区间(行.text)
  if (区间们.length === 0) return false
  const 列 = Math.max(0, 当前单元格序号(行.text, 状态.selection.main.head - 行.from))

  const 变更: { from: number; to: number; insert: string }[] = []
  for (let n = 表.首; n <= 表.末; n++) {
    const 本行 = 状态.doc.line(n)
    const 本区间 = 单元格区间(本行.text)
    if (本区间.length === 0) continue
    // 插在目标列单元格的**前面**：竖线位置对齐，视觉上不会错位
    const 目标 = 本区间[Math.min(列, 本区间.length - 1)]
    const 插在 = 本行.from + 目标.起
    // 对齐行插 `---`，其余插空格，宽度与本列一致
    const 宽 = Math.max(3, 目标.终 - 目标.起)
    const 内容 = 是对齐行(本行.text) ? '-'.repeat(宽) : ' '.repeat(宽)
    变更.push({ from: 插在, to: 插在, insert: `${内容}| ` })
  }
  if (变更.length === 0) return false
  view.dispatch({ changes: 变更, userEvent: 'input.addColumn' })
  return true
}

/** 删除光标所在的列（含对齐行）。最后一列删不掉。 */
export function 表格删列(view: EditorView): boolean {
  const 状态 = view.state
  const 行 = 状态.doc.lineAt(状态.selection.main.head)
  if (!是表格行(行.text)) return false
  const 表 = 整张表(状态, 行.number)
  if (!表) return false

  const 区间们 = 单元格区间(行.text)
  if (区间们.length <= 1) return false
  const 列 = Math.max(0, 当前单元格序号(行.text, 状态.selection.main.head - 行.from))

  const 变更: { from: number; to: number }[] = []
  for (let n = 表.首; n <= 表.末; n++) {
    const 本行 = 状态.doc.line(n)
    const 本区间 = 单元格区间(本行.text)
    if (本区间.length === 0) continue
    const 目标 = 本区间[Math.min(列, 本区间.length - 1)]
    // 连同前面那条竖线一起删，否则会留下 `||`
    let 起 = 本行.from + 目标.起
    if (起 > 本行.from && 本行.text[目标.起 - 1] === '|') 起--
    变更.push({ from: 起, to: 本行.from + 目标.终 })
  }
  if (变更.length === 0) return false
  view.dispatch({ changes: 变更, userEvent: 'delete' })
  return true
}

/** 设置列对齐。`对齐` 取 `left` / `center` / `right`。 */
export function 表格对齐(view: EditorView, 对齐: 'left' | 'center' | 'right'): boolean {
  const 状态 = view.state
  const 行 = 状态.doc.lineAt(状态.selection.main.head)
  if (!是表格行(行.text)) return false
  const 表 = 整张表(状态, 行.number)
  if (!表) return false

  // 对齐定义行是表头下面那一行
  const 定义行号 = 表.首 + 1
  if (定义行号 > 表.末) return false
  const 定义行 = 状态.doc.line(定义行号)
  if (!是对齐行(定义行.text)) return false

  const 区间们 = 单元格区间(定义行.text)
  const 列 = Math.max(0, 当前单元格序号(行.text, 状态.selection.main.head - 行.from))
  const 目标 = 区间们[Math.min(列, 区间们.length - 1)]
  if (!目标) return false

  const 标记 = 对齐 === 'left' ? ':---' : 对齐 === 'center' ? ':---:' : '---:'
  // 用标记填满该格原来的宽度，列宽不变
  const 宽 = Math.max(3, 目标.终 - 目标.起)
  const 内容 = 标记.padEnd(宽, '-')
  view.dispatch({
    changes: { from: 定义行.from + 目标.起, to: 定义行.from + 目标.终, insert: 内容 },
    userEvent: 'input.align'
  })
  return true
}

/** 光标是否在一张表里。给右键菜单判断用。 */
export function 在表格里(状态: EditorState): boolean {
  return 是表格行(状态.doc.lineAt(状态.selection.main.head).text)
}
