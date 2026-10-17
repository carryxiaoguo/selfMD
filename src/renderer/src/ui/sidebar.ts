import type { DirEntry } from '@shared/types'
import type { headingItem } from './outline'

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

export type sidebarTabName = 'outline' | 'files' | 'articles'

/** 文档列表里的一项。 */
export interface docListItem {
  id: number
  nameText: string
  dirtyFlag: boolean
  current: boolean
}

export interface sidebarDeps {
  /** 当前文档路径；未保存时为 null。 */
  takeDocPath: () => string | null
  /** 点击大纲项时把光标移到该偏移。 */
  jumpTo: (position: number) => void
  /** 点击文件树项时打开该文件。 */
  openFile: (filePath: string) => void
  /** 点击文档列表项时切换到该文档。 */
  clickDoc: (id: number) => void
  /** 点击文档列表项的关闭按钮。 */
  closeDoc: (id: number) => void
  /** 折叠 / 展开大纲某一段（当前不做折叠，保留接口）。 */
  saveState: (state: { visibleNow: boolean; label: sidebarTabName; widthPx: number }) => void
}

const minWidth = 160
const maxWidth = 520

export class sidebar {
  private host: HTMLElement
  private deps: sidebarDeps
  private label: sidebarTabName = 'outline'
  private widthPx = 260
  private visibleNow = false
  private outlinePanel!: HTMLElement
  private filesPanel!: HTMLElement
  private docsPanel!: HTMLElement
  /** 已打开的文档列表。由外层在多文档变化时推送。 */
  private docList: docListItem[] = []
  private tabButton = new Map<sidebarTabName, HTMLButtonElement>()
  private highlightIndex = -1
  /** 已展开的目录路径。文件树每次重绘都读它，折叠状态才不会丢。 */
  private expanded = new Set<string>()

  constructor(host: HTMLElement, deps: sidebarDeps) {
    this.host = host
    this.deps = deps
    this.build()
  }

  // ------------------------------------------------------------- 构图 ----

  private build(): void {
    this.host.className = 'selfmd-sidebar'
    this.host.hidden = true
    this.host.textContent = ''

    const tabBar = document.createElement('div')
    tabBar.className = 'sidebar-tabs'

    for (const [value, text] of [
      ['outline', '大纲'],
      ['files', '文件'],
      ['articles', '文档']
    ] as const) {
      const button = document.createElement('button')
      button.className = 'sidebar-tab'
      button.type = 'button'
      button.textContent = text
      button.addEventListener('click', () => this.setTab(value))
      tabBar.append(button)
      this.tabButton.set(value, button)
    }

    const mainBody = document.createElement('div')
    mainBody.className = 'sidebar-body'

    this.outlinePanel = document.createElement('div')
    this.outlinePanel.className = 'outline-content'
    this.outlinePanel.dataset.panel = 'outline'

    this.filesPanel = document.createElement('div')
    this.filesPanel.className = 'file-list'
    this.filesPanel.dataset.panel = 'files'

    this.docsPanel = document.createElement('div')
    this.docsPanel.className = 'article-list'
    this.docsPanel.dataset.panel = 'articles'

    mainBody.append(this.outlinePanel, this.filesPanel, this.docsPanel)

    const dragHandle = document.createElement('div')
    dragHandle.className = 'sidebar-resizer'
    dragHandle.addEventListener('mousedown', (event) => this.开始拖拽(event))

    this.host.append(tabBar, mainBody, dragHandle)
    this.applyTab()
  }

  private applyTab(): void {
    for (const [value, button] of this.tabButton) button.classList.toggle('active', value === this.label)
    this.outlinePanel.hidden = this.label !== 'outline'
    this.filesPanel.hidden = this.label !== 'files'
    this.docsPanel.hidden = this.label !== 'articles'
    if (this.label === 'files') void this.refreshFileTree()
    if (this.label === 'articles') this.repaintDocList()
  }

  // ------------------------------------------------------------- 交互 ----

