import type { EditorState } from '@codemirror/state'
import { 取文档目录, 解析图片地址 } from '../../image/显示地址'
import { 块级行样式, 隐藏, 行内样式, 替换为 } from './decorations'
import { 加行装饰 } from './types'
import { 图片 } from './widgets'
import type { 构建上下文, 语法节点 } from './types'

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
function 是否行内标记(节点: 语法节点): boolean {
  const 父 = 节点.parent?.name
  switch (节点.name) {
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
      return 父 === 'InlineCode'
    case 'LinkMark':
      return true
    default:
      return false
  }
}

export function 处理行内(
  节点: 语法节点,
  状态: EditorState,
  上下文: 构建上下文
): boolean {
  const 行号 = 状态.doc.lineAt(节点.from).number
  const 在活动行 = 上下文.活动行.has(行号)

  if (是否行内标记(节点)) {
    if (!在活动行) {
      上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
    }
    return true
  }

  switch (节点.name) {
    case 'Emphasis':
      上下文.条目.push({
        from: 节点.from,
        to: 节点.to,
        deco: 行内样式.强调,
        rank: 0
      })
      return true

    case 'StrongEmphasis':
      上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 行内样式.加粗, rank: 0 })
      return true

    case 'Strikethrough':
      上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 行内样式.删除线, rank: 0 })
      return true

    case 'InlineCode':
      上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 行内样式.行内代码, rank: 0 })
      return true

    case 'Link':
      上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 行内样式.链接文字, rank: 0 })
      return true

    case 'URL': {
      // 行内链接的目标地址：非活动行折叠，只留链接文字。
      // 但要避开引用定义的 URL——那里是内容本身，不能藏。
      const 父名 = 节点.parent?.name
      if (父名 === 'Link' && !在活动行) {
        上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
      } else if (父名 === 'LinkReference') {
        上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 行内样式.链接地址, rank: 0 })
      }
      return true
    }

    case 'LinkTitle': {
      if (节点.parent?.name === 'Link' && !在活动行) {
        上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 隐藏, rank: 1 })
      }
      return true
    }

    case 'LinkReference': {
      // 引用定义整行（`[名]: 地址 "标题"`）淡化，不隐藏：用户需要看见它。
      上下文.条目.push({ from: 节点.from, to: 节点.to, deco: 行内样式.引用定义, rank: 0 })
      return true
    }

    // ------------------------------------------------------------ 图片 --
    case 'Image': {
      const 光标 = 状态.selection.main
      // **只在光标落进这段语法内部时**才显示源码。
      //
      // 不像别的行内标记那样按"整行"判断：图片通常独占一行，若按行判断，
      // 光标停在段落里任何位置都会让图片变回 `![…](…)`，等于图片一直在闪。
      const 光标在里面 = 光标.from >= 节点.from && 光标.to <= 节点.to
      if (光标在里面) return true

      const { 地址, 替代 } = 取图片信息(节点, 状态)
      const 显示 = 解析图片地址(地址)

      // 图片独占一行时加个行装饰：CSS 据此把它居中并按块显示，
      // 而夹在句子中间的图片仍按行内处理。
      const 父 = 节点.parent
      if (父 && 父.name === 'Paragraph') {
        const 段落 = 状态.sliceDoc(父.from, 父.to).trim()
        const 自身 = 状态.sliceDoc(节点.from, 节点.to).trim()
        if (段落 === 自身) {
          加行装饰(上下文, 状态.doc.lineAt(节点.from).from, 块级行样式.图片行)
        }
      }

      上下文.条目.push({
        from: 节点.from,
        to: 节点.to,
        deco: 替换为(new 图片(显示, 地址, 替代, 本地绝对路径(地址))),
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
function 取图片信息(节点: 语法节点, 状态: EditorState): { 地址: string; 替代: string } {
  let 地址 = ''
  let 替代 = ''
  let 收集替代 = false
  let 游标 = 节点.from

  for (let 子 = 节点.firstChild; 子; 子 = 子.nextSibling) {
    const 间隙 = 状态.sliceDoc(游标, 子.from)
    if (收集替代 && 间隙) 替代 += 间隙

    const 文 = 状态.sliceDoc(子.from, 子.to)
    if (子.name === 'LinkMark') {
      if (文 === '![') 收集替代 = true
      else if (文 === ']') 收集替代 = false
      // `](` 与收尾的 `)` 不改变状态
    } else if (子.name === 'URL') {
      地址 = 文
    } else if (子.name === 'LinkTitle') {
      // 标题属于目标而不属于替代文字，跳过
    } else if (收集替代) {
      替代 += 文
    }

    游标 = 子.to
  }

  return { 地址, 替代: 替代.trim() }
}

/** 本地图片在磁盘上的绝对路径；远程或无法解析时为 null。 */
function 本地绝对路径(地址: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(地址.trim())) return null
  const 目录 = 取文档目录()
  let 路径 = 地址.trim()
  try {
    路径 = decodeURI(路径)
  } catch {
    // 编码损坏就按原样试
  }
  if (/^[a-zA-Z]:[\\/]/.test(路径) || 路径.startsWith('/')) return 路径
  if (!目录) return null
  return `${目录.replace(/\\/g, '/').replace(/\/+$/, '')}/${路径.replace(/^\.\//, '')}`
}
