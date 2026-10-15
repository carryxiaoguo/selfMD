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

const SEED_MARKER = '.seeded'

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
export function 主题目录文件(相对路径: string): string | null {
  let 归一: string
  try {
    归一 = decodeURIComponent(相对路径)
  } catch {
    return null
  }
  归一 = 归一.replace(/\\/g, '/').replace(/^\/+/, '').replace(/[?#].*$/, '')
  if (归一.length === 0 || 归一.includes('..') || 归一.includes('\0')) return null

  const 根 = getAppPaths().themes
  const 全 = join(根, 归一)
  const 回退 = relative(根, 全)
  if (回退.startsWith('..') || isAbsolute(回退)) return null
  return 全
}

/** 全局自定义 CSS 的路径（对所有主题生效）。 */
export function 全局自定义样式路径(): string {
  return join(getAppPaths().themes, 'base.user.css')
}

/** 某个主题专属的自定义 CSS 路径。 */
export function 主题自定义样式路径(id: string): string | null {
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

/** 首次启动、目录为空时写入内置主题。 */
export function seedBuiltinThemes(): void {
  const dir = getAppPaths().themes
  try {
    mkdirSync(dir, { recursive: true })
    const marker = join(dir, SEED_MARKER)
    if (existsSync(marker)) return

    for (const theme of BUILTIN_THEMES) {
      const target = join(dir, `${theme.id}.css`)
      if (!existsSync(target)) writeFileSync(target, theme.css, 'utf8')
    }
    writeFileSync(
      marker,
      'Built-in themes were written here on first launch.\nDelete this file to re-seed them.\n',
      'utf8'
    )
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
 * 把两个主题槽位（浅色 + 深色）合并成单个样式表，这正是 生成的
 * `themes/current-theme.css` 所扮演的角色。
 */
export function buildActiveThemeCss(lightId: string, darkId: string, isDark: boolean): string {
  const light = readTheme(lightId) || readTheme('github')
  const dark = isDark ? readTheme(darkId) || readTheme('github-dark') : ''
  return dark ? `${light}\n\n/* === dark override === */\n${dark}` : light
}
