import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { isolatedUndo } from '../editor/isolated-undo'
import { takeDocDir, 是本地图片地址 } from './display-src'
import { 转义图片地址 } from './reference'

/**
 * 上传本地图片并把文档里的引用换成远程地址。
 *
 * 回填是整个图床功能里最容易出错的环节：上传成功只是一半，
 * 把地址写回**正确的那一处**才是用户真正要的结果。写错位置不会报错，
 * 只会让文档里出现"这张图的地址指向那张图"——而且看起来像是上传器的问题。
 *
 * 所以回填走**位置替换**而不是字符串查找替换：从语法树里记下每个 Image
 * 节点的精确区间，上传后按区间从后往前改。字符串替换会在
 * "同一张图被引用两次""地址是另一张图地址的子串"这些情况下出错。
 */

export interface docImages {
  /** 文档里写的原始地址。 */
  url: string
  /** 解析后的本地绝对路径；远程图片为 null。 */
  localPath: string | null
  /** 在文档中的区间（含 `![` 与 `)`）。 */
  from: number
  to: number
}

/** 图片在文档中的地址区间（只覆盖 `(...)` 里的部分）。 */
interface 地址区间 {
  from: number
  to: number
}

/** 从 Image 节点里取出 URL 的精确区间。 */
function 取地址区间(node: {
  firstChild: unknown
}): 地址区间 | null {
  // 结构：LinkMark(![) → 文字 → LinkMark(]) → LinkMark(() → URL → [LinkTitle] → LinkMark())
  let child = node.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null
  while (child) {
    if (child.name === 'URL') return { from: child.from, to: child.to }
    child = child.nextSibling as typeof child
  }
  return null
}

/**
 * 收集文档里的全部图片。
 *
 * @param 只本地 为 true 时跳过远程地址——上传本地图时才用得上。
 */
export function 收集文档图片(state: EditorState, 只本地 = false): docImages[] {
  const result: docImages[] = []
  const dir = takeDocDir()

  语法Tree遍历(state, (node) => {
    if (node.name !== 'Image') return
    const range = 取地址区间(node)
    if (!range) return

    const url = state.sliceDoc(range.from, range.to).trim()
    if (只本地 && !是本地图片地址(url)) return

    let filePath = url
    try {
      filePath = decodeURI(url)
    } catch {
      // 编码损坏就按原样试
    }
    const 是绝对 = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')
    const localPath =
      是本地图片地址(url) && (是绝对 || dir)
        ? 是绝对
          ? filePath
          : `${(dir as string).replace(/\\/g, '/').replace(/\/+$/, '')}/${filePath.replace(/^\.\//, '')}`
        : null

    result.push({ url, localPath, from: node.from, to: node.to })
  })

  return result
}

/** 遍历语法树。抽出来只是为了让上面的逻辑读起来不被 iterate 的回调淹掉。 */
function 语法Tree遍历(
  state: EditorState,
  callback: (node: {
    name: string
    from: number
    to: number
    firstChild: unknown
  }) => void
): void {
  syntaxTree(state).iterate({
    enter: (quote) => {
      callback(quote.node as unknown as {
        name: string
        from: number
        to: number
        firstChild: unknown
      })
      return true
    }
  })
}

export interface 回填结果 {
  /** 实际改写的引用数量。 */
  changedCount: number
  /** 上传失败的数量。 */
  failCount: number
  /** 失败原因摘要，供提示使用。 */
  failureSummary: string
}

/**
 * 上传并回填。
 *
 * 全部改动汇入**一次** dispatch，于是 Ctrl+Z 能一次性撤回整批替换——
 * 逐张图各撤一次的话，用户传了十张图就要按十次撤销。
 */
export async function 上传并回填(
  view: EditorView,
  images: docImages[]
): Promise<回填结果> {
  const uploadable = images.filter((img) => img.localPath !== null)
  if (uploadable.length === 0) {
    return { changedCount: 0, failCount: 0, failureSummary: '文档里没有本地图片，无需上传。' }
  }

  const reply = await window.selfmd.image.upload(uploadable.map((img) => img.localPath as string))

  if (reply.success.length === 0) {
    const reason = reply.failure[0]?.reason ?? '上传失败，且没有返回原因。'
    return { changedCount: 0, failCount: uploadable.length, failureSummary: reason }
  }

  // 原路径 → 远程地址。用绝对路径做键，因为同一张图可能在文档里
  // 被引用多次（相对路径写法还可能不同），但磁盘上是同一个文件。
  const map = new Map<string, string>()
  for (const item of reply.success) map.set(item.rawPath.replace(/\\/g, '/'), item.url)

  const diffCount: { from: number; to: number; insert: string }[] = []
  for (const img of uploadable) {
    const url = map.get((img.localPath as string).replace(/\\/g, '/'))
    if (!url) continue
    // 只替换 URL 那一段，保留 `![替代文字](` 与 `)`。
    // 整段替换会丢掉替代文字——那是用户写的，不该被上传动作改掉。
    const range = 取地址区间InDoc(view.state, img)
    if (!range) continue
    diffCount.push({ from: range.from, to: range.to, insert: 转义图片地址(url) })
  }

  if (diffCount.length === 0) {
    return { changedCount: 0, failCount: 0, failureSummary: '上传成功，但没有找到可替换的引用。' }
  }

  // 从后往前改：前面的区间不会因为后面的替换而位移。
  diffCount.sort((alpha, beta) => beta.from - alpha.from)
  const cursor = view.state.selection.main.head

  view.dispatch({
    changes: diffCount,
    // 光标位置按"它前面插入了多少字符"平移，否则大批替换后光标会跳回文首
    selection: EditorSelection.cursor(
      cursor + diffCount.filter((amend) => amend.from < cursor).reduce((和, amend) => 和 + (amend.insert.length - (amend.to - amend.from)), 0)
    ),
    annotations: isolatedUndo,
    userEvent: 'input.uploadImage'
  })

  return {
    changedCount: diffCount.length,
    failCount: reply.failure.length,
    failureSummary: reply.failure.map((item) => item.reason).join('；')
  }
}

/** 在文档里重新定位某张图片的 URL 区间。 */
function 取地址区间InDoc(state: EditorState, img: docImages): 地址区间 | null {
  let result: 地址区间 | null = null
  语法Tree遍历(state, (node) => {
    if (result || node.name !== 'Image') return
    if (node.from !== img.from) return
    result = 取地址区间(node)
  })
  return result
}
