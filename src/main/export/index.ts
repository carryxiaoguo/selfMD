import { BrowserWindow, app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { 提取大纲, 渲染Markdown为HTML } from '@shared/markdown-html'
import { 生效主题 } from '@shared/types'
import { getAppPaths } from '../util/paths'
import { getSettings } from '../services/settings'
import { themePath, 主题自定义样式路径, 全局自定义样式路径 } from '../services/themes'
import { 处理样式表 } from './css'

/**
 * 导出。
 *
 * 同样的的两条路：
 *
 *   - **HTML 自己渲染**：遍历 Lezer 语法树生成 HTML，再把当前主题的样式
 *     内联进去，得到一个自包含的单文件。
 *   - **PDF 交给 Chromium 打印**：Electron 的 `printToPDF` 直接可用，
 *     不需要任何外部程序。
 *   - **其余格式委托 Pandoc**：检测不到就明确告知，而不是静默失败。
 */

export type 导出格式 = 'html' | 'html-plain' | 'pdf' | 'docx' | 'latex' | 'epub' | 'rtf' | 'odt'

export interface 导出选项 {
  /** 导出后的目标文件路径。 */
  目标: string
  /** 源 Markdown 文本。 */
  源: string
  /** 当前文档路径，用于解析相对图片地址。没有则为 null。 */
  文档路径: string | null
  /** 是否在导出结果里附带侧边目录（大纲）。 */
  附大纲?: boolean
  /** 是否把本地图片内嵌成 base64（自包含单文件）。 */
  内嵌图片?: boolean
  /** 导出格式。 */
  格式: 导出格式
}

export interface 导出结果 {
  成功: boolean
  路径: string | null
  错误: string | null
}

// ---------------------------------------------------------------------------
// 导出专用样式
// ---------------------------------------------------------------------------

/**
 * 导出态的基础样式。
 *
 * 这些规则照抄 通行的 `base.css`（用脚本筛出全部含 `selfmd-export` 的规则，
 * ）。其中**只有一条是绝对不能省的**：
 *
 *   `.selfmd-export * { -webkit-print-color-adjust: exact }`
 *
 * 没有它，Chromium 打印 PDF 时会丢弃所有背景色与背景图——代码块、引用块、
 * 表格斑马纹全部变白底。导出的 PDF 与屏幕所见完全不同，而用户只会认为
 * "导出功能坏了"，很难联想到是打印色彩策略。
 */
const 导出基础样式 = `
/* --- 页面 --- */
html { background: var(--bg-color); }
body.selfmd-export {
  margin: 0 auto;
  padding: 30px 30px 60px;
  max-width: var(--content-max-width, 860px);
  background: var(--bg-color);
  color: var(--text-color);
  font-family: var(--font-body);
  font-size: var(--font-size, 16px);
  line-height: var(--line-height, 1.65);
  word-wrap: break-word;
}
body.selfmd-export * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* --- 分页 --- */
.selfmd-export h1, .selfmd-export h2, .selfmd-export h3,
.selfmd-export h4, .selfmd-export h5, .selfmd-export h6 { page-break-inside: avoid; page-break-after: avoid; }
.selfmd-export pre, .selfmd-export blockquote, .selfmd-export table { page-break-inside: avoid; }
.selfmd-export #write { page-break-after: avoid; }

/* --- 内容 --- */
#write > *:first-child { margin-top: 0; }
#write p, #write li { white-space: pre-wrap; }
#write h1, #write h2, #write h3 { margin: 1.5em 0 0.6em; line-height: 1.3; }
#write h4, #write h5, #write h6 { margin: 1.2em 0 0.5em; line-height: 1.3; }
#write h1 { font-size: 2em; border-bottom: 1px solid var(--window-border-color); padding-bottom: .3em; }
#write h2 { font-size: 1.5em; border-bottom: 1px solid var(--window-border-color); padding-bottom: .3em; }
#write p { margin: 0 0 1em; }
#write blockquote {
  margin: 0 0 1em; padding: 0 1em;
  color: var(--control-text-color);
  border-left: 4px solid var(--window-border-color);
}
#write code {
  padding: .2em .4em; font-size: .9em;
  font-family: var(--monospace);
  background: var(--rawblock-edit-panel-bd);
  border-radius: 3px;
}
#write pre {
  margin: 0 0 1em; padding: 12px 14px;
  overflow-x: auto;
  background: var(--rawblock-edit-panel-bd);
  border-radius: var(--radius, 6px);
}
#write pre code { padding: 0; background: none; font-size: .88em; line-height: 1.5; }
#write table { margin: 0 0 1em; border-collapse: collapse; width: auto; }
#write th, #write td { padding: 6px 13px; border: 1px solid var(--table-border-color); }
#write th { font-weight: 600; background: var(--rawblock-edit-panel-bd); }
#write hr { height: 1px; margin: 1.6em 0; border: 0; background: var(--window-border-color); }
#write img { max-width: 100%; }
#write a { color: var(--primary-color); }
#write ul, #write ol { margin: 0 0 1em; padding-left: 2em; }
#write li { margin: .25em 0; }
#write li > p { margin: 0 0 .4em; }
#write input[type='checkbox'] { pointer-events: none; margin-right: .4em; }

/* --- 导出时附带的侧边目录 --- */
.selfmd-export-content { display: block; }
.selfmd-export-show-outline .selfmd-export-content {
  display: flex; flex-direction: row; gap: 32px;
  max-width: 1200px; margin: 0 auto;
}
.selfmd-export-show-outline #write { flex: 2; min-width: 0; }
.selfmd-export-sidebar { flex: 0 0 260px; font-size: .82rem; margin-top: 60px; }
.selfmd-export-sidebar .outline-content { position: sticky; top: 40px; max-height: 85vh; overflow-y: auto; }
.selfmd-export .outline-item { display: block; padding: 2px 0; color: var(--control-text-color); }
.selfmd-export .outline-item:hover { color: var(--text-color); }
.selfmd-export .outline-label { text-decoration: none; }
@media print {
  .selfmd-export-show-outline .selfmd-export-sidebar { display: none; }
  .selfmd-export-show-outline .selfmd-export-content { display: block; }
  body.selfmd-export { max-width: none; padding: 0; }
}
`

/** 生成导出时的侧边目录 HTML。 */
function 构建目录(源: string): string {
  const 标题们 = 提取大纲(源)
  if (标题们.length === 0) return ''
  const 最浅 = Math.min(...标题们.map((t) => t.级别))
  const 行 = 标题们
    .map((标题) => {
      const 缩进 = (标题.级别 - 最浅) * 14
      const 文本 = 标题.文本 || '（空标题）'
      const 转义 = 文本.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // 锚点用位置偏移生成，与正文标题的 id 对应
      return `      <div class="outline-item" style="padding-left:${缩进}px"><a class="outline-label" href="#t${标题.位置}">${转义}</a></div>`
    })
    .join('\n')

  return `  <aside class="selfmd-export-sidebar">
    <div class="outline-content">
${行}
    </div>
  </aside>
`
}

// ---------------------------------------------------------------------------
// 图片
// ---------------------------------------------------------------------------

const 图片MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
}

