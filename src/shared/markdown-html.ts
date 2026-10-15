import { Autolink, Strikethrough, Table, TaskList, parser } from '@lezer/markdown'

/**
 * Markdown → HTML 渲染器。
 *
 * 直接遍历已有的 Lezer 语法树，而不是另引一个 Markdown 库。理由有两条：
 *
 *   1. **与实时预览同源**——编辑器里的装饰层也是走这棵树。用两个不同的解析器
 *      迟早会出现"屏幕上是一种、导出是另一种"的偏差，而且极难排查。
 *   2. **纯函数**——吃一段文本、吐一段 HTML，因此可以逐字符断言输出，
 *      不必真的导出一次再肉眼比对。
 *
 * 解析器配置与 `@codemirror/lang-markdown` 保持一致（GFM 的四项扩展），
 * 否则导出结果会与编辑时的理解不符：编辑器认得表格，导出却不认。
 */

// 与编辑器同配置：表格、任务列表、删除线、自动链接
const 解析器 = parser.configure([Table, TaskList, Strikethrough, Autolink])

export interface 渲染选项 {
  /** 代码块的语言类名前缀，默认 `language-`。 */
  语言类前缀?: string
}

/** HTML 文本转义。`&` 必须最先替换，否则会把后面生成的实体再转一次。 */
export function 转义HTML(文本: string): string {
  return 文本
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 属性值转义：除文本转义外还要处理引号。 */
function 转义属性(文本: string): string {
  return 转义HTML(文本).replace(/"/g, '&quot;')
}

/** 这些节点只是 Markdown 的语法标记，输出时整段跳过。 */
const 标记节点 = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'CodeMark',
  'EmphasisMark',
  // 删除线的标记节点名**不是** EmphasisMark。
  // 这一点是靠打印解析树才发现的：`~~删除线~~` 产出的是 StrikethroughMark，
  // 漏掉它会让导出的 HTML 里出现 `<del>~~删除线~~</del>`。
  'StrikethroughMark',
  'LinkMark',
  'TableDelimiter'
])

/** 标题节点：内容需要去掉首尾空白。 */
const 标题模式 = /^(?:ATX|Setext)Heading(\d)$/

/** 取节点对应的 HTML 标签；返回 null 表示"只递归子节点，不包标签"。 */
function 标签名(节点名: string): string | null {
  switch (节点名) {
    case 'Paragraph':
      return 'p'
    case 'ATXHeading1':
    case 'SetextHeading1':
      return 'h1'
    case 'ATXHeading2':
    case 'SetextHeading2':
      return 'h2'
    case 'ATXHeading3':
      return 'h3'
    case 'ATXHeading4':
      return 'h4'
    case 'ATXHeading5':
      return 'h5'
    case 'ATXHeading6':
      return 'h6'
    case 'Blockquote':
      return 'blockquote'
    case 'BulletList':
      return 'ul'
    case 'OrderedList':
      return 'ol'
    case 'ListItem':
      return 'li'
    case 'Emphasis':
      return 'em'
    case 'StrongEmphasis':
      return 'strong'
    case 'Strikethrough':
      return 'del'
    default:
      return null
  }
}

interface 上下文 {
  源: string
  输出: string[]
  选项: 渲染选项
}

/**
 * 递归渲染：按子节点把区间切开，**子节点之间的空隙就是字面文本**。
 *
 * 这个"填空"写法是遍历 Lezer 树的关键——树是扁平的区间列表，
 * 不属于任何子节点的部分才是正文，漏掉就会丢字。
 */
function 递归(节点: any, 上下文: 上下文): void {
  let 游标 = 节点.from
  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.from > 游标) {
      上下文.输出.push(转义HTML(上下文.源.slice(游标, 子.from)))
    }
    处理(子, 上下文)
    游标 = 子.to
  }
  if (游标 < 节点.to) {
    上下文.输出.push(转义HTML(上下文.源.slice(游标, 节点.to)))
  }
}

function 取语言(节点: any, 上下文: 上下文): string {
  // CodeInfo 是围栏后面那串语言标识，取它并去掉首尾空白
  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name === 'CodeInfo') {
      return 上下文.源.slice(子.from, 子.to).trim().split(/\s+/)[0] ?? ''
    }
  }
  return ''
}

