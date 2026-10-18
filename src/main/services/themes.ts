import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import type { ThemeInfo } from '@shared/types'
import { getAppPaths } from '../util/paths'
import { BUILTIN_THEMES } from './builtin-themes'

/**
 * 主题发现 / 加载。
 *
 * 主题是 `<userData>/themes` 下的普通 `.css` 文件。主题可以在开头的块注释里
 * 声明元数据：
 *
 *   /** @name My Theme *​/   -> 显示名称
 *   /** @dark true *​/       -> 深色配色
 */

/** 拒绝任何可能逃出主题目录的 id。 */
export function isSafeThemeId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(id) && !id.includes('..')
}

export function themePath(id: string): string | null {
  if (!isSafeThemeId(id)) return null
  return join(getAppPaths().themes, `${id}.css`)
}

/**
 * 解析主题目录内的任意相对路径。
 *
 * 主题不只是 `<名字>.css` 一个文件：它旁边的**同名资源目录**里放字体、图片、
 * 光标，主题 CSS 用相对路径引用它们（`url('./github/open-sans-….woff2')`），
 * 深色子样式表也用相对 `@import` 引入（`@import "night/codeblock.dark.css"`，
 * 实测于 常见的 night.css 开头）。只服务 `<名字>.css` 会让这些引用
 * 全部 404——症状是"主题加载了但字体不对"，极难排查。
 *
 * 两道防护：
 *   1. 显式拒绝含 `..` 的路径
 *   2. 解析后确认结果仍落在主题目录内（防符号链接绕过）
 */
