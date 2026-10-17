import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { net } from 'electron'
import { promisify } from 'node:util'
import { uploaderType } from '@shared/types'
import { buildUploadCmd, parseUploadResult } from '@shared/upload-parse'
import { getAppPaths } from '../util/paths'
import { getSettings } from './settings'

/**
 * 图床上传。
 *
 * 本编辑器**不内置任何图床 SDK**，
 * 唯一的 HTTP 端点是 PicGo/PicList 在本地监听的
 * `http://127.0.0.1:36677/upload`；其余全部委托外部命令行程序。
 * 本项目沿用同样的分工——理由很实在：图床协议五花八门，
 * 自己实现等于要给每家写一个适配器；而 PicGo 生态已经把这件事做完了。
 *
 * 两条路：
 *
 *   1. **app 模式**（PicGo / PicList）：先试本地 HTTP。连不上就启动应用，
 *      **等 5 秒后重试一次**——应用启动需要时间，立刻重试必然还是失败。
 *      这是 到的行为（`setTimeout(..., 5e3)`）。
 *   2. **命令行模式**：`exec(命令 + " " + 带引号的路径)`，`maxBuffer` 2 MiB
 *      。
 *
 * 产物只有两样：成功的「原路径 → 远程地址」映射，与失败的「原路径 → 原因」。
 * 回填文档由渲染层负责——主进程不该去改用户的 Markdown。
 */

const run = promisify(exec)

/** 单次上传的输出上限，照抄 值。 */
const outputLimit = 2097152

/** app 模式的重试等待。应用启动需要时间，立刻重试必然失败。 */
const startupWait = 5000

export interface uploadSuccess {
  rawPath: string
  url: string
}

export interface uploadFailure {
  rawPath: string
  reason: string
}

export interface uploadResult {
  success: uploadSuccess[]
  failure: uploadFailure[]
}

/** PicGo / PicList 的本地端点。 */
const localEndpoint = 'http://127.0.0.1:36677/upload'

/** 走 HTTP 的两种上传器。 */
function isAppMode(uploader: uploaderType): boolean {
  return uploader === 'picgo-app' || uploader === 'piclist-app'
}

/** 一次 HTTP 上传尝试。连不上时返回 null 而不是抛异常。 */
async function tryHttpUpload(paths: string[]): Promise<string | null> {
  try {
    const response = await net.fetch(localEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list: paths })
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    // 连接被拒 = PicGo 没在运行。这是预期内的分支，不是错误。
    return null
  }
}

/** 启动 PicGo / PicList 应用。启动失败只记录，不影响后续重试。 */
async function launchApp(program: string): Promise<void> {
  if (program.length === 0) return
  try {
    // 用 exec 而不是 spawn + detached：这里只关心"把它拉起来"，
    // 不接管它的生命周期——用户可能本来就想让它常驻托盘。
    await run(`start "" ${JSON.stringify(program)}`, {
      windowsHide: true,
      shell: 'cmd.exe'
    })
  } catch {
    // 路径写错或权限不足：重试会自然失败并报出更有用的原因
  }
}

/** 应用模式的完整流程：先试 HTTP，失败则启动应用后重试一次。 */
async function appModeUpload(paths: string[]): Promise<{ url: string[]; error: string | null }> {
  const settings = getSettings()

  const firstTime = await tryHttpUpload(paths)
  if (firstTime !== null) {
    return parseUploadResult(firstTime, settings.imageUploader, paths.length)
  }

  // 没连上：需要知道去哪儿找这个应用才能把它拉起来
  const program = settings.picgoPath.trim()
  if (program.length === 0) {
    const name = settings.imageUploader === 'picgo-app' ? 'PicGo' : 'PicList'
    return {
      url: [],
      error:
        `无法连接 ${name} 的本地服务（${localEndpoint}）。` +
        `请先启动 ${name}，或在「偏好设置 → 图片」里填写它的可执行文件路径，` +
        `以便自动启动。`
    }
  }

  if (!existsSync(program)) {
    return { url: [], error: `配置的路径不存在：${program}` }
  }

  await launchApp(program)
  await new Promise((done) => setTimeout(done, startupWait))

  const retryCount = await tryHttpUpload(paths)
  if (retryCount === null) {
    return {
      url: [],
      error: `已尝试启动 ${program}，但等待 ${startupWait / 1000} 秒后仍未连上 ${localEndpoint}。`
    }
  }
  return parseUploadResult(retryCount, settings.imageUploader, paths.length)
}

