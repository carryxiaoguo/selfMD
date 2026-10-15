import { registerAppIpc } from './app'
import { registerDialogIpc, registerDocIpc, registerFileIpc } from './file'
import { registerImageIpc } from './image'

let registered = false

/** 幂等地注册全部 IPC 处理器。 */
export function registerIpc(): void {
  if (registered) return
  registered = true
  registerFileIpc()
  registerDialogIpc()
  registerDocIpc()
  registerAppIpc()
  registerImageIpc()
}
