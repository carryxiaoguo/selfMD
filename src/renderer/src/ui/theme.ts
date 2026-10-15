import { themeCssUrl, 全局自定义样式Url, 主题自定义样式Url } from '@shared/url'
import { 生效主题, type Settings } from '@shared/types'

/**
 * 主题应用。
 *
 * 采用同样的的**三层级联**：
 *
 *   1. `<主题名>.css`        主题本体
 *   2. `base.user.css`      全局自定义，对所有主题生效
 *   3. `<主题名>.user.css`   该主题专属自定义
 *
 * 层叠顺序由 DOM 里的 link 顺序决定，所以这三行是**层叠契约的一部分**，
 * 不能随意调换。用户永远压在主题之上——这样升级主题不会冲掉用户的手改。
 *
 * 样式表走 `selfmd://` 协议而不是内联，是为了让主题里的相对 `url()`
 * 与 `@import` 能相对于主题目录解析。通行做法用 `应用私有协议` 也是同一个理由。
 */

let 已应用的链接: Record<string, string> = {}

function 设置链接(id: string, href: string): void {
  const el = document.getElementById(id) as HTMLLinkElement | null
  if (!el) return
  // 同一个 URL 重复赋值不会触发重新加载；主题切换本来就会换 URL，
  // 但"重新加载主题"命令需要绕过这一点，所以由调用方负责改 URL。
  if (el.getAttribute('href') === href) return
  el.setAttribute('href', href)
  已应用的链接[id] = href
}

/** 给定设置下实际生效的主题 id。 */
export function activeThemeId(settings: Settings): string {
  return 生效主题(settings)
}

/** 强制重新拉取当前三层样式表（用户在外部编辑器里改了 CSS 之后用）。 */
export function 重新加载主题(settings: Settings): void {
  const id = activeThemeId(settings)
  for (const [元素, href] of [
    ['theme-css', themeCssUrl(id)],
    ['base-user-css', 全局自定义样式Url()],
    ['theme-user-css', 主题自定义样式Url(id)]
  ] as const) {
    const el = document.getElementById(元素) as HTMLLinkElement | null
    if (el) el.setAttribute('href', '')
    设置链接(元素, href)
  }
}

export function applyTheme(settings: Settings): void {
  const id = activeThemeId(settings)
  设置链接('theme-css', themeCssUrl(id))
  设置链接('base-user-css', 全局自定义样式Url())
  设置链接('theme-user-css', 主题自定义样式Url(id))

  document.body.classList.toggle('dark', settings.isDarkMode)
  document.body.classList.toggle('live-preview', settings.livePreview)
  document.body.classList.toggle('source-mode', !settings.livePreview)

  // 切主题时必须先清掉内联变量覆盖再重新设值。
  // 内联样式优先级高于任何样式表，残留一版旧值会让新主题"换不动"——
  // 切换主题时同样要把内联覆盖清空再重设。
  const 根 = document.documentElement
  根.style.setProperty('--font-size', `${settings.fontSize}px`)
  根.style.setProperty('--line-height', String(settings.lineHeight))
  根.style.setProperty('--font-body', settings.fontFamily || '')
  根.style.setProperty('--font-mono', settings.monospaceFontFamily || '')
}

/** 用户没有固定模式时，跟随操作系统的配色方案。 */
export function watchSystemTheme(onChange: (isDark: boolean) => void): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent): void => onChange(e.matches)
  query.addEventListener('change', handler)
}
