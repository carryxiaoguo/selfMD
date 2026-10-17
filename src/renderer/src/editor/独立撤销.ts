import { isolateHistory } from '@codemirror/commands'

/**
 * 让"整批结构性改写"在撤销栈里独占一步。
 *
 * 典型场景有三个，共同点是**一次用户动作引发多处文档改动**：
 *   - 插入图片时改写 YAML 前置元数据
 *   - 设置图片文件夹 / 根目录
 *   - 上传图片后批量回填远程地址
 *
 * 没有这一步，Ctrl+Z 会把整批改写和用户前面敲的内容合并成一组，
 * 一次撤销掉一大段——用户想要的是"撤掉刚才那次上传"，不是"撤掉刚才十分钟"。
 *
 * `isolateHistory` 是 `@codemirror/commands` 导出的**注解类型**，
 * 必须走 `annotations` 而不是当成 TransactionSpec 的字段：
 * 写成 `{ isolateHistory: 'full' }` 会被静默忽略，编译也不报错。
 */
export const isolatedUndo = isolateHistory.of('full')
