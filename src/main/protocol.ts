import { net, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PROTOCOL_SCHEME, decodeLocalToken } from '@shared/url'
import { 主题目录文件 } from './services/themes'

/**
 * 注册 `selfmd://` scheme。
 *
 * 必须在 `app.whenReady()` 之前调用：Electron 只在 ready 之前的阶段
 * 才会处理 `registerSchemesAsPrivileged`。
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
}

function serveFile(path: string): Promise<Response> | Response {
  if (!existsSync(path)) return notFound()
  // 对 file:// URL 调用 net.fetch 会替我们处理流式传输、range 请求和 MIME
  // 探测，这在涉及图片与视频时很重要。
  return net.fetch(pathToFileURL(path).toString())
}

export function registerProtocolHandlers(): void {
  protocol.handle(PROTOCOL_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return notFound()
    }

    switch (url.hostname) {
      case 'theme': {
        // 服务主题目录下的**任意文件**，而不只是 `<主题名>.css`。
        //
        // 主题旁边的同名资源目录里放着字体、图片、光标，深色子样式表也用相对
        // `@import` 引入。只服务 .css 本身会让这些引用
        // 全部 404，症状是"主题加载了但字体不对"。
        const path = 主题目录文件(url.pathname.replace(/^\//, ''))
        if (!path) return notFound()
        return serveFile(path)
      }

      case 'local': {
        const token = url.pathname.replace(/^\//, '')
        const abs = decodeLocalToken(token)
        if (!abs) return notFound()
        return serveFile(abs)
      }

      default:
        return notFound()
    }
  })
}
