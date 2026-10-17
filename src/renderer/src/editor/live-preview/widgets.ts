import { EditorSelection, type EditorState } from '@codemirror/state'
import { foldCode } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { WidgetType, type EditorView } from '@codemirror/view'
import {
  BUILTIN_FONTS,
  buildFenceInfo,
  infoSpan,
  styleLabels,
  styleOrder,
  parseFenceFirstLine,
  type FenceInfo
} from '@shared/code-block-info'

/**
 * 内联 widget 集合。
 *
 * widget 是"替换型"装饰：它把源码中的一段标记替换成一个真实 DOM 节点，
 * 但**从不修改文档**。文档里仍然是用户敲下的 `- ` 或 `- [ ] `，
 * 屏幕上看到的才是圆点或复选框。这是"纯文本为唯一真实数据源"这一架构的
 * 直接体现——所有渲染都只是叠加在文本之上的视图层。
 */

// ---------------------------------------------------------------------------
// 代码围栏的语言标签
// ---------------------------------------------------------------------------

export class langLabel extends WidgetType {
  constructor(readonly language: string) {
    super()
  }

  override eq(other: langLabel): boolean {
    return other.language === this.language
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-w-lang'
    el.textContent = this.language
    el.setAttribute('aria-hidden', 'true')
    return el
  }

  override ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// 代码块头部栏
// ---------------------------------------------------------------------------

/**
 * 语言下拉的选项表。
 *
 * 值取语言描述的第一个别名（`py`、`js`、`rs`），因为围栏里写的通常是别名；
 * 显示名用完整名称（`Python`），因为下拉里要看的是"这是个什么语言"。
 *
 * `languages` 有上百项，原生 `<select>` 能靠首字母跳转应付长列表，
 * 所以不做裁剪——裁掉的那几个恰好是用户想用的，比列表长更让人恼火。
 */
const languageOptions: { value: string; name: string }[] = (() => {
  const tbl: { value: string; name: string }[] = []
  for (const item of languages) {
    const value = item.alias[0] ?? item.name.toLowerCase()
    tbl.push({ value, name: item.name })
  }
  // 按显示名排序；中文用户找语言主要靠认名字，字母序比包内顺序好找
  return tbl.sort((alpha, beta) => alpha.name.localeCompare(beta.name))
})()

/** 围栏在文档中的位置。头部栏的所有动作都要靠它换算回文档坐标。 */
export interface CodeBlockPos {
  fenceStart: number
  fenceEnd: number
  firstLineStart: number
}

/**
 * 代码块头部栏。
 *
 * 替换围栏首行（```` ```python ````）。用户不必去改反引号后面的文本，
 * 而是从下拉里选语言、在输入框里填名称——**但落回文档的仍然是纯文本**，
 * 只是那串文本由控件生成而不是手敲。
 *
 * ## 为什么 `ignoreEvent` 返回 true
 *
 * CodeMirror 的事件处理逻辑是"遍历到 widget 时，若 `ignoreEvent` 为真则
 * **不处理**该事件，交给 widget"。这里必须返回 `true`：否则点下拉框会被
 * 编辑器当成"移动光标"，控件根本打不开。
 *
 * （与它相反的是任务复选框——那边返回 `false`，靠 `preventDefault` 自行处理。）
 */
export class codeHeader extends WidgetType {
  constructor(
    readonly info: FenceInfo,
    readonly position: CodeBlockPos
  ) {
    super()
  }

