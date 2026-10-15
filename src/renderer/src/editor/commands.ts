import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { 语法节点 } from './syntax-node'

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
const 独立撤销 = isolateHistory.of('full')

// ---------------------------------------------------------------------------
// 选区工具
// ---------------------------------------------------------------------------

/** 选区覆盖到的行号区间（1 基，含首尾）。 */
function 涉及行(状态: EditorState): { 首: number; 末: number } {
  const 主 = 状态.selection.main
  return {
    首: 状态.doc.lineAt(主.from).number,
    末: 状态.doc.lineAt(主.to).number
  }
}

/** 生成"整行替换"的变更集，用于块级命令。 */
function 整行变更(
  状态: EditorState,
  转换: (行文本: string, 行号: number) => string
): ChangeSpec[] {
  const { 首, 末 } = 涉及行(状态)
  const 变更: ChangeSpec[] = []
  for (let 号 = 首; 号 <= 末; 号++) {
    const 行 = 状态.doc.line(号)
    const 新文本 = 转换(行.text, 号)
    if (新文本 !== 行.text) {
      变更.push({ from: 行.from, to: 行.to, insert: 新文本 })
    }
  }
  return 变更
}

// ---------------------------------------------------------------------------
// 标题
// ---------------------------------------------------------------------------

const 标题正则 = /^(#{1,6})(\s+)/

/**
 * 设为指定级别的标题。
 *
 * @param 级别 1..6；传 0 表示取消标题（变回普通段落）。
 *             对已经是该级别的行再执行一次，同样取消——这就是"切换"。
 */
export function 设置标题级别(view: EditorView, 级别: number): boolean {
  const 状态 = view.state
  const { 首, 末 } = 涉及行(状态)

  // 判断当前是否全都是目标级别，用于决定是"设置"还是"取消"。
  let 全是目标 = true
  for (let 号 = 首; 号 <= 末; 号++) {
    const 匹配 = 标题正则.exec(状态.doc.line(号).text)
    if (!匹配 || 匹配[1].length !== 级别) {
      全是目标 = false
      break
    }
  }
  const 目标 = 全是目标 ? 0 : 级别

  const 变更 = 整行变更(状态, (文本) => {
    const 去标题 = 文本.replace(标题正则, '')
    return 目标 === 0 ? 去标题 : '#'.repeat(目标) + ' ' + 去标题
  })
  if (变更.length === 0) return false
  view.dispatch({ changes: 变更, userEvent: 'input.setHeading', annotations: 独立撤销 })
  return true
}

/** 提升/降低标题级别；普通段落执行"提升"会变成一级标题。 */
export function 调整标题级别(view: EditorView, 方向: 1 | -1): boolean {
  const 状态 = view.state
  const { 首 } = 涉及行(状态)
  const 匹配 = 标题正则.exec(状态.doc.line(首).text)
  const 当前 = 匹配 ? 匹配[1].length : 0
  const 下级 = Math.min(6, Math.max(0, 当前 + 方向))
  if (下级 === 当前) return false
  return 设置标题级别(view, 下级)
}

// ---------------------------------------------------------------------------
// 引用
// ---------------------------------------------------------------------------

const 引用正则 = /^>\s?/

export function 切换引用(view: EditorView): boolean {
  const 状态 = view.state
  const { 首, 末 } = 涉及行(状态)

  let 全是引用 = true
  for (let 号 = 首; 号 <= 末; 号++) {
    if (!引用正则.test(状态.doc.line(号).text)) {
      全是引用 = false
      break
    }
  }

  const 变更 = 整行变更(状态, (文本) =>
    全是引用 ? 文本.replace(引用正则, '') : '> ' + 文本
  )
  if (变更.length === 0) return false
  view.dispatch({ changes: 变更, userEvent: 'input.toggleQuote', annotations: 独立撤销 })
  return true
}

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

const 无序正则 = /^(\s*)[-*+]\s+/
const 有序正则 = /^(\s*)\d+[.)]\s+/
const 任务正则 = /^(\s*)[-*+]\s+\[[ xX]\]\s+/

export type 列表类型 = '无序' | '有序' | '任务'

export function 切换列表(view: EditorView, 类型: 列表类型): boolean {
  const 状态 = view.state
  const { 首, 末 } = 涉及行(状态)

  // 已经全是该类型则取消。
  const 匹配器 =
    类型 === '无序' ? 无序正则 : 类型 === '有序' ? 有序正则 : 任务正则
  let 全是目标 = true
  for (let 号 = 首; 号 <= 末; 号++) {
    if (!匹配器.test(状态.doc.line(号).text)) {
      全是目标 = false
      break
    }
  }

  let 序号 = 1
  const 变更 = 整行变更(状态, (文本) => {
    // 先剥掉任何已有的列表标记，避免 `- 1. 内容` 这种叠加。
    const 缩进 = /^(\s*)/.exec(文本)?.[1] ?? ''
    let 正文 = 文本.slice(缩进.length)
    正文 = 正文.replace(任务正则, '').replace(无序正则, '').replace(有序正则, '')

    if (全是目标) return 缩进 + 正文

    switch (类型) {
      case '无序':
        return `${缩进}- ${正文}`
      case '有序':
        return `${缩进}${序号++}. ${正文}`
      case '任务':
        return `${缩进}- [ ] ${正文}`
    }
  })

  if (变更.length === 0) return false
  view.dispatch({ changes: 变更, userEvent: 'input.toggleList', annotations: 独立撤销 })
  return true
}

