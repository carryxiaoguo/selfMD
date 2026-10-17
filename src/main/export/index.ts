import { BrowserWindow, app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { 提取大纲, renderMarkdownToHtml } from '@shared/markdown-html'
import { activeTheme } from '@shared/types'
import { getAppPaths } from '../util/paths'
import { getSettings } from '../services/settings'
import { themePath, themeUserCssPath, baseUserCssPath } from '../services/themes'
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

export interface ExportOptions {
  /** 导出后的目标文件路径。 */
  target: string
  /** 源 Markdown 文本。 */
  source: string
  /** 当前文档路径，用于解析相对图片地址。没有则为 null。 */
  docPath: string | null
  /** 是否在导出结果里附带侧边目录（大纲）。 */
  withOutline?: boolean
  /** 是否把本地图片内嵌成 base64（自包含单文件）。 */
  embeddedImage?: boolean
  /** 导出格式。 */
  format: 导出格式
}

export interface exportResult {
  success: boolean
  filePath: string | null
  error: string | null
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
function 构建目录(source: string): string {
  const headings = 提取大纲(source)
  if (headings.length === 0) return ''
  const 最浅 = Math.min(...headings.map((t) => t.level))
  const line = headings
    .map((title) => {
      const indent = (title.level - 最浅) * 14
      const docText = title.docText || '（空标题）'
      const 转义 = docText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // 锚点用位置偏移生成，与正文标题的 id 对应
      return `      <div class="outline-item" style="padding-left:${indent}px"><a class="outline-label" href="#t${title.position}">${转义}</a></div>`
    })
    .join('\n')

  return `  <aside class="selfmd-export-sidebar">
    <div class="outline-content">
${line}
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
function 内嵌本地图片(html: string, docPath: string | null): string {
  return html.replace(/(<img[^>]+src=")([^"]+)(")/gi, (wholeText, before: string, url: string, after: string) => {
    if (/^(https?:|data:)/i.test(url)) return wholeText
    // 还原百分号编码，中文路径才找得到文件
    let filePath = url
    try {
      filePath = decodeURI(url)
    } catch {
      // 编码损坏就按原样找
    }
    const baseline = docPath ? dirname(docPath) : getAppPaths().userImages
    const whole = isAbsolute(filePath) ? filePath : resolve(baseline, filePath)
    if (!existsSync(whole)) return wholeText
    const kind = 图片MIME[extname(whole).toLowerCase()]
    if (!kind) return wholeText
    try {
      const data = readFileSync(whole).toString('base64')
      return `${before}data:${kind};base64,${data}${after}`
    } catch {
      return wholeText
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
function tempDir(): string {
  const dir = join(app.getPath('temp'), 'selfmd-导出')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 取当前主题的完整样式（三层级联），并做导出处理。 */
async function 收集样式(): Promise<string> {
  const settings = getSettings()
  const id = activeTheme(settings)
  const partEl: string[] = []

  // 基础样式：带上设计变量与排版规则，否则导出的 HTML 无样式可依。
  // 它同时定义了两层变量契约（通用变量层 + 本项目层）。
  const variable = 读基础样式()
  if (variable) partEl.push(variable)

  const theme = themePath(id)
  if (theme && existsSync(theme)) {
    partEl.push(
      await 处理样式表(readFileSync(theme, 'utf8'), {
        baseDir: getAppPaths().themes,
        导出模式: true
      })
    )
  }

  for (const 自定义 of [baseUserCssPath(), themeUserCssPath(id)]) {
    if (自定义 && existsSync(自定义)) {
      // 用户自定义样式同样要处理：里面可能有 @import
      partEl.push(
        await 处理样式表(readFileSync(自定义, 'utf8'), {
          baseDir: getAppPaths().themes,
          导出模式: true
        })
      )
    }
  }

  return partEl.join('\n')
}

/** 基础样式表：优先读打包产物，开发时读源码目录。 */
function 读基础样式(): string | null {
  const candidate = [
    join(app.getAppPath(), 'src', 'renderer', 'src', 'styles', 'base.css'),
    join(__dirname, '..', '..', '..', 'src', 'renderer', 'src', 'styles', 'base.css')
  ]
  for (const filePath of candidate) {
    if (existsSync(filePath)) {
      try {
        return readFileSync(filePath, 'utf8')
      } catch {
        // 继续试下一个
      }
    }
  }
  return null
}

export async function buildExportHtml(options: ExportOptions): Promise<string> {
  const withOutline = options.withOutline ?? true
  const 内嵌 = options.embeddedImage ?? true

  let body = renderMarkdownToHtml(options.source)
  if (内嵌) body = 内嵌本地图片(body, options.docPath)

  // 无样式模式：只出结构，不带任何 CSS
  if (options.format === 'html-plain') {
    return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<title>${转义标题(options.docPath)}</title>
</head>
<body>
<div id="write">
${body}</div>
</body>
</html>
`
  }

  const style = await 收集样式()
  const 类 = `selfmd-export${withOutline ? ' selfmd-export-show-outline' : ''}`
  const dir = withOutline ? 构建目录(options.source) : ''

  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="selfMD">
<title>${转义标题(options.docPath)}</title>
<style>
${导出基础样式}
${style}
</style>
</head>
<body class="${类}">
  <div class="selfmd-export-content">
${dir}    <div id="write">
${body}</div>
  </div>
</body>
</html>
`
}

function 转义标题(docPath: string | null): string {
  const name = docPath ? basename(docPath, extname(docPath)) : '未命名文档'
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
async function 导出PDF(options: ExportOptions): Promise<exportResult> {
  const html = await buildExportHtml({ ...options, format: 'html' })

  // 落一个临时 HTML：data: URL 在超长文档时会超出长度限制，
  // 而且相对图片地址需要真实的文件基准。
  const tempFile = join(tempDir(), `导出-${Date.now()}.html`)
  writeFileSync(tempFile, html, 'utf8')

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { offscreen: true, javascript: false }
  })

  try {
    await win.loadURL(pathToFileURL(tempFile).toString())
    // 等一帧，让字体与布局稳定下来；否则首行有时会挤出页面。
    await new Promise((done) => setTimeout(done, 120))

    const buffer = await win.webContents.printToPDF({
      printBackground: true, // 与 print-color-adjust 同等重要
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      pageSize: 'A4'
    })

    mkdirSync(dirname(options.target), { recursive: true })
    writeFileSync(options.target, buffer)
    return { success: true, filePath: options.target, error: null }
  } catch (error) {
    return {
      success: false,
      filePath: null,
      error: `PDF 导出失败：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    win.destroy()
  }
}

