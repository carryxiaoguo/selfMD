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
  取只读值?: (键: keyof Settings) => string | null
}

export class 偏好设置面板 {
  private 依赖: 偏好设置依赖
  private 遮罩: HTMLElement | null = null
  private 当前分区 = 0
  private 搜索词 = ''

  constructor(依赖: 偏好设置依赖) {
    this.依赖 = 依赖
  }

  get 是否打开(): boolean {
    return this.遮罩 !== null
  }

  /**
   * 打开面板。已经打开时先关掉，避免叠出两层。
   *
   * @param 定位分区 打开后直接滚到该分区。菜单里的「导出设置」用它——
   *                 用户点的是"导出设置"，落在一个几十项的面板顶端
   *                 还得自己往下找，等于没定位。
   */
  打开(定位分区?: string): void {
    const 问题 = 校验设置表()
    if (问题.length > 0) {
      // 表里写了不存在的键：这是开发期错误，必须响亮地报出来。
      // 静默渲染的后果是"这一项点了没反应"，极难排查。
      console.error(`[偏好设置] 设置表引用了不存在的键：${问题.join('、')}`)
    }

    if (this.遮罩) this.关闭()
    this.搜索词 = ''

    // 定位分区：找不到就保持当前分区（不清零），
    // 免得名字写错时直接把用户丢回第一页却毫无提示。
    if (定位分区) {
      const 下标 = 偏好设置结构.findIndex((分) => 分.标题 === 定位分区)
      if (下标 >= 0) this.当前分区 = 下标
      else console.warn(`[偏好设置] 没有名为「${定位分区}」的分区`)
    }

    const 遮罩 = document.createElement('div')
    遮罩.className = 'selfmd-prefs-mask'

    const 面板 = document.createElement('div')
    面板.className = 'selfmd-prefs'

    const 左栏 = document.createElement('div')
    左栏.className = 'prefs-side'
    const 标题 = document.createElement('div')
    标题.className = 'prefs-title'
    标题.textContent = '偏好设置'
    左栏.append(标题)

    偏好设置结构.forEach((分区, 下标) => {
      const 标签 = document.createElement('button')
      标签.className = 'prefs-tab'
      标签.type = 'button'
      标签.dataset.分区 = String(下标)
      标签.textContent = 分区.标题
      标签.addEventListener('click', () => {
        this.当前分区 = 下标
        this.搜索词 = ''
        const 输入 = 面板.querySelector('.prefs-search') as HTMLInputElement | null
        if (输入) 输入.value = ''
        this.重绘()
      })
      左栏.append(标签)
    })

    const 右栏 = document.createElement('div')
    右栏.className = 'prefs-main'

    const 搜索行 = document.createElement('div')
    搜索行.className = 'prefs-search-row'
    const 搜索 = document.createElement('input')
    搜索.className = 'prefs-search'
    搜索.type = 'search'
    搜索.placeholder = '搜索设置项…'
    搜索.addEventListener('input', () => {
      this.搜索词 = 搜索.value.trim()
      this.重绘()
    })
    const 关闭钮 = document.createElement('button')
    关闭钮.className = 'selfmd-btn'
    关闭钮.type = 'button'
    关闭钮.textContent = '关闭'
    关闭钮.addEventListener('click', () => this.关闭())
    搜索行.append(搜索, 关闭钮)

    const 内容 = document.createElement('div')
    内容.className = 'prefs-body'

    右栏.append(搜索行, 内容)
    面板.append(左栏, 右栏)
    遮罩.append(面板)
    document.body.append(遮罩)

    this.遮罩 = 遮罩
    this.内容区 = 内容
    this.左栏区 = 左栏

    // Esc 关闭；捕获阶段监听，避免编辑器抢先处理
    document.addEventListener('keydown', this.键盘, true)
    遮罩.addEventListener('mousedown', (事件) => {
      if (事件.target === 遮罩) this.关闭()
    })

    this.重绘()
    搜索.focus()
  }