function 处理(节点: any, 上下文: 上下文): void {
  const 名 = 节点.name

  // --- 直接跳过的语法标记 ---
  if (标记节点.has(名)) {
    // Setext 的下划线是 HeaderMark，必须整段吃掉，否则会当成正文渲染出来
    return
  }

  const { 源, 输出, 选项 } = 上下文

  switch (名) {
    // ---------------------------------------------------------- 代码块 --
    case 'FencedCode':
    case 'IndentedCode': {
      const 语言 = 名 === 'FencedCode' ? 取语言(节点, 上下文) : ''
      const 类 = 语言 ? ` class="${转义属性((选项.语言类前缀 ?? 'language-') + 语言)}"` : ''
      // CodeText 是正文，逐段取；围栏符号本身是 CodeMark，已被跳过
      输出.push(`<pre><code${类}>`)
      收集代码文本(节点, 上下文)
      输出.push('</code></pre>\n')
      return
    }

    // -------------------------------------------------------- 行内代码 --
    case 'InlineCode': {
      // 去掉包裹的反引号：内容从第一个 CodeMark 之后到最后一个 CodeMark 之前
      let 起 = 节点.from
      let 止 = 节点.to
      const 首 = 节点.firstChild
      if (首 && 首.name === 'CodeMark') 起 = 首.to
      let 末 = 节点.lastChild
      if (末 && 末.name === 'CodeMark' && 末 !== 首) 止 = 末.from
      const 内容 = 源.slice(起, 止).trim()
      输出.push(`<code>${转义HTML(内容)}</code>`)
      return
    }

    // ------------------------------------------------------------ 图片 --
    case 'Image': {
      const 地址 = 取链接地址(节点, 上下文)
      const 替代 = 取图片替代文本(节点, 上下文)
      输出.push(`<img src="${转义属性(地址)}" alt="${转义属性(替代)}"`)
      const 标题 = 取链接标题(节点, 上下文)
      if (标题) 输出.push(` title="${转义属性(标题)}"`)
      输出.push('>')
      return
    }

    // ------------------------------------------------------------ 链接 --
    case 'Link': {
      const 地址 = 取链接地址(节点, 上下文)
      输出.push(`<a href="${转义属性(地址)}"`)
      const 标题 = 取链接标题(节点, 上下文)
      if (标题) 输出.push(` title="${转义属性(标题)}"`)
      输出.push('>')
      // 只渲染 `[` 与 `]` 之间的部分。
      //
      // `URL` 与 `LinkTitle` 也是 Link 的子节点，无差别递归会把它们当正文
      // 再输出一遍，得到 `<a href="…">链接https://…"标题"</a>`——
      // 靠肉眼看导出的 HTML 很难第一时间发现。
      渲染链接文字(节点, 上下文)
      输出.push('</a>')
      return
    }

    // 自动链接：尖括号里的裸地址
    case 'Autolink': {
      const 文本 = 源.slice(节点.from, 节点.to)
      const 地址 = 文本.replace(/^</, '').replace(/>$/, '')
      输出.push(`<a href="${转义属性(地址)}">${转义HTML(地址)}</a>`)
      return
    }

    // ------------------------------------------------------------ 列表 --
    case 'OrderedList': {
      // 有序列表可能不从 1 开始（`3. 甲`），start 属性必须带上，
      // 否则导出的编号会悄悄从 1 重排。
      const 原文 = 源.slice(节点.from, Math.min(节点.to, 节点.from + 12))
      const 起始 = /^\s*(\d+)[.)]/.exec(原文)
      const 起始值 = 起始 ? Number(起始[1]) : 1
      输出.push(起始值 === 1 ? '<ol>\n' : `<ol start="${起始值}">\n`)
      递归(节点, 上下文)
      输出.push('</ol>\n')
      return
    }

    case 'Task': {
      // 任务项：`- [x] 内容`。复选框是禁用状态，导出后不可交互。
      const 标记 = 找任务标记(节点, 上下文)
      const 勾选 = /\[[xX]\]/.test(标记)
      输出.push(`<input type="checkbox" disabled${勾选 ? ' checked' : ''}> `)
      递归(节点, 上下文)
      return
    }

    case 'TaskMarker':
      // Task 节点里已经输出过复选框了，标记本身不再输出
      return

    // -------------------------------------------------------- 换行标记 --
    case 'HardBreak':
      输出.push('<br>\n')
      return

    // ------------------------------------------------------------ 表格 --
    case 'Table': {
      输出.push('<table>\n')
      for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
        if (子.name === 'TableHeader') {
          输出.push('<thead>\n')
          渲染表格行(子, 上下文, 'th')
          输出.push('</thead>\n')
        } else if (子.name === 'TableRow') {
          渲染表格行(子, 上下文, 'td')
        }
      }
      输出.push('</table>\n')
      return
    }

    case 'TableHeader':
    case 'TableRow':
      // 由 Table 分支统一处理，避免单独进入时包裹错误
      return

    case 'TableCell': {
      // 单独的单元格只在异常输入下出现，兜底当 td 处理
      输出.push('<td>')
      递归(节点, 上下文)
      输出.push('</td>')
      return
    }

    // ---------------------------------------------------------- 原样块 --
    case 'HTMLBlock':
      // HTML 块原样输出，不转义——用户写的就是 HTML
      输出.push(源.slice(节点.from, 节点.to))
      return

    case 'HorizontalRule':
      输出.push('<hr>\n')
      return
  }

  // ------------------------------------------------------------ 通用 ----
  // 标题单独处理：`# 标题` 里 HeaderMark 只是 `#`，它后面那个空格会落进
  // "子节点之间的空隙"里，直接输出会得到 `<h1> 标题一</h1>`。
  // Setext 标题更麻烦——它的下划线是末尾的 HeaderMark，正文前后还各有一个换行。
  // 所以先把内容渲染到临时缓冲，再整体去掉首尾空白。
  const 标题匹配 = 标题模式.exec(名)
  if (标题匹配) {
    const 子缓冲: string[] = []
    递归(节点, { ...上下文, 输出: 子缓冲 })
    输出.push(`<h${标题匹配[1]}>${子缓冲.join('').trim()}</h${标题匹配[1]}>\n`)
    return
  }

  const 标签 = 标签名(名)
  if (标签) {
    const 块级 = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'li'].includes(标签)
    输出.push(`<${标签}>`)
    递归(节点, 上下文)
    输出.push(`</${标签}>${块级 ? '\n' : ''}`)
    return
  }

  // 未特别处理的节点：递归进去，让子节点各自渲染。
  // 这样新增语法（比如脚注）至少不会整段丢失，只是少了外层标签。
  递归(节点, 上下文)
}

