/**
 * 数学公式的区间扫描。
 *
 * **`@lezer/markdown` 完全不解析数学公式**——打印解析树可以看到，
 * `$E = mc^2$` 只是一个普通 Paragraph 里的文本，`$$…$$` 也是普通段落。
 * 所以公式只能自己扫。
 *
 * 做成纯函数（吃一段文本、吐一组区间）之后，"价格是 $5 到 $10 元"
 * 这类误判就能逐条断言，不必真的渲染出来看。
 *
 * ## 行内公式的判定规则
 *
 * 沿用 KaTeX auto-render 与 通行的共同约定，靠三条限制避免把货币金额当公式：
 *
 *   1. 开头的 `$` **后面不能紧跟空白**（`$ 5` 不是公式）
 *   2. 结尾的 `$` **前面不能是空白**（`5 $` 不是公式）
 *   3. 内容不能为空
 *
 * 还要求开头的 `$` 前面不是 `\`（转义）或另一个 `$`（那是块级）。
 */

export interface 数学区间 {
  /** 在传入文本中的起始偏移（含 `$`）。 */
  from: number
  /** 结束偏移（不含结尾的 `$`）。 */
  to: number
  /** `$` 之间的公式源码。 */
  公式: string
  /** 是 `$$…$$` 块级公式。 */
  块级: boolean
}

/** 判断一个位置上的 `$` 是否是转义的。 */
function 被转义(文本: string, 位置: number): boolean {
  let 反斜杠数 = 0
  for (let i = 位置 - 1; i >= 0 && 文本[i] === '\\'; i--) 反斜杠数++
  return 反斜杠数 % 2 === 1
}

/**
 * 判断整段文本是否是一个 `$$…$$` 块级公式。
 *
 * 返回公式源码；不是块级公式时返回 null。
 *
 * 块级公式的识别很宽松：整段以 `$$` 开头、以 `$$` 结尾即可（中间可以跨行）。
 * 不做"`$$` 必须独占一行"的要求——用户在段落里直接敲 `$$x$$` 也希望它渲染。
 */
export function 识别块级公式(文本: string): string | null {
  const 修剪 = 文本.trim()
  if (修剪.length < 4) return null
  if (!修剪.startsWith('$$') || !修剪.endsWith('$$')) return null
  // 首尾各去掉两个 `$`
  const 公式 = 修剪.slice(2, -2).trim()
  return 公式.length > 0 ? 公式 : null
}

/**
 * 扫描一段文本里的行内公式。
 *
 * @param 文本 要扫描的文本
 * @param 基准 文本在文档中的起始偏移（返回的区间是文档坐标）
 * @param 启用 设置里是否开启了行内公式；关闭时直接返回空数组
 */
export function 扫描行内公式(文本: string, 基准: number, 启用 = true): 数学区间[] {
  if (!启用) return []
  const 结果: 数学区间[] = []

  let i = 0
  while (i < 文本.length) {
    const 位置 = 文本.indexOf('$', i)
    if (位置 < 0) break

    // 跳过 `$$`：那是块级公式的开头，交给 识别块级公式 处理
    if (文本[位置 + 1] === '$') {
      i = 位置 + 2
      continue
    }
    // 转义的 `\$` 不是公式
    if (被转义(文本, 位置)) {
      i = 位置 + 1
      continue
    }

    const 公式起 = 位置 + 1
    // 规则 1：开头 `$` 后面不能紧跟空白
    if (公式起 >= 文本.length || /\s/.test(文本[公式起])) {
      i = 位置 + 1
      continue
    }

    // 找配对的收尾 `$`
    let 结束 = -1
    for (let j = 公式起; j < 文本.length; j++) {
      if (文本[j] !== '$') continue
      if (被转义(文本, j)) continue
      // 规则 2：结尾 `$` 前面不能是空白
      if (/\s/.test(文本[j - 1] ?? '')) continue
      结束 = j
      break
    }

    if (结束 < 0) {
      i = 位置 + 1
      continue
    }

    const 公式 = 文本.slice(公式起, 结束)
    // 规则 3：内容不能为空
    if (公式.length === 0) {
      i = 位置 + 1
      continue
    }

    结果.push({ from: 基准 + 位置, to: 基准 + 结束, 公式, 块级: false })
    i = 结束 + 1
  }

  return 结果
}