// ---------------------------------------------------------------------------
// Pandoc
// ---------------------------------------------------------------------------

let cachedPandocPath: string | null | undefined

/** 探测 Pandoc 是否可用。结果缓存，避免每次导出都跑一次进程。 */
export async function detectPandoc(): Promise<string | null> {
  if (cachedPandocPath !== undefined) return cachedPandocPath

  const candidate = getSettings().pandocPath || 'pandoc'
  cachedPandocPath = await new Promise<string | null>((done) => {
    let childProc: ReturnType<typeof spawn>
    try {
      childProc = spawn(candidate, ['--version'], { windowsHide: true })
    } catch {
      done(null)
      return
    }
    let output = ''
    childProc.stdout?.on('data', (block) => {
      output += String(block)
    })
    childProc.on('error', () => done(null))
    childProc.on('close', (codePx) => {
      if (codePx !== 0) {
        done(null)
        return
      }
      // 首行形如 `pandoc 3.1.9`，取出其中的版本号
      const version = (/[\d.]+/.exec(output.split(/\r?\n/)[0] ?? '') ?? [])[0] ?? ''
      done(version ? candidate : null)
    })
  })

  return cachedPandocPath
}

/** 取 Pandoc 的版本号字符串，供界面显示。 */
export async function 取Pandoc版本(): Promise<string | null> {
  const filePath = await detectPandoc()
  if (!filePath) return null
  return new Promise((done) => {
    const childProc = spawn(filePath, ['--version'], { windowsHide: true })
    let output = ''
    childProc.stdout?.on('data', (block) => {
      output += String(block)
    })
    childProc.on('error', () => done(null))
    childProc.on('close', () => {
      done((/[\d.]+/.exec(output.split(/\r?\n/)[0] ?? '') ?? [])[0] ?? null)
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

async function 导出经Pandoc(options: ExportOptions): Promise<exportResult> {
  const program = await detectPandoc()
  if (!program) {
    return {
      success: false,
      filePath: null,
      error:
        '未检测到 Pandoc。HTML 与 PDF 导出不需要它；' +
        '导出 Word / LaTeX / ePub 等格式需要先安装 Pandoc 并在设置中填写路径。'
    }
  }

  const 目标格式 = PANDOC格式[options.format]
  if (!目标格式) {
    return { success: false, filePath: null, error: `不支持的导出格式：${options.format}` }
  }

  // 先落一份 HTML 中间文件，再交给 Pandoc 转换。
  // 用 HTML 而不是 Markdown 作输入：这样图片、表格、脚注等已经由我们
  // 自己的渲染器处理过，与屏幕上看到的保持一致。
  const 中间目录 = tempDir()
  const 中间文件 = join(中间目录, `导出-${Date.now()}.html`)
  writeFileSync(
    中间文件,
    await buildExportHtml({ ...options, format: 'html', withOutline: false, embeddedImage: true }),
    'utf8'
  )

  mkdirSync(dirname(options.target), { recursive: true })

  return new Promise<exportResult>((done) => {
    const params = [中间文件, '-f', 'html', '-t', 目标格式, '-o', options.target, '--standalone']
    let 错误输出 = ''
    let childProc: ReturnType<typeof spawn>
    try {
      childProc = spawn(program, params, {
        windowsHide: true,
        // 以文档所在目录为工作目录，相对资源才能被 Pandoc 找到
        cwd: options.docPath ? dirname(options.docPath) : 中间目录
      })
    } catch (error) {
      done({
        success: false,
        filePath: null,
        error: `无法启动 Pandoc：${error instanceof Error ? error.message : String(error)}`
      })
      return
    }

    childProc.stderr?.on('data', (block) => {
      错误输出 += String(block)
    })
    childProc.on('error', (error) => {
      done({ success: false, filePath: null, error: `Pandoc 执行失败：${error.message}` })
    })
    childProc.on('close', (codePx) => {
      if (codePx === 0) done({ success: true, filePath: options.target, error: null })
      else {
        done({
          success: false,
          filePath: null,
          error: `Pandoc 返回错误码 ${codePx}：${错误输出.trim().slice(0, 400) || '（无输出）'}`
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
  const hasPandoc = (await detectPandoc()) !== null
  return {
    html: true,
    'html-plain': true,
    pdf: true,
    docx: hasPandoc,
    latex: hasPandoc,
    epub: hasPandoc,
    rtf: hasPandoc,
    odt: hasPandoc
  }
}

export async function runExport(options: ExportOptions): Promise<exportResult> {
  try {
    if (options.format === 'pdf') return await 导出PDF(options)

    if (options.format === 'html' || options.format === 'html-plain') {
      const html = await buildExportHtml(options)
      mkdirSync(dirname(options.target), { recursive: true })
      writeFileSync(options.target, html, 'utf8')
      return { success: true, filePath: options.target, error: null }
    }

    return await 导出经Pandoc(options)
  } catch (error) {
    return {
      success: false,
      filePath: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** 供自测使用：直接拿一段 Markdown 生成 HTML，不落盘。 */
export async function 试渲染(source: string, format: 导出格式 = 'html'): Promise<string> {
  return buildExportHtml({
    source,
    target: '',
    docPath: null,
    format,
    withOutline: true,
    embeddedImage: false
  })
}
