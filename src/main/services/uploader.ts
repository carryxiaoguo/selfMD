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

const 执行 = promisify(exec)

/** 单次上传的输出上限，照抄 值。 */
const 输出上限 = 2097152

/** app 模式的重试等待。应用启动需要时间，立刻重试必然失败。 */
const 启动等待 = 5000

export interface 上传成功项 {
  原路径: string
  地址: string
}

export interface 上传失败项 {
  原路径: string
  原因: string
}

export interface 上传结果 {
  成功: 上传成功项[]
  失败: 上传失败项[]
}

/** PicGo / PicList 的本地端点。 */
const 本地端点 = 'http://127.0.0.1:36677/upload'

/** 走 HTTP 的两种上传器。 */
function 是应用模式(上传器: 上传器类型): boolean {
  return 上传器 === 'picgo-app' || 上传器 === 'piclist-app'
}

/** 一次 HTTP 上传尝试。连不上时返回 null 而不是抛异常。 */
async function 试HTTP上传(路径们: string[]): Promise<string | null> {
  try {
    const 响应 = await net.fetch(本地端点, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list: 路径们 })
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
    await 执行(`start "" ${JSON.stringify(程序)}`, {
      windowsHide: true,
      shell: 'cmd.exe'
    })
  } catch {
    // 路径写错或权限不足：重试会自然失败并报出更有用的原因
  }
}

/** 应用模式的完整流程：先试 HTTP，失败则启动应用后重试一次。 */
async function 应用模式上传(路径们: string[]): Promise<{ 地址: string[]; 错误: string | null }> {
  const 设置 = getSettings()

  const 首次 = await 试HTTP上传(路径们)
  if (首次 !== null) {
    return 解析上传结果(首次, 设置.imageUploader, 路径们.length)
  }

  // 没连上：需要知道去哪儿找这个应用才能把它拉起来
  const 程序 = 设置.picgoPath.trim()
  if (程序.length === 0) {
    const 名 = 设置.imageUploader === 'picgo-app' ? 'PicGo' : 'PicList'
    return {
      地址: [],
      错误:
        `无法连接 ${名} 的本地服务（${本地端点}）。` +
        `请先启动 ${名}，或在「偏好设置 → 图片」里填写它的可执行文件路径，` +
        `以便自动启动。`
    }
  }

  if (!existsSync(程序)) {
    return { 地址: [], 错误: `配置的路径不存在：${程序}` }
  }

  await 启动应用(程序)
  await new Promise((完成) => setTimeout(完成, 启动等待))

  const 重试 = await 试HTTP上传(路径们)
  if (重试 === null) {
    return {
      地址: [],
      错误: `已尝试启动 ${程序}，但等待 ${启动等待 / 1000} 秒后仍未连上 ${本地端点}。`
    }
  }
  return 解析上传结果(重试, 设置.imageUploader, 路径们.length)
}

/** 命令行模式的完整流程。 */
async function 命令行上传(
  上传器: 上传器类型,
  路径们: string[]
): Promise<{ 地址: string[]; 错误: string | null }> {
  const 设置 = getSettings()
  const 地址: string[] = []

  // 命令行上传器一次只吃一个文件，所以逐个执行。
  // 这也让"部分失败"成为可能——某一张图挂了不该让整批都失败。
  for (const 路径 of 路径们) {
    const 命令 = 生成上传命令(上传器, 路径, {
      自定义命令: 设置.customImageUploader,
      用户数据目录: getAppPaths().userData.replace(/\\/g, '/'),
      平台: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
    })

    if (!命令) {
      return {
        地址: [],
        错误:
          上传器 === 'custom'
            ? '尚未配置自定义上传命令。请在「偏好设置 → 图片」里填写。'
            : `无法为上传器「${上传器}」生成命令。`
      }
    }

    try {
      const { stdout } = await 执行(命令, { maxBuffer: 输出上限, windowsHide: true })
      const 单个 = 解析上传结果(stdout, 上传器, 1)
      if (单个.错误) return { 地址: [], 错误: 单个.错误 }
      地址.push(...单个.地址)
    } catch (错误) {
      const 文本 = 错误 instanceof Error ? 错误.message : String(错误)
      return { 地址: [], 错误: `执行上传命令失败：${文本.slice(0, 300)}` }
    }
  }

  return { 地址, 错误: null }
}

/**
 * 上传若干张本地图片。
 *
 * 返回一一对应的「原路径 → 远程地址」。上层据此改写文档里的引用。
 */
export async function 上传图片(文件路径们: string[]): Promise<上传结果> {
  const 设置 = getSettings()
  const 待传 = 文件路径们.filter((路径) => 路径.length > 0)

  if (待传.length === 0) return { 成功: [], 失败: [] }

  if (设置.imageUploader === 'none') {
    return {
      成功: [],
      失败: 待传.map((原路径) => ({
        原路径,
        原因: '尚未选择图床上传器。请在「偏好设置 → 图片」里选择。'
      }))
    }
  }

  const 缺失 = 待传.filter((路径) => !existsSync(路径))
  const 存在 = 待传.filter((路径) => existsSync(路径))
  const 失败: 上传失败项[] = 缺失.map((原路径) => ({
    原路径,
    原因: '文件不存在（可能已被移动或删除）'
  }))

  if (存在.length === 0) return { 成功: [], 失败 }

  const 回应 = 是应用模式(设置.imageUploader)
    ? await 应用模式上传(存在)
    : await 命令行上传(设置.imageUploader, 存在)

  if (回应.错误) {
    return {
      成功: [],
      失败: [...失败, ...存在.map((原路径) => ({ 原路径, 原因: 回应.错误 as string }))]
    }
  }

  return {
    成功: 存在.map((原路径, 下标) => ({ 原路径, 地址: 回应.地址[下标] ?? '' })),
    失败
  }
}

/** 当前上传器是否配置完整（供菜单置灰与提示使用）。 */
export function 上传器可用(): { 可用: boolean; 原因: string | null } {
  const 设置 = getSettings()
  if (设置.imageUploader === 'none') {
    return { 可用: false, 原因: '尚未选择图床上传器' }
  }
  if (是应用模式(设置.imageUploader)) {
    // app 模式即使没填路径也可能成功——PicGo 可能已经在运行
    return { 可用: true, 原因: null }
  }
  if (设置.imageUploader === 'custom' && 设置.customImageUploader.trim().length === 0) {
    return { 可用: false, 原因: '尚未配置自定义上传命令' }
  }
  return { 可用: true, 原因: null }
}
