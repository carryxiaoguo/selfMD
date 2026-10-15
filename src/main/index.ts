import { app, BrowserWindow, nativeImage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EV } from '@shared/ipc'
import { 图标路径 } from './util/资源路径'
import { registerIpc } from './ipc'
import { whenDocumentOpened, whenRendererReady } from './ipc/app'
import { registerPrivilegedSchemes, registerProtocolHandlers } from './protocol'
import { rebuildMenu, 菜单摘要, 设置Pandoc可用 } from './menu'
import { 检测Pandoc, 执行导出 } from './export'
import {
  写草稿,
  列出草稿,
  删除草稿,
  清理该文档的草稿,
  读草稿,
  需要恢复的草稿
} from './services/drafts'
import { ensureAppDirs, getAppPaths } from './util/paths'
import { loadSettings, onSettingsChanged } from './services/settings'
import { seedBuiltinThemes } from './services/themes'
import { loadRecent } from './services/recent'
import { createWindow, 应用拼写词典 } from './window'

/**
 * main 进程入口。
 *
 * 启动顺序很重要：
 *   1. 注册特权 scheme（仅在 ready 之前）
 *   2. 用户数据目录
 *   3. 设置 + 最近打开列表
 *   4. protocol 处理器、IPC、菜单
 *   5. 第一个窗口
 */

registerPrivilegedSchemes()

