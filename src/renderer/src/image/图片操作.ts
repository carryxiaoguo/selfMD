import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { 独立撤销 } from '../editor/独立撤销'
import { 取文件名 } from '@shared/image-path'

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

export interface 图片上下文 {
  /** Image 节点在文档中的区间。 */
  from: number
  to: number
  /** URL 那一段的区间。 */
  地址from: number
  地址to: number
  /** 文档里写的原始地址。 */
  地址: string
  /** 替代文字。 */
  替代: string
  /** 本地绝对路径；远程图片为 null。 */
  本地路径: string | null
}

/** 从语法节点里取 URL 区间。 */
function 取URL区间(节点: {
  firstChild: unknown
}): { from: number; to: number } | null {
  let 子 = 节点.firstChild as {
    name: string
    from: number
    to: number
    nextSibling: unknown
  } | null
  while (子) {
    if (子.name === 'URL') return { from: 子.from, to: 子.to }
    子 = 子.nextSibling as typeof 子
  }
  return null
}

/** 取 `![` 与 `]` 之间的替代文字（填空式：它在两个 LinkMark 的间隙里）。 */
function 取替代(节点: { from: number; to: number; firstChild: unknown }, 状态: EditorState): string {
  let 文本 = ''
  let 收集 = false
  let 游标 = 节点.from
  let 子 = 节点.firstChild as {
    name: string
    from: number
    to: number
    nextSibling: unknown
  } | null
  while (子) {
    const 间隙 = 状态.sliceDoc(游标, 子.from)
    if (收集 && 间隙) 文本 += 间隙
    const 文 = 状态.sliceDoc(子.from, 子.to)
    if (子.name === 'LinkMark') {
      if (文 === '![') 收集 = true
      else if (文 === ']') 收集 = false
    } else if (子.name === 'URL') {
      // 地址不算替代文字
    } else if (子.name === 'LinkTitle') {
      // 标题也不算
    } else if (收集) {
      文本 += 文
    }
    游标 = 子.to
    子 = 子.nextSibling as typeof 子
  }
  return 文本.trim()
}

/**
 * 找出光标（或指定位置）所在的图片。
 *
 * 找不到时返回 null——菜单据此整体置灰，而不是让用户点了没反应。
 */
export function 取当前图片(状态: EditorState, 位置: number): 图片上下文 | null {
  let 结果: 图片上下文 | null = null

  syntaxTree(状态).iterate({
    enter: (引用) => {
      if (结果) return false
      const 节点 = 引用.node as unknown as {
        name: string
        from: number
        to: number
        firstChild: unknown
      }
      if (节点.name !== 'Image') return true
      if (位置 < 节点.from || 位置 > 节点.to) return true

      const 区间 = 取URL区间(节点)
      if (!区间) return false
      const 地址 = 状态.sliceDoc(区间.from, 区间.to).trim()
      结果 = {
        from: 节点.from,
        to: 节点.to,
        地址from: 区间.from,
        地址to: 区间.to,
        地址,
        替代: 取替代(节点, 状态),
        本地路径: 本地绝对路径(地址)
      }
      return false
    }
  })

  return 结果
}

/** 把文档里写的地址解析成磁盘绝对路径；远程地址返回 null。 */
export function 本地绝对路径(地址: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(地址.trim())) return null
  let 路径 = 地址.trim()
  try {
    路径 = decodeURI(路径)
  } catch {
    // 编码损坏就按原样试
  }
  if (/^[a-zA-Z]:[\\/]/.test(路径) || 路径.startsWith('/')) return 路径
  const 目录 = 当前目录()
  if (!目录) return null
  return `${目录.replace(/\\/g, '/').replace(/\/+$/, '')}/${路径.replace(/^\.\//, '')}`
}

/** 由 live-preview 的显示地址模块提供的当前文档目录。 */
let 目录提供者: (() => string | null) | null = null
export function 设置目录提供者(提供者: () => string | null): void {
  目录提供者 = 提供者
}
function 当前目录(): string | null {
  return 目录提供者?.() ?? null
}

// ---------------------------------------------------------------------------
// 转换图片语法
// ---------------------------------------------------------------------------

/** 转成 HTML 写法：`<img src="…" alt="…" />`，alt 为空时省略该属性。 */
function 转HTML(地址: string, 替代: string): string {
  const 属性 = [`src="${地址.replace(/"/g, '&quot;')}"`]
  if (替代) 属性.push(`alt="${替代.replace(/"/g, '&quot;')}"`)
  return `<img ${属性.join(' ')} />`
}

