import { clipboard, ipcMain, net } from 'electron'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CH, type ClipboardContent, type ImageDownloadResult } from '@shared/ipc'
import { 上传图片, 上传器可用 } from '../services/uploader'
import {
  去扩展名,
  取文件名,
  唯一文件名,
  扩展名由类型,
  归一化路径,
  是图片文件,
  类型由扩展名
} from '@shared/image-path'
/**
 * 图片相关的原生能力。
 *
 * 三件事只有主进程能做：读系统剪贴板、写本地文件、发网络请求。
 * 编排逻辑（图片该放哪、要不要搬运、Markdown 怎么改写）全在渲染层，
 * 这里只提供原子动作。
 */

/** 单张图片的下载上限。防止一个手滑的链接把内存吃满。 */
const 下载上限字节 = 50 * 1024 * 1024

// ---------------------------------------------------------------------------
// 剪贴板
// ---------------------------------------------------------------------------

/**
 * 读取剪贴板，判定是位图、文件还是空。
 *
 * **必须优先按文件处理。** 在 Windows 上从资源管理器复制图片时，剪贴板会同时
 * 提供文件名列表（`FileNameW` 格式）与位图；前者指向磁盘上的原图，后者可能是
 * 被系统压缩或缩放过的预览。若先取位图，用户粘进来的就是一张糊图。
 * 通行做法同样额外读取了 `FileNameW`，这里比它多做一步：按空字符切分，
 * 因此一次复制多张图也能识别。
 */
function 读剪贴板(): ClipboardContent {
  try {
    const 文件名缓冲 = clipboard.readBuffer('FileNameW')
    if (文件名缓冲 && 文件名缓冲.length > 0) {
      // FileNameW 是 UTF-16LE，多个路径以空字符分隔，末尾再补一个空字符。
      const 路径们 = 文件名缓冲
        .toString('ucs2')
        .split('\0')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && 是图片文件(s))
      if (路径们.length > 0) return { 类型: '文件', 路径: 路径们 }
    }

    const 位图 = clipboard.readImage()
    if (位图 && !位图.isEmpty()) {
      const 尺寸 = 位图.getSize()
      return {
        类型: '位图',
        数据: 位图.toPNG().toString('base64'),
        宽: 尺寸.width,
        高: 尺寸.height
      }
    }
  } catch (错误) {
    console.error('[图片] 读取剪贴板失败：', 错误)
  }
  return { 类型: '无' }
}

// ---------------------------------------------------------------------------
// 落盘
// ---------------------------------------------------------------------------

/** 在目录内挑一个不冲突的名字。 */
function 安排路径(目录: string, 期望名: string): string {
  mkdirSync(目录, { recursive: true })
  const 最终名 = 唯一文件名(期望名, (候选) => existsSync(join(目录, 候选)))
  return join(目录, 最终名)
}

/**
 * 校正扩展名。
 *
 * 服务端返回的 `Content-Type` 比 URL 里的后缀更可信：很多图床把图片挂在
 * 没有后缀的路径上，也有些把 `.jpg` 实际返回 PNG 内容。有类型就按类型走。
 */
function 校正扩展名(名称: string, 类型: string | null): string {
  const 应由类型 = 扩展名由类型(类型)
  if (!应由类型) return 名称
  const 现有 = 类型由扩展名(名称)
  if (!现有) return 名称 + 应由类型
  return 现有 === 应由类型 ? 名称 : 去扩展名(名称) + 应由类型
}

export function registerImageIpc(): void {
  ipcMain.handle(CH.imageReadClipboard, (): ClipboardContent => 读剪贴板())

  ipcMain.handle(
    CH.imageSaveBytes,
    (_e, 目录: string, 名称: string, 数据: string): { 路径: string } | null => {
      try {
        const 路径 = 安排路径(目录, 名称)
        writeFileSync(路径, Buffer.from(数据, 'base64'))
        return { 路径: 归一化路径(路径) }
      } catch (错误) {
        console.error('[图片] 写入失败：', 错误)
        return null
      }
    }
  )

  ipcMain.handle(
    CH.imageImport,
    (_e, 来源: string, 目录: string, 名称?: string): { 路径: string } | null => {
      try {
        if (!existsSync(来源)) return null
        const 期望名 = 名称 && 名称.length > 0 ? 名称 : 取文件名(来源)
        const 路径 = 安排路径(目录, 期望名)
        // 源与目标相同时不复制，直接返回——否则会自己覆盖自己。
        if (归一化路径(来源) === 归一化路径(路径)) return { 路径: 归一化路径(路径) }
        copyFileSync(来源, 路径)
        return { 路径: 归一化路径(路径) }
      } catch (错误) {
        console.error('[图片] 复制失败：', 错误)
        return null
      }
    }
  )

  ipcMain.handle(
    CH.imageUpload,
    (_e, 路径们: string[]) => 上传图片(路径们)
  )

  ipcMain.handle(CH.imageUploaderStatus, () => 上传器可用())

  ipcMain.handle(
    CH.imageDownload,
    async (_e, url: string, 目录: string, 名称: string): Promise<ImageDownloadResult> => {
      const 失败 = (错误: string): ImageDownloadResult => ({
        成功: false,
        路径: null,
        类型: null,
        错误
      })

      if (!/^https?:\/\//i.test(url)) return 失败('只支持 http 与 https 地址')

      try {
        // 用 Electron 的 net.fetch 而不是 Node 的 fetch：它会走 Chromium 的
        // 网络栈，自动继承系统代理与证书设置，与用户在浏览器里的体验一致。
        const 响应 = await net.fetch(url, { redirect: 'follow' })
        if (!响应.ok) return 失败(`服务端返回 ${响应.status}`)

        const 声明长度 = Number(响应.headers.get('content-length') ?? '0')
        if (声明长度 > 下载上限字节) {
          return 失败(`图片过大（${Math.round(声明长度 / 1024 / 1024)} MB）`)
        }

        const 类型 = 响应.headers.get('content-type')
        const 缓冲 = Buffer.from(await 响应.arrayBuffer())
        if (缓冲.length === 0) return 失败('下载内容为空')
        if (缓冲.length > 下载上限字节) return 失败('图片过大')

        const 路径 = 安排路径(目录, 校正扩展名(名称, 类型))
        writeFileSync(路径, 缓冲)
        return { 成功: true, 路径: 归一化路径(路径), 类型, 错误: null }      } catch (错误) {
        return 失败(错误 instanceof Error ? 错误.message : String(错误))
      }
    }
  )
}
