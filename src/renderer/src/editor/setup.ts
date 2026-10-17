import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  LanguageSupport
} from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { 界面中文化 } from './本地化'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Settings } from '@shared/types'
import { livePreview } from './live-preview'
import { 按设置构建智能标点 } from './smart-punctuation'
import { 继续代码围栏, 继续引用块, 跳出代码块 } from './commands'
import { 跳到相邻单元格 } from './表格'

/**
 * CodeMirror 6 装配。
 *
 * 刻意不使用 `codemirror` 元包里的 `basicSetup`：编辑器需要让行号、折叠和当前行
 * 高亮随源码模式切换，还需要把实时预览层插到默认高亮样式之前。
 */

/**
 * Markdown 语法着色。
 *
 * 这里**只负责源码形态的着色**，类名统一用 `cm-tok-*` 前缀。
 * 渲染形态（实时预览里"看起来像成品"的那套样式）由装饰层用 `cm-md-*`
 * 负责。两套前缀必须分开，原因是：
 *
 *   1. 同一个文本区间会同时被语法高亮和装饰层标记，若共用类名，
 *      DOM 里同一个 class 会出现多次，既无法统计验证，样式来源也说不清。
 *   2. 主题作者需要能区分"我想改源码里的标记颜色"和"我想改渲染后的标题"。
 */
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-tok-heading', fontSize: '1.7em', fontWeight: '600' },
  { tag: t.heading2, class: 'cm-tok-heading', fontSize: '1.45em', fontWeight: '600' },
  { tag: t.heading3, class: 'cm-tok-heading', fontSize: '1.25em', fontWeight: '600' },
  { tag: t.heading4, class: 'cm-tok-heading', fontSize: '1.1em', fontWeight: '600' },
  { tag: t.heading5, class: 'cm-tok-heading', fontSize: '1.02em', fontWeight: '600' },
  { tag: t.heading6, class: 'cm-tok-heading', fontSize: '0.95em', fontWeight: '600' },
  { tag: t.emphasis, class: 'cm-tok-emphasis' },
  { tag: t.strong, class: 'cm-tok-strong' },
  { tag: t.strikethrough, class: 'cm-tok-strikethrough' },
  { tag: t.link, class: 'cm-tok-link' },
  { tag: t.url, class: 'cm-tok-url' },
  { tag: t.monospace, class: 'cm-tok-code' },
  { tag: t.quote, class: 'cm-tok-quote' },
  { tag: t.list, class: 'cm-tok-list' },
  { tag: t.comment, class: 'cm-tok-comment' },
  { tag: t.processingInstruction, class: 'cm-tok-marker' },
  { tag: t.contentSeparator, class: 'cm-tok-marker' },
  { tag: t.labelName, class: 'cm-tok-link' },
  { tag: t.escape, class: 'cm-tok-marker' },
  { tag: t.invalid, color: '#d1242f' },

  // --- 编程语言（围栏代码块内部）----------------------------------------
  //
  // **这一段是必须的，不是锦上添花。**
  //
  // `syntaxHighlighting(markdownHighlight)` 是**非 fallback** 的，而
  // CodeMirror 的取值逻辑是：
  //
  //     let main = state.facet(highlighterFacet)
  //     return main.length ? main : state.facet(fallbackHighlighter)
  //
  // 也就是"只要有非 fallback 的风格，fallback 就整个不生效"。
  // 于是之前那份 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })`
  // **一行都没起作用**——围栏里的语言被识别了、解析器也跑了，
  // 但 keyword / string / comment 这些标签没有任何样式，**一个颜色都不上**。
  //
  // 颜色走变量而不是写死：同一份代码要在浅色主题上深、在深色主题上浅，
  // 写死一套必然有一边看不清。这也让主题作者能自己调代码配色。
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], class: 'cm-tok-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'cm-tok-string' },
  { tag: [t.number, t.bool, t.null, t.atom], class: 'cm-tok-number' },
  { tag: [t.typeName, t.className, t.namespace], class: 'cm-tok-type' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))],
    class: 'cm-tok-function'
  },
  { tag: [t.propertyName, t.attributeName], class: 'cm-tok-property' },
  { tag: [t.variableName, t.definition(t.variableName)], class: 'cm-tok-variable' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator], class: 'cm-tok-punct' },
  { tag: [t.tagName, t.angleBracket, t.attributeValue], class: 'cm-tok-tag' },
  { tag: [t.meta, t.annotation], class: 'cm-tok-meta' },
  { tag: t.self, class: 'cm-tok-keyword' },
  { tag: t.constant(t.variableName), class: 'cm-tok-number' },
  { tag: t.definitionKeyword, class: 'cm-tok-keyword' },
  { tag: t.modifier, class: 'cm-tok-keyword' },
  { tag: t.operatorKeyword, class: 'cm-tok-keyword' },
  { tag: t.unit, class: 'cm-tok-number' }
])

/**
 * 通过主题 token 表达的编辑器外观，这样用户主题只需要覆盖变量即可。
 */
const editorTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--font-size)',
    color: 'var(--text-primary)',
    backgroundColor: 'transparent'
  },
  '.cm-content': {
    fontFamily: 'var(--font-body)',
    lineHeight: 'var(--line-height)'
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)'
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--selection)',
    outline: '1px solid var(--accent)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--text-inverse)'
  }
})