/**
 * 把 HTML 里的本地图片地址换成 data: 内嵌。
 *
 * 远程图片保持不变——下载它们既慢又可能失败，而且用户放一个远程地址在
 * 文档里，本来就不指望它离线可见。
 */
function 内嵌本地图片(html: string, 文档路径: string | null): string {
  return html.replace(/(<img[^>]+src=")([^"]+)(")/gi, (整体, 前: string, 地址: string, 后: string) => {
    if (/^(https?:|data:)/i.test(地址)) return 整体
    // 还原百分号编码，中文路径才找得到文件
    let 路径 = 地址
    try {
      路径 = decodeURI(地址)
    } catch {
      // 编码损坏就按原样找
    }
    const 基准 = 文档路径 ? dirname(文档路径) : getAppPaths().userImages
    const 全 = isAbsolute(路径) ? 路径 : resolve(基准, 路径)
    if (!existsSync(全)) return 整体
    const 类型 = 图片MIME[extname(全).toLowerCase()]
    if (!类型) return 整体
    try {
      const 数据 = readFileSync(全).toString('base64')
      return `${前}data:${类型};base64,${数据}${后}`
    } catch {
      return 整体
    }
  })
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/**
 * 导出用的临时目录。
 *
 * PDF 与 Pandoc 都要先落一份中间 HTML：`data:` URL 在超长文档时会超出长度
 * 限制，而且相对图片地址需要真实的文件基准。
 */