  override eq(other: codeHeader): boolean {
    return (
      other.info.language === this.info.language &&
      other.info.displayName === this.info.displayName &&
      other.info.style === this.info.style &&
      other.info.font === this.info.font &&
      other.position.firstLineStart === this.position.firstLineStart
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'cm-w-codehead'
    // 头部栏是控件而不是文本，屏幕阅读器不该把它读成正文
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', '代码块设置')

    // --- 折叠 -----------------------------------------------------------
    const fold = document.createElement('button')
    fold.type = 'button'
    fold.className = 'cm-w-codehead-btn cm-w-codehead-fold'
    fold.textContent = '▾'
    fold.title = '折叠代码块'
    fold.setAttribute('aria-label', '折叠代码块')
    fold.addEventListener('click', (event) => {
      event.preventDefault()
      // 先把光标放到围栏首行，折叠才会作用在这个块上——
      // 否则折的是光标当前所在的那个块，用户会觉得"点错了"。
      view.dispatch({ selection: { anchor: this.position.firstLineStart } })
      foldCode(view)
    })

    // --- 名称 -----------------------------------------------------------
    const displayName = document.createElement('input')
    displayName.type = 'text'
    displayName.className = 'cm-w-codehead-name'
    displayName.placeholder = '请输入代码块名称'
    displayName.value = this.info.displayName
    displayName.setAttribute('aria-label', '代码块名称')
    // 用 `change` 而不是每次按键都写回：逐字同步会让撤销栈里塞满
    // 半截名称，Ctrl+Z 得按十几次才能退回去。
    displayName.addEventListener('change', () => {
      this.patchInfo(view, { displayName: displayName.value.trim() })
    })
    displayName.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        displayName.blur()
      }
    })

    // --- 语言 -----------------------------------------------------------
    const language = this.makeSelect('cm-w-codehead-lang', '代码块语言')
    for (const item of languageOptions) language.append(new Option(item.name, item.value))
    // 当前语言不在表里（用户手写了冷门别名）时补一项，
    // 否则下拉会显示成第一项，用户以为语言被改掉了
    if (this.info.language && !languageOptions.some((item) => item.value === this.info.language)) {
      language.prepend(new Option(this.info.language, this.info.language, true, true))
    }
    // 空值表示"没有语言"，退化成纯文本块
    language.prepend(new Option('纯文本', '', this.info.language === '', this.info.language === ''))
    language.value = this.info.language
    language.addEventListener('change', () => {
      this.patchInfo(view, { language: language.value })
    })

    // --- 字体 -----------------------------------------------------------
    const font = this.makeSelect('cm-w-codehead-font', '代码字体')
    for (const item of BUILTIN_FONTS) font.append(new Option(item.name, item.value))
    font.value = this.info.font
    font.addEventListener('change', () => {
      this.patchInfo(view, { font: font.value })
    })

    // --- 配色 -----------------------------------------------------------
    const style = this.makeSelect('cm-w-codehead-style', '代码块配色')
    for (const name of styleOrder) style.append(new Option(styleLabels[name], name))
    style.value = this.info.style
    style.addEventListener('change', () => {
      this.patchInfo(view, { style: style.value as FenceInfo['style'] })
    })

    // --- 复制 -----------------------------------------------------------
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'cm-w-codehead-btn cm-w-codehead-copy'
    copy.textContent = '复制'
    copy.title = '复制代码'
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.takeCode(view)).then(
        () => hint(copy, '已复制'),
        () => hint(copy, '复制失败')
      )
    })

    box.append(fold, displayName, language, font, style, copy)
    return box
  }

  /** 造一个下拉；三个下拉的公共部分收在这里，免得样式类名写漏。 */
  private makeSelect(className: string, ariaLabel: string): HTMLSelectElement {
    const el = document.createElement('select')
    el.className = `cm-w-codehead-select ${className}`
    el.setAttribute('aria-label', ariaLabel)
    return el
  }

  /**
   * 取代码块正文（不含首尾围栏）。
   *
   * 从**文档**里现取，而不是缓存进 widget：用户按下复制的那一刻，
   * 内容多半已经和 widget 构造时不一样了。
   */
  private takeCode(view: EditorView): string {
    const state = view.state
    const start = Math.min(this.position.fenceStart, state.doc.length)
    const end = Math.min(this.position.fenceEnd, state.doc.length)
    const originalText = state.sliceDoc(start, end)
    // 去掉首行的围栏、末行的围栏，只留中间正文
    return originalText
      .split('\n')
      .slice(1, -1)
      .join('\n')
  }

  /** 把改动写回围栏首行的信息串。 */
  private patchInfo(view: EditorView, partial: Partial<FenceInfo>): void {
    const state = view.state
    const line = state.doc.lineAt(Math.min(this.position.firstLineStart, state.doc.length))
    const lineText = state.sliceDoc(line.from, line.to)
    const range = infoSpan(lineText)
    if (!range) return

    // **必须用 `解析围栏首行`，不能对整行调 `解析围栏信息`。**
    // 后者会把反引号当成语言的一部分，构建时再写回去——每改一次多三个
    // 反引号，攒到十几个才看得出来。
    const nextInfo = { ...parseFenceFirstLine(lineText), ...partial }
    const nextText = buildFenceInfo(nextInfo)
    if (nextText === lineText.slice(range.start, range.end)) return

    view.dispatch({
      // 只替换反引号之后的部分：反引号是围栏的语法标记，动它等于换语法
      changes: { from: line.from + range.start, to: line.from + range.end, insert: nextText },
      userEvent: 'input.codeBlockInfo'
    })
  }

  /** 控件必须自己收事件，否则点下拉会被编辑器当成移动光标。 */
  override ignoreEvent(): boolean {
    return true
  }
}

