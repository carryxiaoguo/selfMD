/**
 * 围栏代码块的信息串：解析与构建。
 *
 * 信息串就是 ```` ```python 名称 style=dark ```` 里 `python` 之后的那一段。
 *
 * ## 为什么三个字段都存进文档
 *
 * 语言本来就属于文档（`python` 是围栏信息的一部分）。名称与样式也一并放进去，
 * 而不另开旁路存储，理由是**纯文本是唯一数据源**：
 *
 *   - 一旦把展示属性存到别处，文件离开本程序就丢了这些信息；
 *   - 拷贝一段代码到另一个文件，样式应当跟着走；
 *   - 版本控制里能看到"这个块的样式改了"，而不是看不到的隐式状态。
 *
 * 代价是信息串比标准 Markdown 长一点。多数渲染器会忽略不认识的 token，
 * 最坏情况是退化成"没有名称与样式的普通代码块"——可接受的降级。
 *
 * ## 语法
 *
 *     第一个 token       语言
 *     `键=值` 形式的 token   属性（目前只有 `style`）
 *     其余 token         名称，允许带空格
 *
 * 名称放在前面、属性放在后面，是为了让人肉读时"` ```python 排序算法 `"
 * 比"` ```python style=dark 排序算法 `" 更自然。
 */

/** 代码块配色样式。`follow` 表示跟随主题，也是默认值。 */
export type 代码块样式 = 'follow' | 'light' | 'dark'

/** 样式的显示名。改显示名不用动文档里的值。 */
export const 样式显示名: Record<代码块样式, string> = {
  follow: '跟随主题',
  light: '明亮',
  dark: '暗色'
}

/** 下拉里的顺序：默认项排第一。 */
export const 样式顺序: 代码块样式[] = ['follow', 'light', 'dark']

// ---------------------------------------------------------------------------
// 字体
// ---------------------------------------------------------------------------

/**
 * 内置的代码字体。
 *
 * 每一项是一个**字体族列表**而不是单个字体名：这些字体不一定都装在同一台
 * 机器上（`Cascadia Mono` 是 Win11 才自带的），列表让浏览器按顺序回退，
 * 装了什么就用什么，都不会退化成默认衬线体。
 *
 * 最后一位统一是 `monospace`，保证再差也有等宽兜底——代码用比例字体排版
 * 会让缩进完全失去意义。
 */
export interface 字体项 {
  值: string
  名: string
  族: string
}

export const 内置字体: 字体项[] = [
  { 值: 'follow', 名: '跟随主题', 族: '' },
  { 值: 'consolas', 名: 'Consolas', 族: 'Consolas, "Courier New", monospace' },
  {
    值: 'cascadia',
    名: 'Cascadia Mono',
    族: '"Cascadia Mono", "Cascadia Code", Consolas, monospace'
  },
  {
    值: 'jetbrains',
    名: 'JetBrains Mono',
    族: '"JetBrains Mono", "Sarasa Mono SC", Consolas, monospace'
  },
  { 值: 'fira', 名: 'Fira Code', 族: '"Fira Code", Consolas, monospace' },
  {
    值: 'sourcecode',
    名: 'Source Code Pro',
    族: '"Source Code Pro", Consolas, monospace'
  },
  {
    值: 'sarasa',
    名: '更纱黑体',
    族: '"Sarasa Mono SC", "Sarasa Term SC", "Sarasa Fixed SC", Consolas, monospace'
  },
  { 值: 'simsun', 名: '宋体', 族: 'SimSun, "Songti SC", "MS Song", monospace' },
  {
    值: 'yahei',
    名: '微软雅黑',
    族: '"Microsoft YaHei UI", "Microsoft YaHei", monospace'
  },
  { 值: 'courier', 名: 'Courier New', 族: '"Courier New", monospace' }
]

const 字体值表 = new Set(内置字体.map((项) => 项.值))

export interface 围栏信息 {
  语言: string
  名称: string
  样式: 代码块样式
  /** 内置字体的标识；`follow` 表示跟随主题。 */
  字体: string
}

/** 去掉首尾空白并合并内部连续空白——信息串里多余的空格没有意义。 */
function 规整(文本: string): string {
  return 文本.trim().replace(/\s+/g, ' ')
}

function 是样式名(值: string): 值 is 代码块样式 {
  return 值 === 'follow' || 值 === 'light' || 值 === 'dark'
}

