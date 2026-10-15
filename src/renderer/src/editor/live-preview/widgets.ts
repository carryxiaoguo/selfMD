import { EditorSelection, type EditorState } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'

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

export class 语言标签 extends WidgetType {
  constructor(readonly 语言: string) {
    super()
  }

  override eq(other: 语言标签): boolean {
    return other.语言 === this.语言
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-w-lang'
    el.textContent = this.语言
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
const 项目符号 = ['•', '◦', '▪']

export class 列表圆点 extends WidgetType {
  constructor(readonly 层级: number) {
    super()
  }

  override eq(other: 列表圆点): boolean {
    return other.层级 === this.层级
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-w-bullet'
    el.textContent = 项目符号[this.层级 % 项目符号.length]
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
export type 图片右键处理器 = (
  事件: MouseEvent,
  /** 文档里写的原始地址（相对路径形态，未解析）。 */
  原地址: string,
  替代文字: string,
  /** widget 的根元素；上层用它反查文档位置。 */
  元素: HTMLElement
) => void

let 图片右键: 图片右键处理器 | null = null

export function 设置图片右键处理器(处理器: 图片右键处理器 | null): void {
  图片右键 = 处理器
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
export class 图片 extends WidgetType {
  constructor(
    /** 解析后的可加载 URL；空串表示解析失败。 */
    readonly 地址: string,
    /** 文档里写的原始地址，右键菜单与上传回填要用。 */
    readonly 原地址: string,
    readonly 替代文字: string,
    /** 本地文件在磁盘上的绝对路径；远程图片为 null。 */
    readonly 本地路径: string | null
  ) {
    super()
  }

  override eq(other: 图片): boolean {
    return (
      other.地址 === this.地址 &&
      other.原地址 === this.原地址 &&
      other.替代文字 === this.替代文字
    )
  }

  override toDOM(): HTMLElement {
    const 盒 = document.createElement('span')
    // `md-image` 是通用的类名，挂上它主题规则才有机会生效
    盒.className = 'cm-w-image md-image'
    盒.setAttribute('data-src', this.原地址)

    if (!this.地址) {
      盒.classList.add('md-img-error')
      盒.textContent = `⚠ 无法显示图片${this.替代文字 ? `：${this.替代文字}` : `：${this.原地址}`}`
      盒.title =
        '无法解析图片地址。若用的是相对路径，请先保存文档——' +
        '相对路径需要一个基准目录。'
      this.挂右键(盒)
      return 盒
    }

    const 图 = document.createElement('img')
    图.src = this.地址
    图.alt = this.替代文字
    图.draggable = false
    // 延迟加载：长文档里几十张图同时解码会让滚动卡顿
    图.loading = 'lazy'

    // 文件被删、被改名、路径写错都会走到这里。把盒子换成占位，
    // 并保留原地址供排查——只留一个破图图标等于什么都没说。
    图.addEventListener('error', () => {
      盒.classList.add('md-img-error')
      盒.textContent = `⚠ 图片加载失败：${this.替代文字 || this.原地址}`
      盒.title = `找不到文件：${this.本地路径 ?? this.原地址}`
    })

    盒.append(图)
    this.挂右键(盒)
    return 盒
  }

  private 挂右键(盒: HTMLElement): void {
    盒.addEventListener('contextmenu', (事件) => {
      事件.preventDefault()
      事件.stopPropagation()
      图片右键?.(事件, this.原地址, this.替代文字, 盒)
    })
  }

  /** 返回 false 让点击穿透到编辑器：这样单击图片能把光标定位过去开始编辑。 */
  override ignoreEvent(): boolean {
    return false
  }
}


export class 任务框 extends WidgetType {
  constructor(
    readonly 已勾选: boolean,
    /** 标记 `[ ]` 在文档中的起始位置，用于回写。 */
    readonly 位置: number
  ) {
    super()
  }

  override eq(other: 任务框): boolean {
    return other.已勾选 === this.已勾选 && other.位置 === this.位置
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.className = 'cm-w-task'
    el.checked = this.已勾选
    el.setAttribute('aria-label', this.已勾选 ? '标记为未完成' : '标记为已完成')

    el.addEventListener('mousedown', (event) => {
      // 阻止默认行为，否则点击会把光标移进被替换的标记区间。
      event.preventDefault()
      this.切换(view)
    })

    return el
  }

  /**
   * 把 `[ ]` 与 `[x]` 互相改写。
   *
   * 只改动方括号内的那一个字符，其余字节原样保留——包括用户可能写的
   * `[X]`（大写）与任务文字前后的空白。
   */
  private 切换(view: EditorView): void {
    const 状态 = view.state
    const 起 = this.位置
    // 标记形如 `[ ]`、`[x]`、`[X]`，长度固定为 3。
    const 终 = Math.min(起 + 3, 状态.doc.length)
    if (终 - 起 !== 3) return

    const 原文 = 状态.sliceDoc(起, 终)
    if (!/^\[[ xX]\]$/.test(原文)) return

    const 新文 = this.已勾选 ? '[ ]' : '[x]'
    view.dispatch({
      changes: { from: 起, to: 终, insert: 新文 },
      // 保持光标不动：勾选复选框不应该抢走输入焦点。
      selection: EditorSelection.cursor(状态.selection.main.head),
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

export class 水平线 extends WidgetType {
  override eq(other: 水平线): boolean {
    return other instanceof 水平线
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

export class 表格分隔 extends WidgetType {
  constructor(readonly 字符: string) {
    super()
  }

  override eq(other: 表格分隔): boolean {
    return other.字符 === this.字符
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-w-pipe'
    el.textContent = this.字符
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
let mermaid模块: Promise<typeof import('mermaid').default> | null = null

async function 取Mermaid(): Promise<typeof import('mermaid').default> {
  mermaid模块 ??= import('mermaid').then((模) => {
    const 取 = 模 as unknown as { default?: unknown }
    return (取.default ?? 模) as unknown as typeof import('mermaid').default
  })
  const mermaid = await mermaid模块
  return mermaid
}

let 已初始化 = false
let 已初始化主题 = ''

/** 初始化 Mermaid，并在主题变化时重新初始化。 */
async function 确保初始化(主题: 'default' | 'dark'): Promise<typeof import('mermaid').default> {
  const mermaid = await 取Mermaid()
  // 主题变了必须重新 initialize，否则旧主题的配色会一直用下去
  if (!已初始化 || 已初始化主题 !== 主题) {
    mermaid.initialize({
      // 不自动扫描页面：我们自己控制什么时候渲染哪一个
      startOnLoad: false,
      theme: 主题,
      // 语法错误交给调用方处理，由它决定显示什么
      securityLevel: 'strict',
      fontFamily: 'inherit'
    })
    已初始化 = true
    已初始化主题 = 主题
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
export class 图表 extends WidgetType {
  constructor(
    readonly 源码: string,
    readonly 暗色: boolean,
    /** 渲染成功后回调，让上层扣掉"正在渲染"的状态。 */
    readonly 完成?: () => void
  ) {
    super()
  }

  override eq(other: 图表): boolean {
    return other.源码 === this.源码 && other.暗色 === this.暗色
  }

  override toDOM(): HTMLElement {
    const 盒 = document.createElement('div')
    // `.md-diagram-panel` 是通用的类名
    盒.className = 'cm-w-diagram md-diagram-panel'
    盒.setAttribute('data-diagram', this.源码)
    // 显式标记渲染状态。
    //
    // 不靠"文字里有没有『正在渲染』"来判断——那种判断既脆弱（改一个字就失效）
    // 又不可靠（错误信息里也可能出现同样的词）。属性是明确的契约，
    // 等待逻辑、统计与将来的调试工具都读它。
    盒.dataset.状态 = '渲染中'

    const 状态 = document.createElement('div')
    状态.className = 'cm-w-diagram-status'
    状态.textContent = '正在渲染图表…'
    盒.append(状态)

    void (async () => {
      try {
        const mermaid = await 确保初始化(this.暗色 ? 'dark' : 'default')
        // 每次渲染都要一个唯一 id：Mermaid 会在文档里放一个同名的临时
        // 容器来量尺寸，id 重复会让两张图互相覆盖。
        const id = `selfmd-图表-${Math.random().toString(36).slice(2, 10)}`
        const { svg } = await mermaid.render(id, this.源码)

        盒.textContent = ''
        盒.innerHTML = svg
        盒.dataset.状态 = '完成'
      } catch (错误) {
        // 失败时**同时**给出错误与源码：只看错误信息找不出问题在哪
        盒.classList.add('md-diagram-error')
        盒.textContent = ''

        const 提示 = document.createElement('div')
        提示.className = 'cm-w-diagram-status'
        提示.textContent = `图表渲染失败：${
          错误 instanceof Error ? 错误.message.split('\n')[0] : String(错误)
        }`

        const 源码块 = document.createElement('pre')
        源码块.className = 'cm-w-diagram-source'
        源码块.textContent = this.源码

        盒.append(提示, 源码块)
        盒.dataset.状态 = '失败'
      } finally {
        this.完成?.()
      }
    })()

    return 盒
  }

  /** 图表里的文字应当可以被选中复制，所以不拦截事件。 */
  override ignoreEvent(): boolean {
    return false
  }
}

/** 当前行的缩进层级，用于选择列表符号。制表符按 4 个空格计。 */
export function 计算层级(状态: EditorState, 行首: number): number {
  const 行 = 状态.doc.lineAt(行首)
  const 文本 = 状态.sliceDoc(行.from, 行.to)
  const 缩进 = /^[\t ]*/.exec(文本)?.[0] ?? ''
  let 宽度 = 0
  for (const 字符 of 缩进) 宽度 += 字符 === '\t' ? 4 : 1
  return Math.floor(宽度 / 2)
}

// ---------------------------------------------------------------------------
// 数学公式
// ---------------------------------------------------------------------------

/** KaTeX 模块只在首次用到时加载。 */
let katex模块: Promise<{ render: typeof import('katex').default.render }> | null = null

async function 取KaTeX(): Promise<{ render: typeof import('katex').default.render }> {
  katex模块 ??= import('katex').then((模) => {
    // Vite 对 CommonJS 的默认导出处理：有的形态挂在 `.default` 上
    const 取 = 模 as unknown as { default?: { render: unknown }; render?: unknown }
    return (取.default ?? 模) as unknown as { render: typeof import('katex').default.render }
  })
  return katex模块
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
export class 数学公式 extends WidgetType {
  constructor(
    readonly 公式: string,
    readonly 块级: boolean
  ) {
    super()
  }

  override eq(other: 数学公式): boolean {
    return other.公式 === this.公式 && other.块级 === this.块级
  }

  override toDOM(): HTMLElement {
    const 盒 = document.createElement(this.块级 ? 'div' : 'span')
    盒.className = this.块级
      ? 'cm-w-math cm-w-math-block md-math-block'
      : 'cm-w-math cm-w-math-inline md-inline-math'
    盒.setAttribute('data-math', this.公式)
    // 先把源码放进去，KaTeX 加载完再替换。
    // 这样公式区域从一开始就有内容，不会先空一块再突然出现。
    盒.textContent = this.公式

    void (async () => {
      try {
        const katex = await 取KaTeX()
        katex.render(this.公式, 盒, {
          displayMode: this.块级,
          throwOnError: false,
          // 出错时的颜色；正常渲染的颜色由 CSS 接管
          errorColor: '#cc0000',
          strict: false
        })
      } catch {
        // KaTeX 加载失败就保留源码文本——至少内容还在，用户能继续编辑
      }
    })()

    return 盒
  }

  override ignoreEvent(): boolean {
    return false
  }
}
