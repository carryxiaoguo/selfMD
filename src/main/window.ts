import { BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { EV } from '@shared/ipc'
import type { Settings } from '@shared/types'
import { iconPath } from './util/resource-path'
import { rebuildMenu } from './menu'
import { getSettings } from './services/settings'

/**
 * 窗口管理。
 *
 * 关闭是协作式的：main 进程拦截 `close`，询问渲染进程文档是否需要保存
 * （`EV.requestClose`），只有渲染进程通过 `window:closeForce` 回调之后才真正关闭。
 * 因此文档状态始终归渲染进程所有，而编辑器正住在那里。
 */

/**
 * 把设置里的词典语言应用到会话。
 *
 * 两个注意点：
 *
 *   1. **语言必须在窗口加载内容之前设置。** 之后再改，已经渲染的文本不会
 *      重新检查——用户会以为"改了没生效"。
 *   2. **不可用的语言要过滤掉。** Chromium 只带一部分词典，
 *      传一个它不认识的值会整个调用失败，连原本能用的语言也一起丢掉。
 *      所以先与 `availableSpellCheckerLanguages` 取交集。
 */
export function 应用拼写词典(settings: Settings): void {
  try {
    const 会话 = session.defaultSession
    if (!settings.spellCheck) {
      // 关闭时清空语言列表，等价于停用检查
      会话.setSpellCheckerLanguages([])
      return
    }
    const available = new Set(会话.availableSpellCheckerLanguages)
    const request = settings.spellCheckLanguages.filter((语) => available.has(语))
    // 一个都不匹配时回退到英语：有检查总比静默失效好，而且这是最常见的用法。
    const 最终 = request.length > 0 ? request : ['en-US'].filter((语) => available.has(语))
    if (最终.length > 0) 会话.setSpellCheckerLanguages(最终)
  } catch (error) {
    // 拿不到会话时静默跳过：拼写检查是锦上添花，不该影响启动。
    console.error('[拼写检查] 设置词典失败：', error)
  }
}

/** 当前系统上可用的词典语言，供设置面板展示。 */
export function 可用词典(): string[] {
  try {
    return session.defaultSession.availableSpellCheckerLanguages
  } catch {
    return []
  }
}

const forceClose = new WeakSet<BrowserWindow>()

/**
 * 窗口的渲染进程开始监听后应立即打开的文档。
 *
 * `ready-to-show` 在首次绘制之后触发，这可能*早于*渲染进程完成启动并注册
 * 监听器——在那个时机发送路径会把消息丢掉。所以路径先暂存在这里，等渲染进程
 * 上报就绪后再投递。
 */
const pendingPaths = new Map<number, string>()

/** 取走某个窗口暂存的文档路径（如果有）。 */
export function takePendingPath(win: BrowserWindow): string | null {
  const path = pendingPaths.get(win.id)
  if (path) pendingPaths.delete(win.id)
  return path ?? null
}

export interface WindowOptions {
  /** 在新窗口中打开的绝对路径。 */
  path?: string
}

export function createWindow(options: WindowOptions = {}): BrowserWindow {
  const settings = getSettings()

  // 冒烟测试用一个很高的窗口：CodeMirror 只渲染视口内的行，窗口太矮就会
  // 把文档下半部分"虚拟化"掉，装饰无从统计。加高之后，紧凑的验证样本
  // 可以整篇落在一屏内，DOM 计数与解析树计数就能逐项对账。
  const 冒烟测试 = process.argv.includes('--smoke-test')

  const win = new BrowserWindow({
    width: 1100,
    height: 冒烟测试 ? 1600 : 760,
    minWidth: 480,
    minHeight: 320,
    show: !冒烟测试 ? true : false,
    backgroundColor: settings.isDarkMode ? '#0d1117' : '#ffffff',
    autoHideMenuBar: false,
    title: 'selfMD',
    // Windows 下窗口图标不会自动继承 exe 图标，必须显式给。
    // 用 256×256：Windows 会自己缩到标题栏与任务栏需要的尺寸。
    ...(iconPath('icon-256.png') ? { icon: iconPath('icon-256.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 拼写检查由 Chromium 自带：开与关差一个红波浪线，以及右键菜单里的
      // "建议替换"。默认关闭——中文没有可用的拼写词典，
      // 开着只会让中文用户看到满屏红波浪线。
      spellcheck: settings.spellCheck
    }
  })

  // 词典语言要在会话上设置，且**必须在窗口加载内容之前**。
  // 窗口建好之后再改，已经渲染的文本不会重新检查。
  应用拼写词典(settings)

  win.once('ready-to-show', () => {
    // 冒烟测试同样要显示窗口：Chromium 在窗口不可见时会挂起渲染，
    // 装饰就不会落进 DOM，统计结果会全是 0。
    win.show()
  })

  if (options.path) pendingPaths.set(win.id, options.path)

  // --- 全屏的两件必须做的事 ---------------------------------------------
  //
  // 全屏时 Windows 会把整个标题栏连同最小化/最大化/关闭一起隐藏。
  // 这是系统行为、不是缺陷，但由此带来两个必须自己补上的出口：

  // 1. **Esc 退出全屏。**
  //    `win.setFullScreen(true)` 是程序化全屏，Electron 不会自动响应 Esc；
  //    用户之前能退出多半是碰巧（按了 F11，或系统层的偶发处理）。
  //    全屏下没有任何可点的按钮，不给一条确定的退路就会真的卡住。
  //    用 `before-input-event` 而不是在渲染层监听键盘：渲染层的监听要看焦点，
  //    而全屏时用户可能刚点过侧边栏，焦点不在编辑器上。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false)
      event.preventDefault()
    }
  })

  // 2. **菜单勾选要跟着实际状态走。**
  //    `全屏` 是个 checkbox，但之前没给 `checked`，也没在状态变化时重建菜单，
  //    于是全屏时菜单里那一项仍显示未勾选——用户会以为功能没生效。
  const 同步菜单 = (): void => {
    if (!win.isDestroyed()) rebuildMenu()
  }
  win.on('enter-full-screen', 同步菜单)
  win.on('leave-full-screen', 同步菜单)


  // 把渲染进程的日志输出到 main 进程的 stdout。否则从终端启动应用时，
  // 渲染进程启动阶段的失败是完全看不见的。
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const tag = ['debug', 'info', 'warn', 'error'][level] ?? 'log'
    const where = sourceId ? ` (${sourceId}:${line})` : ''
    console.log(`[renderer:${tag}] ${message}${where}`)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[selfMD] renderer process gone:', details)
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[selfMD] preload failed:', preloadPath, error)
  })

  win.on('close', (event) => {
    if (forceClose.has(win)) return
    event.preventDefault()
    win.webContents.send(EV.requestClose, {})
  })

  // target="_blank" 与 window.open 的链接一律交给系统浏览器打开，绝不在应用内打开。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** 关闭窗口，不进行未保存改动的往返确认。 */
export function closeWindow(win: BrowserWindow): void {
  forceClose.add(win)
  win.close()
}

export function windowId(win: BrowserWindow): number {
  return win.id
}