/**
 * 在 Markdown 与 HTML 两种图片语法之间转换。
 *
 * 只改 `![…](…)` 这一段，不动周围的文字。
 */
export function 转换图片语法(视图: EditorView, 图片: 图片上下文): boolean {
  const HTML写法 = /^<img\b/i.test(图片.地址)
  const 新语法 = HTML写法
    ? `![${图片.替代}](${图片.地址})`
    : 转HTML(图片.地址, 图片.替代)

  // HTML 写法时 URL 区间取的不对（整段就是一个 HTML 节点），
  // 所以直接整段替换；Markdown 写法时也只换整段——
  // 反正两种写法下 `![` / `<img` 与结尾都要一起变。
  视图.dispatch({
    changes: { from: 图片.from, to: 图片.to, insert: 新语法 },
    selection: EditorSelection.cursor(图片.from + 新语法.length),
    annotations: 独立撤销,
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
export async function 重命名或移动图片(
  视图: EditorView,
  图片: 图片上下文,
  目标目录: string,
  新文件名: string
): Promise<{ 成功: boolean; 错误: string | null; 新地址: string | null }> {
  if (!图片.本地路径) {
    return { 成功: false, 错误: '这是远程图片，没有本地文件可移动。', 新地址: null }
  }

  const 新路径 = `${目标目录.replace(/[\\/]+$/, '')}/${新文件名}`
  try {
    await window.selfmd.file.move(图片.本地路径, 新路径)
  } catch (错误) {
    return {
      成功: false,
      错误: `移动文件失败：${错误 instanceof Error ? 错误.message : String(错误)}`,
      新地址: null
    }
  }

  // 新地址尽量写成相对于文档的路径，这样文档连同图片一起搬家时引用不会断
  let 新地址 = 新路径
  const 目录 = 当前目录()
  if (目录) {
    try {
      const 相对 = await window.selfmd.file.relative(目录, 新路径)
      新地址 = 相对.replace(/\\/g, '/')
    } catch {
      // 取不到相对路径就用绝对路径，至少能用
    }
  }

  视图.dispatch({
    changes: { from: 图片.地址from, to: 图片.地址to, insert: 新地址 },
    annotations: 独立撤销,
    userEvent: 'input.moveImage'
  })

  return { 成功: true, 错误: null, 新地址 }
}

/**
 * 复制图片文件到目标目录，并把文档引用指向副本。
 *
 * 与"移动"的区别是原文件保留——用户想把图片集中到 `assets/` 又不想删原件时用。
 */
export async function 复制图片到(
  视图: EditorView,
  图片: 图片上下文,
  目标目录: string
): Promise<{ 成功: boolean; 错误: string | null; 新地址: string | null }> {
  if (!图片.本地路径) {
    return { 成功: false, 错误: '这是远程图片，没有本地文件可复制。', 新地址: null }
  }

  try {
    // 走主进程的原子复制：重名自动避让，绝不覆盖已有文件
    const 结果 = await window.selfmd.image.import(图片.本地路径, 目标目录)
    if (!结果) return { 成功: false, 错误: '复制失败。', 新地址: null }

    let 新地址 = 结果.路径
    const 目录 = 当前目录()
    if (目录) {
      try {
        新地址 = (await window.selfmd.file.relative(目录, 结果.路径)).replace(/\\/g, '/')
      } catch {
        // 保留绝对路径
      }
    }

    视图.dispatch({
      changes: { from: 图片.地址from, to: 图片.地址to, insert: 新地址 },
      annotations: 独立撤销,
      userEvent: 'input.copyImage'
    })

    return { 成功: true, 错误: null, 新地址 }
  } catch (错误) {
    return {
      成功: false,
      错误: `复制失败：${错误 instanceof Error ? 错误.message : String(错误)}`,
      新地址: null
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
export async function 删除图片文件(图片: 图片上下文): Promise<{ 成功: boolean; 错误: string | null }> {
  if (!图片.本地路径) {
    return { 成功: false, 错误: '这是远程图片，没有本地文件可删除。' }
  }
  try {
    await window.selfmd.file.trash(图片.本地路径)
    return { 成功: true, 错误: null }
  } catch (错误) {
    return {
      成功: false,
      错误: `删除失败：${错误 instanceof Error ? 错误.message : String(错误)}`
    }
  }
}

/** 图片文件名，供对话框预填。 */
export function 建议文件名(图片: 图片上下文): string {
  return 图片.本地路径 ? 取文件名(图片.本地路径) : 图片.替代 || 'image.png'
}