/** 按钮上短暂换一下文字，给点击一个可见的反馈。 */
function hint(button: HTMLButtonElement, text: string): void {
  const originalText = button.textContent
  button.textContent = text
  button.classList.add('cm-w-codehead-done')
  window.setTimeout(() => {
    button.textContent = originalText
    button.classList.remove('cm-w-codehead-done')
  }, 1200)
}

/**
 * 提示框首行的标签。
 *
 * 把 `> [!NOTE]` 换成一个小小的「提示」。**只换这一行**，正文一个字都不动——
 * 提示框的内容仍然是可编辑的普通文本，用户想改随时能改。
 */
export class calloutHint extends WidgetType {
  override eq(other: calloutHint): boolean {
    return other instanceof calloutHint
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-w-callout'
    el.textContent = '提示'
    // 标签是装饰性的，读屏时念出来只会干扰正文
    el.setAttribute('aria-hidden', 'true')
    return el
  }

  override ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// 列表符号
// ---------------------------------------------------------------------------

/** 按嵌套层级给出的项目符号，与常见 Markdown 渲染器的约定一致。 */
const bulletGlyph = ['•', '◦', '▪']

export class bulletDot extends WidgetType {
  constructor(readonly layer: number) {
    super()
  }

  override eq(other: bulletDot): boolean {
    return other.layer === this.layer
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-w-bullet'
    el.textContent = bulletGlyph[this.layer % bulletGlyph.length]
    el.setAttribute('aria-hidden', 'true')
    return el
  }

  override ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// 图片
// ---------------------------------------------------------------------------

/**
 * 图片被右键时的回调。
 *
 * widget 不该直接去操作应用状态（弹菜单、改文档），所以留一个回调口子由
 * 上层注册。这样 widget 保持"只负责画"的单一职责，测试时也能不接菜单单独渲染。
 */
export type imageContextHandler = (
  event: MouseEvent,
  /** 文档里写的原始地址（相对路径形态，未解析）。 */
  originalUrl: string,
  altText: string,
  /** widget 的根元素；上层用它反查文档位置。 */
  el: HTMLElement
) => void

let imageContextMenu: imageContextHandler | null = null

export function setImageContextHandler(handler: imageContextHandler | null): void {
  imageContextMenu = handler
}

/**
 * 行内图片。
 *
 * `![替代文字](地址)` 整段被替换成一个真实的 `<img>`，但**文档一个字符都没动**。
 * 光标进入这段语法时装饰会被撤掉、源码重新露出来——这是实时预览的一贯做法：
 * 想改地址就把光标移上去，其余时候看到的是图。
 *
 * 地址解析失败（文档未保存、文件不存在、编码损坏）时渲染成占位而不是破图：
 * 破图图标会让人以为是图片文件坏了，而实际原因常常是"文档还没保存，
 * 相对路径没有基准目录"。
 */
export class image extends WidgetType {
  constructor(
    /** 解析后的可加载 URL；空串表示解析失败。 */
    readonly url: string,
    /** 文档里写的原始地址，右键菜单与上传回填要用。 */
    readonly originalUrl: string,
    readonly altText: string,
    /** 本地文件在磁盘上的绝对路径；远程图片为 null。 */
    readonly localPath: string | null
  ) {
    super()
  }

