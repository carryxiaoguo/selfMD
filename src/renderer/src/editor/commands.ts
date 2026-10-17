import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from './syntax-node'

/**
 * 段落与格式编辑命令。
 *
 * 全部遵循同一条约定：**切换语义**。对已经加粗的选区再点一次"加粗"是取消，
 * 而不是套两层星号。菜单项因此不需要维护勾选状态，重按即为撤销。
 *
 * 所有改动都走 `view.dispatch`，并标注 `userEvent`，这样：
 *   - 撤销栈按"一次操作"聚合，Ctrl+Z 不会逐字符回退；
 *   - 输入法/自动补全等扩展能识别这是程序化编辑，不会二次加工。
 */

/**
 * 让格式类命令在撤销栈里独占一步。
 *
 * 没有它，紧接着输入之后的 Ctrl+B 会与前面的打字合并成同一组，
 * 于是 Ctrl+Z 一次把加粗和刚才敲的半句话一起撤销掉——用户想要的是
 * "撤掉加粗"，不是"撤掉一段"。`isolateHistory` 是 @codemirror/commands
 * 导出的注解类型（不是 TransactionSpec 字段），必须走 `annotations`。
 */
const isolatedUndo = isolateHistory.of('full')

// ---------------------------------------------------------------------------
// 选区工具
// ---------------------------------------------------------------------------

/** 选区覆盖到的行号区间（1 基，含首尾）。 */
function affectedLines(state: EditorState): { head: number; tail: number } {
  const main = state.selection.main
  return {
    head: state.doc.lineAt(main.from).number,
    tail: state.doc.lineAt(main.to).number
  }
}

/** 生成"整行替换"的变更集，用于块级命令。 */
function wholeLineChange(
  state: EditorState,
  convertValue: (lineText: string, lineNo: number) => string
): ChangeSpec[] {
  const { head, tail } = affectedLines(state)
  const changes: ChangeSpec[] = []
  for (let no = head; no <= tail; no++) {
    const line = state.doc.line(no)
    const nextTextValue = convertValue(line.text, no)
    if (nextTextValue !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: nextTextValue })
    }
  }
  return changes
}

// ---------------------------------------------------------------------------
// 标题
// ---------------------------------------------------------------------------

const headingRegex = /^(#{1,6})(\s+)/

/**
 * 设为指定级别的标题。
 *
 * @param 级别 1..6；传 0 表示取消标题（变回普通段落）。
 *             对已经是该级别的行再执行一次，同样取消——这就是"切换"。
 */
export function setHeadingLevel(view: EditorView, level: number): boolean {
  const state = view.state
  const { head, tail } = affectedLines(state)

  // 判断当前是否全都是目标级别，用于决定是"设置"还是"取消"。
  let allAreTarget = true
  for (let no = head; no <= tail; no++) {
    const match = headingRegex.exec(state.doc.line(no).text)
    if (!match || match[1].length !== level) {
      allAreTarget = false
      break
    }
  }
  const target = allAreTarget ? 0 : level

  const changes = wholeLineChange(state, (docText) => {
    const stripHeading = docText.replace(headingRegex, '')
    return target === 0 ? stripHeading : '#'.repeat(target) + ' ' + stripHeading
  })
  if (changes.length === 0) return false
  view.dispatch({ changes: changes, userEvent: 'input.setHeading', annotations: isolatedUndo })
  return true
}

/** 提升/降低标题级别；普通段落执行"提升"会变成一级标题。 */
export function adjustHeadingLevel(view: EditorView, direction: 1 | -1): boolean {
  const state = view.state
  const { head } = affectedLines(state)
  const match = headingRegex.exec(state.doc.line(head).text)
  const current = match ? match[1].length : 0
  const lowerLevel = Math.min(6, Math.max(0, current + direction))
  if (lowerLevel === current) return false
  return setHeadingLevel(view, lowerLevel)
}

// ---------------------------------------------------------------------------
// 引用
// ---------------------------------------------------------------------------

const quoteRegex = /^>\s?/

export function toggleQuote(view: EditorView): boolean {
  const state = view.state
  const { head, tail } = affectedLines(state)

  let allQuotes = true
  for (let no = head; no <= tail; no++) {
    if (!quoteRegex.test(state.doc.line(no).text)) {
      allQuotes = false
      break
    }
  }

  const changes = wholeLineChange(state, (docText) =>
    allQuotes ? docText.replace(quoteRegex, '') : '> ' + docText
  )
  if (changes.length === 0) return false
  view.dispatch({ changes: changes, userEvent: 'input.toggleQuote', annotations: isolatedUndo })
  return true
}

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

const bulletRegex = /^(\s*)[-*+]\s+/
const orderedRegex = /^(\s*)\d+[.)]\s+/
const taskRegex = /^(\s*)[-*+]\s+\[[ xX]\]\s+/

