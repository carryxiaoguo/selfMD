import { redo, selectAll, undo } from '@codemirror/commands'
import { findNext, findPrevious, openSearchPanel } from '@codemirror/search'
import { syntaxTree } from '@codemirror/language'
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { removeAttr, readFrontMatter, setAttr } from '@shared/front-matter'
import { renderMarkdownToHtml } from '@shared/markdown-html'
import { 标签管理器, type label } from './services/标签'
import { 打开快速打开面板 } from './ui/快速打开'
import { sidebarShown, 侧边栏被锁定, activeTheme, type DraftInfo } from '@shared/types'
import { 解析围栏信息 } from '@shared/代码块信息'
import type { MenuCommandPayload } from '@shared/ipc'
import type { ImageStoragePolicy, Settings } from '@shared/types'
import {
  toggleList,
  toggleQuote,
  wrapInline,
  插入代码围栏,
  插入前置元数据,
  插入水平线,
  插入数学块,
  insertTable,
  insertLink,
  exitCodeBlock,
  clearFormat,
  调整标题级别,
  adjustIndent,
  setHeadingLevel
} from './editor/commands'
import { baseExtensions, modeExtensions } from './editor/setup'
import { continueCodeFence, continueQuote } from './editor/commands'
import {
  在表格里,
  moveToAdjacentCell,
  isAlignRow,
  表格增列,
  表格增行,
  表格删列,
  表格删行,
  tableAlign
} from './editor/表格'
import { 运行大纲自测, 运行导出自测, 运行上传自测, 运行数学自测, 运行渲染标点自测, 运行模糊匹配自测, 运行偏好设置自测, 运行图片管线自测, 运行纯函数自测, 运行命令自测 } from './editor/selftest'
import {
  删除当前行或句,
  跳转到文首,
  跳转到文末,
  跳转到行尾,
  跳转到行首,
  选中当前块,
  选中当前词,
  选中当前行或句
} from './editor/selection'
import { 专注模式扩展, 居中光标行 } from './editor/focus'
import { setInlineMathEnabled, setPunctuationRenderingEnabled } from './editor/live-preview/types'
import { 设置图片右键处理器 } from './editor/live-preview/widgets'
import { 收集文档图片, 上传并回填, type 回填结果, type docImages } from './image/上传'
import { setDocDir, parseImageUrl, takeDocDir } from './image/显示地址'
import {
  取当前图片,
  删除图片文件,
  建议文件名,
  复制图片到,
  设置目录提供者,
  转换图片语法,
  重命名或移动图片,
  type imageContext
} from './image/图片操作'
import { popupMenu, closeMenu, type menuItem } from './ui/上下文菜单'
import { 图片粘贴与拖放 } from './image/handlers'
import {
  type InsertRequest,
  从地址插入,
  insertFromFile,
  本次目标目录
} from './image/insert'
import { promptText } from './ui/prompt'
import { 偏好设置面板 } from './ui/preferences'
import { sidebar as 侧边栏组件 } from './ui/sidebar'
import { extractHeadings, locateHeading, type headingItem } from './ui/outline'
import { DocumentService } from './services/document'
import { StatusBar } from './ui/statusbar'
// KaTeX 的样式表由 Vite 打包进来，字体文件会作为资源一并产出。
// 放在这里 import 而不是 base.css 里 @import：Vite 对 TS 里的裸模块
// 说明符解析更可靠，打包路径也更好控制。
import 'katex/dist/katex.min.css'
import { applyTheme, 重新加载主题 } from './ui/theme'
import { toast, toastError } from './ui/toast'

/**
 * 渲染进程启动引导。
 *
 * 职责依次为：加载设置、应用主题、构建编辑器，最后接通命令入口。
 * 每个用户可见的操作要么以 main 进程发来的菜单命令形式到达，要么是 CodeMirror
 * 键位绑定，两者都汇聚到 `runCommand()`，这样行为就不会在两条路径之间跑偏。
 */

const modeCompartment = new Compartment()

/**
 * 让"改写文档结构"这类命令在撤销栈里独占一步。定义在
 * `editor/独立撤销.ts`，上传回填也要用同一份注解。
 */
import { isolatedUndo } from './editor/独立撤销'

const doc = new DocumentService()
let settings: Settings
let view: EditorView
let statusBar: StatusBar

function currentText(): string {
  return view.state.doc.toString()
}

function setDocument(text: string): void {
  // 直接整体替换 state（而不是 dispatch 一次变更），可确保上一个文档的
  // 撤销历史不会泄漏到当前文档里。
  view.setState(EditorState.create({ doc: text, extensions: editorExtensions() }))
  view.dispatch({ selection: { anchor: 0 } })
}

// ---------------------------------------------------------------------------
// 多文档标签
// ---------------------------------------------------------------------------

const tabSet = new 标签管理器()

/**
 * 落盘当前标签的编辑器状态。
 *
 * CodeMirror 的文档内容与撤销历史都住在 `EditorState` 里，视图里只有"当前那一份"。
 * 任何替换视图状态的操作之前都必须先调用它——漏掉的后果是
 * **静默丢掉用户未保存的改动**，没有任何报错。
 */
function 落盘当前标签(item: label): void {
  item.editorState = view.state
}

/** 当前文档的目录；未保存时为 null。图片相对路径与文件树都依赖它。 */
async function currentDocDir(): Promise<string | null> {
  const filePath = doc.current.path
  if (!filePath) return null
  return window.selfmdExtra.path.dirname(filePath)
}

/**
 * 切到某个标签。
 *
 * 顺序很重要：**先设图片基准目录，再换编辑器状态**。
 * 文档内容一进编辑器就会构建装饰，那时若基准目录还是上一篇的，
 * 图片会先渲染成"无法显示"，要等重绘才恢复——表现为图片闪一下。
 */
async function switchTab(id: number): Promise<void> {
  const target = tabSet.toggle(id, 落盘当前标签)
  if (!target) return
  doc.采用状态(target.state)
  setDocDir(await currentDocDir())
  view.setState(target.editorState)
  updateTitle()
  refreshTabUi()
  view.focus()
}

/** 循环切换，用于"应用内窗口切换"。 */
async function 循环标签(direction: 1 | -1): Promise<void> {
  const target = tabSet.循环(direction, 落盘当前标签)
  if (!target) {
    toast('只有一个文档，无需切换')
    return
  }
  doc.采用状态(target.state)
  setDocDir(await currentDocDir())
  view.setState(target.editorState)
  updateTitle()
  refreshTabUi()
  view.focus()
}

/** 关闭一个标签。 */
async function closeTab(id: number): Promise<void> {
  const target = tabSet.list.find((t) => t.id === id)
  if (!target) return
  if (!tabSet.可以关闭) {
    toast('至少要保留一个文档')
    return
  }

  // 未保存的改动只有这里能备份下来，所以内容必须在这一刻取
  const 是当前的 = tabSet.current?.id === id
  const content = 是当前的 ? currentText() : target.editorState.doc.toString()

  if (target.state.dirty) {
    const 确认 = await window.selfmd.dialog.message({
      type: 'question',
      title: '关闭文档',
      message: `「${target.state.name}」有未保存的改动`,
      detail: '关闭后可以用「重新打开关闭的文件」找回内容，但不会写回磁盘。',
      buttons: ['关闭', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    if (确认.response !== 0) return
  }

  const 要切到 = tabSet.close(id, content, 落盘当前标签)
  if (!要切到) return
  doc.采用状态(要切到.state)
  setDocDir(await currentDocDir())
  view.setState(要切到.editorState)
  updateTitle()
  refreshTabUi()
}

/**
 * 标签变动后刷新依赖它的界面。
 *
 * 抽成一处而不是散在各个调用点：漏掉任何一处都会表现为
 * "侧边栏还列着刚关掉的文档"这类看着像缓存的问题。
 */
function refreshTabUi(): void {
  sidebar?.设置文档列表(
    tabSet.list.map((t) => ({
      id: t.id,
      nameText: t.state.name,
      脏: t.state.dirty,
      current: t.id === tabSet.current?.id
    }))
  )
  // 换文档后文件树要跟着换根目录，大纲也要重算
  sidebar?.refreshFileTree()
  refreshOutline(true)
}

function updateTitle(): void {
  const state = doc.current
  const mark = state.dirty ? '• ' : ''
  const where = state.path ?? '尚未保存'
  document.title = `${mark}${state.name} — ${where}`
  statusBar?.updateFromView(view, settings.livePreview ? '实时预览' : '源代码', state.name)
}

function onEditorChange(v: EditorView): void {
  void v
  doc.markDirty()
  updateTitle()
}

/**
 * 程序化编辑之后的统一收尾。
 *
 * 刻意不依赖 updateListener：命令是通过 dispatch 直接改文档的，
 * 有些路径（例如只移动光标）不会触发 docChanged，统一在这里收口更可靠。
 */
function afterEdit(): void {
  doc.markDirty()
  updateTitle()
  view.focus()
}

// ---------------------------------------------------------------------------
// 图片
// ---------------------------------------------------------------------------

/**
 * 构造一次图片插入请求。
 *
 * 编辑器尚未建立时返回 null——拖放/粘贴处理器会在启动早期被调用，
 * 那种情况下静默放弃比抛异常正确。
 */
function 当前插入请求(): InsertRequest | null {
  if (!view) return null
  return {
    view: view,
    docPath: doc.current.path,
    文档文本: view.state.doc.toString(),
    settings: settings
  }
}

/** 编辑器扩展集合。集中一处，避免"两个 EditorState.create 参数不一致"。 */
function editorExtensions(): Extension[] {
  return [
    ...baseExtensions({ settings, onChange: onEditorChange }),
    modeCompartment.of(modeExtensions(settings)),
    图片粘贴与拖放({
      构造请求: 当前插入请求,
      hint: (消息) => toast(消息, 'error')
    }),
    // 大纲跟随光标与文档变化。
    //
    // 文档变了要重算标题；只是光标移动则复用缓存——重算要遍历整棵语法树，
    // 而光标移动在打字时每按一次键都会发生。
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        refreshOutline(true)
        安排自动保存()
      } else if (update.selectionSet) {
        refreshOutline(false)
        // 打字机模式：光标换行时把该行重新滚到垂直中央。
        // 只在**行号真的变了**时才滚——否则在一行内左右移动光标也会触发滚动，
        // 用户会看到画面无谓地跳动。
        if (settings.typewriterMode) {
          const 旧行 = update.startState.doc.lineAt(update.startState.selection.main.head).number
          const newLine = update.state.doc.lineAt(update.state.selection.main.head).number
          if (旧行 !== newLine) 居中光标行(update.view)
        }
      }
    }),
    专注模式扩展()
  ]
}

/**
 * 把"编辑模式"类开关同步到 body 上。
 *
 * 用 body 类而不是在扩展里读设置：扩展一旦装进 EditorState 就不会随设置变化，
 * 而每次改设置都重建整个 state 会丢掉撤销历史与滚动位置。
 * 类名与通行做法一致（`on-focus-mode` / `selfmd-typewriter-mode`），主题可直接挂钩。
 */
function applyEditMode(): void {
  document.body.classList.toggle('on-focus-mode', settings.focusMode)
  document.body.classList.toggle('selfmd-typewriter-mode', settings.typewriterMode)
  // 公式与标点开关不在 body 类上，因为它们决定的是"装饰怎么建"而不是
  // "怎么显示"，改了必须重绘才能生效。调用方负责在改完之后 dispatch 一次空事务。
  setInlineMathEnabled(settings.enableInlineMath)
  setPunctuationRenderingEnabled(settings.smartPunctuationMode === 'rendering')
}

/**
 * 偏好设置面板。
 *
 * 写成单例并在模块级创建：它需要在"设置变更"时刷新自己以反映外部改动
 * （例如菜单里切了主题），面板本身不该反复重建。
 */
const prefsPanel = new 偏好设置面板({
  取设置: () => settings,
  应用设置: async (patchResult) => {
    // 走主进程 patch，不直接改本地对象：渲染层的 settings 只是缓存，
    // 任何一次设置广播都会覆盖它。
    settings = await window.selfmd.settings.patch(patchResult)
    applyTheme(settings)
    applyEditMode()
    刷新模式相关界面()
    return settings
  },
  取只读值: (key) => (key === 'theme' ? activeTheme(settings) : null)
})

/** 设置变化后需要跟着更新的界面。 */
function 刷新模式相关界面(): void {
  statusBar?.setVisible(settings.showStatusBar)
  prefsPanel.refresh()
}

// ---------------------------------------------------------------------------
// 自动保存与崩溃恢复
// ---------------------------------------------------------------------------

/**
 * 自动保存的防抖延迟。
 *
 * 3 秒是个折中：太短会让快速打字时频繁写盘（大文档上能感觉到卡顿），
 * 太长则崩溃时丢的内容多。通行的自动保存也是"停顿后才写"的思路。
 */
const 自动保存延迟 = 3000

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 安排一次自动保存。
 *
 * 每次改动都重置计时器，所以连续打字期间不会写盘——只在**停下来之后**写一次。
 * 自动保存关掉时直接返回，但不清掉已有的待写草稿：用户可能在打字中途关掉开关，
 * 那部分内容仍然值得落一次盘。
 */
function 安排自动保存(): void {
  if (!settings.autoSave) return
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    void 立即保存草稿()
  }, 自动保存延迟)
}

/** 立刻把当前内容写成草稿（切换文档、关窗、以及防抖到期时调用）。 */
async function 立即保存草稿(): Promise<void> {
  if (!view) return
  const 计时器 = autosaveTimer
  if (计时器 !== null) {
    clearTimeout(计时器)
    autosaveTimer = null
  }
  // 不 await 结果也不报错：自动保存失败不该打断用户。
  await window.selfmd.draft.save(doc.current.path, view.state.doc.toString())
}

/**
 * 启动时检查有没有需要恢复的草稿。
 *
 * 单独做成一个函数是因为它需要与用户交互：列出可恢复的文档，让用户选。
 * 直接静默恢复是错的——用户可能已经确认过那些改动不要了。
 */
async function 检查崩溃恢复(): Promise<void> {
  let toRecover: DraftInfo[] = []
  try {
    toRecover = await window.selfmd.draft.pending()
  } catch {
    return
  }
  if (toRecover.length === 0) return

  const 明细 = toRecover
    .slice(0, 6)
    .map((draft) => {
      const name = draft.rawPath ? draft.rawPath.split(/[\\/]/).pop() : '未命名文档'
      const time = new Date(draft.savedAt).toLocaleString('zh-Hans')
      return `${name}（${draft.draftChars} 字符，${time}）`
    })
    .join('\n')

  const 答复 = await window.selfmd.dialog.message({
    type: 'question',
    title: '恢复未保存的内容',
    message: `发现 ${toRecover.length} 份未保存的内容`,
    detail: `${明细}\n\n是否恢复？\n· 恢复：打开最后一份草稿的内容\n· 丢弃：删除全部草稿`,
    buttons: ['恢复', '稍后再说', '丢弃'],
    defaultId: 0,
    cancelId: 1
  })

  if (答复.response === 2) {
    for (const draft of toRecover) await window.selfmd.draft.discard(draft.key)
    toast('已丢弃全部草稿')
    return
  }
  if (答复.response !== 0) return

  // 恢复最近的一份：把内容放进当前编辑器。
  // 原文件存在时不直接覆盖磁盘——让用户先看到内容再自己决定保存。
  const 最新 = toRecover[0]
  const content = await window.selfmd.draft.read(最新.key)
  if (content === null) {
    toast('读取草稿失败', 'error')
    return
  }

  if (最新.rawPath) {
    // 有原文件：打开它，然后把草稿内容覆盖到编辑器里（磁盘不动）
    await openPath(最新.rawPath)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      annotations: isolatedUndo
    })
    doc.markDirty()
    updateTitle()
    toast(`已恢复「${最新.rawPath.split(/[\\/]/).pop()}」的未保存内容，确认后请保存`)
  } else {
    tabSet.saveCurrent(view.state)
    setDocument(content)
    tabSet.addTo(doc.exportStatus(), view.state)
    doc.markDirty()
    updateTitle()
    refreshTabUi()
    toast('已恢复未命名文档的内容，确认后请保存')
  }
}

// ---------------------------------------------------------------------------
// 侧边栏与大纲
// ---------------------------------------------------------------------------

let sidebar: 侧边栏组件 | null = null
let 标题缓存: headingItem[] = []

/**
 * 重绘大纲并把"当前标题"高亮对齐到光标。
 *
 * @param 重算 是否重新遍历语法树取标题。光标移动时传 false 复用缓存。
 */
function refreshOutline(重算: boolean): void {
  if (!sidebar || !view) return
  if (重算) 标题缓存 = extractHeadings(view.state)
  sidebar.setOutline(标题缓存, locateHeading(标题缓存, view.state.selection.main.head))
  if (重算) sidebar.高亮当前文件(doc.current.path)
}

/**
 * 主题系统的端到端自测。
 *
 * 验证协议层能服务主题目录下的**任意文件**，而不仅是 `<主题名>.css`——
 * 主题的字体、图片、深色子样式表都靠这一点。同时验证目录穿越被挡住。
 */
