/**
 * 语法节点的结构化最小接口。
 *
 * 刻意**不**直接引用 `@lezer/common` 的 `SyntaxNode`：它只是
 * `@codemirror/language` 的传递依赖，pnpm 的隔离式 node_modules 下无法从本包
 * 直接解析，`import type { SyntaxNode } from '@lezer/common'` 会编译失败。
 *
 * TypeScript 是结构化类型，这个最小接口足以接收真实的 `SyntaxNode`，
 * 同时不引入隐式依赖。装饰层与智能标点都从这里取用，避免重复定义。
 */
export interface SyntaxNode {
  readonly name: string
  readonly from: number
  readonly to: number
  readonly parent: SyntaxNode | null
  readonly firstChild: SyntaxNode | null
  readonly nextSibling: SyntaxNode | null
}