export type listKind = '无序' | '有序' | '任务'

export function toggleList(view: EditorView, kind: listKind): boolean {
  const state = view.state
  const { head, tail } = affectedLines(state)

  // 已经全是该类型则取消。
  const matcher =
    kind === '无序' ? bulletRegex : kind === '有序' ? orderedRegex : taskRegex
  let allAreTarget = true
  for (let no = head; no <= tail; no++) {
    if (!matcher.test(state.doc.line(no).text)) {
      allAreTarget = false
      break
    }
  }

  let index = 1
  const changes = wholeLineChange(state, (docText) => {
    // 先剥掉任何已有的列表标记，避免 `- 1. 内容` 这种叠加。
    const indent = /^(\s*)/.exec(docText)?.[1] ?? ''
    let body = docText.slice(indent.length)
    body = body.replace(taskRegex, '').replace(bulletRegex, '').replace(orderedRegex, '')

    if (allAreTarget) return indent + body

    switch (kind) {
      case '无序':
        return `${indent}- ${body}`
      case '有序':
        return `${indent}${index++}. ${body}`
      case '任务':
        return `${indent}- [ ] ${body}`
    }
  })

  if (changes.length === 0) return false
  view.dispatch({ changes: changes, userEvent: 'input.toggleList', annotations: isolatedUndo })
  return true
}

/** 缩进 / 反缩进：块级命令按 2 个空格一层。 */
export function adjustIndent(view: EditorView, direction: 1 | -1): boolean {
  const state = view.state
  const unit = ' '.repeat(Math.max(1, Math.min(8, state.tabSize)))
  const changes = wholeLineChange(state, (docText) => {
    if (direction === 1) return unit + docText
    // 反缩进：优先吃掉一个制表符，否则最多吃掉一个单位的空格。
    if (docText.startsWith('\t')) return docText.slice(1)
    const leadingPart = /^ +/.exec(docText)?.[0] ?? ''
    if (leadingPart.length === 0) return docText
    return docText.slice(Math.min(unit.length, leadingPart.length))
  })
  if (changes.length === 0) return false
  view.dispatch({ changes: changes, userEvent: 'input.indent', annotations: isolatedUndo })
  return true
}

// ---------------------------------------------------------------------------
// 块级插入
// ---------------------------------------------------------------------------

/** 在光标处插入一段文本，并把光标放到指定偏移。 */
function insertBlock(view: EditorView, docText: string, cursorOffset: number): boolean {
  const main = view.state.selection.main
  // 保证块级语法前后各有一个空行，否则会与相邻块粘连。
  const before = main.from > 0 && view.state.sliceDoc(main.from - 1, main.from) !== '\n' ? '\n' : ''
  const content = before + docText
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: content },
    selection: EditorSelection.cursor(main.from + before.length + cursorOffset),
    userEvent: 'input.insertBlock',
    annotations: isolatedUndo
  })
  return true
}

export function insertCodeFence(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  // 有选区就把它包成围栏；没有就插入空围栏。
  if (!main.empty) {
    const originalText = state.sliceDoc(main.from, main.to)
    const content = '```\n' + originalText + '\n```'
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: content },
      selection: EditorSelection.range(main.from, main.from + content.length),
      userEvent: 'input.codeFence',
      annotations: isolatedUndo
    })
    return true
  }
  return insertBlock(view, '```\n\n```\n', 4)
}

