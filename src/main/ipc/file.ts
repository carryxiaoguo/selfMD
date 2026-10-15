import { BrowserWindow, dialog, ipcMain, shell, clipboard } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { promises as fsp } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  CH,
  type DirEntry,
  type FileStat,
  type MessageBoxRequest,
  type MessageBoxResult,
  type OpenFileDialogRequest,
  type OpenFileDialogResult,
  type OpenFolderDialogResult,
  type SaveDialogRequest,
  type SaveDialogResult,
  type WriteFileRequest,
  type WriteFileResult
} from '@shared/ipc'

/**
 * 文件系统、对话框与文档相关通道。
 *
 * 编码探测在这里（main 进程）完成，渲染进程只会接触到已解码的字符串。
 * 可识别的字节序标记有：UTF-8、UTF-16LE、UTF-16BE；其余一律当作 UTF-8 处理。
 */

// ---------------------------------------------------------------------------
// 编码
// ---------------------------------------------------------------------------

export type DetectedEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be'

export function detectEncoding(buf: Buffer): DetectedEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf8-bom'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be'
  return 'utf8'
}

export function decodeBuffer(buf: Buffer, encoding: DetectedEncoding): string {
  switch (encoding) {
    case 'utf8-bom':
      return buf.subarray(3).toString('utf8')
    case 'utf16le':
      return buf.subarray(2).toString('utf16le')
    case 'utf16be': {
      // Node 没有 utf16be 解码器：先交换成 LE 再解码。
      const body = Buffer.from(buf.subarray(2))
      body.swap16()
      return body.toString('utf16le')
    }
    default:
      return buf.toString('utf8')
  }
}

export function encodeText(text: string, encoding: DetectedEncoding): Buffer {
  switch (encoding) {
    case 'utf8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    case 'utf16be': {
      const body = Buffer.from(text, 'utf16le')
      body.swap16()
      return Buffer.concat([Buffer.from([0xfe, 0xff]), body])
    }
    default:
      return Buffer.from(text, 'utf8')
  }
}

function statOf(path: string): FileStat | null {
  try {
    const s = statSync(path)
    return {
      path,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      size: s.size,
      mtimeMs: s.mtimeMs
    }
  } catch {
    return null
  }
}

