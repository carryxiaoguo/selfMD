import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppInfo, AppPaths, TaskProgress } from '@shared/ipc'
import { CH, EV } from '@shared/ipc'
import { 生效主题, type Settings } from '@shared/types'
import { 可用格式, 执行导出, 取Pandoc版本 } from '../export'
import { 复制为图片 } from '../export/图片'
import {
  写草稿,
  列出草稿,
  删除草稿,
  清理该文档的草稿,
  读草稿,
  需要恢复的草稿
} from '../services/drafts'
import {
  getSettings,
  patchSettings,
  resetSettings,
  setSetting,
  settingsFilePath
} from '../services/settings'
import {
  deleteTheme,
  installTheme,
  isSafeThemeId,
  listThemes,
  readTheme,
  themePath,
  主题自定义样式路径,
  全局自定义样式路径
} from '../services/themes'
import {
  addRecent,
  addRecentFolder,
  clearRecent,
  listRecent,
  pinRecent,
  removeRecent
} from '../services/recent'
import { getAppPaths } from '../util/paths'
import { closeWindow, createWindow, takePendingPath } from '../window'
import { rebuildMenu } from '../menu'

/** 向所有渲染进程广播事件。 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function windowOf(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/** 等待第一个渲染进程上报启动完成的回调。 */
const readyResolvers = new Set<() => void>()

/** 把计数表格式化成一行，便于在日志里对齐比对。 */
function 格式化计数(计数: Record<string, number>): string {
  const 条目 = Object.entries(计数).filter(([, 值]) => 值 > 0)
  if (条目.length === 0) return '（全部为 0）'
  return 条目.map(([名, 值]) => `${名}=${值}`).join('  ')
}

/** 在某个渲染进程上报启动完成后 resolve。 */
export function whenRendererReady(): Promise<void> {
  return new Promise((resolve) => readyResolvers.add(resolve))
}

/** 等待文档加载完成的回调。 */
const openedResolvers = new Set<() => void>()

/** 在任意渲染进程上报文档已加载后 resolve。 */
export function whenDocumentOpened(): Promise<void> {
  return new Promise((resolve) => openedResolvers.add(resolve))
}

/** 各导出格式对应的文件扩展名。 */
function 格式扩展名(格式: string): string {
  switch (格式) {
    case 'html':
    case 'html-plain':
      return '.html'
    case 'pdf':
      return '.pdf'
    case 'docx':
      return '.docx'
    case 'latex':
      return '.tex'
    case 'epub':
      return '.epub'
    case 'rtf':
      return '.rtf'
    case 'odt':
      return '.odt'
    default:
      return '.html'
  }
}

