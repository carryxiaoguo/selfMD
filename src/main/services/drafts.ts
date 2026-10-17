import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DraftInfo } from '@shared/types'
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
function 计算键(rawPath: string | null): string {
  if (!rawPath) return '未命名'
  const name = basename(rawPath, extname(rawPath)).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  const 哈希 = createHash('sha1').update(rawPath.toLowerCase()).digest('hex').slice(0, 8)
  return `${name}-${哈希}`
}

function contentFile(key: string): string {
  return join(getAppPaths().drafts, `${key}.md`)
}

function 元数据文件(key: string): string {
  return join(getAppPaths().drafts, `${key}.json`)
}

/**
 * 写入一份草稿。
 *
 * 刻意**不抛异常**：自动保存是后台行为，磁盘满或文件被占用时应当安静地跳过，
 * 而不是弹一个错误打断用户打字。失败就是这一次没存上，下一次改动还会再试。
 */
export function writeDraft(rawPath: string | null, content: string): boolean {
  const key = 计算键(rawPath)
  try {
    mkdirSync(getAppPaths().drafts, { recursive: true })
    writeFileSync(contentFile(key), content, 'utf8')
    writeFileSync(
      元数据文件(key),
      JSON.stringify({ rawPath, savedAt: Date.now() }, null, 2),
      'utf8'
    )
    return true
  } catch {
    return false
  }
}

/** 原文件当前的字符数；读不到返回 null。 */
function 取原文件字符数(rawPath: string | null): number | null {
  if (!rawPath || !existsSync(rawPath)) return null
  try {
    return readFileSync(rawPath, 'utf8').length
  } catch {
    return null
  }
}

/** 列出全部草稿，按写入时间从新到旧。 */
export function listDrafts(): DraftInfo[] {
  const dir = getAppPaths().drafts
  if (!existsSync(dir)) return []

  const result: DraftInfo[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const key = name.slice(0, -'.json'.length)
    try {
      const meta = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        rawPath?: string | null
        savedAt?: number
      }
      const rawPath = meta.rawPath ?? null
      let originalMtime: number | null = null
      if (rawPath && existsSync(rawPath)) {
        try {
          originalMtime = statSync(rawPath).mtimeMs
        } catch {
          originalMtime = null
        }
      }
      const content = contentFile(key)
      const draftChars = existsSync(content) ? readFileSync(content, 'utf8').length : 0
      result.push({
        key,
        rawPath,
        savedAt: meta.savedAt ?? 0,
        originalMtime,
        originalCharCount: 取原文件字符数(rawPath),
        draftChars
      })
    } catch {
      // 元数据损坏：跳过这一条，不让一个坏文件挡住整份恢复列表
    }
  }

  return result.sort((a, b) => b.savedAt - a.savedAt)
}

export function readDraft(key: string): string | null {
  try {
    const filePath = contentFile(key)
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  } catch {
    return null
  }
}

export function deleteDraft(key: string): void {
  for (const filePath of [contentFile(key), 元数据文件(key)]) {
    try {
      rmSync(filePath, { force: true })
    } catch {
      // 删不掉就留着，不影响使用
    }
  }
}

/** 文档保存成功后清掉它的草稿——已经落盘了，草稿就没有意义。 */
export function clearDocDraft(rawPath: string | null, content: string): void {
  const key = 计算键(rawPath)
  // 只有当草稿内容与刚保存的内容一致时才删：
  // 保存是异步的，期间用户可能又敲了几个字，那部分还没落盘。
  const existing = readDraft(key)
  if (existing !== null && existing !== content) return
  deleteDraft(key)
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
export function recoverableDraft(): DraftInfo[] {
  return listDrafts().filter((draft) => {
    if (!draft.rawPath) return draft.draftChars > 0
    if (!existsSync(draft.rawPath)) return draft.draftChars > 0
    // 内容没变就不提示——纯粹是时间戳造成的差异不值得打扰用户
    if (draft.originalCharCount !== null && draft.originalCharCount === draft.draftChars) return false
    return draft.savedAt > (draft.originalMtime ?? 0)
  })
}
