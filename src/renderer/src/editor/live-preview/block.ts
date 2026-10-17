import type { EditorState } from '@codemirror/state'
import { 扫描行内公式 } from '@shared/数学'
import { 扫描渲染标点 } from '../smart-punctuation'
import {
  块级行样式,
  代码块行装饰,
  标题行装饰,
  隐藏,
  插入,
  替换为,
  渲染标点装饰
} from './decorations'
import type { 构建上下文, SyntaxNode } from './types'
import { 加行装饰, 行内公式已启用, 渲染标点已启用 } from './types'
import {
  列表圆点,
  水平线,
  数学公式,
  表格分隔,
  任务框,
  语言标签,
  代码块头部,
  提示标签,
  计算层级
} from './widgets'
import { 内置字体, infoRoundTrips, 解析围栏首行 } from '@shared/代码块信息'

/**
 * 块级装饰。
 *
 * 分两步：
 *   1. **手工扫描**——YAML 前置元数据与 `$$` 数学块在 Lezer 语法树里
 *      *没有任何节点*（已用 scripts/dump-tree.mjs 证实：首尾 `---` 被解析成
 *      HorizontalRule，元数据正文被解析成普通段落）。所以这两类只能按行扫描。
 *   2. **语法树遍历**——其余块级语法都有真实节点，按节点名分派。
 *
 * 手工扫描先跑，它占用的行会被记进 `行装饰已用`，语法树阶段自然跳过，
 * 于是前置元数据不会被误画成水平线。
 */

// ---------------------------------------------------------------------------
// 手工扫描：前置元数据
// ---------------------------------------------------------------------------

interface 手工块 {
  from: number
  to: number
  /** 该块覆盖的行号（0 基下标存进数组，便于二分判断）。 */
  行号集合: Set<number>
}