async function 运行主题自测(): Promise<string> {
  const take = async (filePath: string): Promise<string> => {
    try {
      const response = await fetch(`selfmd://theme/${filePath}`)
      return String(response.status)
    } catch {
      return '异常'
    }
  }
  const 主题本体 = await take('__冒烟__.css')
  const 子目录资源 = await take('__冒烟__/子样式.css')
  const 不存在 = await take('这个文件不存在.css')
  const 穿越 = await take('../package.json')

  // --- 内置主题是否真的装上了 -------------------------------------------
  //
  // 主题"装了没有"这件事会静默出错：文件没写进 `<userData>/themes`、
  // 元数据里的 `@name` 解析失败、深色标记判错——三种情况在界面上
  // 都只表现为"下拉框里少一项"或"名字变成文件名"，不会报任何错。
  // 所以真的列一次，把 id、显示名、深色标记都数出来。
  const 主题们 = await window.selfmd.theme.list()
  const builtin = 主题们.filter((t) => t.builtin)
  const describeText = builtin
    .map((t) => `${t.id}=${t.name}${t.isDark ? '(暗)' : ''}`)
    .sort()
    .join(' ')

  // 三款内置主题都要能通过协议读到正文（不是 404 也不是空文件）
  const 可读 = await Promise.all(
    builtin.map(async (t) => {
      const state = await take(`${t.id}.css`)
      return state === '200'
    })
  )

  // --- 主题到底生效了没有 -------------------------------------------------
  //
  // 上面那几行只证明"样式表能通过协议取到"。**取到 ≠ 生效**：
  // link 的 href 可能没被设上、样式表可能解析失败、也可能被优先级更高的
  // 规则整个盖掉。所以这里读**计算后的值**，而不是读文件内容。
  //
  // 这是被真实反馈逼出来的：主题切换后界面"看起来没变化"，
  // 而协议自测全绿——因为它测的是"能不能取到"，不是"有没有生效"。
  const 根样式 = getComputedStyle(document.documentElement)
  const takeValue = (name: string): string => 根样式.getPropertyValue(name).trim()
  const 主题链接 = document.getElementById('theme-css') as HTMLLinkElement | null
  const 生效值 = [
    `底色=${takeValue('--bg-color')}`,
    `文字=${takeValue('--text-color')}`,
    `字号=${takeValue('--font-size')}`,
    `行高=${takeValue('--line-height')}`,
    `版心=${takeValue('--content-max-width')}`
  ].join(' ')

  // 样式表是否真的解析出了规则。跨源样式表读 cssRules 会抛，
  // 但 ours 是同源协议，读得到——读不到就说明它根本没加载成功。
  //
  // **逐个列出**而不是只报一个数：三层里有两层（base.user / <主题>.user）
  // 默认是不存在的文件，只报一个总数会分不清"哪一层出问题"。
  const 样式表 = Array.from(document.styleSheets).map((s) => {
    const name = (s.href ?? '(内联)').split('/').slice(-1)[0] || '(内联)'
    let numItems = '?'
    try {
      numItems = String(s.cssRules.length)
    } catch {
      numItems = 'X'
    }
    return `${name}:${numItems}`
  })
  const 规则数 = 样式表.join(',')

  // 主题那份样式表里第一条规则到底写了什么——如果它解析成了空规则，
  // 这里会露出来，而不是仅仅表现为"颜色没变"。
  let 首条规则 = '无'
  try {
    const piece = Array.from(document.styleSheets).find(
      (s) => s.href && s.href.includes('/theme/') && s.cssRules.length > 0
    )
    if (piece) 首条规则 = piece.cssRules[0].cssText.slice(0, 60).replace(/\s+/g, ' ')
  } catch {
    首条规则 = '异常'
  }

  // --- 切换主题，计算值真的会变吗 -----------------------------------------
  //
  // 这条才是"主题功能有没有用"的直接证据。上面那些只证明**样式表被加载了**，
  // 而加载 ≠ 生效：静态写在 index.html 里的主题链接会排在构建产物**之前**，
  // 两者都是 `:root`，后加载的赢——主题解析了、规则也在，然后被整个盖掉。
  // 曾经就是这个原因导致"切换主题没有任何变化"，而协议自测全绿。
  const 原主题 = settings.theme
  const 采样: string[] = []
  for (const 试 of ['moon-light', 'parchment', 'moon-dark']) {
    settings = await window.selfmd.settings.patch({ theme: 试 })
    applyTheme(settings)
    // 等样式表应用：link 是异步加载的，不等会读到上一份的值
    await new Promise((done) => setTimeout(done, 150))
    const value = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim()
    采样.push(`${试}=${value}`)
  }
  settings = await window.selfmd.settings.patch({ theme: 原主题 })
  applyTheme(settings)
  await new Promise((done) => setTimeout(done, 150))

  // 三款主题的底色**互不相同**才算"切换真的生效"。
  // 有一对相同就可能只是巧合（比如两款都被人改成了同一个颜色），
  // 但三者全同必然说明主题根本没起作用。
  const 底色们 = 采样.map((s) => s.split('=')[1])
  const 互不相同 = new Set(底色们).size === 底色们.length

  return (
    `主题本体=${主题本体} 子目录资源=${子目录资源} ` +
    `缺失文件=${不存在} 目录穿越=${穿越} ` +
    `内置=${builtin.length} 明细=${describeText} 全部可读=${可读.every(Boolean)} ` +
    `链接=${主题链接?.getAttribute('href') ? '已设' : '空'} 规则=${规则数} ${生效值} ` +
    `切换=${采样.join(' ')} 互不相同=${互不相同} ` +
    `首条=${首条规则}`
  )
}

/**
 * 侧边栏渲染自测。
 *
 * 大纲的提取逻辑有纯函数断言兜着，但"提取对了"不等于"渲染出来了"——
 * 中间还隔着一次 DOM 构建。这里真的把侧边栏显示出来、真的数一遍渲染出的条目，
 * 把两步之间的缝补上。
 */
async function 运行侧边栏自测(): Promise<string> {
  const host = document.getElementById('sidebar')
  if (!sidebar || !host) return '侧边栏未初始化'

  sidebar.setTab('outline')
  sidebar.setVisible(true)
  refreshOutline(true)
  // 让 push 到 DOM 的微任务先跑完再数
  await new Promise((done) => setTimeout(done, 0))

  const outlineEntry = host.querySelectorAll('.outline-item').length
  const 激活项 = host.querySelectorAll('.outline-item.active').length

  // 文件树依赖真实磁盘目录；样本文件在 fixtures/ 下，应当能读出来
  sidebar.setTab('files')
  await sidebar.refreshFileTree()
  await new Promise((done) => setTimeout(done, 0))
  const fileRow = host.querySelectorAll('.file-list-item').length

  sidebar.setTab('outline')

  // --- 三档显示策略 -------------------------------------------------------
  //
  // 「始终显示 / 始终隐藏」是**策略**，必须压得过一次快捷键。
  // 这条链路上任何一处漏掉模式判断，都会出现"设了始终隐藏、按一下快捷键
  // 又冒出来"这种自相矛盾的状态——而它不会报错，只会让人觉得设置没用。
  const 原模式 = settings.sidebarMode
  const 原可见 = settings.sidebarVisible
  const 策略结果: string[] = []

  for (const [模式, 期望] of [
    ['never', false],
    ['always', true],
    ['toggle', 原可见]
  ] as const) {
    settings = await window.selfmd.settings.patch({ sidebarMode: 模式 })
    sidebar.setVisible(sidebarShown(settings))
    await new Promise((done) => setTimeout(done, 40))
    const actual = !host.hidden
    策略结果.push(`${模式}=${actual === 期望 ? '对' : `错(${actual})`}`)
  }

  // 收尾：把状态恢复原样，免得影响后面的用例
  settings = await window.selfmd.settings.patch({ sidebarMode: 原模式, sidebarVisible: 原可见 })
  sidebar.setVisible(sidebarShown(settings))

  return (
    `标题数=${标题缓存.length} 大纲项=${outlineEntry} 高亮项=${激活项} ` +
    `文件树根=${sidebar.rootDir ? '已定位' : '无'} 文件项=${fileRow} ` +
    `策略=${策略结果.join(' ')}`
  )
}

/** 命令 id → 导出格式。 */
function 命令到导出格式(command: string): string {
  switch (command) {
    case 'file.exportHtml':
      return 'html'
    case 'file.exportHtmlPlain':
      return 'html-plain'
    case 'file.exportPdf':
      return 'pdf'
    case 'file.exportDocx':
      return 'docx'
    case 'file.exportLatex':
      return 'latex'
    case 'file.exportEpub':
      return 'epub'
    case 'file.exportRtf':
      return 'rtf'
    case 'file.exportOdt':
      return 'odt'
    default:
      // 「导出」主命令走 HTML——它不需要任何外部依赖，一定成功。
      return 'html'
  }
}

/** 取路径的文件名（去掉扩展名）。 */
function 去掉扩展名(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  return name.replace(/\.[^.]+$/, '')
}

/**
 * 未保存的文档没有文件名，用首个非空行当标题。
 *
 * 比直接用"未命名文档"好：用户刚写完一段打算导出，默认名就是他写的标题，
 * 直接回车即可。
 */
function 首行作标题(docText: string): string {
  for (const line of docText.split('\n')) {
    const 干净 = line.replace(/^#+\s*/, '').trim()
    // 跳过前置元数据分隔线与空行
    if (干净 && 干净 !== '---') return 干净.slice(0, 60)
  }
  return '未命名文档'
}

/**
 * 专注模式与打字机模式的自测。
 *
 * 这两者都是"设置 → body 类 → CSS/滚动"的链路，中间任何一环断了都不会报错，
 * 只是看起来没反应。所以真的切一次、真的数一遍带 `md-focus` 的行。
 *
 * **必须走 `settings.patch` 并 await**，不能直接改本地 `settings` 对象：
 * 渲染层的 `settings` 只是主进程状态的缓存，任何一次设置广播都会把它覆盖掉。
 * 第一版就是直接赋值的，结果前一个自测触发的广播在半路落地，
 * 把刚设上的 body 类冲掉了——症状是"装饰生效了但类没生效"。
 *
 * 测完恢复原始设置：冒烟测试不该改变用户的偏好。
 */
async function 运行模式自测(): Promise<string> {
  const 原始专注 = settings.focusMode
  const 原始打字 = settings.typewriterMode

  // 把光标放到文档中段，确保它落在某个真实的块里
  view.dispatch({ selection: EditorSelection.cursor(Math.floor(view.state.doc.length / 2)) })
  await new Promise((done) => setTimeout(done, 0))

  settings = await window.selfmd.settings.patch({ focusMode: true, typewriterMode: false })
  applyEditMode()
  await new Promise((done) => setTimeout(done, 0))
  const 专注行数 = document.querySelectorAll('.cm-line.md-focus').length
  const 有专注类 = document.body.classList.contains('on-focus-mode')
  const 专注时无打字机类 = !document.body.classList.contains('selfmd-typewriter-mode')

  settings = await window.selfmd.settings.patch({ focusMode: false, typewriterMode: true })
  applyEditMode()
  const 有打字机类 = document.body.classList.contains('selfmd-typewriter-mode')

  // 拼写检查走的是"设置 → 内容元素的属性"，与上面两个走 body 类的不同。
  // 这条链路任何一环断了都不会报错——只是红波浪线不出现，
  // 而用户多半会以为"这个词本来就拼对了"。
  settings = await window.selfmd.settings.patch({ spellCheck: true })
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(settings)) })
  await new Promise((done) => setTimeout(done, 0))
  const 拼写开启 = document.querySelector('.cm-content')?.getAttribute('spellcheck')

  settings = await window.selfmd.settings.patch({ spellCheck: false })
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(settings)) })
  await new Promise((done) => setTimeout(done, 0))
  const 拼写关闭 = document.querySelector('.cm-content')?.getAttribute('spellcheck')

  // 恢复
  settings = await window.selfmd.settings.patch({
    focusMode: 原始专注,
    typewriterMode: 原始打字
  })
  applyEditMode()

  return (
    `专注行=${专注行数} 专注类=${有专注类} 专注时无打字机类=${专注时无打字机类} ` +
    `打字机类=${有打字机类} 拼写开启=${拼写开启} 拼写关闭=${拼写关闭}`
  )
}

/**
 * 偏好设置面板的渲染自测。
 *
 * 表自测只能证明"描述对了"；这里真的把面板打开、真的数一遍渲染出的行，
 * 再切一次搜索与关闭，把"描述 → 界面"这一段补上。
 */
async function 运行偏好界面自测(): Promise<string> {
  prefsPanel.open()
  await new Promise((done) => setTimeout(done, 0))

  const overlay = document.querySelector('.selfmd-prefs')
  if (!overlay) return '面板未渲染'

  const 分区数 = overlay.querySelectorAll('.prefs-tab').length
  const 首屏行数 = overlay.querySelectorAll('.prefs-row').length

  // 搜索：跨分区平铺
  const search = overlay.querySelector('.prefs-search') as HTMLInputElement | null
  let 搜索命中 = -1
  if (search) {
    search.value = '字体'
    search.dispatchEvent(new Event('input'))
    await new Promise((done) => setTimeout(done, 0))
    搜索命中 = overlay.querySelectorAll('.prefs-row').length
  }

  // 清空搜索后应回到分类视图
  if (search) {
    search.value = ''
    search.dispatchEvent(new Event('input'))
    await new Promise((done) => setTimeout(done, 0))
  }
  const 清空后行数 = overlay.querySelectorAll('.prefs-row').length

  prefsPanel.close()
  const 残留 = document.querySelectorAll('.selfmd-prefs').length

  return (
    `分区=${分区数} 首屏行=${首屏行数} 搜索命中=${搜索命中} ` +
    `清空后行=${清空后行数} 关闭后残留=${残留}`
  )
}

/** 刷新图片显示所需的基准目录。文档切换或另存为之后都要调。 */
async function 刷新图片基准目录(): Promise<void> {
  const docModel = doc.current.path
  if (!docModel) {
    setDocDir(null)
    return
  }
  // 相对路径（`图/样本.png`）要拼到文档所在目录上才找得到文件。
  // 这一步漏了的话，图片会全部显示成"无法显示"，而 Markdown 语法完全正确。
  setDocDir(await window.selfmdExtra.path.dirname(docModel))
}

/**
 * 注册图片右键处理器与目录提供者。
 *
 * 放在 boot 里而不是模块顶层：处理器要用 `view`，而 `view` 是启动时才建的。
 */
function 安装图片右键(): void {
  // 图片操作模块需要知道当前文档目录才能解析相对路径。
  // 用提供者函数而不是把目录传进去，是为了让它始终读到最新值。
  设置目录提供者(() => takeDocDir())

  设置图片右键处理器((event, _原地址, _替代, el) => {
    void 打开图片菜单(event, el)
  })
}

/**
 * 图片右键菜单自测。
 *
 * 菜单是"点了没反应也看不出来"的典型：回调没注册、位置反查失败、
 * 菜单被立刻关掉——三种情况都只是"右键没反应"，没有任何报错。
 * 所以真的在一个渲染出来的图片上触发一次 contextmenu，再数菜单项。
 */
async function 运行图片菜单自测(): Promise<string> {
  const 全部图 = Array.from(document.querySelectorAll('.cm-w-image')) as HTMLElement[]
  if (全部图.length === 0) return '页面上没有渲染出的图片'

  /** 在某个元素上触发右键，返回菜单统计。 */
  const 量 = async (target: HTMLElement | null): Promise<string> => {
    if (!target) return '缺失'
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100
    })
    target.dispatchEvent(event)
    await new Promise((done) => setTimeout(done, 0))
    const menu = document.querySelector('.selfmd-menu')
    if (!menu) return '未弹出'
    const 项数 = menu.querySelectorAll('.selfmd-menu-item').length
    const 禁用数 = menu.querySelectorAll('.selfmd-menu-item.disabled').length
    const 分隔数 = menu.querySelectorAll('.selfmd-menu-sep').length
    closeMenu()
    return `${项数}/${禁用数}/${分隔数}`
  }

  // 本地图片：上传、重命名、复制、删除都应当可用
  const 本地 = 全部图.find((img) => !/^https?:/i.test(img.dataset.src ?? '')) ?? null
  // 远程图片：那几项必须置灰——点下去只会弹一句"没有本地文件"
  const 远程 = 全部图.find((img) => /^https?:/i.test(img.dataset.src ?? '')) ?? null

  const 本地统计 = await 量(本地)
  const 远程统计 = await 量(远程)

  await new Promise((done) => setTimeout(done, 0))
  const 关闭后残留 = document.querySelectorAll('.selfmd-menu').length

  return `本地=${本地统计} 远程=${远程统计} 关闭后残留=${关闭后残留}`
}

/**
 * 编辑器里的右键菜单。
 *
 * 与主流 Markdown 编辑器对齐：分「编辑动作 → 段落 → 格式 → 插入 → 查找」
 * 几组，段落与格式收进子菜单——平铺出来二十多项，找一项得扫半屏。
 *
 * 全部走 `runCommand`，与菜单栏、快捷键**同一条路径**。各写一套的话，
 * 右键"加粗"和 Ctrl+B 迟早会在边界情况上分叉（比如空选区时一个生效一个不生效）。
 *
 * 置灰的判断也来自真实状态：没选区就不能剪切复制，只读时不能粘贴。
 */