  private 内容区: HTMLElement | null = null
  private 左栏区: HTMLElement | null = null

  private 键盘 = (事件: KeyboardEvent): void => {
    if (事件.key === 'Escape') {
      事件.preventDefault()
      事件.stopPropagation()
      this.关闭()
    }
  }

  关闭(): void {
    if (!this.遮罩) return
    document.removeEventListener('keydown', this.键盘, true)
    this.遮罩.remove()
    this.遮罩 = null
    this.内容区 = null
    this.左栏区 = null
  }

  /** 面板开着时设置被外部改动，需要重绘以反映新值。 */
  刷新(): void {
    if (this.遮罩) this.重绘()
  }

  // ------------------------------------------------------------- 渲染 ----

  private 重绘(): void {
    const 内容 = this.内容区
    if (!内容) return

    // 左栏高亮：搜索时所有分区都不选中——结果已经跨分区平铺了
    for (const 按钮 of Array.from(this.左栏区?.querySelectorAll('.prefs-tab') ?? [])) {
      const 下标 = Number((按钮 as HTMLElement).dataset.分区)
      按钮.classList.toggle('active', this.搜索词 === '' && 下标 === this.当前分区)
    }

    内容.textContent = ''

    if (this.搜索词 !== '') {
      this.渲染搜索结果(内容)
      return
    }

    const 分区 = 偏好设置结构[this.当前分区]
    if (!分区) return

    for (const 小节 of 分区.小节) {
      const 块 = document.createElement('div')
      块.className = 'prefs-section'
      if (小节.标题) {
        const 标题 = document.createElement('h3')
        标题.textContent = 小节.标题
        块.append(标题)
      }
      if (小节.说明) {
        const 说明 = document.createElement('p')
        说明.className = 'prefs-note'
        说明.textContent = 小节.说明
        块.append(说明)
      }
      for (const 项 of 小节.项) 块.append(this.渲染一行(项))
      内容.append(块)
    }
  }

  private 渲染搜索结果(内容: HTMLElement): void {
    const 词 = this.搜索词.toLowerCase()
    const 块 = document.createElement('div')
    块.className = 'prefs-section'

    let 命中 = 0
    for (const 分区 of 偏好设置结构) {
      for (const 小节 of 分区.小节) {
        for (const 项 of 小节.项) {
          const 全 = `${项.标签} ${项.说明 ?? ''} ${String(项.键)}`.toLowerCase()
          if (!全.includes(词)) continue
          命中++
          // 搜索时带上分区名，否则用户不知道这一项属于哪里
          const 行 = this.渲染一行(项, 分区.标题)
          块.append(行)
        }
      }
    }

    if (命中 === 0) {
      const 空 = document.createElement('div')
      空.className = 'prefs-empty'
      空.textContent = `没有匹配「${this.搜索词}」的设置项`
      块.append(空)
    } else {
      const 计数 = document.createElement('p')
      计数.className = 'prefs-note'
      计数.textContent = `找到 ${命中} 项`
      块.prepend(计数)
    }

    内容.append(块)
  }

  private 渲染一行(项: 设置项, 来源分区?: string): HTMLElement {
    const 行 = document.createElement('div')
    行.className = 'prefs-row'
    行.dataset.键 = String(项.键)

    const 标签区 = document.createElement('div')
    标签区.className = 'prefs-label'
    const 名 = document.createElement('div')
    名.className = 'prefs-name'
    名.textContent = 项.标签
    标签区.append(名)
    if (来源分区) {
      const 来源 = document.createElement('div')
      来源.className = 'prefs-source'
      来源.textContent = 来源分区
      标签区.append(来源)
    }
    if (项.说明) {
      const 说明 = document.createElement('div')
      说明.className = 'prefs-hint'
      说明.textContent = 项.说明
      标签区.append(说明)
    }

    const 控件区 = document.createElement('div')
    控件区.className = 'prefs-control'
    控件区.append(this.渲染控件(项))

    行.append(标签区, 控件区)
    return 行
  }

