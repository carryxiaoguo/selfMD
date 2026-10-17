import type { uploaderType } from './types'

/**
 * 上传结果解析。
 *
 * 这是整个图床功能里**唯一可以做成纯函数的部分**，也是唯一容易写错的部分——
 * 各种 CLI 的输出格式互不统一：有的直接打印 URL，有的前面带一堆日志，
 * 有的打印相对路径。从 通行的 `M(stdout, uploader)`  提取到的
 * 策略是这样的：
 *
 *   1. PicGo / PicList 的 app 模式：输出是 JSON，直接 `JSON.parse`
 *   2. 其余：**从最后一行往前扫**
 *      - 匹配 `^(https?|ftp|file)://` → 原样收下
 *      - 匹配裸域名 + 路径（`img.example.com/a.png`）→ 补上 `http://`
 *      - **一旦已经收到 URL 又遇到非 URL 行就立刻停止**（那之前的是日志头）
 *
 * 第 3 条是关键：不设这个停止条件，日志里出现的任何网址都会被当成结果，
 * 于是"上传 1 张图返回 3 个 URL"，回填时张冠李戴。
 *
 * 做成纯函数以后，"从后往前扫"和"遇非 URL 即停"这两条都能逐条断言，
 * 不必真的装一个 PicGo 才能验证。
 */

/** 带协议的地址。 */
const hasProtocol = /^(?:https?|ftp|file):\/\//i

/**
 * 裸域名 + 路径，例如 `img.example.com/2024/a.png`。
 *
 * 要求至少有一个点分段，且**必须带路径斜杠**——不带斜杠的裸域名太容易与
 * 普通名词混淆（`readme.md` 就会被误判成域名），会引入误报。
 */
const bareDomain = /^[a-z0-9]+(?:[-.][a-z0-9]+)*\.[a-z]{2,5}\/.+$/i

/** 判断一行是不是图片地址；是则返回规范化后的地址。 */
export function detectUrlLine(line: string): string | null {
  const docText = line.trim()
  if (docText.length === 0) return null
  if (hasProtocol.test(docText)) return docText
  if (bareDomain.test(docText)) return `http://${docText}`
  return null
}

/**
 * 从 CLI 输出里解析出图片地址。
 *
 * 从最后一行往前扫，收到地址就继续，遇到非地址行就停——因为日志头在输出上方，
 * 结果在下方。
 */
export function parseCliOutput(output: string): string[] {
  const lines = output.split(/\r?\n/)
  const result: string[] = []

  for (let i = lines.length - 1; i >= 0; i--) {
    const url = detectUrlLine(lines[i] ?? '')
    if (url) {
      result.unshift(url) // 从后往前扫，所以往前插，最终保持原有顺序
      continue
    }
    // 已经收到地址又遇到非地址行 → 上面是日志，停止。
    // 还没收到地址时遇到空行要跳过（输出末尾常有空行），
    // 但遇到有内容的非地址行也要停——否则会把整个日志扫完，
    // 反而把日志里提到的老网址收进来。
    if (result.length > 0) break
    if ((lines[i] ?? '').trim().length > 0) break
  }

  return result
}

export interface uploadResponse {
  success?: boolean
  result?: string[] | string
  msg?: string
  message?: string
}

/** 把 PicGo 的 JSON 应答转成地址数组。 */
function parseJsonResponse(docText: string): string[] | null {
  try {
    const data = JSON.parse(docText) as uploadResponse
    if (data.success === false) return []
    const original = data.result
    if (Array.isArray(original)) return original.filter((item) => typeof item === 'string')
    if (typeof original === 'string' && original.length > 0) return [original]
    return []
  } catch {
    // 不是 JSON —— 有些版本会打印日志再吐 JSON，交给命令行解析兜底
    return null
  }
}

/**
 * 解析上传结果。
 *
 * @param 输出 子进程 stdout 或 HTTP 响应体
 * @param 上传器 用的哪种上传器（决定要不要先按 JSON 解）
 * @param 期望数量 本次上传了几张图；用于校验是否一一对应
 */
