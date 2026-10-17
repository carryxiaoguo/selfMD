/**
 * `selfmd://` 协议的 URL 辅助函数。
 *
 * 两条路由：
 *   selfmd://theme/<id>.css   -> <userData>/themes/<id>.css
 *   selfmd://local/<token>    -> 任意绝对文件路径
 *
 * `local` 路由之所以存在，是因为主题和文档都按相对路径引用图片，而在我们的
 * CSP 下，渲染进程无法加载普通的 `file://` URL。用自定义协议
 * 解决同一个问题。
 *
 * 路径会被打包进一个路径安全的 token，使 Windows 盘符、空格以及非 ASCII
 * 字符在 URL 解析后依然原样保留。
 */

export const PROTOCOL_SCHEME = 'selfmd'

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(token: string): string {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 当前主题样式表的 URL。 */
export function themeCssUrl(themeId: string): string {
  return `${PROTOCOL_SCHEME}://theme/${encodeURIComponent(themeId)}.css`
}

/** 让渲染进程能显示任意本地文件（图片、视频等）的 URL。 */
export function localFileUrl(absolutePath: string): string {
  return `${PROTOCOL_SCHEME}://local/${toBase64Url(absolutePath)}`
}

export function decodeLocalToken(token: string): string | null {
  try {
    const decoded = fromBase64Url(decodeURIComponent(token))
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 主题目录
// ---------------------------------------------------------------------------

/**
 * 主题目录下任意文件的 URL。
 *
 * 主题的字体、图片、深色子样式表都通过它加载——那些文件与主题 CSS 同级，
 * 或在其同名子目录里，所以**主题 CSS 内部的相对 URL 天然可用**；
 * 这个函数用于需要绝对地址的场合。
 */
export function 主题文件Url(relativeTo: string): string {
  const 安全 = relativeTo
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${PROTOCOL_SCHEME}://theme/${安全}`
}

/** 全局自定义 CSS（对所有主题生效）。 */
export function baseUserCssUrl(): string {
  return 主题文件Url('base.user.css')
}

/** 某个主题专属的自定义 CSS（只对该主题生效）。 */
export function themeUserCssUrl(themeId: string): string {
  return 主题文件Url(`${themeId}.user.css`)
}
