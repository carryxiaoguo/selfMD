import { clipboard, ipcMain, net } from 'electron'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CH, type ClipboardContent, type ImageDownloadResult } from '@shared/ipc'
import { 上传图片, 上传器可用 } from '../services/uploader'
import {
  去扩展名,
  takeFileName,
  唯一文件名,
  扩展名由类型,
  normalizePath,
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
      const paths = 文件名缓冲
        .toString('ucs2')
        .split('\0')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && 是图片文件(s))
      if (paths.length > 0) return { kind: '文件', filePath: paths }
    }

    const 位图 = clipboard.readImage()
    if (位图 && !位图.isEmpty()) {
      const size = 位图.getSize()
      return {
        kind: '位图',
        data: 位图.toPNG().toString('base64'),
        width: size.width,
        height: size.height
      }
    }
  } catch (error) {
    console.error('[图片] 读取剪贴板失败：', error)
  }
  return { kind: '无' }
}

// ---------------------------------------------------------------------------
// 落盘
// ---------------------------------------------------------------------------

/** 在目录内挑一个不冲突的名字。 */
function 安排路径(dir: string, expectedName: string): string {
  mkdirSync(dir, { recursive: true })
  const 最终名 = 唯一文件名(expectedName, (candidate) => existsSync(join(dir, candidate)))
  return join(dir, 最终名)
}

/**
 * 校正扩展名。
 *
 * 服务端返回的 `Content-Type` 比 URL 里的后缀更可信：很多图床把图片挂在
 * 没有后缀的路径上，也有些把 `.jpg` 实际返回 PNG 内容。有类型就按类型走。
 */
function 校正扩展名(displayName: string, kind: string | null): string {
  const 应由类型 = 扩展名由类型(kind)
  if (!应由类型) return displayName
  const 现有 = 类型由扩展名(displayName)
  if (!现有) return displayName + 应由类型
  return 现有 === 应由类型 ? displayName : 去扩展名(displayName) + 应由类型
}

export function registerImageIpc(): void {
  ipcMain.handle(CH.imageReadClipboard, (): ClipboardContent => 读剪贴板())

  ipcMain.handle(
    CH.imageSaveBytes,
    (_e, dir: string, displayName: string, data: string): { filePath: string } | null => {
      try {
        const filePath = 安排路径(dir, displayName)
        writeFileSync(filePath, Buffer.from(data, 'base64'))
        return { filePath: normalizePath(filePath) }
      } catch (error) {
        console.error('[图片] 写入失败：', error)
        return null
      }
    }
  )

  ipcMain.handle(
    CH.imageImport,
    (_e, origin: string, dir: string, displayName?: string): { filePath: string } | null => {
      try {
        if (!existsSync(origin)) return null
        const expectedName = displayName && displayName.length > 0 ? displayName : takeFileName(origin)
        const filePath = 安排路径(dir, expectedName)
        // 源与目标相同时不复制，直接返回——否则会自己覆盖自己。
        if (normalizePath(origin) === normalizePath(filePath)) return { filePath: normalizePath(filePath) }
        copyFileSync(origin, filePath)
        return { filePath: normalizePath(filePath) }
      } catch (error) {
        console.error('[图片] 复制失败：', error)
        return null
      }
    }
  )

  ipcMain.handle(
    CH.imageUpload,
    (_e, paths: string[]) => 上传图片(paths)
  )

  ipcMain.handle(CH.imageUploaderStatus, () => 上传器可用())

  ipcMain.handle(
    CH.imageDownload,
    async (_e, url: string, dir: string, displayName: string): Promise<ImageDownloadResult> => {
      const failure = (error: string): ImageDownloadResult => ({
        success: false,
        filePath: null,
        kind: null,
        error
      })

      if (!/^https?:\/\//i.test(url)) return failure('只支持 http 与 https 地址')

      try {
        // 用 Electron 的 net.fetch 而不是 Node 的 fetch：它会走 Chromium 的
        // 网络栈，自动继承系统代理与证书设置，与用户在浏览器里的体验一致。
        const response = await net.fetch(url, { redirect: 'follow' })
        if (!response.ok) return failure(`服务端返回 ${response.status}`)

        const 声明长度 = Number(response.headers.get('content-length') ?? '0')
        if (声明长度 > 下载上限字节) {
          return failure(`图片过大（${Math.round(声明长度 / 1024 / 1024)} MB）`)
        }

        const kind = response.headers.get('content-type')
        const 缓冲 = Buffer.from(await response.arrayBuffer())
        if (缓冲.length === 0) return failure('下载内容为空')
        if (缓冲.length > 下载上限字节) return failure('图片过大')

        const filePath = 安排路径(dir, 校正扩展名(displayName, kind))
        writeFileSync(filePath, 缓冲)
        return { success: true, filePath: normalizePath(filePath), kind, error: null }      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error))
      }
    }
  )
}