export function insertMathBlock(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  if (!main.empty) {
    const originalText = state.sliceDoc(main.from, main.to)
    const content = '$$\n' + originalText + '\n$$'
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: content },
      selection: EditorSelection.range(main.from, main.from + content.length),
      userEvent: 'input.mathBlock',
      annotations: isolatedUndo
    })
    return true
  }
  return insertBlock(view, '$$\n\n$$\n', 3)
}

export function insertHorizontalRule(view: EditorView): boolean {
  return insertBlock(view, '---\n', 4)
}

/** 插入一个 3 列 3 行的表格骨架（含表头与对齐定义行）。 */
export function insertTable(view: EditorView): boolean {
  const skeleton = [
    '| 列一 | 列二 | 列三 |',
    '| ---- | ---- | ---- |',
    '|      |      |      |',
    ''
  ].join('\n')
  // 光标落在第一格内容处，方便直接开始输入。
  return insertBlock(view, skeleton, 2)
}

export function insertFrontMatter(view: EditorView): boolean {
  const state = view.state
  if (state.doc.lines > 1 || state.doc.length > 0) {
    // 前置元数据只能位于文档最开头。
    return false
  }
  const skeleton = '---\ntitle: \n---\n'
  view.dispatch({
    changes: { from: 0, to: 0, insert: skeleton },
    selection: EditorSelection.cursor(11),
    userEvent: 'input.frontMatter',
    annotations: isolatedUndo
  })
  return true
}

// ---------------------------------------------------------------------------
// 行内格式
// ---------------------------------------------------------------------------

/**
 * 给选区套上行内标记，或取消已有的标记。
 *
 * 空选区时插入一对标记并把光标放到中间，符合"点一下加粗，然后开始打字"
 * 的直觉。
 */
export function wrapInline(view: EditorView, before: string, after: string = before): boolean {
  const state = view.state
  const changes: ChangeSpec[] = []
  const nextSelection: { anchor: number; head: number }[] = []

  // 多个选区时从后往前处理，避免前面的改动影响后面的偏移。
  const selections = [...state.selection.ranges].sort((alpha, beta) => beta.from - alpha.from)

  for (const selection of selections) {
    if (selection.empty) {
      changes.push({ from: selection.from, to: selection.to, insert: before + after })
      nextSelection.push({ anchor: selection.from + before.length, head: selection.from + before.length })
      continue
    }

    const originalText = state.sliceDoc(selection.from, selection.to)
    const outerBefore = state.sliceDoc(Math.max(0, selection.from - before.length), selection.from)
    const outerAfter = state.sliceDoc(selection.to, Math.min(state.doc.length, selection.to + after.length))

    if (outerBefore === before && outerAfter === after) {
      // 标记在选区外侧：连同标记一起替换掉
      changes.push({
        from: selection.from - before.length,
        to: selection.to + after.length,
        insert: originalText
      })
      nextSelection.push({ anchor: selection.from - before.length, head: selection.to - before.length })
    } else if (
      originalText.length > before.length + after.length &&
      originalText.startsWith(before) &&
      originalText.endsWith(after)
    ) {
      // 标记在选区内侧
      const content = originalText.slice(before.length, originalText.length - after.length)
      changes.push({ from: selection.from, to: selection.to, insert: content })
      nextSelection.push({ anchor: selection.from, head: selection.from + content.length })
    } else {
      changes.push({ from: selection.from, to: selection.to, insert: before + originalText + after })
      nextSelection.push({ anchor: selection.from + before.length, head: selection.to + before.length })
    }
  }

  if (changes.length === 0) return false
  nextSelection.sort((alpha, beta) => alpha.anchor - beta.anchor)
  view.dispatch({
    changes: changes,
    selection: EditorSelection.create(
      nextSelection.map((sel) => EditorSelection.range(sel.anchor, sel.head))
    ),
    userEvent: 'input.inlineFormat',
    annotations: isolatedUndo
  })
  return true
}

/** 插入或编辑链接：选中文字时包裹为 `[文字](地址)` 并选中地址占位。 */
export function insertLink(view: EditorView): boolean {
  const state = view.state
  const main = state.selection.main
  const text = main.empty ? '' : state.sliceDoc(main.from, main.to)
  const content = `[${text}](地址)`
  const urlStart = main.from + 1 + text.length + 2
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: content },
    selection: EditorSelection.range(urlStart, urlStart + 2),
    userEvent: 'input.insertLink',
    annotations: isolatedUndo
  })
  return true
}

