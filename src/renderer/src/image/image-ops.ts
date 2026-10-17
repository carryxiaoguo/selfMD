import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { isolatedUndo } from '../editor/isolated-undo'
import { takeFileName } from '@shared/image-path'

/**
 * 图片的右键操作。
 *
 * 菜单项名称沿用 Markdown 编辑器里常见的说法
 * （「打开图片位置」「重命名 / 移动图片到」「转换图片语法」…）。
 *
 * 所有操作都遵循同一条原则：**改文档用位置，不用字符串查找**。
 * 拿地址去 `indexOf` 会在"同一张图被引用两次""某张图的地址是另一张的子串"
 * 这些情况下改错地方，而且改完看起来一切正常。
 */

export interface imageContext {
  /** Image 节点在文档中的区间。 */
  from: number
  to: number
  /** URL 那一段的区间。 */
  urlFrom: number
  urlTo: number
  /** 文档里写的原始地址。 */
  url: string
  /** 替代文字。 */
  substitute: string
  /** 本地绝对路径；远程图片为 null。 */
  localPath: string | null
}

/** 从语法节点里取 URL 区间。 */
function 取URL区间(node: {
  firstChild: unknown
}): { from: number; to: number } | null {
  let child = node.firstChild as {
    name: string
    from: number
    to: number
    nextSibling: unknown
  } | null
  while (child) {
    if (child.name === 'URL') return { from: child.from, to: child.to }
    child = child.nextSibling as typeof child
  }
  return null
}

/** 取 `![` 与 `]` 之间的替代文字（填空式：它在两个 LinkMark 的间隙里）。 */
function 取替代(node: { from: number; to: number; firstChild: unknown }, state: EditorState): string {
  let docText = ''
  let collect = false
  let cursor = node.from
  let child = node.firstChild as {
    name: string
    from: number
    to: number
    nextSibling: unknown
  } | null
  while (child) {
    const gapPx = state.sliceDoc(cursor, child.from)
    if (collect && gapPx) docText += gapPx
    const txt = state.sliceDoc(child.from, child.to)
    if (child.name === 'LinkMark') {
      if (txt === '![') collect = true
      else if (txt === ']') collect = false
    } else if (child.name === 'URL') {
      // 地址不算替代文字
    } else if (child.name === 'LinkTitle') {
      // 标题也不算
    } else if (collect) {
      docText += txt
    }
    cursor = child.to
    child = child.nextSibling as typeof child
  }
  return docText.trim()
}

/**
 * 找出光标（或指定位置）所在的图片。
 *
 * 找不到时返回 null——菜单据此整体置灰，而不是让用户点了没反应。
 */
export function takeCurrentImage(state: EditorState, position: number): imageContext | null {
  let result: imageContext | null = null

  syntaxTree(state).iterate({
    enter: (quote) => {
      if (result) return false
      const node = quote.node as unknown as {
        name: string
        from: number
        to: number
        firstChild: unknown
      }
      if (node.name !== 'Image') return true
      if (position < node.from || position > node.to) return true

      const range = 取URL区间(node)
      if (!range) return false
      const url = state.sliceDoc(range.from, range.to).trim()
      result = {
        from: node.from,
        to: node.to,
        urlFrom: range.from,
        urlTo: range.to,
        url,
        substitute: 取替代(node, state),
        localPath: localAbsolutePath(url)
      }
      return false
    }
  })

  return result
}

/** 把文档里写的地址解析成磁盘绝对路径；远程地址返回 null。 */
export function localAbsolutePath(url: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(url.trim())) return null
  let filePath = url.trim()
  try {
    filePath = decodeURI(filePath)
  } catch {
    // 编码损坏就按原样试
  }
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')) return filePath
  const dir = currentDir()
  if (!dir) return null
  return `${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/${filePath.replace(/^\.\//, '')}`
}

/** 由 live-preview 的显示地址模块提供的当前文档目录。 */
let dirProvider: (() => string | null) | null = null
export function setDirProvider(提供者: () => string | null): void {
  dirProvider = 提供者
}
function currentDir(): string | null {
  return dirProvider?.() ?? null
}

// ---------------------------------------------------------------------------
// 转换图片语法
// ---------------------------------------------------------------------------

/** 转成 HTML 写法：`<img src="…" alt="…" />`，alt 为空时省略该属性。 */
function 转HTML(url: string, substitute: string): string {
  const attr = [`src="${url.replace(/"/g, '&quot;')}"`]
  if (substitute) attr.push(`alt="${substitute.replace(/"/g, '&quot;')}"`)
  return `<img ${attr.join(' ')} />`
}

/**
 * 在 Markdown 与 HTML 两种图片语法之间转换。
 *
 * 只改 `![…](…)` 这一段，不动周围的文字。
 */
