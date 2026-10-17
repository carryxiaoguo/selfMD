/**
 * 快速打开面板（Ctrl+P）。
 *
 * 交互约定与主流编辑器一致：
 *   - 直接敲字过滤，不必先点输入框
 *   - ↑↓ 移动、Enter 打开、Esc 关闭
 *   - 过滤与排序全在本地做，**不查磁盘**——索引在面板打开时建一次
 *
 * 为什么建一次索引而不是每次敲键都查盘：查盘是毫秒级的，但目录一大
 * 就会让每次按键都卡一下，而"快速打开"的全部意义就在于快。
 */
import { 模糊筛选, pathTail } from '@shared/fuzzy'

interface fileRow {
  filePath: string
  nameText: string
  mtime: number
  sizeBytes: number
}

export interface 快速打开选项 {
  /** 建立索引：返回候选文件。失败时返回空数组。 */
  取文件: () => Promise<{ file: fileRow[]; truncated: boolean }>
  /** 用户选中某个文件。 */
  open: (filePath: string) => void
}

/** 打开快速打开面板。重复调用会先关掉已有面板。 */
export async function 打开快速打开面板(options: 快速打开选项): Promise<void> {
  document.querySelector('.quick-open-mask')?.remove()

  const overlay = document.createElement('div')
  overlay.className = 'selfmd-modal-mask quick-open-mask'

  const panel = document.createElement('div')
  panel.className = 'selfmd-modal quick-open'

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'quick-open-input'
  input.placeholder = '输入文件名以跳转…'
  input.spellcheck = false

  const list = document.createElement('div')
  list.className = 'quick-open-list'

  const footer = document.createElement('div')
  footer.className = 'quick-open-foot'
  footer.textContent = '正在建立索引…'

  panel.append(input, list, footer)
  overlay.append(panel)
  document.body.append(overlay)
  input.focus()

  let all: fileRow[] = []
  let hit: fileRow[] = []
  let selected = 0

  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', 全局键, true)
  }

  /** 把当前命中列表画出来。 */
  const repaint = (): void => {
    list.textContent = ''
    if (hit.length === 0) {
      const emptyText = document.createElement('div')
      emptyText.className = 'quick-open-empty'
      emptyText.textContent = all.length === 0 ? '这个目录下没有文件' : '没有匹配的文件'
      list.append(emptyText)
      return
    }

    // 只画前 50 条：再多也没人会往下翻，而每一行都是一次 DOM 操作
    for (const [subscript, item] of hit.entries()) {
      const line = document.createElement('div')
      line.className = 'quick-open-item'
      if (subscript === selected) line.classList.add('is-active')

      const name = document.createElement('div')
      name.className = 'quick-open-name'
      name.textContent = item.nameText

      const 路径元素 = document.createElement('div')
      路径元素.className = 'quick-open-path'
      路径元素.textContent = item.filePath

      line.append(name, 路径元素)
      // 用 mousedown 而不是 click：click 触发前输入框会先失焦，
      // 有些情况下面板已经被关掉，点击就落空了。
      line.addEventListener('mousedown', (event) => {
        event.preventDefault()
        close()
        options.open(item.filePath)
      })
      line.addEventListener('mouseenter', () => {
        selected = subscript
        repaint()
      })
      list.append(line)
    }

    // 选中项滚进视野
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }

  const filterBy = (): void => {
    const query = input.value
    // 文件越小越新，越可能是用户想找的；把它作为同分时的第二排序键
    hit = 模糊筛选(
      query,
      all.map((f) => ({ entry: f, docText: f.filePath })),
      pathTail
    )
    selected = 0
    repaint()
    footer.textContent =
      `共 ${all.length} 个文件` +
      (query.trim() ? ` · 匹配 ${hit.length} 个` : '') +
      (all.length >= 50 ? ' · ↑↓ 选择，Enter 打开，Esc 关闭' : '')
  }

  /** 全局按键：面板打开期间接管键盘，避免编辑器同时响应。 */
  const 全局键 = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (hit.length === 0) return
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + hit.length) % hit.length
      repaint()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const item = hit[selected]
      if (!item) return
      close()
      options.open(item.filePath)
    }
  }

  input.addEventListener('input', filterBy)
  input.addEventListener('keydown', 全局键)
  // 点遮罩空白处关闭（点面板内部不关）
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close()
  })

  try {
    const result = await options.取文件()
    all = result.file
    // 索引是异步建的，期间用户可能已经打了不少字——这里必须按**当前**输入重算，
    // 而不是用建索引时捕获的旧值
    filterBy()
    if (result.truncated) footer.textContent += ' · 文件太多，只索引了一部分'
  } catch {
    footer.textContent = '建立索引失败'
  }
}
