import { stripExt, takeFileName, isAbsolute, normalizePath } from '@shared/image-path'

/**
 * 图片引用文本生成。
 *
 * 纯函数：吃"图片的绝对路径 + 文档目录 + 若干设置"，吐一段可以直接写进
 * Markdown 的引用。之所以单独成模块，是因为这里的每条规则都对应一种真实的
 * 失败：路径写成反斜杠会让别的 Markdown 渲染器解析不了；含空格的路径不转义
 * 会在第一次点击时断掉；`./` 前缀的取舍直接决定同一份文档换台机器还能不能
 * 找到图。
 */

export interface 引用选项 {
  /** 尽量用相对文档目录的路径。 */
  useRelativePath: boolean
  /** 相对路径是否加 `./` 前缀（`relativePathWithDot`）。 */
  addDotPrefix: boolean
  /** 是否把空格等字符转义成百分号编码（`autoEscapeImageURL`）。 */
  escapeUrl: boolean
}

/**
 * 计算从 `从` 到 `到` 的相对路径。
 *
 * 两者根不同（盘符不一样、一个 UNC 一个本地）时无法表达相对关系，
 * 此时原样返回目标路径——回退成绝对路径永远比给出一个错误相对路径好。
 */
export function relativeTo(fromSrc: string, toPos: string): string {
  const alpha = normalizePath(fromSrc).split('/').filter(Boolean)
  const beta = normalizePath(toPos).split('/').filter(Boolean)
  if (alpha.length === 0 || beta.length === 0) return normalizePath(toPos)
  if (alpha[0].toLowerCase() !== beta[0].toLowerCase()) return normalizePath(toPos)

  let commonPart = 0
  while (commonPart < alpha.length && commonPart < beta.length && alpha[commonPart] === beta[commonPart]) commonPart += 1
  // 只有一个根段相同时（例如 C: 对 C:），相对关系不成立。
  if (commonPart === 0) return normalizePath(toPos)

  const 上行 = new Array(Math.max(0, alpha.length - commonPart)).fill('..')
  const 下行 = beta.slice(commonPart)
  const result = [...上行, ...下行].join('/')
  return result.length > 0 ? result : '.'
}

/**
 * 需要转义的字符表。
 *
 * 只收**真正会破坏解析**的那些：空白会截断 Markdown 链接地址，`#` 与 `?`
 * 在 URL 里有语法含义（片段与查询），`%` 不转义会造成二次编码，
 * 尖括号与反引号在部分渲染器里会被当成 HTML。
 */
const 需转义: Record<string, string> = {
  ' ': '%20',
  '#': '%23',
  '?': '%3F',
  '%': '%25',
  '"': '%22',
  '<': '%3C',
  '>': '%3E',
  '`': '%60',
  '{': '%7B',
  '}': '%7D',
  '|': '%7C',
  '^': '%5E'
}

/**
 * 转义图片地址。
 *
 * **刻意不用 `encodeURI`。** 它会把每个中文字符变成三字节转义，于是
 * `![图](图/样本.png)` 会写成 `![图](%E5%9B%BE/%E6%A0%B7%E6%9C%AC.png)`——
 * 能加载，但完全读不出来，也没法手改。这个偏差是端到端测试暴露的：
 * 第一版跑出来的引用就是一串 `%E5%9B%BE`。
 *
 * 直觉的做法是 `encodeURI`，这里有意偏离：
 * 现代 Markdown 渲染器与浏览器都能正确处理 UTF-8 路径，可读性更重要。
 */
export function 转义图片地址(filePath: string): string {
  let result = ''
  // 逐字符处理：输出不再参与匹配，因此 `%` 只会被编码一次。
  for (const ch of filePath) result += 需转义[ch] ?? ch
  return result
}

/**
 * 生成写进 Markdown 的图片地址。
 *
 * 判断顺序与通行做法一致：能相对就相对，不能就绝对。
 */
export function 生成引用地址(
  图片绝对路径: string,
  docDir: string | null,
  options: 引用选项
): string {
  const image = normalizePath(图片绝对路径)

  let result = image
  if (options.useRelativePath && docDir && isAbsolute(image)) {
    const relativePath = relativeTo(docDir, image)
    // 相对路径算不出上行、又不是平级文件时（例如跨盘），回退到绝对路径。
    if (isAbsolute(relativePath) === false) {
      result = relativePath
      if (options.addDotPrefix && !result.startsWith('.')) result = `./${result}`
    }
  }

  return options.escapeUrl ? 转义图片地址(result) : result
}

/** 由图片路径推断 alt 文本：取文件名去掉扩展名。 */
export function 生成替代文本(图片路径: string): string {
  return stripExt(takeFileName(图片路径))
}

export type 图片语法 = 'markdown' | 'html'

/**
 * 生成完整的图片 Markdown。
 *
 * 两种语法的取舍来自 通行的"首选图片语法"设置：Markdown 语法更通用，
 * HTML `<img>` 则能带上 `width`/`style` 之类的属性。默认走 Markdown。
 */
export function buildImageSyntax(
  url: string,
  替代文本: string,
  语法: 图片语法 = 'markdown'
): string {
  if (语法 === 'html') {
    const 转义 = 替代文本.replace(/"/g, '&quot;')
    return `<img src="${url}" alt="${转义}" />`
  }
  // alt 里的 `]` 会提前闭合方括号，必须转义。
  const 安全替代 = 替代文本.replace(/]/g, '\\]')
  return `![${安全替代}](${url})`
}