/** 缩进 / 反缩进：块级命令按 2 个空格一层。 */
export function 调整缩进(view: EditorView, 方向: 1 | -1): boolean {
  const 状态 = view.state
  const 单位 = ' '.repeat(Math.max(1, Math.min(8, 状态.tabSize)))
  const 变更 = 整行变更(状态, (文本) => {
    if (方向 === 1) return 单位 + 文本
    // 反缩进：优先吃掉一个制表符，否则最多吃掉一个单位的空格。
    if (文本.startsWith('\t')) return 文本.slice(1)
    const 前导 = /^ +/.exec(文本)?.[0] ?? ''
    if (前导.length === 0) return 文本
    return 文本.slice(Math.min(单位.length, 前导.length))
  })
  if (变更.length === 0) return false
  view.dispatch({ changes: 变更, userEvent: 'input.indent', annotations: 独立撤销 })
  return true
}

// ---------------------------------------------------------------------------
// 块级插入
// ---------------------------------------------------------------------------

/** 在光标处插入一段文本，并把光标放到指定偏移。 */
function 插入块(view: EditorView, 文本: string, 光标偏移: number): boolean {
  const 主 = view.state.selection.main
  // 保证块级语法前后各有一个空行，否则会与相邻块粘连。
  const 前 = 主.from > 0 && view.state.sliceDoc(主.from - 1, 主.from) !== '\n' ? '\n' : ''
  const 内容 = 前 + 文本
  view.dispatch({
    changes: { from: 主.from, to: 主.to, insert: 内容 },
    selection: EditorSelection.cursor(主.from + 前.length + 光标偏移),
    userEvent: 'input.insertBlock',
    annotations: 独立撤销
  })
  return true
}

export function 插入代码围栏(view: EditorView): boolean {
  const 状态 = view.state
  const 主 = 状态.selection.main
  // 有选区就把它包成围栏；没有就插入空围栏。
  if (!主.empty) {
    const 原文 = 状态.sliceDoc(主.from, 主.to)
    const 内容 = '```\n' + 原文 + '\n```'
    view.dispatch({
      changes: { from: 主.from, to: 主.to, insert: 内容 },
      selection: EditorSelection.range(主.from, 主.from + 内容.length),
      userEvent: 'input.codeFence',
      annotations: 独立撤销
    })
    return true
  }
  return 插入块(view, '```\n\n```\n', 4)
}

export function 插入数学块(view: EditorView): boolean {
  const 状态 = view.state
  const 主 = 状态.selection.main
  if (!主.empty) {
    const 原文 = 状态.sliceDoc(主.from, 主.to)
    const 内容 = '$$\n' + 原文 + '\n$$'
    view.dispatch({
      changes: { from: 主.from, to: 主.to, insert: 内容 },
      selection: EditorSelection.range(主.from, 主.from + 内容.length),
      userEvent: 'input.mathBlock',
      annotations: 独立撤销
    })
    return true
  }
  return 插入块(view, '$$\n\n$$\n', 3)
}

export function 插入水平线(view: EditorView): boolean {
  return 插入块(view, '---\n', 4)
}

/** 插入一个 3 列 3 行的表格骨架（含表头与对齐定义行）。 */
export function 插入表格(view: EditorView): boolean {
  const 骨架 = [
    '| 列一 | 列二 | 列三 |',
    '| ---- | ---- | ---- |',
    '|      |      |      |',
    ''
  ].join('\n')
  // 光标落在第一格内容处，方便直接开始输入。
  return 插入块(view, 骨架, 2)
}

