import { 偏好设置结构, 校验设置表, type 设置项 } from '@shared/settings-schema'
import type { Settings } from '@shared/types'

/**
 * 偏好设置面板。
 *
 * 界面完全照着 `@shared/settings-schema` 渲染，不硬编码任何一项。
 * 这样加一项设置只需要动那张表，不用同时改三处（界面、类型、应用逻辑）。
 *
 * 顶部带搜索框：设置项有一百多个，靠翻分类找很慢。搜索时忽略分类、
 * 把所有命中的项平铺出来——这是通行行为。
 */

export interface 偏好设置依赖 {
  取设置: () => Settings
  /** 改一项设置。返回更新后的完整设置。 */
  应用设置: (补丁: Partial<Settings>) => Promise<Settings>
  /** 只读项（例如当前主题）要显示的值。 */
  取只读值?: (key: keyof Settings) => string | null
}

export class 偏好设置面板 {
  private deps: 偏好设置依赖
  private overlay: HTMLElement | null = null
  private 当前分区 = 0
  private 搜索词 = ''

  constructor(deps: 偏好设置依赖) {
    this.deps = deps
  }

  get isOpen(): boolean {
    return this.overlay !== null
  }

  /**
   * 打开面板。已经打开时先关掉，避免叠出两层。
   *
   * @param 定位分区 打开后直接滚到该分区。菜单里的「导出设置」用它——
   *                 用户点的是"导出设置"，落在一个几十项的面板顶端
   *                 还得自己往下找，等于没定位。
   */
  open(定位分区?: string): void {
    const 问题 = 校验设置表()
    if (问题.length > 0) {
      // 表里写了不存在的键：这是开发期错误，必须响亮地报出来。
      // 静默渲染的后果是"这一项点了没反应"，极难排查。
      console.error(`[偏好设置] 设置表引用了不存在的键：${问题.join('、')}`)
    }

    if (this.overlay) this.close()
    this.搜索词 = ''

    // 定位分区：找不到就保持当前分区（不清零），
    // 免得名字写错时直接把用户丢回第一页却毫无提示。
    if (定位分区) {
      const subscript = 偏好设置结构.findIndex((score) => score.title === 定位分区)
      if (subscript >= 0) this.当前分区 = subscript
      else console.warn(`[偏好设置] 没有名为「${定位分区}」的分区`)
    }

    const overlay = document.createElement('div')
    overlay.className = 'selfmd-prefs-mask'

    const panel = document.createElement('div')
    panel.className = 'selfmd-prefs'

    const 左栏 = document.createElement('div')
    左栏.className = 'prefs-side'
    const title = document.createElement('div')
    title.className = 'prefs-title'
    title.textContent = '偏好设置'
    左栏.append(title)

    偏好设置结构.forEach((section, subscript) => {
      const label = document.createElement('button')
      label.className = 'prefs-tab'
      label.type = 'button'
      label.dataset.section = String(subscript)
      label.textContent = section.title
      label.addEventListener('click', () => {
        this.当前分区 = subscript
        this.搜索词 = ''
        const input = panel.querySelector('.prefs-search') as HTMLInputElement | null
        if (input) input.value = ''
        this.重绘()
      })
      左栏.append(label)
    })

    const 右栏 = document.createElement('div')
    右栏.className = 'prefs-main'

    const 搜索行 = document.createElement('div')
    搜索行.className = 'prefs-search-row'
    const search = document.createElement('input')
    search.className = 'prefs-search'
    search.type = 'search'
    search.placeholder = '搜索设置项…'
    search.addEventListener('input', () => {
      this.搜索词 = search.value.trim()
      this.重绘()
    })
    const 关闭钮 = document.createElement('button')
    关闭钮.className = 'selfmd-btn'
    关闭钮.type = 'button'
    关闭钮.textContent = '关闭'
    关闭钮.addEventListener('click', () => this.close())
    搜索行.append(search, 关闭钮)

    const content = document.createElement('div')
    content.className = 'prefs-body'

    右栏.append(搜索行, content)
    panel.append(左栏, 右栏)
    overlay.append(panel)
    document.body.append(overlay)

    this.overlay = overlay
    this.内容区 = content
    this.左栏区 = 左栏

    // Esc 关闭；捕获阶段监听，避免编辑器抢先处理
    document.addEventListener('keydown', this.keyboard, true)
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.close()
    })

    this.重绘()
    search.focus()
  }

  private 内容区: HTMLElement | null = null
  private 左栏区: HTMLElement | null = null

  private keyboard = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
    }
  }

  close(): void {
    if (!this.overlay) return
    document.removeEventListener('keydown', this.keyboard, true)
    this.overlay.remove()
    this.overlay = null
    this.内容区 = null
    this.左栏区 = null
  }

  /** 面板开着时设置被外部改动，需要重绘以反映新值。 */
  refresh(): void {
    if (this.overlay) this.重绘()
  }

  // ------------------------------------------------------------- 渲染 ----

  private 重绘(): void {
    const content = this.内容区
    if (!content) return

    // 左栏高亮：搜索时所有分区都不选中——结果已经跨分区平铺了
    for (const button of Array.from(this.左栏区?.querySelectorAll('.prefs-tab') ?? [])) {
      const subscript = Number((button as HTMLElement).dataset.section)
      button.classList.toggle('active', this.搜索词 === '' && subscript === this.当前分区)
    }

    content.textContent = ''

    if (this.搜索词 !== '') {
      this.渲染搜索结果(content)
      return
    }

    const section = 偏好设置结构[this.当前分区]
    if (!section) return

    for (const subsection of section.subsection) {
      const block = document.createElement('div')
      block.className = 'prefs-section'
      if (subsection.title) {
        const title = document.createElement('h3')
        title.textContent = subsection.title
        block.append(title)
      }
      if (subsection.description) {
        const description = document.createElement('p')
        description.className = 'prefs-note'
        description.textContent = subsection.description
        block.append(description)
      }
      for (const item of subsection.item) block.append(this.渲染一行(item))
      content.append(block)
    }
  }

  private 渲染搜索结果(content: HTMLElement): void {
    const 词 = this.搜索词.toLowerCase()
    const block = document.createElement('div')
    block.className = 'prefs-section'

    let hit = 0
    for (const section of 偏好设置结构) {
      for (const subsection of section.subsection) {
        for (const item of subsection.item) {
          const whole = `${item.label} ${item.description ?? ''} ${String(item.key)}`.toLowerCase()
          if (!whole.includes(词)) continue
          hit++
          // 搜索时带上分区名，否则用户不知道这一项属于哪里
          const line = this.渲染一行(item, section.title)
          block.append(line)
        }
      }
    }

    if (hit === 0) {
      const 空 = document.createElement('div')
      空.className = 'prefs-empty'
      空.textContent = `没有匹配「${this.搜索词}」的设置项`
      block.append(空)
    } else {
      const 计数 = document.createElement('p')
      计数.className = 'prefs-note'
      计数.textContent = `找到 ${hit} 项`
      block.prepend(计数)
    }

    content.append(block)
  }

  private 渲染一行(item: 设置项, 来源分区?: string): HTMLElement {
    const line = document.createElement('div')
    line.className = 'prefs-row'
    line.dataset.key = String(item.key)

    const 标签区 = document.createElement('div')
    标签区.className = 'prefs-label'
    const name = document.createElement('div')
    name.className = 'prefs-name'
    name.textContent = item.label
    标签区.append(name)
    if (来源分区) {
      const origin = document.createElement('div')
      origin.className = 'prefs-source'
      origin.textContent = 来源分区
      标签区.append(origin)
    }
    if (item.description) {
      const description = document.createElement('div')
      description.className = 'prefs-hint'
      description.textContent = item.description
      标签区.append(description)
    }

    const 控件区 = document.createElement('div')
    控件区.className = 'prefs-control'
    控件区.append(this.渲染控件(item))

    line.append(标签区, 控件区)
    return line
  }

  private 渲染控件(item: 设置项): HTMLElement {
    const settings = this.deps.取设置()
    const currentValue = settings[item.key]

    if (item.kind === '开关') {
      const 框 = document.createElement('input')
      框.type = 'checkbox'
      框.checked = Boolean(currentValue)
      框.addEventListener('change', () => void this.提交(item.key, 框.checked))
      return 框
    }

    if (item.kind === '下拉') {
      const 选 = document.createElement('select')
      for (const options of item.options ?? []) {
        const 条 = document.createElement('option')
        条.value = options.value
        条.textContent = options.text
        选.append(条)
      }
      选.value = String(currentValue ?? '')
      选.addEventListener('change', () => void this.提交(item.key, 选.value))
      return 选
    }

    if (item.kind === '数字') {
      const box = document.createElement('div')
      box.className = 'prefs-number'
      const numItems = document.createElement('input')
      numItems.type = 'number'
      numItems.value = String(currentValue ?? 0)
      if (item.minValue !== undefined) numItems.min = String(item.minValue)
      if (item.maxValue !== undefined) numItems.max = String(item.maxValue)
      if (item.步长 !== undefined) numItems.step = String(item.步长)
      // 用 change 而不是 input：拖数字框的箭头或长按删除键时，
      // input 会在每一个中间值上触发一次写盘，产生一串无意义的历史。
      numItems.addEventListener('change', () => {
        const value = Number(numItems.value)
        if (!Number.isFinite(value)) return
        const 夹紧 = Math.min(item.maxValue ?? value, Math.max(item.minValue ?? value, value))
        if (夹紧 !== value) numItems.value = String(夹紧)
        void this.提交(item.key, 夹紧)
      })
      box.append(numItems)
      if (item.unit) {
        const unit = document.createElement('span')
        unit.className = 'prefs-unit'
        unit.textContent = item.unit
        box.append(unit)
      }
      return box
    }

    // 列表：值本身是数组，用一个逗号分隔的输入框编辑。
    //
    // 不引入"添加/删除条目"的复杂控件：这些列表都很短（词典语言、扩展名），
    // 手打逗号比点加号快。但**解析要容错**——用户会打成中文逗号、
    // 会在逗号后多打空格，这些都不该变成空条目。
    if (item.kind === '列表') {
      const inputText = document.createElement('input')
      inputText.type = 'text'
      inputText.value = Array.isArray(currentValue) ? (currentValue as string[]).join(', ') : String(currentValue ?? '')
      inputText.addEventListener('change', () => {
        const entry = [
          ...new Set(
            inputText.value
              .split(/[,，]/)
              .map((segment) => segment.trim())
              .filter((segment) => segment.length > 0)
          )
        ]
        // 回写规范化后的文本，让用户看到实际存下来的样子
        inputText.value = entry.join(', ')
        void this.提交(item.key, entry)
      })
      return inputText
    }

    // 文本（也用于展示只读值）
    const inputText = document.createElement('input')
    inputText.type = 'text'
    inputText.value = String(currentValue ?? '')
    const 只读值 = this.deps.取只读值?.(item.key)
    if (只读值 !== null && 只读值 !== undefined) {
      inputText.value = 只读值
      // 只读项（例如「当前主题」）在界面上不可编辑——它由别的入口决定
      inputText.readOnly = true
      inputText.classList.add('prefs-readonly')
    }
    inputText.addEventListener('change', () => void this.提交(item.key, inputText.value))
    return inputText
  }

  private async 提交(key: keyof Settings, value: unknown): Promise<void> {
    try {
      await this.deps.应用设置({ [key]: value } as Partial<Settings>)
    } catch (error) {
      console.error('[偏好设置] 写入失败：', error)
    }
  }
}