export function convertImageSyntax(view: EditorView, image: imageContext): boolean {
  const HTML写法 = /^<img\b/i.test(image.url)
  const nextSyntax = HTML写法
    ? `![${image.substitute}](${image.url})`
    : 转HTML(image.url, image.substitute)

  // HTML 写法时 URL 区间取的不对（整段就是一个 HTML 节点），
  // 所以直接整段替换；Markdown 写法时也只换整段——
  // 反正两种写法下 `![` / `<img` 与结尾都要一起变。
  view.dispatch({
    changes: { from: image.from, to: image.to, insert: nextSyntax },
    selection: EditorSelection.cursor(image.from + nextSyntax.length),
    annotations: isolatedUndo,
    userEvent: 'input.switchImageSyntax'
  })
  return true
}

// ---------------------------------------------------------------------------
// 重命名 / 移动 / 复制
// ---------------------------------------------------------------------------

/**
 * 重命名或移动图片文件，并同步更新文档里的引用。
 *
 * 顺序很重要：**先改文件，成功了再改文档**。反过来的话，文件操作失败时
 * 文档里已经指向一个不存在的路径，用户看到的是图裂，而且很难想到是
 * "移动失败但引用已经改了"。
 */
export async function renameOrMoveImage(
  view: EditorView,
  image: imageContext,
  targetDir: string,
  新文件名: string
): Promise<{ success: boolean; error: string | null; nextSrc: string | null }> {
  if (!image.localPath) {
    return { success: false, error: '这是远程图片，没有本地文件可移动。', nextSrc: null }
  }

  const nextPath = `${targetDir.replace(/[\\/]+$/, '')}/${新文件名}`
  try {
    await window.selfmd.file.move(image.localPath, nextPath)
  } catch (error) {
    return {
      success: false,
      error: `移动文件失败：${error instanceof Error ? error.message : String(error)}`,
      nextSrc: null
    }
  }

  // 新地址尽量写成相对于文档的路径，这样文档连同图片一起搬家时引用不会断
  let nextSrc = nextPath
  const dir = currentDir()
  if (dir) {
    try {
      const relativePath = await window.selfmd.file.relative(dir, nextPath)
      nextSrc = relativePath.replace(/\\/g, '/')
    } catch {
      // 取不到相对路径就用绝对路径，至少能用
    }
  }

  view.dispatch({
    changes: { from: image.urlFrom, to: image.urlTo, insert: nextSrc },
    annotations: isolatedUndo,
    userEvent: 'input.moveImage'
  })

  return { success: true, error: null, nextSrc }
}

/**
 * 复制图片文件到目标目录，并把文档引用指向副本。
 *
 * 与"移动"的区别是原文件保留——用户想把图片集中到 `assets/` 又不想删原件时用。
 */
export async function copyImageTo(
  view: EditorView,
  image: imageContext,
  targetDir: string
): Promise<{ success: boolean; error: string | null; nextSrc: string | null }> {
  if (!image.localPath) {
    return { success: false, error: '这是远程图片，没有本地文件可复制。', nextSrc: null }
  }

  try {
    // 走主进程的原子复制：重名自动避让，绝不覆盖已有文件
    const result = await window.selfmd.image.import(image.localPath, targetDir)
    if (!result) return { success: false, error: '复制失败。', nextSrc: null }

    let nextSrc = result.filePath
    const dir = currentDir()
    if (dir) {
      try {
        nextSrc = (await window.selfmd.file.relative(dir, result.filePath)).replace(/\\/g, '/')
      } catch {
        // 保留绝对路径
      }
    }

    view.dispatch({
      changes: { from: image.urlFrom, to: image.urlTo, insert: nextSrc },
      annotations: isolatedUndo,
      userEvent: 'input.copyImage'
    })

    return { success: true, error: null, nextSrc }
  } catch (error) {
    return {
      success: false,
      error: `复制失败：${error instanceof Error ? error.message : String(error)}`,
      nextSrc: null
    }
  }
}

// ---------------------------------------------------------------------------
// 删除
// ---------------------------------------------------------------------------

/**
 * 删除图片文件。
 *
 * 只删文件，**不动文档里的引用**——用户可能正想把引用留着以后放新图。
 * 删完引用会显示成"加载失败"占位，这本身就是一个明确的视觉提示。
 *
 * 走系统回收站而不是直接删：误删一张图的代价不小，而回收站可以撤销。
 */
export async function deleteImageFile(image: imageContext): Promise<{ success: boolean; error: string | null }> {
  if (!image.localPath) {
    return { success: false, error: '这是远程图片，没有本地文件可删除。' }
  }
  try {
    await window.selfmd.file.trash(image.localPath)
    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: `删除失败：${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** 图片文件名，供对话框预填。 */
export function suggestedFileName(image: imageContext): string {
  return image.localPath ? takeFileName(image.localPath) : image.substitute || 'image.png'
}
