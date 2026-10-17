import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Settings } from '@shared/types'
import type { SyntaxNode } from './syntax-node'

/**
 * 智能标点。
 *
 * 把直引号与连字符按排版惯例转换成弯引号与长短破折号：`"` → `“`/`”`、
 * `--` → `–`（连接号）、`---` → `—`（破折号）。这是中文与英文排版里
 * 长期被忽视但一眼能看出差别的一环。
 *
 * 设计要点：
 *
 * 1. **转换规则做成纯函数**（`换引号` / `换破折号`），只吃"光标前的文本"，
 *    不碰编辑器。这样它们可以在自测里被逐条断言，而不是只能靠肉眼敲键盘试。
 * 2. **代码上下文一律不转换**。在代码块里敲 `--` 就该是 `--`，被"美化"成
 *    `–` 会直接改变代码语义。用语法树判断，不靠正则猜。
 * 3. **行首连续连字符不转换**。`---` 在行首是水平分割线，也是 YAML 前置
 *    元数据的围栏；把它换成破折号会毁掉文档结构。
 */

// ---------------------------------------------------------------------------
// 上下文判断
// ---------------------------------------------------------------------------

/** 光标是否位于"字面文本"之外——代码块、行内代码、URL、注释里都不该做标点转换。 */
export function 在代码上下文(state: EditorState, position: number): boolean {
  // 显式标注可空：向上遍历父节点时类型必须允许 null 作为终点。
  let current: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1)
  for (; current; current = current.parent) {
    switch (current.name) {
      case 'FencedCode':
      case 'CodeBlock':
      case 'CodeText':
      case 'CodeInfo':
      case 'InlineCode':
      case 'URL':
      case 'Comment':
      case 'CommentBlock':
        return true
      default:
        break
    }
  }
  return false
}

/** 光标所在行、光标之前的文本。 */
export function 本行前文(state: EditorState, position: number): string {
  const line = state.doc.lineAt(position)
  return state.sliceDoc(line.from, position)
}

// ---------------------------------------------------------------------------
// 引号
// ---------------------------------------------------------------------------

/**
 * 引号之前出现这些字符，说明这是"开引号"。
 *
 * 除空白与 ASCII 括号外，**必须包含全角括号**：中文写作里 `（"引用"）`
 * 远比 `("引用")` 常见，漏掉 `（`【《「` 会让中文场景下的判断整体反过来。
 */
