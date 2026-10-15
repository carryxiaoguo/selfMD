import { redo, selectAll, undo } from '@codemirror/commands'
import { findNext, findPrevious, openSearchPanel } from '@codemirror/search'
import { syntaxTree } from '@codemirror/language'
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { 移除属性, 读取前置元数据, 写入属性 } from '@shared/front-matter'
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
  清除格式,
  调整标题级别,
  调整缩进,
  设置标题级别
} from './editor/commands'
import { baseExtensions, modeExtensions } from './editor/setup'
import { 运行大纲自测, 运行导出自测, 运行上传自测, 运行数学自测, 运行偏好设置自测, 运行图片管线自测, 运行纯函数自测, 运行命令自测 } from './editor/selftest'
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
import { 设置行内公式启用 } from './editor/live-preview/types'
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
  // 公式开关不在 body 类上，因为它决定的是"装饰怎么建"而不是"怎么显示"，
  // 改了必须重绘才能生效。调用方负责在改完之后 dispatch 一次空事务。
  设置行内公式启用(settings.enableInlineMath)
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
    setDocument(内容)
    doc.markDirty()
    updateTitle()
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

  return (
    `主题本体=${主题本体} 子目录资源=${子目录资源} ` +
    `缺失文件=${不存在} 目录穿越=${穿越}`
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
      doc.newDocument()
      setDocument('')
      updateTitle()
      view.focus()
      return

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
    case 'edit.smartPunctuationInput': {
      const 启用 = settings.smartPunctuationMode !== 'input'
      settings = await window.selfmd.settings.patch({
        smartPunctuationMode: 启用 ? 'input' : 'none',
        // 首次开启时，两个字符开关默认都打开，否则开了模式也没转换任何东西。
        ...(启用 && !settings.smartQuotes && !settings.smartDashes
          ? { smartQuotes: true, smartDashes: true }
          : {})
      })
      toast(启用 ? '智能标点：输入时转换' : '智能标点：已关闭')
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
        默认文件名: 默认名
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
    // **必须在 setDocument 之前**把图片的相对路径基准设好：
    // 文档内容一进编辑器就会构建装饰，那时若基准目录还是上一篇文档的，
    // 图片会先渲染成"无法显示"，要等重绘才恢复——表现为图片闪一下。
    设置文档目录(await window.selfmdExtra.path.dirname(path))

    const text = await doc.open(path)
    setDocument(text)
    updateTitle()
    view.focus()

    const info = await window.selfmd.app.getInfo()
    let parserCounts: Record<string, number> | undefined
    let domCounts: Record<string, number> | undefined

    if (info.smokeTest) {
      // 给 CodeMirror 一帧时间把装饰落到 DOM 上，否则计数必然是 0。
      await new Promise((resolve) => window.setTimeout(resolve, 400))
      await 等待异步渲染稳定()

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
        独占行图片: '.cm-lp-image-line'
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
    let 侧边栏结果: string | undefined
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
      imageInsertResult = await 运行图片插入自测(path)
      侧边栏结果 = await 运行侧边栏自测()
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
      sidebarResult: 侧边栏结果,
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
  console.log(`[selfMD] renderer ready on ${info.platform}, electron ${info.electron}`)
  await window.selfmd.app.signalReady({ documents: 1 })
}

void boot().catch((err) => {
  toastError(err, '启动失败')
})
