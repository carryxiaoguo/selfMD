/**
 * 轻量上下文菜单。
 *
 * 用 DOM 自绘而不是 Electron 的原生 `Menu.popup()`，理由是**返回值**：
 * 原生菜单要通过 IPC 往返才能在渲染层拿到"用户点了哪一项"，
 * 而菜单项的动作大多只改文档（转换语法、改引用），本就在渲染层。
 * 自绘省掉一次往返，也让菜单项能直接读当前编辑器状态来决定是否置灰。
 *
 * 该收尾的地方一处都不能漏：滚动、窗口缩放、点击别处、按 Esc，
 * 只要漏一个，菜单就会"粘"在屏幕上。所以统一走 `关闭()`。
 */

export interface 菜单项 {
  /** 显示文字。分隔项可以省略。 */
  文字?: string
  /** 点击后的动作。省略即为不可点（配合 `禁用` 或纯标题）。 */
  动作?: () => void
   /** 插入一条分隔线；其余字段忽略。 */
  分隔?: boolean
  禁用?: boolean
  /** 右侧显示的快捷键提示，纯展示。 */
  提示?: string
  /** 在文字前显示一个勾。 */
  勾选?: boolean
  /** 危险操作（删除类），文字用警示色。 */
  危险?: boolean
}

let 当前菜单: HTMLElement | null = null
let 清理函数: (() => void) | null = null

/** 关掉当前菜单；没有菜单时什么也不做。 */
export function 关闭菜单(): void {
  if (清理函数) {
    清理函数()
    清理函数 = null
  }
  当前菜单?.remove()
  当前菜单 = null
}

/**
 * 在指定位置弹出菜单。
 *
 * @param 位置 视口坐标（通常取自 `MouseEvent.clientX/clientY`）
 */
export function 弹出菜单(位置: { x: number; y: number }, 项们: 菜单项[]): void {
  关闭菜单()

  const 菜单 = document.createElement('div')
  菜单.className = 'selfmd-menu'
  菜单.setAttribute('role', 'menu')

  for (const 项 of 项们) {
    if (项.分隔) {
      const 线 = document.createElement('div')
      线.className = 'selfmd-menu-sep'
      菜单.append(线)
      continue
    }

    const 行 = document.createElement('button')
    行.className = 'selfmd-menu-item'
    行.type = 'button'
    行.setAttribute('role', 'menuitem')
    // 没有动作的一律当标题处理，视觉上也区分开
    const 可点 = Boolean(项.动作) && !项.禁用
    if (!可点) 行.classList.add('disabled')
    if (项.危险) 行.classList.add('danger')
    行.disabled = !可点

    const 勾 = document.createElement('span')
    勾.className = 'selfmd-menu-check'
    勾.textContent = 项.勾选 ? '✓' : ''

    const 文 = document.createElement('span')
    文.className = 'selfmd-menu-label'
    文.textContent = 项.文字 ?? ''

    行.append(勾, 文)

    if (项.提示) {
      const 提示 = document.createElement('span')
      提示.className = 'selfmd-menu-hint'
      提示.textContent = 项.提示
      行.append(提示)
    }

    if (可点) {
      行.addEventListener('click', (事件) => {
        事件.preventDefault()
        事件.stopPropagation()
        关闭菜单()
        项.动作?.()
      })
    }

    菜单.append(行)
  }

  // 先挂到 DOM 才能量尺寸，量完再定位，避免先闪一下再跳到正确位置
  document.body.append(菜单)
  const 宽 = 菜单.offsetWidth
  const 高 = 菜单.offsetHeight
  // 贴边时向内收，否则菜单会被窗口裁掉一半
  const x = Math.min(位置.x, window.innerWidth - 宽 - 6)
  const y = Math.min(位置.y, window.innerHeight - 高 - 6)
  菜单.style.left = `${Math.max(6, x)}px`
  菜单.style.top = `${Math.max(6, y)}px`

  当前菜单 = 菜单

  // --- 收尾：四个来源任意一个触发都关掉 ---
  const 按下别处 = (事件: MouseEvent): void => {
    if (!菜单.contains(事件.target as Node)) 关闭菜单()
  }
  const 按键 = (事件: KeyboardEvent): void => {
    if (事件.key === 'Escape') {
      事件.preventDefault()
      事件.stopPropagation()
      关闭菜单()
    }
  }
  // 滚动与缩放会让菜单脱离原位，与其跟着重算不如直接关掉
  const 滚动 = (): void => 关闭菜单()

  // 用捕获阶段：编辑器会吞掉一部分事件，冒泡到不了 document
  document.addEventListener('mousedown', 按下别处, true)
  document.addEventListener('keydown', 按键, true)
  window.addEventListener('resize', 滚动)
  window.addEventListener('blur', 滚动)
  // `scroll` 不冒泡，但捕获阶段能收到任意滚动容器的滚动
  document.addEventListener('scroll', 滚动, true)

  清理函数 = (): void => {
    document.removeEventListener('mousedown', 按下别处, true)
    document.removeEventListener('keydown', 按键, true)
    window.removeEventListener('resize', 滚动)
    window.removeEventListener('blur', 滚动)
    document.removeEventListener('scroll', 滚动, true)
  }
}