  override eq(other: image): boolean {
    return (
      other.url === this.url &&
      other.originalUrl === this.originalUrl &&
      other.altText === this.altText
    )
  }

  override toDOM(): HTMLElement {
    const box = document.createElement('span')
    // `md-image` 是通用的类名，挂上它主题规则才有机会生效
    box.className = 'cm-w-image md-image'
    box.setAttribute('data-src', this.originalUrl)

    if (!this.url) {
      box.classList.add('md-img-error')
      box.textContent = `⚠ 无法显示图片${this.altText ? `：${this.altText}` : `：${this.originalUrl}`}`
      box.title =
        '无法解析图片地址。若用的是相对路径，请先保存文档——' +
        '相对路径需要一个基准目录。'
      this.attachContextMenu(box)
      return box
    }

    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.altText
    img.draggable = false
    // 延迟加载：长文档里几十张图同时解码会让滚动卡顿
    img.loading = 'lazy'

    // 文件被删、被改名、路径写错都会走到这里。把盒子换成占位，
    // 并保留原地址供排查——只留一个破图图标等于什么都没说。
    img.addEventListener('error', () => {
      box.classList.add('md-img-error')
      box.textContent = `⚠ 图片加载失败：${this.altText || this.originalUrl}`
      box.title = `找不到文件：${this.localPath ?? this.originalUrl}`
    })

    box.append(img)
    this.attachContextMenu(box)
    return box
  }

  private attachContextMenu(box: HTMLElement): void {
    box.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      imageContextMenu?.(event, this.originalUrl, this.altText, box)
    })
  }

  /** 返回 false 让点击穿透到编辑器：这样单击图片能把光标定位过去开始编辑。 */
  override ignoreEvent(): boolean {
    return false
  }
}


export class taskBox extends WidgetType {
  constructor(
    readonly checkedFlag: boolean,
    /** 标记 `[ ]` 在文档中的起始位置，用于回写。 */
    readonly position: number
  ) {
    super()
  }

  override eq(other: taskBox): boolean {
    return other.checkedFlag === this.checkedFlag && other.position === this.position
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.className = 'cm-w-task'
    el.checked = this.checkedFlag
    el.setAttribute('aria-label', this.checkedFlag ? '标记为未完成' : '标记为已完成')

    el.addEventListener('mousedown', (event) => {
      // 阻止默认行为，否则点击会把光标移进被替换的标记区间。
      event.preventDefault()
      this.toggle(view)
    })

    return el
  }

  /**
   * 把 `[ ]` 与 `[x]` 互相改写。
   *
   * 只改动方括号内的那一个字符，其余字节原样保留——包括用户可能写的
   * `[X]`（大写）与任务文字前后的空白。
   */
  private toggle(view: EditorView): void {
    const state = view.state
    const start = this.position
    // 标记形如 `[ ]`、`[x]`、`[X]`，长度固定为 3。
    const end = Math.min(start + 3, state.doc.length)
    if (end - start !== 3) return

    const originalText = state.sliceDoc(start, end)
    if (!/^\[[ xX]\]$/.test(originalText)) return

    const nextText = this.checkedFlag ? '[ ]' : '[x]'
    view.dispatch({
      changes: { from: start, to: end, insert: nextText },
      // 保持光标不动：勾选复选框不应该抢走输入焦点。
      selection: EditorSelection.cursor(state.selection.main.head),
      userEvent: 'input.toggleTask'
    })
  }

