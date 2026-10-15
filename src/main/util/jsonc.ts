/**
 * 最小化的 JSONC 支持。
 *
 * 配置文件带 `//` 注释是常见做法，所以手工编辑必须能经受住一次往返。
 * 读取时我们接受注释 + 尾随逗号，写回时输出带注释的文件头。
 */

export function stripJsonComments(input: string): string {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const next = input[i + 1]

    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    out += ch
  }
  return out
}

export function stripTrailingCommas(input: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ',') {
      // 向后跳过空白字符，寻找闭合括号
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j++
      if (input[j] === '}' || input[j] === ']') continue
    }
    out += ch
  }
  return out
}

/** 解析 JSONC 文档，任何失败都返回 `fallback`。 */
export function parseJsonc<T>(text: string, fallback: T): T {
  try {
    const cleaned = stripTrailingCommas(stripJsonComments(text))
    const value = JSON.parse(cleaned) as T
    return value ?? fallback
  } catch {
    return fallback
  }
}

export const CONF_HEADER = `/**
 * selfMD user configuration.
 *
 * This file is generated but safe to hand-edit: line comments and trailing
 * commas are accepted. Unknown keys are preserved on rewrite.
 *
 * The on-disk shape is a plain JSON object so that the mental model and the
 * file stay familiar.
 */
`