/**
 * 解析信息串。
 *
 * 对残缺输入必须宽容：用户可能只打了 ```` ``` ````、也可能手滑打成
 * ```` ```python style= ````。渲染层任何一处抛异常，界面上都只表现为
 * "这个块没渲染出来"，很难反查。所以这里不抛，一律给合理默认值。
 */
export function 解析围栏信息(原始: string): 围栏信息 {
  const 片段 = 规整(原始).split(' ').filter(Boolean)
  const 语言 = 片段.shift() ?? ''

  const 名称片段: string[] = []
  let 样式: 代码块样式 = 'follow'
  let 字体 = 'follow'

  for (const 片 of 片段) {
    const 等号 = 片.indexOf('=')
    if (等号 > 0) {
      const 键 = 片.slice(0, 等号).toLowerCase()
      const 值 = 片.slice(等号 + 1)
      if (键 === 'style') {
        if (是样式名(值)) 样式 = 值
        // 认不出的样式值直接忽略，而不是把它当成名称的一部分——
        // 否则名称里会莫名其妙多出一截 `style=xxx`
        continue
      }
      if (键 === 'font') {
        if (字体值表.has(值)) 字体 = 值
        // 同上：认不出的字体标识不该混进名称里
        continue
      }
    }
    名称片段.push(片)
  }

  return { 语言, 名称: 名称片段.join(' '), 样式, 字体 }
}

/**
 * 构建信息串。
 *
 * `follow` 不写进文档：它是默认值，写上去只会让每一行围栏都变长，
 * 而且用户看不出"写了 follow"和"什么都没写"有什么区别。
 */
export function 构建围栏信息(信息: 围栏信息): string {
  const 片段: string[] = []
  if (信息.语言) 片段.push(信息.语言)
  if (信息.名称) 片段.push(信息.名称)
  if (信息.样式 !== 'follow') 片段.push(`style=${信息.样式}`)
  if (信息.字体 && 信息.字体 !== 'follow') 片段.push(`font=${信息.字体}`)
  return 片段.join(' ')
}

/**
 * 围栏首行里，信息串所占的区间。
 *
 * 首行形如 ```` ```python 名称 ````，需要把开头的反引号与可能存在的
 * 前导空白跳过。返回的区间用于替换信息串本身，**不动反引号**——
 * 反引号是围栏的语法标记，改它等于换了一种语法。
 *
 * @param 首行文本 围栏所在行的完整文本
 * @returns 相对该行行首的偏移区间；不是围栏行时返回 null
 */
export function 信息串区间(首行文本: string): { 起: number; 终: number } | null {
  const 匹配 = /^(\s*)(`{3,}|~{3,})([\s\S]*)$/.exec(首行文本)
  if (!匹配) return null
  const 起 = 匹配[1].length + 匹配[2].length
  return { 起, 终: 首行文本.length }
}

/**
 * 解析**整条围栏首行**（含反引号）。
 *
 * ## 为什么必须有这个入口
 *
 * 直接对整行调 `解析围栏信息` 会把反引号当成语言的一部分：
 * ```` ```js ```` 解析出 `语言 = "```js"`，再构建时又把反引号写回去，
 * 于是每改一次就多三个反引号——**攒到十二个才被人看出来**。
 *
 * 构建与解析必须作用在同一段文本上（信息串本身，不含围栏标记），
 * 这个函数把"切出信息串"这一步收在一处，避免每个调用点各切一次。
 */
export function 解析围栏首行(首行文本: string): 围栏信息 {
  const 区间 = 信息串区间(首行文本)
  if (!区间) return { 语言: '', 名称: '', 样式: 'follow', 字体: 'follow' }
  return 解析围栏信息(首行文本.slice(区间.起, 区间.终))
}

/**
 * 信息串能否被**原样还原**成用户写下的样子。
 *
 * 用来决定这一行要不要换成可点的头部栏。判断依据是
 * "解析再构建之后，和原文一模一样吗"。
 *
 * 为什么需要它：头部栏的下拉只认识语言、名称、`style=`、`font=` 这几样。
 * 遇到手写的 ```` ```{.python .numberLines} ```` 这种写法，解析会认不出花括号，
 * 一旦用下拉去改，那一整段就被**悄悄吃掉**了——用户的文档被改了，
 * 而界面上只表现为"我改了一下语言"。所以这类块照旧显示源码，保持可编辑。
 */
export function 信息串可还原(首行文本: string, 信息: 围栏信息): boolean {
  const 区间 = 信息串区间(首行文本)
  if (!区间) return false
  return 构建围栏信息(信息) === 首行文本.slice(区间.起, 区间.终).trim()
}