export function 插入前置元数据(view: EditorView): boolean {
  const 状态 = view.state
  if (状态.doc.lines > 1 || 状态.doc.length > 0) {
    // 前置元数据只能位于文档最开头。
    return false
  }
  const 骨架 = '---\ntitle: \n---\n'
  view.dispatch({
    changes: { from: 0, to: 0, insert: 骨架 },
    selection: EditorSelection.cursor(11),
    userEvent: 'input.frontMatter',
    annotations: 独立撤销
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
export function 包裹行内(view: EditorView, 前: string, 后: string = 前): boolean {
  const 状态 = view.state
  const 变更: ChangeSpec[] = []
  const 新选区: { anchor: number; head: number }[] = []

  // 多个选区时从后往前处理，避免前面的改动影响后面的偏移。
  const 选区们 = [...状态.selection.ranges].sort((甲, 乙) => 乙.from - 甲.from)

  for (const 选区 of 选区们) {
    if (选区.empty) {
      变更.push({ from: 选区.from, to: 选区.to, insert: 前 + 后 })
      新选区.push({ anchor: 选区.from + 前.length, head: 选区.from + 前.length })
      continue
    }

    const 原文 = 状态.sliceDoc(选区.from, 选区.to)
    const 外前 = 状态.sliceDoc(Math.max(0, 选区.from - 前.length), 选区.from)
    const 外后 = 状态.sliceDoc(选区.to, Math.min(状态.doc.length, 选区.to + 后.length))

    if (外前 === 前 && 外后 === 后) {
      // 标记在选区外侧：连同标记一起替换掉
      变更.push({
        from: 选区.from - 前.length,
        to: 选区.to + 后.length,
        insert: 原文
      })
      新选区.push({ anchor: 选区.from - 前.length, head: 选区.to - 前.length })
    } else if (
      原文.length > 前.length + 后.length &&
      原文.startsWith(前) &&
      原文.endsWith(后)
    ) {
      // 标记在选区内侧
      const 内容 = 原文.slice(前.length, 原文.length - 后.length)
      变更.push({ from: 选区.from, to: 选区.to, insert: 内容 })
      新选区.push({ anchor: 选区.from, head: 选区.from + 内容.length })
    } else {
      变更.push({ from: 选区.from, to: 选区.to, insert: 前 + 原文 + 后 })
      新选区.push({ anchor: 选区.from + 前.length, head: 选区.to + 前.length })
    }
  }

  if (变更.length === 0) return false
  新选区.sort((甲, 乙) => 甲.anchor - 乙.anchor)
  view.dispatch({
    changes: 变更,
    selection: EditorSelection.create(
      新选区.map((区) => EditorSelection.range(区.anchor, 区.head))
    ),
    userEvent: 'input.inlineFormat',
    annotations: 独立撤销
  })
  return true
}

/** 插入或编辑链接：选中文字时包裹为 `[文字](地址)` 并选中地址占位。 */
export function 插入链接(view: EditorView): boolean {
  const 状态 = view.state
  const 主 = 状态.selection.main
  const 文字 = 主.empty ? '' : 状态.sliceDoc(主.from, 主.to)
  const 内容 = `[${文字}](地址)`
  const 地址起 = 主.from + 1 + 文字.length + 2
  view.dispatch({
    changes: { from: 主.from, to: 主.to, insert: 内容 },
    selection: EditorSelection.range(地址起, 地址起 + 2),
    userEvent: 'input.insertLink',
    annotations: 独立撤销
  })
  return true
}

/** 行内标记的集合，供"清除格式"使用。 */
const 可清除标记 = [
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
export function 清除格式(view: EditorView): boolean {
  const 状态 = view.state
  const 变更: ChangeSpec[] = []

  for (const 选区 of 状态.selection.ranges) {
    if (选区.empty) continue
    const 原文 = 状态.sliceDoc(选区.from, 选区.to)
    let 文本 = 原文

    // 用 split/join 做字面量剥离：标记里含 `*` `[` `\` 等正则元字符，
    // 走正则反而要逐个转义，容易出错。
    for (const [前, 后] of 可清除标记) {
      文本 = 文本.split(前).join('').split(后).join('')
    }
    // 链接保留可见文字，丢弃地址。
    文本 = 文本.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

    if (文本 !== 原文) {
      变更.push({ from: 选区.from, to: 选区.to, insert: 文本 })
    }
  }

  if (变更.length === 0) return false
  view.dispatch({ changes: 变更, userEvent: 'input.clearFormat', annotations: 独立撤销 })
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
export function 跳出代码块(view: EditorView): boolean {
  const 状态 = view.state
  const 光标 = 状态.selection.main

  // 找包含光标的最内层围栏。`resolveInner` 给的是最深的节点，
  // 沿 parent 往上找，第一个 FencedCode 就是它。
  let 围栏: 语法节点 | null = null
  let 节点: 语法节点 | null = syntaxTree(状态).resolveInner(光标.head, -1) as unknown as 语法节点
  while (节点) {
    if (节点.name === 'FencedCode') {
      围栏 = 节点
      break
    }
    节点 = 节点.parent
  }
  if (!围栏) return false

  const 末行 = 状态.doc.lineAt(围栏.to)

  // 围栏已经是最后一行：补一个空行再落上去。
  // 不补的话光标无处可去，用户会觉得"退不出去"——那比原来更糟。
  if (末行.number >= 状态.doc.lines) {
    const 末尾 = 状态.doc.length
    view.dispatch({
      changes: { from: 末尾, insert: '\n' },
      selection: { anchor: 末尾 + 1 },
      scrollIntoView: true,
      userEvent: 'select'
    })
    return true
  }

  const 下一行 = 状态.doc.line(末行.number + 1)
  view.dispatch({
    selection: { anchor: 下一行.from },
    scrollIntoView: true,
    userEvent: 'select'
  })
  return true
}
