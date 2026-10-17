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
  formula: string
  /** 是 `$$…$$` 块级公式。 */
  blockLevel: boolean
}

/** 判断一个位置上的 `$` 是否是转义的。 */
function 被转义(docText: string, position: number): boolean {
  let 反斜杠数 = 0
  for (let i = position - 1; i >= 0 && docText[i] === '\\'; i--) 反斜杠数++
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
export function findBlockMath(docText: string): string | null {
  const trimmed = docText.trim()
  if (trimmed.length < 4) return null
  if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$')) return null
  // 首尾各去掉两个 `$`
  const formula = trimmed.slice(2, -2).trim()
  return formula.length > 0 ? formula : null
}

/**
 * 扫描一段文本里的行内公式。
 *
 * @param 文本 要扫描的文本
 * @param 基准 文本在文档中的起始偏移（返回的区间是文档坐标）
 * @param 启用 设置里是否开启了行内公式；关闭时直接返回空数组
 */
export function scanInlineMath(docText: string, baseline: number, enable = true): 数学区间[] {
  if (!enable) return []
  const result: 数学区间[] = []

  let i = 0
  while (i < docText.length) {
    const position = docText.indexOf('$', i)
    if (position < 0) break

    // 跳过 `$$`：那是块级公式的开头，交给 识别块级公式 处理
    if (docText[position + 1] === '$') {
      i = position + 2
      continue
    }
    // 转义的 `\$` 不是公式
    if (被转义(docText, position)) {
      i = position + 1
      continue
    }

    const 公式起 = position + 1
    // 规则 1：开头 `$` 后面不能紧跟空白
    if (公式起 >= docText.length || /\s/.test(docText[公式起])) {
      i = position + 1
      continue
    }

    // 找配对的收尾 `$`
    let endAt = -1
    for (let j = 公式起; j < docText.length; j++) {
      if (docText[j] !== '$') continue
      if (被转义(docText, j)) continue
      // 规则 2：结尾 `$` 前面不能是空白
      if (/\s/.test(docText[j - 1] ?? '')) continue
      endAt = j
      break
    }

    if (endAt < 0) {
      i = position + 1
      continue
    }

    const formula = docText.slice(公式起, endAt)
    // 规则 3：内容不能为空
    if (formula.length === 0) {
      i = position + 1
      continue
    }

    result.push({ from: baseline + position, to: baseline + endAt, formula, blockLevel: false })
    i = endAt + 1
  }

  return result
}
