import type { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '../syntax-node'

/**
 * 装饰层内部共用的数据类型。
 *
 * 之所以不在遍历语法树时直接往 RangeSet 里塞，是因为加入的区间必须
 * **按起点升序**，同一位置上行装饰（Decoration.line）必须排在标记装饰之前，
 * 否则 CodeMirror 会拒绝整份装饰。所以先收集成数组，统一排序后再构建。
 */

/** 语法节点类型定义在 ../syntax-node.ts，这里转出，方便装饰层内部统一从本文件取。 */
export type { SyntaxNode }

export interface DecoEntry {
  from: number
  to: number
  deco: Decoration
  /**
   * 同一 from 上的排序权重，越小越靠前。
   * -1：行装饰（必须最先）
   *  0：内容标记（加粗、斜体等）
   *  1：隐藏型替换装饰
   */
  rank: number
}

export interface BuildContext {
  /** 光标所在行（1 基）。这些行上的语法标记保持可见。 */
  activeLines: Set<number>
  /** 已经加过行装饰的位置，避免同一行被重复加类。 */
  usedDecoLanes: Set<number>
  /**
   * 已经被"整行替换成代码块头部栏"的围栏首行行首偏移。
   *
   * 需要这个集合是因为**同一段文本不能被两条替换装饰覆盖**：
   * 围栏首行整行换成了头部栏，那里的 ``` 与语言标识就不能再各推一条隐藏装饰，
   * 否则 CodeMirror 会因为区间重叠拒绝整份装饰——而它拒绝的方式是
   * 抛异常，被渲染层的降级逻辑吞掉后，界面上只表现为"这个块没渲染出来"。
   */
  headerReplaced: Set<number>
  entry: DecoEntry[]
}

/** 把一条行装饰加入收集器；同一位置只保留第一条。 */
export function addLineDeco(
  context: BuildContext,
  lineStart: number,
  deco: Decoration
): void {
  if (context.usedDecoLanes.has(lineStart)) return
  context.usedDecoLanes.add(lineStart)
  context.entry.push({ from: lineStart, to: lineStart, deco: deco, rank: -1 })
}

// ---------------------------------------------------------------------------
// 影响"哪些语法被渲染"的设置
// ---------------------------------------------------------------------------

/**
 * 行内公式（`$…$`）是否渲染。
 *
 * 用模块级开关而不是把设置塞进 `构建上下文`：装饰层里用得到设置的目前只有
 * 这一处，为它给每个节点都背上一个 settings 对象不划算。
 * 用 `types.ts` 承载是为了避免 block.ts 与 index.ts 之间的循环导入——
 * 两个模块都从这里取。
 *
 * 改这个值之后要**手动重绘**（`view.dispatch({})`），装饰不会自己更新。
 */
let inlineMathOn = true

export function setInlineMathEnabled(enable: boolean): void {
  inlineMathOn = enable
}

export function inlineMathEnabled(): boolean {
  return inlineMathOn
}

/**
 * "渲染时转换"是否启用。
 *
 * 与行内公式同理：它决定的是"装饰怎么建"而不是"怎么显示"，
 * 改完必须重绘（`view.dispatch({})`）才会生效。
 */
let typographyOn = false

export function setPunctuationRenderingEnabled(enable: boolean): void {
  typographyOn = enable
}

export function typographyEnabled(): boolean {
  return typographyOn
}