  private 渲染控件(项: 设置项): HTMLElement {
    const 设置 = this.依赖.取设置()
    const 当前值 = 设置[项.键]

    if (项.类型 === '开关') {
      const 框 = document.createElement('input')
      框.type = 'checkbox'
      框.checked = Boolean(当前值)
      框.addEventListener('change', () => void this.提交(项.键, 框.checked))
      return 框
    }

    if (项.类型 === '下拉') {
      const 选 = document.createElement('select')
      for (const 选项 of 项.选项 ?? []) {
        const 条 = document.createElement('option')
        条.value = 选项.值
        条.textContent = 选项.文字
        选.append(条)
      }
      选.value = String(当前值 ?? '')
      选.addEventListener('change', () => void this.提交(项.键, 选.value))
      return 选
    }

    if (项.类型 === '数字') {
      const 盒 = document.createElement('div')
      盒.className = 'prefs-number'
      const 数 = document.createElement('input')
      数.type = 'number'
      数.value = String(当前值 ?? 0)
      if (项.最小 !== undefined) 数.min = String(项.最小)
      if (项.最大 !== undefined) 数.max = String(项.最大)
      if (项.步长 !== undefined) 数.step = String(项.步长)
      // 用 change 而不是 input：拖数字框的箭头或长按删除键时，
      // input 会在每一个中间值上触发一次写盘，产生一串无意义的历史。
      数.addEventListener('change', () => {
        const 值 = Number(数.value)
        if (!Number.isFinite(值)) return
        const 夹紧 = Math.min(项.最大 ?? 值, Math.max(项.最小 ?? 值, 值))
        if (夹紧 !== 值) 数.value = String(夹紧)
        void this.提交(项.键, 夹紧)
      })
      盒.append(数)
      if (项.单位) {
        const 单位 = document.createElement('span')
        单位.className = 'prefs-unit'
        单位.textContent = 项.单位
        盒.append(单位)
      }
      return 盒
    }

    // 列表：值本身是数组，用一个逗号分隔的输入框编辑。
    //
    // 不引入"添加/删除条目"的复杂控件：这些列表都很短（词典语言、扩展名），
    // 手打逗号比点加号快。但**解析要容错**——用户会打成中文逗号、
    // 会在逗号后多打空格，这些都不该变成空条目。
    if (项.类型 === '列表') {
      const 输 = document.createElement('input')
      输.type = 'text'
      输.value = Array.isArray(当前值) ? (当前值 as string[]).join(', ') : String(当前值 ?? '')
      输.addEventListener('change', () => {
        const 条目 = [
          ...new Set(
            输.value
              .split(/[,，]/)
              .map((段) => 段.trim())
              .filter((段) => 段.length > 0)
          )
        ]
        // 回写规范化后的文本，让用户看到实际存下来的样子
        输.value = 条目.join(', ')
        void this.提交(项.键, 条目)
      })
      return 输
    }

    // 文本（也用于展示只读值）
    const 输 = document.createElement('input')
    输.type = 'text'
    输.value = String(当前值 ?? '')
    const 只读值 = this.依赖.取只读值?.(项.键)
    if (只读值 !== null && 只读值 !== undefined) {
      输.value = 只读值
      // 只读项（例如「当前主题」）在界面上不可编辑——它由别的入口决定
      输.readOnly = true
      输.classList.add('prefs-readonly')
    }
    输.addEventListener('change', () => void this.提交(项.键, 输.value))
    return 输
  }

  private async 提交(键: keyof Settings, 值: unknown): Promise<void> {
    try {
      await this.依赖.应用设置({ [键]: 值 } as Partial<Settings>)
    } catch (错误) {
      console.error('[偏好设置] 写入失败：', 错误)
    }
  }
}