/**
 * 自动配对。
 *
 * `closeBrackets()` 本身不接受参数——配对字符是通过**语言数据**配置的
 * （`closeBrackets` 语言数据字段），早先按 `closeBrackets({ brackets })` 写
 * 会直接编译失败。这里用 `EditorState.languageData` 全局提供一份配置。
 *
 * 字符集刻意只收括号与引号，**不含 `*` `_` `~`**。这三者在 Markdown 里首先
 * 是块级语法的开头：敲 `*` 想开无序列表、敲 `~` 想开代码围栏时被自动补成
 * 一对，反而要先删掉多余的半个。星号成对是"加粗"命令该干的事，不该由
 * 配对器抢着做。
 */
export function 按设置构建配对(settings: Settings): Extension {
  const 配对 = settings.enableInlineMath ? "()[]{}''\"\"``$$" : "()[]{}''\"\"``"
  return [
    closeBrackets(),
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: [...配对] } }])
  ]
}

export interface EditorOptions {
  settings: Settings
  /** 文档文本或选区发生变化时调用。 */
  onChange?: (view: EditorView) => void
}

/**
 * 在某个文档打开期间永不变化的扩展。
 *
 * 凡是依赖用户可在运行时切换的设置的扩展，都放在 `modeExtensions()` 里，
 * 这样就能通过 Compartment 换掉它们，而不必重建编辑器状态（那会丢掉撤销历史）。
 */
export function baseExtensions(options: EditorOptions): Extension[] {
  const { settings, onChange } = options

  const extensions: Extension[] = [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([
      // Esc 跳出代码围栏。**必须排在内置键位表之前**：CodeMirror 的键位表
      // 按顺序取第一个返回 true 的处理器，排在后面就永远轮不到。
      // 光标不在围栏里时它返回 false，Escape 会继续往下传（关面板等）。
      { key: 'Escape', run: 跳出代码块 },
      // 围栏首行按回车补出闭合围栏。**同样必须排在 markdown 的键位表之前**：
      // 它那边的 Enter 在围栏内虽然什么也不做，但仍然会先被调用、先返回。
      { key: 'Enter', run: 继续引用块 },
      { key: 'Enter', run: 继续代码围栏 },
      // 表格内 Tab / Shift+Tab 走单元格，不走缩进。
      // **必须排在 `indentWithTab` 之前**——后者会把 Tab 吃掉当缩进。
      // 光标不在表格里时这两条返回 false，Tab 照旧缩进。
      { key: 'Tab', run: (view) => 跳到相邻单元格(view, 1) },
      { key: 'Shift-Tab', run: (view) => 跳到相邻单元格(view, -1) },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab    ]),
    // GFM 加上默认启用的那批标准扩展。
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: true
    }),
    syntaxHighlighting(markdownHighlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    editorTheme,
    // 面板文案中文化（走 CodeMirror 官方的 phrases Facet）
    界面中文化,
    EditorState.tabSize.of(Math.max(1, Math.min(12, settings.tabSize))),
    // 内容容器挂上 `#write`——这是通用的内容容器锚点。
    // 基于 `#write …` 的规则因此有机会命中；但针对真实标签的
    // `#write h1 { … }` 仍不会生效（CodeMirror 的内容是 div，没有 h1）。
    EditorView.contentAttributes.of({ id: 'write' }),
    // 智能标点与自动配对都依赖设置，但它们只在"键入"这一条路径上起作用，
    // 改动设置后重启编辑器即可生效，因此放在基础扩展里。
    按设置构建智能标点(settings),
    按设置构建配对(settings)
  ]

  if (onChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) onChange(update.view)
      })
    )
  }

  return extensions
}

/** 当与模式相关的设置变化时必须重建的扩展。 */
export function modeExtensions(settings: Settings): Extension[] {
  // Mermaid 的配色要跟着深浅色走，用回调而不是把布尔值捕进来——
  // 捕值的话切主题后图表仍用旧配色，重建整个 state 才能刷新，代价太大。
  const extensions: Extension[] = [livePreview(settings.livePreview, () => settings.isDarkMode)]
  if (settings.autoWrapLongLines) extensions.push(EditorView.lineWrapping)

  // 拼写检查。
  //
  // Chromium 的拼写检查只作用于 contenteditable 元素，而 CodeMirror 的内容
  // 正是 contenteditable——所以理论上主进程打开 `spellcheck` 就够了。
  // 但**必须在这里显式声明属性**：Chromium 对可编辑区域默认开启，
  // 而 CodeMirror 不清除也不设置它，于是"主进程开了、这里没开"时
  // 行为取决于浏览器的默认值，不受我们控制。
  //
  // 显式写出来，开关就只由设置决定。
  extensions.push(
    EditorView.contentAttributes.of({ spellcheck: settings.spellCheck ? 'true' : 'false' })
  )

  if (settings.livePreview) {
    // 实时预览会隐藏脚手架：没有行号栏，也没有当前行底纹。
    extensions.push(EditorView.editorAttributes.of({ class: 'cm-live-preview' }))
  } else {
    // 源码模式会展示这些机械结构，就像 通行的 Ctrl+/ 视图。
    extensions.push(
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),
      EditorView.editorAttributes.of({ class: 'cm-source-mode' })
    )
  }
  return extensions
}

/** 导出的语言支持，供后续使用（围栏代码块识别等）。 */
export const markdownSupport: LanguageSupport = markdown({ base: markdownLanguage })
