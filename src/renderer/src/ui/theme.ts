import { themeCssUrl, 全局自定义样式Url, 主题自定义样式Url } from '@shared/url'
import { activeTheme, type Settings } from '@shared/types'

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

/**
 * 取（必要时创建）某一层的 `<link>`，并保证它排在 `<head>` 的最后。
 *
 * ## 为什么必须在运行时创建，而不是写在 index.html 里
 *
 * 最初这三行是静态写在 `index.html` 的 `<head>` 里的，位置在基础样式表之后，
 * 层叠上是对的。但**构建工具会把它自己打包出来的 CSS 注入到 `<head>` 末尾**：
 *
 *     <link id="theme-css" href="...">                  ← 主题
 *     <link rel="stylesheet" href="./assets/index-*.css">  ← 打包后的 base.css
 *
 * 于是基础样式的 `:root` 反而排在主题后面。两者选择器相同（都是 `:root`），
 * **后加载的赢**——主题加载了、解析了、规则也在，然后被整个盖掉。
 * 表现就是"切换主题没有任何变化"，而协议自测全绿（它测的是能不能取到）。
 *
 * 所以链接必须**追加到 head 末尾**，才能压过构建产物。
 * 三层的先后顺序也由追加顺序保证，那是层叠契约的一部分。
 */
function 取链接(id: string): HTMLLinkElement {
  let el = document.getElementById(id) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = 'stylesheet'
    el.id = id
    // append 而不是 insertBefore：永远排在最后，压过打包产物
    document.head.append(el)
  }
  return el
}

function setLink(id: string, href: string): void {
  const el = 取链接(id)
  // 同一个 URL 重复赋值不会触发重新加载；主题切换本来就会换 URL，
  // 但"重新加载主题"命令需要绕过这一点，所以由调用方负责改 URL。
  if (el.getAttribute('href') === href) return
  el.setAttribute('href', href)
  已应用的链接[id] = href
}

/** 给定设置下实际生效的主题 id。 */
export function activeThemeId(settings: Settings): string {
  return activeTheme(settings)
}

/** 强制重新拉取当前三层样式表（用户在外部编辑器里改了 CSS 之后用）。 */
export function 重新加载主题(settings: Settings): void {
  const id = activeThemeId(settings)
  for (const [el, href] of [
    ['theme-css', themeCssUrl(id)],
    ['base-user-css', 全局自定义样式Url()],
    ['theme-user-css', 主题自定义样式Url(id)]
  ] as const) {
    // 清空再设：同一个 URL 不会触发重新拉取，必须先断开
    取链接(el).setAttribute('href', '')
    setLink(el, href)
  }
}

export function applyTheme(settings: Settings): void {
  const id = activeThemeId(settings)
  setLink('theme-css', themeCssUrl(id))
  setLink('base-user-css', 全局自定义样式Url())
  setLink('theme-user-css', 主题自定义样式Url(id))

  document.body.classList.toggle('dark', settings.isDarkMode)
  document.body.classList.toggle('live-preview', settings.livePreview)
  document.body.classList.toggle('source-mode', !settings.livePreview)

  // 切主题时必须先清掉内联变量覆盖再重新设值。
  // 内联样式优先级高于任何样式表，残留一版旧值会让新主题"换不动"。
  //
  // **0 / 空字符串表示"跟随主题"**，此时必须把内联值清掉而不是设成 0：
  // 设成 0 会得到 `0px` 这种无效值，而清掉之后主题与基础样式才有机会生效。
  const root = document.documentElement
  const setOrClear = (name: string, value: string): void => {
    if (value) root.style.setProperty(name, value)
    else root.style.removeProperty(name)
  }
  setOrClear('--font-size', settings.fontSize > 0 ? `${settings.fontSize}px` : '')
  setOrClear('--line-height', settings.lineHeight > 0 ? String(settings.lineHeight) : '')
  setOrClear('--font-body', settings.fontFamily || '')
  setOrClear('--font-mono', settings.monospaceFontFamily || '')
}

/** 用户没有固定模式时，跟随操作系统的配色方案。 */
export function watchSystemTheme(onChange: (isDark: boolean) => void): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent): void => onChange(e.matches)
  query.addEventListener('change', handler)
}