/** 首行 `---` 开头、后续某行 `---` 或 `...` 收尾，即视为 YAML 前置元数据。 */
function 检测前置元数据(state: EditorState): 手工块 | null {
  if (state.doc.lines < 2) return null
  const firstLine = state.doc.line(1)
  if (firstLine.text.trim() !== '---') return null

  for (let no = 2; no <= state.doc.lines; no++) {
    const line = state.doc.line(no)
    const docText = line.text.trim()
    if (docText === '---' || docText === '...') {
      const 行号集合 = new Set<number>()
      for (let n = 1; n <= no; n++) 行号集合.add(n)
      return { from: firstLine.from, to: line.to, 行号集合 }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 手工扫描：数学块
// ---------------------------------------------------------------------------

/**
 * 收集段落里行内代码的区间。
 *
 * 渲染时转换必须跳过这些区间：`代码里的 " 引号 " 与 -- 是内容本身`，
 * 替换成弯引号会让人以为文档里存的就是排版字符。
 */
function 收集行内代码区间(node: SyntaxNode): { from: number; to: number }[] {
  const result: { from: number; to: number }[] = []
  let child = node.firstChild
  while (child) {
    if (child.name === 'InlineCode') result.push({ from: child.from, to: child.to })
    child = child.nextSibling
  }
  return result
}

/** `$$` 独占一行开始，到下一个含 `$$` 的行结束；`$$x$$` 单行闭合也算。 */
export function 检测数学块(state: EditorState): 手工块[] {
  const result: 手工块[] = []
  for (let no = 1; no <= state.doc.lines; no++) {
    const line = state.doc.line(no)
    const docText = line.text.trim()
    if (!docText.startsWith('$$')) continue
    // 单行闭合：形如 `$$E=mc^2$$`（长度必须大于 4，以排除 `$$` 本身）。
    if (docText.length > 4 && docText.endsWith('$$')) {
      result.push({ from: line.from, to: line.to, 行号集合: new Set([no]) })
      continue
    }
    for (let 终号 = no + 1; 终号 <= state.doc.lines; 终号++) {
      const 终行 = state.doc.line(终号)
      if (!终行.text.trim().endsWith('$$')) continue
      const 行号集合 = new Set<number>()
      for (let n = no; n <= 终号; n++) 行号集合.add(n)
      result.push({ from: line.from, to: 终行.to, 行号集合 })
      no = 终号
      break
    }
  }
  return result
}

function 落在手工块内(position: number, 手工块列表: 手工块[]): boolean {
  for (const block of 手工块列表) {
    if (position >= block.from && position <= block.to) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 块级入口
// ---------------------------------------------------------------------------

export interface 手工扫描结果 {
  frontMatter: 手工块 | null
  数学块: 手工块[]
  全部块: 手工块[]
}

/** 第一遍：处理语法树里不存在的两类块，并把它们占用的行登记好。 */
export function 扫描手工块(state: EditorState, context: 构建上下文): 手工扫描结果 {
  const frontMatter = 检测前置元数据(state)
  const 数学块 = 检测数学块(state)

  const 全部块: 手工块[] = []
  if (frontMatter) 全部块.push(frontMatter)
  全部块.push(...数学块)

  for (const no of frontMatter?.行号集合 ?? []) {
    加行装饰(context, state.doc.line(no).from, 块级行样式.frontMatter)
  }
  for (const block of 数学块) {
    for (const no of block.行号集合) {
      加行装饰(context, state.doc.line(no).from, 块级行样式.数学块)
    }
    // 块级公式的**替换**装饰不在这里加。
    //
    // CodeMirror 禁止插件提供块级装饰（"Block decorations may not be
    // specified via plugins"），而跨行的替换必须带 `block: true`。
    // 所以那部分挪到了 `live-preview/数学字段.ts` 的 StateField 里——
    // StateField 才能提供块级装饰。
    //
    // 这里保留行装饰：它对插件是合法的，且与替换装饰互不冲突。
  }

  return { frontMatter, 数学块, 全部块 }
}

/** 第二遍：按语法树节点名分派块级装饰。返回是否已处理该节点。 */
export function 处理块级(
  node: SyntaxNode,
  state: EditorState,
  context: 构建上下文,
  手工: 手工扫描结果
): boolean {
  // 落在手工块内部的节点交给手工扫描处理（主要是别把 `---` 画成水平线）。
  if (落在手工块内(node.from, 手工.全部块)) return true

  const lineNo = state.doc.lineAt(node.from).number
  const 在活动行 = context.活动行.has(lineNo)

  switch (node.name) {
    // ---------------------------------------------------------- 段落 ----
    case 'Paragraph': {
      // 行内公式的扫描挂在这里，而不是像块级那样做全文档手工扫描：
      // 段落是语法树里唯一承载普通文本的块级节点，从这里扫天然排除了
      // 代码块、围栏、表格单元格里的 `$`——那些地方不该出现公式。
      const cursor = state.selection.main
      const 段落起 = node.from
      const originalText = state.sliceDoc(node.from, node.to)
      if (originalText.includes('$')) {
        for (const range of 扫描行内公式(originalText, 段落起, 行内公式已启用())) {
          // 光标落在公式内部时露出源码，方便修改
          if (cursor.from >= range.from && cursor.to <= range.to + 1) continue
          context.entry.push({
            from: range.from,
            to: range.to + 1, // 含结尾的 `$`
            deco: 替换为(new 数学公式(range.formula, false)),
            rank: 2
          })
        }
      }

      // 渲染时转换：把直引号、连字符、省略号在屏幕上显示成排版字符。
      //
      // 只在**非活动行**生效——正在编辑的那一行必须显示真正的字符，
      // 否则用户敲下 `"` 却看到 `“`，会以为文档里存的就是弯引号。
      // 这与行内标记"活动行露出源码"是同一条规则。
      if (渲染标点已启用() && !在活动行) {
        const 代码区间 = 收集行内代码区间(node)
        for (const segment of 扫描渲染标点(originalText, 段落起)) {
          // 行内代码里的引号与连字符是内容，不能替换
          if (代码区间.some((sel) => segment.from >= sel.from && segment.to <= sel.to)) continue
          context.entry.push({
            from: segment.from,
            to: segment.to,
            deco: 渲染标点装饰(segment.显示),
            rank: 0
          })
        }
      }
      return true
    }

    // ------------------------------------------------------------- 标题 --
    case 'ATXHeading1':
    case 'ATXHeading2':
    case 'ATXHeading3':
    case 'ATXHeading4':
    case 'ATXHeading5':
    case 'ATXHeading6': {
      const 级 = Number(node.name.slice(-1))
      加行装饰(context, state.doc.lineAt(node.from).from, 标题行装饰(级))
      return false // 继续下沉，让 HeaderMark 被行内逻辑折叠
    }

    case 'SetextHeading1':
    case 'SetextHeading2': {
      const 级 = Number(node.name.slice(-1))
      加行装饰(context, state.doc.lineAt(node.from).from, 标题行装饰(级))
      return false
    }

    case 'HeaderMark': {
      const 父名 = node.parent?.name ?? ''
      if (父名.startsWith('ATXHeading') || 父名.startsWith('SetextHeading')) {
        if (!在活动行) {
          context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
        }
        return true
      }
      return false
    }

    // ------------------------------------------------------------- 引用 --
    case 'Blockquote': {
      // 引用块可能跨多行，逐行加左边框样式。
      const firstLine = state.doc.lineAt(node.from)
      const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1))

      // --- 提示框 ---------------------------------------------------------
      //
      // 语法用 GitHub 的 `> [!NOTE]`，不是自创的。粘到 GitHub、Obsidian 上
      // 都能正常显示成提示框；自创语法的话，文件一离开这个程序就退化成一堆
      // 看不懂的符号。这一个理由就够定下来了。
      const mark = /^\s*>\s*\[!(NOTE|TIP|提示)\]\s*$/i.test(state.sliceDoc(firstLine.from, firstLine.to))

      // 行装饰**一行只能有一条**（`加行装饰` 会把重复的挡掉），
      // 所以提示框与普通引用是在这里二选一，不能先加引言再加提示框。
      for (let n = firstLine.number; n <= lastLine.number; n++) {
        加行装饰(context, state.doc.line(n).from, mark ? 块级行样式.callout : 块级行样式.引言)
      }

      // 首行的标记换成一个小标签；光标停在这一行时露源码，方便改回普通引用
      if (mark && !context.活动行.has(firstLine.number)) {
        context.entry.push({
          from: firstLine.from,
          to: firstLine.to,
          deco: 替换为(new 提示标签()),
          rank: 2
        })
      }
      return false
    }

    case 'QuoteMark': {
      // 引用符 `>` **永远不显示**。
      //
      // 这是一条明确的取舍：用户不希望引用块 / 提示框里出现它的源码标记，
      // 任何情况下都不要。所以这里不再看光标位置、也不再看行里有没有内容。
      //
      // 藏干净之后有两个问题，各有解法，都在别处：
      //
      //   · 空行会不会变成一片空白？
      //     不会。块的外壳（左边框 + 底色）仍在，那一行渲染出来是一条
      //     带框的空行——看得见、点得进去、写得了字。
      //     **边界靠样式表达，不靠字符。**
      //
      //   · 那怎么把它变回普通段落？
      //     退格。CodeMirror 的 `deleteMarkupBackward` 认得引用上下文，
      //     光标在行首按退格会整行去掉 `>`；文档里的字符一直都在，
      //     装饰只是不画出来，所以这个命令照常有效。
      context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
      // **标记后面的空格也一起吃掉。**
      // 只藏 `>` 的话，行首会剩下一个空格，整段文字比正文缩进一格——
      // 肉眼看上去仍然"像还留着标记"。要干净就干净到底。
      {
        const line = state.doc.lineAt(node.from)
        const blank = /^[ \t]*/.exec(state.sliceDoc(node.to, line.to))?.[0] ?? ''
        if (blank.length > 0) {
          context.entry.push({
            from: node.to,
            to: node.to + blank.length,
            deco: 隐藏,
            rank: 1
          })
        }
      }
      return true
    }

    // ------------------------------------------------------------- 列表 --
    case 'ListMark': {
      const grandparent = node.parent?.parent?.name
      if (grandparent === 'BulletList') {
        // 无序列表：把 `-` 换成圆点。活动行保留原字符，方便看清语法。
        if (!在活动行) {
          context.entry.push({
            from: node.from,
            to: node.to,
            deco: 替换为(new 列表圆点(计算层级(state, node.from))),
            rank: 1
          })
        }
      }
      return true
    }

    // --------------------------------------------------------- 代码围栏 --
    case 'FencedCode': {
      const firstLine = state.doc.lineAt(node.from)
      const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1))
      // 配色与字体都取自该块自己的信息串（`style=dark font=consolas` 之类），
      // 不是全局设置——同一篇文档里不同代码块用不同外观是合理需求
      const blockInfo = 解析围栏首行(state.sliceDoc(firstLine.from, firstLine.to))
      const fontStack = 内置字体.find((item) => item.value === blockInfo.font)?.family ?? ''
      // 行号只编正文行：首尾围栏不是代码，给它们编号会让人以为
      // "第 1 行"是反引号那一行
      let bodyIndex = 0
      for (let n = firstLine.number; n <= lastLine.number; n++) {
        const isBody = n !== firstLine.number && n !== lastLine.number
        if (isBody) bodyIndex++
        加行装饰(
          context,
          state.doc.line(n).from,
          代码块行装饰(
            blockInfo.style,
            n === firstLine.number ? '首' : n === lastLine.number ? '末' : '中',
            isBody ? bodyIndex : null,
            fontStack
          )
        )
      }

      // --- 首行换成代码块头部栏 -------------------------------------------
      //
      // **始终替换**，不再看光标在哪一行。原先的规则是"光标停在首行时露源码"，
      // 但那样一来光标一进这个块，头部栏就消失、变成一行裸反引号，
      // 块就"散"了——用户要的是**从头到尾一个整体**。
      // 改语言本来就有下拉，不需要去改那串文本。
      //
      // 唯一的例外是**信息串不能原样还原**的时候（比如手写的
      // ```` ```{.python .numberLines} ````）。这种块照旧露源码：
      // 用下拉去改它会把认不出的部分吃掉，那是**静默改坏用户的文档**。
      const rawInfo = state.sliceDoc(firstLine.from, firstLine.to)
      if (infoRoundTrips(rawInfo, blockInfo)) {
        const info = blockInfo
        context.entry.push({
          from: firstLine.from,
          to: firstLine.to,
          deco: 替换为(
            new 代码块头部(info, {
              fenceStart: node.from,
              fenceEnd: node.to,
              firstLineStart: firstLine.from
            })
          ),
          rank: 3
        })
        // 记下来，让下面处理 ``` 与语言标识时跳过——同一段文本不能被两条
        // 替换装饰覆盖，CodeMirror 会因区间重叠拒绝整份装饰。
        context.已换头部栏.add(firstLine.from)
      }

      return false
    }

    case 'CodeMark': {
      // 只有围栏代码块的两个 ``` 需要折叠；行内代码的反引号在 inline.ts 处理。
      //
      // **判断依据是"光标是否在**这一行**"，而不是"是否在整段围栏内"。**
      //
      // 这里绕过一次弯，值得写下来：用"在整段围栏内"当条件时，光标只要还在
      // 代码块里，闭合的 ``` 就一直显示——块里于是**凭空多出一行 ```**，
      // 看着像块没闭合。用户明确要求块内不要出现这行字符。
      //
      // 那"边界看不见、以为出去了其实还在块里"怎么办？靠**边框**而不是靠字符：
      // 代码块有左侧色带和上下边框，闭合围栏那行就是块的下沿。
      //
      // 后来这条又收紧了一次：用户要求**任何情况下都别看到 ```**。
      // 所以这里不再看光标在哪一行，一律折叠。要跳出块用 Esc
      // （`跳出代码块` 会把光标送到围栏之后），要删块用编辑器右键菜单。
      const parent = node.parent
      if (parent?.name !== 'FencedCode') return true
      // 首行整行已经是头部栏了，这里的 ``` 不能再推一条重叠的替换装饰
      if (context.已换头部栏.has(state.doc.lineAt(node.from).from)) return true
      context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
      return true
    }

    case 'CodeInfo': {
      // 语言标识由头部栏里的下拉呈现，这里折叠掉。可见性规则同上。
      const parent = node.parent
      if (parent?.name !== 'FencedCode') return true
      if (context.已换头部栏.has(state.doc.lineAt(node.from).from)) return true
      if (!context.活动行.has(state.doc.lineAt(node.from).number)) {
        context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
      }
      return true
    }

    case 'CodeText': {
      // 语言标签挂在围栏首行的行尾。
      //
      // **首行一旦换成头部栏就必须跳过**：头部栏是整行替换，而这条装饰
      // 恰好落在被替换区间的末端，两条装饰重叠会让 CodeMirror 拒绝整份装饰。
      // 语言此时已经在下拉里显示，不再需要行尾的标签。
      const parent = node.parent
      if (!parent) return true
      if (context.已换头部栏.has(state.doc.lineAt(parent.from).from)) return true

      const 语言节点 = 找子节点(parent, 'CodeInfo')
      const language = 语言节点 ? state.sliceDoc(语言节点.from, 语言节点.to).trim() : ''
      const lineEnd = state.doc.lineAt(parent.from).to
      context.entry.push({
        from: lineEnd,
        to: lineEnd,
        deco: 插入(new 语言标签(language || '文本'), 1),
        rank: 2
      })
      return true
    }

    // --------------------------------------------------------- 水平线 ----
    case 'HorizontalRule': {
      const line = state.doc.lineAt(node.from)
      加行装饰(context, line.from, 块级行样式.水平线行)
      if (!在活动行) {
        context.entry.push({
          from: node.from,
          to: node.to,
          deco: 替换为(new 水平线()),
          rank: 1
        })
      }
      return true
    }

    // ----------------------------------------------------------- 表格 ----
    case 'TableHeader': {
      加行装饰(context, state.doc.lineAt(node.from).from, 块级行样式.表头行)
      return false
    }

    case 'TableRow': {
      加行装饰(context, state.doc.lineAt(node.from).from, 块级行样式.table)
      return false
    }

    case 'TableDelimiter': {
      const 父名 = node.parent?.name
      if (父名 === 'Table') {
        // 对齐定义行（`| :--- | :--: |`）整行折叠，只留一条分隔视觉。
        加行装饰(context, state.doc.lineAt(node.from).from, 块级行样式.表格分隔行)
        if (!在活动行) {
          context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
        }
      } else {
        // 单元格之间的 `|`，淡化成视觉分隔而不是删除，方便判断列边界。
        if (!在活动行) {
          context.entry.push({
            from: node.from,
            to: node.to,
            deco: 替换为(new 表格分隔('│')),
            rank: 1
          })
        }
      }
      return true
    }

    // ------------------------------------------------------- 任务列表 ----
    case 'TaskMarker': {
      if (node.parent?.name !== 'Task') return false
      // 整行挂 `md-task-list-item`：这是通用的类名，
      // 挂上之后针对它写的规则（缩进、行高、完成态淡化）可直接生效。
      加行装饰(context, state.doc.lineAt(node.from).from, 块级行样式.任务项行)
      const originalText = state.sliceDoc(node.from, node.to)
      const 已勾选 = /\[[xX]\]/.test(originalText)
      // 复选框始终替换，即使光标在本行——否则勾选后光标会把标记"撑开"。
      context.entry.push({
        from: node.from,
        to: node.to,
        deco: 替换为(new 任务框(已勾选, node.from)),
        rank: 1
      })
      return true
    }

    // ------------------------------------------------------- HTML 块 ----
    case 'HTMLBlock': {
      const firstLine = state.doc.lineAt(node.from)
      const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1))
      for (let n = firstLine.number; n <= lastLine.number; n++) {
        加行装饰(context, state.doc.line(n).from, 块级行样式.HTML块)
      }
      return true
    }

    default:
      return false
  }
}

/** 在直接子节点中按名字查找。 */
function 找子节点(parent: SyntaxNode, 名字: string): SyntaxNode | null {
  const 带子节点 = parent as SyntaxNode & { firstChild?: SyntaxNode | null; nextSibling?: SyntaxNode | null }
  let current = 带子节点.firstChild ?? null
  while (current) {
    if (current.name === 名字) return current
    current = (current as SyntaxNode & { nextSibling?: SyntaxNode | null }).nextSibling ?? null
  }
  return null
}

/** 导出给插件用。 */
export type { 手工块 }