/** 代码块内容：只取 CodeText 子节点，避免把围栏符号也当内容。 */
function 收集代码文本(节点: any, 上下文: 上下文): void {
  let 有内容 = false
  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name === 'CodeText') {
      上下文.输出.push(转义HTML(上下文.源.slice(子.from, 子.to)))
      有内容 = true
    }
  }
  if (!有内容) {
    // 兜底：没有 CodeText 子节点（空代码块或解析差异）时，
    // 从 CodeMark 之间取内容，免得导出成空块。
    const 文本 = 上下文.源.slice(节点.from, 节点.to)
    const 行们 = 文本.split('\n')
    if (行们.length > 2) {
      上下文.输出.push(转义HTML(行们.slice(1, -1).join('\n')))
    }
  }
}

function 找任务标记(节点: any, 上下文: 上下文): string {
  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name === 'TaskMarker') return 上下文.源.slice(子.from, 子.to)
  }
  return ''
}

/**
 * 只渲染 `[` 与 `]` 之间的内容。
 *
 * 遇到 `URL` 或 `LinkTitle` 就停——它们属于目标而不是文字。
 * 图片的 alt 用的是另一段逻辑（结构略有不同）。
 */
function 渲染链接文字(节点: any, 上下文: 上下文): void {
  let 游标 = 节点.from
  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name === 'URL' || 子.name === 'LinkTitle') break
    if (子.from > 游标) {
      上下文.输出.push(转义HTML(上下文.源.slice(游标, 子.from)))
    }
    if (!标记节点.has(子.name)) 处理(子, 上下文)
    游标 = 子.to
  }
}

function 取链接地址(节点: any, 上下文: 上下文): string {
  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name === 'URL') return 上下文.源.slice(子.from, 子.to)
  }
  return ''
}

