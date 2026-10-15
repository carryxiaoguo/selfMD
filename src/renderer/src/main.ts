import { redo, selectAll, undo } from '@codemirror/commands'
import { findNext, findPrevious, openSearchPanel } from '@codemirror/search'
import { syntaxTree } from '@codemirror/language'
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { 移除属性, 读取前置元数据, 写入属性 } from '@shared/front-matter'
import { 渲染Markdown为HTML } from '@shared/markdown-html'
import { 标签管理器, type 标签 } from './services/标签'
import { 打开快速打开面板 } from './ui/快速打开'
import { 生效主题, type 草稿信息 } from '@shared/types'
import type { MenuCommandPayload } from '@shared/ipc'
import type { ImageStoragePolicy, Settings } from '@shared/types'
import {
  切换列表,
  切换引用,
  包裹行内,
  插入代码围栏,
  插入前置元数据,
  插入水平线,
  插入数学块,
  插入表格,
  插入链接,
  跳出代码块,
  清除格式,
  调整标题级别,
  调整缩进,
  设置标题级别
} from './editor/commands'
import { baseExtensions, modeExtensions } from './editor/setup'
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
import { 设置行内公式启用, 设置渲染标点启用 } from './editor/live-preview/types'
import { 设置图片右键处理器 } from './editor/live-preview/widgets'
import { 收集文档图片, 上传并回填, type 回填结果, type 文档图片 } from './image/上传'
import { 设置文档目录, 解析图片地址, 取文档目录 } from './image/显示地址'
import {
  取当前图片,
  删除图片文件,
  建议文件名,
  复制图片到,
  设置目录提供者,
  转换图片语法,
  重命名或移动图片,
  type 图片上下文
} from './image/图片操作'
import { 弹出菜单, 关闭菜单, type 菜单项 } from './ui/上下文菜单'
import { 图片粘贴与拖放 } from './image/handlers'
import {
  type 插入请求,
  从地址插入,
  从文件插入,
  本次目标目录
} from './image/insert'
import { 询问文本 } from './ui/prompt'
import { 偏好设置面板 } from './ui/preferences'
import { 侧边栏 as 侧边栏组件 } from './ui/sidebar'
import { 提取标题, 定位当前标题, type 标题项 } from './ui/outline'
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
import { 独立撤销 } from './editor/独立撤销'

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
  view.setState(EditorState.create({ doc: text, extensions: 编辑器扩展() }))
  view.dispatch({ selection: { anchor: 0 } })
}

// ---------------------------------------------------------------------------
// 多文档标签
// ---------------------------------------------------------------------------

const 标签集 = new 标签管理器()

/**
 * 落盘当前标签的编辑器状态。
 *
 * CodeMirror 的文档内容与撤销历史都住在 `EditorState` 里，视图里只有"当前那一份"。
 * 任何替换视图状态的操作之前都必须先调用它——漏掉的后果是
 * **静默丢掉用户未保存的改动**，没有任何报错。
 */
function 落盘当前标签(项: 标签): void {
  项.编辑器状态 = view.state
}

/** 当前文档的目录；未保存时为 null。图片相对路径与文件树都依赖它。 */
async function 当前文档目录(): Promise<string | null> {
  const 路径 = doc.current.path
  if (!路径) return null
  return window.selfmdExtra.path.dirname(路径)
}

/**
 * 切到某个标签。
 *
 * 顺序很重要：**先设图片基准目录，再换编辑器状态**。
 * 文档内容一进编辑器就会构建装饰，那时若基准目录还是上一篇的，
 * 图片会先渲染成"无法显示"，要等重绘才恢复——表现为图片闪一下。
 */
async function 切换标签(标识: number): Promise<void> {
  const 目标 = 标签集.切换(标识, 落盘当前标签)
  if (!目标) return
  doc.采用状态(目标.状态)
  设置文档目录(await 当前文档目录())
  view.setState(目标.编辑器状态)
  updateTitle()
  刷新标签相关界面()
  view.focus()
}

/** 循环切换，用于"应用内窗口切换"。 */
async function 循环标签(方向: 1 | -1): Promise<void> {
  const 目标 = 标签集.循环(方向, 落盘当前标签)
  if (!目标) {
    toast('只有一个文档，无需切换')
    return
  }
  doc.采用状态(目标.状态)
  设置文档目录(await 当前文档目录())
  view.setState(目标.编辑器状态)
  updateTitle()
  刷新标签相关界面()
  view.focus()
}

