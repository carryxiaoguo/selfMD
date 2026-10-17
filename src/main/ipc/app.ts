import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppInfo, AppPaths, TaskProgress } from '@shared/ipc'
import { CH, EV } from '@shared/ipc'
import { activeTheme, type Settings } from '@shared/types'
import { 可用格式, 执行导出, 取Pandoc版本 } from '../export'
import { 复制为图片 } from '../export/图片'
import {
  writeDraft,
  listDrafts,
  deleteDraft,
  清理该文档的草稿,
  读草稿,
  recoverableDraft
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
import { 打开默认应用设置, 本程序路径, 取关联状态 } from '../services/文件关联'

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
  const entry = Object.entries(计数).filter(([, value]) => value > 0)
  if (entry.length === 0) return '（全部为 0）'
  return entry.map(([name, value]) => `${name}=${value}`).join('  ')
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
function 格式扩展名(format: string): string {
  switch (format) {
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
  ipcMain.handle(CH.themeOpenCustom, async (_e, rangeBounds: 'base' | 'theme') => {
    const settings = getSettings()
    const target =
      rangeBounds === 'base' ? 全局自定义样式路径() : 主题自定义样式路径(activeTheme(settings))
    if (!target) return { filePath: null }

    if (!existsSync(target)) {
      const 主题名 = activeTheme(settings)
      const template =
        rangeBounds === 'base'
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
        writeFileSync(target, template, 'utf8')
      } catch (error) {
        console.error('[themes] 创建自定义 CSS 失败：', error)
        return { filePath: null }
      }
    }

    const err = await shell.openPath(target)
    if (err) {
      console.error('[themes] 打开自定义 CSS 失败：', err)
      return { filePath: null }
    }
    return { filePath: target }
  })

  /** 新建主题文件。名称为空或含非法字符时返回 null。 */
  ipcMain.handle(CH.themeCreate, (_e, name: string) => {
    const id = (name ?? '').trim().replace(/\.css$/i, '')
    if (!isSafeThemeId(id)) return null
    const target = themePath(id)
    if (!target || existsSync(target)) return null
    try {
      mkdirSync(getAppPaths().themes, { recursive: true })
      writeFileSync(
        target,
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
    } catch (error) {
      console.error('[themes] 新建主题失败：', error)
      return null
    }
    rebuildMenu()
    return listThemes().find((t) => t.id === id) ?? null
  })

  // --------------------------------------------------------------- 导出 --
  ipcMain.handle(CH.exportFormats, async () => ({
    format: await 可用格式(),
    pandoc版本: await 取Pandoc版本()
  }))

  ipcMain.handle(
    CH.exportDoc,
    async (
      e,
      request: {
        format: string
        source: string
        docPath: string | null
        默认文件名: string
        withOutline?: boolean
        embeddedImage?: boolean
      }
    ) => {
      const ext = 格式扩展名(request.format)
      const win = windowOf(e)
      const { dialog } = await import('electron')
      const options: Electron.SaveDialogOptions = {
        title: `导出为 ${request.format.toUpperCase()}`,
        defaultPath: request.默认文件名.endsWith(ext)
          ? request.默认文件名
          : `${request.默认文件名}${ext}`,
        filters: [{ name: request.format.toUpperCase(), extensions: [ext.replace(/^\./, '')] }]
      }
      const choose = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (choose.canceled || !choose.filePath) return { filePath: null, error: null }

      const result = await 执行导出({
        target: choose.filePath,
        source: request.source,
        docPath: request.docPath,
        format: request.format as never,
        // 导出选项由渲染层按设置传入；没传时用这里的默认值。
        withOutline: request.withOutline ?? true,
        embeddedImage: request.embeddedImage ?? false
      })
      return { filePath: result.filePath, error: result.error }
    }
  )

  // ------------------------------------------------------- 复制为图片 --
  // 走离屏窗口加载**导出的 HTML** 再截图：渲染结果与导出完全一致，
  // 因为它们走的是同一条路。在 Canvas 上重画一遍等于把渲染器再实现一次，
  // 公式、图表、代码高亮都得重做，而且两边迟早不一致。
  ipcMain.handle(
    CH.editCopyAsImage,
    async (_e, request: { source: string; docPath: string | null; widthPx?: number }) => {
      return 复制为图片(
        { target: '', source: request.source, docPath: request.docPath, format: 'html' },
        request.widthPx
      )
    }
  )

  // ------------------------------------------------------- 文件关联 --
  // 做成"可读 + 引导"而不是"一键设为默认"：Win10 起默认程序只能由用户
  // 在系统设置里亲自选，任何程序都改不了（UserChoice 带防篡改校验）。
  // 与其给一个注定失败的按钮，不如把当前状态如实报出来，再把人送过去。
  ipcMain.handle(CH.appFileAssoc, () => ({
    ...取关联状态(),
    程序路径: 本程序路径()
  }))

  ipcMain.handle(CH.appOpenDefaultApps, async () => {
    await 打开默认应用设置()
  })

  // --------------------------------------------------------------- 打印 --
  // 走 `webContents.print` 而不是渲染层的 `window.print()`：前者能指定
  // `printBackground`，否则打印出来的代码块与引用块背景全丢。
  ipcMain.handle(CH.appPrint, async (e) => {
    const win = windowOf(e)
    if (!win) return { success: false, error: '找不到窗口' }
    return new Promise<{ success: boolean; error: string | null }>((done) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        done({ success, error: success ? null : reason || '打印已取消' })
      })
    })
  })

  // --------------------------------------------------------------- 草稿 --
  // 自动保存是后台行为：写失败不抛异常，也不弹窗。磁盘满或文件被占用时
  // 安静跳过即可，下一次改动还会再试——用错误框打断打字才是更糟的选择。
  ipcMain.handle(CH.draftSave, (_e, rawPath: string | null, content: string) =>
    writeDraft(rawPath, content)
  )
  ipcMain.handle(CH.draftList, () => listDrafts())
  ipcMain.handle(CH.draftRead, (_e, key: string) => 读草稿(key))
  ipcMain.handle(CH.draftDiscard, (_e, key: string) => deleteDraft(key))
  ipcMain.handle(CH.draftPending, () => recoverableDraft())
  ipcMain.handle(CH.draftClearFor, (_e, rawPath: string | null, content: string) =>
    清理该文档的草稿(rawPath, content)
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
        interactionResult?: string
        codeBlockResult?: string
        contextMenuResult?: string
        codeBlockHeaderResult?: string
        tableResult?: string
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
        for (const [name, output] of Object.entries(info.commandResults)) {
          console.log(`    ${name}  →  ${output}`)
        }
      }
      if (info.pureResults) {
        console.log('[selfMD] 纯函数自测：')
        for (const [name, output] of Object.entries(info.pureResults)) {
          console.log(`    ${name}  =>  ${output}`)
        }
      }
      if (info.imageResults) {
        console.log('[selfMD] 图片管线自测：')
        for (const [name, output] of Object.entries(info.imageResults)) {
          console.log(`    ${name}  =>  ${output}`)
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
        for (const [name, output] of Object.entries(info.outlineResults)) {
          console.log(`    ${name}  =>  ${output}`)
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
        for (const [name, output] of Object.entries(info.exportResults)) {
          console.log(`    ${name}  =>  ${output}`)
        }
      }
      if (info.prefsResults) {
        console.log('[selfMD] 偏好设置表自测：')
        for (const [name, output] of Object.entries(info.prefsResults)) {
          console.log(`    ${name}  =>  ${output}`)
        }
      }
      if (info.prefsUiResult) {
        console.log(`[selfMD] 偏好设置界面自测：${info.prefsUiResult}`)
      }
      if (info.uploadResults) {
        console.log('[selfMD] 上传结果解析自测：')
        for (const [name, output] of Object.entries(info.uploadResults)) {
          console.log(`    ${name}  =>  ${output}`)
        }
      }
      if (info.imageMenuResult) {
        console.log(`[selfMD] 图片右键菜单自测：${info.imageMenuResult}`)
      }
      if (info.mathResults) {
        console.log('[selfMD] 数学公式自测：')
        for (const [name, output] of Object.entries(info.mathResults)) {
          console.log(`    ${name}  =>  ${output}`)
        }
      }
      if (info.tableResult) {
        console.log(`[selfMD] 表格自测：${info.tableResult}`)
      }
      if (info.codeBlockHeaderResult) {
        console.log(`[selfMD] 代码块头部自测：${info.codeBlockHeaderResult}`)
      }
      if (info.contextMenuResult) {
        console.log(`[selfMD] 右键菜单自测：${info.contextMenuResult}`)
      }
      if (info.codeBlockResult) {
        console.log(`[selfMD] 代码块交互自测：${info.codeBlockResult}`)
      }
      if (info.interactionResult) {
        console.log(`[selfMD] 交互反馈自测：${info.interactionResult}`)
      }
      if (info.tabResult) console.log(`[selfMD] 多文档标签自测：${info.tabResult}`)
      if (info.imageCopyResult) console.log(`[selfMD] 复制为图片自测：${info.imageCopyResult}`)
      if (info.matchResults) {
        console.log('[selfMD] 模糊匹配自测：')
        for (const [name, output] of Object.entries(info.matchResults)) {
          console.log(`    ${name}  =>  ${output}`)
        }
      }
      if (info.punctResults) {
        console.log('[selfMD] 渲染标点自测：')
        for (const [name, output] of Object.entries(info.punctResults)) {
          console.log(`    ${name}  =>  ${output}`)
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
