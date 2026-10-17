import { net } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 导出用的样式表处理。
 *
 * 屏幕编辑与导出对样式表的需求不同，这里用两个非标准写法来表达这个差异，
 * 这里按它的实现复刻：
 *
 *   1. `@include-when-export <地址>` —— **只在导出时**内联该地址的内容。
 *      典型用法是远程字体：屏幕上不加载（离线可用、不卡首屏），
 *      导出成 HTML 时才带上——因为导出的文件要在别人的浏览器里打开，
 *      那时未必有本地字体。
 *
 *   2. `@import <地址>` —— 标准 CSS，但导出时要真的内联进来，
 *      因为导出的单文件 HTML 不能再依赖旁边的文件。
 *      常见的 night.css 就用它引入深色子样式表。
 *
 * 沿用的正则形状（照抄，以保证现成主题能直接迁移）：
 *   /^\s*@include-when-export\s+(url)?([('"]+)([^\)"']+)([)'"]+)/im
 *   /^\s*@import\s+(url)?([('"]+)([^\)"']+)([)'"]+)/im
 */

const 导出包含正则 = /^\s*@include-when-export\s+(url)?\s*([('"]+)([^)"']+)([)'"]+)/gim
const 导入正则 = /^\s*@import\s+(url)?\s*([('"]+)([^)"']+)([)'"]+)/gim

/** 递归深度上限。CSS 里的 @import 环路会让内联永不终止。 */
const 最大深度 = 8

export interface 样式处理选项 {
  /** 相对路径的解析基准（通常是主题目录）。 */
  baseDir: string;
  /** 是否内联 `@include-when-export` 指定的地址。屏幕预览时传 false。 */
  导出模式?: boolean
}

/** 解析一个地址：远程走网络，本地读文件。取不到时返回 null，不抛。 */
async function 取资源(
  url: string,
  baseDir: string
): Promise<{ content: string; baseline: string } | null> {
  if (/^https?:\/\//i.test(url)) {
    try {
      const response = await net.fetch(url)
      if (!response.ok) return null
      // 远程样式表里的相对地址以它自己的 URL 为基准
      const 新基准 = new URL('.', url).toString()
      return { content: await response.text(), baseline: 新基准 }
    } catch {
      // 离线或对方不可达：导出不该因此失败，只是少了这段样式。
      return null
    }
  }
  const whole = isAbsolute(url) ? url : resolve(baseDir, url)
  try {
    if (!existsSync(whole)) return null
    // 嵌套 @import 的相对路径以**被导入文件所在目录**为基准，
    // 不是最初那个目录。用同一个基准会让二级导入全部找不到。
    return { content: readFileSync(whole, 'utf8'), baseline: dirname(whole) }
  } catch {
    return null
  }
}

/** 把内联进来的内容再递归处理一遍（它自己可能还有 @import）。 */
async function 内联(
  docText: string,
  baseDir: string,
  depth: number,
  options: 样式处理选项
): Promise<string> {
  if (depth >= 最大深度) return docText

  let result = docText

  if (options.导出模式) {
    // --- @include-when-export ---
    const 待替换: { originalText: string; url: string }[] = []
    for (const match of result.matchAll(导出包含正则)) {
      待替换.push({ originalText: match[0], url: match[3] })
    }
    for (const { originalText, url } of 待替换) {
      const resource = await 取资源(url, baseDir)
      // 取不到就**删掉这一行**而不是留着：这不是浏览器认识的规则，
      // 留着只会变成一条无效样式，还容易让人以为它生效了。
      const replace = resource ? await 内联(resource.content, resource.baseline, depth + 1, options) : ''
      result = result.replace(originalText, () => replace)
    }
  }

  // --- @import ---
  // 屏幕模式下也内联 @import：主题的深色子样式表本来依赖旁边的文件，
  // 而预览协议虽能服务子目录，内联后一次请求就够。
  const 导入项: { originalText: string; url: string }[] = []
  for (const match of result.matchAll(导入正则)) {
    导入项.push({ originalText: match[0], url: match[3] })
  }
  for (const { originalText, url } of 导入项) {
    const resource = await 取资源(url, baseDir)
    if (!resource) continue
    const replace = await 内联(resource.content, resource.baseline, depth + 1, options)
    result = result.replace(originalText, () => replace)
  }

  return result
}

/**
 * 处理样式表：内联 `@include-when-export` 与 `@import`。
 *
 * 屏幕预览时 `导出模式` 传 false，只做 `@import` 内联；
 * 导出时传 true，两者都做。
 */
export async function 处理样式表(
  docText: string,
  options: 样式处理选项
): Promise<string> {
  return 内联(docText, options.baseDir, 0, options)
}

/**
 * 把样式表里的本地 `url(...)` 转成 `file://` 绝对地址。
 *
 * 导出的 HTML 可能被放到别处打开，相对路径就失效了；转成绝对地址至少
 * 在本机可用。若开启了图片内嵌，则由另一处把图片换成 data:。
 */
export function 绝对化本地地址(docText: string, baseDir: string): string {
  return docText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (wholeText, _引号, url: string) => {
    if (/^(https?:|data:|file:|#)/i.test(url)) return wholeText
    const whole = isAbsolute(url) ? url : join(baseDir, url)
    return `url("${pathToFileURL(whole).toString()}")`
  })
}

/** 样式表在其内部用 @import 引用别的文件时，基准目录要跟着变。 */
export function 子样式基准(当前基准: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return 当前基准
  return dirname(isAbsolute(url) ? url : resolve(当前基准, url))
}

/** 判断一段样式里是否还有导出时才需要处理的指令。 */
export function 含导出指令(docText: string): boolean {
  导出包含正则.lastIndex = 0
  return 导出包含正则.test(docText)
}
