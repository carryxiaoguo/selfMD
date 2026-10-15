import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 定位随应用分发的静态资源（图标等）。
 *
 * 两种形态下的位置完全不同，必须都覆盖，否则图标只会在其中一种形态下出现：
 *
 *   开发时：`__dirname` 是 `out/main`，资源在项目根的 `resources/`
 *   打包后：electron-builder 把 `resources/icon` 复制到 `process.resourcesPath/icon`
 *
 * 返回 `undefined` 而不是抛异常：图标缺失不该让应用起不来。
 */
export function 图标路径(名 = 'icon.png'): string | undefined {
  const 候选 = app.isPackaged
    ? [join(process.resourcesPath, 'icon', 名)]
    : [join(__dirname, '..', '..', 'resources', 'icon', 名)]
  return 候选.find((路径) => existsSync(路径))
}

/** 图标集目录，供"关于"面板或调试使用。 */
export function 图标目录(): string | undefined {
  const 文件 = 图标路径()
  return 文件 ? join(文件, '..') : undefined
}