  override ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// 水平线
// ---------------------------------------------------------------------------

export class horizontalRuleEl extends WidgetType {
  override eq(other: horizontalRuleEl): boolean {
    return other instanceof horizontalRuleEl
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-w-hr'
    el.setAttribute('aria-hidden', 'true')
    return el
  }

  override ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// 表格管线符（保留位置但淡化为视觉分隔）
// ---------------------------------------------------------------------------

export class tableSeparatorDeco extends WidgetType {
  constructor(readonly ch: string) {
    super()
  }

  override eq(other: tableSeparatorDeco): boolean {
    return other.ch === this.ch
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-w-pipe'
    el.textContent = this.ch
    el.setAttribute('aria-hidden', 'true')
    return el
  }

  override ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mermaid 图表
// ---------------------------------------------------------------------------

/** Mermaid 模块只在首次遇到图表时加载。 */
let mermaidModule: Promise<typeof import('mermaid').default> | null = null

async function loadMermaid(): Promise<typeof import('mermaid').default> {
  mermaidModule ??= import('mermaid').then((modulo) => {
    const take = modulo as unknown as { default?: unknown }
    return (take.default ?? modulo) as unknown as typeof import('mermaid').default
  })
  const mermaid = await mermaidModule
  return mermaid
}

let initialized = false
let themesInitialized = ''

/** 初始化 Mermaid，并在主题变化时重新初始化。 */
async function ensureInit(theme: 'default' | 'dark'): Promise<typeof import('mermaid').default> {
  const mermaid = await loadMermaid()
  // 主题变了必须重新 initialize，否则旧主题的配色会一直用下去
  if (!initialized || themesInitialized !== theme) {
    mermaid.initialize({
      // 不自动扫描页面：我们自己控制什么时候渲染哪一个
      startOnLoad: false,
      theme: theme,
      // 语法错误交给调用方处理，由它决定显示什么
      securityLevel: 'strict',
      fontFamily: 'inherit'
    })
    initialized = true
    themesInitialized = theme
  }
  return mermaid
}

/**
 * Mermaid 图表。
 *
 * ` ```mermaid ` 围栏代码块整块被替换成渲染出的 SVG。与数学公式同理，
 * 跨行的替换必须由 StateField 提供（见 `live-preview/图表字段.ts`）。
 *
 * **渲染失败要把源码留着。** Mermaid 的语法错误信息往往很抽象
 * （"Parse error on line 3"），用户需要对照源码才能找出问题；
 * 只显示一句错误提示等于让人去猜。
 */
export class diagramWidget extends WidgetType {
  constructor(
    readonly sourceCode: string,
    readonly darkMode: boolean,
    /** 渲染成功后回调，让上层扣掉"正在渲染"的状态。 */
    readonly done?: () => void
  ) {
    super()
  }

  override eq(other: diagramWidget): boolean {
    return other.sourceCode === this.sourceCode && other.darkMode === this.darkMode
  }

  override toDOM(): HTMLElement {
    const box = document.createElement('div')
    // `.md-diagram-panel` 是通用的类名
    box.className = 'cm-w-diagram md-diagram-panel'
    box.setAttribute('data-diagram', this.sourceCode)
    // 显式标记渲染状态。
    //
    // 不靠"文字里有没有『正在渲染』"来判断——那种判断既脆弱（改一个字就失效）
    // 又不可靠（错误信息里也可能出现同样的词）。属性是明确的契约，
    // 等待逻辑、统计与将来的调试工具都读它。
    box.dataset.state = '渲染中'

    const state = document.createElement('div')
    state.className = 'cm-w-diagram-status'
    state.textContent = '正在渲染图表…'
    box.append(state)

    void (async () => {
      try {
        const mermaid = await ensureInit(this.darkMode ? 'dark' : 'default')
        // 每次渲染都要一个唯一 id：Mermaid 会在文档里放一个同名的临时
        // 容器来量尺寸，id 重复会让两张图互相覆盖。
        const id = `selfmd-图表-${Math.random().toString(36).slice(2, 10)}`
        const { svg } = await mermaid.render(id, this.sourceCode)

        box.textContent = ''
        box.innerHTML = svg
        box.dataset.state = '完成'
      } catch (error) {
        // 失败时**同时**给出错误与源码：只看错误信息找不出问题在哪
        box.classList.add('md-diagram-error')
        box.textContent = ''

        const hint = document.createElement('div')
        hint.className = 'cm-w-diagram-status'
        hint.textContent = `图表渲染失败：${
          error instanceof Error ? error.message.split('\n')[0] : String(error)
        }`

        const sourceBlock = document.createElement('pre')
        sourceBlock.className = 'cm-w-diagram-source'
        sourceBlock.textContent = this.sourceCode

        box.append(hint, sourceBlock)
        box.dataset.state = '失败'
      } finally {
        this.done?.()
      }
    })()

    return box
  }

