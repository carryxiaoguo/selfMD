/**
 * 带类型的 IPC 契约。
 *
 * 通道名采用 `namespace:action` 形式。这是我们自己的方案；通行的 * 暴露出 91 个点分通道（例如 `app.download`、`dialog.showOpenDialog`），
 * 我们在**能力**上与之对齐，而不是在线上格式上。
 *
 * main  : ipcMain.handle(CH.x, handler)        -> 请求/响应
 * main  : webContents.send(EV.x, payload)      -> main 主动发起的事件
 * preload: contextBridge.exposeInMainWorld('selfmd', api)
 */

import type {
  DirEntry,
  DocumentIdentity,
  FileStat,
  Platform,
  RecentEntry,
  Settings,
  草稿信息,
  ThemeInfo
} from './types'

// 重新导出，使 main / preload / renderer 都能从同一个模块说明符导入全部共享
// 类型，而不必直接深入 ./types。
export type {
  DirEntry,
  DocumentIdentity,
  FileStat,
  Platform,
  RecentEntry,
  Settings,
  ThemeInfo
}

// ---------------------------------------------------------------------------
// 请求/响应通道
// ---------------------------------------------------------------------------

export const CH = {
  // --- 文件系统 ----------------------------------------------------------
  fileRead: 'file:read',
  fileWrite: 'file:write',
  fileStat: 'file:stat',
  fileExists: 'file:exists',
  fileListDir: 'file:listDir',
  fileMkdirp: 'file:mkdirp',
  fileRename: 'file:rename',
  fileMove: 'file:move',
  fileCopy: 'file:copy',
  fileTrash: 'file:trash',
  fileShowInFolder: 'file:showInFolder',
  fileOpenExternal: 'file:openExternal',
  fileResolve: 'file:resolve',
  fileRelative: 'file:relative',

  // --- 对话框 --------------------------------------------------------------
  dialogOpenFile: 'dialog:openFile',
  dialogOpenFolder: 'dialog:openFolder',
  dialogSaveFile: 'dialog:saveFile',
  dialogMessage: 'dialog:message',

  // --- 文档 ------------------------------------------------------------
  docNew: 'doc:new',
  docOpenPath: 'doc:openPath',
  docSave: 'doc:save',
  docSaveAs: 'doc:saveAs',
  docClose: 'doc:close',
  docSetDirty: 'doc:setDirty',
  docList: 'doc:list',
  /** 渲染进程上报已成功加载的文档（验证钩子）。 */
  docOpened: 'doc:opened',

  // --- 设置 -------------------------------------------------------------
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsPatch: 'settings:patch',
  settingsReset: 'settings:reset',
  settingsOpenFile: 'settings:openFile',

  // --- 主题 ---------------------------------------------------------------
  themeList: 'theme:list',
  themeRead: 'theme:read',
  themeInstall: 'theme:install',
  themeDelete: 'theme:delete',
  themeRevealFolder: 'theme:revealFolder',
  /** 打开（必要时先创建）自定义 CSS：全局或当前主题专属。 */
  themeOpenCustom: 'theme:openCustom',
  /** 新建一个主题文件。 */
  themeCreate: 'theme:create',

  // ---------------------------------------------------------------- 导出 --
  /** 可用的导出格式（取决于是否装了 Pandoc）。 */
  exportFormats: 'export:formats',
  /** 导出当前文档：弹保存对话框并执行。 */
  exportDoc: 'export:doc',
  /** 打印当前窗口。 */
  appPrint: 'app:print',

  // --- 草稿与崩溃恢复 -------------------------------------------------------
  draftSave: 'draft:save',
  draftList: 'draft:list',
  draftRead: 'draft:read',
  draftDiscard: 'draft:discard',
  draftPending: 'draft:pending',
  draftClearFor: 'draft:clearFor',

  // --- 最近打开 ------------------------------------------------------------
  recentList: 'recent:list',
  recentAdd: 'recent:add',
  recentAddFolder: 'recent:addFolder',
  recentPin: 'recent:pin',
  recentRemove: 'recent:remove',
  recentClear: 'recent:clear',

  // --- 窗口 / 应用 ---------------------------------------------------------
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  /** 直接关闭，不与渲染进程确认未保存的改动。 */
  windowCloseForce: 'window:closeForce',
  windowNew: 'window:new',
  windowSetAlwaysOnTop: 'window:setAlwaysOnTop',
  windowSetFullScreen: 'window:setFullScreen',
  windowIsFullScreen: 'window:isFullScreen',
  windowSetZoom: 'window:setZoom',
  windowGetZoom: 'window:getZoom',
  appQuit: 'app:quit',
  appGetInfo: 'app:getInfo',
  appGetPaths: 'app:getPaths',
  appOpenDevTools: 'app:openDevTools',
  /** 渲染进程启动完成；供 --smoke-test 的测试脚本使用。 */
  appReady: 'app:ready',

  // --- 剪贴板 ------------------------------------------------------------
  clipboardWriteText: 'clipboard:writeText',
  clipboardWriteHtml: 'clipboard:writeHtml',
  clipboardReadText: 'clipboard:readText',
  clipboardReadHtml: 'clipboard:readHtml',

  // --- 杂项 -----------------------------------------------------------------
  pathDirname: 'path:dirname',
  taskProgress: 'task:progress',

  // --- 图片 -----------------------------------------------------------------
  imageReadClipboard: 'image:readClipboard',
  imageSaveBytes: 'image:saveBytes',
  imageDownload: 'image:download',
  imageImport: 'image:import',
  imageUpload: 'image:upload',
  imageUploaderStatus: 'image:uploaderStatus'
} as const