function 临时目录(): string {
  const 目录 = join(app.getPath('temp'), 'selfmd-导出')
  mkdirSync(目录, { recursive: true })
  return 目录
}

/** 取当前主题的完整样式（三层级联），并做导出处理。 */
async function 收集样式(): Promise<string> {
  const 设置 = getSettings()
  const id = 生效主题(设置)
  const 部件: string[] = []

  // 基础样式：带上设计变量与排版规则，否则导出的 HTML 无样式可依。
  // 它同时定义了两层变量契约（通用变量层 + 本项目层）。
  const 变量 = 读基础样式()
  if (变量) 部件.push(变量)

  const 主题 = themePath(id)
  if (主题 && existsSync(主题)) {
    部件.push(
      await 处理样式表(readFileSync(主题, 'utf8'), {
        基准目录: getAppPaths().themes,
        导出模式: true
      })
    )
  }

  for (const 自定义 of [全局自定义样式路径(), 主题自定义样式路径(id)]) {
    if (自定义 && existsSync(自定义)) {
      // 用户自定义样式同样要处理：里面可能有 @import
      部件.push(
        await 处理样式表(readFileSync(自定义, 'utf8'), {
          基准目录: getAppPaths().themes,
          导出模式: true
        })
      )
    }
  }

  return 部件.join('\n')
}

/** 基础样式表：优先读打包产物，开发时读源码目录。 */
function 读基础样式(): string | null {
  const 候选 = [
    join(app.getAppPath(), 'src', 'renderer', 'src', 'styles', 'base.css'),
    join(__dirname, '..', '..', '..', 'src', 'renderer', 'src', 'styles', 'base.css')
  ]
  for (const 路径 of 候选) {
    if (existsSync(路径)) {
      try {
        return readFileSync(路径, 'utf8')
      } catch {
        // 继续试下一个
      }
    }
  }
  return null
}

