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
  提示: (消息: string) => void
}

/** 把 File 读成不含前缀的 base64。 */
function 读为base64(文件: File): Promise<string> {
  return new Promise((完成, 失败) => {
    const 读者 = new FileReader()
    读者.onload = () => {
      const 结果 = String(读者.result ?? '')
      const 逗号 = 结果.indexOf(',')
      完成(逗号 >= 0 ? 结果.slice(逗号 + 1) : '')
    }
    读者.onerror = () => 失败(读者.error)
    读者.readAsDataURL(文件)
  })
}

/** 从 File 对象取磁盘路径；浏览器拖来的图没有路径，返回空串。 */
function 取磁盘路径(文件: File): string {
  try {
    return window.selfmdExtra.webUtils.pathForFile(文件) || ''
  } catch {
    return ''
  }
}

/** 拖放/粘贴进来的 File 列表里，第一张图片。 */
function 找图片文件(列表: FileList | null | undefined): File | null {
  if (!列表) return null
  for (const 文件 of Array.from(列表)) {
    if (文件.type.startsWith('image/') || 是图片文件(文件.name)) return 文件
  }
  return null
}

export function 图片粘贴与拖放(依赖: 图片处理依赖): Extension {
  /** 处理"有图片文件"的公共路径。 */
  const 处理文件 = async (文件: File): Promise<void> => {
    const 请求 = 依赖.构造请求()
    if (!请求) return

    const 路径 = 取磁盘路径(文件)
    if (路径 && 是图片文件(路径)) {
      const 结果 = await 从文件插入(请求, [路径])
      if (结果.错误) 依赖.提示(结果.错误)
      return
    }

    // 没有磁盘路径（从浏览器或截图工具拖来的）：把字节读出来再落盘。
    // 这条分支必须存在，否则"从网页拖一张图进来"会完全没反应。
    try {
      const 数据 = await 读为base64(文件)
      if (!数据) {
        依赖.提示('无法读取图片数据。')
        return
      }
      const 扩展 = 扩展名由类型(文件.type) ?? '.png'
      const 名 = `${时间戳图片名(new Date())}${扩展}`
      const 目录 = await 本次目标目录(请求)
      if (!目录) return
      const 写回 = await window.selfmd.image.saveBytes(目录, 名, 数据)
      if (!写回) {
        依赖.提示('写入图片失败。')
        return
      }
      // 复用从文件插入的收尾逻辑：把写好的路径再走一遍完整流程，
      // 避免在这里重复实现一遍引用生成。
      const 结果 = await 从文件插入(请求, [写回.路径])
      if (结果.错误) 依赖.提示(结果.错误)
    } catch (错误) {
      依赖.提示(`读取图片失败：${错误 instanceof Error ? 错误.message : String(错误)}`)
    }
  }

  return EditorView.domEventHandlers({
    paste(事件) {
      const 数据 = 事件.clipboardData
      if (!数据) return false

      // 1) 剪贴板里就有图片文件（从资源管理器复制、截图工具等）
      const 图片 = 找图片文件(数据.files)
      if (图片) {
        // 有图就一定要 preventDefault：否则浏览器还会把图片当文件路径插成文本。
        事件.preventDefault()
        void 处理文件(图片)
        return true
      }

      // 2) 没有文件，但要区分"纯文本粘贴"与"位图粘贴"。
      //    只要有非空文本，就放行给默认行为——绝不能吞掉正常粘贴。
      const 文本 = 数据.getData('text/plain')
      if (文本 && 文本.length > 0) return false
      const 网页 = 数据.getData('text/html')
      if (网页 && 网页.length > 0) return false

      // 3) 到这里说明剪贴板既没有文件也没有文本，多半是一张位图。
      //    真实判定交给主进程（它能读系统剪贴板），失败时不影响用户。
      事件.preventDefault()
      void (async () => {
        const 请求 = 依赖.构造请求()
        if (!请求) return
        const 结果 = await 从剪贴板插入(请求)
        if (结果.成功数 === 0 && 结果.错误 && 结果.错误 !== '剪贴板里没有图片。') {
          依赖.提示(结果.错误)
        }
      })()
      return true
    },

    drop(事件) {
      const 数据 = 事件.dataTransfer
      if (!数据) return false

      const 图片 = 找图片文件(数据.files)
      if (图片) {
        事件.preventDefault()
        void 处理文件(图片)
        return true
      }

      // 从浏览器拖过来的图可能只带 URL，不带文件。
      const 地址 = 数据.getData('text/uri-list') || 数据.getData('text/plain')
      if (地址 && /^https?:\/\//i.test(地址.trim())) {
        事件.preventDefault()
        void (async () => {
          const 请求 = 依赖.构造请求()
          if (!请求) return
          const 结果 = await 从地址插入(请求, 地址.trim())
          if (结果.错误) 依赖.提示(结果.错误)
        })()
        return true
      }
      return false
    },

    dragover(事件, 视图) {
      // 只有真的拖着图片时才拦截，否则会破坏编辑器内的文字拖动。
      const 类型 = 事件.dataTransfer?.types ?? []
      const 有文件 = Array.from(类型).includes('Files')
      if (!有文件) return false
      事件.preventDefault()
      视图.dom.classList.add('cm-drop-target')
      return false
    },

    dragleave(_事件, 视图) {
      视图.dom.classList.remove('cm-drop-target')
      return false
    },

    dragend(_事件, 视图) {
      视图.dom.classList.remove('cm-drop-target')
      return false
    }
  })
}
