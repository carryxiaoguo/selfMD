import type { EditorState } from '@codemirror/state'
import { 取文档目录, 解析图片地址 } from '../../image/显示地址'
import { 块级行样式, 隐藏, 行内样式, 替换为 } from './decorations'
import { 加行装饰 } from './types'
import { image } from './widgets'
import type { 构建上下文, SyntaxNode } from './types'

/**
 * 行内装饰。
 *
 * 规则很简单：**包裹型标记折叠掉，内容加上样式类**。
 * 例如 `**加粗**` 里的两个 `**` 是 EmphasisMark（父节点 StrongEmphasis），
 * 折叠后屏幕上只剩"加粗"两个字，但文档里那两个星号一个都没少。
 *
 * 光标所在行例外：标记保持可见，这样正在编辑的那一行永远是纯 Markdown。
 */

/** 需要检查父节点才能确定含义的标记。 */
function 是否行内标记(node: SyntaxNode): boolean {
  const parent = node.parent?.name
  switch (node.name) {
    case 'EmphasisMark':
      // 同时用于 Emphasis 与 StrongEmphasis，父节点不同但处理一致。
      return true
    case 'StrikethroughMark':
      return true
    case 'HeaderMark':
      // 标题的 # 已在块级处理（需要配合行装饰），这里不重复处理。
      return false
    case 'CodeMark':
      // CodeMark 同时用于行内代码与围栏代码块，只有前者在这里处理。
      return parent === 'InlineCode'
    case 'LinkMark':
      return true
    default:
      return false
  }
}

export function 处理行内(
  node: SyntaxNode,
  state: EditorState,
  context: 构建上下文
): boolean {
  const lineNo = state.doc.lineAt(node.from).number
  const 在活动行 = context.活动行.has(lineNo)

  if (是否行内标记(node)) {
    if (!在活动行) {
      context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
    }
    return true
  }

  switch (node.name) {
    case 'Emphasis':
      context.entry.push({
        from: node.from,
        to: node.to,
        deco: 行内样式.强调,
        rank: 0
      })
      return true

    case 'StrongEmphasis':
      context.entry.push({ from: node.from, to: node.to, deco: 行内样式.加粗, rank: 0 })
      return true

    case 'Strikethrough':
      context.entry.push({ from: node.from, to: node.to, deco: 行内样式.删除线, rank: 0 })
      return true

    case 'InlineCode':
      context.entry.push({ from: node.from, to: node.to, deco: 行内样式.行内代码, rank: 0 })
      return true

    case 'Link':
      context.entry.push({ from: node.from, to: node.to, deco: 行内样式.链接文字, rank: 0 })
      return true

    case 'URL': {
      // 行内链接的目标地址：非活动行折叠，只留链接文字。
      // 但要避开引用定义的 URL——那里是内容本身，不能藏。
      const 父名 = node.parent?.name
      if (父名 === 'Link' && !在活动行) {
        context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
      } else if (父名 === 'LinkReference') {
        context.entry.push({ from: node.from, to: node.to, deco: 行内样式.链接地址, rank: 0 })
      }
      return true
    }

    case 'LinkTitle': {
      if (node.parent?.name === 'Link' && !在活动行) {
        context.entry.push({ from: node.from, to: node.to, deco: 隐藏, rank: 1 })
      }
      return true
    }

    case 'LinkReference': {
      // 引用定义整行（`[名]: 地址 "标题"`）淡化，不隐藏：用户需要看见它。
      context.entry.push({ from: node.from, to: node.to, deco: 行内样式.引用定义, rank: 0 })
      return true
    }

    // ------------------------------------------------------------ 图片 --
    case 'Image': {
      const cursor = state.selection.main
      // **只在光标落进这段语法内部时**才显示源码。
      //
      // 不像别的行内标记那样按"整行"判断：图片通常独占一行，若按行判断，
      // 光标停在段落里任何位置都会让图片变回 `![…](…)`，等于图片一直在闪。
      const 光标在里面 = cursor.from >= node.from && cursor.to <= node.to
      if (光标在里面) return true

      const { url, 替代 } = 取图片信息(node, state)
      const 显示 = 解析图片地址(url)

      // 图片独占一行时加个行装饰：CSS 据此把它居中并按块显示，
      // 而夹在句子中间的图片仍按行内处理。
      const parent = node.parent
      if (parent && parent.name === 'Paragraph') {
        const paragraph = state.sliceDoc(parent.from, parent.to).trim()
        const 自身 = state.sliceDoc(node.from, node.to).trim()
        if (paragraph === 自身) {
          加行装饰(context, state.doc.lineAt(node.from).from, 块级行样式.图片行)
        }
      }

      context.entry.push({
        from: node.from,
        to: node.to,
        deco: 替换为(new image(显示, url, 替代, 本地绝对路径(url))),
        rank: 1
      })
      return true
    }

    default:
      return false
  }
}

/**
 * 取图片的地址与替代文字。
 *
 * 必须**填空式**遍历：替代文字位于两个 LinkMark 之间的空隙里，
 * 只读子节点会一个字都拿不到。`![甲](x)` 的子节点是
 * `LinkMark(![)`、`LinkMark(])`、`LinkMark(()`、`URL`、`LinkMark())`——
 * "甲"根本不在其中。
 */
function 取图片信息(node: SyntaxNode, state: EditorState): { url: string; 替代: string } {
  let url = ''
  let 替代 = ''
  let 收集替代 = false
  let 游标 = node.from

  for (let child = node.firstChild; child; child = child.nextSibling) {
    const 间隙 = state.sliceDoc(游标, child.from)
    if (收集替代 && 间隙) 替代 += 间隙

    const txt = state.sliceDoc(child.from, child.to)
    if (child.name === 'LinkMark') {
      if (txt === '![') 收集替代 = true
      else if (txt === ']') 收集替代 = false
      // `](` 与收尾的 `)` 不改变状态
    } else if (child.name === 'URL') {
      url = txt
    } else if (child.name === 'LinkTitle') {
      // 标题属于目标而不属于替代文字，跳过
    } else if (收集替代) {
      替代 += txt
    }

    游标 = child.to
  }

  return { url, 替代: 替代.trim() }
}

/** 本地图片在磁盘上的绝对路径；远程或无法解析时为 null。 */
function 本地绝对路径(url: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(url.trim())) return null
  const dir = 取文档目录()
  let filePath = url.trim()
  try {
    filePath = decodeURI(filePath)
  } catch {
    // 编码损坏就按原样试
  }
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')) return filePath
  if (!dir) return null
  return `${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/${filePath.replace(/^\.\//, '')}`
}