export async function 构建导出HTML(选项: 导出选项): Promise<string> {
  const 附大纲 = 选项.附大纲 ?? true
  const 内嵌 = 选项.内嵌图片 ?? true

  let 正文 = 渲染Markdown为HTML(选项.源)
  if (内嵌) 正文 = 内嵌本地图片(正文, 选项.文档路径)

  // 无样式模式：只出结构，不带任何 CSS
  if (选项.格式 === 'html-plain') {
    return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<title>${转义标题(选项.文档路径)}</title>
</head>
<body>
<div id="write">
${正文}</div>
</body>
</html>
`
  }

  const 样式 = await 收集样式()
  const 类 = `selfmd-export${附大纲 ? ' selfmd-export-show-outline' : ''}`
  const 目录 = 附大纲 ? 构建目录(选项.源) : ''

  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="selfMD">
<title>${转义标题(选项.文档路径)}</title>
<style>
${导出基础样式}
${样式}
</style>
</head>
<body class="${类}">
  <div class="selfmd-export-content">
${目录}    <div id="write">
${正文}</div>
  </div>
</body>
</html>
`
}

function 转义标题(文档路径: string | null): string {
  const 名 = 文档路径 ? basename(文档路径, extname(文档路径)) : '未命名文档'
  return 名.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * 导出 PDF。
 *
 * 用一个**隐藏窗口**加载生成好的 HTML，再调 `printToPDF`。
 * 这是 Electron 白拿的能力——不需要装任何外部程序。
 */
async function 导出PDF(选项: 导出选项): Promise<导出结果> {
  const html = await 构建导出HTML({ ...选项, 格式: 'html' })

  // 落一个临时 HTML：data: URL 在超长文档时会超出长度限制，
  // 而且相对图片地址需要真实的文件基准。
  const 临时文件 = join(临时目录(), `导出-${Date.now()}.html`)
  writeFileSync(临时文件, html, 'utf8')

  const 窗口 = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { offscreen: true, javascript: false }
  })

  try {
    await 窗口.loadURL(pathToFileURL(临时文件).toString())
    // 等一帧，让字体与布局稳定下来；否则首行有时会挤出页面。
    await new Promise((完成) => setTimeout(完成, 120))

    const 缓冲 = await 窗口.webContents.printToPDF({
      printBackground: true, // 与 print-color-adjust 同等重要
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      pageSize: 'A4'
    })

    mkdirSync(dirname(选项.目标), { recursive: true })
    writeFileSync(选项.目标, 缓冲)
    return { 成功: true, 路径: 选项.目标, 错误: null }
  } catch (错误) {
    return {
      成功: false,
      路径: null,
      错误: `PDF 导出失败：${错误 instanceof Error ? 错误.message : String(错误)}`
    }
  } finally {
    窗口.destroy()
  }
}

// ---------------------------------------------------------------------------
// Pandoc
// ---------------------------------------------------------------------------

let 缓存的Pandoc路径: string | null | undefined

/** 探测 Pandoc 是否可用。结果缓存，避免每次导出都跑一次进程。 */
export async function 检测Pandoc(): Promise<string | null> {
  if (缓存的Pandoc路径 !== undefined) return 缓存的Pandoc路径

  const 候选 = getSettings().pandocPath || 'pandoc'
  缓存的Pandoc路径 = await new Promise<string | null>((完成) => {
    let 子进程: ReturnType<typeof spawn>
    try {
      子进程 = spawn(候选, ['--version'], { windowsHide: true })
    } catch {
      完成(null)
      return
    }
    let 输出 = ''
    子进程.stdout?.on('data', (块) => {
      输出 += String(块)
    })
    子进程.on('error', () => 完成(null))
    子进程.on('close', (码) => {
      if (码 !== 0) {
        完成(null)
        return
      }
      // 首行形如 `pandoc 3.1.9`，取出其中的版本号
      const 版本 = (/[\d.]+/.exec(输出.split(/\r?\n/)[0] ?? '') ?? [])[0] ?? ''
      完成(版本 ? 候选 : null)
    })
  })

  return 缓存的Pandoc路径
}

/** 取 Pandoc 的版本号字符串，供界面显示。 */
export async function 取Pandoc版本(): Promise<string | null> {
  const 路径 = await 检测Pandoc()
  if (!路径) return null
  return new Promise((完成) => {
    const 子进程 = spawn(路径, ['--version'], { windowsHide: true })
    let 输出 = ''
    子进程.stdout?.on('data', (块) => {
      输出 += String(块)
    })
    子进程.on('error', () => 完成(null))
    子进程.on('close', () => {
      完成((/[\d.]+/.exec(输出.split(/\r?\n/)[0] ?? '') ?? [])[0] ?? null)
    })
  })
}

/** 各格式对应的 Pandoc 输出名。 */
const PANDOC格式: Record<string, string> = {
  docx: 'docx',
  latex: 'latex',
  epub: 'epub',
  rtf: 'rtf',
  odt: 'odt'
}