// 第二个实例应当把已有窗口带到前台，而不是重新启动一遍。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const fileArg = argv.find((a) => /\.(md|markdown|mdown|mkd|txt)$/i.test(a))
    if (fileArg) {
      const target = BrowserWindow.getFocusedWindow() ?? win
      target?.webContents.send(EV.openDocument, { path: fileArg })
    }
  })

  void app.whenReady().then(() => {
    ensureAppDirs()
    loadSettings()
    loadRecent()
    seedBuiltinThemes()

    registerProtocolHandlers()
    registerIpc()
    rebuildMenu()

    onSettingsChanged((设置) => {
      // 菜单勾选状态与主题单选项状态都由设置推导而来。
      rebuildMenu()
      // 拼写词典要在会话上生效。已经在窗口里渲染过的文本不会重新检查——
      // 用户改完之后需要重新打开文档才能看到效果，这一点写进了设置项的说明里。
      应用拼写词典(设置)
    })

    // `openPathFromArgv` 总是返回一个对象，所以要判断字段而不是对象本身：
    // 否则 `?? smokeOpen()` 永远不会生效。
    const fromArgv = openPathFromArgv(process.argv)
    if (fromArgv.path) {
      createWindow(fromArgv)
    } else if (SMOKE_IMAGE) {
      const 素材 = 准备图片素材()
      console.log(`[selfMD] 图片测试素材：文档=${素材.文档} 图片=${素材.图片}`)
      createWindow({ path: 素材.文档 })
    } else {
      createWindow(smokeOpen())
    }

    if (SMOKE_TEST) void runSmokeTest()

    // Pandoc 探测要跑子进程，会拖慢启动，所以放到窗口创建之后。
    // 结果回来再重建菜单，把 Word 等格式点亮。
    void 检测Pandoc().then((路径: string | null) => {
      设置Pandoc可用(路径 !== null)
      rebuildMenu()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/**
 * 解析命令行或"打开方式"传入的文档路径。
 *
 * 从 shell 或资源管理器传来的路径可能是相对路径；必须在这里基于
 * 进程工作目录解析，
 * 因为渲染进程本身并没有有意义的工作目录。
 */
function openPathFromArgv(argv: string[]): { path?: string } {
  const candidate = argv
    .slice(1)
    .find((a) => !a.startsWith('-') && /\.(md|markdown|mdown|mkd|txt)$/i.test(a))
  return candidate ? { path: resolve(candidate) } : {}
}

/** 冒烟测试 `--smoke-open=<path>` 参数对应的窗口选项。 */
function smokeOpen(): { path?: string } {
  const target = smokeOpenPath()
  return target ? { path: resolve(target) } : {}
}

// ---------------------------------------------------------------------------
// 图片管线端到端素材
// ---------------------------------------------------------------------------

/**
 * 造一份主题测试素材。
 *
 * 要验证的是"主题旁边的资源子目录能不能被加载"——这是能用真实主题的前提
 * ` 引用字体）。
 * 只服务 `<主题名>.css` 会让这些引用全部 404。
 */
function 准备主题素材(): void {
  const 目录 = getAppPaths().themes
  const 子目录 = join(目录, '__冒烟__')
  mkdirSync(子目录, { recursive: true })
  writeFileSync(join(目录, '__冒烟__.css'), '@import "__冒烟__/子样式.css";\n', 'utf8')
  writeFileSync(join(子目录, '子样式.css'), ':root { --冒烟标记: 1; }\n', 'utf8')
}

/** 清掉冒烟测试造的主题素材，避免污染用户真实的主题目录。 */
function 清理主题素材(): void {
  const 目录 = getAppPaths().themes
  try {
    rmSync(join(目录, '__冒烟__.css'), { force: true })
    rmSync(join(目录, '__冒烟__'), { recursive: true, force: true })
  } catch {
    // 清理失败不影响测试结论。
  }
}

/**
 * `--smoke-export` 开启导出端到端测试。
 *
 * 纯函数断言只能证明"渲染器算得对"；这里真的导出一次、再把文件读回来检查，
 * 才能证明整条链路（渲染 → 拼模板 → 内联样式 → 落盘）是通的。
 */
const SMOKE_EXPORT = process.argv.includes('--smoke-export')
const SMOKE_DRAFTS = process.argv.includes('--smoke-drafts')

/** 导出测试用的文档：刻意覆盖标题、列表、代码块、表格、任务列表与大纲。 */
const 导出测试文档 = `# 导出测试标题

正文含 **粗体**、\`代码\` 与 [链接](https://example.com)。

## 第二节

\`\`\`js
const a = 1 < 2
\`\`\`

| 甲 | 乙 |
|:--|--:|
| 1 | 2 |

- [x] 已完成
- [ ] 未完成

> 引用一行
`

async function 运行导出测试(): Promise<boolean> {
  const 目录 = join(app.getPath('temp'), `selfmd-导出测试-${Date.now()}`)
  mkdirSync(目录, { recursive: true })
  const 目标 = join(目录, '导出测试.html')

  const 结果 = await 执行导出({
    目标,
    源: 导出测试文档,
    文档路径: null,
    格式: 'html',
    附大纲: true,
    内嵌图片: false
  })

  if (!结果.成功) {
    console.error(`[selfMD] 导出端到端：失败 — ${结果.错误}`)
    return false
  }

  const 内容 = readFileSync(目标, 'utf8')
  const 检查: [string, boolean][] = [
    ['文档类型声明', 内容.startsWith('<!doctype html>')],
    ['导出态类名', 内容.includes('class="selfmd-export selfmd-export-show-outline"')],
    ['内容容器', 内容.includes('<div id="write">')],
    ['渲染出标题', 内容.includes('<h1>导出测试标题</h1>')],
    ['渲染出粗体', 内容.includes('<strong>粗体</strong>')],
    ['代码块转义', 内容.includes('const a = 1 &lt; 2')],
    ['渲染出表格', 内容.includes('<table>')],
    ['渲染出任务框', 内容.includes('type="checkbox" disabled checked')],
    ['渲染出引用', 内容.includes('<blockquote>')],
    ['附带了侧边目录', 内容.includes('selfmd-export-sidebar')],
    // 这条是 PDF 能否正确的关键：缺了它 Chromium 打印会丢弃全部背景色
    ['打印保留背景色', 内容.includes('print-color-adjust: exact')],
    ['内联了主题变量', 内容.includes('--bg-color')],
    // @include-when-export 是 非标准指令，浏览器不认，必须被处理掉
    ['无残留专有指令', !内容.includes('@include-when-export')]
  ]

  const 失败 = 检查.filter(([, 好]) => !好)
  console.log(
    `[selfMD] 导出端到端：${检查.length - 失败.length}/${检查.length} 项通过` +
      `  文件 ${内容.length} 字符  路径=${目标}`
  )
  if (失败.length > 0) {
    console.error(`[selfMD] 导出端到端：未通过 — ${失败.map(([名]) => 名).join('、')}`)
    return false
  }
  return true
}

/**
 * `--smoke-drafts` 开启草稿与崩溃恢复的端到端测试。
 *
 * 重点验证一条**竞态守卫**：保存是异步的，期间用户可能又敲了几个字。
 * 如果保存成功后无条件删草稿，那部分新内容就永远丢了。
 * 所以只有在「草稿内容 === 刚保存的内容」时才清——下面这条断言就是在钉它。
 */
async function 运行草稿测试(): Promise<boolean> {
  const 目录 = join(app.getPath('temp'), `selfmd-草稿测试-${Date.now()}`)
  mkdirSync(目录, { recursive: true })
  const 文档 = join(目录, '草稿测试.md')
  writeFileSync(文档, '磁盘上的旧内容\n', 'utf8')

  const 检查: [string, boolean][] = []
  const 记录 = (名: string, 好: boolean): void => {
    检查.push([名, 好])
  }

  // 先把历史遗留的无名草稿清掉。
  //
  // 草稿目录是**跨进程共享**的，前面的冒烟运行可能留下内容；
  // 而"删除后应当没有无名草稿"这条断言看的是全局列表，
  // 不先打扫就会因为别人的残渣而失败——表现为单独跑能过、
  // 放进完整流水线就挂，这类顺序依赖最难排查。
  for (const 旧 of 列出草稿()) {
    if (旧.原路径 === null) 删除草稿(旧.键)
  }

  // 1) 写一份比原文件新的草稿
  const 草稿内容 = '磁盘上的旧内容\n\n用户后来敲的新内容\n'
  记录('写入草稿', 写草稿(文档, 草稿内容))

  // 2) 能列出来
  const 这条 = 列出草稿().find((c) => c.原路径 === 文档)
  记录('能列出草稿', 这条 !== undefined)

  // 3) 能读回同样的内容
  记录('读回内容一致', 这条 !== undefined && 读草稿(这条.键) === 草稿内容)

  // 4) 需要恢复：草稿比原文件新，且内容长度不同
  记录(
    '被判定为需要恢复',
    需要恢复的草稿().some((c) => c.原路径 === 文档)
  )

  // 5) 竞态守卫：内容不一致时**不能**清掉草稿
  清理该文档的草稿(文档, '这是另一个内容')
  记录('内容不一致时保留草稿', 列出草稿().some((c) => c.原路径 === 文档))

  // 6) 内容一致时才清掉
  清理该文档的草稿(文档, 草稿内容)
  记录('内容一致时清除草稿', !列出草稿().some((c) => c.原路径 === 文档))

  // 7) 未命名文档（原路径为 null）也要能存与恢复
  记录('未命名文档可写草稿', 写草稿(null, '未命名的内容'))
  const 未命名 = 列出草稿().find((c) => c.原路径 === null)
  记录(
    '未命名文档需要恢复',
    未命名 !== undefined && 需要恢复的草稿().some((c) => c.键 === 未命名.键)
  )
  if (未命名) 删除草稿(未命名.键)
  记录('未命名草稿可删除', !列出草稿().some((c) => c.原路径 === null))

  // 8) 原文件已被删除时也要提示恢复——草稿是唯一副本
  const 幽灵 = join(目录, '已经不存在了.md')
  写草稿(幽灵, '文件被删了但草稿还在')
  记录(
    '原文件缺失时提示恢复',
    需要恢复的草稿().some((c) => c.原路径 === 幽灵)
  )
  const 幽灵条目 = 列出草稿().find((c) => c.原路径 === 幽灵)
  if (幽灵条目) 删除草稿(幽灵条目.键)

  const 失败 = 检查.filter(([, 好]) => !好)
  console.log(`[selfMD] 草稿与恢复：${检查.length - 失败.length}/${检查.length} 项通过`)
  if (失败.length > 0) {
    console.error(`[selfMD] 草稿与恢复：未通过 — ${失败.map(([名]) => 名).join('、')}`)
    return false
  }
  return true
}

/** 图标是否真的能解码，而不是"文件存在"就算数。 */
function 报告图标(): void {  const 文件 = 图标路径('icon-256.png')
  if (!文件) {
    console.log('[selfMD] 窗口图标：未找到（将使用系统默认图标）')
    return
  }
  const 图 = nativeImage.createFromPath(文件)
  const 尺寸 = 图.getSize()
  console.log(
    `[selfMD] 窗口图标：${文件}  ` +
      `${尺寸.width}×${尺寸.height}  ${图.isEmpty() ? '解码失败' : '可正常解码'}`
  )
  for (const 名 of ['icon.ico', 'icon-16.png', 'icon-64.png']) {
    const 路径 = 图标路径(名)
    console.log(`    附属图标 ${名}：${路径 ? '存在' : '缺失'}`)
  }
}

/** `--smoke-image` 开启图片端到端测试。
 *
 * 前面那些纯函数断言只能证明"决策算得对"，证明不了"图片真的被复制到了对的地方、
 * 引用真的写进了文档"。这个开关让应用自己造一份工作区并跑完整条链路，
 * 把结果回报到日志里供断言。
 */
const SMOKE_IMAGE = process.argv.includes('--smoke-image')

/** 1×1 的合法 PNG。内容不重要，能被识别成图片即可。 */
const 最小PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * 造一份图片测试工作区。
 *
 * 刻意在文档里写上 `image-folder: 图`：它同时验证了
 * "能读出 YAML 前置元数据"与"文档级设置压过全局"两条规则。
 */
function 准备图片素材(): { 文档: string; 图片: string; 目标目录: string } {
  const 根 = join(app.getPath('temp'), `selfmd-图片测试-${Date.now()}`)
  const 目标目录 = join(根, '图')
  mkdirSync(目标目录, { recursive: true })

  const 文档 = join(根, '测试.md')
  writeFileSync(文档, '---\nimage-folder: 图\n---\n\n# 图片测试\n\n', 'utf8')

  const 图片 = join(根, '样本.png')
  writeFileSync(图片, 最小PNG)

  return { 文档, 图片, 目标目录 }
}

// 把解析后的路径打印一次，这样首次运行就能从日志里核对。
app.whenReady().then(() => {
  console.log('[selfMD] userData:', getAppPaths().userData)
})

/**
 * 无界面验证：启动应用，等渲染进程上报成功，然后退出。
 * 供 `pnpm smoke` 使用，用来证明构建产物真的能运行，而不只是能编译。
 *
 * 带上 `--smoke-open=<path>` 或 `--smoke-image` 时，它还会额外等待文档加载
 * 完成，从而走完整条打开链路：argv -> main -> preload -> renderer ->
 * 编码探测 -> 编辑器状态。图片模式还要多等一步——自测结果是在文档加载
 * 之后才产生的，只等"渲染进程就绪"会拿到一份没有结论的日志。
 */
const SMOKE_TEST = process.argv.includes('--smoke-test')

function smokeOpenPath(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--smoke-open='))
  return arg ? arg.slice('--smoke-open='.length) : null
}

/**
 * 全屏自测：真的进一次全屏，再真的按一次 Esc。
 *
 * 为什么要测：全屏时 Windows 会把标题栏连同最小化/最大化/关闭一起隐藏，
 * **没有任何可点的退出入口**。如果 Esc 不管用，用户就真的卡住了——
 * 而且这件事在开发时极难发现，因为开发者知道 F11 能切回来。
 *
 * `sendInputEvent` 走的是**真实输入管线**，因此会经过
 * `before-input-event`，与用户按键完全同一条路；直接调 `setFullScreen(false)`
 * 就测不到任何东西了。
 */
async function 运行全屏自测(): Promise<string> {
  const 窗口 = BrowserWindow.getAllWindows()[0]
  if (!窗口) return '没有窗口，未测'

  const 原本 = 窗口.isFullScreen()
  try {
    窗口.setFullScreen(true)
    await new Promise((完成) => setTimeout(完成, 500))
    const 进入 = 窗口.isFullScreen()

    窗口.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    await new Promise((完成) => setTimeout(完成, 500))
    const 按Esc后仍全屏 = 窗口.isFullScreen()

    return `进入全屏=${进入} 按Esc后仍全屏=${按Esc后仍全屏}`
  } finally {
    if (!窗口.isDestroyed()) 窗口.setFullScreen(原本)
  }
}

async function runSmokeTest(): Promise<void> {  const target = smokeOpenPath()
  const 等文档 = target !== null || SMOKE_IMAGE

  // 图标是否真的能解码，而不是"文件存在"就算数：路径写错、PNG 损坏、
  // 分辨率不对，都只有实际加载一次才知道。
  报告图标()
  // 主题资源子目录能否加载，只有真的去取一次才知道。
  准备主题素材()

  if (SMOKE_EXPORT) {
    // 计时器还没建，失败就直接退出——app.exit 会终止进程，不需要清理。
    const 通过 = await 运行导出测试()
    if (!通过) {
      app.exit(1)
      return
    }
  }

  if (SMOKE_DRAFTS) {
    const 通过 = await 运行草稿测试()
    if (!通过) {
      app.exit(1)
      return
    }
  }

  const timeoutMs = 25_000
  const timer = setTimeout(() => {
    console.error(
      `[selfMD] 冒烟测试失败：${等文档 ? '文档未能加载' : '渲染进程未上报就绪'}`
    )
    app.exit(1)
  }, timeoutMs)

  // 原生菜单由操作系统绘制，无头测试截不到图。导出成文本，
  // 中文化与"哪些命令已实现"才有可断言的证据。
  console.log('[selfMD] 应用菜单：')
  for (const 行 of 菜单摘要()) console.log('  ' + 行)

  await whenRendererReady()
  console.log('[selfMD] 冒烟：渲染进程已就绪')

  if (等文档) {
    await whenDocumentOpened()
    console.log('[selfMD] 冒烟：文档已加载')
  }

  console.log(`[selfMD] 全屏自测：${await 运行全屏自测()}`)

  clearTimeout(timer)
  清理主题素材()
  console.log('[selfMD] 冒烟测试通过')
  app.exit(0)
}
