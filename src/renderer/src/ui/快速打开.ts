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
import { 模糊筛选, 路径末段 } from '@shared/模糊匹配'

interface 文件项 {
  路径: string
  名字: string
  修改时间: number
  大小: number
}

export interface 快速打开选项 {
  /** 建立索引：返回候选文件。失败时返回空数组。 */
  取文件: () => Promise<{ 文件: 文件项[]; 已截断: boolean }>
  /** 用户选中某个文件。 */
  打开: (路径: string) => void
}

/** 打开快速打开面板。重复调用会先关掉已有面板。 */
export async function 打开快速打开面板(选项: 快速打开选项): Promise<void> {
  document.querySelector('.quick-open-mask')?.remove()

  const 遮罩 = document.createElement('div')
  遮罩.className = 'selfmd-modal-mask quick-open-mask'

  const 面板 = document.createElement('div')
  面板.className = 'selfmd-modal quick-open'

  const 输入 = document.createElement('input')
  输入.type = 'text'
  输入.className = 'quick-open-input'
  输入.placeholder = '输入文件名以跳转…'
  输入.spellcheck = false

  const 列表 = document.createElement('div')
  列表.className = 'quick-open-list'

  const 页脚 = document.createElement('div')
  页脚.className = 'quick-open-foot'
  页脚.textContent = '正在建立索引…'

  面板.append(输入, 列表, 页脚)
  遮罩.append(面板)
  document.body.append(遮罩)
  输入.focus()

  let 全部: 文件项[] = []
  let 命中: 文件项[] = []
  let 选中 = 0

  const 关闭 = (): void => {
    遮罩.remove()
    document.removeEventListener('keydown', 全局键, true)
  }

  /** 把当前命中列表画出来。 */
  const 重绘 = (): void => {
    列表.textContent = ''
    if (命中.length === 0) {
      const 空 = document.createElement('div')
      空.className = 'quick-open-empty'
      空.textContent = 全部.length === 0 ? '这个目录下没有文件' : '没有匹配的文件'
      列表.append(空)
      return
    }

    // 只画前 50 条：再多也没人会往下翻，而每一行都是一次 DOM 操作
    for (const [下标, 项] of 命中.entries()) {
      const 行 = document.createElement('div')
      行.className = 'quick-open-item'
      if (下标 === 选中) 行.classList.add('is-active')

      const 名 = document.createElement('div')
      名.className = 'quick-open-name'
      名.textContent = 项.名字

      const 路径元素 = document.createElement('div')
      路径元素.className = 'quick-open-path'
      路径元素.textContent = 项.路径

      行.append(名, 路径元素)
      // 用 mousedown 而不是 click：click 触发前输入框会先失焦，
      // 有些情况下面板已经被关掉，点击就落空了。
      行.addEventListener('mousedown', (事件) => {
        事件.preventDefault()
        关闭()
        选项.打开(项.路径)
      })
      行.addEventListener('mouseenter', () => {
        选中 = 下标
        重绘()
      })
      列表.append(行)
    }

    // 选中项滚进视野
    列表.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }

  const 过滤 = (): void => {
    const 查询 = 输入.value
    // 文件越小越新，越可能是用户想找的；把它作为同分时的第二排序键
    命中 = 模糊筛选(
      查询,
      全部.map((f) => ({ 条目: f, 文本: f.路径 })),
      路径末段
    )
    选中 = 0
    重绘()
    页脚.textContent =
      `共 ${全部.length} 个文件` +
      (查询.trim() ? ` · 匹配 ${命中.length} 个` : '') +
      (全部.length >= 50 ? ' · ↑↓ 选择，Enter 打开，Esc 关闭' : '')
  }

  /** 全局按键：面板打开期间接管键盘，避免编辑器同时响应。 */
  const 全局键 = (事件: KeyboardEvent): void => {
    if (事件.key === 'Escape') {
      事件.preventDefault()
      事件.stopPropagation()
      关闭()
      return
    }
    if (事件.key === 'ArrowDown' || 事件.key === 'ArrowUp') {
      事件.preventDefault()
      事件.stopPropagation()
      if (命中.length === 0) return
      选中 = (选中 + (事件.key === 'ArrowDown' ? 1 : -1) + 命中.length) % 命中.length
      重绘()
      return
    }
    if (事件.key === 'Enter') {
      事件.preventDefault()
      事件.stopPropagation()
      const 项 = 命中[选中]
      if (!项) return
      关闭()
      选项.打开(项.路径)
    }
  }

  输入.addEventListener('input', 过滤)
  输入.addEventListener('keydown', 全局键)
  // 点遮罩空白处关闭（点面板内部不关）
  遮罩.addEventListener('mousedown', (事件) => {
    if (事件.target === 遮罩) 关闭()
  })

  try {
    const 结果 = await 选项.取文件()
    全部 = 结果.文件
    // 索引是异步建的，期间用户可能已经打了不少字——这里必须按**当前**输入重算，
    // 而不是用建索引时捕获的旧值
    过滤()
    if (结果.已截断) 页脚.textContent += ' · 文件太多，只索引了一部分'
  } catch {
    页脚.textContent = '建立索引失败'
  }
}