// ---------------------------------------------------------------------------
// main -> renderer 事件
// ---------------------------------------------------------------------------

export const EV = {
  /** 某个菜单项或快捷键被触发，payload 为命令 id。 */
  menuCommand: 'ev:menuCommand',
  /** 设置发生了变化（可能来自另一个窗口）。 */
  settingsChanged: 'ev:settingsChanged',
  /** 当前主题发生变化。 */
  themeChanged: 'ev:themeChanged',
  /** 文档所对应的文件在磁盘上发生了变化。 */
  fileChangedOnDisk: 'ev:fileChangedOnDisk',
  /** main 要求渲染进程加载某个文档（open-with / 命令行参数）。 */
  openDocument: 'ev:openDocument',
  /** main 要求渲染进程关闭，并回传是否有未保存改动。 */
  requestClose: 'ev:requestClose',
  /** 长时间运行的任务上报进度（导出、上传等）。 */
  taskProgress: 'ev:taskProgress'
} as const

// ---------------------------------------------------------------------------
// payload 类型
// ---------------------------------------------------------------------------

export interface WriteFileRequest {
  path: string
  content: string
  /** 内容末尾缺少换行符时补写一个。 */
  ensureFinalNewline?: boolean
  /** 写入前统一换行符。 */
  lineEnding?: 'lf' | 'crlf' | 'preserve'
}

export interface WriteFileResult {
  path: string
  bytes: number
}

