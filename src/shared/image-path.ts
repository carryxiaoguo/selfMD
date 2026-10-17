/**
 * 图片路径工具。
 *
 * 全部是**纯字符串函数**，不碰文件系统：主进程与渲染进程需要同一套路径语义
 * （拼接、绝对路径判定、唯一命名），把实现放这里可以避免两边各写一份、
 * 然后在某个边缘 case 上悄悄分叉。
 *
 * 路径统一用正斜杠表示。Windows 的反斜杠在拼接时被归一掉，因为 Markdown 的
 * 图片引用本来就该用正斜杠——写成 `![图](imgs\a.png)` 在别的 Markdown
 * 渲染器里会解析失败。
 */

/** 是否为绝对路径：Windows 盘符、UNC、或 POSIX 前导斜杠。 */
export function isAbsolute(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || /^[\\/]/.test(filePath)
}

/**
 * 把路径归一成正斜杠形式，并折叠 `.` 段与重复分隔符。
 *
 * 必须保留 UNC 前缀的 `//`，否则 `//服务器/共享` 会被压成 `/服务器/共享`，
 * 在 Windows 上直接变成另一个位置。
 */
export function normalizePath(filePath: string): string {
  const 有UNC前缀 = /^[\\/]{2}[^\\/]/.test(filePath)
  let result = filePath
    .replace(/\\/g, '/')
    .replace(/\/\.\//g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
  if (有UNC前缀 && !result.startsWith('//')) result = `/${result}`
  return result
}

/** 用正斜杠拼接路径段，折叠重复分隔符。空段被忽略。 */
export function concat(...segment: (string | null | undefined)[]): string {
  const valid = segment.filter((s): s is string => typeof s === 'string' && s.length > 0)
  if (valid.length === 0) return ''
  let result = valid[0].replace(/[\\/]+$/, '')
  for (let i = 1; i < valid.length; i++) {
    const 段值 = valid[i].replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
    if (段值.length === 0) continue
    result = result.length === 0 ? 段值 : `${result}/${段值}`
  }
  return normalizePath(result)
}

/** 取路径中的文件名（含扩展名）。 */
export function takeFileName(filePath: string): string {
  const segment = filePath.split(/[\\/]/)
  return segment[segment.length - 1] ?? ''
}

/** 去掉最后一层扩展名。 */
export function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

/** 取所在目录；没有分隔符时返回空串。 */
export function 取目录(filePath: string): string {
  const position = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return position <= 0 ? '' : filePath.slice(0, position)
}

/**
 * 生成不冲突的文件名。
 *
 * 重名时追加 `-1`、`-2`……而不是覆盖。图片被静默覆盖是不可接受的：
 * 用户往往在几周后才发现某张图变成了另一张。
 */
export function uniqueFileName(
  expectedName: string,
  /** 询问"该名字是否已被占用"。由调用方注入，便于测试与异步实现。 */
  已存在: (候选名: string) => boolean
): string {
  if (!已存在(expectedName)) return expectedName

  const 扩展名位置 = expectedName.lastIndexOf('.')
  const 主干 = 扩展名位置 > 0 ? expectedName.slice(0, 扩展名位置) : expectedName
  const ext = 扩展名位置 > 0 ? expectedName.slice(扩展名位置) : ''

  for (let i = 1; i < 1000; i++) {
    const candidate = `${主干}-${i}${ext}`
    if (!已存在(candidate)) return candidate
  }
  // 极端情况：交给调用方用时间戳兜底。
  return `${主干}-${Date.now()}${ext}`
}

/**
 * 按 通行命名习惯生成图片文件名（不含扩展名）：`image-20250908213433583`。
 *
 * 采用固定宽度的年月日时分秒毫秒，好处是按文件名排序即等于按时间排序，
 * 而且在同一个文件夹里永远不会有重名。
 */
export function timestampImageName(time: Date): string {
  const fill = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `image-${time.getFullYear()}${fill(time.getMonth() + 1)}${fill(time.getDate())}` +
    `${fill(time.getHours())}${fill(time.getMinutes())}${fill(time.getSeconds())}${fill(time.getMilliseconds(), 3)}`
  )
}

/** 由 MIME 类型推断扩展名；无法识别时返回 null。 */
export function extByKind(kind: string | null | undefined): string | null {
  if (!kind) return null
  const tbl: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'image/tiff': '.tiff',
    'image/avif': '.avif'
  }
  const 主类型 = kind.split(';')[0].trim().toLowerCase()
  return tbl[主类型] ?? null
}

/** 由文件名推断 MIME 类型；无法识别时返回 null。 */
export function 类型由扩展名(fileName: string): string | null {
  const extension = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]
  if (!extension) return null
  const tbl: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.avif': 'image/avif'
  }
  return tbl[extension] ?? null
}

/** 判断一个扩展名是否属于受支持的图片类型。 */
export function isImageFile(filePath: string): boolean {
  return 类型由扩展名(filePath) !== null
}
