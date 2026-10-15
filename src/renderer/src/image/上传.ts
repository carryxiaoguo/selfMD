import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { 独立撤销 } from '../editor/独立撤销'
import { 取文档目录, 是本地图片地址 } from './显示地址'
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

export interface 文档图片 {
  /** 文档里写的原始地址。 */
  地址: string
  /** 解析后的本地绝对路径；远程图片为 null。 */
  本地路径: string | null
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
function 取地址区间(节点: {
  firstChild: unknown
}): 地址区间 | null {
  // 结构：LinkMark(![) → 文字 → LinkMark(]) → LinkMark(() → URL → [LinkTitle] → LinkMark())
  let 子 = 节点.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null
  while (子) {
    if (子.name === 'URL') return { from: 子.from, to: 子.to }
    子 = 子.nextSibling as typeof 子
  }
  return null
}

/**
 * 收集文档里的全部图片。
 *
 * @param 只本地 为 true 时跳过远程地址——上传本地图时才用得上。
 */
export function 收集文档图片(状态: EditorState, 只本地 = false): 文档图片[] {
  const 结果: 文档图片[] = []
  const 目录 = 取文档目录()

  语法Tree遍历(状态, (节点) => {
    if (节点.name !== 'Image') return
    const 区间 = 取地址区间(节点)
    if (!区间) return

    const 地址 = 状态.sliceDoc(区间.from, 区间.to).trim()
    if (只本地 && !是本地图片地址(地址)) return

    let 路径 = 地址
    try {
      路径 = decodeURI(地址)
    } catch {
      // 编码损坏就按原样试
    }
    const 是绝对 = /^[a-zA-Z]:[\\/]/.test(路径) || 路径.startsWith('/')
    const 本地路径 =
      是本地图片地址(地址) && (是绝对 || 目录)
        ? 是绝对
          ? 路径
          : `${(目录 as string).replace(/\\/g, '/').replace(/\/+$/, '')}/${路径.replace(/^\.\//, '')}`
        : null

    结果.push({ 地址, 本地路径, from: 节点.from, to: 节点.to })
  })

  return 结果
}

/** 遍历语法树。抽出来只是为了让上面的逻辑读起来不被 iterate 的回调淹掉。 */
function 语法Tree遍历(
  状态: EditorState,
  回调: (节点: {
    name: string
    from: number
    to: number
    firstChild: unknown
  }) => void
): void {
  syntaxTree(状态).iterate({
    enter: (引用) => {
      回调(引用.node as unknown as {
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
  改写数: number
  /** 上传失败的数量。 */
  失败数: number
  /** 失败原因摘要，供提示使用。 */
  失败摘要: string
}

/**
 * 上传并回填。
 *
 * 全部改动汇入**一次** dispatch，于是 Ctrl+Z 能一次性撤回整批替换——
 * 逐张图各撤一次的话，用户传了十张图就要按十次撤销。
 */
export async function 上传并回填(
  视图: EditorView,
  图片们: 文档图片[]
): Promise<回填结果> {
  const 可传 = 图片们.filter((图) => 图.本地路径 !== null)
  if (可传.length === 0) {
    return { 改写数: 0, 失败数: 0, 失败摘要: '文档里没有本地图片，无需上传。' }
  }

  const 回应 = await window.selfmd.image.upload(可传.map((图) => 图.本地路径 as string))

  if (回应.成功.length === 0) {
    const 原因 = 回应.失败[0]?.原因 ?? '上传失败，且没有返回原因。'
    return { 改写数: 0, 失败数: 可传.length, 失败摘要: 原因 }
  }

  // 原路径 → 远程地址。用绝对路径做键，因为同一张图可能在文档里
  // 被引用多次（相对路径写法还可能不同），但磁盘上是同一个文件。
  const 映射 = new Map<string, string>()
  for (const 项 of 回应.成功) 映射.set(项.原路径.replace(/\\/g, '/'), 项.地址)

  const 改动: { from: number; to: number; insert: string }[] = []
  for (const 图 of 可传) {
    const 地址 = 映射.get((图.本地路径 as string).replace(/\\/g, '/'))
    if (!地址) continue
    // 只替换 URL 那一段，保留 `![替代文字](` 与 `)`。
    // 整段替换会丢掉替代文字——那是用户写的，不该被上传动作改掉。
    const 区间 = 取地址区间InDoc(视图.state, 图)
    if (!区间) continue
    改动.push({ from: 区间.from, to: 区间.to, insert: 转义图片地址(地址) })
  }

  if (改动.length === 0) {
    return { 改写数: 0, 失败数: 0, 失败摘要: '上传成功，但没有找到可替换的引用。' }
  }

  // 从后往前改：前面的区间不会因为后面的替换而位移。
  改动.sort((甲, 乙) => 乙.from - 甲.from)
  const 光标 = 视图.state.selection.main.head

  视图.dispatch({
    changes: 改动,
    // 光标位置按"它前面插入了多少字符"平移，否则大批替换后光标会跳回文首
    selection: EditorSelection.cursor(
      光标 + 改动.filter((改) => 改.from < 光标).reduce((和, 改) => 和 + (改.insert.length - (改.to - 改.from)), 0)
    ),
    annotations: 独立撤销,
    userEvent: 'input.uploadImage'
  })

  return {
    改写数: 改动.length,
    失败数: 回应.失败.length,
    失败摘要: 回应.失败.map((项) => 项.原因).join('；')
  }
}

/** 在文档里重新定位某张图片的 URL 区间。 */
function 取地址区间InDoc(状态: EditorState, 图: 文档图片): 地址区间 | null {
  let 结果: 地址区间 | null = null
  语法Tree遍历(状态, (节点) => {
    if (结果 || 节点.name !== 'Image') return
    if (节点.from !== 图.from) return
    结果 = 取地址区间(节点)
  })
  return 结果
}
