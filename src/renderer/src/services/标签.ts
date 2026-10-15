import type { EditorState } from '@codemirror/state'
import type { DocState } from '../services/document'

/**
 * 多文档标签管理。
 *
 * ## 为什么是"一个视图、多份状态"
 *
 * CodeMirror 6 的 `EditorState` **自带撤销历史**（`history()` 扩展把历史
 * 存在状态里，不是存在视图上）。所以只要每个文档留一份 `EditorState`，
 * 切换时 `view.setState()`，**每个文档的撤销栈天然独立**——
 * 不必自己拆栈、也不必担心"在甲文档里撤销，把乙文档的内容改回去"。
 *
 * 换成"每个文档一个 EditorView"也能做，但要处理多份 DOM、多份扩展、
 * 多份测量，而且切换时要销毁重建——代价高得多，收益只有"滚动位置各留一份"。
 *
 * ## 边界
 *
 * 这里只管**状态**，不碰 DOM。界面（侧边栏的文档列表）从 `列表` 读数据，
 * 通过 `切换()` 发指令。这样标签逻辑可以脱离界面单独断言。
 */

export interface 标签 {
  /** 稳定标识。用递增序号而不是下标——下标会随关闭而变。 */
  标识: number
  /** 文档元信息（路径、名字、脏标记…）。 */
  状态: DocState
  /** 编辑器状态。**撤销历史就在这里。** */
  编辑器状态: EditorState
}

export class 标签管理器 {
  private 标签们: 标签[] = []
  private 当前下标 = -1
  private 下一个标识 = 1
  /** 最近关闭的标签，用于"重新打开关闭的文件"。后进先出。 */
  private 已关闭: { 状态: DocState; 内容: string }[] = []

  get 列表(): readonly 标签[] {
    return this.标签们
  }

  get 当前(): 标签 | null {
    return this.标签们[this.当前下标] ?? null
  }

  get 数量(): number {
    return this.标签们.length
  }

  /** 还能不能关闭。最后一个标签关掉之后就没有编辑器了，所以留一个。 */
  get 可以关闭(): boolean {
    return this.标签们.length > 1
  }

  get 可以重开(): boolean {
    return this.已关闭.length > 0
  }

  /**
   * 加入一个标签并切到它。
   *
   * **调用方必须在替换视图状态之前，先调用 `标签管理器.存当前()` 把当前标签的
   * 编辑器状态写回。** 顺序反了就会丢数据：
   *
   * ```ts
   * // 对
   * 标签集.存当前(view.state)
   * view.setState(新文档状态)
   * 标签集.加入(...)
   *
   * // 错——写回时 view.state 已经是新文档的了，旧文档的改动就此消失
   * view.setState(新文档状态)
   * 标签集.加入(...)
   * ```
   *
   * 为什么不在这里自动做：`加入` 被调用时，视图状态**已经被换掉了**，
   * 此刻无论怎么读都拿不到旧文档的内容。这个顺序约束没法在方法内部绕开，
   * 只能靠契约与回归测试守住。
   *
   * @param 状态 文档元信息
   * @param 编辑器状态 该文档的编辑器状态（含历史）
   */
  加入(状态: DocState, 编辑器状态: EditorState): 标签 {
    const 标签: 标签 = { 标识: this.下一个标识++, 状态, 编辑器状态 }
    // 插在当前标签之后，而不是追加到末尾——这样"新建"出来的标签
    // 就在手边，符合浏览器的行为习惯。
    this.标签们.splice(this.当前下标 + 1, 0, 标签)
    this.当前下标 += 1
    return 标签
  }

  /**
   * 把当前标签的编辑器状态写回。
   *
   * 在**任何替换视图状态的操作之前**调用。这是整个多文档实现里
   * 唯一一处"顺序写错就静默丢数据"的地方，所以单独给它一个显眼的名字。
   */
  存当前(状态: EditorState): void {
    const 当前 = this.标签们[this.当前下标]
    if (当前) 当前.编辑器状态 = 状态
  }

  /**
   * 切到指定标识的标签。
   *
   * 切换前会先把**当前标签的编辑器状态写回**，否则在甲文档里敲的字
   * 会在切换时丢掉——这是整个多文档实现里最容易出错的一步。
   *
   * @returns 目标标签；标识不存在时返回 null（不做任何改动）
   */
  切换(标识: number, 落盘当前: (当前: 标签) => void): 标签 | null {
    const 目标下标 = this.标签们.findIndex((t) => t.标识 === 标识)
    if (目标下标 < 0 || 目标下标 === this.当前下标) return null
    const 当前 = this.标签们[this.当前下标]
    if (当前) 落盘当前(当前)
    this.当前下标 = 目标下标
    return this.标签们[目标下标]
  }

  /** 按方向循环切换，用于 Ctrl+Tab。 */
  循环(方向: 1 | -1, 落盘当前: (当前: 标签) => void): 标签 | null {
    if (this.标签们.length < 2) return null
    const 目标下标 = (this.当前下标 + 方向 + this.标签们.length) % this.标签们.length
    const 当前 = this.标签们[this.当前下标]
    if (当前) 落盘当前(当前)
    this.当前下标 = 目标下标
    return this.标签们[目标下标]
  }

  /**
   * 关闭一个标签。
   *
   * @param 内容 关闭时的文档内容，存起来供"重新打开关闭的文件"用。
   *             **未保存的改动只有这里有备份**，所以调用方必须传。
   * @returns 关闭后应当切到的标签；关的是最后一个时返回 null
   */
  关闭(标识: number, 内容: string, 落盘当前: (当前: 标签) => void): 标签 | null {
    const 下标 = this.标签们.findIndex((t) => t.标识 === 标识)
    if (下标 < 0) return null
    if (this.标签们.length <= 1) return null

    const 被关 = this.标签们[下标]
    // 关闭当前标签前先把编辑器状态写回，否则重新打开时拿到的是上一次切换时的快照
    if (下标 === this.当前下标) 落盘当前(被关)

    this.已关闭.push({ 状态: { ...被关.状态 }, 内容 })
    // 只留最近 20 个：再多也没人会去翻，而且未保存的内容留在内存里是负担
    if (this.已关闭.length > 20) this.已关闭.shift()

    this.标签们.splice(下标, 1)
    if (下标 < this.当前下标) this.当前下标 -= 1
    else if (this.当前下标 >= this.标签们.length) this.当前下标 = this.标签们.length - 1

    return this.标签们[this.当前下标] ?? null
  }

  /** 取回最近关闭的一个（后进先出）。 */
  取出已关闭(): { 状态: DocState; 内容: string } | null {
    return this.已关闭.pop() ?? null
  }

  /** 按路径找已经打开的标签；用于"同一个文件不要开两遍"。 */
  按路径找(路径: string): 标签 | null {
    return this.标签们.find((t) => t.状态.path === 路径) ?? null
  }
}
