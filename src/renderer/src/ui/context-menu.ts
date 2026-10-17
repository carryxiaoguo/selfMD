/**
 * 轻量上下文菜单。
 *
 * 用 DOM 自绘而不是 Electron 的原生 `Menu.popup()`，理由是**返回值**：
 * 原生菜单要通过 IPC 往返才能在渲染层拿到"用户点了哪一项"，
 * 而菜单项的动作大多只改文档（转换语法、改引用），本就在渲染层。
 * 自绘省掉一次往返，也让菜单项能直接读当前编辑器状态来决定是否置灰。
 *
 * 该收尾的地方一处都不能漏：滚动、窗口缩放、点击别处、按 Esc，
 * 只要漏一个，菜单就会"粘"在屏幕上。所以统一走 `关闭菜单()`。
 */

export interface menuItem {
  /** 显示文字。分隔项可以省略。 */
  text?: string
  /** 点击后的动作。省略即为不可点（配合 `禁用` 或纯标题）。 */
  action?: () => void
  /** 插入一条分隔线；其余字段忽略。 */
  separator?: boolean
  disabled?: boolean
  /** 右侧显示的快捷键提示，纯展示。 */
  hint?: string
  /** 在文字前显示一个勾。 */
  checked?: boolean
  /** 危险操作（删除类），文字用警示色。 */
  dangerFlag?: boolean
  /**
   * 子菜单。
   *
   * 与主流 Markdown 编辑器一致：段落类型、格式这类"一族"的操作收进子菜单，
   * 否则一次要列出二十多项，找一项得扫半屏。
   */
  children?: menuItem[]
}

let currentMenu: HTMLElement | null = null
let activeSubmenu: HTMLElement | null = null
let cleanupFn: (() => void) | null = null

/** 关掉当前菜单；没有菜单时什么也不做。 */
export function closeMenu(): void {
  closeSubmenu()
  cleanupFn?.()
  cleanupFn = null
  currentMenu?.remove()
  currentMenu = null
}

/** 菜单当前是否打开。 */
export function isMenuOpen(): boolean {
  return currentMenu !== null
}

function closeSubmenu(): void {
  activeSubmenu?.remove()
  activeSubmenu = null
}

/**
 * 按菜单项数组建出一个菜单元素。
 *
 * 抽成函数是为了让子菜单复用同一套渲染——各写一份的话，
 * 勾选、置灰、快捷键提示这些细节迟早只有一边对。
 *
 * @param 是子菜单 子菜单不注册全局收尾，它的生死由父菜单管
 */
function 建立菜单(items: menuItem[], 是子菜单 = false): HTMLElement {
  const menu = document.createElement('div')
  menu.className = 是子菜单 ? 'selfmd-menu selfmd-submenu' : 'selfmd-menu'
  menu.setAttribute('role', 'menu')

  for (const item of items) {
    if (item.separator) {
      const 线 = document.createElement('div')
      线.className = 'selfmd-menu-sep'
      menu.append(线)
      continue
    }

    const line = document.createElement('button')
    line.className = 'selfmd-menu-item'
    line.type = 'button'
    line.setAttribute('role', 'menuitem')

    const 有子项 = Boolean(item.children && item.children.length > 0) && !item.disabled
    // 没有动作的一律当标题处理，视觉上也区分开。
    // 有子项的行不执行动作，但它**是可点的**——置灰会让人以为整族都不可用。
    const clickable = (Boolean(item.action) || 有子项) && !item.disabled
    if (!clickable) line.classList.add('disabled')
    if (item.dangerFlag) line.classList.add('danger')
    line.disabled = !clickable

    const checkMark = document.createElement('span')
    checkMark.className = 'selfmd-menu-check'
    checkMark.textContent = item.checked ? '✓' : ''

    const txt = document.createElement('span')
    txt.className = 'selfmd-menu-label'
    txt.textContent = item.text ?? ''

    line.append(checkMark, txt)

    if (item.hint) {
      const hint = document.createElement('span')
      hint.className = 'selfmd-menu-hint'
      hint.textContent = item.hint
      line.append(hint)
    }

    if (有子项) {
      const arrowGlyph = document.createElement('span')
      arrowGlyph.className = 'selfmd-menu-arrow'
      arrowGlyph.textContent = '▸'
      line.append(arrowGlyph)
      line.classList.add('has-submenu')

      // 用 hover 展开而不是 click：菜单的惯例是"指过去就开"，
      // 要多点一次会让人以为这一项是禁用的。
      line.addEventListener('mouseenter', () => 展开子菜单(line, item.children ?? []))
      // 离开时收起，但要把"指针正移向子菜单"的情况排除掉——
      // 否则指针一离开行、还没进子菜单，子菜单就没了，永远点不到。
      line.addEventListener('mouseleave', (event) => {
        const related = event.relatedTarget as Node | null
        if (related && activeSubmenu?.contains(related)) return
        closeSubmenu()
      })

      menu.append(line)
      continue
    }

    // 鼠标扫过任何一行都收起子菜单——同层的兄弟行展开新子菜单前，
    // 旧的那个必须先消失，否则屏幕上会同时挂两层。
    line.addEventListener('mouseenter', closeSubmenu)

    if (clickable) {
      line.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        closeMenu()
        item.action?.()
      })
    }

    menu.append(line)
  }

  return menu
}

