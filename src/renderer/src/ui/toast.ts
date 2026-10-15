/** 临时通知。对应 通行的通知区域（右下角）。 */

const host = (): HTMLElement | null => document.getElementById('toast-host')

export function toast(message: string, kind: 'info' | 'error' = 'info', timeoutMs = 3200): void {
  const parent = host()
  if (!parent) return
  const el = document.createElement('div')
  el.className = kind === 'error' ? 'toast error' : 'toast'
  el.textContent = message
  parent.appendChild(el)
  window.setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity 160ms ease'
    window.setTimeout(() => el.remove(), 200)
  }, timeoutMs)
}

export function toastError(err: unknown, prefix = '错误'): void {
  const message = err instanceof Error ? err.message : String(err)
  toast(`${prefix}: ${message}`, 'error', 5200)
  console.error(prefix, err)
}