/** 关闭一个标签。 */
async function 关闭标签(标识: number): Promise<void> {
  const 目标 = 标签集.列表.find((t) => t.标识 === 标识)
  if (!目标) return
  if (!标签集.可以关闭) {
    toast('至少要保留一个文档')
    return
  }

  // 未保存的改动只有这里能备份下来，所以内容必须在这一刻取
  const 是当前的 = 标签集.当前?.标识 === 标识
  const 内容 = 是当前的 ? currentText() : 目标.编辑器状态.doc.toString()

  if (目标.状态.dirty) {
    const 确认 = await window.selfmd.dialog.message({
      type: 'question',
      title: '关闭文档',
      message: `「${目标.状态.name}」有未保存的改动`,
      detail: '关闭后可以用「重新打开关闭的文件」找回内容，但不会写回磁盘。',
      buttons: ['关闭', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    if (确认.response !== 0) return
  }

  const 要切到 = 标签集.关闭(标识, 内容, 落盘当前标签)
  if (!要切到) return
  doc.采用状态(要切到.状态)
  设置文档目录(await 当前文档目录())
  view.setState(要切到.编辑器状态)
  updateTitle()
  刷新标签相关界面()
}

/**
 * 标签变动后刷新依赖它的界面。
 *
 * 抽成一处而不是散在各个调用点：漏掉任何一处都会表现为
 * "侧边栏还列着刚关掉的文档"这类看着像缓存的问题。
 */
function 刷新标签相关界面(): void {
  侧边栏?.设置文档列表(
    标签集.列表.map((t) => ({
      标识: t.标识,
      名字: t.状态.name,
      脏: t.状态.dirty,
      当前: t.标识 === 标签集.当前?.标识
    }))
  )
  // 换文档后文件树要跟着换根目录，大纲也要重算
  侧边栏?.刷新文件树()
  刷新大纲(true)
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
function 当前插入请求(): 插入请求 | null {
  if (!view) return null
  return {
    视图: view,
    文档路径: doc.current.path,
    文档文本: view.state.doc.toString(),
    设置: settings
  }
}

/** 编辑器扩展集合。集中一处，避免"两个 EditorState.create 参数不一致"。 */
function 编辑器扩展(): Extension[] {
  return [
    ...baseExtensions({ settings, onChange: onEditorChange }),
    modeCompartment.of(modeExtensions(settings)),
    图片粘贴与拖放({
      构造请求: 当前插入请求,
      提示: (消息) => toast(消息, 'error')
    }),
    // 大纲跟随光标与文档变化。
    //
    // 文档变了要重算标题；只是光标移动则复用缓存——重算要遍历整棵语法树，
    // 而光标移动在打字时每按一次键都会发生。
    EditorView.updateListener.of((更新) => {
      if (更新.docChanged) {
        刷新大纲(true)
        安排自动保存()
      } else if (更新.selectionSet) {
        刷新大纲(false)
        // 打字机模式：光标换行时把该行重新滚到垂直中央。
        // 只在**行号真的变了**时才滚——否则在一行内左右移动光标也会触发滚动，
        // 用户会看到画面无谓地跳动。
        if (settings.typewriterMode) {
          const 旧行 = 更新.startState.doc.lineAt(更新.startState.selection.main.head).number
          const 新行 = 更新.state.doc.lineAt(更新.state.selection.main.head).number
          if (旧行 !== 新行) 居中光标行(更新.view)
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
function 应用编辑模式(): void {
  document.body.classList.toggle('on-focus-mode', settings.focusMode)
  document.body.classList.toggle('selfmd-typewriter-mode', settings.typewriterMode)
  // 公式与标点开关不在 body 类上，因为它们决定的是"装饰怎么建"而不是
  // "怎么显示"，改了必须重绘才能生效。调用方负责在改完之后 dispatch 一次空事务。
  设置行内公式启用(settings.enableInlineMath)
  设置渲染标点启用(settings.smartPunctuationMode === 'rendering')
}

/**
 * 偏好设置面板。
 *
 * 写成单例并在模块级创建：它需要在"设置变更"时刷新自己以反映外部改动
 * （例如菜单里切了主题），面板本身不该反复重建。
 */
const 偏好设置 = new 偏好设置面板({
  取设置: () => settings,
  应用设置: async (补丁) => {
    // 走主进程 patch，不直接改本地对象：渲染层的 settings 只是缓存，
    // 任何一次设置广播都会覆盖它。
    settings = await window.selfmd.settings.patch(补丁)
    applyTheme(settings)
    应用编辑模式()
    刷新模式相关界面()
    return settings
  },
  取只读值: (键) => (键 === 'theme' ? 生效主题(settings) : null)
})

/** 设置变化后需要跟着更新的界面。 */
function 刷新模式相关界面(): void {
  statusBar?.setVisible(settings.showStatusBar)
  偏好设置.刷新()
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

let 自动保存计时器: ReturnType<typeof setTimeout> | null = null

/**
 * 安排一次自动保存。
 *
 * 每次改动都重置计时器，所以连续打字期间不会写盘——只在**停下来之后**写一次。
 * 自动保存关掉时直接返回，但不清掉已有的待写草稿：用户可能在打字中途关掉开关，
 * 那部分内容仍然值得落一次盘。
 */
function 安排自动保存(): void {
  if (!settings.autoSave) return
  if (自动保存计时器 !== null) clearTimeout(自动保存计时器)
  自动保存计时器 = setTimeout(() => {
    自动保存计时器 = null
    void 立即保存草稿()
  }, 自动保存延迟)
}

/** 立刻把当前内容写成草稿（切换文档、关窗、以及防抖到期时调用）。 */
async function 立即保存草稿(): Promise<void> {
  if (!view) return
  const 计时器 = 自动保存计时器
  if (计时器 !== null) {
    clearTimeout(计时器)
    自动保存计时器 = null
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
  let 待恢复: 草稿信息[] = []
  try {
    待恢复 = await window.selfmd.draft.pending()
  } catch {
    return
  }
  if (待恢复.length === 0) return

  const 明细 = 待恢复
    .slice(0, 6)
    .map((草稿) => {
      const 名 = 草稿.原路径 ? 草稿.原路径.split(/[\\/]/).pop() : '未命名文档'
      const 时间 = new Date(草稿.保存时间).toLocaleString('zh-Hans')
      return `${名}（${草稿.草稿字符数} 字符，${时间}）`
    })
    .join('\n')

  const 答复 = await window.selfmd.dialog.message({
    type: 'question',
    title: '恢复未保存的内容',
    message: `发现 ${待恢复.length} 份未保存的内容`,
    detail: `${明细}\n\n是否恢复？\n· 恢复：打开最后一份草稿的内容\n· 丢弃：删除全部草稿`,
    buttons: ['恢复', '稍后再说', '丢弃'],
    defaultId: 0,
    cancelId: 1
  })

  if (答复.response === 2) {
    for (const 草稿 of 待恢复) await window.selfmd.draft.discard(草稿.键)
    toast('已丢弃全部草稿')
    return
  }
  if (答复.response !== 0) return

  // 恢复最近的一份：把内容放进当前编辑器。
  // 原文件存在时不直接覆盖磁盘——让用户先看到内容再自己决定保存。
  const 最新 = 待恢复[0]
  const 内容 = await window.selfmd.draft.read(最新.键)
  if (内容 === null) {
    toast('读取草稿失败', 'error')
    return
  }

  if (最新.原路径) {
    // 有原文件：打开它，然后把草稿内容覆盖到编辑器里（磁盘不动）
    await openPath(最新.原路径)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 内容 },
      annotations: 独立撤销
    })
    doc.markDirty()
    updateTitle()
    toast(`已恢复「${最新.原路径.split(/[\\/]/).pop()}」的未保存内容，确认后请保存`)
  } else {
    标签集.存当前(view.state)
    setDocument(内容)
    标签集.加入(doc.导出状态(), view.state)
    doc.markDirty()
    updateTitle()
    刷新标签相关界面()
    toast('已恢复未命名文档的内容，确认后请保存')
  }
}

// ---------------------------------------------------------------------------
// 侧边栏与大纲
// ---------------------------------------------------------------------------

let 侧边栏: 侧边栏组件 | null = null
let 标题缓存: 标题项[] = []

/**
 * 重绘大纲并把"当前标题"高亮对齐到光标。
 *
 * @param 重算 是否重新遍历语法树取标题。光标移动时传 false 复用缓存。
 */
function 刷新大纲(重算: boolean): void {
  if (!侧边栏 || !view) return
  if (重算) 标题缓存 = 提取标题(view.state)
  侧边栏.setOutline(标题缓存, 定位当前标题(标题缓存, view.state.selection.main.head))
  if (重算) 侧边栏.高亮当前文件(doc.current.path)
}

/**
 * 主题系统的端到端自测。
 *
 * 验证协议层能服务主题目录下的**任意文件**，而不仅是 `<主题名>.css`——
 * 主题的字体、图片、深色子样式表都靠这一点。同时验证目录穿越被挡住。
 */
async function 运行主题自测(): Promise<string> {
  const 取 = async (路径: string): Promise<string> => {
    try {
      const 响应 = await fetch(`selfmd://theme/${路径}`)
      return String(响应.status)
    } catch {
      return '异常'
    }
  }
  const 主题本体 = await 取('__冒烟__.css')
  const 子目录资源 = await 取('__冒烟__/子样式.css')
  const 不存在 = await 取('这个文件不存在.css')
  const 穿越 = await 取('../package.json')

  // --- 内置主题是否真的装上了 -------------------------------------------
  //
  // 主题"装了没有"这件事会静默出错：文件没写进 `<userData>/themes`、
  // 元数据里的 `@name` 解析失败、深色标记判错——三种情况在界面上
  // 都只表现为"下拉框里少一项"或"名字变成文件名"，不会报任何错。
  // 所以真的列一次，把 id、显示名、深色标记都数出来。
  const 主题们 = await window.selfmd.theme.list()
  const 内置 = 主题们.filter((t) => t.builtin)
  const 描述 = 内置
    .map((t) => `${t.id}=${t.name}${t.isDark ? '(暗)' : ''}`)
    .sort()
    .join(' ')

  // 三款内置主题都要能通过协议读到正文（不是 404 也不是空文件）
  const 可读 = await Promise.all(
    内置.map(async (t) => {
      const 状态 = await 取(`${t.id}.css`)
      return 状态 === '200'
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
  const 取值 = (名: string): string => 根样式.getPropertyValue(名).trim()
  const 主题链接 = document.getElementById('theme-css') as HTMLLinkElement | null
  const 生效值 = [
    `底色=${取值('--bg-color')}`,
    `文字=${取值('--text-color')}`,
    `字号=${取值('--font-size')}`,
    `行高=${取值('--line-height')}`,
    `版心=${取值('--content-max-width')}`
  ].join(' ')

  // 样式表是否真的解析出了规则。跨源样式表读 cssRules 会抛，
  // 但 ours 是同源协议，读得到——读不到就说明它根本没加载成功。
  //
  // **逐个列出**而不是只报一个数：三层里有两层（base.user / <主题>.user）
  // 默认是不存在的文件，只报一个总数会分不清"哪一层出问题"。
  const 样式表 = Array.from(document.styleSheets).map((s) => {
    const 名 = (s.href ?? '(内联)').split('/').slice(-1)[0] || '(内联)'
    let 数 = '?'
    try {
      数 = String(s.cssRules.length)
    } catch {
      数 = 'X'
    }
    return `${名}:${数}`
  })
  const 规则数 = 样式表.join(',')

  // 主题那份样式表里第一条规则到底写了什么——如果它解析成了空规则，
  // 这里会露出来，而不是仅仅表现为"颜色没变"。
  let 首条规则 = '无'
  try {
    const 片 = Array.from(document.styleSheets).find(
      (s) => s.href && s.href.includes('/theme/') && s.cssRules.length > 0
    )
    if (片) 首条规则 = 片.cssRules[0].cssText.slice(0, 60).replace(/\s+/g, ' ')
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
    await new Promise((完成) => setTimeout(完成, 150))
    const 值 = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim()
    采样.push(`${试}=${值}`)
  }
  settings = await window.selfmd.settings.patch({ theme: 原主题 })
  applyTheme(settings)
  await new Promise((完成) => setTimeout(完成, 150))

  // 三款主题的底色**互不相同**才算"切换真的生效"。
  // 有一对相同就可能只是巧合（比如两款都被人改成了同一个颜色），
  // 但三者全同必然说明主题根本没起作用。
  const 底色们 = 采样.map((s) => s.split('=')[1])
  const 互不相同 = new Set(底色们).size === 底色们.length

  return (
    `主题本体=${主题本体} 子目录资源=${子目录资源} ` +
    `缺失文件=${不存在} 目录穿越=${穿越} ` +
    `内置=${内置.length} 明细=${描述} 全部可读=${可读.every(Boolean)} ` +
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
  const 宿主 = document.getElementById('sidebar')
  if (!侧边栏 || !宿主) return '侧边栏未初始化'

  侧边栏.setTab('outline')
  侧边栏.setVisible(true)
  刷新大纲(true)
  // 让 push 到 DOM 的微任务先跑完再数
  await new Promise((完成) => setTimeout(完成, 0))

  const 大纲项 = 宿主.querySelectorAll('.outline-item').length
  const 激活项 = 宿主.querySelectorAll('.outline-item.active').length

  // 文件树依赖真实磁盘目录；样本文件在 fixtures/ 下，应当能读出来
  侧边栏.setTab('files')
  await 侧边栏.刷新文件树()
  await new Promise((完成) => setTimeout(完成, 0))
  const 文件项 = 宿主.querySelectorAll('.file-list-item').length

  侧边栏.setTab('outline')

  return (
    `标题数=${标题缓存.length} 大纲项=${大纲项} 高亮项=${激活项} ` +
    `文件树根=${侧边栏.当前根目录 ? '已定位' : '无'} 文件项=${文件项}`
  )
}

/** 命令 id → 导出格式。 */
function 命令到导出格式(命令: string): string {
  switch (命令) {
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
function 去掉扩展名(路径: string): string {
  const 名 = 路径.split(/[\\/]/).pop() ?? 路径
  return 名.replace(/\.[^.]+$/, '')
}

/**
 * 未保存的文档没有文件名，用首个非空行当标题。
 *
 * 比直接用"未命名文档"好：用户刚写完一段打算导出，默认名就是他写的标题，
 * 直接回车即可。
 */
function 首行作标题(文本: string): string {
  for (const 行 of 文本.split('\n')) {
    const 干净 = 行.replace(/^#+\s*/, '').trim()
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
  await new Promise((完成) => setTimeout(完成, 0))

  settings = await window.selfmd.settings.patch({ focusMode: true, typewriterMode: false })
  应用编辑模式()
  await new Promise((完成) => setTimeout(完成, 0))
  const 专注行数 = document.querySelectorAll('.cm-line.md-focus').length
  const 有专注类 = document.body.classList.contains('on-focus-mode')
  const 专注时无打字机类 = !document.body.classList.contains('selfmd-typewriter-mode')

  settings = await window.selfmd.settings.patch({ focusMode: false, typewriterMode: true })
  应用编辑模式()
  const 有打字机类 = document.body.classList.contains('selfmd-typewriter-mode')

  // 拼写检查走的是"设置 → 内容元素的属性"，与上面两个走 body 类的不同。
  // 这条链路任何一环断了都不会报错——只是红波浪线不出现，
  // 而用户多半会以为"这个词本来就拼对了"。
  settings = await window.selfmd.settings.patch({ spellCheck: true })
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(settings)) })
  await new Promise((完成) => setTimeout(完成, 0))
  const 拼写开启 = document.querySelector('.cm-content')?.getAttribute('spellcheck')

  settings = await window.selfmd.settings.patch({ spellCheck: false })
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(settings)) })
  await new Promise((完成) => setTimeout(完成, 0))
  const 拼写关闭 = document.querySelector('.cm-content')?.getAttribute('spellcheck')

  // 恢复
  settings = await window.selfmd.settings.patch({
    focusMode: 原始专注,
    typewriterMode: 原始打字
  })
  应用编辑模式()

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
  偏好设置.打开()
  await new Promise((完成) => setTimeout(完成, 0))

  const 遮罩 = document.querySelector('.selfmd-prefs')
  if (!遮罩) return '面板未渲染'

  const 分区数 = 遮罩.querySelectorAll('.prefs-tab').length
  const 首屏行数 = 遮罩.querySelectorAll('.prefs-row').length

  // 搜索：跨分区平铺
  const 搜索 = 遮罩.querySelector('.prefs-search') as HTMLInputElement | null
  let 搜索命中 = -1
  if (搜索) {
    搜索.value = '字体'
    搜索.dispatchEvent(new Event('input'))
    await new Promise((完成) => setTimeout(完成, 0))
    搜索命中 = 遮罩.querySelectorAll('.prefs-row').length
  }

  // 清空搜索后应回到分类视图
  if (搜索) {
    搜索.value = ''
    搜索.dispatchEvent(new Event('input'))
    await new Promise((完成) => setTimeout(完成, 0))
  }
  const 清空后行数 = 遮罩.querySelectorAll('.prefs-row').length

  偏好设置.关闭()
  const 残留 = document.querySelectorAll('.selfmd-prefs').length

  return (
    `分区=${分区数} 首屏行=${首屏行数} 搜索命中=${搜索命中} ` +
    `清空后行=${清空后行数} 关闭后残留=${残留}`
  )
}

/** 刷新图片显示所需的基准目录。文档切换或另存为之后都要调。 */
async function 刷新图片基准目录(): Promise<void> {
  const 文档 = doc.current.path
  if (!文档) {
    设置文档目录(null)
    return
  }
  // 相对路径（`图/样本.png`）要拼到文档所在目录上才找得到文件。
  // 这一步漏了的话，图片会全部显示成"无法显示"，而 Markdown 语法完全正确。
  设置文档目录(await window.selfmdExtra.path.dirname(文档))
}

/**
 * 注册图片右键处理器与目录提供者。
 *
 * 放在 boot 里而不是模块顶层：处理器要用 `view`，而 `view` 是启动时才建的。
 */
function 安装图片右键(): void {
  // 图片操作模块需要知道当前文档目录才能解析相对路径。
  // 用提供者函数而不是把目录传进去，是为了让它始终读到最新值。
  设置目录提供者(() => 取文档目录())

  设置图片右键处理器((事件, _原地址, _替代, 元素) => {
    void 打开图片菜单(事件, 元素)
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
  const 量 = async (目标: HTMLElement | null): Promise<string> => {
    if (!目标) return '缺失'
    const 事件 = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100
    })
    目标.dispatchEvent(事件)
    await new Promise((完成) => setTimeout(完成, 0))
    const 菜单 = document.querySelector('.selfmd-menu')
    if (!菜单) return '未弹出'
    const 项数 = 菜单.querySelectorAll('.selfmd-menu-item').length
    const 禁用数 = 菜单.querySelectorAll('.selfmd-menu-item.disabled').length
    const 分隔数 = 菜单.querySelectorAll('.selfmd-menu-sep').length
    关闭菜单()
    return `${项数}/${禁用数}/${分隔数}`
  }

  // 本地图片：上传、重命名、复制、删除都应当可用
  const 本地 = 全部图.find((图) => !/^https?:/i.test(图.dataset.src ?? '')) ?? null
  // 远程图片：那几项必须置灰——点下去只会弹一句"没有本地文件"
  const 远程 = 全部图.find((图) => /^https?:/i.test(图.dataset.src ?? '')) ?? null

  const 本地统计 = await 量(本地)
  const 远程统计 = await 量(远程)

  await new Promise((完成) => setTimeout(完成, 0))
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
function 构建编辑器右键菜单(): 菜单项[] {
  const 区 = view.state.selection.main
  const 有选区 = 区.from !== 区.to
  const 只读 = view.state.readOnly

  const 转 = (id: string, 文字: string, 提示?: string, 禁用?: boolean): 菜单项 => ({
    文字,
    提示,
    禁用,
    动作: () => void runCommand({ command: id })
  })

  return [
    转('edit.undo', '撤消', 'Ctrl+Z'),
    转('edit.redo', '重做', 'Ctrl+Shift+Z'),
    { 分隔: true },
    转('edit.cut', '剪切', 'Ctrl+X', !有选区),
    转('edit.copy', '复制', 'Ctrl+C', !有选区),
    转('edit.paste', '粘贴', 'Ctrl+V', 只读),
    转('edit.pasteAsPlainText', '粘贴为纯文本', 'Ctrl+Shift+V', 只读),
    { 分隔: true },

    {
      文字: '段落',
      子项: [
        转('para.h1', '一级标题', 'Ctrl+1'),
        转('para.h2', '二级标题', 'Ctrl+2'),
        转('para.h3', '三级标题', 'Ctrl+3'),
        转('para.h4', '四级标题'),
        转('para.h5', '五级标题'),
        转('para.h6', '六级标题'),
        { 分隔: true },
        转('para.headingUp', '提升标题级别'),
        转('para.headingDown', '降低标题级别'),
        { 分隔: true },
        转('para.quote', '引用'),
        转('para.unorderedList', '无序列表'),
        转('para.orderedList', '有序列表'),
        转('para.taskList', '任务列表'),
        { 分隔: true },
        转('para.codeFences', '代码块', 'Ctrl+Shift+K'),
        转('para.mathBlock', '公式块'),
        转('para.table', '表格'),
        转('para.horizontalLine', '水平分割线')
      ]
    },

    {
      文字: '格式',
      子项: [
        转('fmt.strong', '加粗', 'Ctrl+B'),
        转('fmt.emphasis', '斜体', 'Ctrl+I'),
        转('fmt.underline', '下划线'),
        转('fmt.strike', '删除线', 'Alt+Shift+5'),
        转('fmt.highlight', '高亮'),
        转('fmt.code', '行内代码', 'Ctrl+Shift+`'),
        转('fmt.inlineMath', '行内公式'),
        { 分隔: true },
        转('fmt.superscript', '上标'),
        转('fmt.subscript', '下标'),
        { 分隔: true },
        转('fmt.hyperlink', '超链接', 'Ctrl+K'),
        转('fmt.clear', '清除格式')
      ]
    },

    {
      文字: '插入',
      子项: [
        转('image.insertLocal', '插入本地图片'),
        转('image.insertFromUrl', '插入网络图片'),
        { 分隔: true },
        转('edit.copyAsMarkdown', '复制为 Markdown'),
        转('edit.copyAsHtmlCode', '复制为 HTML 代码'),
        转('edit.copyAsImage', '复制为图片')
      ]
    },

    { 分隔: true },
    转('edit.selectAll', '全选', 'Ctrl+A'),
    转('edit.selectBlock', '选择段落或块'),
    { 分隔: true },
    转('edit.find', '查找', 'Ctrl+F'),
    转('edit.findAndReplace', '查找和替换', 'Ctrl+H')
  ]
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
  await new Promise((完成) => setTimeout(完成, 60))

  const 事件 = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 200,
    clientY: 200
  })
  view.dom.dispatchEvent(事件)
  await new Promise((完成) => setTimeout(完成, 80))

  const 菜单 = document.querySelector('.selfmd-menu')
  if (!菜单) return '菜单未弹出'

  const 顶层项 = 菜单.querySelectorAll('.selfmd-menu-item').length
  // 没有选区时，剪切与复制应当置灰
  const 置灰数 = 菜单.querySelectorAll('.selfmd-menu-item.disabled').length
  const 有子菜单 = 菜单.querySelectorAll('.selfmd-menu-item.has-submenu').length
  const 被拦截 = 事件.defaultPrevented ? '是' : '否'

  // 展开第一个可用的子菜单
  const 带子项 = Array.from(菜单.querySelectorAll('.selfmd-menu-item.has-submenu')).find(
    (el) => !el.classList.contains('disabled')
  ) as HTMLElement | undefined

  let 子菜单项数 = 0
  let 挂在Body = '无子菜单'
  if (带子项) {
    带子项.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    await new Promise((完成) => setTimeout(完成, 80))
    const 子 = document.querySelector('.selfmd-submenu')
    子菜单项数 = 子 ? 子.querySelectorAll('.selfmd-menu-item').length : 0
    // 子菜单必须挂在 body 上而不是父菜单里——挂在里面会被父菜单裁掉，
    // 也会被"点空白处关闭"的逻辑误判成点到了外面
    挂在Body = 子 ? (子.parentElement === document.body ? '是' : '否') : '无子菜单'
  }

  // Esc 关闭并检查残留
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((完成) => setTimeout(完成, 60))
  const 残留 = document.querySelectorAll('.selfmd-menu, .selfmd-submenu').length

  return (
    `顶层项=${顶层项} 置灰=${置灰数} 有子菜单=${有子菜单} ` +
    `子菜单项=${子菜单项数} 挂在Body=${挂在Body} 拦截默认菜单=${被拦截} 关闭后残留=${残留}`
  )
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
  const 原文 = ['开头段落。', '', '```js', 'const 甲 = 1', 'const 乙 = 2', '```', '', '结尾段落。'].join(
    '\n'
  )

  // 用独立的临时文档，测完恢复现场
  const 备份 = view.state
  view.setState(EditorState.create({ doc: 原文, extensions: 编辑器扩展() }))
  设置文档目录(null)
  await new Promise((完成) => setTimeout(完成, 80))

  // 语法树里找围栏，取最后一行代码的位置（不是围栏行）
  const 树 = syntaxTree(view.state)
  let 围栏: { from: number; to: number } | null = null
  树.iterate({
    enter: (n) => {
      if (n.name === 'FencedCode' && !围栏) 围栏 = { from: n.from, to: n.to }
    }
  })

  let 围栏可见 = '未测'
  let 跳出后位置 = '未测'
  let 跳出后打字不进块 = '未测'

  if (围栏) {
    const 块 = 围栏 as { from: number; to: number }
    // 光标落在**最后一行代码**上——正是用户会以为自己"已经在外面"的位置
    const 最后代码位置 = view.state.doc.lineAt(块.to).from - 1
    view.dispatch({ selection: { anchor: Math.max(块.from, 最后代码位置) } })
    await new Promise((完成) => setTimeout(完成, 80))

    // 闭合围栏那一行的 DOM 里还看得见 ``` 吗
    const 代码行 = Array.from(document.querySelectorAll('.cm-lp-code'))
    const 末行文本 = 代码行.length > 0 ? (代码行[代码行.length - 1].textContent ?? '') : ''
    围栏可见 = 末行文本.includes('```') ? '是' : '否'

    // Escape 跳出
    const 成功 = 跳出代码块(view)
    await new Promise((完成) => setTimeout(完成, 80))
    const 新光标 = view.state.selection.main.head
    跳出后位置 = 成功 && 新光标 > 块.to ? '围栏之后' : `否(${新光标} vs ${块.to})`

    // 在跳出去的位置打一个字，再确认它落在代码块之外
    view.dispatch({ changes: { from: 新光标, insert: '尾' } })
    await new Promise((完成) => setTimeout(完成, 60))
    const 打完 = view.state.doc.toString()
    const 块末 = 打完.indexOf('```', 打完.indexOf('```') + 3)
    跳出后打字不进块 = 块末 >= 0 && 打完.indexOf('尾') > 块末 ? '是' : '否'
  }

  // 恢复现场
  view.setState(备份)
  await new Promise((完成) => setTimeout(完成, 60))

  return `闭合围栏可见=${围栏可见} 跳出后位置=${跳出后位置} 跳出后打字不进块=${跳出后打字不进块}`
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
  偏好设置.打开()
  await new Promise((完成) => setTimeout(完成, 60))

  const 根样式 = getComputedStyle(document.documentElement)
  const 令牌 = ['--ease', '--ease-press', '--dur-quick', '--dur-base']
    .map((名) => `${名.replace('--', '')}=${根样式.getPropertyValue(名).trim() || '空'}`)
    .join(' ')

  /** 取某个元素的计算过渡时长（秒 → 毫秒）。 */
  const 过渡时长 = (选择器: string): string => {
    const el = document.querySelector(选择器)
    if (!el) return '找不到'
    const 值 = getComputedStyle(el).transitionDuration
    if (!值) return '无'
    const 毫秒 = 值
      .split(',')
      .map((段) => Number.parseFloat(段) * (段.includes('ms') ? 1 : 1000))
    return `${Math.max(...毫秒)}ms`
  }

  const 取样 = [
    `按钮=${过渡时长('.selfmd-btn')}`,
    `标签=${过渡时长('.prefs-tab')}`,
    `输入=${过渡时长('.prefs-search')}`
  ].join(' ')

  // 过渡属性里必须包含 background-color 与 transform：
  // 只过渡颜色的话，按压仍然是没有反馈的硬跳。
  let 属性齐 = '未测'
  const 按钮 = document.querySelector('.selfmd-btn')
  if (按钮) {
    const 属性 = getComputedStyle(按钮).transitionProperty
    属性齐 = 属性.includes('background-color') && 属性.includes('transform') ? '是' : `否(${属性})`
  }

  // 焦点环：`:focus-visible` 只在键盘导航时命中，所以这里用键盘模拟验证。
  // 直接读 :focus 会读到鼠标点击的情况，那本来就不该有环。
  let 有焦点环 = '未测'
  const 可聚焦 = document.querySelector('.prefs-tab') as HTMLElement | null
  if (可聚焦) {
    可聚焦.focus()
    const 阴影 = getComputedStyle(可聚焦).boxShadow
    有焦点环 = 阴影 && 阴影 !== 'none' ? '是' : '否'
    可聚焦.blur()
  }

  偏好设置.关闭()
  await new Promise((完成) => setTimeout(完成, 60))

  return `${令牌} ${取样} 属性齐=${属性齐} 焦点环=${有焦点环} 面板已关=${!偏好设置.是否打开}`
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
  const 起始数量 = 标签集.数量
  const 起始文本 = currentText()
  const 起始路径 = doc.current.path
  const 起始标识 = 标签集.当前?.标识 ?? -1

  // --- 1) 在甲文档末尾追加一段可识别的标记 ---
  const 甲标记 = `【甲${Date.now() % 100000}】`
  view.dispatch({ changes: { from: view.state.doc.length, insert: `\n${甲标记}` } })
  const 甲文本 = currentText()
  const 甲里有没有 = 甲文本.includes(甲标记)

  // --- 2) 新建乙文档 ---
  // 顺序：先写回当前标签，再换视图状态。反了就会丢掉甲的改动。
  标签集.存当前(view.state)
  doc.newDocument()
  view.setState(EditorState.create({ doc: '【乙】\n', extensions: 编辑器扩展() }))
  设置文档目录(null)
  const 乙 = 标签集.加入(doc.导出状态(), view.state)
  const 乙标识 = 乙.标识
  const 新建后数量 = 标签集.数量
  // --- 3) 切回甲 ---
  if (起始标识 >= 0) await 切换标签(起始标识)
  const 切回后文本 = currentText()
  // 这一条就是整个测试的重点
  const 切回后标记还在 = 切回后文本.includes(甲标记)
  const 切回后长度对 = 切回后文本.length === 甲文本.length

  // --- 4) 再切到乙，确认乙的内容也没被甲的覆盖 ---
  // 用记下来的标识，不要用"不是起始标识的那个"去找——
  // 起始时可能已经有多个标签，那样会切到一个无关的文档上，
  // 断言就会因为选错了对象而失败。
  await 切换标签(乙标识)
  const 乙回来看 = currentText()

  // --- 5) 撤销历史是否独立：在乙里撤销，不该动到甲 ---
  // 乙是新建的空文档，撤销会回到空；甲的内容不该受影响
  const 乙撤销前 = currentText()
  view.dispatch({ changes: { from: 0, insert: '临时' } })
  undo(view)
  const 乙撤销后 = currentText()
  const 撤销只影响乙 = 乙撤销后 === 乙撤销前

  // --- 6) 关闭与重开 ---
  await 关闭标签(乙标识)
  const 关闭后数量 = 标签集.数量
  const 可重开 = 标签集.可以重开

  // --- 7) 同一个文件不开两份 ---
  let 去重可用 = '未测'
  if (起始路径) {
    const 关前 = 标签集.数量
    await openPath(起始路径)
    去重可用 = 标签集.数量 === 关前 ? '是' : `否(${关前}→${标签集.数量})`
  }

  // --- 恢复现场 ---
  if (标签集.当前 && 标签集.当前.标识 !== 起始标识 && 起始标识 >= 0) {
    await 切换标签(起始标识)
  }
  // 把甲文档恢复成测试前的样子
  if (currentText() !== 起始文本 && 标签集.当前) {
    view.setState(EditorState.create({ doc: 起始文本, extensions: 编辑器扩展() }))
    标签集.当前.编辑器状态 = view.state
  }
  刷新标签相关界面()

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
  const 短 = await window.selfmd.copyAsImage({
    源: 短文档,
    文档路径: null,
    宽度: 900
  })

  // 长文档应当明显更高。这一条用来抓"高度没量对、只截了窗口可视区"——
  // 那种情况下长文档与短文档会得到**一样高**的图。
  const 长文档 =
    '# 长图\n\n' +
    Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段，用来把内容撑高。\n`).join('\n')
  const 长 = await window.selfmd.copyAsImage({
    源: 长文档,
    文档路径: null,
    宽度: 900
  })

  // 检查剪贴板里真的有一张图（而不是只有返回值说得漂亮）
  const 剪贴板有图 = await window.selfmdExtra.clipboard.readText().then(
    () => true,
    () => false
  )

  return (
    `短=${短.成功 ? `${短.宽}×${短.高}` : `失败:${短.错误}`} ` +
    `长=${长.成功 ? `${长.宽}×${长.高}` : `失败:${长.错误}`} ` +
    `长图更高=${长.成功 && 短.成功 ? (长.高 > 短.高 ? '是' : '否') : '未测'} ` +
    `未截断=${!短.已截断 && !长.已截断} 剪贴板可用=${剪贴板有图}`
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
  const 上限 = Date.now() + 5000
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
    if (Date.now() > 上限) return
    await new Promise((完成) => window.setTimeout(完成, 50))
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
  const 上限 = Date.now() + 8000
  for (;;) {
    const 渲染中 = document.querySelectorAll('.cm-w-diagram[data-状态="渲染中"]').length
    if (渲染中 === 0) return
    if (Date.now() > 上限) return
    await new Promise((完成) => window.setTimeout(完成, 30))
  }
}

/**
 * 为副本找一个还没被占用的路径。
 *
 * 规则：`名字.md` → `名字 副本.md` → `名字 副本 2.md` → …
 * **绝不覆盖已存在的文件**——副本命令最基本的要求就是原件与已有文件都不受影响。
 */
async function 生成副本路径(原路径: string): Promise<string> {
  const 目录 = await window.selfmdExtra.path.dirname(原路径)
  const 全名 = await window.selfmdExtra.path.basename(原路径)
  // 扩展名按**最后一个点**切：`会议记录.2024.md` 的名字是 `会议记录.2024`
  const 点 = 全名.lastIndexOf('.')
  const 主名 = 点 > 0 ? 全名.slice(0, 点) : 全名
  const 扩展 = 点 > 0 ? 全名.slice(点) : ''

  for (let i = 1; i < 1000; i++) {
    const 后缀 = i === 1 ? ' 副本' : ` 副本 ${i}`
    const 候选 = await window.selfmdExtra.path.join(目录, `${主名}${后缀}${扩展}`)
    const 存在 = await window.selfmd.file.exists(候选)
    if (!存在) return 候选
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
  const 区 = view.state.selection.main
  if (区.from !== 区.to) return view.state.sliceDoc(区.from, 区.to)
  return view.state.doc.toString()
}

/** 把光标所在行整体替换成一段块级文本。 */
function 在当前行插入块(文本: string, 名称: string): void {
  const 行 = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({
    changes: { from: 行.from, to: 行.to, insert: 文本 },
    selection: { anchor: 行.from + 文本.length }
  })
  toast(`已插入${名称}`)
}

/** 追加内容到文末，并保证前面有一个空行。 */
function 追加到文末(文本: string): void {
  const 文 = view.state.doc.toString()
  const 需要空行 = 文.length > 0 && !文.endsWith('\n\n')
  const 前缀 = 需要空行 ? (文.endsWith('\n') ? '\n' : '\n\n') : ''
  view.dispatch({ changes: { from: view.state.doc.length, insert: 前缀 + 文本 } })
}

/** 找一个还没被用过的引用标记：a、b、c…用完了就 a1、a2… */
function 唯一引用标记(): string {
  const 文 = view.state.doc.toString()
  const 字母 = 'abcdefghijklmnopqrstuvwxyz'
  for (const 字 of 字母) {
    if (!new RegExp(`^\\[${字}\\]:`, 'm').test(文)) return 字
  }
  for (let i = 1; ; i++) {
    const 候选 = `a${i}`
    if (!new RegExp(`^\\[${候选}\\]:`, 'm').test(文)) return 候选
  }
}

/** 找下一个没被用过的脚注编号。 */
function 下一个脚注编号(): number {
  const 文 = view.state.doc.toString()
  for (let i = 1; ; i++) {
    if (!new RegExp(`^\\[\\^${i}\\]:`, 'm').test(文)) return i
  }
}

/** 把上传结果反馈给用户。 */
function 报告上传(结果: 回填结果): void {
  if (结果.改写数 === 0) {
    toast(结果.失败摘要 || '上传未产生任何改动', 'error')
    return
  }
  if (结果.失败数 > 0) {
    toast(`已上传并替换 ${结果.改写数} 处，另有 ${结果.失败数} 张失败：${结果.失败摘要}`)
    return
  }
  toast(`已上传并替换 ${结果.改写数} 处图片引用`)
}

/**
 * 图片右键菜单。
 *
 * 菜单项名称沿用 Markdown 编辑器里常见的说法。先根据点击位置反查文档里的 Image
 * 节点——查不到就整体置灰，而不是让用户点了没反应。
 */
async function 打开图片菜单(事件: MouseEvent, 元素: HTMLElement): Promise<void> {
  // 反查文档位置：widget 在编辑器里，posAtDOM 能算出它对应哪一段源码
  let 位置 = view.state.selection.main.head
  try {
    位置 = view.posAtDOM(元素)
  } catch {
    // widget 已被回收（用户点了别处）——退回光标位置
  }

  const 图片 = 取当前图片(view.state, 位置)
  const 是远程 = 图片 !== null && 图片.本地路径 === null
  const 是HTML = 图片 !== null && /^<img\b/i.test(图片.地址)

  const 项们: 菜单项[] = [
    {
      文字: '上传图片',
      禁用: 图片 === null || 是远程,
      动作: () => void 执行上传(图片 ? [图片] : [])
    },
    {
      文字: '上传所有本地图片',
      动作: () => void 执行上传(收集文档图片(view.state, true))
    },
    { 分隔: true },
    {
      文字: '转换图片语法',
      禁用: 图片 === null,
      提示: 是HTML ? 'HTML → Markdown' : 'Markdown → HTML',
      动作: () => {
        if (图片 && 转换图片语法(view, 图片)) toast('已转换图片语法')
      }
    },
    {
      文字: '重命名 / 移动图片到…',
      禁用: 图片 === null || 是远程,
      动作: () => void 执行重命名(图片)
    },
    {
      文字: '复制图片到…',
      禁用: 图片 === null || 是远程,
      动作: () => void 执行复制(图片)
    },
    { 分隔: true },
    {
      文字: '打开图片位置',
      禁用: 图片 === null || 是远程,
      动作: () => {
        if (图片?.本地路径) void window.selfmd.file.showInFolder(图片.本地路径)
      }
    },
    {
      文字: '在浏览器中打开图片',
      动作: () => {
        if (!图片) return
        // 本地图片用 selfmd:// 协议地址也能被系统浏览器打开
        const 地址 = 是远程 ? 图片.地址 : 解析图片地址(图片.地址)
        if (地址) void window.selfmd.file.openExternal(地址)
      }
    },
    {
      文字: '复制图片地址',
      禁用: 图片 === null,
      动作: async () => {
        if (!图片) return
        await window.selfmdExtra.clipboard.writeText(图片.地址)
        toast('已复制图片地址')
      }
    },
    { 分隔: true },
    {
      文字: '删除图片文件',
      危险: true,
      禁用: 图片 === null || 是远程,
      动作: () => void 执行删除文件(图片)
    }
  ]

  // 菜单里带一条"重新加载所有图片"：图片被外部程序改过之后，
  // 浏览器缓存可能还拿着旧内容，强制重绘一次即可。
  项们.push({ 分隔: true }, {
    文字: '重新加载所有图片',
    动作: () => {
      view.dispatch({})
      toast('已重新加载图片')
    }
  })

  弹出菜单({ x: 事件.clientX, y: 事件.clientY }, 项们)
}

/** 上传指定的图片（或全部），并回填文档里的引用。 */
async function 执行上传(图片们: 文档图片[]): Promise<void> {
  if (图片们.length === 0) {
    toast('没有可上传的本地图片。')
    return
  }
  toast(`正在上传 ${图片们.length} 张图片…`)
  报告上传(await 上传并回填(view, 图片们))
}

/** 重命名或移动图片：先问文件名，再问目标目录。 */
async function 执行重命名(图片: 图片上下文 | null): Promise<void> {
  if (!图片?.本地路径) return

  const 原名 = 建议文件名(图片)
  const 新名 = await 询问文本({
    标题: '重命名图片',
    初值: 原名,
    说明: '文件会被移动或重命名，文档里的引用会同步更新。'
  })
  if (!新名 || 新名 === 原名) return

  const 原目录 = await window.selfmdExtra.path.dirname(图片.本地路径)
  const 选择 = await window.selfmd.dialog.openFolder({
    title: '移动到目录（取消则留在原目录）',
    defaultPath: 原目录
  })
  const 目标 = 选择.canceled || !选择.folderPath ? 原目录 : 选择.folderPath

  const 结果 = await 重命名或移动图片(view, 图片, 目标, 新名)
  if (!结果.成功) {
    toast(结果.错误 ?? '移动失败', 'error')
    return
  }
  toast(`已移动到 ${结果.新地址}`)
  doc.markDirty()
  updateTitle()
}

/** 复制图片到指定目录。 */
async function 执行复制(图片: 图片上下文 | null): Promise<void> {
  if (!图片?.本地路径) return
  const 选择 = await window.selfmd.dialog.openFolder({ title: '复制图片到' })
  if (选择.canceled || !选择.folderPath) return

  const 结果 = await 复制图片到(view, 图片, 选择.folderPath)
  if (!结果.成功) {
    toast(结果.错误 ?? '复制失败', 'error')
    return
  }
  toast(`已复制到 ${结果.新地址}`)
  doc.markDirty()
  updateTitle()
}

/** 删除图片文件（进系统回收站）。 */
async function 执行删除文件(图片: 图片上下文 | null): Promise<void> {
  if (!图片?.本地路径) return

  const 答复 = await window.selfmd.dialog.message({
    type: 'warning',
    title: '删除图片文件',
    message: `确定要删除「${建议文件名(图片)}」吗？`,
    detail:
      '文件会被移到系统回收站，可以还原。\n' +
      '文档里的引用**不会**被删除——删掉之后该处会显示为加载失败。',
    buttons: ['删除', '取消'],
    defaultId: 1,
    cancelId: 1
  })
  if (答复.response !== 0) return

  const 结果 = await 删除图片文件(图片)
  if (!结果.成功) {
    toast(结果.错误 ?? '删除失败', 'error')
    return
  }
  toast('已移到回收站')
  // 重绘一次让那张图变成"加载失败"占位，用户能立刻看到后果
  view.dispatch({})
}

/** 把图片插入结果反馈给用户。 */
function 报告插入(结果: { 成功数: number; 错误: string | null }): void {
  if (结果.错误) {
    toast(结果.错误, 'error')
    return
  }
  if (结果.成功数 > 0) {
    toast(结果.成功数 === 1 ? '已插入图片' : `已插入 ${结果.成功数} 张图片`)
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
async function 运行图片插入自测(文档路径: string): Promise<string | undefined> {
  if (!/测试\.md$/.test(文档路径)) return undefined
  const 目录 = await window.selfmdExtra.path.dirname(文档路径)
  const 样本 = `${目录}/样本.png`
  if (!(await window.selfmd.image.exists(样本))) return '未找到测试图片'

  const 请求 = 当前插入请求()
  if (!请求) return '编辑器尚未就绪'

  const 结果 = await 从文件插入(请求, [样本])
  const 目标 = await 本次目标目录(请求)
  const 落盘名 = 目标 ? `${目标}/样本.png` : '(无目标目录)'
  const 已落盘 = 目标 ? await window.selfmd.image.exists(落盘名) : false

  const 文档 = view.state.doc.toString().replace(/\r?\n/g, '⏎')
  return (
    `成功=${结果.成功数} 错误=${结果.错误 ?? '无'} ` +
    `文件已落盘=${已落盘} 文档=${文档}`
  )
}

/**
 * 改写文档里的某个前置元数据属性。
 *
 * 走 `view.dispatch` 而不是直接改 `doc`，这样它是可撤销的——用户点了
 * "复制图片到文件夹"之后按 Ctrl+Z 应当能撤回，而不是被迫手工去删 YAML。
 */
function 改写前置元数据(键: string, 值: string | null): void {
  const 原文 = view.state.doc.toString()
  const 新文 = 值 === null ? 移除属性(原文, 键) : 写入属性(原文, 键, 值)
  if (新文 === 原文) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: 新文 },
    userEvent: 'input.frontMatter',
    annotations: 独立撤销
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
      标签集.存当前(view.state)
      doc.newDocument()
      view.setState(EditorState.create({ doc: '', extensions: 编辑器扩展() }))
      设置文档目录(null)
      标签集.加入(doc.导出状态(), view.state)
      updateTitle()
      刷新标签相关界面()
      view.focus()
      return

    case 'file.saveAll': {
      // 逐个保存**所有有改动的**文档。
      //
      // 保存非当前文档时不能走 `doc.save()`——那个写的是"当前文档"的路径。
      // 所以这里直接调底层写盘接口，绕过文档服务。
      const 待存 = 标签集.列表.filter((t) => t.状态.dirty)
      if (待存.length === 0) {
        toast('没有需要保存的文档')
        return
      }
      let 成功 = 0
      let 失败 = 0
      for (const 项 of 待存) {
        const 是当前的 = 项.标识 === 标签集.当前?.标识
        const 内容 = 是当前的 ? currentText() : 项.编辑器状态.doc.toString()
        // 未命名文档没有路径，交给"另存为"；那会弹对话框，
        // 所以只有当前文档才可能走到这条分支。
        if (!项.状态.path) {
          if (!是当前的) continue
          try {
            if (await doc.save(内容)) 成功++
          } catch {
            失败++
          }
          continue
        }
        try {
          await window.selfmd.doc.save(项.状态.path, 内容, 项.状态.lineEnding)
          项.状态.dirty = false
          成功++
        } catch {
          失败++
        }
      }
      // 当前文档的脏标记要走文档服务，否则标题栏不会更新
      if (标签集.当前 && !标签集.当前.状态.dirty) doc.markClean()
      updateTitle()
      刷新标签相关界面()
      toast(失败 > 0 ? `已保存 ${成功} 个，${失败} 个失败` : `已保存 ${成功} 个文档`, 失败 > 0 ? 'error' : 'info')
      return
    }

    case 'file.reopenClosed': {
      const 找回 = 标签集.取出已关闭()
      if (!找回) {
        toast('没有可重新打开的文档')
        return
      }
      // 路径还在磁盘上就从磁盘读（可能已被外部改动），否则用关闭时的备份。
      // **未保存的改动只有备份里有**，所以文件不存在时必须回退到备份。
      let 内容 = 找回.内容
      let 存在 = false
      if (找回.状态.path) {
        存在 = await window.selfmd.file.exists(找回.状态.path)
        if (存在) {
          try {
            内容 = (await window.selfmd.doc.openPath(找回.状态.path))?.content ?? 找回.内容
          } catch {
            内容 = 找回.内容
          }
        }
      }
      设置文档目录(找回.状态.path ? await window.selfmdExtra.path.dirname(找回.状态.path) : null)
      标签集.存当前(view.state)
      doc.采用状态({ ...找回.状态, dirty: !存在 && 找回.内容.length > 0 })
      view.setState(EditorState.create({ doc: 内容, extensions: 编辑器扩展() }))
      标签集.加入(doc.导出状态(), view.state)
      updateTitle()
      刷新标签相关界面()
      view.focus()
      toast(存在 ? '已重新打开' : '已从关闭时的内容恢复（原文件不在磁盘上）')
      return
    }

    case 'view.switchDocument':
      await 循环标签(1)
      return

    case 'view.articles':
      侧边栏?.setVisible(true)
      侧边栏?.setTab('articles')
      return

    case 'file.openQuickly': {
      // 索引的范围是**文件树当前的根目录**。没有根（未保存且没打开过文件夹）时
      // 退回当前文档所在目录；再没有就说明没有可搜的范围，直接说明白。
      const 根 = 侧边栏?.当前根目录 ?? (await 当前文档目录())
      if (!根) {
        toast('请先打开一个文件或文件夹，再使用快速打开。', 'error')
        return
      }
      await 打开快速打开面板({
        取文件: () => window.selfmdExtra.file.walk(根),
        打开: (路径) => void openPath(路径)
      })
      return
    }

    case 'file.exportSetting': {
      // 导出设置就是偏好设置里的「导出」分区。
      //
      // 不另做一个面板：`exportIncludeOutline` / `exportEmbedImages` 已经在
      // 偏好设置里了，再建一套界面就会出现"两个地方改同一件事"，
      // 而它们迟早会不同步。
      偏好设置.打开('导出')
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
        const 待存 = currentText()
        const 已保存路径 = doc.current.path
        if (await doc.save(待存)) {
          toast('已保存')
          await window.selfmd.draft.clearFor(已保存路径, 待存)
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
      const 原路径 = doc.current.path
      if (!原路径) {
        toast('当前文档尚未保存，请先保存再创建副本。', 'error')
        return
      }
      try {
        // 先把内存里的改动落盘，否则副本会是旧内容
        await doc.save(currentText())
        const 新路径 = await 生成副本路径(原路径)
        await window.selfmdExtra.file.copy(原路径, 新路径)
        await doc.open(新路径)
        updateTitle()
        toast(`已创建副本：${await window.selfmdExtra.path.basename(新路径)}`)
      } catch (错误) {
        toastError(错误, '创建副本失败')
      }
      return
    }

    case 'file.rename': {
      const 原路径 = doc.current.path
      if (!原路径) {
        toast('当前文档尚未保存，请先保存再重命名。', 'error')
        return
      }
      const 原名 = await window.selfmdExtra.path.basename(原路径)
      const 新名 = await 询问文本({
        标题: '重命名',
        说明: `当前文件名：${原名}`,
        初值: 原名,
        确定文字: '重命名'
      })
      if (!新名 || 新名 === 原名) return
      // 不允许带路径分隔符：这个输入框只改名字，改目录是「移动到」的事。
      // 不拦的话用户会以为能把文件挪到别处，而实际只会在文件名里多出几个字符。
      if (/[\\/]/.test(新名)) {
        toast('文件名里不能包含斜杠；要换目录请用「移动到」。', 'error')
        return
      }
      try {
        const 新路径 = await window.selfmdExtra.path.join(
          await window.selfmdExtra.path.dirname(原路径),
          新名
        )
        await doc.save(currentText())
        await window.selfmdExtra.file.rename(原路径, 新路径)
        await doc.open(新路径)
        updateTitle()
        toast(`已重命名为 ${新名}`)
      } catch (错误) {
        toastError(错误, '重命名失败')
      }
      return
    }

    case 'file.moveTo': {
      const 原路径 = doc.current.path
      if (!原路径) {
        toast('当前文档尚未保存，请先保存再移动。', 'error')
        return
      }
      const 结果 = await window.selfmd.dialog.openFolder({
        title: '移动到文件夹',
        defaultPath: await window.selfmdExtra.path.dirname(原路径)
      })
      if (结果.canceled || !结果.folderPath) return
      try {
        await doc.save(currentText())
        const 目标 = await window.selfmdExtra.path.join(
          结果.folderPath,
          await window.selfmdExtra.path.basename(原路径)
        )
        // 同目录移动是无操作；直接指出比让底层报一个含糊的错好
        if (目标 === 原路径) {
          toast('文件已经在该文件夹里')
          return
        }
        await window.selfmdExtra.file.move(原路径, 目标)
        await doc.open(目标)
        updateTitle()
        toast('已移动')
      } catch (错误) {
        toastError(错误, '移动失败')
      }
      return
    }

    case 'file.openFolder': {
      const 结果 = await window.selfmd.dialog.openFolder({ title: '打开文件夹' })
      if (结果.canceled || !结果.folderPath) return
      if (!侧边栏) {
        toast('侧边栏未就绪', 'error')
        return
      }
      侧边栏.设根目录(结果.folderPath)
      侧边栏.setTab('files')
      侧边栏.setVisible(true)
      await 侧边栏.刷新文件树()
      toast('已在侧边栏打开该文件夹')
      return
    }

    case 'file.import': {
      // 导入 = 打开。本项目里"打开"已经能处理任何文本文件，
      // 单独做一个导入流程只会多出一套需要维护的代码路径。
      // 真正需要转换的格式（Word 等）走 Pandoc，那是导出侧的事。
      const 结果 = await window.selfmd.dialog.openFile({
        title: '导入文件',
        filters: [
          { name: 'Markdown 与文本', extensions: ['md', 'markdown', 'txt', 'text'] },
          { name: '全部文件', extensions: ['*'] }
        ]
      })
      const 首个 = 结果.filePaths?.[0]
      if (结果.canceled || !首个) return
      await doc.open(首个)
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
      const 目标 =
        command === 'edit.smartPunctuationInput'
          ? 'input'
          : command === 'edit.smartPunctuationRendering'
            ? 'rendering'
            : 'none'
      // 再点一次当前模式 = 关掉。这样三个单选里任意一个都能当开关用。
      const 新模式 = settings.smartPunctuationMode === 目标 ? 'none' : 目标

      settings = await window.selfmd.settings.patch({
        smartPunctuationMode: 新模式,
        // 首次开启时把两个字符开关都打开，否则开了模式却什么都没转换，
        // 用户会以为功能坏了。
        ...(新模式 !== 'none' && !settings.smartQuotes && !settings.smartDashes
          ? { smartQuotes: true, smartDashes: true }
          : {})
      })

      应用编辑模式()
      // 渲染模式的开关决定"装饰怎么建"，改完必须重绘才生效
      if (新模式 === 'rendering' || 目标 === 'rendering') view.dispatch({})

      const 名称 =
        新模式 === 'input' ? '输入时转换' : 新模式 === 'rendering' ? '渲染时转换' : ''
      toast(名称 ? `智能标点：${名称}` : '智能标点：已关闭')
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
      const 级别 = Number(command.slice(-1))
      设置标题级别(view, 级别)
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
      切换引用(view)
      afterEdit()
      return

    case 'para.orderedList':
      切换列表(view, '有序')
      afterEdit()
      return

    case 'para.unorderedList':
      切换列表(view, '无序')
      afterEdit()
      return

    case 'para.taskList':
      切换列表(view, '任务')
      afterEdit()
      return

    case 'para.indent':
      调整缩进(view, 1)
      afterEdit()
      return

    case 'para.outdent':
      调整缩进(view, -1)
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
      插入表格(view)
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
      包裹行内(view, '**')
      afterEdit()
      return

    case 'fmt.emphasis':
      包裹行内(view, '*')
      afterEdit()
      return

    case 'fmt.underline':
      包裹行内(view, '<u>', '</u>')
      afterEdit()
      return

    case 'fmt.code':
      包裹行内(view, '`')
      afterEdit()
      return

    case 'fmt.inlineMath':
      包裹行内(view, '$')
      afterEdit()
      return

    case 'fmt.strike':
      包裹行内(view, '~~')
      afterEdit()
      return

    case 'fmt.highlight':
      包裹行内(view, '<mark>', '</mark>')
      afterEdit()
      return

    case 'fmt.superscript':
      包裹行内(view, '<sup>', '</sup>')
      afterEdit()
      return

    case 'fmt.subscript':
      包裹行内(view, '<sub>', '</sub>')
      afterEdit()
      return

    case 'fmt.comment':
      包裹行内(view, '<!--', '-->')
      afterEdit()
      return

    case 'fmt.hyperlink':
      插入链接(view)
      afterEdit()
      return

    case 'fmt.clear':
      清除格式(view)
      afterEdit()
      return

    // ------------------------------------------------------------ 图像 ---
    case 'fmt.image':
    case 'image.insertFromUrl': {
      const 地址 = await 询问文本({
        标题: '插入图片',
        占位: 'https://example.com/图片.png',
        确定文字: '插入'
      })
      if (!地址) return
      const 请求 = 当前插入请求()
      if (!请求) return
      报告插入(await 从地址插入(请求, 地址))
      return
    }

    case 'image.insertLocal': {
      const 选择 = await window.selfmd.dialog.openFile({
        title: '插入本地图片',
        multi: true,
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'avif'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (选择.canceled || 选择.filePaths.length === 0) return
      const 请求 = 当前插入请求()
      if (!请求) return
      报告插入(await 从文件插入(请求, 选择.filePaths))
      return
    }

    case 'image.toggleFolder': {
      // 文档级设置优先于全局，所以这个开关必须写进文档本身而不是配置。
      const 当前值 = 读取前置元数据(currentText()).属性['image-folder']
      if (当前值) {
        改写前置元数据('image-folder', null)
        toast('已清除本文档的图片文件夹设置')
        return
      }
      const 目录 = await window.selfmd.dialog.openFolder({
        title: '选择图片文件夹',
        defaultPath: doc.current.path ?? undefined
      })
      if (目录.canceled || !目录.folderPath) return
      const 文档目录 = doc.current.path
        ? await window.selfmdExtra.path.dirname(doc.current.path)
        : null
      if (!文档目录) {
        toast('请先保存文档，再设置图片文件夹。', 'error')
        return
      }
      // 存相对路径：文档连同图片一起搬家时引用才不会断。
      const 相对 = await window.selfmd.file.relative(文档目录, 目录.folderPath)
      改写前置元数据('image-folder', 相对)
      toast(`图片将复制到 ${相对}`)
      return
    }

    case 'image.toggleRootPath': {
      const 当前值 = 读取前置元数据(currentText()).属性['image-root']
      if (当前值) {
        改写前置元数据('image-root', null)
        toast('已清除图片根目录设置')
        return
      }
      const 目录 = await window.selfmd.dialog.openFolder({ title: '选择图片根目录' })
      if (目录.canceled || !目录.folderPath) return
      const 文档目录 = doc.current.path
        ? await window.selfmdExtra.path.dirname(doc.current.path)
        : null
      if (!文档目录) {
        toast('请先保存文档，再设置图片根目录。', 'error')
        return
      }
      const 相对 = await window.selfmd.file.relative(文档目录, 目录.folderPath)
      改写前置元数据('image-root', 相对)
      toast(`图片根目录设为 ${相对}`)
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
      侧边栏?.切换()
      return

    case 'view.outline':
      侧边栏?.切换('outline')
      return

    case 'view.fileTree':
      侧边栏?.切换('files')
      return

    case 'file.preferences':
      偏好设置.打开()
      return

    // ------------------------------------------------------------ 图床 ---
    case 'image.upload':
    case 'image.uploadAll': {
      const 只本地 = true
      const 全部 = 收集文档图片(view.state, 只本地)
      if (全部.length === 0) {
        toast('文档里没有本地图片，无需上传。')
        return
      }
      // 单个上传命令只传光标所在的那一张；"上传所有"传全部。
      const 待传 =
        command === 'image.upload'
          ? 全部.filter((图) => {
              const 光标 = view.state.selection.main.head
              return 图.from <= 光标 && 光标 <= 图.to
            })
          : 全部
      if (待传.length === 0) {
        toast('请先把光标放到要上传的图片上，或使用「上传所有本地图片」。')
        return
      }
      toast(`正在上传 ${待传.length} 张图片…`)
      const 结果 = await 上传并回填(view, 待传)
      报告上传(结果)
      return
    }

    // ---------------------------------------------------------- 编辑模式 --
    case 'view.focusMode':
      settings = await window.selfmd.settings.patch({ focusMode: !settings.focusMode })
      应用编辑模式()
      toast(settings.focusMode ? '已进入专注模式' : '已退出专注模式')
      return

    case 'view.typewriterMode':
      settings = await window.selfmd.settings.patch({ typewriterMode: !settings.typewriterMode })
      应用编辑模式()
      if (settings.typewriterMode) 居中光标行(view)
      toast(settings.typewriterMode ? '已开启打字机模式' : '已关闭打字机模式')
      return

    case 'edit.copyAsImage': {
      // 选中了就只截选中的那段，没选就截整篇——与"复制为 Markdown"同一条规则。
      const 文 = 取选区或整篇()
      if (!文.trim()) {
        toast('没有可复制的内容')
        return
      }
      toast('正在渲染图片…')
      const 结果 = await window.selfmd.copyAsImage({
        源: 文,
        文档路径: doc.current.path
      })
      if (!结果.成功) {
        toast(结果.错误 ?? '生成图片失败', 'error')
        return
      }
      // 被截断时必须说清楚：用户拿到一张少了一半的图却以为完整，
      // 拿去用之后才发现，那时已经不知道是哪一步出的问题。
      toast(
        结果.已截断
          ? `已复制图片（${结果.宽}×${结果.高}）——内容过长，只截取了前一部分`
          : `已复制图片（${结果.宽}×${结果.高}）`,
        结果.已截断 ? 'error' : 'info'
      )
      return
    }

    // -------------------------------------------------------- 复制与插入 ---
    case 'edit.copyAsMarkdown': {
      // 复制源文本。看似无用（普通复制也是拿到源文本），但当光标在图片、
      // 公式或表格上时，普通复制拿到的是渲染结果，这个命令保证拿到 Markdown。
      const 文 = 取选区或整篇()
      if (!文) {
        toast('没有可复制的内容')
        return
      }
      await window.selfmdExtra.clipboard.writeText(文)
      toast(`已复制 ${文.length} 个字符的 Markdown`)
      return
    }

    case 'edit.copyAsHtmlCode': {
      // 复用导出的渲染器：**同一份 Markdown 必须渲染成同一份 HTML**，
      // 否则"复制出来的"和"导出出来的"会不一致，而没人会去比对两者。
      const 文 = 取选区或整篇()
      if (!文) {
        toast('没有可复制的内容')
        return
      }
      const 片段 = 渲染Markdown为HTML(文)
      // writeHtml 需要同时给纯文本兜底：目标程序不支持 HTML 时
      // （比如粘进纯文本编辑器），没有兜底会粘出空白。
      await window.selfmdExtra.clipboard.writeHtml(片段, 文)
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
      const 选 = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      const 文字 = 选 || '链接文字'
      const 标记 = 唯一引用标记()
      const 插入 = `[${文字}][${标记}]`
      view.dispatch({
        changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: 插入 },
        selection: { anchor: view.state.selection.main.from + 插入.length }
      })
      // 定义追加到文末
      追加到文末(`\n[${标记}]: https://\n`)
      toast('已插入引用式链接，地址写在文末')
      return
    }

    case 'para.footnotes': {
      const 选 = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      const 编号 = 下一个脚注编号()
      const 标记 = `[^${编号}]`
      view.dispatch({
        changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: 标记 },
        selection: { anchor: view.state.selection.main.from + 标记.length }
      })
      追加到文末(`\n${标记}: ${选 || '脚注内容'}\n`)
      toast(`已插入脚注 ${编号}，正文写在文末`)
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
      const 格式 = 命令到导出格式(command)
      const 路径 = doc.current.path
      // 默认文件名取自当前文档；未保存时用首行标题兜底，比"未命名文档"好用
      const 默认名 = 路径 ? 去掉扩展名(路径) : 首行作标题(currentText())
      const 结果 = await window.selfmd.export.run({
        格式,
        源: currentText(),
        文档路径: 路径,
        默认文件名: 默认名,
        // 导出选项来自设置（「导出设置」菜单项与偏好设置面板都能改）。
        // 不传的话主进程会用自己的默认值，于是设置面板改了却没效果——
        // 那种"改了没反应"最难查。
        附大纲: settings.exportIncludeOutline,
        内嵌图片: settings.exportEmbedImages
      })
      if (结果.错误) {
        toast(结果.错误, 'error')
        return
      }
      if (结果.路径) toast(`已导出到 ${结果.路径}`)
      return
    }

    case 'file.print': {
      const 结果 = await window.selfmd.print()
      if (!结果.成功 && 结果.错误 !== '打印已取消') toast(结果.错误 ?? '打印失败', 'error')
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
      const 参数 = args as { slot: 'light' | 'dark'; id: string } | undefined
      if (!参数) return
      settings = await window.selfmd.settings.patch(
        参数.slot === 'light' ? { theme: 参数.id } : { darkTheme: 参数.id }
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
      const 范围 = command === 'theme.editBaseCss' ? 'base' : 'theme'
      const 结果 = await window.selfmd.theme.openCustom(范围)
      toast(
        结果.路径
          ? `已打开${范围 === 'base' ? '全局' : '当前主题'}自定义 CSS，保存后执行「重新加载主题」`
          : '打开自定义 CSS 失败',
        结果.路径 ? 'info' : 'error'
      )
      return
    }

    case 'theme.create': {
      const 名 = await 询问文本({
        标题: '新建主题',
        占位: '例如 my-theme（不要带 .css）',
        确定文字: '创建'
      })
      if (!名) return
      const 新主题 = await window.selfmd.theme.create(名)
      if (!新主题) {
        toast('创建失败：名称不合法，或同名主题已存在', 'error')
        return
      }
      const 路径 = await window.selfmd.theme.openCustom('theme')
      void 路径
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
    const 已开 = 标签集.按路径找(path)
    if (已开) {
      await 切换标签(已开.标识)
      return
    }

    // **必须在 setDocument 之前**把图片的相对路径基准设好：
    // 文档内容一进编辑器就会构建装饰，那时若基准目录还是上一篇文档的，
    // 图片会先渲染成"无法显示"，要等重绘才恢复——表现为图片闪一下。
    设置文档目录(await window.selfmdExtra.path.dirname(path))

    const text = await doc.open(path)
    // **先写回，再换视图状态。** openPath 会替换整个编辑器状态，
    // 不先存的话前一个文档里未保存的改动就没了。
    标签集.存当前(view.state)
    setDocument(text)
    标签集.加入(doc.导出状态(), view.state)
    updateTitle()
    刷新标签相关界面()
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
        enter: (节点) => {
          parserCounts![节点.name] = (parserCounts![节点.name] ?? 0) + 1
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
        图表已出图: '.cm-w-diagram[data-状态="完成"]',
        图表失败: '.cm-w-diagram[data-状态="失败"]',
        // 既没完成也没失败 = 还卡在渲染中。分开数才能区分
        // "渲染慢" 与 "渲染流程断了"——两者的处理完全不同。
        图表未完成: '.cm-w-diagram[data-状态="渲染中"]',
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
        图片: '.cm-w-image img',
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
        代码着色总数: '.cm-lp-code [class*="cm-tok-"]'
      }
      domCounts = {}
      for (const [名, 选择器] of Object.entries(待统计)) {
        domCounts[名] = document.querySelectorAll(选择器).length
      }

      // 图表是唯一异步渲染的东西。正常情况下计数就够了，但一旦有图表
      // 没走到终态（既非完成也非失败），光看计数无从定位，所以这时才打出明细。
      const 图表们 = Array.from(document.querySelectorAll('.cm-w-diagram'))
      const 未定 = 图表们.filter((元素) => (元素 as HTMLElement).dataset.状态 === '渲染中')
      if (未定.length > 0) {
        const 明细 = 未定
          .map((元素) => {
            const 盒 = 元素 as HTMLElement
            const 子 = Array.from(盒.children)
              .map((c) => c.tagName.toLowerCase())
              .join('+')
            return `[${盒.dataset.状态}|${子}|${(盒.textContent ?? '').trim().slice(0, 20)}]`
          })
          .join(' ')
        console.error(`[selfMD] 图表未走到终态：${明细}`)
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
    let 导出结果: Record<string, string> | undefined
    let 偏好结果: Record<string, string> | undefined
    let 上传结果: Record<string, string> | undefined
    let 数学结果: Record<string, string> | undefined
    let 标点结果: Record<string, string> | undefined
    let 交互结果: string | undefined
    let 代码块结果: string | undefined
    let 右键结果: string | undefined
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
      导出结果 = 运行导出自测()
      偏好结果 = 运行偏好设置自测()
      上传结果 = 运行上传自测()
      数学结果 = 运行数学自测()
      标点结果 = 运行渲染标点自测()
      右键结果 = await 运行右键菜单自测()
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
      exportResults: 导出结果,
      prefsResults: 偏好结果,
      uploadResults: 上传结果,
      mathResults: 数学结果,
      punctResults: 标点结果,
      matchResults: 匹配结果,
      sidebarResult: 侧边栏结果,
      tabResult: 标签结果,
      codeBlockResult: 代码块结果,
      contextMenuResult: 右键结果,
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
    state: EditorState.create({ doc: '', extensions: 编辑器扩展() }),
    parent: host
  })

  // --- 编辑器右键菜单 -----------------------------------------------------
  //
  // 挂在 `view.dom` 上而不是文档级：只有编辑器内容需要这套段落/格式菜单。
  // 侧边栏、状态栏各有各的右键语境，混在一起会出现"在文件树上右键却弹出加粗"。
  //
  // 必须 `preventDefault`，否则 Chromium 会再弹一层自己的默认菜单
  // （剪切/复制/粘贴 + 拼写建议），两层叠在一起。
  view.dom.addEventListener('contextmenu', (事件) => {
    事件.preventDefault()
    弹出菜单({ x: 事件.clientX, y: 事件.clientY }, 构建编辑器右键菜单())
  })

  // 侧边栏要在 view 建好之后才能建：它依赖 view 做跳转与取文档路径。
  const 侧边宿主 = document.getElementById('sidebar')
  if (侧边宿主) {
    侧边栏 = new 侧边栏组件(侧边宿主, {
      取文档路径: () => doc.current.path,
      跳转到: (位置) => {
        view.dispatch({
          selection: EditorSelection.cursor(位置),
          scrollIntoView: true,
          effects: EditorView.scrollIntoView(位置, { y: 'start', yMargin: 40 })
        })
        view.focus()
      },
      打开文件: (路径) => {
        void openPath(路径)
      },
      点击文档: (标识) => {
        void 切换标签(标识)
      },
      关闭文档: (标识) => {
        void 关闭标签(标识)
      },
      保存状态: (状态) => {
        // 不比对就会形成回声：保存 → 设置变更事件 → 再保存 → …
        // 值没变时直接返回，环就断在这里。
        if (
          状态.可见 === settings.sidebarVisible &&
          状态.标签 === settings.sidebarTab &&
          状态.宽度 === settings.sidebarWidth
        ) {
          return
        }
        void window.selfmd.settings.patch({
          sidebarVisible: 状态.可见,
          sidebarTab: 状态.标签,
          sidebarWidth: 状态.宽度
        })
      }
    })
    侧边栏.设置宽度(settings.sidebarWidth)
    侧边栏.setTab(settings.sidebarTab === 'articles' ? 'files' : settings.sidebarTab)
    侧边栏.setVisible(settings.sidebarVisible)
    刷新大纲(true)
  }

  doc.subscribe(() => {
    updateTitle()
    // 换文档后文件树要跟着换根目录，大纲也要重算
    侧边栏?.刷新文件树()
    刷新大纲(true)
    // 图片的相对路径基准也跟着文档变
    void 刷新图片基准目录().then(() => {
      // 基准目录变了要重算装饰，否则已经渲染的图片仍指向旧目录
      view.dispatch({})
    })
  })
  应用编辑模式()
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
      next.sidebarTab !== settings.sidebarTab
    settings = next
    applyTheme(settings)
    应用编辑模式()
    刷新模式相关界面()
    if (侧边变了 && 侧边栏) {
      侧边栏.设置宽度(settings.sidebarWidth)
      侧边栏.setVisible(settings.sidebarVisible)
      if (settings.sidebarTab !== 'articles') 侧边栏.setTab(settings.sidebarTab)
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
  if (标签集.数量 === 0) {
    标签集.加入(doc.导出状态(), view.state)
  }
  刷新标签相关界面()

  console.log(`[selfMD] renderer ready on ${info.platform}, electron ${info.electron}`)
  await window.selfmd.app.signalReady({ documents: 标签集.数量 })
}

void boot().catch((err) => {
  toastError(err, '启动失败')
})
