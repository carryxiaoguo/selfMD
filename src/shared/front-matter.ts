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

export interface 前置元数据 {
  /** 是否检测到前置元数据块。 */
  存在: boolean
  /** 解析出的顶层标量属性。 */
  属性: Record<string, string>
  /** 元数据块（含首尾 `---`）在文档中的结束偏移；无元数据时为 0。 */
  结束偏移: number
}

const 空结果: 前置元数据 = { 存在: false, 属性: {}, 结束偏移: 0 }

/**
 * 读取前置元数据。
 *
 * 只认**文档第一行**就是 `---` 的形态，与 Markdown 解析器的行为一致——
 * 文档中间出现的 `---` 是水平分割线，不是元数据围栏。
 */
export function 读取前置元数据(文本: string): 前置元数据 {
  if (!文本.startsWith('---')) return 空结果

  const 行列表 = 文本.split('\n')
  if (行列表[0].trim() !== '---') return 空结果

  let 结束行 = -1
  for (let i = 1; i < 行列表.length; i++) {
    const 行 = 行列表[i].trim()
    if (行 === '---' || 行 === '...') {
      结束行 = i
      break
    }
  }
  if (结束行 < 0) return 空结果

  const 属性: Record<string, string> = {}
  for (let i = 1; i < 结束行; i++) {
    const 行 = 行列表[i]
    // 跳过缩进行（嵌套结构）与注释
    if (/^\s/.test(行) || /^\s*#/.test(行)) continue
    const 匹配 = /^([A-Za-z0-9_\-.$@]+)\s*:\s*(.*)$/.exec(行)
    if (!匹配) continue
    // 去掉包裹的引号，但保留值内部的引号
    属性[匹配[1]] = 匹配[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }

  // 结束偏移 = 结束行之后那个换行的位置
  let 偏移 = 0
  for (let i = 0; i <= 结束行; i++) 偏移 += 行列表[i].length + 1
  偏移 = Math.min(偏移, 文本.length)

  return { 存在: true, 属性, 结束偏移: 偏移 }
}

/** 把值序列化成可以安全放进 YAML 的形态。 */
function 序列化值(值: string): string {
  // 含特殊字符时加双引号，避免被解析成列表或注释。
  if (值 === '' || /[:#\-[\]{}&*!|>'"%@`]/.test(值) || /^\s|\s$/.test(值)) {
    return JSON.stringify(值)
  }
  return 值
}

/**
 * 写入（或更新）一个属性。
 *
 * 文档没有前置元数据时，在开头新建一个块——这正是用户点"设为图片文件夹"
 * 时该发生的事，而不是弹一句"请先手动添加 YAML 头"。
 */
export function 写入属性(文本: string, 键: string, 值: string): string {
  const 元数据 = 读取前置元数据(文本)
  const 新行 = `${键}: ${序列化值(值)}`

  if (!元数据.存在) {
    return `---\n${新行}\n---\n\n${文本}`
  }

  const 行列表 = 文本.split('\n')
  let 结束行 = -1
  for (let i = 1; i < 行列表.length; i++) {
    const 行 = 行列表[i].trim()
    if (行 === '---' || 行 === '...') {
      结束行 = i
      break
    }
  }
  if (结束行 < 0) return 文本

  const 目标行 = `^${键.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`
  let 已更新 = false
  for (let i = 1; i < 结束行; i++) {
    if (new RegExp(目标行).test(行列表[i])) {
      行列表[i] = 新行
      已更新 = true
      break
    }
  }
  if (!已更新) 行列表.splice(结束行, 0, 新行)

  return 行列表.join('\n')
}

/**
 * 移除一个属性。
 *
 * 键是本块里唯一一个属性时，连整个元数据块一并删掉——留下一个空的
 * `---\n---` 在文档开头既难看，又会被 Markdown 解析器当成 Setext 标题的下划线。
 */
export function 移除属性(文本: string, 键: string): string {
  const 元数据 = 读取前置元数据(文本)
  if (!元数据.存在) return 文本

  const 行列表 = 文本.split('\n')
  let 结束行 = -1
  for (let i = 1; i < 行列表.length; i++) {
    const 行 = 行列表[i].trim()
    if (行 === '---' || 行 === '...') {
      结束行 = i
      break
    }
  }
  if (结束行 < 0) return 文本

  const 目标行 = new RegExp(`^${键.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  const 剩余 = 行列表.slice(1, 结束行).filter((行) => !目标行.test(行))

  if (剩余.length === 0) {
    // 整个元数据块都没用了，连同其后可能存在的空行一起去掉。
    let 起点 = 结束行 + 1
    while (起点 < 行列表.length && 行列表[起点].trim() === '') 起点 += 1
    return 行列表.slice(起点).join('\n')
  }

  行列表.splice(1, 结束行 - 1, ...剩余)
  return 行列表.join('\n')
}
