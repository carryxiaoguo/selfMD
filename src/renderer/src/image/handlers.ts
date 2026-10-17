import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { 扩展名由类型, 时间戳图片名, 是图片文件 } from '@shared/image-path'
import {
  type 插入请求,
  本次目标目录,
  从地址插入,
  从剪贴板插入,
  从文件插入
} from './insert'

/**
 * 粘贴与拖放的图片入口。
 *
 * 这两条路径是用户真正会用的——"复制一张图，切到编辑器按 Ctrl+V"远比走菜单
 * 顺手。难点全在**判断这一次粘贴/拖放到底是不是图片**：
 *
 *   - 判错了会导致普通文字粘贴被吞掉（最糟的情况：用户以为编辑器坏了）
 *   - 判漏了会退化成把一张二进制图当文本插进文档
 *
 * 所以策略是**只在有把握时才接管**，其余一律放行给默认行为。
 */

export interface 图片处理依赖 {
  /** 构造插入请求；编辑器尚未就绪时返回 null。 */
  构造请求: () => 插入请求 | null
  /** 用户可见的提示。 */
  hint: (消息: string) => void
}

/** 把 File 读成不含前缀的 base64。 */
function 读为base64(file: File): Promise<string> {
  return new Promise((done, failure) => {
    const 读者 = new FileReader()
    读者.onload = () => {
      const result = String(读者.result ?? '')
      const 逗号 = result.indexOf(',')
      done(逗号 >= 0 ? result.slice(逗号 + 1) : '')
    }
    读者.onerror = () => failure(读者.error)
    读者.readAsDataURL(file)
  })
}

/** 从 File 对象取磁盘路径；浏览器拖来的图没有路径，返回空串。 */
function 取磁盘路径(file: File): string {
  try {
    return window.selfmdExtra.webUtils.pathForFile(file) || ''
  } catch {
    return ''
  }
}

/** 拖放/粘贴进来的 File 列表里，第一张图片。 */
function 找图片文件(list: FileList | null | undefined): File | null {
  if (!list) return null
  for (const file of Array.from(list)) {
    if (file.type.startsWith('image/') || 是图片文件(file.name)) return file
  }
  return null
}

export function 图片粘贴与拖放(deps: 图片处理依赖): Extension {
  /** 处理"有图片文件"的公共路径。 */
  const 处理文件 = async (file: File): Promise<void> => {
    const request = deps.构造请求()
    if (!request) return

    const filePath = 取磁盘路径(file)
    if (filePath && 是图片文件(filePath)) {
      const result = await 从文件插入(request, [filePath])
      if (result.error) deps.hint(result.error)
      return
    }

    // 没有磁盘路径（从浏览器或截图工具拖来的）：把字节读出来再落盘。
    // 这条分支必须存在，否则"从网页拖一张图进来"会完全没反应。
    try {
      const data = await 读为base64(file)
      if (!data) {
        deps.hint('无法读取图片数据。')
        return
      }
      const 扩展 = 扩展名由类型(file.type) ?? '.png'
      const name = `${时间戳图片名(new Date())}${扩展}`
      const dir = await 本次目标目录(request)
      if (!dir) return
      const 写回 = await window.selfmd.image.saveBytes(dir, name, data)
      if (!写回) {
        deps.hint('写入图片失败。')
        return
      }
      // 复用从文件插入的收尾逻辑：把写好的路径再走一遍完整流程，
      // 避免在这里重复实现一遍引用生成。
      const result = await 从文件插入(request, [写回.filePath])
      if (result.error) deps.hint(result.error)
    } catch (error) {
      deps.hint(`读取图片失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return EditorView.domEventHandlers({
    paste(event) {
      const data = event.clipboardData
      if (!data) return false

      // 1) 剪贴板里就有图片文件（从资源管理器复制、截图工具等）
      const image = 找图片文件(data.files)
      if (image) {
        // 有图就一定要 preventDefault：否则浏览器还会把图片当文件路径插成文本。
        event.preventDefault()
        void 处理文件(image)
        return true
      }

      // 2) 没有文件，但要区分"纯文本粘贴"与"位图粘贴"。
      //    只要有非空文本，就放行给默认行为——绝不能吞掉正常粘贴。
      const docText = data.getData('text/plain')
      if (docText && docText.length > 0) return false
      const 网页 = data.getData('text/html')
      if (网页 && 网页.length > 0) return false

      // 3) 到这里说明剪贴板既没有文件也没有文本，多半是一张位图。
      //    真实判定交给主进程（它能读系统剪贴板），失败时不影响用户。
      event.preventDefault()
      void (async () => {
        const request = deps.构造请求()
        if (!request) return
        const result = await 从剪贴板插入(request)
        if (result.okCount === 0 && result.error && result.error !== '剪贴板里没有图片。') {
          deps.hint(result.error)
        }
      })()
      return true
    },

    drop(event) {
      const data = event.dataTransfer
      if (!data) return false

      const image = 找图片文件(data.files)
      if (image) {
        event.preventDefault()
        void 处理文件(image)
        return true
      }

      // 从浏览器拖过来的图可能只带 URL，不带文件。
      const url = data.getData('text/uri-list') || data.getData('text/plain')
      if (url && /^https?:\/\//i.test(url.trim())) {
        event.preventDefault()
        void (async () => {
          const request = deps.构造请求()
          if (!request) return
          const result = await 从地址插入(request, url.trim())
          if (result.error) deps.hint(result.error)
        })()
        return true
      }
      return false
    },

    dragover(event, view) {
      // 只有真的拖着图片时才拦截，否则会破坏编辑器内的文字拖动。
      const kind = event.dataTransfer?.types ?? []
      const 有文件 = Array.from(kind).includes('Files')
      if (!有文件) return false
      event.preventDefault()
      view.dom.classList.add('cm-drop-target')
      return false
    },

    dragleave(_事件, view) {
      view.dom.classList.remove('cm-drop-target')
      return false
    },

    dragend(_事件, view) {
      view.dom.classList.remove('cm-drop-target')
      return false
    }
  })
}
