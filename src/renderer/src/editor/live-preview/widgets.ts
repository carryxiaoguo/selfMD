import { EditorSelection, type EditorState } from '@codemirror/state'
import { foldCode } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { WidgetType, type EditorView } from '@codemirror/view'
import {
  内置字体,
  构建围栏信息,
  信息串区间,
  样式显示名,
  样式顺序,
  解析围栏首行,
  type 围栏信息
} from '@shared/代码块信息'

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
const 语言选项: { 值: string; 名: string }[] = (() => {
  const 表: { 值: string; 名: string }[] = []
  for (const 项 of languages) {
    const 值 = 项.alias[0] ?? 项.name.toLowerCase()
    表.push({ 值, 名: 项.name })
  }
  // 按显示名排序；中文用户找语言主要靠认名字，字母序比包内顺序好找
  return 表.sort((甲, 乙) => 甲.名.localeCompare(乙.名))
})()

/** 围栏在文档中的位置。头部栏的所有动作都要靠它换算回文档坐标。 */
export interface 代码块位置 {
  围栏起: number
  围栏终: number
  首行起: number
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
export class 代码块头部 extends WidgetType {
  constructor(
    readonly 信息: 围栏信息,
    readonly 位置: 代码块位置
  ) {
    super()
  }

  override eq(other: 代码块头部): boolean {
    return (
      other.信息.语言 === this.信息.语言 &&
      other.信息.名称 === this.信息.名称 &&
      other.信息.样式 === this.信息.样式 &&
      other.信息.字体 === this.信息.字体 &&
      other.位置.首行起 === this.位置.首行起
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const 盒 = document.createElement('div')
    盒.className = 'cm-w-codehead'
    // 头部栏是控件而不是文本，屏幕阅读器不该把它读成正文
    盒.setAttribute('role', 'group')
    盒.setAttribute('aria-label', '代码块设置')

    // --- 折叠 -----------------------------------------------------------
    const 折叠 = document.createElement('button')
    折叠.type = 'button'
    折叠.className = 'cm-w-codehead-btn cm-w-codehead-fold'
    折叠.textContent = '▾'
    折叠.title = '折叠代码块'
    折叠.setAttribute('aria-label', '折叠代码块')
    折叠.addEventListener('click', (事件) => {
      事件.preventDefault()
      // 先把光标放到围栏首行，折叠才会作用在这个块上——
      // 否则折的是光标当前所在的那个块，用户会觉得"点错了"。
      view.dispatch({ selection: { anchor: this.位置.首行起 } })
      foldCode(view)
    })

    // --- 名称 -----------------------------------------------------------
    const 名称 = document.createElement('input')
    名称.type = 'text'
    名称.className = 'cm-w-codehead-name'
    名称.placeholder = '请输入代码块名称'
    名称.value = this.信息.名称
    名称.setAttribute('aria-label', '代码块名称')
    // 用 `change` 而不是每次按键都写回：逐字同步会让撤销栈里塞满
    // 半截名称，Ctrl+Z 得按十几次才能退回去。
    名称.addEventListener('change', () => {
      this.改信息(view, { 名称: 名称.value.trim() })
    })
    名称.addEventListener('keydown', (事件) => {
      if (事件.key === 'Enter') {
        事件.preventDefault()
        名称.blur()
      }
    })

    // --- 语言 -----------------------------------------------------------
    const 语言 = this.选单('cm-w-codehead-lang', '代码块语言')
    for (const 项 of 语言选项) 语言.append(new Option(项.名, 项.值))
    // 当前语言不在表里（用户手写了冷门别名）时补一项，
    // 否则下拉会显示成第一项，用户以为语言被改掉了
    if (this.信息.语言 && !语言选项.some((项) => 项.值 === this.信息.语言)) {
      语言.prepend(new Option(this.信息.语言, this.信息.语言, true, true))
    }
    // 空值表示"没有语言"，退化成纯文本块
    语言.prepend(new Option('纯文本', '', this.信息.语言 === '', this.信息.语言 === ''))
    语言.value = this.信息.语言
    语言.addEventListener('change', () => {
      this.改信息(view, { 语言: 语言.value })
    })

    // --- 字体 -----------------------------------------------------------
    const 字体 = this.选单('cm-w-codehead-font', '代码字体')
    for (const 项 of 内置字体) 字体.append(new Option(项.名, 项.值))
    字体.value = this.信息.字体
    字体.addEventListener('change', () => {
      this.改信息(view, { 字体: 字体.value })
    })

    // --- 配色 -----------------------------------------------------------
    const 样式 = this.选单('cm-w-codehead-style', '代码块配色')
    for (const 名 of 样式顺序) 样式.append(new Option(样式显示名[名], 名))
    样式.value = this.信息.样式
    样式.addEventListener('change', () => {
      this.改信息(view, { 样式: 样式.value as 围栏信息['样式'] })
    })

    // --- 复制 -----------------------------------------------------------
    const 复制 = document.createElement('button')
    复制.type = 'button'
    复制.className = 'cm-w-codehead-btn cm-w-codehead-copy'
    复制.textContent = '复制'
    复制.title = '复制代码'
    复制.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.取代码(view)).then(
        () => 提示(复制, '已复制'),
        () => 提示(复制, '复制失败')
      )
    })

