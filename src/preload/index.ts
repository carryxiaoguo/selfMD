import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppInfo,
  AppPaths,
  ClipboardContent,
  DirEntry,
  DocumentState,
  FileStat,
  ImageDownloadResult,
  MessageBoxRequest,
  MessageBoxResult,
  OpenDocumentPayload,
  OpenFileDialogRequest,
  OpenFileDialogResult,
  OpenFolderDialogResult,
  SaveDialogRequest,
  SaveDialogResult,
  SelfMdApi,
  TaskProgress,
  WriteFileRequest,
  WriteFileResult
} from '@shared/ipc'
import { CH, EV } from '@shared/ipc'
import type { DraftInfo, RecentEntry, Settings, ThemeInfo } from '@shared/types'

/**
 * preload 桥。
 *
 * 渲染进程从不直接接触 Node 或 `ipcRenderer`；它只能看到下面这套带类型的接口。
 * 这让 `contextIsolation` 保持有意义，也使 main/renderer 的边界可以在一个文件里
 * 审计清楚。
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

/** 订阅辅助函数，返回一个用于取消订阅的函数。 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SelfMdApi = {
  file: {
    read: (path) =>
      invoke<{ content: string; encoding: string; crlf: boolean; stat: FileStat }>(CH.fileRead, path),
    write: (req: WriteFileRequest) => invoke<WriteFileResult>(CH.fileWrite, req),
    stat: (path) => invoke<FileStat | null>(CH.fileStat, path),
    exists: (path) => invoke<boolean>(CH.fileExists, path),
    listDir: (path) => invoke<DirEntry[]>(CH.fileListDir, path),
    mkdirp: (path) => invoke<void>(CH.fileMkdirp, path),
    rename: (from, to) => invoke<void>(CH.fileRename, from, to),
    move: (from, to) => invoke<void>(CH.fileMove, from, to),
    copy: (from, to) => invoke<void>(CH.fileCopy, from, to),
    trash: (path) => invoke<void>(CH.fileTrash, path),
    showInFolder: (path) => invoke<void>(CH.fileShowInFolder, path),
    openExternal: (url) => invoke<void>(CH.fileOpenExternal, url),
    resolve: (...parts) => invoke<string>(CH.fileResolve, ...parts),
    relative: (from, to) => invoke<string>(CH.fileRelative, from, to)
  },

  dialog: {
    openFile: (req?: OpenFileDialogRequest) =>
      invoke<OpenFileDialogResult>(CH.dialogOpenFile, req),
    openFolder: (req?: OpenFileDialogRequest) =>
      invoke<OpenFolderDialogResult>(CH.dialogOpenFolder, req),
    saveFile: (req?: SaveDialogRequest) => invoke<SaveDialogResult>(CH.dialogSaveFile, req),
    message: (req: MessageBoxRequest) => invoke<MessageBoxResult>(CH.dialogMessage, req)
  },

  doc: {
    openPath: (path) => invoke<OpenDocumentPayload | null>(CH.docOpenPath, path),
    save: (path, content, lineEnding) =>
      invoke<WriteFileResult>(CH.docSave, path, content, lineEnding),
    setDirty: (dirty) => invoke<void>(CH.docSetDirty, dirty),
    list: () => invoke<DocumentState[]>(CH.docList),
    notifyOpened: (info) => invoke<void>(CH.docOpened, info)
  },

  settings: {
    get: () => invoke<Settings>(CH.settingsGet),
    set: (key, value) => invoke<Settings>(CH.settingsSet, key, value),
    patch: (patch) => invoke<Settings>(CH.settingsPatch, patch),
    reset: () => invoke<Settings>(CH.settingsReset),
    openFile: () => invoke<void>(CH.settingsOpenFile)
  },

  theme: {
    list: () => invoke<ThemeInfo[]>(CH.themeList),
    read: (id) => invoke<string>(CH.themeRead, id),
    install: () => invoke<ThemeInfo | null>(CH.themeInstall),
    delete: (id) => invoke<void>(CH.themeDelete, id),
    revealFolder: () => invoke<void>(CH.themeRevealFolder),
    openCustom: (rangeBounds) => invoke<{ filePath: string | null }>(CH.themeOpenCustom, rangeBounds),
    create: (name) => invoke<ThemeInfo | null>(CH.themeCreate, name)
  },
  export: {
    formats: () =>
      invoke<{ format: Record<string, boolean>; pandoc版本: string | null }>(CH.exportFormats),
    run: (request) =>
      invoke<{ filePath: string | null; error: string | null }>(CH.exportDoc, request)
  },
  print: () => invoke<{ success: boolean; error: string | null }>(CH.appPrint),
  fileAssoc: () =>
    invoke<{ current: string; isDefaultFlag: boolean; hasShellNew: boolean; 程序路径: string }>(
      CH.appFileAssoc
    ),
  openDefaultApps: () => invoke<void>(CH.appOpenDefaultApps),
  copyAsImage: (request: { source: string; docPath: string | null; widthPx?: number }) =>
    invoke<{ success: boolean; width: number; height: number; truncated: boolean; error: string | null }>(
      CH.editCopyAsImage,
      request
    ),
  draft: {
    save: (rawPath, content) => invoke<boolean>(CH.draftSave, rawPath, content),
    list: () => invoke<DraftInfo[]>(CH.draftList),
    read: (key) => invoke<string | null>(CH.draftRead, key),
    discard: (key) => invoke<void>(CH.draftDiscard, key),
    pending: () => invoke<DraftInfo[]>(CH.draftPending),
    clearFor: (rawPath, content) => invoke<void>(CH.draftClearFor, rawPath, content)
  },

  recent: {
    list: () => invoke<RecentEntry[]>(CH.recentList),
    add: (path) => invoke<RecentEntry[]>(CH.recentAdd, path),
    pin: (path, pinned) => invoke<RecentEntry[]>(CH.recentPin, path, pinned),
    clear: (includePinned) => invoke<RecentEntry[]>(CH.recentClear, includePinned)
  },

  window: {
    minimize: () => invoke<void>(CH.windowMinimize),
    toggleMaximize: () => invoke<void>(CH.windowToggleMaximize),
    close: () => invoke<void>(CH.windowClose),
    closeForce: () => invoke<void>(CH.windowCloseForce),
    newWindow: (path) => invoke<void>(CH.windowNew, path),
    setAlwaysOnTop: (on) => invoke<boolean>(CH.windowSetAlwaysOnTop, on),
    setFullScreen: (on) => invoke<boolean>(CH.windowSetFullScreen, on),
    isFullScreen: () => invoke<boolean>(CH.windowIsFullScreen),
    setZoom: (factor) => invoke<number>(CH.windowSetZoom, factor),
    getZoom: () => invoke<number>(CH.windowGetZoom)
  },

  app: {
    quit: () => invoke<void>(CH.appQuit),
    getInfo: () => invoke<AppInfo>(CH.appGetInfo),
    getPaths: () => invoke<AppPaths>(CH.appGetPaths),
    openDevTools: () => invoke<void>(CH.appOpenDevTools),
    signalReady: (info) => invoke<void>(CH.appReady, info)
  },

  on: {
    menuCommand: (cb) => subscribe(EV.menuCommand, cb),
    settingsChanged: (cb) => subscribe(EV.settingsChanged, cb),
    themeChanged: (cb) => subscribe(EV.themeChanged, cb),
    fileChangedOnDisk: (cb) => subscribe(EV.fileChangedOnDisk, cb),
    openDocument: (cb) => subscribe(EV.openDocument, cb),
    requestClose: (cb) => subscribe(EV.requestClose, cb),
    taskProgress: (cb) => subscribe<TaskProgress>(EV.taskProgress, cb)
  },

  image: {
    readClipboard: () => invoke<ClipboardContent>(CH.imageReadClipboard),
    saveBytes: (dir, displayName, data) =>
      invoke<{ filePath: string } | null>(CH.imageSaveBytes, dir, displayName, data),
    download: (url, dir, displayName) => invoke<ImageDownloadResult>(CH.imageDownload, url, dir, displayName),
    import: (from, dir, displayName) =>
      invoke<{ filePath: string } | null>(CH.imageImport, from, dir, displayName),
    exists: (path) => invoke<boolean>(CH.fileExists, path),
    upload: (paths) =>
      invoke<{
        success: { rawPath: string; url: string }[]
        failure: { rawPath: string; reason: string }[]
      }>(CH.imageUpload, paths),
    uploaderStatus: () => invoke<{ available: boolean; reason: string | null }>(CH.imageUploaderStatus)
  }
}

/** 额外的辅助接口：用起来方便，但不属于正式文档化的接口。 */
const extras = {
  clipboard: {
    writeText: (text: string) => invoke<void>(CH.clipboardWriteText, text),
    writeHtml: (html: string, text: string) => invoke<void>(CH.clipboardWriteHtml, html, text),
    readText: () => invoke<string>(CH.clipboardReadText),
    readHtml: () => invoke<string>(CH.clipboardReadHtml)
  },
  recent: {
    addFolder: (path: string) => invoke<RecentEntry[]>(CH.recentAddFolder, path),
    remove: (path: string) => invoke<RecentEntry[]>(CH.recentRemove, path)
  },
  path: {
    dirname: (p: string) => invoke<string>(CH.pathDirname, p),
    basename: (p: string) => invoke<string>(CH.pathBasename, p),
    join: (...segment: string[]) => invoke<string>(CH.pathJoin, segment)
  },
  file: {
    copy: (from: string, to: string) => invoke<void>(CH.fileCopy, from, to),
    move: (from: string, to: string) => invoke<void>(CH.fileMove, from, to),
    rename: (from: string, to: string) => invoke<void>(CH.fileRename, from, to),
    walk: (root: string, options?: { limit?: number; depth?: number }) =>
      invoke<{
        file: { filePath: string; nameText: string; mtime: number; sizeBytes: number }[]
        truncated: boolean
      }>(CH.fileWalk, root, options)
  },
  task: {
    report: (payload: TaskProgress) => invoke<void>(CH.taskProgress, payload)
  },
  webUtils: {
    /**
     * 取拖放进来的 File 在磁盘上的绝对路径。
     *
     * 必须经由 preload 转一手：Electron 32 起 `File.path` 已移除，官方替代是
     * `webUtils.getPathForFile`，而渲染进程在 contextIsolation 下拿不到 electron
     * 模块。contextBridge 对这种"把 File 作为参数传进去"的用法有专门支持。
     */
    pathForFile: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('selfmd', api)
contextBridge.exposeInMainWorld('selfmdExtra', extras)
