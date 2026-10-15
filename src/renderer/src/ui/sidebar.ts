import type { DirEntry } from '@shared/types'
import type { 标题项 } from './outline'

/**
 * 侧边栏。
 *
 * 类名刻意沿用 通行的选择器命名（用 `scripts/CSS选择器.py` 从它的内置主题里
 * 实测得出）：`.selfmd-sidebar` 出现 10 次、`.outline-item` 与 `.outline-expander`
 * 各 21 次、`.file-list-item` 9 次。挂上这些名字，针对它们写主题规则的现成样式
 * 就有机会生效；本项目自己的样式也挂同一批类，不另起一套。
 *
 * 宽度与当前标签持久化在设置里，重启后保持——侧边栏宽度是用户会反复调的东西，
 * 每次启动都回到默认值很烦人。
 */

export type 侧边栏标签 = 'outline' | 'files' | 'articles'

/** 文档列表里的一项。 */
export interface 文档列表项 {
  标识: number
  名字: string
  脏: boolean
  当前: boolean
}

export interface 侧边栏依赖 {
  /** 当前文档路径；未保存时为 null。 */
  取文档路径: () => string | null
  /** 点击大纲项时把光标移到该偏移。 */
  跳转到: (位置: number) => void
  /** 点击文件树项时打开该文件。 */
  打开文件: (路径: string) => void
  /** 点击文档列表项时切换到该文档。 */
  点击文档: (标识: number) => void
  /** 点击文档列表项的关闭按钮。 */
  关闭文档: (标识: number) => void
  /** 折叠 / 展开大纲某一段（当前不做折叠，保留接口）。 */
  保存状态: (状态: { 可见: boolean; 标签: 侧边栏标签; 宽度: number }) => void
}

const 最小宽度 = 160
const 最大宽度 = 520

export class 侧边栏 {
  private 宿主: HTMLElement
  private 依赖: 侧边栏依赖
  private 标签: 侧边栏标签 = 'outline'
  private 宽度 = 260
  private 可见 = false
  private 大纲面板!: HTMLElement
  private 文件面板!: HTMLElement
  private 文档面板!: HTMLElement
  /** 已打开的文档列表。由外层在多文档变化时推送。 */
  private 文档列表: 文档列表项[] = []
  private 标签按钮 = new Map<侧边栏标签, HTMLButtonElement>()
  private 当前高亮下标 = -1
  /** 已展开的目录路径。文件树每次重绘都读它，折叠状态才不会丢。 */
  private 已展开 = new Set<string>()

  constructor(宿主: HTMLElement, 依赖: 侧边栏依赖) {
    this.宿主 = 宿主
    this.依赖 = 依赖
    this.构建()
  }

  // ------------------------------------------------------------- 构图 ----

  private 构建(): void {
    this.宿主.className = 'selfmd-sidebar'
    this.宿主.hidden = true
    this.宿主.textContent = ''

    const 标签栏 = document.createElement('div')
    标签栏.className = 'sidebar-tabs'

    for (const [值, 文字] of [
      ['outline', '大纲'],
      ['files', '文件'],
      ['articles', '文档']
    ] as const) {
      const 按钮 = document.createElement('button')
      按钮.className = 'sidebar-tab'
      按钮.type = 'button'
      按钮.textContent = 文字
      按钮.addEventListener('click', () => this.setTab(值))
      标签栏.append(按钮)
      this.标签按钮.set(值, 按钮)
    }

    const 主体 = document.createElement('div')
    主体.className = 'sidebar-body'

    this.大纲面板 = document.createElement('div')
    this.大纲面板.className = 'outline-content'
    this.大纲面板.dataset.panel = 'outline'

    this.文件面板 = document.createElement('div')
    this.文件面板.className = 'file-list'
    this.文件面板.dataset.panel = 'files'

    this.文档面板 = document.createElement('div')
    this.文档面板.className = 'article-list'
    this.文档面板.dataset.panel = 'articles'

    主体.append(this.大纲面板, this.文件面板, this.文档面板)

    const 拖柄 = document.createElement('div')
    拖柄.className = 'sidebar-resizer'
    拖柄.addEventListener('mousedown', (事件) => this.开始拖拽(事件))

    this.宿主.append(标签栏, 主体, 拖柄)
    this.应用标签()
  }

