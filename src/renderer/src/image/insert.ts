import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import type { Settings } from '@shared/types'
import { 读取前置元数据 } from '@shared/front-matter'
import { 取文件名, 时间戳图片名, 是图片文件 } from '@shared/image-path'
import { 解析目标目录 } from './resolve-target'
import { 生成图片语法, 生成引用地址, 生成替代文本, type 图片语法 } from './reference'

/**
 * 图片插入编排。
 *
 * 三种来源（剪贴板位图、本地文件、网络地址）走同一条主干：
 *
 *   解析目标目录 → 决定图片落在哪 → 把图片弄到那里 → 生成引用 → 写进文档
 *
 * 所有**决策**都由 `resolve-target` 与 `reference` 两个纯函数模块给出，
 * 本文件只负责"按决策执行"——把文件系统与编辑器的副作用集中在一处。
 */

const isolatedUndo = isolateHistory.of('full')

// ---------------------------------------------------------------------------
// 结果与请求
// ---------------------------------------------------------------------------

export interface 插入结果 {
  okCount: number
  /** 面向用户的失败说明；全部成功时为 null。 */
  error: string | null
}

export interface 插入请求 {
  view: EditorView
  /** 当前文档的绝对路径；未保存为 null。 */
  docPath: string | null
  /** 当前文档全文，用于读取 YAML 前置元数据里的图片目录设置。 */
  文档文本: string
  settings: Settings
}

// ---------------------------------------------------------------------------
// 上下文
// ---------------------------------------------------------------------------

/** 取路径的父目录（保留盘符形态）。 */
function 去掉末段(filePath: string): string {
  const 归一 = filePath.replace(/\\/g, '/')
  const position = 归一.lastIndexOf('/')
  return position <= 0 ? 归一 : 归一.slice(0, position)
}

function docDir(docPath: string | null): string | null {
  return docPath ? 去掉末段(docPath) : null
}

/** 由当前上下文构造解析输入。 */
function 构造输入(request: 插入请求): Parameters<typeof 解析目标目录>[0] {
  const 元数据 = 读取前置元数据(request.文档文本)
  return {
    docDir: docDir(request.docPath),
    文档名: request.docPath ? 取文件名(request.docPath) : null,
    是文本包: /\.(textbundle|textpack)$/i.test(request.docPath ?? ''),
    文档级设置: 元数据.attr['image-folder'] ?? null,
    全局策略: request.settings.imageStoragePolicy,
    自定义目录: request.settings.customImageSaveLocation,
    允许自动上传: request.settings.allowImageUpload
  }
}

function 语法(settings: Settings): 图片语法 {
  return settings.preferredImageSyntax === 'html' ? 'html' : 'markdown'
}

/** 由图片绝对路径生成要写进文档的引用文本。 */
function 引用文本(图片路径: string, request: 插入请求): string {
  const url = 生成引用地址(图片路径, docDir(request.docPath), {
    用相对路径: request.settings.useRelativePathForImg,
    加点前缀: request.settings.relativePathWithDot,
    转义地址: request.settings.autoEscapeImageURL
  })
  return 生成图片语法(url, 生成替代文本(图片路径), 语法(request.settings))
}

/**
 * 剪贴板位图在"不做特殊处理"策略下的落点。
 *
 * 位图没有磁盘来源，而"不做特殊处理"的含义是"保持原路径"——对一个只在内存里
 * 存在的对象无从谈起。到 通行做法在这种情况下会把图片写进用户数据目录
 * 下的 `images/`（该目录在本机确实存在 5 个 `image-2025*.png`），
 * 这里沿用同一行为。
 */
let 缓存的默认图片目录: string | null = null

async function 取默认图片目录(): Promise<string> {
  if (缓存的默认图片目录) return 缓存的默认图片目录
  const filePath = await window.selfmd.app.getPaths()
  缓存的默认图片目录 = filePath.userImages
  return 缓存的默认图片目录
}

// ---------------------------------------------------------------------------
// 写入文档
// ---------------------------------------------------------------------------

/**
 * 把引用插入到光标处。
 *
 * `isolateHistory` 让"插入图片"在撤销栈里独占一步——用户按 Ctrl+Z 想撤掉的
 * 是刚插入的图，而不是连同前面敲的半句话一起。
 *
 * **插入点必须避开 YAML 前置元数据。** 打开文档后光标默认停在文首，此时直接
 * 插入会把图片引用写到 `---` 前面，于是前置元数据不再是文档开头，整块 YAML
 * 立刻失效——文档级图片目录、根路径这些设置全丢。这个 bug 是靠端到端测试里
 * 打印出文档内容才发现的：`![样本](...)---` 明显不对。
 */
function 写入引用(view: EditorView, quote: string): void {
  const state = view.state
  const main = state.selection.main
  const 插入点 = 避开前置元数据(state, main.from)
  const 终点 = Math.max(插入点, main.to)

  view.dispatch({
    changes: { from: 插入点, to: 终点, insert: quote },
    selection: EditorSelection.cursor(插入点 + quote.length),
    userEvent: 'input.insertImage',
    annotations: isolatedUndo,
    scrollIntoView: true
  })
}

/** 光标落在前置元数据块内（或之前）时，把插入点推到块之后。 */
function 避开前置元数据(state: EditorState, position: number): number {
  if (position === 0) {
    // 快速路径：文首必然在块内，无需解析全文。
    const 元数据 = 读取前置元数据(state.doc.toString())
    return 元数据.exists ? 元数据.结束偏移 : 0
  }
  const 元数据 = 读取前置元数据(state.doc.toString())
  if (元数据.exists && position < 元数据.结束偏移) return 元数据.结束偏移
  return position
}

