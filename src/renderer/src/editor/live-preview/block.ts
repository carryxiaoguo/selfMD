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
import type { 构建上下文, 语法节点 } from './types'
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
import { 内置字体, 信息串可还原, 解析围栏首行 } from '@shared/代码块信息'

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
function 检测前置元数据(状态: EditorState): 手工块 | null {
  if (状态.doc.lines < 2) return null
  const 首行 = 状态.doc.line(1)
  if (首行.text.trim() !== '---') return null

  for (let 号 = 2; 号 <= 状态.doc.lines; 号++) {
    const 行 = 状态.doc.line(号)
    const 文本 = 行.text.trim()
    if (文本 === '---' || 文本 === '...') {
      const 行号集合 = new Set<number>()
      for (let n = 1; n <= 号; n++) 行号集合.add(n)
      return { from: 首行.from, to: 行.to, 行号集合 }
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
function 收集行内代码区间(节点: 语法节点): { from: number; to: number }[] {
  const 结果: { from: number; to: number }[] = []
  let 子 = 节点.firstChild
  while (子) {
    if (子.name === 'InlineCode') 结果.push({ from: 子.from, to: 子.to })
    子 = 子.nextSibling
  }
  return 结果
}

/** `$$` 独占一行开始，到下一个含 `$$` 的行结束；`$$x$$` 单行闭合也算。 */
export function 检测数学块(状态: EditorState): 手工块[] {
  const 结果: 手工块[] = []
  for (let 号 = 1; 号 <= 状态.doc.lines; 号++) {
    const 行 = 状态.doc.line(号)
    const 文本 = 行.text.trim()
    if (!文本.startsWith('$$')) continue
    // 单行闭合：形如 `$$E=mc^2$$`（长度必须大于 4，以排除 `$$` 本身）。
    if (文本.length > 4 && 文本.endsWith('$$')) {
      结果.push({ from: 行.from, to: 行.to, 行号集合: new Set([号]) })
      continue
    }
    for (let 终号 = 号 + 1; 终号 <= 状态.doc.lines; 终号++) {
      const 终行 = 状态.doc.line(终号)
      if (!终行.text.trim().endsWith('$$')) continue
      const 行号集合 = new Set<number>()
      for (let n = 号; n <= 终号; n++) 行号集合.add(n)
      结果.push({ from: 行.from, to: 终行.to, 行号集合 })
      号 = 终号
      break
    }
  }
  return 结果
}

function 落在手工块内(位置: number, 手工块列表: 手工块[]): boolean {
  for (const 块 of 手工块列表) {
    if (位置 >= 块.from && 位置 <= 块.to) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 块级入口
// ---------------------------------------------------------------------------

export interface 手工扫描结果 {
  前置元数据: 手工块 | null
  数学块: 手工块[]
  全部块: 手工块[]
}

/** 第一遍：处理语法树里不存在的两类块，并把它们占用的行登记好。 */
export function 扫描手工块(状态: EditorState, 上下文: 构建上下文): 手工扫描结果 {
  const 前置元数据 = 检测前置元数据(状态)
  const 数学块 = 检测数学块(状态)

  const 全部块: 手工块[] = []
  if (前置元数据) 全部块.push(前置元数据)
  全部块.push(...数学块)

  for (const 号 of 前置元数据?.行号集合 ?? []) {
    加行装饰(上下文, 状态.doc.line(号).from, 块级行样式.前置元数据)
  }
  for (const 块 of 数学块) {
    for (const 号 of 块.行号集合) {
      加行装饰(上下文, 状态.doc.line(号).from, 块级行样式.数学块)
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

  return { 前置元数据, 数学块, 全部块 }
}

/** 第二遍：按语法树节点名分派块级装饰。返回是否已处理该节点。 */
export function 处理块级(
  节点: 语法节点,
  状态: EditorState,
  上下文: 构建上下文,
  手工: 手工扫描结果
): boolean {
  // 落在手工块内部的节点交给手工扫描处理（主要是别把 `---` 画成水平线）。
  if (落在手工块内(节点.from, 手工.全部块)) return true

  const 行号 = 状态.doc.lineAt(节点.from).number
  const 在活动行 = 上下文.活动行.has(行号)

  switch (节点.name) {
    // ---------------------------------------------------------- 段落 ----
    case 'Paragraph': {
      // 行内公式的扫描挂在这里，而不是像块级那样做全文档手工扫描：
      // 段落是语法树里唯一承载普通文本的块级节点，从这里扫天然排除了
      // 代码块、围栏、表格单元格里的 `$`——那些地方不该出现公式。
      const 光标 = 状态.selection.main
      const 段落起 = 节点.from
      const 原文 = 状态.sliceDoc(节点.from, 节点.to)
      if (原文.includes('$')) {
        for (const 区间 of 扫描行内公式(原文, 段落起, 行内公式已启用())) {
          // 光标落在公式内部时露出源码，方便修改
          if (光标.from >= 区间.from && 光标.to <= 区间.to + 1) continue
          上下文.条目.push({
            from: 区间.from,
            to: 区间.to + 1, // 含结尾的 `$`
            deco: 替换为(new 数学公式(区间.公式, false)),
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
        const 代码区间 = 收集行内代码区间(节点)
        for (const 段 of 扫描渲染标点(原文, 段落起)) {
          // 行内代码里的引号与连字符是内容，不能替换
          if (代码区间.some((区) => 段.from >= 区.from && 段.to <= 区.to)) continue
          上下文.条目.push({
            from: 段.from,
            to: 段.to,
            deco: 渲染标点装饰(段.显示),
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
      const 级 = Number(节点.name.slice(-1))
      加行装饰(上下文, 状态.doc.lineAt(节点.from).from, 标题行装饰(级))
      return false // 继续下沉，让 HeaderMark 被行内逻辑折叠
    }

    case 'SetextHeading1':
    case 'SetextHeading2': {
      const 级 = Number(节点.name.slice(-1))
      加行装饰(上下文, 状态.doc.lineAt(节点.from).from, 标题行装饰(级))
      return false
    }

    case 'HeaderMark': {
      const 父名 = 节点.parent?.name ?? ''
      if (父名.startsWith('ATXHeading') || 父名.startsWith('SetextHeading')) {
        if (!在活动行) {
          上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
        }
        return true
      }
      return false
    }

    // ------------------------------------------------------------- 引用 --
    case 'Blockquote': {
      // 引用块可能跨多行，逐行加左边框样式。
      const 首行 = 状态.doc.lineAt(节点.from)
      const 末行 = 状态.doc.lineAt(Math.max(节点.from, 节点.to - 1))

      // --- 提示框 ---------------------------------------------------------
      //
      // 语法用 GitHub 的 `> [!NOTE]`，不是自创的。粘到 GitHub、Obsidian 上
      // 都能正常显示成提示框；自创语法的话，文件一离开这个程序就退化成一堆
      // 看不懂的符号。这一个理由就够定下来了。
      const 标记 = /^\s*>\s*\[!(NOTE|TIP|提示)\]\s*$/i.test(状态.sliceDoc(首行.from, 首行.to))

      // 行装饰**一行只能有一条**（`加行装饰` 会把重复的挡掉），
      // 所以提示框与普通引用是在这里二选一，不能先加引言再加提示框。
      for (let n = 首行.number; n <= 末行.number; n++) {
        加行装饰(上下文, 状态.doc.line(n).from, 标记 ? 块级行样式.提示框 : 块级行样式.引言)
      }

      // 首行的标记换成一个小标签；光标停在这一行时露源码，方便改回普通引用
      if (标记 && !上下文.活动行.has(首行.number)) {
        上下文.条目.push({
          from: 首行.from,
          to: 首行.to,
          deco: 替换为(new 提示标签()),
          rank: 2
        })
      }
      return false
    }

    case 'QuoteMark': {
      if (!在活动行) {
        上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
      }
      return true
    }

    // ------------------------------------------------------------- 列表 --
    case 'ListMark': {
      const 祖父 = 节点.parent?.parent?.name
      if (祖父 === 'BulletList') {
        // 无序列表：把 `-` 换成圆点。活动行保留原字符，方便看清语法。
        if (!在活动行) {
          上下文.条目.push({
            from: 节点.from,
            to: 节点.to,
            deco: 替换为(new 列表圆点(计算层级(状态, 节点.from))),
            rank: 1
          })
        }
      }
      return true
    }

    // --------------------------------------------------------- 代码围栏 --
    case 'FencedCode': {
      const 首行 = 状态.doc.lineAt(节点.from)
      const 末行 = 状态.doc.lineAt(Math.max(节点.from, 节点.to - 1))
      // 配色与字体都取自该块自己的信息串（`style=dark font=consolas` 之类），
      // 不是全局设置——同一篇文档里不同代码块用不同外观是合理需求
      const 本块信息 = 解析围栏首行(状态.sliceDoc(首行.from, 首行.to))
      const 字体栈 = 内置字体.find((项) => 项.值 === 本块信息.字体)?.族 ?? ''
      // 行号只编正文行：首尾围栏不是代码，给它们编号会让人以为
      // "第 1 行"是反引号那一行
      let 正文序号 = 0
      for (let n = 首行.number; n <= 末行.number; n++) {
        const 是正文 = n !== 首行.number && n !== 末行.number
        if (是正文) 正文序号++
        加行装饰(
          上下文,
          状态.doc.line(n).from,
          代码块行装饰(
            本块信息.样式,
            n === 首行.number ? '首' : n === 末行.number ? '末' : '中',
            是正文 ? 正文序号 : null,
            字体栈
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
      const 原始信息 = 状态.sliceDoc(首行.from, 首行.to)
      if (信息串可还原(原始信息, 本块信息)) {
        const 信息 = 本块信息
        上下文.条目.push({
          from: 首行.from,
          to: 首行.to,
          deco: 替换为(
            new 代码块头部(信息, {
              围栏起: 节点.from,
              围栏终: 节点.to,
              首行起: 首行.from
            })
          ),
          rank: 3
        })
        // 记下来，让下面处理 ``` 与语言标识时跳过——同一段文本不能被两条
        // 替换装饰覆盖，CodeMirror 会因区间重叠拒绝整份装饰。
        上下文.已换头部栏.add(首行.from)
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
      // 光标真的落到这一行时，这里的源码会露出来，用户立刻知道自己站在哪。
      const 父 = 节点.parent
      if (父?.name !== 'FencedCode') return true
      // 首行整行已经是头部栏了，这里的 ``` 不能再推一条重叠的替换装饰
      if (上下文.已换头部栏.has(状态.doc.lineAt(节点.from).from)) return true
      if (!上下文.活动行.has(状态.doc.lineAt(节点.from).number)) {
        上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
      }
      return true
    }

    case 'CodeInfo': {
      // 语言标识由头部栏里的下拉呈现，这里折叠掉。可见性规则同上。
      const 父 = 节点.parent
      if (父?.name !== 'FencedCode') return true
      if (上下文.已换头部栏.has(状态.doc.lineAt(节点.from).from)) return true
      if (!上下文.活动行.has(状态.doc.lineAt(节点.from).number)) {
        上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
      }
      return true
    }

    case 'CodeText': {
      // 语言标签挂在围栏首行的行尾。
      //
      // **首行一旦换成头部栏就必须跳过**：头部栏是整行替换，而这条装饰
      // 恰好落在被替换区间的末端，两条装饰重叠会让 CodeMirror 拒绝整份装饰。
      // 语言此时已经在下拉里显示，不再需要行尾的标签。
      const 父 = 节点.parent
      if (!父) return true
      if (上下文.已换头部栏.has(状态.doc.lineAt(父.from).from)) return true

      const 语言节点 = 找子节点(父, 'CodeInfo')
      const 语言 = 语言节点 ? 状态.sliceDoc(语言节点.from, 语言节点.to).trim() : ''
      const 行尾 = 状态.doc.lineAt(父.from).to
      上下文.条目.push({
        from: 行尾,
        to: 行尾,
        deco: 插入(new 语言标签(语言 || '文本'), 1),
        rank: 2
      })
      return true
    }

    // --------------------------------------------------------- 水平线 ----
    case 'HorizontalRule': {
      const 行 = 状态.doc.lineAt(节点.from)
      加行装饰(上下文, 行.from, 块级行样式.水平线行)
      if (!在活动行) {
        上下文.条目.push({
          from: 节点.from,
          to: 节点.to,
          deco: 替换为(new 水平线()),
          rank: 1
        })
      }
      return true
    }

    // ----------------------------------------------------------- 表格 ----
    case 'TableHeader': {
      加行装饰(上下文, 状态.doc.lineAt(节点.from).from, 块级行样式.表头行)
      return false
    }

    case 'TableRow': {
      加行装饰(上下文, 状态.doc.lineAt(节点.from).from, 块级行样式.表格)
      return false
    }

    case 'TableDelimiter': {
      const 父名 = 节点.parent?.name
      if (父名 === 'Table') {
        // 对齐定义行（`| :--- | :--: |`）整行折叠，只留一条分隔视觉。
        加行装饰(上下文, 状态.doc.lineAt(节点.from).from, 块级行样式.表格分隔行)
        if (!在活动行) {
          上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
        }
      } else {
        // 单元格之间的 `|`，淡化成视觉分隔而不是删除，方便判断列边界。
        if (!在活动行) {
          上下文.条目.push({
            from: 节点.from,
            to: 节点.to,
            deco: 替换为(new 表格分隔('│')),
            rank: 1
          })
        }
      }
      return true
    }

    // ------------------------------------------------------- 任务列表 ----
    case 'TaskMarker': {
      if (节点.parent?.name !== 'Task') return false
      // 整行挂 `md-task-list-item`：这是通用的类名，
      // 挂上之后针对它写的规则（缩进、行高、完成态淡化）可直接生效。
      加行装饰(上下文, 状态.doc.lineAt(节点.from).from, 块级行样式.任务项行)
      const 原文 = 状态.sliceDoc(节点.from, 节点.to)
      const 已勾选 = /\[[xX]\]/.test(原文)
      // 复选框始终替换，即使光标在本行——否则勾选后光标会把标记"撑开"。
      上下文.条目.push({
        from: 节点.from,
        to: 节点.to,
        deco: 替换为(new 任务框(已勾选, 节点.from)),
        rank: 1
      })
      return true
    }

    // ------------------------------------------------------- HTML 块 ----
    case 'HTMLBlock': {
      const 首行 = 状态.doc.lineAt(节点.from)
      const 末行 = 状态.doc.lineAt(Math.max(节点.from, 节点.to - 1))
      for (let n = 首行.number; n <= 末行.number; n++) {
        加行装饰(上下文, 状态.doc.line(n).from, 块级行样式.HTML块)
      }
      return true
    }

    default:
      return false
  }
}

/** 在直接子节点中按名字查找。 */
function 找子节点(父: 语法节点, 名字: string): 语法节点 | null {
  const 带子节点 = 父 as 语法节点 & { firstChild?: 语法节点 | null; nextSibling?: 语法节点 | null }
  let 当前 = 带子节点.firstChild ?? null
  while (当前) {
    if (当前.name === 名字) return 当前
    当前 = (当前 as 语法节点 & { nextSibling?: 语法节点 | null }).nextSibling ?? null
  }
  return null
}

/** 导出给插件用。 */
export type { 手工块 }