  private 应用标签(): void {
    for (const [值, 按钮] of this.标签按钮) 按钮.classList.toggle('active', 值 === this.标签)
    this.大纲面板.hidden = this.标签 !== 'outline'
    this.文件面板.hidden = this.标签 !== 'files'
    this.文档面板.hidden = this.标签 !== 'articles'
    if (this.标签 === 'files') void this.刷新文件树()
    if (this.标签 === 'articles') this.重绘文档列表()
  }

  // ------------------------------------------------------------- 交互 ----

  private 开始拖拽(按下: MouseEvent): void {
    按下.preventDefault()
    const 起点 = 按下.clientX
    const 起始宽 = this.宽度

    const 移动 = (事件: MouseEvent): void => {
      const 宽 = Math.min(最大宽度, Math.max(最小宽度, 起始宽 + (事件.clientX - 起点)))
      this.宽度 = 宽
      this.宿主.style.width = `${宽}px`
    }
    const 松开 = (): void => {
      document.removeEventListener('mousemove', 移动)
      document.removeEventListener('mouseup', 松开)
      // 拖拽期间给 body 加类，避免选中文本、并把光标保持为左右拉伸
      document.body.classList.remove('resizing-sidebar')
      this.依赖.保存状态({ 可见: this.可见, 标签: this.标签, 宽度: this.宽度 })
    }

    document.body.classList.add('resizing-sidebar')
    document.addEventListener('mousemove', 移动)
    document.addEventListener('mouseup', 松开)
  }

  // ------------------------------------------------------------- 对外 ----

  get 是否可见(): boolean {
    return this.可见
  }

  setVisible(可见: boolean): void {
    this.可见 = 可见
    this.宿主.hidden = !可见
    if (可见 && this.标签 === 'files') void this.刷新文件树()
    this.依赖.保存状态({ 可见, 标签: this.标签, 宽度: this.宽度 })
  }

  /** 在显示 / 隐藏之间切换，返回切换后的可见状态。 */
  切换(标签?: 侧边栏标签): boolean {
    // 已经显示且点的是同一个标签 → 收起；否则切到该标签并显示。
    // 这是通行行为：再点一次「大纲」是收起侧边栏。
    if (this.可见 && (!标签 || 标签 === this.标签)) {
      this.setVisible(false)
      return false
    }
    if (标签) this.标签 = 标签
    this.应用标签()
    this.setVisible(true)
    return true
  }

  setTab(标签: 侧边栏标签): void {
    this.标签 = 标签
    this.应用标签()
    this.依赖.保存状态({ 可见: this.可见, 标签, 宽度: this.宽度 })
  }

  设置宽度(宽: number): void {
    this.宽度 = Math.min(最大宽度, Math.max(最小宽度, 宽))
    this.宿主.style.width = `${this.宽度}px`
  }

  // ------------------------------------------------------------- 大纲 ----

  /**
   * 重绘大纲。
   *
   * 只在内容真的变了时重建 DOM：光标每移动一次都会调用这个方法，
   * 每次都重建会让点击目标在鼠标按下的瞬间消失。
   */
  private 上次大纲签名 = ''

  setOutline(标题们: 标题项[], 当前下标: number): void {
    const 签名 = 标题们.map((t) => `${t.级别}:${t.位置}:${t.文本}`).join('|')
    if (签名 !== this.上次大纲签名) {
      this.上次大纲签名 = 签名
      this.重绘大纲(标题们)
    }
    this.高亮大纲(当前下标)
  }

  private 重绘大纲(标题们: 标题项[]): void {
    this.大纲面板.textContent = ''
    this.当前高亮下标 = -1

    if (标题们.length === 0) {
      this.大纲面板.append(this.建提示('本文档没有标题'))
      return
    }

    const 最浅 = Math.min(...标题们.map((t) => t.级别))

    标题们.forEach((标题, 下标) => {
      const 项 = document.createElement('div')
      项.className = 'outline-item'
      项.dataset.下标 = String(下标)
      项.dataset.pos = String(标题.位置)
      // 层级用 CSS 变量给出，主题想改缩进直接覆盖变量即可
      项.style.setProperty('--outline-level', String(标题.级别 - 最浅))

      const 折叠 = document.createElement('span')
      折叠.className = 'outline-expander'

      const 标签 = document.createElement('span')
      标签.className = 'outline-label'
      标签.textContent = 标题.文本 || '（空标题）'
      标签.title = 标题.文本

      项.append(折叠, 标签)
      项.addEventListener('click', () => this.依赖.跳转到(标题.位置))
      this.大纲面板.append(项)
    })
  }

