import { BrowserWindow, clipboard } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { 构建导出HTML, type 导出选项 } from './index'

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
  成功: boolean
  /** 实际截取的像素尺寸，供调用方如实反馈。 */
  宽: number
  高: number
  /** 是否因为超过高度上限而被截断。 */
  已截断: boolean
  错误: string | null
}

export async function 复制为图片(
  选项: 导出选项,
  /** 目标宽度；省略时用默认值。 */
  宽 = 默认宽度
): Promise<图片结果> {
  const 失败 = (错误: string): 图片结果 => ({
    成功: false,
    宽: 0,
    高: 0,
    已截断: false,
    错误
  })

  let html: string
  try {
    // 内嵌图片：截图是"拿走一份"，图片必须跟着走，
    // 否则粘到别处就是一堆破图。
    html = await 构建导出HTML({
      ...选项,
      格式: 'html',
      附大纲: false,
      内嵌图片: true
    })
  } catch (错误) {
    return 失败(`渲染失败：${错误 instanceof Error ? 错误.message : String(错误)}`)
  }

  const 临时文件 = join(tmpdir(), `selfmd-图片-${Date.now()}.html`)
  try {
    mkdirSync(dirname(临时文件), { recursive: true })
    writeFileSync(临时文件, html, 'utf8')
  } catch (错误) {
    return 失败(`写入临时文件失败：${错误 instanceof Error ? 错误.message : String(错误)}`)
  }

  const 窗口 = new BrowserWindow({
    show: false,
    width: 宽,
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
    await 窗口.loadURL(pathToFileURL(临时文件).toString())

    // 等图片真正解码完。只等 load 事件不够——那时图片可能还没画上去。
    await 窗口.webContents.executeJavaScript(`
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

    const 量得高度 = await 窗口.webContents.executeJavaScript(
      'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)'
    )
    const 内容高 = typeof 量得高度 === 'number' && 量得高度 > 0 ? Math.ceil(量得高度) : 1200
    const 目标高 = Math.min(内容高, 最大高度)

    窗口.setContentSize(宽, 目标高)
    // 改尺寸之后要再等一帧，布局才会按新高度重排
    await new Promise((完成) => setTimeout(完成, 180))

    const 图 = await 窗口.webContents.capturePage()
    if (图.isEmpty()) return 失败('截图为空，可能是内容过高或渲染未完成')

    clipboard.writeImage(图)
    const 尺寸 = 图.getSize()
    return {
      成功: true,
      宽: 尺寸.width,
      高: 尺寸.height,
      已截断: 内容高 > 最大高度,
      错误: null
    }
  } catch (错误) {
    return 失败(`截图失败：${错误 instanceof Error ? 错误.message : String(错误)}`)
  } finally {
    窗口.destroy()
  }
}

/** 供自测使用：把图片存到磁盘，避免测试污染用户剪贴板。 */
export function 存图片到(路径: string): boolean {
  const 图 = clipboard.readImage()
  if (图.isEmpty()) return false
  try {
    mkdirSync(dirname(路径), { recursive: true })
    writeFileSync(路径, 图.toPNG())
    return true
  } catch {
    return false
  }
}