    盒.append(折叠, 名称, 语言, 字体, 样式, 复制)
    return 盒
  }

  /** 造一个下拉；三个下拉的公共部分收在这里，免得样式类名写漏。 */
  private 选单(类名: string, 无障碍名: string): HTMLSelectElement {
    const el = document.createElement('select')
    el.className = `cm-w-codehead-select ${类名}`
    el.setAttribute('aria-label', 无障碍名)
    return el
  }

  /**
   * 取代码块正文（不含首尾围栏）。
   *
   * 从**文档**里现取，而不是缓存进 widget：用户按下复制的那一刻，
   * 内容多半已经和 widget 构造时不一样了。
   */
  private 取代码(view: EditorView): string {
    const 状态 = view.state
    const 起 = Math.min(this.位置.围栏起, 状态.doc.length)
    const 终 = Math.min(this.位置.围栏终, 状态.doc.length)
    const 原文 = 状态.sliceDoc(起, 终)
    // 去掉首行的围栏、末行的围栏，只留中间正文
    return 原文
      .split('\n')
      .slice(1, -1)
      .join('\n')
  }

  /** 把改动写回围栏首行的信息串。 */
  private 改信息(view: EditorView, 部分: Partial<围栏信息>): void {
    const 状态 = view.state
    const 行 = 状态.doc.lineAt(Math.min(this.位置.首行起, 状态.doc.length))
    const 行文本 = 状态.sliceDoc(行.from, 行.to)
    const 区间 = 信息串区间(行文本)
    if (!区间) return

    // **必须用 `解析围栏首行`，不能对整行调 `解析围栏信息`。**
    // 后者会把反引号当成语言的一部分，构建时再写回去——每改一次多三个
    // 反引号，攒到十几个才看得出来。
    const 新信息 = { ...解析围栏首行(行文本), ...部分 }
    const 新文 = 构建围栏信息(新信息)
    if (新文 === 行文本.slice(区间.起, 区间.终)) return

    view.dispatch({
      // 只替换反引号之后的部分：反引号是围栏的语法标记，动它等于换语法
      changes: { from: 行.from + 区间.起, to: 行.from + 区间.终, insert: 新文 },
      userEvent: 'input.codeBlockInfo'
    })
  }

  /** 控件必须自己收事件，否则点下拉会被编辑器当成移动光标。 */
  override ignoreEvent(): boolean {
    return true
  }
}

/** 按钮上短暂换一下文字，给点击一个可见的反馈。 */
function 提示(按钮: HTMLButtonElement, 文字: string): void {
  const 原文 = 按钮.textContent
  按钮.textContent = 文字
  按钮.classList.add('cm-w-codehead-done')
  window.setTimeout(() => {
    按钮.textContent = 原文
    按钮.classList.remove('cm-w-codehead-done')
  }, 1200)
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
