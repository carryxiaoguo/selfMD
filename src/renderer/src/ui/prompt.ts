/**
 * 极简模态输入框。
 *
 * Electron 没有内置的"输入一行文本"对话框（只有消息框与文件选择），而插入网络
 * 图片、重命名这类操作都需要一个。与其为每个场景各做一个弹窗，不如提供一个
 * 统一的实现。
 *
 * 刻意不引入 UI 框架：整个输入框只有几十行 DOM 操作，用框架反而要牵进构建配置。
 */

export interface 询问选项 {
  title: string
  /** 初始值。 */
  初值?: string
   /** 占位提示。 */
  占位?: string
  /** 标题下方的一段说明文字。 */
  description?: string
  /** 确定按钮文字。 */
  确定文字?: string
}

/** 打开一个输入框；用户取消时返回 null。 */
export function 询问文本(options: 询问选项): Promise<string | null> {
  return new Promise((done) => {
    const overlay = document.createElement('div')
    overlay.className = 'selfmd-modal-mask'

    const 盒子 = document.createElement('div')
    盒子.className = 'selfmd-modal'

    const title = document.createElement('div')
    title.className = 'selfmd-modal-title'
    title.textContent = options.title

    if (options.description) {
      盒子.append(title)
      const description = document.createElement('div')
      description.className = 'selfmd-modal-desc'
      description.textContent = options.description
      盒子.append(description)
    }

    const input = document.createElement('input')
    input.className = 'selfmd-modal-input'
    input.type = 'text'
    input.value = options.初值 ?? ''
    if (options.占位) input.placeholder = options.占位

    const 按钮行 = document.createElement('div')
    按钮行.className = 'selfmd-modal-buttons'

    const 取消 = document.createElement('button')
    取消.className = 'selfmd-btn'
    取消.textContent = '取消'

    const 确定 = document.createElement('button')
    确定.className = 'selfmd-btn selfmd-btn-primary'
    确定.textContent = options.确定文字 ?? '确定'

    /** 收尾：移除 DOM、解绑键盘、回传结果。所有出口都必须走这里。 */
    let 已关闭 = false
    const 收尾 = (value: string | null): void => {
      if (已关闭) return
      已关闭 = true
      document.removeEventListener('keydown', keyboard, true)
      overlay.remove()
      done(value)
    }

    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        收尾(null)
      } else if (event.key === 'Enter' && !event.isComposing) {
        // 输入法正在组字时按回车是"选词"，不能当成确定。
        event.preventDefault()
        event.stopPropagation()
        收尾(input.value.trim())
      }
    }

    取消.addEventListener('click', () => 收尾(null))
    确定.addEventListener('click', () => 收尾(input.value.trim()))
    // 点击遮罩空白处等同取消，但不影响点击盒子内部。
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) 收尾(null)
    })

    按钮行.append(取消, 确定)
    // 标题与说明已在上面按需 append，这里只补剩余部分
    if (!options.description) 盒子.append(title)
    盒子.append(input, 按钮行)
    overlay.append(盒子)
    document.body.append(overlay)

    // 捕获阶段监听，避免编辑器抢先处理回车与 Esc。
    document.addEventListener('keydown', keyboard, true)
    input.focus()
    input.select()
  })
}