async function 导出经Pandoc(选项: 导出选项): Promise<导出结果> {
  const 程序 = await 检测Pandoc()
  if (!程序) {
    return {
      成功: false,
      路径: null,
      错误:
        '未检测到 Pandoc。HTML 与 PDF 导出不需要它；' +
        '导出 Word / LaTeX / ePub 等格式需要先安装 Pandoc 并在设置中填写路径。'
    }
  }

  const 目标格式 = PANDOC格式[选项.格式]
  if (!目标格式) {
    return { 成功: false, 路径: null, 错误: `不支持的导出格式：${选项.格式}` }
  }

  // 先落一份 HTML 中间文件，再交给 Pandoc 转换。
  // 用 HTML 而不是 Markdown 作输入：这样图片、表格、脚注等已经由我们
  // 自己的渲染器处理过，与屏幕上看到的保持一致。
  const 中间目录 = 临时目录()
  const 中间文件 = join(中间目录, `导出-${Date.now()}.html`)
  writeFileSync(
    中间文件,
    await 构建导出HTML({ ...选项, 格式: 'html', 附大纲: false, 内嵌图片: true }),
    'utf8'
  )

  mkdirSync(dirname(选项.目标), { recursive: true })

  return new Promise<导出结果>((完成) => {
    const 参数 = [中间文件, '-f', 'html', '-t', 目标格式, '-o', 选项.目标, '--standalone']
    let 错误输出 = ''
    let 子进程: ReturnType<typeof spawn>
    try {
      子进程 = spawn(程序, 参数, {
        windowsHide: true,
        // 以文档所在目录为工作目录，相对资源才能被 Pandoc 找到
        cwd: 选项.文档路径 ? dirname(选项.文档路径) : 中间目录
      })
    } catch (错误) {
      完成({
        成功: false,
        路径: null,
        错误: `无法启动 Pandoc：${错误 instanceof Error ? 错误.message : String(错误)}`
      })
      return
    }

    子进程.stderr?.on('data', (块) => {
      错误输出 += String(块)
    })
    子进程.on('error', (错误) => {
      完成({ 成功: false, 路径: null, 错误: `Pandoc 执行失败：${错误.message}` })
    })
    子进程.on('close', (码) => {
      if (码 === 0) 完成({ 成功: true, 路径: 选项.目标, 错误: null })
      else {
        完成({
          成功: false,
          路径: null,
          错误: `Pandoc 返回错误码 ${码}：${错误输出.trim().slice(0, 400) || '（无输出）'}`
        })
      }
    })
  })
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

/** 各格式是否可用（供菜单决定是否置灰）。 */
export async function 可用格式(): Promise<Record<导出格式, boolean>> {
  const 有Pandoc = (await 检测Pandoc()) !== null
  return {
    html: true,
    'html-plain': true,
    pdf: true,
    docx: 有Pandoc,
    latex: 有Pandoc,
    epub: 有Pandoc,
    rtf: 有Pandoc,
    odt: 有Pandoc
  }
}

export async function 执行导出(选项: 导出选项): Promise<导出结果> {
  try {
    if (选项.格式 === 'pdf') return await 导出PDF(选项)

    if (选项.格式 === 'html' || 选项.格式 === 'html-plain') {
      const html = await 构建导出HTML(选项)
      mkdirSync(dirname(选项.目标), { recursive: true })
      writeFileSync(选项.目标, html, 'utf8')
      return { 成功: true, 路径: 选项.目标, 错误: null }
    }

    return await 导出经Pandoc(选项)
  } catch (错误) {
    return {
      成功: false,
      路径: null,
      错误: 错误 instanceof Error ? 错误.message : String(错误)
    }
  }
}

/** 供自测使用：直接拿一段 Markdown 生成 HTML，不落盘。 */
export async function 试渲染(源: string, 格式: 导出格式 = 'html'): Promise<string> {
  return 构建导出HTML({
    源,
    目标: '',
    文档路径: null,
    格式,
    附大纲: true,
    内嵌图片: false
  })
}
