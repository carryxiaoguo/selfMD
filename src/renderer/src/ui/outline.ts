import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { 清理标题文本 } from '@shared/markdown-html'
import type { SyntaxNode } from '../editor/syntax-node'

/**
 * 大纲提取。
 *
 * 从语法树里取出所有标题，供侧边栏渲染。做成"吃 EditorState、吐数组"的纯函数，
 * 于是"Setext 标题怎么取文本""光标在两个标题之间算哪个"这类容易写错的边界
 * 都能在自测里逐条钉住，不必靠手敲文档试。
 *
 * 注意标题的**位置**用的是文档偏移，不是行号：点大纲跳转时用偏移最直接，
 * 也不必担心文档改动后行号失效。
 */

export interface 标题项 {
  /** 1–6。 */
  level: number
  /** 去掉 `#` 与收尾井号之后的正文。 */
  docText: string
  /** 标题在文档中的起始偏移。 */
  position: number
  /** 1 基行号，供界面显示。 */
  lineNo: number
}

const 标题节点 = /^(?:ATX|Setext)Heading(\d)$/

/**
 * 提取文档中的全部标题，按出现顺序。
 *
 * 走编辑器**已有的**语法树，而不是重新解析一遍文本：光标每移动一次都要刷新
 * 大纲，重新解析在大文档上是明显的浪费。标题正文的清洗逻辑与导出侧共用
 * `清理标题文本`，避免两边对"收尾井号算不算正文"产生分歧。
 */
export function 提取标题(state: EditorState): 标题项[] {
  const result: 标题项[] = []
  const tree = syntaxTree(state)

  tree.iterate({
    enter: (quote) => {
      const node = quote.node as unknown as SyntaxNode
      const match = 标题节点.exec(node.name)
      if (!match) return true

      // 空标题（只有 `#`）也收进来：大纲里留一行空项比整段消失更符合预期。
      const originalText = state.sliceDoc(node.from, node.to)
      result.push({
        level: Number(match[1]),
        docText: 清理标题文本(originalText, node.name.startsWith('ATX')),
        position: node.from,
        lineNo: state.doc.lineAt(node.from).number
      })
      // 不再下沉：标题内部没有别的标题
      return false
    }
  })

  return result
}

/**
 * 找出光标所在（或之前最近）的标题下标。
 *
 * 光标落在第一个标题之前时返回 -1——界面据此把"高亮"清空，
 * 而不是错误地高亮第一个标题。
 */
export function 定位当前标题(headings: 标题项[], position: number): number {
  let result = -1
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].position <= position) result = i
    else break
  }
  return result
}