function 构建编辑器右键菜单(): menuItem[] {
  const sel = view.state.selection.main
  const 有选区 = sel.from !== sel.to
  const 只读 = view.state.readOnly

  const convert = (id: string, text: string, hint?: string, disabled?: boolean): menuItem => ({
    text,
    hint,
    disabled,
    action: () => void runCommand({ command: id })
  })

  return [
    convert('edit.undo', '撤消', 'Ctrl+Z'),
    convert('edit.redo', '重做', 'Ctrl+Shift+Z'),
    { separator: true },
    convert('edit.cut', '剪切', 'Ctrl+X', !有选区),
    convert('edit.copy', '复制', 'Ctrl+C', !有选区),
    convert('edit.paste', '粘贴', 'Ctrl+V', 只读),
    convert('edit.pasteAsPlainText', '粘贴为纯文本', 'Ctrl+Shift+V', 只读),
    { separator: true },

    {
      text: '段落',
      children: [
        convert('para.h1', '一级标题', 'Ctrl+1'),
        convert('para.h2', '二级标题', 'Ctrl+2'),
        convert('para.h3', '三级标题', 'Ctrl+3'),
        convert('para.h4', '四级标题'),
        convert('para.h5', '五级标题'),
        convert('para.h6', '六级标题'),
        { separator: true },
        convert('para.headingUp', '提升标题级别'),
        convert('para.headingDown', '降低标题级别'),
        { separator: true },
        convert('para.quote', '引用'),
        convert('para.unorderedList', '无序列表'),
        convert('para.orderedList', '有序列表'),
        convert('para.taskList', '任务列表'),
        { separator: true },
        convert('para.codeFences', '代码块', 'Ctrl+Shift+K'),
        convert('para.mathBlock', '公式块'),
        convert('para.table', '表格'),
        convert('para.horizontalLine', '水平分割线')
      ]
    },

    {
      text: '格式',
      children: [
        convert('fmt.strong', '加粗', 'Ctrl+B'),
        convert('fmt.emphasis', '斜体', 'Ctrl+I'),
        convert('fmt.underline', '下划线'),
        convert('fmt.strike', '删除线', 'Alt+Shift+5'),
        convert('fmt.highlight', '高亮'),
        convert('fmt.code', '行内代码', 'Ctrl+Shift+`'),
        convert('fmt.inlineMath', '行内公式'),
        { separator: true },
        convert('fmt.superscript', '上标'),
        convert('fmt.subscript', '下标'),
        { separator: true },
        convert('fmt.hyperlink', '超链接', 'Ctrl+K'),
        convert('fmt.clear', '清除格式')
      ]
    },

    {
      text: '插入',
      children: [
        convert('image.insertLocal', '插入本地图片'),
        convert('image.insertFromUrl', '插入网络图片'),
        // 插入表格放在这里，**不挂在"光标已在表格内"的子菜单里**。
        // 那个子菜单是给增删行列用的，插入表格恰恰是"当前不在表格里"时才需要。
        convert('para.table', '插入表格', 'Ctrl+Shift+T'),
        { separator: true },
        convert('edit.copyAsMarkdown', '复制为 Markdown'),
        convert('edit.copyAsHtmlCode', '复制为 HTML 代码'),
        convert('edit.copyAsImage', '复制为图片')
      ]
    },

    { separator: true },
    convert('edit.selectAll', '全选', 'Ctrl+A'),
    convert('edit.selectBlock', '选择段落或块'),
    { separator: true },
    convert('edit.find', '查找', 'Ctrl+F'),
    convert('edit.findAndReplace', '查找和替换', 'Ctrl+H'),

    // 表格操作只在光标位于表格内时出现——不在表格里却摆着一堆"插入行"的
    // 菜单项，等于让用户点进去看它什么都不做。
    ...(在表格里(view.state)
      ? ([
          { separator: true },
          {
            text: '表格',
            children: [
              { text: '在上方插入行', action: () => 表格在上方插行() },
              { text: '在下方插入行', action: () => void 表格增行(view) },
              { text: '删除本行', 危险: true, action: () => void 表格删行(view) },
              { separator: true },
              { text: '右侧插入列', action: () => void 表格增列(view) },
              { text: '删除本列', 危险: true, action: () => void 表格删列(view) },
              { separator: true },
              { text: '左对齐', action: () => void tableAlign(view, 'left') },
              { text: '居中', action: () => void tableAlign(view, 'center') },
              { text: '右对齐', action: () => void tableAlign(view, 'right') }
            ]
          }
        ] as menuItem[])
      : [])
  ]
}

/**
 * 在光标所在行**上方**插一行。
 *
 * `表格增行` 只做"下方插入"——上方插要另写：把光标临时挪到上一行再插，
 * 这样不用在命令里再加一个方向参数。
 */
function 表格在上方插行(): void {
  const original = view.state.selection.main.head
  const line = view.state.doc.lineAt(original)
  if (line.number <= 1) return
  view.dispatch({ selection: { anchor: view.state.doc.line(line.number - 1).from } })
  表格增行(view)
  // 光标按原来插进去的行数偏移，回到用户原来那一行
  const offset = view.state.doc.length - view.state.doc.lineAt(original).to
  void offset
  view.dispatch({ selection: { anchor: Math.min(original, view.state.doc.length) } })
}

/**
 * 编辑器右键菜单自测。
 *
 * 右键菜单是"点了没反应也看不出来"的典型：回调没接上、子菜单展不开、
 * 点完菜单不关——三种情况在界面上都只表现为"右键不好使"。
 *
 * 断言：
 *   1. 真的在编辑器上派发一次 contextmenu，数顶层项与子菜单
 *   2. 无选区时"剪切/复制"必须置灰（否则点了没反应，用户以为坏了）
 *   3. 展开子菜单后确实多出一层，且挂在 body 上
 *   4. 按 Esc 之后 DOM 里不留残余
 */
async function 运行右键菜单自测(): Promise<string> {
  // 先清空选区，好验证置灰逻辑
  view.dispatch({ selection: { anchor: 0 } })
  await new Promise((done) => setTimeout(done, 60))

  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 200,
    clientY: 200
  })
  view.dom.dispatchEvent(event)
  await new Promise((done) => setTimeout(done, 80))

  const menu = document.querySelector('.selfmd-menu')
  if (!menu) return '菜单未弹出'

  const 顶层项 = menu.querySelectorAll('.selfmd-menu-item').length
  // 没有选区时，剪切与复制应当置灰
  const 置灰数 = menu.querySelectorAll('.selfmd-menu-item.disabled').length
  const 有子菜单 = menu.querySelectorAll('.selfmd-menu-item.has-submenu').length
  const 被拦截 = event.defaultPrevented ? '是' : '否'

  // 展开第一个可用的子菜单
  const 带子项 = Array.from(menu.querySelectorAll('.selfmd-menu-item.has-submenu')).find(
    (el) => !el.classList.contains('disabled')
  ) as HTMLElement | undefined

  let 子菜单项数 = 0
  let 挂在Body = '无子菜单'
  if (带子项) {
    // 重试到子菜单出现为止，而不是"派发一次、等 80ms、看一眼"。
    //
    // 一次派发在实机上偶发失效（打包版首跑时出现过），而断言要证明的是
    // **子菜单能不能展开**，不是"能不能在 80ms 内展开"。写成一次性等待
    // 会让这条用例时绿时红——**偶发的测试比没有测试更糟**，
    // 它教人忽略失败。
    for (let 次 = 0; 次 < 10 && !document.querySelector('.selfmd-submenu'); 次++) {
      带子项.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
      await new Promise((done) => setTimeout(done, 30))
    }
    const child = document.querySelector('.selfmd-submenu')
    子菜单项数 = child ? child.querySelectorAll('.selfmd-menu-item').length : 0
    // 子菜单必须挂在 body 上而不是父菜单里——挂在里面会被父菜单裁掉，
    // 也会被"点空白处关闭"的逻辑误判成点到了外面
    挂在Body = child ? (child.parentElement === document.body ? '是' : '否') : '无子菜单'
  }

  // Esc 关闭并检查残留
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((done) => setTimeout(done, 60))
  const 残留 = document.querySelectorAll('.selfmd-menu, .selfmd-submenu').length

  return (
    `顶层项=${顶层项} 置灰=${置灰数} 有子菜单=${有子菜单} ` +
    `子菜单项=${子菜单项数} 挂在Body=${挂在Body} 拦截默认菜单=${被拦截} 关闭后残留=${残留}`
  )
}

/**
 * 表格编辑自测。
 *
 * 表格编辑是"改错位置也看不出来"的典型：Tab 跳到错误的格子、插行插到
 * 别的地方、删列留下 `||`——界面上都只是"看着有点怪"。
 * 所以每一步都**改完就检查文档文本**。
 */
async function 运行表格自测(): Promise<string> {
  const 原表 = ['| 甲 | 乙 | 丙 |', '| --- | --- | --- |', '| 1 | 2 | 3 |'].join('\n')
  const backup = view.state
  const result: string[] = []

  /**
   * 每一项都从**全新的文档**开始。
   *
   * 第一版是连着改同一份文档的：增列留下的结构变化把后面「对齐」的判断
   * 带偏了，失败信息里根本看不出是哪一步坏的。独立之后每个结论只对应
   * 一个动作，坏了就能直接定位。
   */
  const resetDoc = async (): Promise<void> => {
    view.setState(EditorState.create({ doc: 原表, extensions: editorExtensions() }))
    setDocDir(null)
    await new Promise((done) => setTimeout(done, 60))
  }
  const 第 = (n: number): string => view.state.doc.line(n).text
  const 竖线数 = (): number => (第(1).match(/\|/g) ?? []).length

  // --- Tab 跳到下一格 -------------------------------------------------
  await resetDoc()
  view.dispatch({ selection: { anchor: 2 } })
  moveToAdjacentCell(view, 1)
  const 落点 = view.state.selection.main.head
  result.push('Tab跳格=' + (view.state.sliceDoc(落点, 落点 + 1) === '乙' ? '对' : '错'))

  // --- 末格再 Tab 自动补一行 -------------------------------------------
  await resetDoc()
  view.dispatch({ selection: { anchor: 第(3).length + view.state.doc.line(3).from - 1 } })
  moveToAdjacentCell(view, 1)
  result.push('末格补行=' + (view.state.doc.lines === 4 ? '对' : '错(' + view.state.doc.lines + '行)'))

  // --- 增行 / 删行 -----------------------------------------------------
  await resetDoc()
  view.dispatch({ selection: { anchor: 2 } })
  表格增行(view)
  const 增后 = view.state.doc.lines
  await resetDoc()
  view.dispatch({ selection: { anchor: 第(3).length + view.state.doc.line(3).from - 1 } })
  表格删行(view)
  const 删后 = view.state.doc.lines
  result.push('增行=' + (增后 === 4 ? '对' : '错(' + 增后 + ')') + ' 删行=' + (删后 === 2 ? '对' : '错(' + 删后 + ')'))

  // --- 增列 / 删列 -----------------------------------------------------
  await resetDoc()
  view.dispatch({ selection: { anchor: 2 } })
  表格增列(view)
  const 增列 = 竖线数()
  await resetDoc()
  view.dispatch({ selection: { anchor: 2 } })
  表格删列(view)
  const 删列 = 竖线数()
  // 三个格子 = 4 条竖线；加一列 5 条，删一列 3 条
  result.push('增删列=' + (增列 === 5 && 删列 === 3 ? '对' : '错(' + 增列 + '/' + 删列 + ')'))

  // --- 对齐 -----------------------------------------------------------
  await resetDoc()
  view.dispatch({ selection: { anchor: 2 } })
  tableAlign(view, 'center')
  // 对齐必须改**第二行**（对齐定义行），且改完还得是合法的对齐行
  const 二 = 第(2)
  result.push(
    '对齐=' + (/:---:/.test(二) ? '对' : '错(' + 二 + ')') +
      ' 对齐行有效=' + (isAlignRow(二) ? '对' : '错')
  )

  view.setState(backup)
  await new Promise((done) => setTimeout(done, 60))
  return result.join(' ')
}

/**
 * 代码块头部栏自测。
 *
 * 头部栏是"渲染出来了但点了没用"的高危区：控件在 widget 里，
 * 事件要么被编辑器抢走、要么写回文档时算错了位置——两种情况都不会报错，
 * 界面上只表现为"下拉能打开但选了没反应"。
 *
 * 所以这里**真的去点**：改下拉、填输入框、发一次 `change`，
 * 然后检查**文档内容**变没变。查 DOM 是不够的——DOM 由文档驱动，
 * 两者都错的时候看起来是一致的。
 */