/** 行内标记的集合，供"清除格式"使用。 */
const clearableMark = [
  ['**', '**'],
  ['~~', '~~'],
  ['`', '`'],
  ['*', '*'],
  ['<u>', '</u>'],
  ['<mark>', '</mark>'],
  ['<sup>', '</sup>'],
  ['<sub>', '</sub>'],
  ['<!--', '-->']
] as const

/**
 * 清除选区内的行内标记。
 *
 * 实现方式是文本层面的剥离，而不是遍历语法树——因为用户可能选中了不完整
 * 的标记片段（例如只选中了 `**加粗` 的一部分），语法树此时并不完整，
 * 而文本替换在任何情况下都能给出可预期的结果。
 */
export function clearFormat(view: EditorView): boolean {
  const state = view.state
  const changes: ChangeSpec[] = []

  for (const selection of state.selection.ranges) {
    if (selection.empty) continue
    const originalText = state.sliceDoc(selection.from, selection.to)
    let docText = originalText

    // 用 split/join 做字面量剥离：标记里含 `*` `[` `\` 等正则元字符，
    // 走正则反而要逐个转义，容易出错。
    for (const [before, after] of clearableMark) {
      docText = docText.split(before).join('').split(after).join('')
    }
    // 链接保留可见文字，丢弃地址。
    docText = docText.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

    if (docText !== originalText) {
      changes.push({ from: selection.from, to: selection.to, insert: docText })
    }
  }

  if (changes.length === 0) return false
  view.dispatch({ changes: changes, userEvent: 'input.clearFormat', annotations: isolatedUndo })
  return true
}

/**
 * 引用块里的回车：只加空行，**不撤掉 `>`**。
 *
 * ## 为什么要覆盖 CodeMirror 默认行为
 *
 * CM6 的 `insertNewlineContinueMarkup` 在空的引用行上按回车会**撤掉 `>`**
 * 退出引用——那是标准 Markdown 做法。但引用符现在**不显示了**，
 * 于是"退出引用"在屏幕上表现为**整个框凭空消失**：写着写着框没了，
 * 用户完全不知道发生了什么。
 *
 * 参考的行为是：回车就把你带到下一行、仍然在引用里，框一直在。
 * 想真的退出引用，在行首按退格（`deleteMarkupBackward` 认得引用上下文）。
 *
 * @returns 不在引用行上时返回 false，回车照常交给别的处理器
 */
export function continueQuote(view: EditorView): boolean {
  const state = view.state
  const selection = state.selection.main
  if (!selection.empty) return false

  const line = state.doc.lineAt(selection.head)
  // 光标不在行尾：是在改这一行的内容，不是要开新行
  if (selection.head !== line.to) return false
  // 光标之前的部分得**以引用前缀开头**：缩进 + 一层或多层 `>`。
  // 注意这里**不能**用 `$` 锚定行尾——正文行是 `> 有字的一行`，
  // 只匹配前缀即可，锚了 `$` 就永远匹配不上，命令等于没用。
  const match = /^([ \t]*)((?:>[ \t]?)+)/.exec(state.sliceDoc(line.from, selection.head))
  if (!match) return false

  // 新行的前缀沿用原行：缩进 + 同样层数的 `>`，嵌套引用不会被压平
  const prefixText = match[1] + match[2]
  view.dispatch({
    changes: { from: selection.head, insert: `\n${prefixText}` },
    selection: { anchor: selection.head + 1 + prefixText.length },
    scrollIntoView: true,
    userEvent: 'input'
  })
  return true
}

/**
 * 在围栏首行按回车：补出闭合围栏，光标落进正文。
 *
 * ## 为什么要自己写
 *
 * CodeMirror 的 `insertNewlineContinueMarkup` **在围栏内部直接放弃**。
 * 它内部的 `getContext` 一遇到 `FencedCode` 就 `return` 空上下文，
 * 而空上下文等于"这里没什么可延续的"，于是回车只插入一个普通换行——
 * 用户敲完 ```` ```python ```` 按回车，得到的是一行空行，
 * 得自己再敲一遍三个反引号才能把块闭上。
 *
 * ## 判断条件
 *
 * 三个都要满足：
 *   1. 光标在行尾（在行中间按回车是在改信息串，不该触发）
 *   2. 这一行是某个 FencedCode 的**首行**
 *   3. 这个块还没有闭合围栏
 *
 * 第三条是关键：漏了它，任何一次在代码块里按回车都会多塞一个围栏。
 *
 * @returns 条件不满足时返回 false，把回车让给别的处理器
 */
