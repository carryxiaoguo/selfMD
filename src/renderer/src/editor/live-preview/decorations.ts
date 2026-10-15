import { Decoration, type WidgetType } from '@codemirror/view'

/**
 * 全部装饰常量的唯一来源。
 *
 * 类名集中在这里，是为了让 `base.css` 与装饰层之间只有一处契约：
 * 想改视觉，改 CSS；想改"哪些语法被渲染"，改 live-preview。
 */

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

/** 零宽替换：把语法标记折叠掉，但字符仍留在文档里。 */
export const 隐藏 = Decoration.replace({})

/**
 * 用一个 widget 替换某段源码。
 *
 * 注意 `Decoration` 实例上没有 `.replace()` 方法——替换型装饰必须重新构造。
 */
export function 替换为(widget: WidgetType): Decoration {
  return Decoration.replace({ widget })
}

/**
 * 跨行的块级替换。
 *
 * **跨行替换必须带 `block: true`。** 不带的话 CodeMirror 会抛
 * "Decorations that replace line breaks may not be specified via plugins"，
 * 因为普通替换装饰不允许吃掉换行符——那会让行的概念失效。
 * `block: true` 明确告诉它"这是一个块级替换，允许跨行"。
 *
 * 这个错误是在块级数学公式上暴露的：`$$…$$` 通常跨好几行。
 * 单行替换不受影响，所以 `替换为` 仍然保留给行内场景。
 *
 * 另外，块级替换的区间**必须落在行边界上**，否则同样会被拒绝。
 */
export function 块级替换为(widget: WidgetType): Decoration {
  return Decoration.replace({ widget, block: true })
}

/** 在某个位置插入一个 widget，不替换任何字符（例如围栏的语言标签）。 */
export function 插入(widget: WidgetType, side: number): Decoration {
  return Decoration.widget({ widget, side })
}

// ---------------------------------------------------------------------------
// 行内
// ---------------------------------------------------------------------------

export const 行内样式 = {
  强调: Decoration.mark({ class: 'cm-md-emphasis' }),
  加粗: Decoration.mark({ class: 'cm-md-strong' }),
  删除线: Decoration.mark({ class: 'cm-md-strikethrough' }),
  行内代码: Decoration.mark({ class: 'cm-md-code' }),
  链接文字: Decoration.mark({ class: 'cm-md-link' }),
  链接地址: Decoration.mark({ class: 'cm-md-url' }),
  引用文字: Decoration.mark({ class: 'cm-md-quote' }),
  引用定义: Decoration.mark({ class: 'cm-md-refdef' }),
  HTML: Decoration.mark({ class: 'cm-md-html' })
} as const

// ---------------------------------------------------------------------------
// 块级：行装饰
// ---------------------------------------------------------------------------

const 标题行 = [1, 2, 3, 4, 5, 6].map((级) =>
  Decoration.line({ class: `cm-lp-heading cm-lp-h${级}` })
)

export function 标题行装饰(级: number): Decoration {
  return 标题行[Math.min(6, Math.max(1, 级)) - 1]
}

export const 块级行样式 = {
  引言: Decoration.line({ class: 'cm-lp-quote' }),
  // `md-fences` 与 `md-task-list-item` 是**通用的类名**
  // （用 scripts/CSS选择器.py 扫内置主题，分别出现 24 与 30 次）。
  // 挂上它们，针对这两个类写的现成主题规则就能直接生效；
  // 本项目自己的 `cm-lp-*` 同时保留，两套并存互不干扰。
  //
  // 注意：这只能兼容**基于类名**的规则。针对真实标签写的
  // `#write h1 { … }` 在本项目里永远不会命中——CodeMirror 的内容是一堆
  // div，没有 h1 元素。这一点在 报告里写明了，不能假装全兼容。
  代码块首行: Decoration.line({ class: 'cm-lp-code cm-lp-code-first md-fences' }),
  代码块中间行: Decoration.line({ class: 'cm-lp-code md-fences' }),
  代码块末行: Decoration.line({ class: 'cm-lp-code cm-lp-code-last md-fences' }),
  任务项行: Decoration.line({ class: 'md-task-list-item' }),
  前置元数据: Decoration.line({ class: 'cm-lp-frontmatter' }),
  数学块: Decoration.line({ class: 'cm-lp-math md-math-block' }),
  HTML块: Decoration.line({ class: 'cm-lp-html' }),
  表格: Decoration.line({ class: 'cm-lp-table' }),
  表头行: Decoration.line({ class: 'cm-lp-table cm-lp-table-head' }),
  // 刻意不带 cm-lp-table：对齐定义行被折叠后只剩一条分隔线，
  // 类名与数据行分开，统计时才不会互相污染。
  表格分隔行: Decoration.line({ class: 'cm-lp-table-sep' }),
  水平线行: Decoration.line({ class: 'cm-lp-hr' }),
  // 图片独占一行时用：CSS 据此把它居中并按块显示；
  // 夹在句子中间的图片不加这个类，仍按行内处理。
  图片行: Decoration.line({ class: 'cm-lp-image-line' })
} as const