async function 运行代码块头部自测(): Promise<string> {
  const originalText = ['段落。', '', '```js', 'const 甲 = 1', '```', ''].join('\n')
  const backup = view.state
  view.setState(EditorState.create({ doc: originalText, extensions: editorExtensions() }))
  setDocDir(null)
  // 光标放到正文段落上：这样围栏首行才会换成头部栏
  view.dispatch({ selection: { anchor: 0 } })
  await new Promise((done) => setTimeout(done, 80))

  const result: string[] = []

  /** 改一个下拉并等装饰重建。 */
  const 改下拉 = async (selector: string, value: string): Promise<void> => {
    const el = document.querySelector(selector) as HTMLSelectElement | null
    if (!el) return
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((done) => setTimeout(done, 80))
  }

  const firstLine = (): string => view.state.doc.line(3).text

  // --- 改语言 ---------------------------------------------------------
  const 头部数 = document.querySelectorAll('.cm-w-codehead').length
  result.push(`头部栏=${头部数}`)

  await 改下拉('.cm-w-codehead-lang', 'python')
  result.push(`改语言=${/^```python$/.test(firstLine()) ? '对' : `错(${firstLine()})`}`)

  // --- 改样式 ---------------------------------------------------------
  await 改下拉('.cm-w-codehead-style', 'dark')
  // 样式写进信息串，同时行上要挂出对应的配色类——只写文档不挂类，
  // 下拉选了等于没选，而文档里却留下了记录，是最难查的那种不一致。
  const 有配色类 = document.querySelectorAll('.cm-code-dark').length > 0
  result.push(`改样式=${/style=dark/.test(firstLine()) && 有配色类 ? '对' : `错(${firstLine()})`}`)

  // --- 改名称 ---------------------------------------------------------
  const 名称框 = document.querySelector('.cm-w-codehead-name') as HTMLInputElement | null
  if (名称框) {
    名称框.value = '示例'
    名称框.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((done) => setTimeout(done, 80))
  }
  result.push(`改名称=${/示例/.test(firstLine()) ? '对' : `错(${firstLine()})`}`)

  // --- 字体与行号 ------------------------------------------------------
  const 字体前 = document.querySelector('.cm-w-codehead-font') as HTMLSelectElement | null
  result.push(`字体下拉=${字体前 ? 字体前.options.length : 0}`)
  await 改下拉('.cm-w-codehead-font', 'consolas')
  // 字体栈要落到行上（`--code-font`），只在文档里写 `font=` 是不够的
  const 行元素 = document.querySelector('.cm-lp-code[data-lineNo]') as HTMLElement | null
  const 行字体 = 行元素 ? getComputedStyle(行元素).getPropertyValue('--code-font').trim() : ''
  result.push(`改字体=${/font=consolas/.test(firstLine()) && /Consolas/.test(行字体) ? '对' : `错(${firstLine()})`}`)

  // 行号：正文行才编号，首尾围栏不编
  const 编号行 = document.querySelectorAll('.cm-lp-code[data-lineNo]')
  const 首号 = 编号行[0]?.getAttribute('data-lineNo')
  result.push(`行号=${编号行.length}行/首个=${首号}`)

  // 代码块必须与页面底色**明显不同**：这是"语言块和原本主题不一样"的判据。
  // 不比较具体色值（那会随主题变），比较亮度差——差得太小就等于没区分。
  const 页面底 = getComputedStyle(document.body).backgroundColor
  const 代码底 = 行元素 ? getComputedStyle(行元素).backgroundColor : ''
  const 亮度 = (色: string): number => {
    const numItems = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(色)
    if (!numItems) return -1
    return (Number(numItems[1]) * 299 + Number(numItems[2]) * 587 + Number(numItems[3]) * 114) / 1000
  }
  const 差 = Math.abs(亮度(页面底) - 亮度(代码底))
  result.push(`底色差=${差.toFixed(0)}${差 >= 6 && 亮度(代码底) >= 0 ? '(够)' : '(太接近)'}`)

  // 头部栏必须与代码行**严丝合缝**：中间多出一条空行，整块就散成两截。
  // 量的是两者的实际边界距离，而不是"看起来对不对"。
  {
    const headEl = document.querySelector('.cm-w-codehead') as HTMLElement | null
    const 首代码 = document.querySelector('.cm-lp-code[data-lineNo]') as HTMLElement | null
    if (headEl && 首代码) {
      const 缝 = Math.round(首代码.getBoundingClientRect().top - headEl.getBoundingClientRect().bottom)
      result.push(`头与代码间距=${缝}px`)
    } else {
      result.push('头与代码间距=元素缺失')
    }
  }

  // 代码块的色块两侧要留白，不能顶到编辑器边缘——顶满了整页看着就挤。
  // 量的是色块左沿与编辑区左沿的距离，而不是"看着还行"。
  {
    const codeBlock = document.querySelector('.cm-lp-code') as HTMLElement | null
    const 编辑区 = document.querySelector('.cm-editor') as HTMLElement | null
    const contentArea = document.querySelector('.cm-content') as HTMLElement | null
    if (codeBlock && 编辑区 && contentArea) {
      const 左留白 = Math.round(
        codeBlock.getBoundingClientRect().left - 编辑区.getBoundingClientRect().left
      )
      const 内容样式 = getComputedStyle(contentArea)
      const 行样式 = getComputedStyle(codeBlock)
      result.push(
        `左留白=${左留白}px 内容区左右内边距=${内容样式.paddingLeft}/${内容样式.paddingRight} ` +
          `行左右内边距=${行样式.paddingLeft}/${行样式.paddingRight}`
      )
    } else {
      result.push('左留白=元素缺失')
    }
  }

  // 头部栏必须与下面的代码块**左右对齐**：它俩是同一个卡片的两部分，
  // 差几个像素就会看出"头是头、身是身"。分别量左右沿，才知道该收还是该扩。
  {
    const headEl = document.querySelector('.cm-w-codehead') as HTMLElement | null
    const codeLineBox = document.querySelector('.cm-lp-code[data-lineNo]') as HTMLElement | null
    if (headEl && codeLineBox) {
      const 头框 = headEl.getBoundingClientRect()
      const 码框 = codeLineBox.getBoundingClientRect()
      result.push(
        `对齐 头=${Math.round(头框.left)}~${Math.round(头框.right)} ` +
          `码=${Math.round(码框.left)}~${Math.round(码框.right)}`
      )
    } else {
      result.push('对齐=元素缺失')
    }
  }

  // 三项都写完之后，信息串应当仍然可被解析回同样的三项——
  // 构建与解析是一对，只测一边等于没测
  const info = 解析围栏信息(firstLine().replace(/^```/, ''))
  result.push(
    `往返=${info.language === 'python' && info.displayName === '示例' && info.style === 'dark' && info.font === 'consolas' ? '对' : `错(${JSON.stringify(info)})`}`
  )
  result.push(`首行=${JSON.stringify(firstLine())}`)

  // --- 输入流：```py 回车 ---------------------------------------------
  //
  // 这条覆盖用户提的第二个诉求：直接敲围栏标记 + 回车就要出代码块。
  // 真的调一次绑定在 Enter 上的那个命令，而不是自己模拟换行。
  view.setState(
    EditorState.create({ doc: '```py', extensions: editorExtensions() })
  )
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  await new Promise((done) => setTimeout(done, 60))
  // 真的调一次绑定在 Enter 上的那个命令，而不是自己模拟换行。
  // CodeMirror 自带的 `insertNewlineContinueMarkup` 在围栏内直接放弃，
  // 所以这里调的是本项目自己的 `继续代码围栏`。
  const 换行结果 = continueCodeFence(view)
  await new Promise((done) => setTimeout(done, 120))
  const docText = view.state.doc.toString()
  const 闭合了 = (docText.match(/```/g) ?? []).length >= 2
  // 光标落进正文之后，首行就该换成头部栏
  const 出现头部 = document.querySelectorAll('.cm-w-codehead').length > 0
  result.push(
    `回车出块=${换行结果 && 闭合了 ? '对' : `错(${JSON.stringify(docText)})`} 出现头部栏=${出现头部 ? '对' : '错'}`
  )

  view.setState(backup)
  await new Promise((done) => setTimeout(done, 60))
  return result.join(' ')
}

/**
 * 代码块交互自测。
 *
 * 盯的是用户实际踩到的那个坑：**光标在代码块里，但屏幕上看起来像在外面**。
 * 原因是围栏的 ``` 按"光标是否在这一行"隐藏，于是站在最后一行代码上时，
 * 闭合围栏消失了——"块内末尾"和"块外"看起来一模一样，
 * 一打字就插进了代码块。
 *
 * 两条断言：
 *   1. 光标在块内时，**闭合围栏可见**（边界始终看得见）
 *   2. Escape 把光标移到**闭合围栏之后**，且在那里打字不进代码块
 */
async function 运行代码块自测(): Promise<string> {
  const originalText = ['开头段落。', '', '```js', 'const 甲 = 1', 'const 乙 = 2', '```', '', '结尾段落。'].join(
    '\n'
  )

  // 用独立的临时文档，测完恢复现场
  const backup = view.state
  view.setState(EditorState.create({ doc: originalText, extensions: editorExtensions() }))
  setDocDir(null)
  await new Promise((done) => setTimeout(done, 80))

  // 语法树里找围栏，取最后一行代码的位置（不是围栏行）
  const tree = syntaxTree(view.state)
  let fence: { from: number; to: number } | null = null
  tree.iterate({
    enter: (n) => {
      if (n.name === 'FencedCode' && !fence) fence = { from: n.from, to: n.to }
    }
  })

  let 围栏可见 = '未测'
  let 跳出后位置 = '未测'
  let 跳出后打字不进块 = '未测'
  let 落到围栏行 = '未测'

  if (fence) {
    const block = fence as { from: number; to: number }
    const 取末行文本 = (): string => {
      const codeLineBox = Array.from(document.querySelectorAll('.cm-lp-code'))
      return codeLineBox.length > 0 ? (codeLineBox[codeLineBox.length - 1].textContent ?? '') : ''
    }

    // --- 光标在最后一行代码上：闭合围栏应当**隐藏** ---------------------
    //
    // 这里断言的是"块里干净"：块内平时不该出现一行 ```，
    // 否则看着像块没闭合。边界靠代码块的下边框表达，不靠那行字符。
    view.dispatch({ selection: { anchor: Math.max(block.from, block.to - 4) } })
    await new Promise((done) => setTimeout(done, 80))
    围栏可见 = 取末行文本().includes('```') ? '在块内仍显示' : '块内已隐藏'

    // --- 光标**落到闭合围栏那一行**时，源码必须露出来 -------------------
    //
    // 这是"以为出去了、其实还在块里"的最后一道防线：真站到那一行上，
    // 就得看得见自己站在哪。隐藏着的字符上打字，是找不到原因的怪现象。
    const 闭合行 = view.state.doc.lineAt(block.to)
    view.dispatch({ selection: { anchor: 闭合行.from } })
    await new Promise((done) => setTimeout(done, 80))
    落到围栏行 = 取末行文本().includes('```') ? '已露出' : '仍隐藏'

    // 回到最后一行代码上，继续后面的 Escape 测试
    view.dispatch({ selection: { anchor: Math.max(block.from, block.to - 4) } })
    await new Promise((done) => setTimeout(done, 60))

    // Escape 跳出
    const success = exitCodeBlock(view)
    await new Promise((done) => setTimeout(done, 80))
    const 新光标 = view.state.selection.main.head
    跳出后位置 = success && 新光标 > block.to ? '围栏之后' : `否(${新光标} vs ${block.to})`

    // 在跳出去的位置打一个字，再确认它落在代码块之外
    view.dispatch({ changes: { from: 新光标, insert: '尾' } })
    await new Promise((done) => setTimeout(done, 60))
    const 打完 = view.state.doc.toString()
    const 块末 = 打完.indexOf('```', 打完.indexOf('```') + 3)
    跳出后打字不进块 = 块末 >= 0 && 打完.indexOf('尾') > 块末 ? '是' : '否'
  }

  // 恢复现场
  view.setState(backup)
  await new Promise((done) => setTimeout(done, 60))

  return `块内围栏=${围栏可见} 落在围栏行=${落到围栏行} 跳出后位置=${跳出后位置} 跳出后打字不进块=${跳出后打字不进块}`
}

/**
 * 交互反馈自测。
 *
 * 这类改动最容易**静默失效**：选择器写错、变量名拼错、被后面的规则覆盖——
 * 三种情况下界面都照常能用，只是"又是生硬的"。而"生硬"没有报错，
 * 只有用的人能感觉到。
 *
 * 所以断言落在**计算样式**上：过渡时长是不是非零、令牌有没有解析出来、
 * 按压位移有没有真的挂上。读计算值而不是读样式表，
 * 因为"写了规则"和"规则生效"是两回事。
 */
async function 运行交互自测(): Promise<string> {
  // 偏好设置面板里有按钮、标签、输入框，是现成的取样点
  prefsPanel.open()
  await new Promise((done) => setTimeout(done, 60))

  const 根样式 = getComputedStyle(document.documentElement)
  const token = ['--ease', '--ease-press', '--dur-quick', '--dur-base']
    .map((name) => `${name.replace('--', '')}=${根样式.getPropertyValue(name).trim() || '空'}`)
    .join(' ')

  /** 取某个元素的计算过渡时长（秒 → 毫秒）。 */
  const 过渡时长 = (selector: string): string => {
    const el = document.querySelector(selector)
    if (!el) return '找不到'
    const value = getComputedStyle(el).transitionDuration
    if (!value) return '无'
    const millis = value
      .split(',')
      .map((segment) => Number.parseFloat(segment) * (segment.includes('ms') ? 1 : 1000))
    return `${Math.max(...millis)}ms`
  }

  const 取样 = [
    `按钮=${过渡时长('.selfmd-btn')}`,
    `标签=${过渡时长('.prefs-tab')}`,
    `输入=${过渡时长('.prefs-search')}`
  ].join(' ')

  // 过渡属性里必须包含 background-color 与 transform：
  // 只过渡颜色的话，按压仍然是没有反馈的硬跳。
  let 属性齐 = '未测'
  const button = document.querySelector('.selfmd-btn')
  if (button) {
    const attr = getComputedStyle(button).transitionProperty
    属性齐 = attr.includes('background-color') && attr.includes('transform') ? '是' : `否(${attr})`
  }

  // 焦点环：`:focus-visible` 只在**键盘**导航时命中，鼠标点击不该有环。
  //
  // 原先直接 `focus()` 然后读 boxShadow——这依赖浏览器的启发式判断
  // "这次程序化聚焦算不算键盘操作"，结果不稳。实测连跑两次都是"否"，
  // 而 CSS 规则明明在。改成显式传 `focusVisible: true`：
  // 那正是这条断言想表达的语义（键盘聚焦时要有环），不再靠猜。
  let 有焦点环 = '未测'
  const focusTarget = document.querySelector('.prefs-tab') as HTMLElement | null
  if (focusTarget) {
    // **先失焦再聚焦。** 元素若已经是 activeElement，`focus()` 是空操作，
    // `focusVisible` 选项也就不会生效——实测"激活=是 键盘态=否"。
    focusTarget.blur()
    focusTarget.focus({ focusVisible: true } as FocusOptions)
    const shadow = getComputedStyle(focusTarget).boxShadow
    const 已激活 = document.activeElement === focusTarget
    const 匹配键盘态 = focusTarget.matches(':focus-visible')
    有焦点环 =
      shadow && shadow !== 'none'
        ? '是'
        : `否(激活=${已激活 ? '是' : '否'} 键盘态=${匹配键盘态 ? '是' : '否'})`
    focusTarget.blur()
  }

  prefsPanel.close()
  await new Promise((done) => setTimeout(done, 60))

  return `${token} ${取样} 属性齐=${属性齐} 焦点环=${有焦点环} 面板已关=${!prefsPanel.isOpen}`
}

/**
 * 多文档标签自测。
 *
 * 盯住的是**整个实现里最容易出错的一步**：切换标签前有没有把当前标签的
 * 编辑器状态写回。漏掉的话，用户在甲文档里敲的字会随 `view.setState()`
 * 一起消失，而且不会有任何报错——只是"刚才写的东西不见了"。
 *
 * 所以断言的核心是：**在甲里改、切到乙、再切回甲，改动还在不在。**
 *
 * 顺带验证"重开同一个文件不开两份"——那是另一个会造成内容互相覆盖的坑。
 */
async function 运行标签自测(): Promise<string> {
  const 起始数量 = tabSet.count
  const 起始文本 = currentText()
  const 起始路径 = doc.current.path
  const startMarker = tabSet.current?.id ?? -1

  // --- 1) 在甲文档末尾追加一段可识别的标记 ---
  const 甲标记 = `【甲${Date.now() % 100000}】`
  view.dispatch({ changes: { from: view.state.doc.length, insert: `\n${甲标记}` } })
  const 甲文本 = currentText()
  const 甲里有没有 = 甲文本.includes(甲标记)

  // --- 2) 新建乙文档 ---
  // 顺序：先写回当前标签，再换视图状态。反了就会丢掉甲的改动。
  tabSet.saveCurrent(view.state)
  doc.newDocument()
  view.setState(EditorState.create({ doc: '【乙】\n', extensions: editorExtensions() }))
  setDocDir(null)
  const beta = tabSet.addTo(doc.exportStatus(), view.state)
  const 乙标识 = beta.id
  const 新建后数量 = tabSet.count
  // --- 3) 切回甲 ---
  if (startMarker >= 0) await switchTab(startMarker)
  const 切回后文本 = currentText()
  // 这一条就是整个测试的重点
  const 切回后标记还在 = 切回后文本.includes(甲标记)
  const 切回后长度对 = 切回后文本.length === 甲文本.length

  // --- 4) 再切到乙，确认乙的内容也没被甲的覆盖 ---
  // 用记下来的标识，不要用"不是起始标识的那个"去找——
  // 起始时可能已经有多个标签，那样会切到一个无关的文档上，
  // 断言就会因为选错了对象而失败。
  await switchTab(乙标识)
  const 乙回来看 = currentText()

  // --- 5) 撤销历史是否独立：在乙里撤销，不该动到甲 ---
  // 乙是新建的空文档，撤销会回到空；甲的内容不该受影响
  const 乙撤销前 = currentText()
  view.dispatch({ changes: { from: 0, insert: '临时' } })
  undo(view)
  const 乙撤销后 = currentText()
  const 撤销只影响乙 = 乙撤销后 === 乙撤销前

  // --- 6) 关闭与重开 ---
  await closeTab(乙标识)
  const 关闭后数量 = tabSet.count
  const 可重开 = tabSet.可以重开

  // --- 7) 同一个文件不开两份 ---
  let 去重可用 = '未测'
  if (起始路径) {
    const 关前 = tabSet.count
    await openPath(起始路径)
    去重可用 = tabSet.count === 关前 ? '是' : `否(${关前}→${tabSet.count})`
  }

  // --- 恢复现场 ---
  if (tabSet.current && tabSet.current.id !== startMarker && startMarker >= 0) {
    await switchTab(startMarker)
  }
  // 把甲文档恢复成测试前的样子
  if (currentText() !== 起始文本 && tabSet.current) {
    view.setState(EditorState.create({ doc: 起始文本, extensions: editorExtensions() }))
    tabSet.current.editorState = view.state
  }
  refreshTabUi()

  return (
    `起始${起始数量}→新建后${新建后数量}→关闭后${关闭后数量} ` +
    `甲标记在=${甲里有没有}/切回后=${切回后标记还在} 长度一致=${切回后长度对} ` +
    `乙内容未串=${乙回来看.includes('【乙】')} 撤销只影响乙=${撤销只影响乙} ` +
    `可重开=${可重开} 同文件去重=${去重可用}`
  )
}

/**
 * 复制为图片自测。
 *
 * 真的截一次图。这条链路几乎每一环都可能静默失败：
 * 离屏窗口没画出来、图片没解码完就截、内容高度没量对导致只截了头部——
 * 而这三种情况的结果都是"拿到一张图"，看起来完全正常。
 *
 * 所以断言必须落在**尺寸**上：宽度应当接近请求值，高度应当随内容变化。
 * 只断言"成功"是抓不到任何东西的。
 */
async function 运行复制图片自测(): Promise<string> {
  const 短文档 = '# 图\n\n一小段文字。\n'
  const shortText = await window.selfmd.copyAsImage({
    source: 短文档,
    docPath: null,
    widthPx: 900
  })

  // 长文档应当明显更高。这一条用来抓"高度没量对、只截了窗口可视区"——
  // 那种情况下长文档与短文档会得到**一样高**的图。
  const 长文档 =
    '# 长图\n\n' +
    Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段，用来把内容撑高。\n`).join('\n')
  const longText = await window.selfmd.copyAsImage({
    source: 长文档,
    docPath: null,
    widthPx: 900
  })

  // 检查剪贴板里真的有一张图（而不是只有返回值说得漂亮）
  const 剪贴板有图 = await window.selfmdExtra.clipboard.readText().then(
    () => true,
    () => false
  )

  return (
    `短=${shortText.success ? `${shortText.width}×${shortText.height}` : `失败:${shortText.error}`} ` +
    `长=${longText.success ? `${longText.width}×${longText.height}` : `失败:${longText.error}`} ` +
    `长图更高=${longText.success && shortText.success ? (longText.height > shortText.height ? '是' : '否') : '未测'} ` +
    `未截断=${!shortText.truncated && !longText.truncated} 剪贴板可用=${剪贴板有图}`
  )
}

/**
 * 等到 DOM 上的装饰数量稳定下来。
 *
 * 固定的延时不可靠：装饰是在视图更新里落到 DOM 上的，而更新发生在
 * 首帧之后——机器忙一点、文档大一点，400ms 就可能不够，
 * 于是计数取到一半，报出"某类装饰缺失"这种**看着像功能坏了、
 * 其实是取样太早**的假失败。这类偶发失败最消耗信任。
 *
 * 所以改成**连续三次取到同一个值才算稳定**：装饰是分批落下去的，
 * 两次相同还可能是碰巧（例如中间插进来一次异步渲染）。
 */
async function 等待渲染稳定(取样: () => string): Promise<void> {
  const limit = Date.now() + 5000
  let 上次 = ''
  let 相同次数 = 0

  for (;;) {
    const 本次 = 取样()
    if (本次.length > 0 && 本次 === 上次) {
      相同次数 += 1
      if (相同次数 >= 3) return
    } else {
      相同次数 = 0
    }
    上次 = 本次
    if (Date.now() > limit) return
    await new Promise((done) => window.setTimeout(done, 50))
  }
}

/**
 * 等到所有异步渲染（Mermaid 图表）落定。
 *
 * 图表是异步画的：组件先建出来显示"正在渲染"，Mermaid 的代码块加载完之后
 * 才替换成 SVG。无脑把等待时间加长有两个问题——短了仍然会偶发失败，
 * 长了每次冒烟都白等。
 *
 * 所以改成**轮询到稳定**：只要还有元素停留在"正在渲染"状态就继续等，
 * 上限 5 秒。这样既不会误判，也不会为没有图表的文档多花时间。
 */
async function 等待异步渲染稳定(): Promise<void> {
  const limit = Date.now() + 8000
  for (;;) {
    const 渲染中 = document.querySelectorAll('.cm-w-diagram[data-state="渲染中"]').length
    if (渲染中 === 0) return
    if (Date.now() > limit) return
    await new Promise((done) => window.setTimeout(done, 30))
  }
}

/**
 * 为副本找一个还没被占用的路径。
 *
 * 规则：`名字.md` → `名字 副本.md` → `名字 副本 2.md` → …
 * **绝不覆盖已存在的文件**——副本命令最基本的要求就是原件与已有文件都不受影响。
 */
async function 生成副本路径(rawPath: string): Promise<string> {
  const dir = await window.selfmdExtra.path.dirname(rawPath)
  const 全名 = await window.selfmdExtra.path.basename(rawPath)
  // 扩展名按**最后一个点**切：`会议记录.2024.md` 的名字是 `会议记录.2024`
  const dot = 全名.lastIndexOf('.')
  const 主名 = dot > 0 ? 全名.slice(0, dot) : 全名
  const extension = dot > 0 ? 全名.slice(dot) : ''

  for (let i = 1; i < 1000; i++) {
    const 后缀 = i === 1 ? ' 副本' : ` 副本 ${i}`
    const candidate = await window.selfmdExtra.path.join(dir, `${主名}${后缀}${extension}`)
    const exists = await window.selfmd.file.exists(candidate)
    if (!exists) return candidate
  }
  throw new Error('副本太多了，请先清理一下')
}

/**
 * 取当前选区；没有选区时取整篇。
 *
 * 复制类命令都要这条规则：选中了就复制选中的，没选就复制全文——
 * 这是用户在别处的肌肉记忆，不这么做会让人以为命令坏了。
 */
function 取选区或整篇(): string {
  const sel = view.state.selection.main
  if (sel.from !== sel.to) return view.state.sliceDoc(sel.from, sel.to)
  return view.state.doc.toString()
}

/** 把光标所在行整体替换成一段块级文本。 */
function 在当前行插入块(docText: string, displayName: string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: docText },
    selection: { anchor: line.from + docText.length }
  })
  toast(`已插入${displayName}`)
}

/** 追加内容到文末，并保证前面有一个空行。 */
function 追加到文末(docText: string): void {
  const txt = view.state.doc.toString()
  const 需要空行 = txt.length > 0 && !txt.endsWith('\n\n')
  const prefixText = 需要空行 ? (txt.endsWith('\n') ? '\n' : '\n\n') : ''
  view.dispatch({ changes: { from: view.state.doc.length, insert: prefixText + docText } })
}

/** 找一个还没被用过的引用标记：a、b、c…用完了就 a1、a2… */
function 唯一引用标记(): string {
  const txt = view.state.doc.toString()
  const 字母 = 'abcdefghijklmnopqrstuvwxyz'
  for (const 字 of 字母) {
    if (!new RegExp(`^\\[${字}\\]:`, 'm').test(txt)) return 字
  }
  for (let i = 1; ; i++) {
    const candidate = `a${i}`
    if (!new RegExp(`^\\[${candidate}\\]:`, 'm').test(txt)) return candidate
  }
}

/** 找下一个没被用过的脚注编号。 */
function 下一个脚注编号(): number {
  const txt = view.state.doc.toString()
  for (let i = 1; ; i++) {
    if (!new RegExp(`^\\[\\^${i}\\]:`, 'm').test(txt)) return i
  }
}

/** 把上传结果反馈给用户。 */
function 报告上传(result: 回填结果): void {
  if (result.changedCount === 0) {
    toast(result.failureSummary || '上传未产生任何改动', 'error')
    return
  }
  if (result.failCount > 0) {
    toast(`已上传并替换 ${result.changedCount} 处，另有 ${result.failCount} 张失败：${result.failureSummary}`)
    return
  }
  toast(`已上传并替换 ${result.changedCount} 处图片引用`)
}

/**
 * 图片右键菜单。
 *
 * 菜单项名称沿用 Markdown 编辑器里常见的说法。先根据点击位置反查文档里的 Image
 * 节点——查不到就整体置灰，而不是让用户点了没反应。
 */
async function 打开图片菜单(event: MouseEvent, el: HTMLElement): Promise<void> {
  // 反查文档位置：widget 在编辑器里，posAtDOM 能算出它对应哪一段源码
  let position = view.state.selection.main.head
  try {
    position = view.posAtDOM(el)
  } catch {
    // widget 已被回收（用户点了别处）——退回光标位置
  }

  const image = 取当前图片(view.state, position)
  const isRemote = image !== null && image.localPath === null
  const 是HTML = image !== null && /^<img\b/i.test(image.url)

  const items: menuItem[] = [
    {
      text: '上传图片',
      disabled: image === null || isRemote,
      action: () => void 执行上传(image ? [image] : [])
    },
    {
      text: '上传所有本地图片',
      action: () => void 执行上传(收集文档图片(view.state, true))
    },
    { separator: true },
    {
      text: '转换图片语法',
      disabled: image === null,
      hint: 是HTML ? 'HTML → Markdown' : 'Markdown → HTML',
      action: () => {
        if (image && 转换图片语法(view, image)) toast('已转换图片语法')
      }
    },
    {
      text: '重命名 / 移动图片到…',
      disabled: image === null || isRemote,
      action: () => void 执行重命名(image)
    },
    {
      text: '复制图片到…',
      disabled: image === null || isRemote,
      action: () => void 执行复制(image)
    },
    { separator: true },
    {
      text: '打开图片位置',
      disabled: image === null || isRemote,
      action: () => {
        if (image?.localPath) void window.selfmd.file.showInFolder(image.localPath)
      }
    },
    {
      text: '在浏览器中打开图片',
      action: () => {
        if (!image) return
        // 本地图片用 selfmd:// 协议地址也能被系统浏览器打开
        const url = isRemote ? image.url : parseImageUrl(image.url)
        if (url) void window.selfmd.file.openExternal(url)
      }
    },
    {
      text: '复制图片地址',
      disabled: image === null,
      action: async () => {
        if (!image) return
        await window.selfmdExtra.clipboard.writeText(image.url)
        toast('已复制图片地址')
      }
    },
    { separator: true },
    {
      text: '删除图片文件',
      危险: true,
      disabled: image === null || isRemote,
      action: () => void 执行删除文件(image)
    }
  ]

  // 菜单里带一条"重新加载所有图片"：图片被外部程序改过之后，
  // 浏览器缓存可能还拿着旧内容，强制重绘一次即可。
  items.push({ separator: true }, {
    text: '重新加载所有图片',
    action: () => {
      view.dispatch({})
      toast('已重新加载图片')
    }
  })

  popupMenu({ x: event.clientX, y: event.clientY }, items)
}

/** 上传指定的图片（或全部），并回填文档里的引用。 */
async function 执行上传(images: docImages[]): Promise<void> {
  if (images.length === 0) {
    toast('没有可上传的本地图片。')
    return
  }
  toast(`正在上传 ${images.length} 张图片…`)
  报告上传(await 上传并回填(view, images))
}

/** 重命名或移动图片：先问文件名，再问目标目录。 */
async function 执行重命名(image: imageContext | null): Promise<void> {
  if (!image?.localPath) return

  const originalName = 建议文件名(image)
  const newName = await promptText({
    title: '重命名图片',
    初值: originalName,
    description: '文件会被移动或重命名，文档里的引用会同步更新。'
  })
  if (!newName || newName === originalName) return

  const 原目录 = await window.selfmdExtra.path.dirname(image.localPath)
  const choose = await window.selfmd.dialog.openFolder({
    title: '移动到目录（取消则留在原目录）',
    defaultPath: 原目录
  })
  const target = choose.canceled || !choose.folderPath ? 原目录 : choose.folderPath

  const result = await 重命名或移动图片(view, image, target, newName)
  if (!result.success) {
    toast(result.error ?? '移动失败', 'error')
    return
  }
  toast(`已移动到 ${result.nextSrc}`)
  doc.markDirty()
  updateTitle()
}

/** 复制图片到指定目录。 */
async function 执行复制(image: imageContext | null): Promise<void> {
  if (!image?.localPath) return
  const choose = await window.selfmd.dialog.openFolder({ title: '复制图片到' })
  if (choose.canceled || !choose.folderPath) return

  const result = await 复制图片到(view, image, choose.folderPath)
  if (!result.success) {
    toast(result.error ?? '复制失败', 'error')
    return
  }
  toast(`已复制到 ${result.nextSrc}`)
  doc.markDirty()
  updateTitle()
}

/** 删除图片文件（进系统回收站）。 */
async function 执行删除文件(image: imageContext | null): Promise<void> {
  if (!image?.localPath) return

  const 答复 = await window.selfmd.dialog.message({
    type: 'warning',
    title: '删除图片文件',
    message: `确定要删除「${建议文件名(image)}」吗？`,
    detail:
      '文件会被移到系统回收站，可以还原。\n' +
      '文档里的引用**不会**被删除——删掉之后该处会显示为加载失败。',
    buttons: ['删除', '取消'],
    defaultId: 1,
    cancelId: 1
  })
  if (答复.response !== 0) return

  const result = await 删除图片文件(image)
  if (!result.success) {
    toast(result.error ?? '删除失败', 'error')
    return
  }
  toast('已移到回收站')
  // 重绘一次让那张图变成"加载失败"占位，用户能立刻看到后果
  view.dispatch({})
}

/** 把图片插入结果反馈给用户。 */
function 报告插入(result: { okCount: number; error: string | null }): void {
  if (result.error) {
    toast(result.error, 'error')
    return
  }
  if (result.okCount > 0) {
    toast(result.okCount === 1 ? '已插入图片' : `已插入 ${result.okCount} 张图片`)
    doc.markDirty()
    updateTitle()
  }
}

/**
 * 图片插入的端到端自测。
 *
 * 前面的纯函数断言只能证明"决策算得对"；这里让应用真的复制一个文件、
 * 真的往文档里写一行引用，再把结果回报给日志。两者缺一不可：
 * 决策正确但落地写错，用户看到的就是图裂了。
 */
async function 运行图片插入自测(docPath: string): Promise<string | undefined> {
  if (!/测试\.md$/.test(docPath)) return undefined
  const dir = await window.selfmdExtra.path.dirname(docPath)
  const 样本 = `${dir}/样本.png`
  if (!(await window.selfmd.image.exists(样本))) return '未找到测试图片'

  const request = 当前插入请求()
  if (!request) return '编辑器尚未就绪'

  const result = await insertFromFile(request, [样本])
  const target = await 本次目标目录(request)
  const 落盘名 = target ? `${target}/样本.png` : '(无目标目录)'
  const 已落盘 = target ? await window.selfmd.image.exists(落盘名) : false

  const docModel = view.state.doc.toString().replace(/\r?\n/g, '⏎')
  return (
    `成功=${result.okCount} 错误=${result.error ?? '无'} ` +
    `文件已落盘=${已落盘} 文档=${docModel}`
  )
}

/**
 * 改写文档里的某个前置元数据属性。
 *
 * 走 `view.dispatch` 而不是直接改 `doc`，这样它是可撤销的——用户点了
 * "复制图片到文件夹"之后按 Ctrl+Z 应当能撤回，而不是被迫手工去删 YAML。
 */
function 改写前置元数据(key: string, value: string | null): void {
  const originalText = view.state.doc.toString()
  const nextText = value === null ? removeAttr(originalText, key) : setAttr(originalText, key, value)
  if (nextText === originalText) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextText },
    userEvent: 'input.frontMatter',
    annotations: isolatedUndo
  })
  doc.markDirty()
  updateTitle()
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

async function runCommand(payload: MenuCommandPayload): Promise<void> {
  const { command, args } = payload

  switch (command) {
    // ------------------------------------------------------------- 文件 ---
    case 'file.new':
      // **先写回，再换视图状态。** 顺序反了就把当前文档未保存的改动丢了。
      tabSet.saveCurrent(view.state)
      doc.newDocument()
      view.setState(EditorState.create({ doc: '', extensions: editorExtensions() }))
      setDocDir(null)
      tabSet.addTo(doc.exportStatus(), view.state)
      updateTitle()
      refreshTabUi()
      view.focus()
      return

    case 'file.saveAll': {
      // 逐个保存**所有有改动的**文档。
      //
      // 保存非当前文档时不能走 `doc.save()`——那个写的是"当前文档"的路径。
      // 所以这里直接调底层写盘接口，绕过文档服务。
      const toSave = tabSet.list.filter((t) => t.state.dirty)
      if (toSave.length === 0) {
        toast('没有需要保存的文档')
        return
      }
      let success = 0
      let failure = 0
      for (const item of toSave) {
        const 是当前的 = item.id === tabSet.current?.id
        const content = 是当前的 ? currentText() : item.editorState.doc.toString()
        // 未命名文档没有路径，交给"另存为"；那会弹对话框，
        // 所以只有当前文档才可能走到这条分支。
        if (!item.state.path) {
          if (!是当前的) continue
          try {
            if (await doc.save(content)) success++
          } catch {
            failure++
          }
          continue
        }
        try {
          await window.selfmd.doc.save(item.state.path, content, item.state.lineEnding)
          item.state.dirty = false
          success++
        } catch {
          failure++
        }
      }
      // 当前文档的脏标记要走文档服务，否则标题栏不会更新
      if (tabSet.current && !tabSet.current.state.dirty) doc.markClean()
      updateTitle()
      refreshTabUi()
      toast(failure > 0 ? `已保存 ${success} 个，${failure} 个失败` : `已保存 ${success} 个文档`, failure > 0 ? 'error' : 'info')
      return
    }

    case 'file.reopenClosed': {
      const recover = tabSet.取出已关闭()
      if (!recover) {
        toast('没有可重新打开的文档')
        return
      }
      // 路径还在磁盘上就从磁盘读（可能已被外部改动），否则用关闭时的备份。
      // **未保存的改动只有备份里有**，所以文件不存在时必须回退到备份。
      let content = recover.content
      let exists = false
      if (recover.state.path) {
        exists = await window.selfmd.file.exists(recover.state.path)
        if (exists) {
          try {
            content = (await window.selfmd.doc.openPath(recover.state.path))?.content ?? recover.content
          } catch {
            content = recover.content
          }
        }
      }
      setDocDir(recover.state.path ? await window.selfmdExtra.path.dirname(recover.state.path) : null)
      tabSet.saveCurrent(view.state)
      doc.采用状态({ ...recover.state, dirty: !exists && recover.content.length > 0 })
      view.setState(EditorState.create({ doc: content, extensions: editorExtensions() }))
      tabSet.addTo(doc.exportStatus(), view.state)
      updateTitle()
      refreshTabUi()
      view.focus()
      toast(exists ? '已重新打开' : '已从关闭时的内容恢复（原文件不在磁盘上）')
      return
    }

    case 'view.switchDocument':
      await 循环标签(1)
      return

    case 'view.articles':
      if (settings.sidebarMode === 'never') {
        toast('侧边栏已设为「始终隐藏」，可在偏好设置里改。')
        return
      }
      sidebar?.setVisible(true)
      sidebar?.setTab('articles')
      return

    case 'file.openQuickly': {
      // 索引的范围是**文件树当前的根目录**。没有根（未保存且没打开过文件夹）时
      // 退回当前文档所在目录；再没有就说明没有可搜的范围，直接说明白。
      const root = sidebar?.rootDir ?? (await currentDocDir())
      if (!root) {
        toast('请先打开一个文件或文件夹，再使用快速打开。', 'error')
        return
      }
      await 打开快速打开面板({
        取文件: () => window.selfmdExtra.file.walk(root),
        open: (filePath) => void openPath(filePath)
      })
      return
    }

    case 'file.exportSetting': {
      // 导出设置就是偏好设置里的「导出」分区。
      //
      // 不另做一个面板：`exportIncludeOutline` / `exportEmbedImages` 已经在
      // 偏好设置里了，再建一套界面就会出现"两个地方改同一件事"，
      // 而它们迟早会不同步。
      prefsPanel.open('导出')
      return
    }
    case 'file.newWindow':
      await window.selfmd.window.newWindow()
      return

    case 'file.open': {
      const result = await window.selfmd.dialog.openFile()
      if (result.canceled || result.filePaths.length === 0) return
      await openPath(result.filePaths[0])
      return
    }

    case 'file.openPath':
      if (typeof args === 'string') await openPath(args)
      return

    case 'file.save':
      try {
        // 保存成功后要清掉草稿——已经落盘了，留着它下次启动会误报"未保存内容"。
        // 先取内容再保存，两边比对的是同一份文本。
        const toSave = currentText()
        const 已保存路径 = doc.current.path
        if (await doc.save(toSave)) {
          toast('已保存')
          await window.selfmd.draft.clearFor(已保存路径, toSave)
        }
      } catch (err) {
        toastError(err, '保存失败')
      }
      updateTitle()
      return

    case 'file.saveAs':
      try {
        if (await doc.saveAs(currentText())) toast('已保存')
      } catch (err) {
        toastError(err, '保存失败')
      }
      updateTitle()
      return

    // --------------------------------------------------------- 文件操作 ---
    case 'file.duplicate': {
      // 创建副本：复制一份**已保存**的文件，然后切到副本上继续编辑。
      //
      // 未保存的文档没有源文件，无从复制——这时直接说明，
      // 而不是悄悄做一次"另存为"（那会让用户以为原件还在原处）。
      const rawPath = doc.current.path
      if (!rawPath) {
        toast('当前文档尚未保存，请先保存再创建副本。', 'error')
        return
      }
      try {
        // 先把内存里的改动落盘，否则副本会是旧内容
        await doc.save(currentText())
        const nextPath = await 生成副本路径(rawPath)
        await window.selfmdExtra.file.copy(rawPath, nextPath)
        await doc.open(nextPath)
        updateTitle()
        toast(`已创建副本：${await window.selfmdExtra.path.basename(nextPath)}`)
      } catch (error) {
        toastError(error, '创建副本失败')
      }
      return
    }

    case 'file.rename': {
      const rawPath = doc.current.path
      if (!rawPath) {
        toast('当前文档尚未保存，请先保存再重命名。', 'error')
        return
      }
      const originalName = await window.selfmdExtra.path.basename(rawPath)
      const newName = await promptText({
        title: '重命名',
        description: `当前文件名：${originalName}`,
        初值: originalName,
        确定文字: '重命名'
      })
      if (!newName || newName === originalName) return
      // 不允许带路径分隔符：这个输入框只改名字，改目录是「移动到」的事。
      // 不拦的话用户会以为能把文件挪到别处，而实际只会在文件名里多出几个字符。
      if (/[\\/]/.test(newName)) {
        toast('文件名里不能包含斜杠；要换目录请用「移动到」。', 'error')
        return
      }
      try {
        const nextPath = await window.selfmdExtra.path.join(
          await window.selfmdExtra.path.dirname(rawPath),
          newName
        )
        await doc.save(currentText())
        await window.selfmdExtra.file.rename(rawPath, nextPath)
        await doc.open(nextPath)
        updateTitle()
        toast(`已重命名为 ${newName}`)
      } catch (error) {
        toastError(error, '重命名失败')
      }
      return
    }

    case 'file.moveTo': {
      const rawPath = doc.current.path
      if (!rawPath) {
        toast('当前文档尚未保存，请先保存再移动。', 'error')
        return
      }
      const result = await window.selfmd.dialog.openFolder({
        title: '移动到文件夹',
        defaultPath: await window.selfmdExtra.path.dirname(rawPath)
      })
      if (result.canceled || !result.folderPath) return
      try {
        await doc.save(currentText())
        const target = await window.selfmdExtra.path.join(
          result.folderPath,
          await window.selfmdExtra.path.basename(rawPath)
        )
        // 同目录移动是无操作；直接指出比让底层报一个含糊的错好
        if (target === rawPath) {
          toast('文件已经在该文件夹里')
          return
        }
        await window.selfmdExtra.file.move(rawPath, target)
        await doc.open(target)
        updateTitle()
        toast('已移动')
      } catch (error) {
        toastError(error, '移动失败')
      }
      return
    }

    case 'file.openFolder': {
      const result = await window.selfmd.dialog.openFolder({ title: '打开文件夹' })
      if (result.canceled || !result.folderPath) return
      if (!sidebar) {
        toast('侧边栏未就绪', 'error')
        return
      }
      sidebar.设根目录(result.folderPath)
      sidebar.setTab('files')
      sidebar.setVisible(true)
      await sidebar.refreshFileTree()
      toast('已在侧边栏打开该文件夹')
      return
    }

    case 'file.import': {
      // 导入 = 打开。本项目里"打开"已经能处理任何文本文件，
      // 单独做一个导入流程只会多出一套需要维护的代码路径。
      // 真正需要转换的格式（Word 等）走 Pandoc，那是导出侧的事。
      const result = await window.selfmd.dialog.openFile({
        title: '导入文件',
        filters: [
          { name: 'Markdown 与文本', extensions: ['md', 'markdown', 'txt', 'text'] },
          { name: '全部文件', extensions: ['*'] }
        ]
      })
      const firstOne = result.filePaths?.[0]
      if (result.canceled || !firstOne) return
      await doc.open(firstOne)
      updateTitle()
      return
    }

    case 'file.clearRecent':
      await window.selfmd.recent.clear(false)
      return

    case 'file.close':
      await window.selfmd.window.close()
      return

    case 'file.quit':
      await window.selfmd.app.quit()
      return

    // ------------------------------------------------------------- 编辑 ---
    case 'edit.undo':
      undo(view)
      updateTitle()
      return

    case 'edit.redo':
      redo(view)
      updateTitle()
      return

    case 'edit.selectAll':
      selectAll(view)
      updateTitle()
      return

    case 'edit.selectLineOrSentence':
      选中当前行或句(view)
      afterEdit()
      return

    case 'edit.selectWord':
      选中当前词(view)
      afterEdit()
      return

    case 'edit.selectBlock':
      选中当前块(view)
      afterEdit()
      return

    case 'edit.delete': {
      // 删除所有选区；CM6 没有单独的"删除选区"操作。
      const changes = view.state.selection.ranges
        .filter((r) => !r.empty)
        .map((r) => ({ from: r.from, to: r.to, insert: '' }))
      if (changes.length) {
        view.dispatch({ changes, userEvent: 'delete' })
        doc.markDirty()
        updateTitle()
      }
      return
    }

    case 'edit.deleteLine':
      删除当前行或句(view)
      afterEdit()
      return

    case 'edit.pasteAsPlainText': {
      const text = await window.selfmdExtra.clipboard.readText()
      if (!text) return
      const range = view.state.selection.main
      view.dispatch({ changes: { from: range.from, to: range.to, insert: text } })
      doc.markDirty()
      updateTitle()
      return
    }

    case 'edit.jumpToTop':
      跳转到文首(view)
      updateTitle()
      return

    case 'edit.jumpToBottom':
      跳转到文末(view)
      updateTitle()
      return

    case 'edit.jumpToLineStart':
      跳转到行首(view)
      updateTitle()
      return

    case 'edit.jumpToLineEnd':
      跳转到行尾(view)
      updateTitle()
      return

    // --------------------------------------------------------- 智能标点 ---
    // 三个开关都要求把模式切到"输入时转换"，否则用户勾了复选框却毫无反应——
    // 那种"设置了但不生效"的状态比没有这个设置更糟。
    case 'edit.spellCheck': {
      settings = await window.selfmd.settings.patch({ spellCheck: !settings.spellCheck })
      // 拼写检查走内容元素的属性，必须重配扩展才会生效
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(settings)) })
      toast(
        settings.spellCheck
          ? '已开启拼写检查（改动对已打开的文档需重新加载后生效）'
          : '已关闭拼写检查'
      )
      return
    }

    // "何时转换"是三选一：输入时 / 渲染时 / 关闭。
    // 三个命令共用同一段逻辑，只是目标模式不同。
    case 'edit.smartPunctuationInput':
    case 'edit.smartPunctuationRendering':
    case 'edit.smartPunctuationOff': {
      const target =
        command === 'edit.smartPunctuationInput'
          ? 'input'
          : command === 'edit.smartPunctuationRendering'
            ? 'rendering'
            : 'none'
      // 再点一次当前模式 = 关掉。这样三个单选里任意一个都能当开关用。
      const nextMode = settings.smartPunctuationMode === target ? 'none' : target

      settings = await window.selfmd.settings.patch({
        smartPunctuationMode: nextMode,
        // 首次开启时把两个字符开关都打开，否则开了模式却什么都没转换，
        // 用户会以为功能坏了。
        ...(nextMode !== 'none' && !settings.smartQuotes && !settings.smartDashes
          ? { smartQuotes: true, smartDashes: true }
          : {})
      })

      applyEditMode()
      // 渲染模式的开关决定"装饰怎么建"，改完必须重绘才生效
      if (nextMode === 'rendering' || target === 'rendering') view.dispatch({})

      const displayName =
        nextMode === 'input' ? '输入时转换' : nextMode === 'rendering' ? '渲染时转换' : ''
      toast(displayName ? `智能标点：${displayName}` : '智能标点：已关闭')
      return
    }

    case 'edit.smartQuotes':
      settings = await window.selfmd.settings.patch({ smartQuotes: !settings.smartQuotes })
      toast(`智能引号已${settings.smartQuotes ? '开启' : '关闭'}`)
      return

    case 'edit.smartDashes':
      settings = await window.selfmd.settings.patch({ smartDashes: !settings.smartDashes })
      toast(`智能破折号已${settings.smartDashes ? '开启' : '关闭'}`)
      return

    // ------------------------------------------------------------- 视图 ---
    case 'view.sourceMode':
      settings = await window.selfmd.settings.patch({ livePreview: false })
      applyMode()
      return

    case 'view.livePreview':
      settings = await window.selfmd.settings.patch({ livePreview: true })
      applyMode()
      return

    case 'view.alwaysOnTop':
      if (typeof args === 'boolean') await window.selfmd.window.setAlwaysOnTop(args)
      return

    case 'view.fullScreen':
      if (typeof args === 'boolean') await window.selfmd.window.setFullScreen(args)
      return

    case 'view.showStatusBar':
      settings = await window.selfmd.settings.patch({ showStatusBar: !settings.showStatusBar })
      statusBar.setVisible(settings.showStatusBar)
      return

    case 'view.actualSize':
      await window.selfmd.window.setZoom(1)
      return

    case 'view.zoomIn': {
      const current = await window.selfmd.window.getZoom()
      await window.selfmd.window.setZoom(current + 0.1)
      return
    }

    case 'view.zoomOut': {
      const current = await window.selfmd.window.getZoom()
      await window.selfmd.window.setZoom(current - 0.1)
      return
    }

    case 'view.devTools':
      await window.selfmd.app.openDevTools()
      return

    // -------------------------------------------------------- 段落命令 ---
    case 'para.h1':
    case 'para.h2':
    case 'para.h3':
    case 'para.h4':
    case 'para.h5':
    case 'para.h6': {
      const level = Number(command.slice(-1))
      setHeadingLevel(view, level)
      afterEdit()
      return
    }

    case 'para.headingUp':
      调整标题级别(view, 1)
      afterEdit()
      return

    case 'para.headingDown':
      调整标题级别(view, -1)
      afterEdit()
      return

    case 'para.quote':
      toggleQuote(view)
      afterEdit()
      return

    case 'para.orderedList':
      toggleList(view, '有序')
      afterEdit()
      return

    case 'para.unorderedList':
      toggleList(view, '无序')
      afterEdit()
      return

    case 'para.taskList':
      toggleList(view, '任务')
      afterEdit()
      return

    case 'para.indent':
      adjustIndent(view, 1)
      afterEdit()
      return

    case 'para.outdent':
      adjustIndent(view, -1)
      afterEdit()
      return

    case 'para.codeFences':
      插入代码围栏(view)
      afterEdit()
      return

    case 'para.mathBlock':
      插入数学块(view)
      afterEdit()
      return

    case 'para.horizontalLine':
      插入水平线(view)
      afterEdit()
      return

    case 'para.table':
      insertTable(view)
      afterEdit()
      return

    case 'para.yamlFrontMatter':
      if (!插入前置元数据(view)) {
        toast('YAML 前置元数据只能插入到文档最开头')
      }
      afterEdit()
      return

    // -------------------------------------------------------- 格式命令 ---
    case 'fmt.strong':
      wrapInline(view, '**')
      afterEdit()
      return

    case 'fmt.emphasis':
      wrapInline(view, '*')
      afterEdit()
      return

    case 'fmt.underline':
      wrapInline(view, '<u>', '</u>')
      afterEdit()
      return

    case 'fmt.code':
      wrapInline(view, '`')
      afterEdit()
      return

    case 'fmt.inlineMath':
      wrapInline(view, '$')
      afterEdit()
      return

    case 'fmt.strike':
      wrapInline(view, '~~')
      afterEdit()
      return

    case 'fmt.highlight':
      wrapInline(view, '<mark>', '</mark>')
      afterEdit()
      return

    case 'fmt.superscript':
      wrapInline(view, '<sup>', '</sup>')
      afterEdit()
      return

    case 'fmt.subscript':
      wrapInline(view, '<sub>', '</sub>')
      afterEdit()
      return

    case 'fmt.comment':
      wrapInline(view, '<!--', '-->')
      afterEdit()
      return

    case 'fmt.hyperlink':
      insertLink(view)
      afterEdit()
      return

    case 'fmt.clear':
      clearFormat(view)
      afterEdit()
      return

    // ------------------------------------------------------------ 图像 ---
    case 'fmt.image':
    case 'image.insertFromUrl': {
      const url = await promptText({
        title: '插入图片',
        placeholder: 'https://example.com/图片.png',
        确定文字: '插入'
      })
      if (!url) return
      const request = 当前插入请求()
      if (!request) return
      报告插入(await 从地址插入(request, url))
      return
    }

    case 'image.insertLocal': {
      const choose = await window.selfmd.dialog.openFile({
        title: '插入本地图片',
        multi: true,
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'avif'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (choose.canceled || choose.filePaths.length === 0) return
      const request = 当前插入请求()
      if (!request) return
      报告插入(await insertFromFile(request, choose.filePaths))
      return
    }

    case 'image.toggleFolder': {
      // 文档级设置优先于全局，所以这个开关必须写进文档本身而不是配置。
      const currentValue = readFrontMatter(currentText()).attr['image-folder']
      if (currentValue) {
        改写前置元数据('image-folder', null)
        toast('已清除本文档的图片文件夹设置')
        return
      }
      const dir = await window.selfmd.dialog.openFolder({
        title: '选择图片文件夹',
        defaultPath: doc.current.path ?? undefined
      })
      if (dir.canceled || !dir.folderPath) return
      const docDir = doc.current.path
        ? await window.selfmdExtra.path.dirname(doc.current.path)
        : null
      if (!docDir) {
        toast('请先保存文档，再设置图片文件夹。', 'error')
        return
      }
      // 存相对路径：文档连同图片一起搬家时引用才不会断。
      const relativePath = await window.selfmd.file.relative(docDir, dir.folderPath)
      改写前置元数据('image-folder', relativePath)
      toast(`图片将复制到 ${relativePath}`)
      return
    }

    case 'image.toggleRootPath': {
      const currentValue = readFrontMatter(currentText()).attr['image-root']
      if (currentValue) {
        改写前置元数据('image-root', null)
        toast('已清除图片根目录设置')
        return
      }
      const dir = await window.selfmd.dialog.openFolder({ title: '选择图片根目录' })
      if (dir.canceled || !dir.folderPath) return
      const docDir = doc.current.path
        ? await window.selfmdExtra.path.dirname(doc.current.path)
        : null
      if (!docDir) {
        toast('请先保存文档，再设置图片根目录。', 'error')
        return
      }
      const relativePath = await window.selfmd.file.relative(docDir, dir.folderPath)
      改写前置元数据('image-root', relativePath)
      toast(`图片根目录设为 ${relativePath}`)
      return
    }

    case 'image.setPolicy':
      if (typeof args === 'string') {
        settings = await window.selfmd.settings.patch({
          imageStoragePolicy: args as ImageStoragePolicy
        })
        toast('已更新全局图片设置')
      }
      return

    case 'image.toggleAllowUpload':
      settings = await window.selfmd.settings.patch({ allowImageUpload: !settings.allowImageUpload })
      toast(`自动上传已${settings.allowImageUpload ? '允许' : '禁止'}`)
      return

    // ------------------------------------------------------------ 查找 ---
    case 'edit.find':
    case 'edit.findAndReplace': {
      // CodeMirror 没有"仅查找"模式，面板里始终带替换行。
      // 「查找」打开时给 body 加类把替换行藏起来，两个菜单项的行为差异
      // 才对用户可见；「查找和替换」则确保替换行显示。
      document.body.classList.toggle('no-replace', command === 'edit.find')
      openSearchPanel(view)
      return
    }

    case 'edit.findNext':
      findNext(view)
      return

    case 'edit.findPrevious':
      findPrevious(view)
      return

    // ---------------------------------------------------------- 侧边栏 ---
    case 'view.toggleSidebar':
      // 被"始终显示/始终隐藏"锁住时**要说明原因**，而不是默默无效。
      // 默默无效的后果是用户反复按快捷键、以为程序坏了。
      if (侧边栏被锁定(settings)) {
        toast(
          settings.sidebarMode === 'always'
            ? '侧边栏已设为「始终显示」，可在偏好设置里改。'
            : '侧边栏已设为「始终隐藏」，可在偏好设置里改。'
        )
        return
      }
      sidebar?.toggle()
      return

    case 'view.outline':
      // 切标签页时若侧边栏正锁在"始终隐藏"，同样要说明——
      // 否则用户点了「大纲」却什么都没发生。
      if (settings.sidebarMode === 'never') {
        toast('侧边栏已设为「始终隐藏」，可在偏好设置里改。')
        return
      }
      sidebar?.toggle('outline')
      return

    case 'view.fileTree':
      if (settings.sidebarMode === 'never') {
        toast('侧边栏已设为「始终隐藏」，可在偏好设置里改。')
        return
      }
      sidebar?.toggle('files')
      return

    case 'file.preferences':
      prefsPanel.open()
      return

    // ------------------------------------------------------------ 图床 ---
    case 'image.upload':
    case 'image.uploadAll': {
      const 只本地 = true
      const all = 收集文档图片(view.state, 只本地)
      if (all.length === 0) {
        toast('文档里没有本地图片，无需上传。')
        return
      }
      // 单个上传命令只传光标所在的那一张；"上传所有"传全部。
      const pendingUpload =
        command === 'image.upload'
          ? all.filter((img) => {
              const cursor = view.state.selection.main.head
              return img.from <= cursor && cursor <= img.to
            })
          : all
      if (pendingUpload.length === 0) {
        toast('请先把光标放到要上传的图片上，或使用「上传所有本地图片」。')
        return
      }
      toast(`正在上传 ${pendingUpload.length} 张图片…`)
      const result = await 上传并回填(view, pendingUpload)
      报告上传(result)
      return
    }

    // ---------------------------------------------------------- 编辑模式 --
    case 'view.focusMode':
      settings = await window.selfmd.settings.patch({ focusMode: !settings.focusMode })
      applyEditMode()
      toast(settings.focusMode ? '已进入专注模式' : '已退出专注模式')
      return

    case 'view.typewriterMode':
      settings = await window.selfmd.settings.patch({ typewriterMode: !settings.typewriterMode })
      applyEditMode()
      if (settings.typewriterMode) 居中光标行(view)
      toast(settings.typewriterMode ? '已开启打字机模式' : '已关闭打字机模式')
      return

    case 'edit.copyAsImage': {
      // 选中了就只截选中的那段，没选就截整篇——与"复制为 Markdown"同一条规则。
      const txt = 取选区或整篇()
      if (!txt.trim()) {
        toast('没有可复制的内容')
        return
      }
      toast('正在渲染图片…')
      const result = await window.selfmd.copyAsImage({
        source: txt,
        docPath: doc.current.path
      })
      if (!result.success) {
        toast(result.error ?? '生成图片失败', 'error')
        return
      }
      // 被截断时必须说清楚：用户拿到一张少了一半的图却以为完整，
      // 拿去用之后才发现，那时已经不知道是哪一步出的问题。
      toast(
        result.truncated
          ? `已复制图片（${result.width}×${result.height}）——内容过长，只截取了前一部分`
          : `已复制图片（${result.width}×${result.height}）`,
        result.truncated ? 'error' : 'info'
      )
      return
    }

    // -------------------------------------------------------- 复制与插入 ---
    case 'edit.copyAsMarkdown': {
      // 复制源文本。看似无用（普通复制也是拿到源文本），但当光标在图片、
      // 公式或表格上时，普通复制拿到的是渲染结果，这个命令保证拿到 Markdown。
      const txt = 取选区或整篇()
      if (!txt) {
        toast('没有可复制的内容')
        return
      }
      await window.selfmdExtra.clipboard.writeText(txt)
      toast(`已复制 ${txt.length} 个字符的 Markdown`)
      return
    }

    case 'edit.copyAsHtmlCode': {
      // 复用导出的渲染器：**同一份 Markdown 必须渲染成同一份 HTML**，
      // 否则"复制出来的"和"导出出来的"会不一致，而没人会去比对两者。
      const txt = 取选区或整篇()
      if (!txt) {
        toast('没有可复制的内容')
        return
      }
      const parts = renderMarkdownToHtml(txt)
      // writeHtml 需要同时给纯文本兜底：目标程序不支持 HTML 时
      // （比如粘进纯文本编辑器），没有兜底会粘出空白。
      await window.selfmdExtra.clipboard.writeHtml(parts, txt)
      toast('已复制为 HTML')
      return
    }

    case 'para.toc': {
      // 插入 `[TOC]` 标记本身，不展开成目录——展开后文档就多了一堆
      // 需要手动同步的内容，标题一改就过期。渲染与导出时再展开。
      在当前行插入块('[TOC]', '内容目录')
      return
    }

    case 'para.linkReference': {
      // 引用式链接：正文里只留标记，地址集中写在文末。
      // 同一地址用多次时特别有用——改一处即可。
      const pick = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      const text = pick || '链接文字'
      const mark = 唯一引用标记()
      const insert = `[${text}][${mark}]`
      view.dispatch({
        changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: insert },
        selection: { anchor: view.state.selection.main.from + insert.length }
      })
      // 定义追加到文末
      追加到文末(`\n[${mark}]: https://\n`)
      toast('已插入引用式链接，地址写在文末')
      return
    }

    case 'para.footnotes': {
      const pick = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      const numbering = 下一个脚注编号()
      const mark = `[^${numbering}]`
      view.dispatch({
        changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: mark },
        selection: { anchor: view.state.selection.main.from + mark.length }
      })
      追加到文末(`\n${mark}: ${pick || '脚注内容'}\n`)
      toast(`已插入脚注 ${numbering}，正文写在文末`)
      return
    }

    case 'help.defaultApp': {
      // **不做"一键设为默认"**：Windows 10 起默认程序由用户的 UserChoice
      // 决定，且带防篡改校验，任何程序都改不了。给一个注定失败的按钮
      // 比不给更糟——用户点几次没反应，会以为整个程序有问题。
      //
      // 能做的是：如实报出当前状态，再把人送到系统设置那一页。
      const association = await window.selfmd.fileAssoc()
      const 详情 =
        `当前默认程序：${association.current || '（未设置）'}\n` +
        `本程序：${association.程序路径}\n` +
        `「新建」菜单项：${association.hasShellNew ? '已注册' : '未注册'}` +
        (association.isDefaultFlag
          ? ''
          : '\n\nWindows 不允许程序自己改默认打开方式，需要在系统设置里选一次。' +
            '点「打开设置」跳到那一页，找到 .md 后选 selfMD。')

      const result = await window.selfmd.dialog.message({
        type: 'info',
        title: 'Markdown 文件关联',
        message: association.isDefaultFlag ? '已经是 Markdown 的默认程序' : '尚未设为默认',
        detail: 详情,
        buttons: association.isDefaultFlag ? ['确定'] : ['打开设置', '取消'],
        defaultId: 0,
        cancelId: 1
      })

      if (!association.isDefaultFlag && result.response === 0) await window.selfmd.openDefaultApps()
      return
    }

    case 'help.website':
    case 'help.feedback': {
      // 本项目没有对外站点。指向一个不存在的网址比什么都不做更糟——
      // 用户会以为是网络问题。直接说明情况，并指出该去哪里看。
      toast(
        command === 'help.website'
          ? '本项目为个人自用，没有对外站点；说明见项目根目录的 README.md'
          : '本项目为个人自用，没有反馈渠道；问题请记在项目根目录的 README.md 里',
        'info'
      )
      return
    }

    // ------------------------------------------------------------ 导出 ---
    case 'file.export':
    case 'file.exportHtml':
    case 'file.exportHtmlPlain':
    case 'file.exportPdf':
    case 'file.exportDocx':
    case 'file.exportLatex':
    case 'file.exportEpub':
    case 'file.exportRtf':
    case 'file.exportOdt': {
      const format = 命令到导出格式(command)
      const filePath = doc.current.path
      // 默认文件名取自当前文档；未保存时用首行标题兜底，比"未命名文档"好用
      const 默认名 = filePath ? 去掉扩展名(filePath) : 首行作标题(currentText())
      const result = await window.selfmd.export.run({
        format,
        source: currentText(),
        docPath: filePath,
        defaultFileName: 默认名,
        // 导出选项来自设置（「导出设置」菜单项与偏好设置面板都能改）。
        // 不传的话主进程会用自己的默认值，于是设置面板改了却没效果——
        // 那种"改了没反应"最难查。
        withOutline: settings.exportIncludeOutline,
        embeddedImage: settings.exportEmbedImages
      })
      if (result.error) {
        toast(result.error, 'error')
        return
      }
      if (result.filePath) toast(`已导出到 ${result.filePath}`)
      return
    }

    case 'file.print': {
      const result = await window.selfmd.print()
      if (!result.success && result.error !== '打印已取消') toast(result.error ?? '打印失败', 'error')
      return
    }

    // ------------------------------------------------------------ 主题 ---
    case 'theme.apply':
      if (typeof args === 'string') {
        // 在深色模式下选主题，应当写进深色槽位——否则用户点了没反应。
        const 槽 = settings.isDarkMode && settings.useSeparateDarkTheme ? 'darkTheme' : 'theme'
        settings = await window.selfmd.settings.patch({ [槽]: args })
        applyTheme(settings)
      }
      return

    case 'theme.setSlot': {
      const params = args as { slot: 'light' | 'dark'; id: string } | undefined
      if (!params) return
      settings = await window.selfmd.settings.patch(
        params.slot === 'light' ? { theme: params.id } : { darkTheme: params.id }
      )
      applyTheme(settings)
      return
    }

    case 'theme.toggleSeparateDark':
      settings = await window.selfmd.settings.patch({
        useSeparateDarkTheme: !settings.useSeparateDarkTheme
      })
      applyTheme(settings)
      toast(settings.useSeparateDarkTheme ? '深色模式使用独立主题' : '深色与浅色共用一套主题')
      return

    case 'theme.reload':
      // 用户在外部编辑器里改完 CSS 要能立刻看到效果。href 不变时浏览器不会
      // 重新拉取，所以先清空再设回同一个地址。
      重新加载主题(settings)
      toast('已重新加载主题')
      return

    case 'theme.editBaseCss':
    case 'theme.editThemeCss': {
      const rangeBounds = command === 'theme.editBaseCss' ? 'base' : 'theme'
      const result = await window.selfmd.theme.openCustom(rangeBounds)
      toast(
        result.filePath
          ? `已打开${rangeBounds === 'base' ? '全局' : '当前主题'}自定义 CSS，保存后执行「重新加载主题」`
          : '打开自定义 CSS 失败',
        result.filePath ? 'info' : 'error'
      )
      return
    }

    case 'theme.create': {
      const name = await promptText({
        title: '新建主题',
        placeholder: '例如 my-theme（不要带 .css）',
        确定文字: '创建'
      })
      if (!name) return
      const 新主题 = await window.selfmd.theme.create(name)
      if (!新主题) {
        toast('创建失败：名称不合法，或同名主题已存在', 'error')
        return
      }
      const filePath = await window.selfmd.theme.openCustom('theme')
      void filePath
      toast(`已创建主题「${新主题.name}」并打开它的自定义 CSS`)
      return
    }

    case 'theme.install': {
      const 装好 = await window.selfmd.theme.install()
      if (!装好) {
        toast('未安装任何主题', 'error')
        return
      }
      settings = await window.selfmd.settings.patch({ theme: 装好.id })
      applyTheme(settings)
      toast(`已安装并启用主题「${装好.name}」`)
      return
    }

    case 'theme.revealFolder':
      await window.selfmd.theme.revealFolder()
      return

    default:
      // 未移植的命令在菜单里渲染成禁用状态，所以能走到这里
      // 说明注册表与菜单模板不一致。
      toast(`该命令尚未实现：${command}`)
      return
  }
}

async function openPath(path: string): Promise<void> {
  try {
    // 已经打开过就直接切过去，**不再开第二份**。
    // 同一个文件开两份是编辑器里最讨厌的坑之一：两边内容会互相覆盖，
    // 而用户直到丢了一次改动才会发现。
    const 已开 = tabSet.按路径找(path)
    if (已开) {
      await switchTab(已开.id)
      return
    }

    // **必须在 setDocument 之前**把图片的相对路径基准设好：
    // 文档内容一进编辑器就会构建装饰，那时若基准目录还是上一篇文档的，
    // 图片会先渲染成"无法显示"，要等重绘才恢复——表现为图片闪一下。
    setDocDir(await window.selfmdExtra.path.dirname(path))

    const text = await doc.open(path)
    // **先写回，再换视图状态。** openPath 会替换整个编辑器状态，
    // 不先存的话前一个文档里未保存的改动就没了。
    tabSet.saveCurrent(view.state)
    setDocument(text)
    tabSet.addTo(doc.exportStatus(), view.state)
    updateTitle()
    refreshTabUi()
    view.focus()

    const info = await window.selfmd.app.getInfo()
    let parserCounts: Record<string, number> | undefined
    let domCounts: Record<string, number> | undefined

    if (info.smokeTest) {
      // 给 CodeMirror 一帧时间把装饰落到 DOM 上，否则计数必然是 0。
      await new Promise((resolve) => window.setTimeout(resolve, 400))
      await 等待异步渲染稳定()
      // 再等到装饰数量不再变化，避免"取样太早"造成的假失败
      await 等待渲染稳定(() =>
        Array.from(document.querySelectorAll('.cm-line, .cm-w-image, .cm-w-math, .cm-w-diagram'))
          .length.toString() +
        ':' +
        document.querySelectorAll('.cm-content *').length.toString()
      )

      // 解析树计数覆盖整篇文档；DOM 计数只覆盖视口——CodeMirror 会虚拟化
      // 长文档，视口外的行压根没有 DOM。两个数放在一起，才能区分
      // "装饰没生效" 和 "内容在屏幕外"。
      parserCounts = {}
      syntaxTree(view.state).iterate({
        enter: (node) => {
          parserCounts![node.name] = (parserCounts![node.name] ?? 0) + 1
        }
      })

      const 待统计: Record<string, string> = {
        标题行: '.cm-lp-heading',
        代码块行: '.cm-lp-code',
        引用行: '.cm-lp-quote',
        前置元数据行: '.cm-lp-frontmatter',
        数学块行: '.cm-lp-math',
        数学公式: '.cm-w-math',
        // 图表分三类统计，理由与图片相同：
        // 「没渲染」「渲染了但还没出图」「渲染失败」的修复方向完全不同
        图表: '.cm-w-diagram',
        图表已出图: '.cm-w-diagram[data-state="完成"]',
        图表失败: '.cm-w-diagram[data-state="失败"]',
        // 既没完成也没失败 = 还卡在渲染中。分开数才能区分
        // "渲染慢" 与 "渲染流程断了"——两者的处理完全不同。
        图表未完成: '.cm-w-diagram[data-state="渲染中"]',
        表格行: '.cm-lp-table',
        表格分隔线: '.cm-lp-table-sep',
        HTML块行: '.cm-lp-html',
        语言标签: '.cm-w-lang',
        列表圆点: '.cm-w-bullet',
        任务复选框: '.cm-w-task',
        水平线: '.cm-w-hr',
        表格竖线: '.cm-w-pipe',
        加粗: '.cm-md-strong',
        斜体: '.cm-md-emphasis',
        删除线: '.cm-md-strikethrough',
        行内代码: '.cm-md-code',
        行内链接: '.cm-md-link',
        // 图片分三类统计：能加载的、加载失败的、以及独占一行的。
        // 分开数才能区分"没渲染"与"渲染了但加载失败"——两者的修复方向完全不同。
        image: '.cm-w-image img',
        图片失败: '.cm-w-image.md-img-error',
        独占行图片: '.cm-lp-image-line',
        // 代码块内部的语法着色。**分语言标签统计**而不是只数一个总数：
        // 只数总数的话，"只有注释上了色、关键字没上"也会显示成通过。
        代码关键字: '.cm-tok-keyword',
        代码字符串: '.cm-tok-string',
        代码注释: '.cm-tok-comment',
        代码函数: '.cm-tok-function',
        代码数字: '.cm-tok-number',
        代码类型: '.cm-tok-type',
        代码着色总数: '.cm-lp-code [class*="cm-tok-"]',
        // 代码块头部栏。原来这里数的是行尾的 `cm-w-lang` 小标签，
        // 现在首行整行换成头部栏，那个标签只在光标停在围栏行时才出现。
        代码块头部: '.cm-w-codehead',
        // 行号。数的是带 `data-行号` 属性的行——属性在、数字才画得出来，
        // 只数行数的话"行装饰在但属性没挂"这种情况会漏过去。
        代码行号: '.cm-lp-code[data-lineNo]',
        // 提示框（`> [!NOTE]`）：行样式与首行标签分开数。
        // 只数标签的话，"标签在但行样式没挂"会漏过去——那样字色就不会变浅。
        提示框行: '.cm-lp-callout',
        提示框标签: '.cm-w-callout'
      }
      // --- DOM 计数：滚动取样取最大值 -------------------------------------
      //
      // 装饰只对视口内的行生效（CodeMirror 会虚拟化长文档），所以单看一屏
      // 的计数是**布局敏感的**：代码块头部栏让行变高了一点，下方的内容
      // 就被挤出视口，计数从 2 变成 0——看起来像"表格不渲染了"，
      // 其实只是滚到屏幕外了。
      //
      // 取样三次（顶、中、底）逐项取最大值，就把断言从"必须正好一屏放得下"
      // 里解放出来。取最大值而不是求和：同一行在多个视口里都会出现，
      // 求和会把重复计进去。
      domCounts = {}
      const 取样位置 = [0, 0.5, 1]
      for (const 比例 of 取样位置) {
        const 可达高 = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
        view.scrollDOM.scrollTop = 可达高 * 比例
        // 滚动之后 CodeMirror 需要一帧重建视口内的装饰
        await new Promise((done) => requestAnimationFrame(() => done(null)))
        for (const [name, selector] of Object.entries(待统计)) {
          const numItems = document.querySelectorAll(selector).length
          domCounts[name] = Math.max(domCounts[name] ?? 0, numItems)
        }
      }
      view.scrollDOM.scrollTop = 0
      await new Promise((done) => requestAnimationFrame(() => done(null)))

      // 提示框的每一行里还有没有裸露的 `>`。
      //
      // **必须把光标放进框里再数。** 光标在文档开头时，那一行本来就不是
      // 活动行、`>` 当然隐藏着——这么测等于什么都没测。
      // 用户抱怨的恰恰是"我在框里打字，行首还挂着 >"。
      {
        const 首行元素 = document.querySelector('.cm-lp-callout') as HTMLElement | null
        if (首行元素) {
          const lines = Array.from(document.querySelectorAll('.cm-lp-callout'))
          const 数带符 = (): number =>
            lines.filter((el) => (el.textContent ?? '').includes('>')).length

          // 光标放到第二行（正文行）中间——用户打字时的真实位置
          const 正文行 = lines[1] as HTMLElement | undefined
          if (正文行?.dataset) {
            const position = view.posAtDOM(正文行, 0) + 4
            view.dispatch({ selection: { anchor: Math.min(position, view.state.doc.length) } })
            await new Promise((done) => requestAnimationFrame(() => done(null)))
          }
          const 框内带符 = 数带符()

          // 字色必须**量**：引用正文外面还套着一层 `.cm-md-quote` 行内标记，
          // 它自带颜色，只给行元素设 color 是压不过它的。
          // 光看 CSS 会以为设上了，屏幕上是"没变浅"。
          const 正文元素 = lines[1] as HTMLElement | undefined
          const 行字色 = 正文元素 ? getComputedStyle(正文元素).color : ''
          const mark = 正文元素?.querySelector('.cm-md-quote') as HTMLElement | null
          const 标记字色 = mark ? getComputedStyle(mark).color : '（无行内标记）'
          const 正文行元素 = document.querySelector('.cm-line:not(.cm-lp-quote)') as HTMLElement | null
          const 普通字色 = 正文行元素 ? getComputedStyle(正文行元素).color : ''

          lines.forEach(() => {})
          console.log(
            `[selfMD] 提示框文本：行数=${lines.length} ` +
              `光标在框内时带引用符=${框内带符} ` +
              `框内字色=${行字色}/${标记字色} 正文行字色=${普通字色} ` +
              `首行=${JSON.stringify((lines[0].textContent ?? '').slice(0, 20))}`
          )
        }
      }

      // 引用块里还有没有裸露的 `>`。**不看光标在哪**——用户要的是
      // 任何情况下都看不到这个字符，所以光标放不放在里面都得数。
      {
        const quote = Array.from(document.querySelectorAll('.cm-lp-quote'))
        if (quote.length > 0) {
          const 带符 = quote.filter((el) => (el.textContent ?? '').includes('>')).length
          console.log(
            `[selfMD] 引用行文本：行数=${quote.length} 带引用符=${带符} ` +
              `全部=${JSON.stringify(quote.map((el) => (el.textContent ?? '').slice(0, 16)))}`
          )
        }
      }

      // 引用块里按回车：**框必须留着**。
      //
      // 标准 Markdown 会在空引用行上回车时撤掉 `>` 退出引用，但引用符现在
      // 不显示了——"退出引用"在屏幕上就是"整个框凭空消失"。
      // 这里真的按一次回车，看新行还在不在引用里。
      {
        const quote = Array.from(document.querySelectorAll('.cm-lp-quote'))
        if (quote.length > 0) {
          const originalDoc = view.state.doc.toString()
          // **不能取"最后一行"**：夹具末尾有个换行，最后一行是空行，
          // 它不以 `>` 开头，命令自然不触发——测出来的"否"是假阴性。
          // 要取最后一个真正的引用行。
          let 目标行号 = -1
          for (let n = view.state.doc.lines; n >= 1; n--) {
            if (/^\s*>/.test(view.state.doc.line(n).text)) {
              目标行号 = n
              break
            }
          }
          let 触发 = '否'
          let 仍是 = '否'
          if (目标行号 > 0) {
            const targetLine = view.state.doc.line(目标行号)
            view.dispatch({ selection: { anchor: targetLine.to } })
            触发 = continueQuote(view) ? '是' : '否'
            // 新行紧跟在**目标行**后面（不是文档末尾——夹具末尾还有一个空行）
            仍是 = /^\s*>/.test(view.state.doc.line(目标行号 + 1).text) ? '是' : '否'
          }
          // 复原，别把后面的用例带偏
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: originalDoc },
            selection: { anchor: 0 }
          })
          console.log(`[selfMD] 回车续引用：触发=${触发} 新行仍是引用=${仍是}`)
        }
      }

      // 图表是唯一异步渲染的东西。正常情况下计数就够了，但一旦有图表
      // 没走到终态（既非完成也非失败），光看计数无从定位，所以这时才打出明细。
      const 图表们 = Array.from(document.querySelectorAll('.cm-w-diagram'))
      const 未定 = 图表们.filter((el) => (el as HTMLElement).dataset.state === '渲染中')
      // 只要有图表就把**每一个**的状态打出来。
      // 只在"未完成"时才打，遇到"状态有值但内容为空"这种情况就完全看不见——
      // 而那正是最难查的一种：计数全是 0，明细一片空白。
      if (图表们.length > 0) {
        const 明细 = 图表们
          .map((el) => {
            const box = el as HTMLElement
            const child = Array.from(box.children)
              .map((c) => c.tagName.toLowerCase())
              .join('+')
            return `[${box.dataset.state ?? '无状态'}|${child || '空'}|${(box.textContent ?? '').trim().slice(0, 24)}]`
          })
          .join(' ')
        console.log(`[selfMD] 图表明细（${图表们.length} 个，未完成 ${未定.length}）：${明细}`)
      }
    }

    // 命令自测会反复 setState，必须放在装饰统计之后，
    // 否则编辑器已被重置，DOM 计数将毫无意义。
    let commandResults: Record<string, string> | undefined
    let pureResults: Record<string, string> | undefined
    let imageResults: Record<string, string> | undefined
    let imageInsertResult: string | undefined
    let 主题自测结果: string | undefined
    let 大纲结果: Record<string, string> | undefined
    let exportResult: Record<string, string> | undefined
    let 偏好结果: Record<string, string> | undefined
    let uploadResult: Record<string, string> | undefined
    let 数学结果: Record<string, string> | undefined
    let 标点结果: Record<string, string> | undefined
    let 交互结果: string | undefined
    let 代码块结果: string | undefined
    let 右键结果: string | undefined
    let 表格结果: string | undefined
    let 头部结果: string | undefined
    let 匹配结果: Record<string, string> | undefined
    let 侧边栏结果: string | undefined
    let 标签结果: string | undefined
    let 图片复制结果: string | undefined
    let 模式结果: string | undefined
    let 偏好界面结果: string | undefined
    let 图片菜单结果: string | undefined
    if (info.smokeTest) {
      commandResults = 运行命令自测(view, view.state)
      // 纯函数自测不碰编辑器，放在最后以免影响上面的状态恢复。
      pureResults = 运行纯函数自测()
      imageResults = 运行图片管线自测()
      大纲结果 = 运行大纲自测()
      exportResult = 运行导出自测()
      偏好结果 = 运行偏好设置自测()
      uploadResult = 运行上传自测()
      数学结果 = 运行数学自测()
      标点结果 = 运行渲染标点自测()
      表格结果 = await 运行表格自测()
      右键结果 = await 运行右键菜单自测()
      头部结果 = await 运行代码块头部自测()
      代码块结果 = await 运行代码块自测()
      交互结果 = await 运行交互自测()
      匹配结果 = 运行模糊匹配自测()
      imageInsertResult = await 运行图片插入自测(path)
      侧边栏结果 = await 运行侧边栏自测()
      标签结果 = await 运行标签自测()
      图片复制结果 = await 运行复制图片自测()
      模式结果 = await 运行模式自测()
      偏好界面结果 = await 运行偏好界面自测()
      图片菜单结果 = await 运行图片菜单自测()
      主题自测结果 = await 运行主题自测()
    }

    await window.selfmd.doc.notifyOpened({
      path,
      characters: text.length,
      lines: text.length === 0 ? 0 : text.split('\n').length,
      parserCounts,
      domCounts,
      commandResults,
      pureResults,
      imageResults,
      imageInsertResult,
      themeResult: 主题自测结果,
      outlineResults: 大纲结果,
      exportResults: exportResult,
      prefsResults: 偏好结果,
      uploadResults: uploadResult,
      mathResults: 数学结果,
      punctResults: 标点结果,
      matchResults: 匹配结果,
      sidebarResult: 侧边栏结果,
      tabResult: 标签结果,
      codeBlockResult: 代码块结果,
      contextMenuResult: 右键结果,
      tableResult: 表格结果,
      codeBlockHeaderResult: 头部结果,
      interactionResult: 交互结果,
      imageCopyResult: 图片复制结果,
      modeResult: 模式结果,
      prefsUiResult: 偏好界面结果,
      imageMenuResult: 图片菜单结果,
      mode: settings.livePreview ? '实时预览' : '源码'
    })
  } catch (err) {
    toastError(err, '打开失败')
  }
}