function 取链接标题(节点: any, 上下文: 上下文): string {
  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name === 'LinkTitle') {
      return 上下文.源
        .slice(子.from, 子.to)
        .replace(/^["'(]/, '')
        .replace(/["')]$/, '')
    }
  }
  return ''
}

/** 图片的 alt 取自 `![...]` 里的内容。 */
function 取图片替代文本(节点: any, 上下文: 上下文): string {
  const 第一个标记 = 节点.firstChild
  if (!第一个标记) return ''
  // 结构是 LinkMark(`![`) → 文本 → LinkMark(`]`) → LinkMark(`(`) → URL → LinkMark(`)`)
  const 收集: string[] = []
  for (let 子 = 第一个标记.nextSibling; 子; 子 = 子.nextSibling) {
    if (子.name === 'LinkMark') break
    收集.push(上下文.源.slice(子.from, 子.to))
  }
  return 收集.join('')
}

function 渲染表格行(行节点: any, 上下文: 上下文, 单元格标签: string): void {
  const 对齐们 = 取对齐(行节点, 上下文)
  上下文.输出.push('<tr>\n')
  let 序号 = 0
  for (let 子 = 行节点.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name !== 'TableCell') continue
    const 对齐 = 对齐们[序号]
    上下文.输出.push(`<${单元格标签}${对齐 ? ` style="text-align:${对齐}"` : ''}>`)
    递归(子, 上下文)
    上下文.输出.push(`</${单元格标签}>\n`)
    序号++
  }
  上下文.输出.push('</tr>\n')
}

/** 表格对齐信息来自分隔行 `|:--|--:|`，记在 Table 节点上，这里做一次缓存。 */
const 对齐缓存 = new WeakMap<object, (string | null)[]>()

/**
 * 取各列对齐方式。
 *
 * 分隔行在解析树里是**一个** TableDelimiter 节点，内部没有再分成单元格
 * （打印解析树才发现：`TableDelimiter 68..85 = |:---|:---:|---:|`）。
 * 所以只能拿它的原始文本自己按 `|` 切。
 */
function 取对齐(行节点: any, 上下文: 上下文): (string | null)[] {
  const 表 = 行节点.parent
  if (!表) return []
  const 已有 = 对齐缓存.get(表)
  if (已有) return 已有

  const 结果: (string | null)[] = []
  for (let 子 = 表.firstChild; 子; 子 = 子.nextSibling) {
    if (子.name !== 'TableDelimiter') continue
    const 原文 = 上下文.源.slice(子.from, 子.to)
    for (const 段 of 原文.split('|')) {
      const 文本 = 段.trim()
      // 跳过首尾空段（`|a|b|` 按 `|` 切会切出空串）与非分隔段
      if (文本.length === 0 || !/^:?-+:?$/.test(文本)) continue
      const 左 = 文本.startsWith(':')
      const 右 = 文本.endsWith(':')
      if (左 && 右) 结果.push('center')
      else if (右) 结果.push('right')
      else if (左) 结果.push('left')
      else 结果.push(null)
    }
  }
  对齐缓存.set(表, 结果)
  return 结果
}

/**
 * 把 Markdown 渲染成 HTML 片段。
 *
 * 返回的是**正文片段**（一组块级元素），不含 `<html>` / `<body>` 外壳——
 * 外壳由导出模板负责，因为"网页"与"内嵌预览"需要不同的外壳。
 */
export function 渲染Markdown为HTML(源: string, 选项: 渲染选项 = {}): string {
  const 树 = 解析器.parse(源)
  const 上下文: 上下文 = { 源, 输出: [], 选项 }
  递归(树.topNode, 上下文)
  return 上下文.输出.join('')
}

// ---------------------------------------------------------------------------
// 大纲提取（导出时用来生成侧边目录）
// ---------------------------------------------------------------------------

export interface 大纲项 {
  /** 1–6。 */
  级别: number
  /** 去掉 `#` 与收尾井号之后的正文。 */
  文本: string
  /** 在文档中的起始偏移。 */
  位置: number
}

const 大纲标题模式 = /^(?:ATX|Setext)Heading(\d)$/

/**
 * 去掉 Markdown 标记，得到标题正文。
 *
 * 导出侧与编辑器侧共用这一份：两处各写一遍，迟早会在
 * "收尾井号算不算正文"这类细节上分叉，而症状是导出的大纲与侧边栏不一致。
 */
export function 清理标题文本(原文: string, 是ATX: boolean): string {
  let 文本 = 原文
  if (是ATX) {
    // `## 标题` → `标题`
    文本 = 文本.replace(/^#{1,6}[ \t]+/, '')
    // `## 标题 ##` → `标题`
    文本 = 文本.replace(/[ \t]+#+[ \t]*$/, '')
  } else {
    // Setext 标题的下划线在语法节点内部，取第一行才是正文
    文本 = 文本.split('\n')[0]
  }
  return 文本.trim()
}

/** 从 Markdown 文本里提取标题。用于导出时生成侧边目录。 */
export function 提取大纲(源: string): 大纲项[] {
  const 树 = 解析器.parse(源)
  const 结果: 大纲项[] = []

  树.iterate({
    enter: (节点) => {
      const 匹配 = 大纲标题模式.exec(节点.name)
      if (!匹配) return true
      结果.push({
        级别: Number(匹配[1]),
        文本: 清理标题文本(源.slice(节点.from, 节点.to), 节点.name.startsWith('ATX')),
        位置: 节点.from
      })
      // 标题内部不会再有标题
      return false
    }
  })

  return 结果
}