  private 高亮大纲(下标: number): void {
    if (下标 === this.当前高亮下标) return
    this.当前高亮下标 = 下标
    for (const 项 of Array.from(this.大纲面板.querySelectorAll('.outline-item'))) {
      const 是当前 = Number((项 as HTMLElement).dataset.下标) === 下标
      项.classList.toggle('active', 是当前)
      // 滚动到可见：文档很长时当前标题可能在视野外
      if (是当前) (项 as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }

  // ----------------------------------------------------------- 文件树 ----

  /** 文件树以"当前文档所在目录"为根。没有文档时显示提示。 */
  private 文件树根: string | null = null
  /** 用户显式打开的根目录；非 null 时覆盖"跟随文档"的行为。 */
  private 手动根目录: string | null = null
  private 刷新序号 = 0

  async 刷新文件树(): Promise<void> {
    // 刷新会被多个来源触发（打开文档、切换标签、显示侧边栏），而读取目录是
    // 异步的。两次刷新交错时，后者会先清空面板、前者再把内容写回去，
    // 结果是条目重复或内容对不上当前文档。用序号做"最后一次生效"的保证，
    // 并且把 DOM 写入推迟到全部读完之后的**一次**提交。
    const 序号 = ++this.刷新序号
    const 片段 = document.createDocumentFragment()

    // 用户显式打开过文件夹时以它为准；否则跟随当前文档所在目录。
    // 两种模式都要有：跟随文档是默认（打开一个文件就想看到它的邻居），
    // 而显式打开一个文件夹之后，切到别处的文档不该把树根也带走。
    const 文档 = this.依赖.取文档路径()
    let 根: string | null
    if (this.手动根目录) {
      根 = this.手动根目录
    } else if (!文档) {
      this.文件树根 = null
      片段.append(this.建提示('尚未保存的文档没有所在目录'))
      this.提交文件树(片段, 序号)
      return
    } else {
      根 = await window.selfmdExtra.path.dirname(文档)
      if (序号 !== this.刷新序号) return
      if (!根) {
        片段.append(this.建提示('无法定位所在目录'))
        this.提交文件树(片段, 序号)
        return
      }
    }

    this.文件树根 = 根

    const 头 = document.createElement('div')
    头.className = 'file-tree-root'
    头.textContent = 根.split(/[\\/]/).pop() || 根
    头.title = 根
    片段.append(头)

    const 列表 = document.createElement('div')
    片段.append(列表)
    await this.展开目录(根, 列表, 0)
    if (序号 !== this.刷新序号) return

    this.提交文件树(片段, 序号)
  }

  private 提交文件树(片段: DocumentFragment, 序号: number): void {
    if (序号 !== this.刷新序号) return
    this.文件面板.textContent = ''
    this.文件面板.append(片段)
  }

  /**
   * 文档列表的根目录；没有可用根时为 null。 */
  get 当前根目录(): string | null {
    return this.文件树根
  }

  // --------------------------------------------------------- 文档列表 ----

  /** 推送已打开的文档列表并重绘。 */
  设置文档列表(列表: 文档列表项[]): void {
    this.文档列表 = 列表
    if (this.标签 === 'articles') this.重绘文档列表()
  }

  private 重绘文档列表(): void {
    this.文档面板.textContent = ''

    if (this.文档列表.length === 0) {
      this.文档面板.append(this.建提示('没有打开的文档'))
      return
    }

    for (const 项 of this.文档列表) {
      const 行 = document.createElement('div')
      行.className = 'article-list-item'
      if (项.当前) 行.classList.add('is-active')
      // 数据属性而不是闭包变量：重绘后仍然能通过点击事件反查是哪一个，
      // 不必为每一行重新绑一次监听器。
      行.dataset.标识 = String(项.标识)
      行.title = 项.名字

      const 名 = document.createElement('span')
      名.className = 'article-name'
      名.textContent = 项.名字
      行.append(名)

      // 未保存的标记。只是一个点，但它是"这个文档还有改动没落盘"的唯一提示，
      // 而文档列表恰恰是多文档下最容易忘记存盘的地方。
      if (项.脏) {
        const 点 = document.createElement('span')
        点.className = 'article-dirty'
        点.textContent = '•'
        点.title = '有未保存的改动'
        行.append(点)
      }

      // 只有一个文档时不给关闭按钮：关掉就没有编辑器了
      if (this.文档列表.length > 1) {
        const 关 = document.createElement('button')
        关.className = 'article-close'
        关.type = 'button'
        关.textContent = '×'
        关.title = '关闭'
        关.addEventListener('click', (事件) => {
          事件.stopPropagation()
          this.依赖.关闭文档(项.标识)
        })
        行.append(关)
      }

      行.addEventListener('click', () => this.依赖.点击文档(项.标识))
      this.文档面板.append(行)
    }
  }

  /**
   * 显式指定文件树根目录。
   *
   * 设过之后文件树不再跟随当前文档——这正是"打开文件夹"该有的语义：
   * 用户要的是浏览那个文件夹，切文档不该把树根也带走。
   */
  设根目录(路径: string): void {
    this.手动根目录 = 路径
  }

  /** 清除显式根，回到跟随当前文档的模式。 */
  清除根目录(): void {
    this.手动根目录 = null
  }

  private 建提示(文字: string): HTMLElement {
    const 提示 = document.createElement('div')
    提示.className = 'sidebar-empty'
    提示.textContent = 文字
    return 提示
  }

  private async 展开目录(目录: string, 容器: HTMLElement, 深度: number): Promise<void> {
    let 项们: DirEntry[] = []
    try {
      项们 = await window.selfmd.file.listDir(目录)
    } catch {
      const 失败 = document.createElement('div')
      失败.className = 'sidebar-empty'
      失败.textContent = '无法读取该目录'
      容器.append(失败)
      return
    }

    // 目录在前、文件在后，各自按名称排序——与资源管理器一致
    const 排序 = (a: DirEntry, b: DirEntry): number =>
      a.isDirectory === b.isDirectory
        ? a.name.localeCompare(b.name, 'zh-Hans')
        : a.isDirectory
          ? -1
          : 1

    for (const 项 of [...项们].sort(排序)) {
      // 隐藏文件默认不显示：Markdown 目录里通常没有需要编辑的隐藏文件
      if (项.name.startsWith('.')) continue

      const 行 = document.createElement('div')
      行.className = 'file-list-item'
      行.dataset.path = 项.path
      行.dataset.depth = String(深度)
      行.style.setProperty('--tree-depth', String(深度))
      if (项.isDirectory) 行.classList.add('file-list-dir')

      const 展开箭头 = document.createElement('span')
      展开箭头.className = 'file-node-expander'
      if (项.isDirectory) 展开箭头.textContent = this.已展开.has(项.path) ? '▾' : '▸'

      const 图标 = document.createElement('span')
      图标.className = 'file-node-icon'
      图标.textContent = 项.isDirectory ? '📁' : '📄'

      const 标题 = document.createElement('span')
      标题.className = 'file-node-title'
      标题.textContent = 项.name

      const 内容 = document.createElement('span')
      内容.className = 'file-node-content'
      内容.append(图标, 标题)

      行.append(展开箭头, 内容)
      容器.append(行)

      if (项.isDirectory) {
        const 子容器 = document.createElement('div')
        子容器.className = 'file-tree-children'
        容器.append(子容器)

        if (this.已展开.has(项.path)) {
          await this.展开目录(项.path, 子容器, 深度 + 1)
        }

        行.addEventListener('click', async () => {
          if (this.已展开.has(项.path)) {
            this.已展开.delete(项.path)
            子容器.textContent = ''
            展开箭头.textContent = '▸'
          } else {
            this.已展开.add(项.path)
            展开箭头.textContent = '▾'
            子容器.textContent = ''
            await this.展开目录(项.path, 子容器, 深度 + 1)
          }
        })
      } else {
        // 点击文件打开它。非文本文件也交给编辑器，由它给出提示——
        // 在这里按扩展名过滤会让"想打开 .txt / .markdown"的常见需求落空。
        行.addEventListener('click', () => this.依赖.打开文件(项.path))
      }
    }
  }

  /** 高亮文件树里对应当前文档的那一项。 */
  高亮当前文件(路径: string | null): void {
    for (const 行 of Array.from(this.文件面板.querySelectorAll('.file-list-item'))) {
      const 是当前 = 路径 !== null && (行 as HTMLElement).dataset.path === 路径
      行.classList.toggle('active', 是当前)
    }
  }
}