export function themeFileList(relativeTo: string): string | null {
  let normalize: string
  try {
    normalize = decodeURIComponent(relativeTo)
  } catch {
    return null
  }
  normalize = normalize.replace(/\\/g, '/').replace(/^\/+/, '').replace(/[?#].*$/, '')
  if (normalize.length === 0 || normalize.includes('..') || normalize.includes('\0')) return null

  const root = getAppPaths().themes
  const whole = join(root, normalize)
  const fallback = relative(root, whole)
  if (fallback.startsWith('..') || isAbsolute(fallback)) return null
  return whole
}

/** 全局自定义 CSS 的路径（对所有主题生效）。 */
export function baseUserCssPath(): string {
  return join(getAppPaths().themes, 'base.user.css')
}

/** 某个主题专属的自定义 CSS 路径。 */
export function themeUserCssPath(id: string): string | null {
  if (!isSafeThemeId(id)) return null
  return join(getAppPaths().themes, `${id}.user.css`)
}

function parseMeta(css: string): { name: string | null; isDark: boolean } {
  const head = css.slice(0, 600)
  const nameMatch = /@name\s+([^\n*]+)/.exec(head)
  const darkMatch = /@dark\s+(true|false)/i.exec(head)
  return {
    name: nameMatch ? nameMatch[1].trim() : null,
    isDark: darkMatch ? darkMatch[1].toLowerCase() === 'true' : false
  }
}

/**
 * 同步内置主题到用户目录。
 *
 * **每次启动都跑，而不是只在首次启动时写一次。**
 * 早先用了一个标记文件做"写过就跳过"，结果是：后来新增内置主题时，
 * 已有用户的目录里永远不会有它们——而界面上只表现为"下拉框里少一项"，
 * 不报任何错，也就没人会发现。
 *
 * ## 这一步原来是"存在就不覆盖"，已经改成"内容不同就覆盖"
 *
 * 原来的顾虑是：用户可能直接改过内置主题的配色，覆盖等于悄悄丢掉他的改动。
 *
 * 但那个顾虑**不成立**——自定义有专门的落点：同目录下的
 * `<主题>.user.css` 与 `base.user.css`，加载顺序保证它们覆盖内置规则。
 * 于是"存在就不覆盖"不但没有保护到谁，反而造成一个更糟的后果：
 * **内置主题的修改永远送不到老用户那里。**
 *
 * 这不是假设。黄皮纸的标题居中就是这么来的：源码里删掉了
 * `text-align: center`，用户目录里那份 10-15 写下的 `parchment.css`
 * 却一直带着它，重装、重启、清理缓存都不管用——因为文件一直在，
 * 代码就一直跳过它。表现是"改了没用"，最难查的一类。
 *
 * 所以：内置主题以程序内的版本为准，内容不同就覆盖；
 * 想改配色请写 `<主题>.user.css`。
 */
export function seedBuiltinThemes(): void {
  const dir = getAppPaths().themes
  try {
    mkdirSync(dir, { recursive: true })

    let freshlyWritten = 0
    let updated = 0
    for (const theme of BUILTIN_THEMES) {
      const target = join(dir, `${theme.id}.css`)
      const 已有 = existsSync(target) ? readFileSync(target, 'utf8') : null
      if (已有 === theme.css) continue
      writeFileSync(target, theme.css, 'utf8')
      if (已有 === null) freshlyWritten += 1
      else updated += 1
    }
    if (freshlyWritten > 0) console.log(`[themes] 已补齐 ${freshlyWritten} 款内置主题`)
    if (updated > 0) console.log(`[themes] 已更新 ${updated} 款内置主题`)
  } catch (err) {
    console.error('[themes] seeding failed:', err)
  }
}

export function listThemes(): ThemeInfo[] {
  const dir = getAppPaths().themes
  const builtinIds = new Set(BUILTIN_THEMES.map((t) => t.id))
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.css')
  } catch {
    return BUILTIN_THEMES.map((t) => {
      const meta = parseMeta(t.css)
      return {
        id: t.id,
        name: meta.name ?? t.id,
        path: join(dir, `${t.id}.css`),
        isDark: meta.isDark,
        builtin: true
      }
    })
  }

  const out: ThemeInfo[] = []
  for (const file of names) {
    const id = basename(file, '.css')
    if (!isSafeThemeId(id)) continue
    const path = join(dir, file)
    try {
      const meta = parseMeta(readFileSync(path, 'utf8'))
      out.push({
        id,
        name: meta.name ?? id,
        path,
        isDark: meta.isDark,
        builtin: builtinIds.has(id)
      })
    } catch {
      // 主题文件无法读取：跳过它，而不是让整个列表失败。
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function readTheme(id: string): string {
  const path = themePath(id)
  if (!path || !existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function installTheme(sourcePath: string): ThemeInfo | null {
  const dir = getAppPaths().themes
  if (extname(sourcePath).toLowerCase() !== '.css') return null
  const id = basename(sourcePath, '.css')
  if (!isSafeThemeId(id)) return null
  try {
    mkdirSync(dir, { recursive: true })
    copyFileSync(sourcePath, join(dir, `${id}.css`))
  } catch (err) {
    console.error('[themes] install failed:', err)
    return null
  }
  return listThemes().find((t) => t.id === id) ?? null
}

export function deleteTheme(id: string): void {
  const path = themePath(id)
  if (!path) return
  try {
    if (existsSync(path)) rmSync(path, { force: true })
  } catch (err) {
    console.error('[themes] delete failed:', err)
  }
}

/**
 * 把两个主题槽位（浅色 + 深色）合并成单个样式表。
 *
 * 合并顺序就是优先级：浅色在前、深色在后，所以开深色模式时
 * 深色那几行会覆盖掉同名变量，而两份都没设的变量继续用基础样式的默认值。
 *
 * 兜底用 `parchment` / `moon-dark`：主题文件被删掉或读不出来时，
 * 界面得有一套能看的配色。这两款是内置主题，只要应用还在就一定能读到。
 */
export function buildActiveThemeCss(lightId: string, darkId: string, isDark: boolean): string {
  const light = readTheme(lightId) || readTheme('parchment')
  const dark = isDark ? readTheme(darkId) || readTheme('moon-dark') : ''
  return dark ? `${light}\n\n/* === dark override === */\n${dark}` : light
}
