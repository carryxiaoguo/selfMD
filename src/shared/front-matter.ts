/**
 * YAML 前置元数据读写。
 *
 * 这是**纯文本函数**，不依赖编辑器，所以既能被主进程复用，也能被逐条断言。
 *
 * 为什么需要它：图片存储目标优先读文档内的 `image-folder`，
 * 而不是全局设置——每篇文档可以有自己的图片目录，配置随文件走，换机器、
 * 换协作者都不丢。也从另一侧印证了这一点：`内部页面` 里的建目录对话框
 * 文案原文就是 "according to your YAML Front Matter setting"。
 *
 * 刻意只支持**顶层标量**。嵌套列表、多行字符串、锚点这些 YAML 特性一律不解析——
 * 我们需要的只是 `键: 值` 这一种形态，写一个半吊子的完整 YAML 解析器
 * 反而会在边界情况上骗人。
 */

export interface frontMatter {
  /** 是否检测到前置元数据块。 */
  exists: boolean
  /** 解析出的顶层标量属性。 */
  attr: Record<string, string>
  /** 元数据块（含首尾 `---`）在文档中的结束偏移；无元数据时为 0。 */
  结束偏移: number
}

const 空结果: frontMatter = { exists: false, attr: {}, 结束偏移: 0 }

/**
 * 读取前置元数据。
 *
 * 只认**文档第一行**就是 `---` 的形态，与 Markdown 解析器的行为一致——
 * 文档中间出现的 `---` 是水平分割线，不是元数据围栏。
 */
export function readFrontMatter(docText: string): frontMatter {
  if (!docText.startsWith('---')) return 空结果

  const lineList = docText.split('\n')
  if (lineList[0].trim() !== '---') return 空结果

  let endLine = -1
  for (let i = 1; i < lineList.length; i++) {
    const line = lineList[i].trim()
    if (line === '---' || line === '...') {
      endLine = i
      break
    }
  }
  if (endLine < 0) return 空结果

  const attr: Record<string, string> = {}
  for (let i = 1; i < endLine; i++) {
    const line = lineList[i]
    // 跳过缩进行（嵌套结构）与注释
    if (/^\s/.test(line) || /^\s*#/.test(line)) continue
    const match = /^([A-Za-z0-9_\-.$@]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    // 去掉包裹的引号，但保留值内部的引号
    attr[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }

  // 结束偏移 = 结束行之后那个换行的位置
  let offset = 0
  for (let i = 0; i <= endLine; i++) offset += lineList[i].length + 1
  offset = Math.min(offset, docText.length)

  return { exists: true, attr, 结束偏移: offset }
}

/** 把值序列化成可以安全放进 YAML 的形态。 */
function 序列化值(value: string): string {
  // 含特殊字符时加双引号，避免被解析成列表或注释。
  if (value === '' || /[:#\-[\]{}&*!|>'"%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

/**
 * 写入（或更新）一个属性。
 *
 * 文档没有前置元数据时，在开头新建一个块——这正是用户点"设为图片文件夹"
 * 时该发生的事，而不是弹一句"请先手动添加 YAML 头"。
 */
export function 写入属性(docText: string, key: string, value: string): string {
  const meta = readFrontMatter(docText)
  const newLine = `${key}: ${序列化值(value)}`

  if (!meta.exists) {
    return `---\n${newLine}\n---\n\n${docText}`
  }

  const lineList = docText.split('\n')
  let endLine = -1
  for (let i = 1; i < lineList.length; i++) {
    const line = lineList[i].trim()
    if (line === '---' || line === '...') {
      endLine = i
      break
    }
  }
  if (endLine < 0) return docText

  const 目标行 = `^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`
  let 已更新 = false
  for (let i = 1; i < endLine; i++) {
    if (new RegExp(目标行).test(lineList[i])) {
      lineList[i] = newLine
      已更新 = true
      break
    }
  }
  if (!已更新) lineList.splice(endLine, 0, newLine)

  return lineList.join('\n')
}

/**
 * 移除一个属性。
 *
 * 键是本块里唯一一个属性时，连整个元数据块一并删掉——留下一个空的
 * `---\n---` 在文档开头既难看，又会被 Markdown 解析器当成 Setext 标题的下划线。
 */
export function 移除属性(docText: string, key: string): string {
  const meta = readFrontMatter(docText)
  if (!meta.exists) return docText

  const lineList = docText.split('\n')
  let endLine = -1
  for (let i = 1; i < lineList.length; i++) {
    const line = lineList[i].trim()
    if (line === '---' || line === '...') {
      endLine = i
      break
    }
  }
  if (endLine < 0) return docText

  const 目标行 = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  const 剩余 = lineList.slice(1, endLine).filter((line) => !目标行.test(line))

  if (剩余.length === 0) {
    // 整个元数据块都没用了，连同其后可能存在的空行一起去掉。
    let fromPos = endLine + 1
    while (fromPos < lineList.length && lineList[fromPos].trim() === '') fromPos += 1
    return lineList.slice(fromPos).join('\n')
  }

  lineList.splice(1, endLine - 1, ...剩余)
  return lineList.join('\n')
}