function normaliseLineEndings(text: string, mode: 'lf' | 'crlf' | 'preserve'): string {
  if (mode === 'preserve') return text
  const lf = text.replace(/\r\n/g, '\n')
  return mode === 'lf' ? lf : lf.replace(/\n/g, '\r\n')
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export function registerFileIpc(): void {
  ipcMain.handle(CH.fileRead, (_e, path: string) => {
    const buf = readFileSync(path)
    const encoding = detectEncoding(buf)
    const content = decodeBuffer(buf, encoding)
    const crlf = /\r\n/.test(content)
    return { content, encoding, crlf, stat: statOf(path) }
  })

  ipcMain.handle(CH.fileWrite, (_e, req: WriteFileRequest): WriteFileResult => {
    let text = req.content
    if (req.ensureFinalNewline !== false && text.length > 0 && !text.endsWith('\n')) {
      text += '\n'
    }
    text = normaliseLineEndings(text, req.lineEnding ?? 'preserve')

    const buf = encodeText(text, detectEncoding(existsSync(req.path) ? readFileSync(req.path) : Buffer.alloc(0)))
    const dir = dirname(req.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // 原子操作：先写到目标文件旁边，再改名覆盖过去。
    const tmp = join(dir, `.${basename(req.path)}.selfmd-tmp`)
    writeFileSync(tmp, buf)
    renameSync(tmp, req.path)

    return { path: req.path, bytes: buf.length }
  })

  ipcMain.handle(CH.fileStat, (_e, path: string) => statOf(path))
  ipcMain.handle(CH.fileExists, (_e, path: string) => existsSync(path))

  ipcMain.handle(CH.fileListDir, (_e, path: string): DirEntry[] => {
    const out: DirEntry[] = []
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(path, entry.name)
      let mtimeMs = 0
      try {
        mtimeMs = statSync(full).mtimeMs
      } catch {
        continue
      }
      out.push({ name: entry.name, path: full, isDirectory: entry.isDirectory(), mtimeMs })
    }
    // 目录排在前面，然后按不区分大小写、近似自然序的名称排序。
    out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    return out
  })

  ipcMain.handle(CH.fileMkdirp, (_e, path: string) => {
    mkdirSync(path, { recursive: true })
  })

  ipcMain.handle(CH.fileRename, (_e, from: string, to: string) => {
    renameSync(from, to)
  })

  ipcMain.handle(CH.fileMove, async (_e, from: string, to: string) => {
    await fsp.rename(from, to)
  })

  ipcMain.handle(CH.fileCopy, async (_e, from: string, to: string) => {
    await fsp.copyFile(from, to)
  })

  ipcMain.handle(CH.fileTrash, async (_e, path: string) => {
    // 优先使用系统回收站，这样误删还能找回来——删除图片文件时
    // 也是同样的选择（shell.trashItem）。
    await shell.trashItem(path)
  })

  ipcMain.handle(CH.fileShowInFolder, (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(CH.fileOpenExternal, async (_e, url: string) => {
    if (/^(https?|mailto):/.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle(CH.fileResolve, (_e, ...parts: string[]) => resolve(...parts))

  ipcMain.handle(CH.fileRelative, (_e, from: string, to: string) => {
    const rel = relative(isAbsolute(from) ? from : resolve(from), isAbsolute(to) ? to : resolve(to))
    return rel.split('\\').join('/')
  })

  // --- 剪贴板（供 Copy as Markdown / Paste as Plain Text 使用） ----------
  ipcMain.handle(CH.clipboardWriteText, (_e, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle(CH.clipboardWriteHtml, (_e, html: string, text: string) => {
    clipboard.write({ text, html })
  })
  ipcMain.handle(CH.clipboardReadText, () => clipboard.readText())
  ipcMain.handle(CH.clipboardReadHtml, () => clipboard.readHTML())
}

export function registerDialogIpc(): void {
  ipcMain.handle(CH.dialogOpenFile, async (e, req: OpenFileDialogRequest = {}): Promise<OpenFileDialogResult> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      title: req.title ?? '打开',
      defaultPath: req.defaultPath,
      filters: req.filters ?? [
        { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd', 'text', 'txt'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: (req.multi
        ? ['openFile', 'multiSelections']
        : ['openFile']) as Electron.OpenDialogOptions['properties']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle(CH.dialogOpenFolder, async (e, req: OpenFileDialogRequest = {}): Promise<OpenFolderDialogResult> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: req.title ?? '打开文件夹',
      defaultPath: req.defaultPath,
      buttonLabel: '选择',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return {
      canceled: result.canceled,
      folderPath: result.filePaths[0] ?? null
    }
  })

  ipcMain.handle(CH.dialogSaveFile, async (e, req: SaveDialogRequest = {}): Promise<SaveDialogResult> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.SaveDialogOptions = {
      title: req.title ?? '另存为',
      defaultPath: req.defaultPath,
      buttonLabel: '保存',
      filters: req.filters ?? [
        { name: 'Markdown 文件', extensions: ['md'] },
        { name: '纯文本文件', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return { canceled: result.canceled, filePath: result.filePath ?? null }
  })

  ipcMain.handle(CH.dialogMessage, async (e, req: MessageBoxRequest): Promise<MessageBoxResult> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.MessageBoxOptions = {
      type: req.type ?? 'none',
      title: req.title ?? 'selfMD',
      message: req.message,
      detail: req.detail,
      buttons: req.buttons ?? ['OK'],
      defaultId: req.defaultId ?? 0,
      cancelId: req.cancelId,
      checkboxLabel: req.checkboxLabel
    }
    const result = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return { response: result.response, checkboxChecked: result.checkboxChecked }
  })
}

export function registerDocIpc(): void {
  ipcMain.handle(CH.docOpenPath, async (_e, path: string) => {
    if (!existsSync(path)) return null
    const buf = readFileSync(path)
    const encoding = detectEncoding(buf)
    const content = decodeBuffer(buf, encoding)
    return {
      path,
      content,
      encoding,
      crlf: /\r\n/.test(content),
      stat: statOf(path)
    }
  })

  ipcMain.handle(CH.docSave, (_e, path: string, content: string, lineEnding: 'lf' | 'crlf') => {
    let text = content
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text = normaliseLineEndings(text, lineEnding)
    const encoding = detectEncoding(existsSync(path) ? readFileSync(path) : Buffer.alloc(0))
    const buf = encodeText(text, encoding)
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `.${basename(path)}.selfmd-tmp`)
    writeFileSync(tmp, buf)
    renameSync(tmp, path)
    return { path, bytes: buf.length }
  })
}