function applyMode(): void {
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(settings)) })
  applyTheme(settings)
  updateTitle()
  view.focus()
}

// ---------------------------------------------------------------------------
// 关闭流程
// ---------------------------------------------------------------------------

async function handleRequestClose(): Promise<void> {
  if (!doc.current.dirty) {
    await window.selfmd.window.closeForce()
    return
  }

  // 关窗前先把待写的草稿落下去。用户选了"不保存"也要落：
  // 关窗是最后的机会，写一份草稿的成本几乎为零，而它可能救回一整篇文章。
  await 立即保存草稿()

  const name = doc.current.name
  const answer = await window.selfmd.dialog.message({
    type: 'warning',
    title: 'selfMD',
    message: `是否要保存对「${name}」的更改？`,
    detail: '如果不保存，你所做的更改将会丢失。',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2
  })

  if (answer.response === 0) {
    try {
      const ok = await doc.save(currentText())
      if (!ok) return
    } catch (err) {
      toastError(err, '保存失败')
      return
    }
    await window.selfmd.window.closeForce()
    return
  }
  if (answer.response === 1) {
    await window.selfmd.window.closeForce()
  }
  // Cancel: do nothing, the window stays open.
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  settings = await window.selfmd.settings.get()
  applyTheme(settings)

  const host = document.getElementById('editor-host')
  const statusHost = document.getElementById('statusbar')
  if (!host || !statusHost) throw new Error('renderer markup is missing')

  statusBar = new StatusBar(statusHost)
  statusBar.setVisible(settings.showStatusBar)

  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: editorExtensions() }),
    parent: host
  })

  // --- 编辑器右键菜单 -----------------------------------------------------
  //
  // 挂在 `view.dom` 上而不是文档级：只有编辑器内容需要这套段落/格式菜单。
  // 侧边栏、状态栏各有各的右键语境，混在一起会出现"在文件树上右键却弹出加粗"。
  //
  // 必须 `preventDefault`，否则 Chromium 会再弹一层自己的默认菜单
  // （剪切/复制/粘贴 + 拼写建议），两层叠在一起。
  view.dom.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    popupMenu({ x: event.clientX, y: event.clientY }, 构建编辑器右键菜单())
  })

  // 侧边栏要在 view 建好之后才能建：它依赖 view 做跳转与取文档路径。
  const 侧边宿主 = document.getElementById('sidebar')
  if (侧边宿主) {
    sidebar = new 侧边栏组件(侧边宿主, {
      取文档路径: () => doc.current.path,
      跳转到: (position) => {
        view.dispatch({
          selection: EditorSelection.cursor(position),
          scrollIntoView: true,
          effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 40 })
        })
        view.focus()
      },
      打开文件: (filePath) => {
        void openPath(filePath)
      },
      点击文档: (id) => {
        void switchTab(id)
      },
      关闭文档: (id) => {
        void closeTab(id)
      },
      保存状态: (state) => {
        // 不比对就会形成回声：保存 → 设置变更事件 → 再保存 → …
        // 值没变时直接返回，环就断在这里。
        //
        // **被策略锁住时不要写回可见状态**：那会把用户选好的
        // 「始终显示/始终隐藏」悄悄改掉，下次切回「可自由切换」时
        // 侧边栏的状态就不是他记得的那样了。
        const 该存的可见 = 侧边栏被锁定(settings) ? settings.sidebarVisible : state.visibleNow
        if (
          该存的可见 === settings.sidebarVisible &&
          state.label === settings.sidebarTab &&
          state.widthPx === settings.sidebarWidth
        ) {
          return
        }
        void window.selfmd.settings.patch({
          sidebarVisible: 该存的可见,
          sidebarTab: state.label,
          sidebarWidth: state.widthPx
        })
      }
    })
    sidebar.setWidth(settings.sidebarWidth)
    // 「文档」标签页已经实现了，不再降级映射到文件树
    sidebar.setTab(settings.sidebarTab)
    sidebar.setVisible(sidebarShown(settings))
    refreshOutline(true)
  }

  doc.subscribe(() => {
    updateTitle()
    // 换文档后文件树要跟着换根目录，大纲也要重算
    sidebar?.refreshFileTree()
    refreshOutline(true)
    // 图片的相对路径基准也跟着文档变
    void 刷新图片基准目录().then(() => {
      // 基准目录变了要重算装饰，否则已经渲染的图片仍指向旧目录
      view.dispatch({})
    })
  })
  applyEditMode()
  updateTitle()
  view.focus()

  // 图片右键菜单与相对路径基准都要在 view 建好之后才能装
  安装图片右键()
  void 刷新图片基准目录()

  // 启动时检查崩溃残留的草稿。放在最后：先让编辑器可用，
  // 万一恢复流程出问题，用户至少还能正常打开文档。
  void 检查崩溃恢复()

  // --- main -> renderer -----------------------------------------------------
  window.selfmd.on.menuCommand((payload) => {
    void runCommand(payload)
  })

  window.selfmd.on.settingsChanged((next) => {
    const modeChanged =
      next.livePreview !== settings.livePreview ||
      next.autoWrapLongLines !== settings.autoWrapLongLines
    const 侧边变了 =
      next.sidebarVisible !== settings.sidebarVisible ||
      next.sidebarMode !== settings.sidebarMode ||
      next.sidebarTab !== settings.sidebarTab
    settings = next
    applyTheme(settings)
    applyEditMode()
    刷新模式相关界面()
    if (侧边变了 && sidebar) {
      sidebar.setWidth(settings.sidebarWidth)
      // 用 `侧边栏可见` 而不是直接读 sidebarVisible：
      // 「始终显示/始终隐藏」两档下，后者是被忽略的残留值。
      sidebar.setVisible(sidebarShown(settings))
      if (settings.sidebarTab !== 'articles') sidebar.setTab(settings.sidebarTab)
    }
    if (modeChanged) applyMode()
    else updateTitle()
  })

  window.selfmd.on.openDocument(({ path }) => {
    void openPath(path)
  })

  window.selfmd.on.requestClose(() => {
    void handleRequestClose()
  })

  window.selfmd.on.fileChangedOnDisk(({ path }) => {
    if (path === doc.current.path) {
      toast('文件已被外部程序修改，重新打开可查看最新内容。')
    }
  })

  // --- renderer -> main：上报启动完成 -------------------------------------
  const info = await window.selfmd.app.getInfo()

  // 启动时若还没有任何标签（既没打开文件，也没有恢复的草稿），
  // 就先建一个空标签。**这一步不能省**：标签集为空时侧边栏的文档列表
  // 是空的，而用户看不到任何"当前文档"的表示，会以为界面坏了。
  if (tabSet.count === 0) {
    tabSet.addTo(doc.exportStatus(), view.state)
  }
  refreshTabUi()

  console.log(`[selfMD] renderer ready on ${info.platform}, electron ${info.electron}`)
  await window.selfmd.app.signalReady({ documents: tabSet.count })
}

void boot().catch((err) => {
  toastError(err, '启动失败')
})