  /** 图表里的文字应当可以被选中复制，所以不拦截事件。 */
  override ignoreEvent(): boolean {
    return false
  }
}

/** 当前行的缩进层级，用于选择列表符号。制表符按 4 个空格计。 */
export function computeLevel(state: EditorState, lineStart: number): number {
  const line = state.doc.lineAt(lineStart)
  const docText = state.sliceDoc(line.from, line.to)
  const indent = /^[\t ]*/.exec(docText)?.[0] ?? ''
  let widthPx = 0
  for (const ch of indent) widthPx += ch === '\t' ? 4 : 1
  return Math.floor(widthPx / 2)
}

// ---------------------------------------------------------------------------
// 数学公式
// ---------------------------------------------------------------------------

/** KaTeX 模块只在首次用到时加载。 */
let katexModule: Promise<{ render: typeof import('katex').default.render }> | null = null

async function loadKatex(): Promise<{ render: typeof import('katex').default.render }> {
  katexModule ??= import('katex').then((modulo) => {
    // Vite 对 CommonJS 的默认导出处理：有的形态挂在 `.default` 上
    const take = modulo as unknown as { default?: { render: unknown }; render?: unknown }
    return (take.default ?? modulo) as unknown as { render: typeof import('katex').default.render }
  })
  return katexModule
}

/**
 * 用 KaTeX 渲染的数学公式。
 *
 * **`@lezer/markdown` 不解析数学公式**（打印解析树可以看到 `$x^2$` 只是普通
 * 文本，`$$…$$` 也只是普通段落），所以公式的识别在 `@shared/数学.ts` 里自己扫，
 * 这里只负责画。
 *
 * `throwOnError: false` 是刻意的：公式写错时 KaTeX 会把出错的那一段用红色
 * 原样显示，用户立刻看得到错在哪。抛异常的话整个 widget 构建失败，
 * 屏幕上什么都不剩——正在编辑的公式突然消失，比显示一段红字糟得多。
 */
export class mathWidget extends WidgetType {
  constructor(
    readonly formula: string,
    readonly blockLevel: boolean
  ) {
    super()
  }

  override eq(other: mathWidget): boolean {
    return other.formula === this.formula && other.blockLevel === this.blockLevel
  }

  override toDOM(): HTMLElement {
    const box = document.createElement(this.blockLevel ? 'div' : 'span')
    box.className = this.blockLevel
      ? 'cm-w-math cm-w-math-block md-math-block'
      : 'cm-w-math cm-w-math-inline md-inline-math'
    box.setAttribute('data-math', this.formula)
    // 先把源码放进去，KaTeX 加载完再替换。
    // 这样公式区域从一开始就有内容，不会先空一块再突然出现。
    box.textContent = this.formula

    void (async () => {
      try {
        const katex = await loadKatex()
        katex.render(this.formula, box, {
          displayMode: this.blockLevel,
          throwOnError: false,
          // 出错时的颜色；正常渲染的颜色由 CSS 接管
          errorColor: '#cc0000',
          strict: false
        })
      } catch {
        // KaTeX 加载失败就保留源码文本——至少内容还在，用户能继续编辑
      }
    })()

    return box
  }

  override ignoreEvent(): boolean {
    return false
  }
}