/** 命令行模式的完整流程。 */
async function cliUpload(
  uploader: uploaderType,
  paths: string[]
): Promise<{ url: string[]; error: string | null }> {
  const settings = getSettings()
  const url: string[] = []

  // 命令行上传器一次只吃一个文件，所以逐个执行。
  // 这也让"部分失败"成为可能——某一张图挂了不该让整批都失败。
  for (const filePath of paths) {
    const command = buildUploadCmd(uploader, filePath, {
      customCommand: settings.customImageUploader,
      userDataDir: getAppPaths().userData.replace(/\\/g, '/'),
      platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
    })

    if (!command) {
      return {
        url: [],
        error:
          uploader === 'custom'
            ? '尚未配置自定义上传命令。请在「偏好设置 → 图片」里填写。'
            : `无法为上传器「${uploader}」生成命令。`
      }
    }

    try {
      const { stdout } = await run(command, { maxBuffer: outputLimit, windowsHide: true })
      const singleOne = parseUploadResult(stdout, uploader, 1)
      if (singleOne.error) return { url: [], error: singleOne.error }
      url.push(...singleOne.url)
    } catch (error) {
      const docText = error instanceof Error ? error.message : String(error)
      return { url: [], error: `执行上传命令失败：${docText.slice(0, 300)}` }
    }
  }

  return { url, error: null }
}

/**
 * 上传若干张本地图片。
 *
 * 返回一一对应的「原路径 → 远程地址」。上层据此改写文档里的引用。
 */
export async function uploadImage(filePaths: string[]): Promise<uploadResult> {
  const settings = getSettings()
  const pendingUpload = filePaths.filter((filePath) => filePath.length > 0)

  if (pendingUpload.length === 0) return { success: [], failure: [] }

  if (settings.imageUploader === 'none') {
    return {
      success: [],
      failure: pendingUpload.map((rawPath) => ({
        rawPath,
        reason: '尚未选择图床上传器。请在「偏好设置 → 图片」里选择。'
      }))
    }
  }

  const missingFlag = pendingUpload.filter((filePath) => !existsSync(filePath))
  const exists = pendingUpload.filter((filePath) => existsSync(filePath))
  const failure: uploadFailure[] = missingFlag.map((rawPath) => ({
    rawPath,
    reason: '文件不存在（可能已被移动或删除）'
  }))

  if (exists.length === 0) return { success: [], failure }

  const reply = isAppMode(settings.imageUploader)
    ? await appModeUpload(exists)
    : await cliUpload(settings.imageUploader, exists)

  if (reply.error) {
    return {
      success: [],
      failure: [...failure, ...exists.map((rawPath) => ({ rawPath, reason: reply.error as string }))]
    }
  }

  return {
    success: exists.map((rawPath, subscript) => ({ rawPath, url: reply.url[subscript] ?? '' })),
    failure
  }
}

/** 当前上传器是否配置完整（供菜单置灰与提示使用）。 */
export function uploaderAvailable(): { available: boolean; reason: string | null } {
  const settings = getSettings()
  if (settings.imageUploader === 'none') {
    return { available: false, reason: '尚未选择图床上传器' }
  }
  if (isAppMode(settings.imageUploader)) {
    // app 模式即使没填路径也可能成功——PicGo 可能已经在运行
    return { available: true, reason: null }
  }
  if (settings.imageUploader === 'custom' && settings.customImageUploader.trim().length === 0) {
    return { available: false, reason: '尚未配置自定义上传命令' }
  }
  return { available: true, reason: null }
}