export function parseUploadResult(
  output: string,
  uploader: uploaderType,
  expectedCount: number
): { url: string[]; error: string | null } {
  const useJson = uploader === 'picgo-app' || uploader === 'piclist-app'

  let url: string[] = []
  if (useJson) {
    const jsonResult = parseJsonResponse(output)
    if (jsonResult !== null) url = jsonResult
    else url = parseCliOutput(output)
  } else {
    url = parseCliOutput(output)
  }

  // 数量对不上就不能用：宁可报错也不要让用户拿着错位的地址去回填，
  // 那会把 A 图的地址写到 B 图上，而且看起来"上传成功了"。
  if (url.length !== expectedCount) {
    return {
      url,
      error:
        `上传返回了 ${url.length} 个地址，但本次上传了 ${expectedCount} 张图片。` +
        `原始输出：${output.trim().slice(0, 300) || '（空）'}`
    }
  }

  return { url, error: null }
}

/**
 * 按上传器类型生成命令行。
 *
 * 命令表照抄 提取的 `getImageUploaderCommand` 。
 * 返回 null 表示这种上传器不走命令行（app 模式），或用户还没配置。
 *
 * **平台作为参数传入**而不是读 `process.platform`：这个模块在渲染层也会被
 * 引用，而渲染层没有 `process`。改成参数还有个附带好处——可以在自测里
 * 断言三个平台的命令形态，不必真的换系统。
 */
export function buildUploadCmd(
  uploader: uploaderType,
  filePathValue: string,
  config: {
    customCommand: string
    userDataDir: string
    platform: 'win32' | 'darwin' | 'linux'
  }
): string | null {
  const name = filePathValue.split(/[\\/]/).pop() ?? filePathValue
  // 命令里一律用正斜杠：反斜杠在 shell 里是转义符，
  // `C:\我的文档\a.png` 会被拆得面目全非。
  const filePath = filePathValue.replace(/\\/g, '/')

  switch (uploader) {
    case 'upic':
      // macOS 专用；本项目目标平台是 Windows，保留以防将来移植
      return `/Applications/uPic.app/Contents/MacOS/uPic -o url -u ${quoteChar(filePath)}`
    case 'picsee':
      return `/Applications/Picsee.app/Contents/MacOS/Picsee -u ${quoteChar(filePath)}`
    case 'picgo-cli': {
      // Windows 下必须先切到 UTF-8 代码页，否则 PicGo 输出的中文路径会乱码
      const prefixText = config.platform === 'win32' ? 'chcp 65001>nul && ' : ''
      const subDir =
        config.platform === 'win32' ? 'win64' : config.platform === 'darwin' ? 'mac' : 'linux'
      const extension = config.platform === 'win32' ? '.exe' : ''
      const program = `${config.userDataDir}/picgo/${subDir}/picgo${extension}`
      return `${prefixText}${quoteChar(program)} u ${quoteChar(filePath)}`
    }
    case 'custom': {
      const template = config.customCommand.trim()
      if (template.length === 0) return null
      // 占位符按 的规格：`${filepath}` 与 `${filename}`。
      // 文件名单独给一份，许多图床脚本只吃文件名。
      //
      // 替换时**按需加引号**：含空格的路径（`C:/我的 图.png`）不加引号会被
      // shell 拆成两个参数，上传器只拿到前一半，报"文件不存在"。
      // 但也不能无条件加——用户模板里可能已经写了 `"${filepath}"`，
      // 再加一层就变成 `""C:/a.png""`。
      return template
        .replace(/\$\{filepath\}/g, quoteWhenNeeded(filePath))
        .replace(/\$\{filename\}/g, quoteWhenNeeded(name))
    }
    default:
      return null
  }
}

/**
 * 给路径加引号。
 *
 * 不加引号时含空格的路径（`C:/我的 文档/a.png`）会被 shell 拆成两个参数，
 * 上传器只会拿到前一半，报"文件不存在"。
 */
export function quoteChar(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`
}

/**
 * 只在必要时加引号。
 *
 * 用于用户自定义命令的占位符替换：值里有空白才需要包起来，
 * 而模板里已经写了引号的情况不能再包一层。
 */
export function quoteWhenNeeded(value: string): string {
  const docText = value.trim()
  if (docText.length === 0) return value
  // 模板里已经带了引号
  if (/^".*"$/.test(docText) || /^'.*'$/.test(docText)) return value
  return /\s/.test(value) ? quoteChar(value) : value
}