const 开引号前导 = /[\s([{<（【《「『〔〈“‘’”‘’—–-]/

/**
 * 把直引号换成弯引号。
 *
 * 判断依据只有一条：**左引号跟在空白或开括号之后，右引号跟在其他位置**。
 * 这正是排版软件的做法，也是唯一能在没有完整解析的前提下可靠判断的规则。
 *
 * @param 字符 用户刚敲下的字符，`"` 或 `'`
 * @param 前文 光标之前的本行文本
 */
export function 换引号(ch: '"' | "'", preamble: string): string {
  const previousOne = preamble.slice(-1)
  const 是开头 = preamble.length === 0 || 开引号前导.test(previousOne)

  if (ch === '"') {
    return 是开头 ? '“' : '”'
  }

  // 单引号多一种情况：跟在字母或数字后面时是撇号（don't、2020's），
  // 不是引号。中文里也普遍这么用，所以统一处理成右单引号。
  if (/[A-Za-z0-9\u4e00-\u9fff]/.test(previousOne)) return '’'
  return 是开头 ? '‘' : '’'
}

// ---------------------------------------------------------------------------
// 渲染时转换
// ---------------------------------------------------------------------------

export interface 渲染标点段 {
  from: number
  to: number
  /** 屏幕上显示的字符。 */
  show: string
  /** 文档里实际存的字符。 */
  originalText: string
}

/**
 * 扫描"渲染时转换"要替换的标点。
 *
 * 与输入时转换的区别是**不改文档**：文件里存的仍是 ASCII 引号与连字符，
 * 只在屏幕上显示成排版字符。适合"文件要保持纯 ASCII、但看着要舒服"的场合。
 *
 * 两套规则必须一致，所以引号判断直接复用 `换引号`——各写一份的话，
 * 同一段文字在两种模式下会得到不同方向的引号，而且极难发现。
 *
 * 扫描是**逐字符推进**而非逐个正则匹配：`---` 必须优先于 `--` 匹配，
 * 用正则轮流试会先命中 `--`，把破折号拆成"连接号 + 连字符"。
 */
export function scanPunct(docText: string, baseline: number): 渲染标点段[] {
  const result: 渲染标点段[] = []
  let i = 0

  while (i < docText.length) {
    const ch = docText[i]

    // --- 破折号：先试三连，再试两连 ---
    if (ch === '-') {
      if (docText.startsWith('---', i)) {
        result.push({ from: baseline + i, to: baseline + i + 3, show: '—', originalText: '---' })
        i += 3
        continue
      }
      if (docText.startsWith('--', i)) {
        result.push({ from: baseline + i, to: baseline + i + 2, show: '–', originalText: '--' })
        i += 2
        continue
      }
      i++
      continue
    }

    // --- 省略号 ---
    if (ch === '.' && docText.startsWith('...', i)) {
      result.push({ from: baseline + i, to: baseline + i + 3, show: '…', originalText: '...' })
      i += 3
      continue
    }

    // --- 引号 ---
    if (ch === '"' || ch === "'") {
      // 用扫描到当前位置为止的文本作为"前文"，与输入时的判断依据一致
      const show = 换引号(ch, docText.slice(0, i))
      if (show !== ch) {
        result.push({ from: baseline + i, to: baseline + i + 1, show, originalText: ch })
      }
      i++
      continue
    }

    i++
  }

  return result
}


export interface 破折号替换 {
  /** 需要回退删除的字符数。 */
  fallback: number
  /** 回退之后要插入的字符。 */
  insert: string
}

// ---------------------------------------------------------------------------
// 破折号
// ---------------------------------------------------------------------------

/**
 * 依照"光标前已有几个连字符"决定要不要换成破折号。
 *
 * 规则与 通行说明一致：`--` → `–`（连接号），`---` → `—`（破折号）。
 * 实现上采用**即时转换**，因此文档里永远不会真的出现两个以上的连续连字符：
 *
 *   敲第 1 个 `-`  → 原样插入       文档：`-`
 *   敲第 2 个 `-`  → 吞掉前一个，换成 `–`   文档：`–`
 *   敲第 3 个 `-`  → `–` 换成 `—`    文档：`—`
 *
 * 好处是完全无状态——只读文档里已有的字符，不需要记住"用户刚才连打了几个"。
 *
 * @returns 需要替换时给出方案，否则返回 null 表示按原样插入
 */
export function 换破折号(preamble: string): 破折号替换 | null {
  const previousOne = preamble.slice(-1)
  const 再前一个 = preamble.slice(-2, -1)

  // 已经转换出连接号，再敲一个连字符 → 升格为破折号。
  if (previousOne === '–') return { fallback: 1, insert: '—' }

  if (previousOne !== '-') return null
  // 文档里本来就存在的连续连字符不动它，避免把既有内容改坏。
  if (再前一个 === '-') return null

  // 行首（含仅缩进）的连字符属于**结构语法**而非标点：`---` 是水平分割线，
  // 也是 YAML 前置元数据的围栏，换成破折号会直接毁掉文档结构。
  //
  // 这里用"连字符之前还有没有正文"来判断，而不是"整行是不是只有连字符"——
  // 后者要预知用户接下来敲什么，做不到；前者只看已有内容，无状态且够用。
  // 代价是行首永远得不到连接号，这是刻意的取舍：结构正确优先于标点美观。
  const 之前 = preamble.slice(0, -1)
  if (之前.trim() === '') return null

  return { fallback: 1, insert: '–' }
}

// ---------------------------------------------------------------------------
// 扩展
// ---------------------------------------------------------------------------

export interface 智能标点选项 {
  /** 转换引号。 */
  quoteChar: boolean
  /** 转换破折号。 */
  破折号: boolean
}

/**
 * 智能标点输入处理器。
 *
 * 挂在 `EditorView.inputHandler` 上，只在用户**逐字键入**时触发；粘贴、
 * 程序化编辑、输入法提交多字符都不经过这里，因此不会破坏这些路径。
 */
export function 智能标点(options: 智能标点选项): Extension {
  if (!options.quoteChar && !options.破折号) return []

  return EditorView.inputHandler.of((view, fromSrc, toPos, input) => {
    // 只处理单字符键入。多字符意味着输入法或粘贴，不该插手。
    if (input.length !== 1) return false
    // 有选区时是"替换"，与标点转换无关。
    if (fromSrc !== toPos) return false

    const state = view.state
    if (在代码上下文(state, fromSrc)) return false
    const preamble = 本行前文(state, fromSrc)

    let plan: { fallback: number; insert: string } | null = null

    if (options.quoteChar && (input === '"' || input === "'")) {
      plan = { fallback: 0, insert: 换引号(input, preamble) }
    } else if (options.破折号 && input === '-') {
      plan = 换破折号(preamble)
    }

    if (!plan) return false

    // 转换结果与原字符相同就没必要接管，让默认行为处理，
    // 这样中文输入法的候选、自动补全等附加行为不受影响。
    if (plan.fallback === 0 && plan.insert === input) return false

    const fromPos = fromSrc - plan.fallback
    view.dispatch({
      changes: { from: fromPos, to: fromSrc, insert: plan.insert },
      selection: { anchor: fromPos + plan.insert.length },
      userEvent: 'input.type',
      scrollIntoView: true
    })
    return true
  })
}

/** 依据设置决定是否启用，以及转换哪些字符。 */
export function 按设置构建智能标点(settings: Settings): Extension {
  // '渲染时转换' 尚未实现，此时不做输入期转换——否则两种模式会同时生效。
  if (settings.smartPunctuationMode !== 'input') return []
  return 智能标点({ quoteChar: settings.smartQuotes, 破折号: settings.smartDashes })
}