  private 开始拖拽(pressed: MouseEvent): void {
    pressed.preventDefault()
    const fromPos = pressed.clientX
    const 起始宽 = this.widthPx

    const move = (event: MouseEvent): void => {
      const width = Math.min(maxWidth, Math.max(minWidth, 起始宽 + (event.clientX - fromPos)))
      this.widthPx = width
      this.host.style.width = `${width}px`
    }
    const onRelease = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', onRelease)
      // 拖拽期间给 body 加类，避免选中文本、并把光标保持为左右拉伸
      document.body.classList.remove('resizing-sidebar')
      this.deps.saveState({ visibleNow: this.visibleNow, label: this.label, widthPx: this.widthPx })
    }

    document.body.classList.add('resizing-sidebar')
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', onRelease)
  }

  // ------------------------------------------------------------- 对外 ----

  get visible(): boolean {
    return this.visibleNow
  }

  setVisible(visibleNow: boolean): void {
    this.visibleNow = visibleNow
    this.host.hidden = !visibleNow
    if (visibleNow && this.label === 'files') void this.refreshFileTree()
    this.deps.saveState({ visibleNow, label: this.label, widthPx: this.widthPx })
  }

  /** 在显示 / 隐藏之间切换，返回切换后的可见状态。 */
  toggle(label?: sidebarTabName): boolean {
    // 已经显示且点的是同一个标签 → 收起；否则切到该标签并显示。
    // 这是通行行为：再点一次「大纲」是收起侧边栏。
    if (this.visibleNow && (!label || label === this.label)) {
      this.setVisible(false)
      return false
    }
    if (label) this.label = label
    this.applyTab()
    this.setVisible(true)
    return true
  }

  setTab(label: sidebarTabName): void {
    this.label = label
    this.applyTab()
    this.deps.saveState({ visibleNow: this.visibleNow, label, widthPx: this.widthPx })
  }

  setWidth(width: number): void {
    this.widthPx = Math.min(maxWidth, Math.max(minWidth, width))
    this.host.style.width = `${this.widthPx}px`
  }

  // ------------------------------------------------------------- 大纲 ----

  /**
   * 重绘大纲。
   *
   * 只在内容真的变了时重建 DOM：光标每移动一次都会调用这个方法，
   * 每次都重建会让点击目标在鼠标按下的瞬间消失。
   */
  private lastOutlineSig = ''

  setOutline(headings: headingItem[], currentIndex: number): void {
    const signature = headings.map((t) => `${t.level}:${t.position}:${t.docText}`).join('|')
    if (signature !== this.lastOutlineSig) {
      this.lastOutlineSig = signature
      this.重绘大纲(headings)
    }
    this.高亮大纲(currentIndex)
  }

  private 重绘大纲(headings: headingItem[]): void {
    this.outlinePanel.textContent = ''
    this.highlightIndex = -1

    if (headings.length === 0) {
      this.outlinePanel.append(this.makeHint('本文档没有标题'))
      return
    }

    const shallowest = Math.min(...headings.map((t) => t.level))

    headings.forEach((title, subscript) => {
      const item = document.createElement('div')
      item.className = 'outline-item'
      item.dataset.subscript = String(subscript)
      item.dataset.pos = String(title.position)
      // 层级用 CSS 变量给出，主题想改缩进直接覆盖变量即可
      item.style.setProperty('--outline-level', String(title.level - shallowest))

      const fold = document.createElement('span')
      fold.className = 'outline-expander'

      const label = document.createElement('span')
      label.className = 'outline-label'
      label.textContent = title.docText || '（空标题）'
      label.title = title.docText

      item.append(fold, label)
      item.addEventListener('click', () => this.deps.jumpTo(title.position))
      this.outlinePanel.append(item)
    })
  }

  private 高亮大纲(subscript: number): void {
    if (subscript === this.highlightIndex) return
    this.highlightIndex = subscript
    for (const item of Array.from(this.outlinePanel.querySelectorAll('.outline-item'))) {
      const isCurrentFlag = Number((item as HTMLElement).dataset.subscript) === subscript
      item.classList.toggle('active', isCurrentFlag)
      // 滚动到可见：文档很长时当前标题可能在视野外
      if (isCurrentFlag) (item as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }

  // ----------------------------------------------------------- 文件树 ----

  /** 文件树以"当前文档所在目录"为根。没有文档时显示提示。 */
  private fileTreeRoot: string | null = null
  /** 用户显式打开的根目录；非 null 时覆盖"跟随文档"的行为。 */
  private manualRoot: string | null = null
  private refreshSeq = 0

  async refreshFileTree(): Promise<void> {
    // 刷新会被多个来源触发（打开文档、切换标签、显示侧边栏），而读取目录是
    // 异步的。两次刷新交错时，后者会先清空面板、前者再把内容写回去，
    // 结果是条目重复或内容对不上当前文档。用序号做"最后一次生效"的保证，
    // 并且把 DOM 写入推迟到全部读完之后的**一次**提交。
    const index = ++this.refreshSeq
    const parts = document.createDocumentFragment()

    // 用户显式打开过文件夹时以它为准；否则跟随当前文档所在目录。
    // 两种模式都要有：跟随文档是默认（打开一个文件就想看到它的邻居），
    // 而显式打开一个文件夹之后，切到别处的文档不该把树根也带走。
    const docModel = this.deps.takeDocPath()
    let root: string | null
    if (this.manualRoot) {
      root = this.manualRoot
    } else if (!docModel) {
      this.fileTreeRoot = null
      parts.append(this.makeHint('尚未保存的文档没有所在目录'))
      this.commitFileTree(parts, index)
      return
    } else {
      root = await window.selfmdExtra.path.dirname(docModel)
      if (index !== this.refreshSeq) return
      if (!root) {
        parts.append(this.makeHint('无法定位所在目录'))
        this.commitFileTree(parts, index)
        return
      }
    }

    this.fileTreeRoot = root

    const headEl = document.createElement('div')
    headEl.className = 'file-tree-root'
    headEl.textContent = root.split(/[\\/]/).pop() || root
    headEl.title = root
    parts.append(headEl)

    const list = document.createElement('div')
    parts.append(list)
    await this.expandDir(root, list, 0)
    if (index !== this.refreshSeq) return

    this.commitFileTree(parts, index)
  }

  private commitFileTree(parts: DocumentFragment, index: number): void {
    if (index !== this.refreshSeq) return
    this.filesPanel.textContent = ''
    this.filesPanel.append(parts)
  }

  /**
   * 文档列表的根目录；没有可用根时为 null。 */
  get rootDir(): string | null {
    return this.fileTreeRoot
  }

  // --------------------------------------------------------- 文档列表 ----

  /** 推送已打开的文档列表并重绘。 */
  设置文档列表(list: docListItem[]): void {
    this.docList = list
    if (this.label === 'articles') this.repaintDocList()
  }

  private repaintDocList(): void {
    this.docsPanel.textContent = ''

    if (this.docList.length === 0) {
      this.docsPanel.append(this.makeHint('没有打开的文档'))
      return
    }

    for (const item of this.docList) {
      const line = document.createElement('div')
      line.className = 'article-list-item'
      if (item.current) line.classList.add('is-active')
      // 数据属性而不是闭包变量：重绘后仍然能通过点击事件反查是哪一个，
      // 不必为每一行重新绑一次监听器。
      line.dataset.id = String(item.id)
      line.title = item.nameText

      const name = document.createElement('span')
      name.className = 'article-name'
      name.textContent = item.nameText
      line.append(name)

      // 未保存的标记。只是一个点，但它是"这个文档还有改动没落盘"的唯一提示，
      // 而文档列表恰恰是多文档下最容易忘记存盘的地方。
      if (item.dirtyFlag) {
        const dot = document.createElement('span')
        dot.className = 'article-dirty'
        dot.textContent = '•'
        dot.title = '有未保存的改动'
        line.append(dot)
      }

      // 只有一个文档时不给关闭按钮：关掉就没有编辑器了
      if (this.docList.length > 1) {
        const off = document.createElement('button')
        off.className = 'article-close'
        off.type = 'button'
        off.textContent = '×'
        off.title = '关闭'
        off.addEventListener('click', (event) => {
          event.stopPropagation()
          this.deps.closeDoc(item.id)
        })
        line.append(off)
      }

      line.addEventListener('click', () => this.deps.clickDoc(item.id))
      this.docsPanel.append(line)
    }
  }

  /**
   * 显式指定文件树根目录。
   *
   * 设过之后文件树不再跟随当前文档——这正是"打开文件夹"该有的语义：
   * 用户要的是浏览那个文件夹，切文档不该把树根也带走。
   */
  设根目录(filePath: string): void {
    this.manualRoot = filePath
  }

  /** 清除显式根，回到跟随当前文档的模式。 */
  清除根目录(): void {
    this.manualRoot = null
  }

  private makeHint(text: string): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'sidebar-empty'
    hint.textContent = text
    return hint
  }

  private async expandDir(dir: string, container: HTMLElement, depth: number): Promise<void> {
    let items: DirEntry[] = []
    try {
      items = await window.selfmd.file.listDir(dir)
    } catch {
      const failure = document.createElement('div')
      failure.className = 'sidebar-empty'
      failure.textContent = '无法读取该目录'
      container.append(failure)
      return
    }

    // 目录在前、文件在后，各自按名称排序——与资源管理器一致
    const sort = (a: DirEntry, b: DirEntry): number =>
      a.isDirectory === b.isDirectory
        ? a.name.localeCompare(b.name, 'zh-Hans')
        : a.isDirectory
          ? -1
          : 1

    for (const item of [...items].sort(sort)) {
      // 隐藏文件默认不显示：Markdown 目录里通常没有需要编辑的隐藏文件
      if (item.name.startsWith('.')) continue

      const line = document.createElement('div')
      line.className = 'file-list-item'
      line.dataset.path = item.path
      line.dataset.depth = String(depth)
      line.style.setProperty('--tree-depth', String(depth))
      if (item.isDirectory) line.classList.add('file-list-dir')

      const expandArrow = document.createElement('span')
      expandArrow.className = 'file-node-expander'
      if (item.isDirectory) expandArrow.textContent = this.expanded.has(item.path) ? '▾' : '▸'

      const icon = document.createElement('span')
      icon.className = 'file-node-icon'
      icon.textContent = item.isDirectory ? '📁' : '📄'

      const title = document.createElement('span')
      title.className = 'file-node-title'
      title.textContent = item.name

      const content = document.createElement('span')
      content.className = 'file-node-content'
      content.append(icon, title)

      line.append(expandArrow, content)
      container.append(line)

      if (item.isDirectory) {
        const subContainer = document.createElement('div')
        subContainer.className = 'file-tree-children'
        container.append(subContainer)

        if (this.expanded.has(item.path)) {
          await this.expandDir(item.path, subContainer, depth + 1)
        }

        line.addEventListener('click', async () => {
          if (this.expanded.has(item.path)) {
            this.expanded.delete(item.path)
            subContainer.textContent = ''
            expandArrow.textContent = '▸'
          } else {
            this.expanded.add(item.path)
            expandArrow.textContent = '▾'
            subContainer.textContent = ''
            await this.expandDir(item.path, subContainer, depth + 1)
          }
        })
      } else {
        // 点击文件打开它。非文本文件也交给编辑器，由它给出提示——
        // 在这里按扩展名过滤会让"想打开 .txt / .markdown"的常见需求落空。
        line.addEventListener('click', () => this.deps.openFile(item.path))
      }
    }
  }

  /** 高亮文件树里对应当前文档的那一项。 */
  高亮当前文件(filePath: string | null): void {
    for (const line of Array.from(this.filesPanel.querySelectorAll('.file-list-item'))) {
      const isCurrentFlag = filePath !== null && (line as HTMLElement).dataset.path === filePath
      line.classList.toggle('active', isCurrentFlag)
    }
  }
}
