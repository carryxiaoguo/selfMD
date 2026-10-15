import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { 草稿信息 } from '@shared/types'
import { getAppPaths } from '../util/paths'

/**
 * 草稿与崩溃恢复。
 *
 * 草稿目录在运行时会被频繁写入，偶尔的权限或文件占用失败是被预期到的，
 * 不该当成致命错误——写不进去就跳过，下一次改动还会再试。
 *
 * 本项目的做法：**未保存的文档与已保存但被改动的文档都会持续落草稿**，
 * 每个草稿由内容文件（`.md`）与元数据文件（`.json`）一对组成。
 *
 * 为什么分成两个文件而不是塞进一个 JSON：内容是纯文本，
 * 崩溃后用记事本就能直接打开抢救；塞进 JSON 的话转义一坏就全丢了。
 */

/** 草稿键：文件名（去掉扩展名）+ 路径哈希前 8 位。 */
function 计算键(原路径: string | null): string {
  if (!原路径) return '未命名'
  const 名 = basename(原路径, extname(原路径)).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  const 哈希 = createHash('sha1').update(原路径.toLowerCase()).digest('hex').slice(0, 8)
  return `${名}-${哈希}`
}

function 内容文件(键: string): string {
  return join(getAppPaths().drafts, `${键}.md`)
}

function 元数据文件(键: string): string {
  return join(getAppPaths().drafts, `${键}.json`)
}

/**
 * 写入一份草稿。
 *
 * 刻意**不抛异常**：自动保存是后台行为，磁盘满或文件被占用时应当安静地跳过，
 * 而不是弹一个错误打断用户打字。失败就是这一次没存上，下一次改动还会再试。
 */
export function 写草稿(原路径: string | null, 内容: string): boolean {
  const 键 = 计算键(原路径)
  try {
    mkdirSync(getAppPaths().drafts, { recursive: true })
    writeFileSync(内容文件(键), 内容, 'utf8')
    writeFileSync(
      元数据文件(键),
      JSON.stringify({ 原路径, 保存时间: Date.now() }, null, 2),
      'utf8'
    )
    return true
  } catch {
    return false
  }
}

/** 原文件当前的字符数；读不到返回 null。 */
function 取原文件字符数(原路径: string | null): number | null {
  if (!原路径 || !existsSync(原路径)) return null
  try {
    return readFileSync(原路径, 'utf8').length
  } catch {
    return null
  }
}

/** 列出全部草稿，按写入时间从新到旧。 */
export function 列出草稿(): 草稿信息[] {
  const 目录 = getAppPaths().drafts
  if (!existsSync(目录)) return []

  const 结果: 草稿信息[] = []
  for (const 名 of readdirSync(目录)) {
    if (!名.endsWith('.json')) continue
    const 键 = 名.slice(0, -'.json'.length)
    try {
      const 元数据 = JSON.parse(readFileSync(join(目录, 名), 'utf8')) as {
        原路径?: string | null
        保存时间?: number
      }
      const 原路径 = 元数据.原路径 ?? null
      let 原文件时间: number | null = null
      if (原路径 && existsSync(原路径)) {
        try {
          原文件时间 = statSync(原路径).mtimeMs
        } catch {
          原文件时间 = null
        }
      }
      const 内容 = 内容文件(键)
      const 草稿字符数 = existsSync(内容) ? readFileSync(内容, 'utf8').length : 0
      结果.push({
        键,
        原路径,
        保存时间: 元数据.保存时间 ?? 0,
        原文件时间,
        原文件字符数: 取原文件字符数(原路径),
        草稿字符数
      })
    } catch {
      // 元数据损坏：跳过这一条，不让一个坏文件挡住整份恢复列表
    }
  }

  return 结果.sort((a, b) => b.保存时间 - a.保存时间)
}

export function 读草稿(键: string): string | null {
  try {
    const 路径 = 内容文件(键)
    return existsSync(路径) ? readFileSync(路径, 'utf8') : null
  } catch {
    return null
  }
}

export function 删除草稿(键: string): void {
  for (const 路径 of [内容文件(键), 元数据文件(键)]) {
    try {
      rmSync(路径, { force: true })
    } catch {
      // 删不掉就留着，不影响使用
    }
  }
}

/** 文档保存成功后清掉它的草稿——已经落盘了，草稿就没有意义。 */
export function 清理该文档的草稿(原路径: string | null, 内容: string): void {
  const 键 = 计算键(原路径)
  // 只有当草稿内容与刚保存的内容一致时才删：
  // 保存是异步的，期间用户可能又敲了几个字，那部分还没落盘。
  const 现有 = 读草稿(键)
  if (现有 !== null && 现有 !== 内容) return
  删除草稿(键)
}

/**
 * 需要提示恢复的草稿。
 *
 * 判定条件是"草稿比原文件新"，而不是"有草稿就提示"：
 *   - 正常保存后草稿会被清掉，所以残留的草稿多半意味着上次是异常退出
 *   - 但用户也可能在保存后又编辑了几笔就关掉了（没有崩溃），
 *     这种"草稿更新"同样值得恢复
 *
 * 未命名文档（原路径为 null）一律提示：它没有落盘的地方，草稿是唯一的副本。
 */
export function 需要恢复的草稿(): 草稿信息[] {
  return 列出草稿().filter((草稿) => {
    if (!草稿.原路径) return 草稿.草稿字符数 > 0
    if (!existsSync(草稿.原路径)) return 草稿.草稿字符数 > 0
    // 内容没变就不提示——纯粹是时间戳造成的差异不值得打扰用户
    if (草稿.原文件字符数 !== null && 草稿.原文件字符数 === 草稿.草稿字符数) return false
    return 草稿.保存时间 > (草稿.原文件时间 ?? 0)
  })
}