/** 在某一行右侧展开子菜单；右边放不下就翻到左侧。 */
function 展开子菜单(宿主行: HTMLElement, items: menuItem[]): void {
  closeSubmenu()

  const child = 建立菜单(items, true)
  document.body.append(child)

  const rowRect = 宿主行.getBoundingClientRect()
  const width = child.offsetWidth

  // 优先右侧；右边塞不下就翻到左侧。窄窗口下这是唯一能看全的办法。
  const rightward = rowRect.right
  const leftward = rightward + width > window.innerWidth - 6 ? rowRect.left - width : rightward
  child.style.left = `${Math.max(6, leftward)}px`
  child.style.top = `${Math.min(rowRect.top, window.innerHeight - child.offsetHeight - 6)}px`

  // 指针从宿主行移进子菜单的途中会经过这里，所以子菜单也要接管
  child.addEventListener('mouseleave', (event) => {
    const related = event.relatedTarget as Node | null
    if (related && (child.contains(related) || 宿主行.contains(related))) return
    closeSubmenu()
  })

  activeSubmenu = child
}

/**
 * 弹出菜单。
 *
 * @param 位置 视口坐标（通常取自 `MouseEvent.clientX/clientY`）
 */
export function popupMenu(position: { x: number; y: number }, items: menuItem[]): void {
  closeMenu()

  const menu = 建立菜单(items)

  // 先挂到 DOM 才能量尺寸，量完再定位，避免先闪一下再跳到正确位置
  document.body.append(menu)
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  // 贴边时向内收，否则菜单会被窗口裁掉一半
  const x = Math.min(position.x, window.innerWidth - width - 6)
  const y = Math.min(position.y, window.innerHeight - height - 6)
  menu.style.left = `${Math.max(6, x)}px`
  menu.style.top = `${Math.max(6, y)}px`

  currentMenu = menu

  // --- 收尾：任何一个来源触发都关掉 ---
  const 按下别处 = (event: MouseEvent): void => {
    const target = event.target as Node
    // 子菜单挂在 body 上，不在父菜单的 contains 里，
    // 漏掉它会让"点子菜单里的项"先触发关闭、动作再也执行不到。
    if (menu.contains(target) || activeSubmenu?.contains(target)) return
    closeMenu()
  }
  const 按键 = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
    }
  }
  // 滚动与缩放会让菜单脱离原位，与其跟着重算不如直接关掉
  const scroll = (): void => closeMenu()

  // 用捕获阶段：编辑器会吞掉一部分事件，冒泡到不了 document
  document.addEventListener('mousedown', 按下别处, true)
  document.addEventListener('keydown', 按键, true)
  window.addEventListener('resize', scroll)
  window.addEventListener('blur', scroll)
  // `scroll` 不冒泡，但捕获阶段能收到任意滚动容器的滚动
  document.addEventListener('scroll', scroll, true)

  cleanupFn = (): void => {
    document.removeEventListener('mousedown', 按下别处, true)
    document.removeEventListener('keydown', 按键, true)
    window.removeEventListener('resize', scroll)
    window.removeEventListener('blur', scroll)
    document.removeEventListener('scroll', scroll, true)
  }
}