export function registerAppIpc(): void {
  // ------------------------------------------------------------- 设置 --
  ipcMain.handle(CH.settingsGet, () => getSettings())

  ipcMain.handle(CH.settingsSet, (_e, key: keyof Settings, value: unknown) => {
    const next = setSetting(key, value as never)
    rebuildMenu()
    broadcast(EV.settingsChanged, next)
    return next
  })

  ipcMain.handle(CH.settingsPatch, (_e, patch: Partial<Settings>) => {
    const next = patchSettings(patch)
    rebuildMenu()
    broadcast(EV.settingsChanged, next)
    return next
  })

  ipcMain.handle(CH.settingsReset, () => {
    const next = resetSettings()
    rebuildMenu()
    broadcast(EV.settingsChanged, next)
    return next
  })

  ipcMain.handle(CH.settingsOpenFile, async () => {
    const path = settingsFilePath()
    const err = await shell.openPath(path)
    if (err) console.error('[settings] open failed:', err)
  })

  // --------------------------------------------------------------- 主题 --
  ipcMain.handle(CH.themeList, () => listThemes())
  ipcMain.handle(CH.themeRead, (_e, id: string) => readTheme(id))

  ipcMain.handle(CH.themeInstall, async (e) => {
    const win = windowOf(e)
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = {
      title: '安装主题',
      buttonLabel: '选择',
      filters: [{ name: 'CSS 主题', extensions: ['css'] }],
      properties: ['openFile']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    const theme = installTheme(result.filePaths[0])
    rebuildMenu()
    return theme
  })

  ipcMain.handle(CH.themeDelete, (_e, id: string) => {
    deleteTheme(id)
    rebuildMenu()
  })

  ipcMain.handle(CH.themeRevealFolder, async () => {
    const err = await shell.openPath(getAppPaths().themes)
    if (err) console.error('[themes] 打开主题目录失败：', err)
  })

  /**
   * 打开自定义 CSS；不存在时先写一份带说明的模板。
   *
   * 为什么要"不存在就创建"：让用户从菜单点一下就能开始改，
   * 而不是先被告知"请手动在某个目录新建某个名字的文件"。
   * 模板里写清了这个文件的作用域与生效时机，省掉一次查文档。
   */
  ipcMain.handle(CH.themeOpenCustom, async (_e, 范围: 'base' | 'theme') => {
    const 设置 = getSettings()
    const 目标 =
      范围 === 'base' ? 全局自定义样式路径() : 主题自定义样式路径(生效主题(设置))
    if (!目标) return { 路径: null }

    if (!existsSync(目标)) {
      const 主题名 = 生效主题(设置)
      const 模板 =
        范围 === 'base'
          ? `/* 全局自定义 CSS —— 对**所有**主题生效。\n` +
            ` *\n` +
            ` * 层叠顺序：主题本体 < 本文件 < <主题名>.user.css\n` +
            ` * 所以你在这里写的东西会压过任何主题，但不能压过单主题的自定义文件。\n` +
            ` *\n` +
            ` * 常用变量（名字与通行做法一致，现成主题可直接迁移）：\n` +
            ` *   --bg-color             背景色\n` +
            ` *   --text-color           正文颜色\n` +
            ` *   --select-text-bg-color 选区背景\n` +
            ` *   --side-bar-bg-color    侧边栏背景\n` +
            ` *   --primary-color        强调色\n` +
            ` *   --md-char-color        Markdown 标记符颜色\n` +
            ` *   --monospace            等宽字体\n` +
            ` *\n` +
            ` * 也可以直接写选择器。内容容器的锚点是 #write：\n` +
            ` *   #write .cm-lp-h1 { letter-spacing: .02em; }\n` +
            ` *\n` +
            ` * 改完保存，回到编辑器执行「视图 → 主题 → 重新加载主题」即可看到效果。\n` +
            ` */\n\n:root {\n  /* 在这里覆盖变量 */\n}\n`
          : `/* 主题「${主题名}」专属的自定义 CSS。\n` +
            ` *\n` +
            ` * 只在「${主题名}」生效；换到别的主题就不起作用。\n` +
            ` * 层叠顺序：主题本体 < base.user.css < 本文件 —— 本文件优先级最高。\n` +
            ` *\n` +
            ` * 适合放"只在这套配色下才成立"的微调，例如：\n` +
            ` *   #write .cm-lp-quote { border-left-width: 4px; }\n` +
            ` */\n\n`
      try {
        mkdirSync(getAppPaths().themes, { recursive: true })
        writeFileSync(目标, 模板, 'utf8')
      } catch (错误) {
        console.error('[themes] 创建自定义 CSS 失败：', 错误)
        return { 路径: null }
      }
    }

    const err = await shell.openPath(目标)
    if (err) {
      console.error('[themes] 打开自定义 CSS 失败：', err)
      return { 路径: null }
    }
    return { 路径: 目标 }
  })

  /** 新建主题文件。名称为空或含非法字符时返回 null。 */
  ipcMain.handle(CH.themeCreate, (_e, 名: string) => {
    const id = (名 ?? '').trim().replace(/\.css$/i, '')
    if (!isSafeThemeId(id)) return null
    const 目标 = themePath(id)
    if (!目标 || existsSync(目标)) return null
    try {
      mkdirSync(getAppPaths().themes, { recursive: true })
      writeFileSync(
        目标,
        `/**\n * @name ${id}\n * @dark false\n */\n\n` +
          `/* 变量分两层，两层都在 renderer/src/styles/base.css 的 :root 里：\n` +
          ` *   1. 通用变量层：--bg-color / --text-color / --side-bar-bg-color …\n` +
          ` *   2. 本项目层：--bg-primary / --text-primary …（由第 1 层派生）\n` +
          ` *\n` +
          ` * 只覆盖变量是最稳的写法；需要改版式时再直接写选择器，\n` +
          ` * 内容容器的锚点是 #write。\n` +
          ` */\n\n:root {\n  --bg-color: #ffffff;\n  --text-color: #1f2328;\n}\n`,
        'utf8'
      )
    } catch (错误) {
      console.error('[themes] 新建主题失败：', 错误)
      return null
    }
    rebuildMenu()
    return listThemes().find((t) => t.id === id) ?? null
  })

  // --------------------------------------------------------------- 导出 --
  ipcMain.handle(CH.exportFormats, async () => ({
    格式: await 可用格式(),
    pandoc版本: await 取Pandoc版本()
  }))

  ipcMain.handle(
    CH.exportDoc,
    async (
      e,
      请求: {
        格式: string
        源: string
        文档路径: string | null
        默认文件名: string
        附大纲?: boolean
        内嵌图片?: boolean
      }
    ) => {
      const 扩展名 = 格式扩展名(请求.格式)
      const win = windowOf(e)
      const { dialog } = await import('electron')
      const 选项: Electron.SaveDialogOptions = {
        title: `导出为 ${请求.格式.toUpperCase()}`,
        defaultPath: 请求.默认文件名.endsWith(扩展名)
          ? 请求.默认文件名
          : `${请求.默认文件名}${扩展名}`,
        filters: [{ name: 请求.格式.toUpperCase(), extensions: [扩展名.replace(/^\./, '')] }]
      }
      const 选择 = win
        ? await dialog.showSaveDialog(win, 选项)
        : await dialog.showSaveDialog(选项)
      if (选择.canceled || !选择.filePath) return { 路径: null, 错误: null }

      const 结果 = await 执行导出({
        目标: 选择.filePath,
        源: 请求.源,
        文档路径: 请求.文档路径,
        格式: 请求.格式 as never,
        // 导出选项由渲染层按设置传入；没传时用这里的默认值。
        附大纲: 请求.附大纲 ?? true,
        内嵌图片: 请求.内嵌图片 ?? false
      })
      return { 路径: 结果.路径, 错误: 结果.错误 }
    }
  )

  // ------------------------------------------------------- 复制为图片 --
  // 走离屏窗口加载**导出的 HTML** 再截图：渲染结果与导出完全一致，
  // 因为它们走的是同一条路。在 Canvas 上重画一遍等于把渲染器再实现一次，
  // 公式、图表、代码高亮都得重做，而且两边迟早不一致。
  ipcMain.handle(
    CH.editCopyAsImage,
    async (_e, 请求: { 源: string; 文档路径: string | null; 宽度?: number }) => {
      return 复制为图片(
        { 目标: '', 源: 请求.源, 文档路径: 请求.文档路径, 格式: 'html' },
        请求.宽度
      )
    }
  )

  // --------------------------------------------------------------- 打印 --
  // 走 `webContents.print` 而不是渲染层的 `window.print()`：前者能指定
  // `printBackground`，否则打印出来的代码块与引用块背景全丢。
  ipcMain.handle(CH.appPrint, async (e) => {
    const win = windowOf(e)
    if (!win) return { 成功: false, 错误: '找不到窗口' }
    return new Promise<{ 成功: boolean; 错误: string | null }>((完成) => {
      win.webContents.print({ silent: false, printBackground: true }, (成功, 原因) => {
        完成({ 成功, 错误: 成功 ? null : 原因 || '打印已取消' })
      })
    })
  })

  // --------------------------------------------------------------- 草稿 --
  // 自动保存是后台行为：写失败不抛异常，也不弹窗。磁盘满或文件被占用时
  // 安静跳过即可，下一次改动还会再试——用错误框打断打字才是更糟的选择。
  ipcMain.handle(CH.draftSave, (_e, 原路径: string | null, 内容: string) =>
    写草稿(原路径, 内容)
  )
  ipcMain.handle(CH.draftList, () => 列出草稿())
  ipcMain.handle(CH.draftRead, (_e, 键: string) => 读草稿(键))
  ipcMain.handle(CH.draftDiscard, (_e, 键: string) => 删除草稿(键))
  ipcMain.handle(CH.draftPending, () => 需要恢复的草稿())
  ipcMain.handle(CH.draftClearFor, (_e, 原路径: string | null, 内容: string) =>
    清理该文档的草稿(原路径, 内容)
  )

  // --------------------------------------------------------------- 最近 --
  ipcMain.handle(CH.recentList, () => listRecent())
  ipcMain.handle(CH.recentAdd, (_e, path: string) => {
    const next = addRecent(path)
    rebuildMenu()
    return next
  })
  ipcMain.handle(CH.recentAddFolder, (_e, path: string) => {
    const next = addRecentFolder(path)
    rebuildMenu()
    return next
  })
  ipcMain.handle(CH.recentPin, (_e, path: string, pinned: boolean) => {
    const next = pinRecent(path, pinned)
    rebuildMenu()
    return next
  })
  ipcMain.handle(CH.recentRemove, (_e, path: string) => {
    const next = removeRecent(path)
    rebuildMenu()
    return next
  })
  ipcMain.handle(CH.recentClear, (_e, includePinned: boolean) => {
    const next = clearRecent(includePinned)
    rebuildMenu()
    return next
  })

  // --------------------------------------------------------------- 窗口 --
  ipcMain.handle(CH.windowMinimize, (e) => {
    windowOf(e)?.minimize()
  })

  ipcMain.handle(CH.windowToggleMaximize, (e) => {
    const win = windowOf(e)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(CH.windowClose, (e) => {
    windowOf(e)?.close()
  })

  ipcMain.handle(CH.windowCloseForce, (e) => {
    const win = windowOf(e)
    if (win) closeWindow(win)
  })

  ipcMain.handle(CH.windowNew, (_e, path?: string) => {
    createWindow(path ? { path } : {})
  })

  ipcMain.handle(CH.windowSetAlwaysOnTop, (e, on: boolean) => {
    const win = windowOf(e)
    if (!win) return false
    win.setAlwaysOnTop(on)
    // 「窗口置顶」是菜单里的 checkbox，改完必须重建菜单，勾选才会跟上实际状态。
    // 全屏那边有 enter/leave-full-screen 事件可挂，置顶没有对应事件，
    // 只能在这里显式重建。
    rebuildMenu()
    return win.isAlwaysOnTop()
  })

  ipcMain.handle(CH.windowSetFullScreen, (e, on: boolean) => {
    const win = windowOf(e)
    if (!win) return false
    win.setFullScreen(on)
    return win.isFullScreen()
  })

  ipcMain.handle(CH.windowIsFullScreen, (e) => windowOf(e)?.isFullScreen() ?? false)

  ipcMain.handle(CH.windowSetZoom, (e, factor: number) => {
    const win = windowOf(e)
    if (!win) return 1
    const clamped = Math.min(5, Math.max(0.3, factor))
    win.webContents.setZoomFactor(clamped)
    return clamped
  })

  ipcMain.handle(CH.windowGetZoom, (e) => windowOf(e)?.webContents.getZoomFactor() ?? 1)

  // ------------------------------------------------------------------ 应用 --
  ipcMain.handle(CH.appQuit, () => {
    app.quit()
  })

  ipcMain.handle(CH.appGetInfo, (): AppInfo => {
    return {
      name: 'selfMD',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      isPackaged: app.isPackaged,
      smokeTest: process.argv.includes('--smoke-test')
    }
  })

  ipcMain.handle(CH.appGetPaths, (): AppPaths => getAppPaths())

  ipcMain.handle(CH.appOpenDevTools, (e) => {
    windowOf(e)?.webContents.toggleDevTools()
  })

  ipcMain.handle(CH.appReady, (e, info: { documents: number }) => {
    console.log('[selfMD] renderer ready', JSON.stringify(info))

    // 渲染进程现在已经开始监听，所以创建窗口时暂存的文档
    // 终于可以投递出去了。
    const win = windowOf(e)
    if (win) {
      const path = takePendingPath(win)
      if (path) win.webContents.send(EV.openDocument, { path })
    }

    readyResolvers.forEach((fn) => fn())
    readyResolvers.clear()
  })

  // ------------------------------------------------------------- 文档 --
  ipcMain.handle(CH.docSetDirty, (e, dirty: boolean) => {
    const win = windowOf(e)
    if (!win) return
    win.setDocumentEdited(dirty)
    // 按通行做法，在标题栏上反映出未保存状态。
    const base = win.getTitle().replace(/^\*/, '')
    win.setTitle(dirty && !base.startsWith('*') ? `*${base}` : base)
  })

  ipcMain.handle(CH.docList, () => [])

  ipcMain.handle(
    CH.docOpened,
    (
      _e,
      info: {
        path: string
        characters: number
        lines: number
        parserCounts?: Record<string, number>
        domCounts?: Record<string, number>
        commandResults?: Record<string, string>
        pureResults?: Record<string, string>
        imageResults?: Record<string, string>
        imageInsertResult?: string
        themeResult?: string
        outlineResults?: Record<string, string>
        sidebarResult?: string
        exportResults?: Record<string, string>
        modeResult?: string
        prefsResults?: Record<string, string>
        prefsUiResult?: string
        uploadResults?: Record<string, string>
        imageMenuResult?: string
        mathResults?: Record<string, string>
        punctResults?: Record<string, string>
        tabResult?: string
        imageCopyResult?: string
        matchResults?: Record<string, string>
        mode?: string
      }
    ) => {
      console.log(
        `[selfMD] 已打开 ${info.path}（${info.characters} 字符，${info.lines} 行，模式=${info.mode}）`
      )
      if (info.parserCounts) {
        console.log('[selfMD] 解析树计数： ' + 格式化计数(info.parserCounts))
      }
      if (info.domCounts) {
        console.log('[selfMD] 渲染 DOM 计数：' + 格式化计数(info.domCounts))
      }
      if (info.commandResults) {
        console.log('[selfMD] 编辑命令自测：')
        for (const [名, 输出] of Object.entries(info.commandResults)) {
          console.log(`    ${名}  →  ${输出}`)
        }
      }
      if (info.pureResults) {
        console.log('[selfMD] 纯函数自测：')
        for (const [名, 输出] of Object.entries(info.pureResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.imageResults) {
        console.log('[selfMD] 图片管线自测：')
        for (const [名, 输出] of Object.entries(info.imageResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.imageInsertResult) {
        console.log(`[selfMD] 图片插入端到端：${info.imageInsertResult}`)
      }
      if (info.themeResult) {
        console.log(`[selfMD] 主题协议自测：${info.themeResult}`)
      }
      if (info.outlineResults) {
        console.log('[selfMD] 大纲自测：')
        for (const [名, 输出] of Object.entries(info.outlineResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.sidebarResult) {
        console.log(`[selfMD] 侧边栏渲染自测：${info.sidebarResult}`)
      }
      if (info.modeResult) {
        console.log(`[selfMD] 编辑模式自测：${info.modeResult}`)
      }
      if (info.exportResults) {
        console.log('[selfMD] 导出渲染自测：')
        for (const [名, 输出] of Object.entries(info.exportResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.prefsResults) {
        console.log('[selfMD] 偏好设置表自测：')
        for (const [名, 输出] of Object.entries(info.prefsResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.prefsUiResult) {
        console.log(`[selfMD] 偏好设置界面自测：${info.prefsUiResult}`)
      }
      if (info.uploadResults) {
        console.log('[selfMD] 上传结果解析自测：')
        for (const [名, 输出] of Object.entries(info.uploadResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.imageMenuResult) {
        console.log(`[selfMD] 图片右键菜单自测：${info.imageMenuResult}`)
      }
      if (info.mathResults) {
        console.log('[selfMD] 数学公式自测：')
        for (const [名, 输出] of Object.entries(info.mathResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.tabResult) console.log(`[selfMD] 多文档标签自测：${info.tabResult}`)
      if (info.imageCopyResult) console.log(`[selfMD] 复制为图片自测：${info.imageCopyResult}`)
      if (info.matchResults) {
        console.log('[selfMD] 模糊匹配自测：')
        for (const [名, 输出] of Object.entries(info.matchResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      if (info.punctResults) {
        console.log('[selfMD] 渲染标点自测：')
        for (const [名, 输出] of Object.entries(info.punctResults)) {
          console.log(`    ${名}  =>  ${输出}`)
        }
      }
      openedResolvers.forEach((fn) => fn())
      openedResolvers.clear()
    }
  )

  // ------------------------------------------------------------ 任务信息 --
  ipcMain.handle(CH.taskProgress, (_e, payload: TaskProgress) => {
    broadcast(EV.taskProgress, payload)
  })

  ipcMain.handle(CH.pathDirname, (_e, p: string) => dirname(p))
}
