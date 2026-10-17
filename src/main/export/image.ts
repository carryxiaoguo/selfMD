import { BrowserWindow, clipboard } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { buildExportHtml, type ExportOptions } from './index'

/**
 * 把文档渲染成图片并放进剪贴板。
 *
 * ## 为什么用离屏窗口截图，而不是自己画
 *
 * 内容里可能有公式（KaTeX）、图表（Mermaid）、代码高亮、表格——
 * 在 Canvas 上重画一遍等于把渲染器再实现一次，而且两边迟早不一致。
 * 用离屏窗口加载**导出的 HTML** 再截图，渲染结果与导出完全一致，
 * 因为它们走的是同一条路。
 *
 * ## 三个必须处理的细节
 *
 * 1. **量出内容高度再截图。** `capturePage()` 不带参数时只截窗口可视区，
 *    长文会被从中间截断。所以先量 `scrollHeight`，把窗口调到那么高再截。
 * 2. **高度要有上限。** 有些 GPU/驱动在超大位图上会直接失败或给出空白图，
 *    所以超过上限就截到上限为止，并如实告诉调用方。
 * 3. **要等图片加载完。** 静态 HTML 加载完时 `<img>` 可能还没解码，
 *    这时候截图会拍到一片空白——而且看起来像"图片渲染坏了"。
 */

/** 截图的宽度。与导出的正文宽度接近，太窄会换行、太宽会留白。 */
const 默认宽度 = 900

/**
 * 高度上限。
 *
 * 8000px 已经够放下几万字的长文；再高就有驱动相关的失败风险，
 * 所以宁可截断并如实告知，也不要赌一张可能全白的图。
 */
const 最大高度 = 8000

export interface 图片结果 {
  success: boolean
  /** 实际截取的像素尺寸，供调用方如实反馈。 */
  width: number
  height: number
  /** 是否因为超过高度上限而被截断。 */
  truncated: boolean
  error: string | null
}

export async function 复制为图片(
  options: ExportOptions,
  /** 目标宽度；省略时用默认值。 */
  width = 默认宽度
): Promise<图片结果> {
  const failure = (error: string): 图片结果 => ({
    success: false,
    width: 0,
    height: 0,
    truncated: false,
    error
  })

  let html: string
  try {
    // 内嵌图片：截图是"拿走一份"，图片必须跟着走，
    // 否则粘到别处就是一堆破图。
    html = await buildExportHtml({
      ...options,
      format: 'html',
      withOutline: false,
      embeddedImage: true
    })
  } catch (error) {
    return failure(`渲染失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const tempFile = join(tmpdir(), `selfmd-图片-${Date.now()}.html`)
  try {
    mkdirSync(dirname(tempFile), { recursive: true })
    writeFileSync(tempFile, html, 'utf8')
  } catch (error) {
    return failure(`写入临时文件失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const win = new BrowserWindow({
    show: false,
    width: width,
    height: 1200,
    webPreferences: {
      // 必须开 JS：要用它量内容高度。
      // 内容是**我们自己生成的**导出 HTML，不含外部脚本。
      javascript: true,
      // 关闭背景节流：隐藏窗口里的定时器会被降频，
      // 等待图片加载的逻辑可能因此迟迟不推进。
      backgroundThrottling: false
    }
  })

  try {
    await win.loadURL(pathToFileURL(tempFile).toString())

    // 等图片真正解码完。只等 load 事件不够——那时图片可能还没画上去。
    await win.webContents.executeJavaScript(`
      Promise.all(
        Array.from(document.images).map((图) =>
          图.complete ? Promise.resolve() : new Promise((完成) => {
            图.addEventListener('load', 完成, { once: true })
            图.addEventListener('error', 完成, { once: true })
            // 网络图可能一直不返回，不能无限等
            setTimeout(完成, 3000)
          })
        )
      ).then(() => new Promise((完成) => requestAnimationFrame(() => requestAnimationFrame(完成))))
    `)

    const measuredHeight = await win.webContents.executeJavaScript(
      'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)'
    )
    const 内容高 = typeof measuredHeight === 'number' && measuredHeight > 0 ? Math.ceil(measuredHeight) : 1200
    const 目标高 = Math.min(内容高, 最大高度)

    win.setContentSize(width, 目标高)
    // 改尺寸之后要再等一帧，布局才会按新高度重排
    await new Promise((done) => setTimeout(done, 180))

    const img = await win.webContents.capturePage()
    if (img.isEmpty()) return failure('截图为空，可能是内容过高或渲染未完成')

    clipboard.writeImage(img)
    const size = img.getSize()
    return {
      success: true,
      width: size.width,
      height: size.height,
      truncated: 内容高 > 最大高度,
      error: null
    }
  } catch (error) {
    return failure(`截图失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    win.destroy()
  }
}

/** 供自测使用：把图片存到磁盘，避免测试污染用户剪贴板。 */
export function 存图片到(filePath: string): boolean {
  const img = clipboard.readImage()
  if (img.isEmpty()) return false
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, img.toPNG())
    return true
  } catch {
    return false
  }
}
