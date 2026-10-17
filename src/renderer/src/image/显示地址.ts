import { localFileUrl } from '@shared/url'

/**
 * 图片地址解析。
 *
 * Markdown 里的图片地址是**相对于文档**写的（`图/样本.png`），而渲染层
 * 要把它变成浏览器能加载的 URL。两者之间隔着一层解析，这层出错的症状是
 * "图片没显示"—而 Markdown 语法本身完全正确，光看文档根本查不出来。
 *
 * 约定：
 *   - `http/https/data/blob` 原样返回，交给网络栈
 *   - 绝对路径（`C:/…` 或 `/…`）直接转 `selfmd://local/`
 *   - 其余按**相对路径**处理，拼到当前文档所在目录上
 *   - 文档尚未保存时没有基准目录，相对路径无法解析，返回空串
 *
 * 当前文档目录用模块级变量保存，而不是塞进每个 widget：
 * 一个窗口同时只打开一篇文档，把它透传进装饰构建的每一层只会让签名变长。
 * 文档切换时由 `设置文档目录` 更新一次。
 */

let 当前文档目录: string | null = null

/** 文档切换时调用。传 null 表示文档尚未保存。 */
export function setDocDir(dir: string | null): void {
  当前文档目录 = dir
}

export function 取文档目录(): string | null {
  return 当前文档目录
}

/** 是否是无需解析的外部地址。 */
function 是外部地址(url: string): boolean {
  return /^(https?:|data:|blob:|selfmd:)/i.test(url)
}

/** 是否是绝对路径。Windows 盘符与 POSIX 根路径都算。 */
function 是绝对路径(url: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('\\\\')
}

/** 把反斜杠统一成正斜杠，便于拼接与比较。 */
function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

/** 拼两段路径，处理中间的斜杠与 `./`。 */
function 拼接(dir: string, relativePath: string): string {
  const 左 = normalize(dir).replace(/\/+$/, '')
  const 右 = normalize(relativePath).replace(/^\.\//, '')
  return `${左}/${右}`
}

/**
 * 把 Markdown 里的图片地址解析成可加载的 URL。
 *
 * 解析不了时返回空串——调用方据此显示"图片无法显示"占位，
 * 而不是留一个破图图标让人以为是文件坏了。
 */
export function 解析图片地址(原始: string): string {
  const url = 原始.trim()
  if (url.length === 0) return ''

  if (是外部地址(url)) return url

  // `file://` 直接转成本地协议，省掉一次解码
  if (/^file:\/\//i.test(url)) {
    try {
      return localFileUrl(decodeURIComponent(new URL(url).pathname.replace(/^\//, '')))
    } catch {
      return ''
    }
  }

  // 地址里可能有百分号编码（存进文档时转义过），解析回真实路径
  let filePath = url
  try {
    filePath = decodeURI(url)
  } catch {
    // 编码损坏就按原样找，总比直接放弃好
  }

  if (是绝对路径(filePath)) return localFileUrl(filePath)
  if (!当前文档目录) return ''
  return localFileUrl(拼接(当前文档目录, filePath))
}

/**
 * 文档里写的原始地址（未解析）。
 *
 * 上传后回填时要用它做查找替换——文档里存的是相对路径，
 * 不是解析后的 URL。
 */
export function 是本地图片地址(url: string): boolean {
  return !是外部地址(url)
}
