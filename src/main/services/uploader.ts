import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { net } from 'electron'
import { promisify } from 'node:util'
import { 上传器类型 } from '@shared/types'
import { 生成上传命令, 解析上传结果 } from '@shared/upload-parse'
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
const 输出上限 = 2097152

/** app 模式的重试等待。应用启动需要时间，立刻重试必然失败。 */
const 启动等待 = 5000

export interface 上传成功项 {
  rawPath: string
  url: string
}

export interface 上传失败项 {
  rawPath: string
  原因: string
}

export interface 上传结果 {
  success: 上传成功项[]
  failure: 上传失败项[]
}

/** PicGo / PicList 的本地端点。 */
const 本地端点 = 'http://127.0.0.1:36677/upload'

/** 走 HTTP 的两种上传器。 */
function 是应用模式(上传器: 上传器类型): boolean {
  return 上传器 === 'picgo-app' || 上传器 === 'piclist-app'
}

/** 一次 HTTP 上传尝试。连不上时返回 null 而不是抛异常。 */
async function 试HTTP上传(paths: string[]): Promise<string | null> {
  try {
    const 响应 = await net.fetch(本地端点, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list: paths })
    })
    if (!响应.ok) return null
    return await 响应.text()
  } catch {
    // 连接被拒 = PicGo 没在运行。这是预期内的分支，不是错误。
    return null
  }
}

/** 启动 PicGo / PicList 应用。启动失败只记录，不影响后续重试。 */
async function 启动应用(程序: string): Promise<void> {
  if (程序.length === 0) return
  try {
    // 用 exec 而不是 spawn + detached：这里只关心"把它拉起来"，
    // 不接管它的生命周期——用户可能本来就想让它常驻托盘。
    await run(`start "" ${JSON.stringify(程序)}`, {
      windowsHide: true,
      shell: 'cmd.exe'
    })
  } catch {
    // 路径写错或权限不足：重试会自然失败并报出更有用的原因
  }
}

/** 应用模式的完整流程：先试 HTTP，失败则启动应用后重试一次。 */
async function 应用模式上传(paths: string[]): Promise<{ url: string[]; error: string | null }> {
  const settings = getSettings()

  const 首次 = await 试HTTP上传(paths)
  if (首次 !== null) {
    return 解析上传结果(首次, settings.imageUploader, paths.length)
  }

  // 没连上：需要知道去哪儿找这个应用才能把它拉起来
  const 程序 = settings.picgoPath.trim()
  if (程序.length === 0) {
    const name = settings.imageUploader === 'picgo-app' ? 'PicGo' : 'PicList'
    return {
      url: [],
      error:
        `无法连接 ${name} 的本地服务（${本地端点}）。` +
        `请先启动 ${name}，或在「偏好设置 → 图片」里填写它的可执行文件路径，` +
        `以便自动启动。`
    }
  }

  if (!existsSync(程序)) {
    return { url: [], error: `配置的路径不存在：${程序}` }
  }

  await 启动应用(程序)
  await new Promise((done) => setTimeout(done, 启动等待))

  const 重试 = await 试HTTP上传(paths)
  if (重试 === null) {
    return {
      url: [],
      error: `已尝试启动 ${程序}，但等待 ${启动等待 / 1000} 秒后仍未连上 ${本地端点}。`
    }
  }
  return 解析上传结果(重试, settings.imageUploader, paths.length)
}

/** 命令行模式的完整流程。 */
async function 命令行上传(
  上传器: 上传器类型,
  paths: string[]
): Promise<{ url: string[]; error: string | null }> {
  const settings = getSettings()
  const url: string[] = []

  // 命令行上传器一次只吃一个文件，所以逐个执行。
  // 这也让"部分失败"成为可能——某一张图挂了不该让整批都失败。
  for (const filePath of paths) {
    const command = 生成上传命令(上传器, filePath, {
      自定义命令: settings.customImageUploader,
      用户数据目录: getAppPaths().userData.replace(/\\/g, '/'),
      platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
    })

    if (!command) {
      return {
        url: [],
        error:
          上传器 === 'custom'
            ? '尚未配置自定义上传命令。请在「偏好设置 → 图片」里填写。'
            : `无法为上传器「${上传器}」生成命令。`
      }
    }

    try {
      const { stdout } = await run(command, { maxBuffer: 输出上限, windowsHide: true })
      const 单个 = 解析上传结果(stdout, 上传器, 1)
      if (单个.error) return { url: [], error: 单个.error }
      url.push(...单个.url)
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
export async function 上传图片(文件路径们: string[]): Promise<上传结果> {
  const settings = getSettings()
  const 待传 = 文件路径们.filter((filePath) => filePath.length > 0)

  if (待传.length === 0) return { success: [], failure: [] }

  if (settings.imageUploader === 'none') {
    return {
      success: [],
      failure: 待传.map((rawPath) => ({
        rawPath,
        原因: '尚未选择图床上传器。请在「偏好设置 → 图片」里选择。'
      }))
    }
  }

  const 缺失 = 待传.filter((filePath) => !existsSync(filePath))
  const exists = 待传.filter((filePath) => existsSync(filePath))
  const failure: 上传失败项[] = 缺失.map((rawPath) => ({
    rawPath,
    原因: '文件不存在（可能已被移动或删除）'
  }))

  if (exists.length === 0) return { success: [], failure }

  const 回应 = 是应用模式(settings.imageUploader)
    ? await 应用模式上传(exists)
    : await 命令行上传(settings.imageUploader, exists)

  if (回应.error) {
    return {
      success: [],
      failure: [...failure, ...exists.map((rawPath) => ({ rawPath, 原因: 回应.error as string }))]
    }
  }

  return {
    success: exists.map((rawPath, subscript) => ({ rawPath, url: 回应.url[subscript] ?? '' })),
    failure
  }
}

/** 当前上传器是否配置完整（供菜单置灰与提示使用）。 */
export function 上传器可用(): { 可用: boolean; 原因: string | null } {
  const settings = getSettings()
  if (settings.imageUploader === 'none') {
    return { 可用: false, 原因: '尚未选择图床上传器' }
  }
  if (是应用模式(settings.imageUploader)) {
    // app 模式即使没填路径也可能成功——PicGo 可能已经在运行
    return { 可用: true, 原因: null }
  }
  if (settings.imageUploader === 'custom' && settings.customImageUploader.trim().length === 0) {
    return { 可用: false, 原因: '尚未配置自定义上传命令' }
  }
  return { 可用: true, 原因: null }
}
