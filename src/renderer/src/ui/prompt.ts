/**
 * 极简模态输入框。
 *
 * Electron 没有内置的"输入一行文本"对话框（只有消息框与文件选择），而插入网络
 * 图片、重命名这类操作都需要一个。与其为每个场景各做一个弹窗，不如提供一个
 * 统一的实现。
 *
 * 刻意不引入 UI 框架：整个输入框只有几十行 DOM 操作，用框架反而要牵进构建配置。
 */

export interface promptOptions {
  title: string
  /** 初始值。 */
  initialValue?: string
   /** 占位提示。 */
  placeholder?: string
  /** 标题下方的一段说明文字。 */
  description?: string
  /** 确定按钮文字。 */
  confirmText?: string
}

/** 打开一个输入框；用户取消时返回 null。 */
export function promptText(options: promptOptions): Promise<string | null> {
  return new Promise((done) => {
    const overlay = document.createElement('div')
    overlay.className = 'selfmd-modal-mask'

    const boxEl = document.createElement('div')
    boxEl.className = 'selfmd-modal'

    const title = document.createElement('div')
    title.className = 'selfmd-modal-title'
    title.textContent = options.title

    if (options.description) {
      boxEl.append(title)
      const description = document.createElement('div')
      description.className = 'selfmd-modal-desc'
      description.textContent = options.description
      boxEl.append(description)
    }

    const input = document.createElement('input')
    input.className = 'selfmd-modal-input'
    input.type = 'text'
    input.value = options.initialValue ?? ''
    if (options.placeholder) input.placeholder = options.placeholder

    const buttonRow = document.createElement('div')
    buttonRow.className = 'selfmd-modal-buttons'

    const cancel = document.createElement('button')
    cancel.className = 'selfmd-btn'
    cancel.textContent = '取消'

    const confirmIt = document.createElement('button')
    confirmIt.className = 'selfmd-btn selfmd-btn-primary'
    confirmIt.textContent = options.confirmText ?? '确定'

    /** 收尾：移除 DOM、解绑键盘、回传结果。所有出口都必须走这里。 */
    let closed = false
    const finalize = (value: string | null): void => {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', keyboard, true)
      overlay.remove()
      done(value)
    }

    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finalize(null)
      } else if (event.key === 'Enter' && !event.isComposing) {
        // 输入法正在组字时按回车是"选词"，不能当成确定。
        event.preventDefault()
        event.stopPropagation()
        finalize(input.value.trim())
      }
    }

    cancel.addEventListener('click', () => finalize(null))
    confirmIt.addEventListener('click', () => finalize(input.value.trim()))
    // 点击遮罩空白处等同取消，但不影响点击盒子内部。
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finalize(null)
    })

    buttonRow.append(cancel, confirmIt)
    // 标题与说明已在上面按需 append，这里只补剩余部分
    if (!options.description) boxEl.append(title)
    boxEl.append(input, buttonRow)
    overlay.append(boxEl)
    document.body.append(overlay)

    // 捕获阶段监听，避免编辑器抢先处理回车与 Esc。
    document.addEventListener('keydown', keyboard, true)
    input.focus()
    input.select()
  })
}
