import { app, BrowserWindow, nativeImage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EV } from '@shared/ipc'
import { iconPath } from './util/资源路径'
import { registerIpc } from './ipc'
import { whenDocumentOpened, whenRendererReady } from './ipc/app'
import { registerPrivilegedSchemes, registerProtocolHandlers } from './protocol'
import { rebuildMenu, 菜单摘要, 设置Pandoc可用 } from './menu'
import { detectPandoc, runExport } from './export'
import { getAssocStatus } from './services/文件关联'
import {
  writeDraft,
  listDrafts,
  deleteDraft,
  clearDocDraft,
  readDraft,
  recoverableDraft
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

/**
 * 冒烟测试用**独立的用户数据目录**。
 *
 * 必须在 `requestSingleInstanceLock()` 之前设置——单实例锁是按 userData
 * 分的，换目录才谈得上"互不干扰"。
 *
 * 两个理由：
 *
 *   1. **不能去抢用户正在用的那个锁。** 装好的应用开着时，冒烟会撞上它的
 *      单实例锁而无法启动。那个锁是真实用户占着的，正确做法是各走各的，
 *      而不是把人家杀掉。冒烟因此会以非零码退出并说明原因。
 *   2. **冒烟会写草稿、最近文件、窗口状态。** 写进真实目录就是污染用户数据；
 *      而残留状态又会让下一次冒烟的结果不可复现——上一轮留下的草稿会让
 *      "崩溃恢复"用例看到不属于它的东西。
 */
if (process.argv.includes('--smoke-test')) {
  app.setPath('userData', join(tmpdir(), `selfmd-冒烟-${process.pid}`))
}

// 第二个实例应当把已有窗口带到前台，而不是重新启动一遍。
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 冒烟测试下拿不到锁必须**以非零码退出**。
  //
  // 否则进程会安安静静地以 0 结束，而上层只看到"退出码 0"就以为通过了——
  // 实际上一条断言都没跑。这种假通过比报错危险得多：它会让人以为
  // 改动是安全的，直到某天真的坏了才发现。
  //
  // 拿不到锁几乎总是因为有一个残留实例（装好的那份、或上一次测试留下的）。
  if (process.argv.includes('--smoke-test')) {
    console.error(
      '[selfMD] 冒烟测试无法启动：已有另一个 selfMD 实例在运行，' +
        '它占着单实例锁。请先结束所有 selfMD / electron 进程再重试。'
    )
    app.exit(1)
  } else {
    app.quit()
  }
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

    onSettingsChanged((settings) => {
      // 菜单勾选状态与主题单选项状态都由设置推导而来。
      rebuildMenu()
      // 拼写词典要在会话上生效。已经在窗口里渲染过的文本不会重新检查——
      // 用户改完之后需要重新打开文档才能看到效果，这一点写进了设置项的说明里。
      应用拼写词典(settings)
    })

    // `openPathFromArgv` 总是返回一个对象，所以要判断字段而不是对象本身：
    // 否则 `?? smokeOpen()` 永远不会生效。
    const fromArgv = openPathFromArgv(process.argv)
    if (fromArgv.path) {
      createWindow(fromArgv)
    } else if (SMOKE_IMAGE) {
      const 素材 = 准备图片素材()
      console.log(`[selfMD] 图片测试素材：文档=${素材.docModel} 图片=${素材.image}`)
      createWindow({ path: 素材.docModel })
    } else {
      createWindow(smokeOpen())
    }

    if (SMOKE_TEST) void runSmokeTest()

    // Pandoc 探测要跑子进程，会拖慢启动，所以放到窗口创建之后。
    // 结果回来再重建菜单，把 Word 等格式点亮。
    void detectPandoc().then((filePath: string | null) => {
      设置Pandoc可用(filePath !== null)
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
  const dir = getAppPaths().themes
  const subDir = join(dir, '__冒烟__')
  mkdirSync(subDir, { recursive: true })
  writeFileSync(join(dir, '__冒烟__.css'), '@import "__冒烟__/子样式.css";\n', 'utf8')
  writeFileSync(join(subDir, '子样式.css'), ':root { --冒烟标记: 1; }\n', 'utf8')
}

/** 清掉冒烟测试造的主题素材，避免污染用户真实的主题目录。 */
function 清理主题素材(): void {
  const dir = getAppPaths().themes
  try {
    rmSync(join(dir, '__冒烟__.css'), { force: true })
    rmSync(join(dir, '__冒烟__'), { recursive: true, force: true })
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
  const dir = join(app.getPath('temp'), `selfmd-导出测试-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, '导出测试.html')

  const result = await runExport({
    target,
    source: 导出测试文档,
    docPath: null,
    format: 'html',
    withOutline: true,
    embeddedImage: false
  })

  if (!result.success) {
    console.error(`[selfMD] 导出端到端：失败 — ${result.error}`)
    return false
  }

  const content = readFileSync(target, 'utf8')
  const check: [string, boolean][] = [
    ['文档类型声明', content.startsWith('<!doctype html>')],
    ['导出态类名', content.includes('class="selfmd-export selfmd-export-show-outline"')],
    ['内容容器', content.includes('<div id="write">')],
    ['渲染出标题', content.includes('<h1>导出测试标题</h1>')],
    ['渲染出粗体', content.includes('<strong>粗体</strong>')],
    ['代码块转义', content.includes('const a = 1 &lt; 2')],
    ['渲染出表格', content.includes('<table>')],
    ['渲染出任务框', content.includes('type="checkbox" disabled checked')],
    ['渲染出引用', content.includes('<blockquote>')],
    ['附带了侧边目录', content.includes('selfmd-export-sidebar')],
    // 这条是 PDF 能否正确的关键：缺了它 Chromium 打印会丢弃全部背景色
    ['打印保留背景色', content.includes('print-color-adjust: exact')],
    ['内联了主题变量', content.includes('--bg-color')],
    // @include-when-export 是 非标准指令，浏览器不认，必须被处理掉
    ['无残留专有指令', !content.includes('@include-when-export')]
  ]

  const failure = check.filter(([, okFlag]) => !okFlag)
  console.log(
    `[selfMD] 导出端到端：${check.length - failure.length}/${check.length} 项通过` +
      `  文件 ${content.length} 字符  路径=${target}`
  )
  if (failure.length > 0) {
    console.error(`[selfMD] 导出端到端：未通过 — ${failure.map(([name]) => name).join('、')}`)
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
  const dir = join(app.getPath('temp'), `selfmd-草稿测试-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const docModel = join(dir, '草稿测试.md')
  writeFileSync(docModel, '磁盘上的旧内容\n', 'utf8')

  const check: [string, boolean][] = []
  const record = (name: string, okFlag: boolean): void => {
    check.push([name, okFlag])
  }

  // 先把历史遗留的无名草稿清掉。
  //
  // 草稿目录是**跨进程共享**的，前面的冒烟运行可能留下内容；
  // 而"删除后应当没有无名草稿"这条断言看的是全局列表，
  // 不先打扫就会因为别人的残渣而失败——表现为单独跑能过、
  // 放进完整流水线就挂，这类顺序依赖最难排查。
  for (const 旧 of listDrafts()) {
    if (旧.rawPath === null) deleteDraft(旧.key)
  }

  // 1) 写一份比原文件新的草稿
  const 草稿内容 = '磁盘上的旧内容\n\n用户后来敲的新内容\n'
  record('写入草稿', writeDraft(docModel, 草稿内容))

  // 2) 能列出来
  const 这条 = listDrafts().find((c) => c.rawPath === docModel)
  record('能列出草稿', 这条 !== undefined)

  // 3) 能读回同样的内容
  record('读回内容一致', 这条 !== undefined && readDraft(这条.key) === 草稿内容)

  // 4) 需要恢复：草稿比原文件新，且内容长度不同
  record(
    '被判定为需要恢复',
    recoverableDraft().some((c) => c.rawPath === docModel)
  )

  // 5) 竞态守卫：内容不一致时**不能**清掉草稿
  clearDocDraft(docModel, '这是另一个内容')
  record('内容不一致时保留草稿', listDrafts().some((c) => c.rawPath === docModel))

  // 6) 内容一致时才清掉
  clearDocDraft(docModel, 草稿内容)
  record('内容一致时清除草稿', !listDrafts().some((c) => c.rawPath === docModel))

  // 7) 未命名文档（原路径为 null）也要能存与恢复
  record('未命名文档可写草稿', writeDraft(null, '未命名的内容'))
  const untitled = listDrafts().find((c) => c.rawPath === null)
  record(
    '未命名文档需要恢复',
    untitled !== undefined && recoverableDraft().some((c) => c.key === untitled.key)
  )
  if (untitled) deleteDraft(untitled.key)
  record('未命名草稿可删除', !listDrafts().some((c) => c.rawPath === null))

  // 8) 原文件已被删除时也要提示恢复——草稿是唯一副本
  const 幽灵 = join(dir, '已经不存在了.md')
  writeDraft(幽灵, '文件被删了但草稿还在')
  record(
    '原文件缺失时提示恢复',
    recoverableDraft().some((c) => c.rawPath === 幽灵)
  )
  const 幽灵条目 = listDrafts().find((c) => c.rawPath === 幽灵)
  if (幽灵条目) deleteDraft(幽灵条目.key)

  const failure = check.filter(([, okFlag]) => !okFlag)
  console.log(`[selfMD] 草稿与恢复：${check.length - failure.length}/${check.length} 项通过`)
  if (failure.length > 0) {
    console.error(`[selfMD] 草稿与恢复：未通过 — ${failure.map(([name]) => name).join('、')}`)
    return false
  }
  return true
}

/** 图标是否真的能解码，而不是"文件存在"就算数。 */
function 报告图标(): void {  const file = iconPath('icon-256.png')
  if (!file) {
    console.log('[selfMD] 窗口图标：未找到（将使用系统默认图标）')
    return
  }
  const img = nativeImage.createFromPath(file)
  const size = img.getSize()
  console.log(
    `[selfMD] 窗口图标：${file}  ` +
      `${size.width}×${size.height}  ${img.isEmpty() ? '解码失败' : '可正常解码'}`
  )
  for (const name of ['icon.ico', 'icon-16.png', 'icon-64.png']) {
    const filePath = iconPath(name)
    console.log(`    附属图标 ${name}：${filePath ? '存在' : '缺失'}`)
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
function 准备图片素材(): { docModel: string; image: string; targetDir: string } {
  const root = join(app.getPath('temp'), `selfmd-图片测试-${Date.now()}`)
  const targetDir = join(root, '图')
  mkdirSync(targetDir, { recursive: true })

  const docModel = join(root, '测试.md')
  writeFileSync(docModel, '---\nimage-folder: 图\n---\n\n# 图片测试\n\n', 'utf8')

  const image = join(root, '样本.png')
  writeFileSync(image, 最小PNG)

  return { docModel, image, targetDir }
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
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return '没有窗口，未测'

  const 原本 = win.isFullScreen()
  try {
    win.setFullScreen(true)
    await new Promise((done) => setTimeout(done, 500))
    const 进入 = win.isFullScreen()

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    await new Promise((done) => setTimeout(done, 500))
    const 按Esc后仍全屏 = win.isFullScreen()

    return `进入全屏=${进入} 按Esc后仍全屏=${按Esc后仍全屏}`
  } finally {
    if (!win.isDestroyed()) win.setFullScreen(原本)
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
  for (const line of 菜单摘要()) console.log('  ' + line)

  await whenRendererReady()
  console.log('[selfMD] 冒烟：渲染进程已就绪')

  if (等文档) {
    await whenDocumentOpened()
    console.log('[selfMD] 冒烟：文档已加载')
  }

  console.log(`[selfMD] 全屏自测：${await 运行全屏自测()}`)
  // 文件关联是可读的状态而不是"设好了没有"的布尔值：
  // 用户以为设好了、其实没有，是这件事上最常见的误会。
  {
    const association = getAssocStatus()
    console.log(
      `[selfMD] 文件关联：当前=${association.current || '（未设置）'} ` +
        `是默认=${association.isDefaultFlag} 有新建菜单=${association.hasShellNew}`
    )
  }

  clearTimeout(timer)
  清理主题素材()
  console.log('[selfMD] 冒烟测试通过')
  app.exit(0)
}