export function continueCodeFence(view: EditorView): boolean {
  const state = view.state
  const selection = state.selection.main
  if (!selection.empty) return false

  const line = state.doc.lineAt(selection.head)
  const lineText = state.sliceDoc(line.from, line.to)
  // 光标不在行尾：用户是在改已有内容，不是在开新块
  if (selection.head !== line.to) return false
  // 这一行得像围栏首行（反引号或波浪线，后面可以跟语言）
  if (!/^\s*(`{3,}|~{3,})/.test(lineText)) return false

  // 找包含这一行的 FencedCode
  let fence: SyntaxNode | null = null
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1) as unknown as SyntaxNode
  while (node) {
    if (node.name === 'FencedCode') {
      fence = node
      break
    }
    node = node.parent
  }
  if (!fence) return false
  // 必须是**首行**：在块中间按回车不该又补一个围栏
  if (state.doc.lineAt(fence.from).from !== line.from) return false

  // 已经有闭合围栏就不补。块内每按一次回车都补一个围栏，
  // 比不补更烦人——那是在替用户"纠正"他并没有犯的错。
  const restPart = state.sliceDoc(line.to, Math.min(fence.to, state.doc.length))
  if (/\n\s*(`{3,}|~{3,})\s*$/.test(restPart)) return false

  const indent = /^\s*/.exec(lineText)?.[0] ?? ''
  const fenceMark = lineText.trim().startsWith('~') ? '~~~' : '```'

  view.dispatch({
    changes: { from: line.to, insert: `\n\n${indent}${fenceMark}` },
    // 光标落在中间那个空行上——用户接下来要写的是代码，不是围栏
    selection: { anchor: line.to + 1 },
    scrollIntoView: true,
    userEvent: 'input'
  })
  return true
}

/**
 * 从代码围栏里跳出去。
 *
 * 光标落在围栏内时，把它移到**闭合围栏之后**；文档末尾没有那一行就补一行。
 *
 * ## 为什么必须有这个命令
 *
 * 围栏的可见性按"光标是否在这段围栏内"判断——只要还在块里，两个 ```
 * 就一直看得见，边界不会看丢。但反过来说，**站在块内末尾时屏幕上没有任何
 * 提示说"你还在块里"**：最后一行代码之后紧接着就是下一个段落，
 * 看起来完全一样。用户以为已经跳出去了，一打字却插进了代码块。
 *
 * 与其让用户去猜边界在哪，不如给一个明确的出口。这也正是 Typora 的行为。
 *
 * @returns 光标不在围栏内时返回 false，把 Escape 让给别的处理器
 *          （关面板、清选区、退出全屏……）。
 */
export function exitCodeBlock(view: EditorView): boolean {
  const state = view.state
  const cursor = state.selection.main

  // 找包含光标的最内层围栏。`resolveInner` 给的是最深的节点，
  // 沿 parent 往上找，第一个 FencedCode 就是它。
  let fence: SyntaxNode | null = null
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(cursor.head, -1) as unknown as SyntaxNode
  while (node) {
    if (node.name === 'FencedCode') {
      fence = node
      break
    }
    node = node.parent
  }
  if (!fence) return false

  const lastLine = state.doc.lineAt(fence.to)

  // 围栏已经是最后一行：补一个空行再落上去。
  // 不补的话光标无处可去，用户会觉得"退不出去"——那比原来更糟。
  if (lastLine.number >= state.doc.lines) {
    const trailing = state.doc.length
    view.dispatch({
      changes: { from: trailing, insert: '\n' },
      selection: { anchor: trailing + 1 },
      scrollIntoView: true,
      userEvent: 'select'
    })
    return true
  }

  const nextRow = state.doc.line(lastLine.number + 1)
  view.dispatch({
    selection: { anchor: nextRow.from },
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}