// ---------------------------------------------------------------------------
// 目标落地
// ---------------------------------------------------------------------------

/**
 * 目标解析失败时给用户看的话。
 *
 * 调用点必须写成 `if (目标.类型 === '需要保存' || 目标.类型 === '上传')` 再传进来——
 * 把整个判别包进一个返回 `string | null` 的辅助函数，TypeScript 就无法据此收窄
 * 联合类型，后续访问 `目标.路径` 会编译失败。类型收窄必须发生在调用点。
 */
function 失败说明(kind: '需要保存' | '上传'): string {
  return kind === '需要保存' ? '请先保存文档，再插入图片。' : '图片上传尚未实现。'
}

// ---------------------------------------------------------------------------
// 三种来源
// ---------------------------------------------------------------------------

/**
 * 从剪贴板插入。
 *
 * **优先按"文件"处理。** Windows 上从资源管理器复制图片时，剪贴板同时提供
 * 原图路径与一张可能是压缩预览的位图；先取位图会让用户粘进来一张糊图。
 */
export async function 从剪贴板插入(request: 插入请求): Promise<插入结果> {
  const content = await window.selfmd.image.readClipboard()

  if (content.kind === '无') return { okCount: 0, error: '剪贴板里没有图片。' }
  if (content.kind === '文件') return 从文件插入(request, content.filePath)

  // --- 位图 -------------------------------------------------------------
  const target = 解析目标目录(构造输入(request))
  if (target.kind === '需要保存' || target.kind === '上传') {
    return { okCount: 0, error: 失败说明(target.kind) }
  }

  const dir = target.kind === '目录' ? target.filePath : await 取默认图片目录()
  const name = `${时间戳图片名(new Date())}.png`
  const 写回 = await window.selfmd.image.saveBytes(dir, name, content.data)
  if (!写回) return { okCount: 0, error: '写入图片失败。' }

  写入引用(request.view, 引用文本(写回.filePath, request))
  return { okCount: 1, error: null }
}

/** 从本地文件插入（对话框选图、拖放、从资源管理器复制）。 */
export async function 从文件插入(request: 插入请求, paths: string[]): Promise<插入结果> {
  const 图片们 = paths.filter(是图片文件)
  if (图片们.length === 0) return { okCount: 0, error: '没有可插入的图片文件。' }

  const target = 解析目标目录(构造输入(request))
  if (target.kind === '需要保存' || target.kind === '上传') {
    return { okCount: 0, error: 失败说明(target.kind) }
  }

  const 引用们: string[] = []
  let error: string | null = null

  for (const origin of 图片们) {
    if (target.kind === '不动') {
      // 策略是"不做特殊处理"：图片留在原地，引用原路径。
      引用们.push(引用文本(origin, request))
      continue
    }
    const 写回 = await window.selfmd.image.import(origin, target.filePath, 取文件名(origin))
    if (写回) 引用们.push(引用文本(写回.filePath, request))
    else if (!error) error = `复制失败：${取文件名(origin)}`
  }

  if (引用们.length === 0) return { okCount: 0, error }
  // 多张图之间用空格分隔；整批仍是一个撤销单元。
  写入引用(request.view, 引用们.join(' '))
  return { okCount: 引用们.length, error }
}

/**
 * 取本次插入的目标目录。
 *
 * 供拖放/粘贴场景复用：那两条路径下，没有磁盘来源的图片必须先落盘才能进入
 * 正常流程，而落盘需要先知道目录。"不动"策略在这里退回用户数据目录下的
 * 图片仓库——位图没有原路径可留，见 `取默认图片目录` 的说明。
 */
export async function 本次目标目录(request: 插入请求): Promise<string | null> {
  const target = 解析目标目录(构造输入(request))
  if (target.kind === '目录') return target.filePath
  if (target.kind === '不动') return 取默认图片目录()
  return null
}

/**
 * 从网络地址插入。
 *
 * 与本地文件的差别只有一处：需要先把图下下来。若解析结果是"不动"，
 * 就直接把原始 URL 写进文档——那正是"不做特殊处理"的含义。
 */
export async function 从地址插入(request: 插入请求, url: string): Promise<插入结果> {
  const 清理后 = url.trim()
  if (!/^https?:\/\//i.test(清理后)) {
    return { okCount: 0, error: '请输入以 http:// 或 https:// 开头的图片地址。' }
  }

  const target = 解析目标目录(构造输入(request))
  if (target.kind === '不动') {
    写入引用(request.view, 引用文本(清理后, request))
    return { okCount: 1, error: null }
  }
  // 必须写成 if 语句而不是三元表达式：只有语句形式才能让 TypeScript
  // 在后续代码里把联合类型收窄掉。
  if (target.kind === '需要保存' || target.kind === '上传') {
    return { okCount: 0, error: 失败说明(target.kind) }
  }

  const 下载 = await window.selfmd.image.download(清理后, target.filePath, 取文件名(清理后) || '图片')
  if (!下载.success || !下载.filePath) {
    return { okCount: 0, error: 下载.error ?? '下载失败。' }
  }

  写入引用(request.view, 引用文本(下载.filePath, request))
  return { okCount: 1, error: null }
}
