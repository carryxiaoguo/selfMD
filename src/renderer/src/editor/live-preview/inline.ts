import type { EditorState } from '@codemirror/state'
import { takeDocDir, parseImageUrl } from '../../image/display-src'
import { blockLineStyles, hidden, inlineStyles, replaceWith } from './decorations'
import { addLineDeco } from './types'
import { image } from './widgets'
import type { BuildContext, SyntaxNode } from './types'

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
  context: BuildContext
): boolean {
  const lineNo = state.doc.lineAt(node.from).number
  const onActiveLine = context.activeLines.has(lineNo)

  if (是否行内标记(node)) {
    if (!onActiveLine) {
      context.entry.push({ from: node.from, to: node.to, deco: hidden, rank: 1 })
    }
    return true
  }

  switch (node.name) {
    case 'Emphasis':
      context.entry.push({
        from: node.from,
        to: node.to,
        deco: inlineStyles.强调,
        rank: 0
      })
      return true

    case 'StrongEmphasis':
      context.entry.push({ from: node.from, to: node.to, deco: inlineStyles.加粗, rank: 0 })
      return true

    case 'Strikethrough':
      context.entry.push({ from: node.from, to: node.to, deco: inlineStyles.删除线, rank: 0 })
      return true

    case 'InlineCode':
      context.entry.push({ from: node.from, to: node.to, deco: inlineStyles.行内代码, rank: 0 })
      return true

    case 'Link':
      context.entry.push({ from: node.from, to: node.to, deco: inlineStyles.链接文字, rank: 0 })
      return true

    case 'URL': {
      // 行内链接的目标地址：非活动行折叠，只留链接文字。
      // 但要避开引用定义的 URL——那里是内容本身，不能藏。
      const parentName = node.parent?.name
      if (parentName === 'Link' && !onActiveLine) {
        context.entry.push({ from: node.from, to: node.to, deco: hidden, rank: 1 })
      } else if (parentName === 'LinkReference') {
        context.entry.push({ from: node.from, to: node.to, deco: inlineStyles.链接地址, rank: 0 })
      }
      return true
    }

    case 'LinkTitle': {
      if (node.parent?.name === 'Link' && !onActiveLine) {
        context.entry.push({ from: node.from, to: node.to, deco: hidden, rank: 1 })
      }
      return true
    }

    case 'LinkReference': {
      // 引用定义整行（`[名]: 地址 "标题"`）淡化，不隐藏：用户需要看见它。
      context.entry.push({ from: node.from, to: node.to, deco: inlineStyles.引用定义, rank: 0 })
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

      const { url, substitute } = 取图片信息(node, state)
      const show = parseImageUrl(url)

      // 图片独占一行时加个行装饰：CSS 据此把它居中并按块显示，
      // 而夹在句子中间的图片仍按行内处理。
      const parent = node.parent
      if (parent && parent.name === 'Paragraph') {
        const paragraph = state.sliceDoc(parent.from, parent.to).trim()
        const 自身 = state.sliceDoc(node.from, node.to).trim()
        if (paragraph === 自身) {
          addLineDeco(context, state.doc.lineAt(node.from).from, blockLineStyles.图片行)
        }
      }

      context.entry.push({
        from: node.from,
        to: node.to,
        deco: replaceWith(new image(show, url, substitute, 本地绝对路径(url))),
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
function 取图片信息(node: SyntaxNode, state: EditorState): { url: string; substitute: string } {
  let url = ''
  let substitute = ''
  let collectAlt = false
  let cursor = node.from

  for (let child = node.firstChild; child; child = child.nextSibling) {
    const gapPx = state.sliceDoc(cursor, child.from)
    if (collectAlt && gapPx) substitute += gapPx

    const txt = state.sliceDoc(child.from, child.to)
    if (child.name === 'LinkMark') {
      if (txt === '![') collectAlt = true
      else if (txt === ']') collectAlt = false
      // `](` 与收尾的 `)` 不改变状态
    } else if (child.name === 'URL') {
      url = txt
    } else if (child.name === 'LinkTitle') {
      // 标题属于目标而不属于替代文字，跳过
    } else if (collectAlt) {
      substitute += txt
    }

    cursor = child.to
  }

  return { url, substitute: substitute.trim() }
}

/** 本地图片在磁盘上的绝对路径；远程或无法解析时为 null。 */
function 本地绝对路径(url: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(url.trim())) return null
  const dir = takeDocDir()
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
