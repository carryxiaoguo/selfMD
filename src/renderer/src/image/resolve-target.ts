import type { ImageStoragePolicy } from '@shared/types'
import { 去扩展名, 是绝对路径, normalizePath, 拼接 } from '@shared/image-path'

/**
 * 图片存储目标解析。
 *
 * 这是整个图片管线的**决策中枢**，也是 信息最完整的一段。
 * 它被刻意写成纯函数：只吃文档上下文与设置，吐一个目标，不碰文件系统、
 * 不碰编辑器、不发 IPC。原因是这段逻辑分支极多（六种全局策略 × 文档级覆盖 ×
 * 文本包 × 上传开关 × 未保存文档），任何一处写错都会表现为"图片跑到奇怪的
 * 地方去了"——而那种 bug 靠手点几乎不可能穷举。做成纯函数之后，每个分支
 * 都能在自测里钉住。
 *
 * 路径工具来自 `@shared/image-path`，与主进程共用同一套实现，
 * 避免两边在某个边缘 case 上悄悄分叉。
 *
 * 行为依据：图片存储策略的通行约定。
 */

// 路径工具从 shared 转出，方便调用方只 import 一处。
export { 是绝对路径, normalizePath, 拼接, 去扩展名 } from '@shared/image-path'
export { takeFileName, 取目录, 唯一文件名, 时间戳图片名 } from '@shared/image-path'

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export interface 目标解析输入 {
  /** 当前文档所在目录的绝对路径；未保存的文档为 null。 */
  docDir: string | null
  /** 当前文档的文件名（含扩展名）；未保存的文档为 null。 */
  docName: string | null
  /** TextBundle / TextPack：图片一律进包的 `assets/`。 */
  是文本包: boolean
  /** 文档内 `image-folder` 的值；没有则为 null。 */
  docSettings: string | null
  /** 全局的图片存储策略。 */
  globalPolicy: ImageStoragePolicy
  /** `custom` 策略下使用的目录模板。 */
  自定义目录: string
  /** 是否允许依据文档级设置自动上传。 */
  允许自动上传: boolean
  /** 用户显式要求上传（例如点了"上传图片"），可越过 `允许自动上传`。 */
  强制上传?: boolean
}

export type 目标结果 =
  | { kind: '目录'; filePath: string; origin: '文本包' | '文档级设置' | '全局设置' }
  | { kind: '上传'; origin: '文档级设置' | '全局设置' }
  /** 策略要求"什么都不做"：图片留在原处，引用原路径。 */
  | { kind: '不动' }
  /** 目标依赖文档路径，但文档尚未保存。 */
  | { kind: '需要保存' }

/** 上传哨兵值。通行做法用 `ipic` 与 `upload` 两个词表示同一件事。 */
function 是上传标记(value: string): boolean {
  const 小写 = value.toLowerCase()
  return 小写 === 'ipic' || 小写 === 'upload'
}

/** 把 `${filename}` 换成不含扩展名的文档名。 */
function 替换文件名占位符(template: string, docName: string | null): string {
  const 基名 = docName ? 去扩展名(docName) : ''
  return template.replace(/\$\{filename\}/g, 基名)
}

/**
 * 解析图片应当被放到哪里。
 *
 * 优先级（与通行做法一致）：
 *   1. 文本包 → 包内 `assets/`
 *   2. 文档级设置（YAML 前置元数据）
 *   3. 全局策略
 */
export function 解析目标目录(input: 目标解析输入): 目标结果 {
  // --- 1. 文本包：图片是包的内部资源，用户没有选择余地 -------------------
  if (input.是文本包) {
    if (!input.docDir) return { kind: '需要保存' }
    return { kind: '目录', filePath: 拼接(input.docDir, 'assets'), origin: '文本包' }
  }

  // --- 2. 文档级设置优先于全局 ------------------------------------------
  const 文档级 = input.docSettings?.trim()
  if (文档级 && 文档级.length > 0) {
    if ((input.允许自动上传 || input.强制上传) && 是上传标记(文档级)) {
      return { kind: '上传', origin: '文档级设置' }
    }
    const expand = 替换文件名占位符(文档级, input.docName)
    if (是绝对路径(expand)) return { kind: '目录', filePath: normalizePath(expand), origin: '文档级设置' }
    if (!input.docDir) return { kind: '需要保存' }
    return { kind: '目录', filePath: 拼接(input.docDir, expand), origin: '文档级设置' }
  }

  // --- 3. 全局策略 -------------------------------------------------------
  switch (input.globalPolicy) {
    case '':
      return { kind: '不动' }

    case 'upload':
      return { kind: '上传', origin: '全局设置' }

    case 'folder':
      if (!input.docDir) return { kind: '需要保存' }
      return { kind: '目录', filePath: input.docDir, origin: '全局设置' }

    case 'assets':
      if (!input.docDir) return { kind: '需要保存' }
      return { kind: '目录', filePath: 拼接(input.docDir, 'assets'), origin: '全局设置' }

    case 'per-file-assets': {
      if (!input.docDir || !input.docName) return { kind: '需要保存' }
      return {
        kind: '目录',
        filePath: 拼接(input.docDir, `${去扩展名(input.docName)}.assets`),
        origin: '全局设置'
      }
    }

    case 'custom': {
      const template = input.自定义目录?.trim()
      // 自定义目录没填时退回"不动"，而不是悄悄把图片丢到某个默认位置。
      if (!template) return { kind: '不动' }
      const expand = 替换文件名占位符(template, input.docName)
      if (是绝对路径(expand)) return { kind: '目录', filePath: normalizePath(expand), origin: '全局设置' }
      if (!input.docDir) return { kind: '需要保存' }
      return { kind: '目录', filePath: 拼接(input.docDir, expand), origin: '全局设置' }
    }

    default:
      return { kind: '不动' }
  }
}

// ---------------------------------------------------------------------------
// 是否搬运
// ---------------------------------------------------------------------------

/** 判定图片来源。 */
export function 是远程来源(source: string): boolean {
  return /^\s*(https?|ftp):\/\//i.test(source)
}

export function 是数据地址(source: string): boolean {
  return /^\s*data:/i.test(source)
}

export interface 搬运判定输入 {
  /** 图片的原始 src。 */
  source: string
  /** 解析出的目标目录绝对路径（`上传` 与 `不动` 不参与本判定）。 */
  targetDir: string
  /** 本地图片是否自动搬运。 */
  搬运本地: boolean
  /** 在线图片是否自动搬运。 */
  搬运在线: boolean
}

/**
 * 判断一张已插入的图片是否应当被搬到目标目录。
 *
 * 三个"不该动"的情形，每一条都对应真实误伤：
 *   - 图片已经在目标目录里（否则每次保存都会把它再搬一次，越搬越深）
 *   - `data:` 内联图片没有实体文件可搬
 *   - 用户关掉了对应来源的自动搬运
 */
export function 应当搬运(input: 搬运判定输入): boolean {
  const { source, targetDir } = input
  if (!source || !targetDir) return false
  // 已经在目标目录内：路径前缀匹配，且后面确实还有一层，不是目录本身。
  const 归一目标 = targetDir.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const 归一本源 = source.replace(/^file:\/\//, '').replace(/\\/g, '/')
  if (归一本源 === 归一目标) return false
  if (归一本源.startsWith(`${归一目标}/`)) return false

  if (是数据地址(source)) return false
  return 是远程来源(source) ? input.搬运在线 : input.搬运本地
}