export interface SaveDialogRequest {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface SaveDialogResult {
  canceled: boolean
  filePath: string | null
}

export interface OpenFileDialogRequest {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
  multi?: boolean
}

export interface OpenFileDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface OpenFolderDialogResult {
  canceled: boolean
  folderPath: string | null
}

export interface MessageBoxRequest {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  /** 显示"不再提示"复选框并回传其勾选状态。 */
  checkboxLabel?: string
}

export interface MessageBoxResult {
  response: number
  checkboxChecked: boolean
}

export interface OpenDocumentPayload {
  path: string
  /** 字节在 main 侧解码，这样编码问题不会传到渲染进程。 */
  content: string
  encoding: string
  /** 文件使用 CRLF 换行时为 true。 */
  crlf: boolean
  stat: FileStat
}

export interface DocumentState extends DocumentIdentity {
  /** 拥有该文档的窗口 id。 */
  windowId: number
  encoding: string
  lineEnding: 'lf' | 'crlf'
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: Platform
  isPackaged: boolean
  /** 进程以 --smoke-test 启动时为 true。 */
  smokeTest: boolean
}

export interface AppPaths {
  userData: string
  themes: string
  conf: string
  backups: string
  drafts: string
  userImages: string
  home: string
  documents: string
}

export interface TaskProgress {
  id: string
  label: string
  /** 0..1；为 null 表示进度不确定。 */
  value: number | null
  done: boolean
  error?: string
}

export interface MenuCommandPayload {
  command: string
  args?: unknown
}

// ---------------------------------------------------------------------------
// 图片相关载荷
// ---------------------------------------------------------------------------

/**
 * 剪贴板内容的判定结果。
 *
 * 为什么要区分三种：在 Windows 上从资源管理器复制图片会同时往剪贴板写位图
 * 与文件名列表，两者都拿到时必须**优先按文件处理**——那是原图，而位图可能
 * 是被压缩过的预览。也印证了这一点：在 Windows 上会额外读取
 * 剪贴板的 `FileNameW` 格式来发现被复制的文件。
 */
export type ClipboardContent =
  | { 类型: '位图'; 数据: string; 宽: number; 高: number }
  | { 类型: '文件'; 路径: string[] }
  | { 类型: '无' }

export interface ImageDownloadResult {
  成功: boolean
  路径: string | null
  /** 服务端返回的 MIME 类型，用于在扩展名缺失时补全。 */
  类型: string | null
  错误: string | null
}

// ---------------------------------------------------------------------------
// 通过 contextBridge 交给渲染进程的 API 表面
// ---------------------------------------------------------------------------

export interface SelfMdApi {
  file: {
    read(path: string): Promise<{ content: string; encoding: string; crlf: boolean; stat: FileStat }>
    write(req: WriteFileRequest): Promise<WriteFileResult>
    stat(path: string): Promise<FileStat | null>
    exists(path: string): Promise<boolean>
    listDir(path: string): Promise<DirEntry[]>
    mkdirp(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    move(from: string, to: string): Promise<void>
    copy(from: string, to: string): Promise<void>
    trash(path: string): Promise<void>
    showInFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    resolve(...parts: string[]): Promise<string>
    relative(from: string, to: string): Promise<string>
  }
  dialog: {
    openFile(req?: OpenFileDialogRequest): Promise<OpenFileDialogResult>
    openFolder(req?: OpenFileDialogRequest): Promise<OpenFolderDialogResult>
    saveFile(req?: SaveDialogRequest): Promise<SaveDialogResult>
    message(req: MessageBoxRequest): Promise<MessageBoxResult>
  }
  doc: {
    openPath(path: string): Promise<OpenDocumentPayload | null>
    save(path: string, content: string, lineEnding: 'lf' | 'crlf'): Promise<WriteFileResult>
    setDirty(dirty: boolean): Promise<void>
    list(): Promise<DocumentState[]>
    notifyOpened(info: {
      path: string
      characters: number
      lines: number
      /** 仅冒烟测试模式：解析树里各类节点的数量。 */
      parserCounts?: Record<string, number>
      /** 仅冒烟测试模式：渲染后各类装饰元素的 DOM 数量。 */
      domCounts?: Record<string, number>
      /** 仅冒烟测试模式：编辑命令自测的输入输出对照。 */
      commandResults?: Record<string, string>
      /** 仅冒烟测试模式：纯函数（智能标点、选区算法）自测结果。 */
      pureResults?: Record<string, string>
      /** 仅冒烟测试模式：图片管线纯函数（目标解析、搬运判定）自测结果。 */
      imageResults?: Record<string, string>
      /** 仅冒烟测试模式：图片插入端到端结果。 */
      imageInsertResult?: string
      /** 仅冒烟测试模式：主题协议层（资源子目录、目录穿越防护）自测结果。 */
      themeResult?: string
      /** 仅冒烟测试模式：大纲提取与定位自测结果。 */
      outlineResults?: Record<string, string>
      /** 仅冒烟测试模式：侧边栏 DOM 渲染自测结果。 */
      sidebarResult?: string
      /** 仅冒烟测试模式：Markdown → HTML 导出渲染自测结果。 */
      exportResults?: Record<string, string>
      /** 仅冒烟测试模式：专注模式与打字机模式自测结果。 */
      modeResult?: string
      /** 仅冒烟测试模式：偏好设置表自测结果。 */
      prefsResults?: Record<string, string>
      /** 仅冒烟测试模式：偏好设置面板渲染自测结果。 */
      prefsUiResult?: string
      /** 仅冒烟测试模式：图床上传结果解析自测结果。 */
      uploadResults?: Record<string, string>
      /** 仅冒烟测试模式：图片右键菜单渲染自测结果。 */
      imageMenuResult?: string
      /** 仅冒烟测试模式：数学公式扫描与块级识别自测结果。 */
      mathResults?: Record<string, string>
      mode?: string
    }): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<Settings>
    patch(patch: Partial<Settings>): Promise<Settings>
    reset(): Promise<Settings>
    openFile(): Promise<void>
  }
  theme: {
    list(): Promise<ThemeInfo[]>
    read(id: string): Promise<string>
    install(): Promise<ThemeInfo | null>
    delete(id: string): Promise<void>
    revealFolder(): Promise<void>
    /**
     * 打开自定义 CSS 文件；不存在时先写入一份带说明的模板。
     *
     * @param 范围 `base` = 对所有主题生效；`theme` = 只对当前主题生效
     */
    openCustom(范围: 'base' | 'theme'): Promise<{ 路径: string | null }>
    /** 新建一个主题文件（内容为带说明的模板）。 */
    create(名: string): Promise<ThemeInfo | null>
  }
  export: {
    /** 各格式是否可用；Word 等需要 Pandoc。 */
    formats(): Promise<{ 格式: Record<string, boolean>; pandoc版本: string | null }>
    /**
     * 导出当前文档：弹保存对话框，然后按格式执行。
     *
     * @returns 目标路径；用户取消或失败时为 null（失败原因在 `错误` 里）
     */
    run(请求: {
      格式: string
      源: string
      文档路径: string | null
      默认文件名: string
    }): Promise<{ 路径: string | null; 错误: string | null }>
  }
  print(): Promise<{ 成功: boolean; 错误: string | null }>
  draft: {
    /** 写一份草稿。返回是否成功；失败不抛异常（自动保存是后台行为）。 */
    save(原路径: string | null, 内容: string): Promise<boolean>
    /** 列出全部草稿，从新到旧。 */
    list(): Promise<草稿信息[]>
    /** 读草稿内容。 */
    read(键: string): Promise<string | null>
    /** 丢弃一份草稿。 */
    discard(键: string): Promise<void>
    /** 需要提示用户恢复的草稿。 */
    pending(): Promise<草稿信息[]>
    /** 文档保存成功后清掉它的草稿。 */
    clearFor(原路径: string | null, 内容: string): Promise<void>
  }
  recent: {
    list(): Promise<RecentEntry[]>
    add(path: string): Promise<RecentEntry[]>
    pin(path: string, pinned: boolean): Promise<RecentEntry[]>
    clear(includePinned: boolean): Promise<RecentEntry[]>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    /** 渲染进程自行处理完未保存改动后调用。 */
    closeForce(): Promise<void>
    newWindow(path?: string): Promise<void>
    setAlwaysOnTop(on: boolean): Promise<boolean>
    setFullScreen(on: boolean): Promise<boolean>
    isFullScreen(): Promise<boolean>
    setZoom(factor: number): Promise<number>
    getZoom(): Promise<number>
  }
  app: {
    quit(): Promise<void>
    getInfo(): Promise<AppInfo>
    getPaths(): Promise<AppPaths>
    openDevTools(): Promise<void>
    /** 通知渲染进程已完成启动。 */
    signalReady(info: { documents: number }): Promise<void>
  }
  on: {
    menuCommand(cb: (p: MenuCommandPayload) => void): () => void
    settingsChanged(cb: (s: Settings) => void): () => void
    themeChanged(cb: (t: { theme: string; isDark: boolean }) => void): () => void
    fileChangedOnDisk(cb: (p: { path: string }) => void): () => void
    openDocument(cb: (p: { path: string }) => void): () => void
    requestClose(cb: () => void): () => void
    taskProgress(cb: (p: TaskProgress) => void): () => void
  }
  image: {
    /** 读取剪贴板，判定是位图、文件还是空。 */
    readClipboard(): Promise<ClipboardContent>
    /** 把 base64 数据写成文件，返回最终路径（重名时自动避让）。 */
    saveBytes(dir: string, 名称: string, 数据: string): Promise<{ 路径: string } | null>
    /** 下载远程图片到目录，返回最终路径。 */
    download(url: string, dir: string, 名称: string): Promise<ImageDownloadResult>
    /**
     * 把本地图片复制进目标目录，重名时自动避让。
     *
     * 做成一个原子动作而不是"先查是否存在、再复制"：后者在某张图被并发插入时
     * 会两边都判定"不存在"，然后后写的覆盖先写的。
     */
    import(from: string, dir: string, 名称?: string): Promise<{ 路径: string } | null>
    /** 判断文件是否存在。 */
    exists(path: string): Promise<boolean>
    /**
     * 上传若干张本地图片到图床。
     *
     * 返回一一对应的「原路径 → 远程地址」；回填文档由渲染层负责——
     * 主进程不该去改用户的 Markdown。
     */
    upload(路径们: string[]): Promise<{
      成功: { 原路径: string; 地址: string }[]
      失败: { 原路径: string; 原因: string }[]
    }>
    /** 当前上传器是否配置完整。 */
    uploaderStatus(): Promise<{ 可用: boolean; 原因: string | null }>
  }
}

/** 次要 API 表面：用于不属于正式文档化 API 的便利接口。 */
export interface SelfMdExtraApi {
  clipboard: {
    writeText(text: string): Promise<void>
    writeHtml(html: string, text: string): Promise<void>
    readText(): Promise<string>
    readHtml(): Promise<string>
  }
  recent: {
    addFolder(path: string): Promise<RecentEntry[]>
    remove(path: string): Promise<RecentEntry[]>
  }
  path: {
    dirname(path: string): Promise<string>
  }
  task: {
    report(payload: TaskProgress): Promise<void>
  }
  webUtils: {
    /** 取拖放进来的 File 在磁盘上的绝对路径；不是本地文件时返回空串。 */
    pathForFile(file: File): string
  }
}

declare global {
  interface Window {
    selfmd: SelfMdApi
    selfmdExtra: SelfMdExtraApi
  }
}
