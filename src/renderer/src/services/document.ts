import type { OpenDocumentPayload } from '@shared/ipc'

/**
 * 文档生命周期。
 *
 * 掌管 main 进程无法知道的那一份状态：渲染进程正在编辑哪个文件，以及它的缓冲区
 * 是否与磁盘不一致。main 进程只会被告知那个布尔值（`doc.setDirty`），
 * 以便驱动标题栏和关闭确认流程。
 */

export interface DocState {
  path: string | null
  name: string
  dirty: boolean
  encoding: string
  lineEnding: 'lf' | 'crlf'
  /** 文档来自磁盘时置位，用于"保存还是另存为"的判断。 */
  existsOnDisk: boolean
}

type Listener = (state: DocState) => void

/** 未命名文档的默认标题。与 zh-Hans 语言包对 Untitled 的译法一致。 */
const UNTITLED = '未命名'

export class DocumentService {
  private state: DocState = {
    path: null,
    name: UNTITLED,
    dirty: false,
    encoding: 'utf8',
    lineEnding: 'lf',
    existsOnDisk: false
  }

  private listeners = new Set<Listener>()
  private untitledCounter = 0

  get current(): DocState {
    return { ...this.state }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.current)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    const snapshot = this.current
    for (const fn of this.listeners) fn(snapshot)
  }

  /** 重置为空缓冲区。返回编辑器应当显示的文本。 */
  newDocument(): string {
    this.untitledCounter += 1
    this.state = {
      path: null,
      name: this.untitledCounter > 1 ? `${UNTITLED} ${this.untitledCounter}` : UNTITLED,
      dirty: false,
      encoding: 'utf8',
      lineEnding: 'lf',
      existsOnDisk: false
    }
    void window.selfmd.doc.setDirty(false)
    this.emit()
    return ''
  }

  /** 从磁盘加载文档。文件无法读取时抛出异常。 */
  async open(path: string): Promise<string> {
    const payload: OpenDocumentPayload | null = await window.selfmd.doc.openPath(path)
    if (!payload) throw new Error(`Cannot open ${path}`)
    this.state = {
      path: payload.path,
      name: baseName(payload.path),
      dirty: false,
      encoding: payload.encoding,
      lineEnding: payload.crlf ? 'crlf' : 'lf',
      existsOnDisk: true
    }
    void window.selfmd.doc.setDirty(false)
    void window.selfmd.recent.add(payload.path)
    this.emit()
    return payload.content
  }

  /** 把缓冲区标记为已修改。开销足够小，可以在每次按键时调用。 */
  markDirty(): void {
    if (this.state.dirty) return
    this.state.dirty = true
    void window.selfmd.doc.setDirty(true)
    this.emit()
  }

  markClean(): void {
    if (!this.state.dirty) return
    this.state.dirty = false
    void window.selfmd.doc.setDirty(false)
    this.emit()
  }

  /**
   * 持久化 `content`。文档还没有路径时会转交给
   * `saveAs`，这正是用户在未命名缓冲区上按 Ctrl+S 时期望的行为。
   */
  async save(content: string): Promise<boolean> {
    if (!this.state.path) return this.saveAs(content)
    await window.selfmd.doc.save(this.state.path, content, this.state.lineEnding)
    this.state.existsOnDisk = true
    this.markClean()
    void window.selfmd.recent.add(this.state.path)
    this.emit()
    return true
  }

  async saveAs(content: string): Promise<boolean> {
    const suggested = this.state.path ?? `${this.state.name}.md`
    const result = await window.selfmd.dialog.saveFile({
      title: '另存为',
      defaultPath: suggested
    })
    if (result.canceled || !result.filePath) return false

    await window.selfmd.doc.save(result.filePath, content, this.state.lineEnding)
    this.state.path = result.filePath
    this.state.name = baseName(result.filePath)
    this.state.existsOnDisk = true
    this.markClean()
    void window.selfmd.recent.add(result.filePath)
    this.emit()
    return true
  }

  /** 在别处执行过"另存为"（例如重命名）之后采用新路径。 */
  adoptPath(path: string): void {
    this.state.path = path
    this.state.name = baseName(path)
    this.state.existsOnDisk = true
    this.emit()
  }

  /** 更新换行符偏好；下次保存时写出。 */
  setLineEnding(lineEnding: 'lf' | 'crlf'): void {
    if (this.state.lineEnding === lineEnding) return
    this.state.lineEnding = lineEnding
    this.state.dirty = true
    void window.selfmd.doc.setDirty(true)
    this.emit()
  }

  // ------------------------------------------------------- 多文档换入换出 ---

  /**
   * 导出当前状态的一份副本。
   *
   * 供标签管理器在切换文档时把"这一份"存回标签里。
   * 返回副本而不是引用：调用方拿到之后不该有能力改到内部状态。
   */
  exportStatus(): DocState {
    return { ...this.state }
  }

  /**
   * 整体采用另一份状态。
   *
   * 与 `adoptPath` 的区别：那个只换路径，这个把名字、脏标记、编码、
   * 换行符一起换掉——切换文档时这些都要跟着走，否则会出现
   * "切过去了但标题还写着上一个文件名""编码显示成上一个文档的"这类错位。
   */
  adoptStatus(state: DocState): void {
    this.state = { ...state }
    void window.selfmd.doc.setDirty(this.state.dirty)
    this.emit()
  }
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function dirName(path: string): string {
  const parts = path.split(/[\\/]/)
  parts.pop()
  return parts.join('/')
}
