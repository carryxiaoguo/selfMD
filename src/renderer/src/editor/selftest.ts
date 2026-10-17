import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { renderMarkdownToHtml } from '@shared/markdown-html'
import { PrefsSchema, 全部设置项, 校验设置表 } from '@shared/settings-schema'
import { findBlockMath, 扫描行内公式 } from '@shared/数学'
import { DEFAULT_SETTINGS, type uploaderType } from '@shared/types'
import { buildUploadCmd, parseUploadResult } from '@shared/upload-parse'
import { 提取标题, locateHeading } from '../ui/outline'
import {
  toggleList,
  切换引用,
  wrapInline,
  插入表格,
  插入链接,
  clearFormat,
  调整缩进,
  setHeadingLevel
} from './commands'
import { 换引号, 换破折号, 扫描渲染标点 } from './smart-punctuation'
import { fuzzyScore, 模糊筛选, pathTail } from '@shared/模糊匹配'
import { 句子区间, 词区间 } from './selection'
import { readFrontMatter, setAttr, 移除属性 } from '@shared/front-matter'
import {
  uniqueFileName,
  应当搬运,
  resolveTargetDir,
  type 目标解析输入,
  type 目标结果,
  type 搬运判定输入
} from '../image/resolve-target'
import { buildImageSyntax, 生成引用地址, type 引用选项 } from '../image/reference'

/**
 * 编辑命令自测。
 *
 * 表驱动：每条用例给定输入文本与选区，执行一个命令，记录输出文本。
 * 这样菜单里的段落/格式命令不再只靠手点验证——在冒烟测试里就能逐条对账，
 * 也能防止后续重构悄悄改坏"切换语义"（再执行一次应当还原）。
 *
 * 只在 `--smoke-test` 下运行，不进入正常使用路径。
 */

interface 用例 {
  name: string
  input: string
  /** 选区 [起点, 终点]；省略表示光标在文首。 */
  selection?: [number, number]
  /** 执行顺序中的命令序列，用于验证"切换"语义。 */
  run: (view: EditorView) => void
}

const 用例表: 用例[] = [
  {
    name: '设为二级标题',
    input: '甲',
    run: (v) => void setHeadingLevel(v, 2)
  },
  {
    name: '同级别再执行一次=取消',
    input: '## 甲',
    run: (v) => void setHeadingLevel(v, 2)
  },
  {
    name: '一级升为二级（降级）',
    input: '# 甲',
    run: (v) => void setHeadingLevel(v, 2)
  },
  {
    name: '段落加粗',
    input: '甲',
    selection: [0, 1],
    run: (v) => void wrapInline(v, '**')
  },
  {
    name: '已加粗再执行=取消',
    input: '**甲**',
    selection: [2, 3],
    run: (v) => void wrapInline(v, '**')
  },
  {
    name: '加引用',
    input: '甲',
    run: (v) => void 切换引用(v)
  },
  {
    name: '已有引用再执行=取消',
    input: '> 甲',
    run: (v) => void 切换引用(v)
  },
  {
    name: '转无序列表',
    input: '甲',
    run: (v) => void toggleList(v, '无序')
  },
  {
    name: '有序列表自动编号（两行）',
    input: '甲\n乙',
    selection: [0, 3],
    run: (v) => void toggleList(v, '有序')
  },
  {
    name: '转任务列表',
    input: '甲',
    run: (v) => void toggleList(v, '任务')
  },
  {
    name: '无序转任务（应替换而非叠加）',
    input: '- 甲',
    run: (v) => void toggleList(v, '任务')
  },
  {
    name: '缩进',
    input: '甲',
    run: (v) => void 调整缩进(v, 1)
  },
  {
    name: '插入链接（有选中文字）',
    input: '甲',
    selection: [0, 1],
    run: (v) => void 插入链接(v)
  },
  {
    name: '清除格式',
    input: '**甲** 与 `乙`',
    selection: [0, 11],
    run: (v) => void clearFormat(v)
  },
  {
    name: '插入表格骨架',
    input: '',
    run: (v) => void 插入表格(v)
  }
]

function 单例执行(
  view: EditorView,
  input: string,
  selection: [number, number] | undefined,
  run: (v: EditorView) => void
): string {
  // 选区一律钳制到文档长度内。手写用例表时很容易把偏移写多一位，
  // 而 CodeMirror 遇到越界选区会直接抛 "Selection points outside of document"，
  // 整个自测连带文档加载都会失败——钳制让这类笔误退化成"选到末尾"。
  const length = input.length
  const start = Math.max(0, Math.min(selection?.[0] ?? 0, length))
  const end = Math.max(start, Math.min(selection?.[1] ?? start, length))

  // 用 setState 重置，确保每条用例互不影响（含撤销栈）。
  // 刻意构造"裸状态"：不带任何编辑器扩展，把被测命令与插件行为隔离，
  // 这样断言的就是命令本身的文本变换。
  view.setState(
    EditorState.create({
      doc: input,
      selection: EditorSelection.range(start, end)
    })
  )
  run(view)
  return view.state.doc.toString().replace(/\n/g, '⏎')
}

/** 运行全部用例，返回"用例名 → 输出"的对照表。 */
export function 运行命令自测(view: EditorView, 恢复状态: EditorState): Record<string, string> {
  const result: Record<string, string> = {}
  for (const item of 用例表) {
    result[`${item.name}：${item.input.replace(/\n/g, '⏎')}`] = 单例执行(view, item.input, item.selection, item.run)
  }
  view.setState(恢复状态)
  return result
}

// ---------------------------------------------------------------------------
// 纯函数自测
// ---------------------------------------------------------------------------

/**
 * 智能标点与选区算法的自测。
 *
 * 这些函数吃字符串、吐偏移，边界条件远比表面看起来多：行首的 `---` 是水平
 * 分割线而不是破折号、英文句点只有在词尾才断句、中日韩文字没有词边界……
 * 逐条断言是唯一能在重构时不走样的办法。
 */
export function 运行纯函数自测(): Record<string, string> {
  const result: Record<string, string> = {}

  // --- 引号方向 ---------------------------------------------------------
  const 引号用例: [string, '"' | "'", string][] = [
    ['行首双引号', '"', ''],
    ['空格后双引号', '"', '他说 '],
    ['字母后双引号', '"', 'said'],
    ['开括号后双引号', '"', '（'],
    ['行首单引号', "'", ''],
    ['词中单引号（撇号）', "'", 'don'],
    ['中文后单引号（撇号）', "'", '他']
  ]
  for (const [name, ch, preamble] of 引号用例) {
    result[`引号·${name}`] = 换引号(ch, preamble)
  }

  // --- 破折号 -----------------------------------------------------------
  const 破折号用例: [string, string][] = [
    ['空行', ''],
    ['行首一个连字符', '-'],
    ['行首两个连字符（须保留给水平分割线）', '--'],
    ['正文后第一个连字符', '文字'],
    ['正文后第二个连字符', '文字-'],
    ['已有连接号再敲连字符', '文字–'],
    ['文档里既有的连续连字符（不改动）', '文字--'],
    ['缩进后的连字符（仍属行首）', '    -']
  ]
  for (const [name, preamble] of 破折号用例) {
    const plan = 换破折号(preamble)
    result[`破折号·${name}`] = plan ? `回退${plan.fallback}→${plan.insert}` : '不转换'
  }

  // --- 句子边界 ---------------------------------------------------------
  const 句子用例: [string, string, number][] = [
    ['第一句内', '甲。乙。丙。', 1],
    ['第二句内', '甲。乙。丙。', 3],
    ['英文句点断句', 'Hello. World.', 7],
    ['小数点不断句', '圆周率是 3.14 左右', 8],
    ['无终止符则整行', '没有句号的一行', 3],
    ['分号也断句', '甲；乙', 2]
  ]
  for (const [name, docText, offset] of 句子用例) {
    const { start, end } = 句子区间(docText, offset)
    result[`句子·${name}`] = `[${start},${end}) = ${JSON.stringify(docText.slice(start, end))}`
  }

  // --- 词边界 -----------------------------------------------------------
  const 词用例: [string, string, number][] = [
    ['拉丁词中间', 'hello world', 2],
    ['拉丁词边界', 'hello world', 5],
    ['中文单字', '中文测试', 2],
    ['空白处', '   ', 1]
  ]
  for (const [name, docText, offset] of 词用例) {
    const range = 词区间(docText, offset)
    result[`词·${name}`] = range ? JSON.stringify(docText.slice(range.start, range.end)) : '无词'
  }

  return result
}

// ---------------------------------------------------------------------------
// 图片管线自测
// ---------------------------------------------------------------------------

/** 把目标解析结果压成一行，方便断言。 */
function 显示目标(result: 目标结果): string {
  return result.kind === '目录' ? `目录 ${result.filePath}（${result.origin}）` : result.kind
}

/**
 * 图片目标解析、搬运判定、唯一命名与前置元数据读写的自测。
 *
 * 这几段的分支组合极多（六种全局策略 × 文档级覆盖 × 文本包 × 上传开关 ×
 * 未保存文档），而写错的症状是"图片跑到奇怪的地方去了"——靠手点几乎不可能
 * 穷举。做成纯函数并逐条断言，是唯一能保证不走样的办法。
 */
export function 运行图片管线自测(): Record<string, string> {
  const result: Record<string, string> = {}

  // --- 目标目录解析 -----------------------------------------------------
  const baseline: 目标解析输入 = {
    docDir: 'C:/笔记',
    docName: '甲.md',
    是文本包: false,
    docSettings: null,
    globalPolicy: '',
    customDir: './${filename}',
    autoUploadAllowed: false
  }
  const 目标用例: [string, Partial<目标解析输入>][] = [
    ['默认策略（不做特殊处理）', {}],
    ['当前文件夹', { globalPolicy: 'folder' }],
    ['assets 子目录', { globalPolicy: 'assets' }],
    ['每文件独立 assets', { globalPolicy: 'per-file-assets' }],
    ['自定义相对目录', { globalPolicy: 'custom' }],
    ['自定义绝对目录', { globalPolicy: 'custom', customDir: 'D:/图床' }],
    ['自定义绝对目录带占位符', { globalPolicy: 'custom', customDir: 'D:/图/${filename}' }],
    ['自定义目录留空', { globalPolicy: 'custom', customDir: '' }],
    ['全局上传', { globalPolicy: 'upload' }],
    ['文档级覆盖全局', { docSettings: 'imgs', globalPolicy: 'assets' }],
    ['文档级要求上传且已允许', { docSettings: 'upload', autoUploadAllowed: true }],
    ['文档级要求上传但未允许', { docSettings: 'upload', autoUploadAllowed: false }],
    ['文档级用 ipic 标记', { docSettings: 'ipic', autoUploadAllowed: true }],
    ['文档级绝对路径', { docSettings: 'D:/图' }],
    ['文档级含文件名占位符', { docSettings: '${filename}.assets' }],
    ['文本包走包内 assets', { 是文本包: true, globalPolicy: 'assets' }],
    ['未保存文档 + 需要目录的策略', { docDir: null, docName: null, globalPolicy: 'folder' }],
    ['未保存文档 + 不动策略', { docDir: null, docName: null, globalPolicy: '' }],
    ['未保存文档 + 绝对自定义目录', { docDir: null, docName: null, globalPolicy: 'custom', customDir: 'D:/图' }]
  ]
  for (const [name, 覆盖] of 目标用例) {
    result[`目标·${name}`] = 显示目标(resolveTargetDir({ ...baseline, ...覆盖 }))
  }

  // --- 是否搬运 ---------------------------------------------------------
  const 搬运基准: 搬运判定输入 = {
    source: 'C:/下载/照片.png',
    targetDir: 'C:/笔记/imgs',
    搬运本地: true,
    搬运在线: false
  }
  const 搬运用例: [string, Partial<搬运判定输入>][] = [
    ['本地图片 + 开启本地搬运', {}],
    ['已关闭本地搬运', { 搬运本地: false }],
    ['已在目标目录内', { source: 'C:/笔记/imgs/照片.png' }],
    ['就是目标目录本身', { source: 'C:/笔记/imgs' }],
    ['data 内联图片', { source: 'data:image/png;base64,AAAA' }],
    ['在线图片 + 关闭在线搬运', { source: 'https://example.com/a.png' }],
    ['在线图片 + 开启在线搬运', { source: 'https://example.com/a.png', 搬运在线: true }],
    ['源与目标都为空', { source: '', targetDir: '' }]
  ]
  for (const [name, 覆盖] of 搬运用例) {
    result[`搬运·${name}`] = 应当搬运({ ...搬运基准, ...覆盖 }) ? '搬运' : '不搬'
  }

  // --- 唯一文件名 -------------------------------------------------------
  const 占用集合 = new Set(['甲.png', '甲-1.png'])
  result['命名·不重名'] = uniqueFileName('乙.png', () => false)
  result['命名·重名一次'] = uniqueFileName('甲.png', () => false)
  result['命名·跳过已占用的连续编号'] = uniqueFileName('甲.png', (name) => 占用集合.has(name))

  // --- 前置元数据读写 ---------------------------------------------------
  const 无元数据 = '# 标题\n\n正文'
  const 有元数据 = '---\ntitle: 甲\nimage-folder: imgs\n---\n\n正文'

  result['元数据·无元数据'] = readFrontMatter(无元数据).exists ? '存在' : '不存在'

  const 读有 = readFrontMatter(有元数据)
  result['元数据·读取图片目录'] = 读有.attr['image-folder'] ?? '(缺失)'
  result['元数据·读取标题'] = 读有.attr['title'] ?? '(缺失)'

  result['元数据·写入到无元数据的文档'] = setAttr(无元数据, 'image-folder', 'imgs')
    .split('\n')
    .slice(0, 3)
    .join('⏎')

  result['元数据·更新已有键'] =
    readFrontMatter(setAttr(有元数据, 'image-folder', '图')).attr[
      'image-folder'
    ] ?? '(缺失)'

  result['元数据·新增键'] =
    readFrontMatter(setAttr(有元数据, 'author', '我')).attr['author'] ?? '(缺失)'

  result['元数据·移除一个键后块仍存在'] = readFrontMatter(
    移除属性(有元数据, 'image-folder')
  ).exists
    ? '存在'
    : '不存在'

  result['元数据·移除唯一键则整块消失'] = 移除属性('---\nonly: 1\n---\n\n正文', 'only').startsWith(
    '正文'
  )
    ? '整块消失'
    : '残留'

  // --- 引用地址生成 -----------------------------------------------------
  const 引用用例: [string, string, string | null, 引用选项][] = [
    ['同目录相对路径', 'C:/笔记/图/甲.png', 'C:/笔记', { useRelativePath: true, addDotPrefix: false, escapeUrl: false }],
    ['加 ./ 前缀', 'C:/笔记/图/甲.png', 'C:/笔记', { useRelativePath: true, addDotPrefix: true, escapeUrl: false }],
    ['上级目录相对路径', 'C:/笔记/图/甲.png', 'C:/笔记/子', { useRelativePath: true, addDotPrefix: false, escapeUrl: false }],
    ['关闭相对路径', 'C:/笔记/图/甲.png', 'C:/笔记', { useRelativePath: false, addDotPrefix: false, escapeUrl: false }],
    ['跨盘符回退绝对路径', 'D:/图/甲.png', 'C:/笔记', { useRelativePath: true, addDotPrefix: false, escapeUrl: false }],
    ['空格被转义', 'C:/笔记/图/有 空格.png', 'C:/笔记', { useRelativePath: true, addDotPrefix: false, escapeUrl: true }],
    ['中文保持可读', 'C:/笔记/图/样本.png', 'C:/笔记', { useRelativePath: true, addDotPrefix: false, escapeUrl: true }],
    ['井号被转义', 'C:/笔记/图/甲#1.png', 'C:/笔记', { useRelativePath: true, addDotPrefix: false, escapeUrl: true }]
  ]
  for (const [name, image, 文档目录值, options] of 引用用例) {
    result[`引用·${name}`] = 生成引用地址(image, 文档目录值, options)
  }

  result['语法·Markdown'] = buildImageSyntax('图/甲.png', '甲')
  result['语法·HTML'] = buildImageSyntax('图/甲.png', '甲', 'html')
  result['语法·alt 含方括号'] = buildImageSyntax('图/甲.png', '甲]乙')

  return result
}

/**
 * 导出渲染自测。
 *
 * Markdown → HTML 是纯函数，所以可以逐项断言输出片段，不必真的导出一次再肉眼比对。
 * 断言用"有没有这段 HTML"而不是比整串：整串断言在加一个换行时就全红，
 * 而这里真正要钉住的是**结构**——标签名、嵌套、转义、属性。
 */
export function 运行导出自测(): Record<string, string> {
  const docModel = [
    '# 标题一',
    '',
    '普通段落，含 **粗体**、*斜体*、~~删除线~~、`行内代码` 与 [链接](https://example.com "标题")。',
    '',
    '- 甲',
    '- 乙',
    '',
    '3. 丙',
    '4. 丁',
    '',
    '> 引用一行',
    '',
    '```js',
    'const a = 1 < 2',
    '```',
    '',
    '| 左 | 中 | 右 |',
    '|:---|:---:|---:|',
    '| 1 | 2 | 3 |',
    '',
    '- [x] 已完成',
    '- [ ] 未完成',
    '',
    '---',
    '',
    '段落里的 <标签> 与 & 符号必须转义。'
  ].join('\n')

  const html = renderMarkdownToHtml(docModel)
  const has = (parts: string): string => (html.includes(parts) ? '有' : '无')

  const result: Record<string, string> = {
    '导出·标题': has('<h1>标题一</h1>'),
    '导出·段落': has('<p>普通段落'),
    '导出·粗体': has('<strong>粗体</strong>'),
    '导出·斜体': has('<em>斜体</em>'),
    '导出·删除线': has('<del>删除线</del>'),
    '导出·行内代码': has('<code>行内代码</code>'),
    '导出·链接与标题': has('<a href="https://example.com" title="标题">链接</a>'),
    '导出·无序列表': has('<ul>'),
    '导出·有序列表保留起始序号': has('<ol start="3">'),
    '导出·引用块': has('<blockquote>'),
    '导出·代码块带语言类': has('<pre><code class="language-js">'),
    // 代码块里的 `<` 必须转义，否则导出的 HTML 会被浏览器当成标签吃掉
    '导出·代码块内转义': has('const a = 1 &lt; 2'),
    '导出·表格': has('<table>'),
    '导出·表头单元格': has('<th'),
    '导出·左对齐': has('style="text-align:left"'),
    '导出·居中': has('style="text-align:center"'),
    '导出·右对齐': has('style="text-align:right"'),
    '导出·任务已勾选': has('type="checkbox" disabled checked'),
    '导出·任务未勾选': has('type="checkbox" disabled>'),
    '导出·水平线': has('<hr>'),
    // 正文里的裸尖括号与 & 同样要转义
    '导出·正文转义尖括号': has('&lt;标签&gt;'),
    '导出·正文转义与号': has('&amp;')
  }

  // 语法标记不能泄漏进输出——这是最容易出的错：
  // `# 标题` 渲染成 `<h1># 标题</h1>`，肉眼扫一眼很难发现。
  result['导出·无井号残留'] = /<h[1-6]>[^<]*#/.test(html) ? '残留' : '干净'
  result['导出·无星号残留'] = /<strong>\*|<em>\*/.test(html) ? '残留' : '干净'
  result['导出·无反引号残留'] = /<code>`/.test(html) ? '残留' : '干净'
  // 分隔行的 `|:---|` 不该出现在表格正文里
  result['导出·无对齐标记残留'] = html.includes('|:---') ? '残留' : '干净'

  return result
}

/**
 * 偏好设置表自测。
 *
 * 价值在于**抓笔误**：表里写错一个键名（`livePreveiw`），界面照样画得出来、
 * 点下去毫无反应，靠肉眼几乎发现不了。把"表里的每个键都在默认设置里存在"
 * 变成断言，这类错误就无处可藏。
 *
 * 顺带检查下拉项的值与数值区间是否自洽——选了却存不进去、
 * 或者被夹在边界上出不来，症状与键名写错一样安静。
 */
export function 运行偏好设置自测(): Record<string, string> {
  const result: Record<string, string> = {}
  const items = 全部设置项()

  result['偏好设置·项目数'] = String(items.length)
  result['偏好设置·分区数'] = String(PrefsSchema.length)

  const 坏键 = 校验设置表()
  result['偏好设置·键名全部有效'] = 坏键.length === 0 ? '有效' : `无效：${坏键.join('、')}`

  // 重复键会让两项互相覆盖，界面上表现为"改了一个另一个也变"
  const 键们 = items.map((item) => String(item.key))
  const 重复 = 键们.filter((key, subscript) => 键们.indexOf(key) !== subscript)
  result['偏好设置·无重复项'] = 重复.length === 0 ? '无重复' : `重复：${[...new Set(重复)].join('、')}`

  // 下拉项必须有选项，否则渲染出一个空下拉框
  const 空下拉 = items.filter((item) => item.kind === '下拉' && (item.options?.length ?? 0) === 0)
  result['偏好设置·下拉均有选项'] =
    空下拉.length === 0 ? '均有' : `空下拉：${空下拉.map((item) => String(item.key)).join('、')}`

  // 数值项的上下界必须自洽，否则夹紧逻辑会把值卡在边界上出不来
  const 界错 = items.filter(
    (item) =>
      item.kind === '数字' &&
      item.minValue !== undefined &&
      item.maxValue !== undefined &&
      item.minValue >= item.maxValue
  )
  result['偏好设置·数值区间自洽'] =
    界错.length === 0 ? '自洽' : `区间错误：${界错.map((item) => String(item.key)).join('、')}`

  // 每项都要有中文标签
  const 无中文 = items.filter((item) => !/[\u4e00-\u9fff]/.test(item.label))
  result['偏好设置·标签均含中文'] =
    无中文.length === 0 ? '均含' : `缺中文：${无中文.map((item) => String(item.key)).join('、')}`

  // 下拉项的当前默认值必须是合法选项之一，否则打开面板就是"选了个不存在的项"
  const 默认越界: string[] = []
  for (const item of items) {
    if (item.kind !== '下拉' || !item.options) continue
    const 默认值 = String(DEFAULT_SETTINGS[item.key] ?? '')
    if (!item.options.some((options) => options.value === 默认值)) {
      默认越界.push(`${String(item.key)}=${默认值}`)
    }
  }
  result['偏好设置·默认值在选项内'] =
    默认越界.length === 0 ? '在选项内' : `越界：${默认越界.join('、')}`

  return result
}

/**
 * 上传结果解析自测。
 *
 * 这是图床功能里唯一能做成纯函数的部分，也是唯一容易写错的部分——
 * 各种 CLI 的输出格式互不统一。从 通行的 `M(stdout, uploader)`
 * 提取到的策略是"从最后一行往前扫，收到 URL 就继续，遇到非 URL 行就停"。
 *
 * **最后那条停止条件是最关键的**：不设它，日志里出现的任何网址都会被当成结果，
 * 于是"上传 1 张图返回 3 个 URL"，回填时张冠李戴——而且看起来像是上传器的问题。
 */
export function 运行上传自测(): Record<string, string> {
  const result: Record<string, string> = {}
  const solved = (output: string, uploader: uploaderType = 'picgo-cli', 期望 = 1): string => {
    const r = parseUploadResult(output, uploader, 期望)
    return r.error ? `错误(${r.url.length})` : r.url.join(',')
  }

  // --- 基本形态 -------------------------------------------------------
  result['上传·单行纯地址'] = solved('https://i.example.com/a.png\n')
  result['上传·多行地址'] = solved('https://i.example.com/a.png\nhttps://i.example.com/b.png\n', 'picgo-cli', 2)
  // 裸域名要补上协议，否则 Markdown 渲染器会把它当成相对路径
  result['上传·裸域名补协议'] = solved('i.example.com/2024/a.png\n')
  result['上传·ftp 协议保留'] = solved('ftp://files.example.com/a.png\n')

  // --- 停止条件（最关键的一条） ---------------------------------------
  // 日志头里有旧网址。从后往前扫、遇到非 URL 行即停，才不会被它污染。
  result['上传·日志头里的旧网址不被误收'] = solved(
    '[INFO] 上次上传：https://old.example.com/旧图.png\n' +
      '[INFO] 开始上传…\n' +
      'https://i.example.com/新图.png\n'
  )
  // 反过来，如果地址后面还有内容（地址在中间），不该把它当结果
  result['上传·地址后还有日志则停止'] = solved(
    'https://i.example.com/a.png\n[INFO] done\n',
    'picgo-cli',
    0
  )

  // --- PicGo 应用模式走 JSON ------------------------------------------
  result['上传·JSON 成功'] = solved(
    JSON.stringify({ success: true, result: ['https://i.example.com/a.png'] }),
    'picgo-app'
  )
  result['上传·JSON 失败'] = solved(
    JSON.stringify({ success: false, msg: '未配置图床' }),
    'picgo-app',
    0
  )
  // JSON 坏了要能退回命令行解析，而不是整个失败
  result['上传·坏 JSON 退回文本解析'] = solved(
    'some log\nhttps://i.example.com/a.png\n',
    'picgo-app'
  )

  // --- 数量校验 -------------------------------------------------------
  // 数量对不上必须报错：宁可失败，也不能让用户拿着错位的地址去回填
  result['上传·数量不符报错'] = solved('https://i.example.com/a.png\n', 'picgo-cli', 2)
  result['上传·空输出报错'] = solved('', 'picgo-cli', 1)

  // --- 命令行生成 -----------------------------------------------------
  const config = {
    自定义命令: 'my-uploader --file ${filepath} --name ${filename}',
    用户数据目录: 'C:/Users/甲/AppData/Roaming/selfmd',
    platform: 'win32' as const
  }
  result['上传·自定义命令占位符'] = buildUploadCmd(
    'custom',
    'C:\\笔记\\我的 图.png',
    config
  ) ?? '(空)'
  result['上传·路径用正斜杠'] = buildUploadCmd('custom', 'C:\\a\\b.png', config)?.includes('/')
    ? '正斜杠'
    : '反斜杠'
  result['上传·PicGo 命令行含 UTF-8 前缀'] = buildUploadCmd('picgo-cli', 'C:/a.png', config)
    ?.startsWith('chcp 65001')
    ? '有'
    : '无'
  result['上传·app 模式不生成命令'] = buildUploadCmd('picgo-app', 'C:/a.png', config) ?? '无命令'
  // 含空格的路径不加引号会被 shell 拆成两个参数
  result['上传·含空格路径加引号'] = buildUploadCmd('custom', 'C:\\我的 文档\\a.png', {
    ...config,
    自定义命令: 'up ${filepath}'
  })?.includes('"C:/我的 文档/a.png"')
    ? '有引号'
    : '无引号'

  return result
}

/**
 * 数学公式扫描自测。
 *
 * **`@lezer/markdown` 不解析数学公式**（打印解析树可以看到 `$x^2$` 只是普通
 * 文本），所以只能自己扫。自己扫就意味着要面对误判——最常见的误判是把
 * 货币金额当成公式。三条限制就是为此设的，逐条钉住：
 *
 *   1. 开头 `$` 后面不能紧跟空白
 *   2. 结尾 `$` 前面不能是空白
 *   3. 内容不能为空
 */
export function 运行数学自测(): Record<string, string> {
  const result: Record<string, string> = {}
  const sweep = (docText: string): string =>
    扫描行内公式(docText, 0)
      .map((range) => `[${range.formula}]`)
      .join('')

  result['数学·基本行内'] = sweep('质能方程 $E = mc^2$ 是这样的')
  // 公式体内允许空格（`E = mc^2` 就有），限制只作用在 `$` 紧邻的位置
  result['数学·公式内允许空格'] = sweep('$a + b$')
  // 两个公式在一行里
  result['数学·一行两个'] = sweep('$a$ 与 $b$')

  // --- 误判防护 -------------------------------------------------------
  // 货币：开头的 `$` 后面紧跟数字（无空白），结尾的 `$` 前面是数字。
  // 这正是规则挡不住的情况——但真正的价格写法 `$5 到 $10` 里，
  // 开头的 `$` 后面紧跟的不是空白而是数字，会命中；所以真正的保护是
  // "成对"要求：只有一个 `$` 时不成立。
  result['数学·单个美元符号不成公式'] = sweep('这本书 $5 元') || '（无）'
  // 转义的 `\$` 不是公式
  result['数学·转义美元符号'] = sweep('价格是 \\$5 到 \\$10 元') || '（无）'
  // `$$` 是块级，不该被行内扫描吃掉
  result['数学·$$ 不当作行内'] = sweep('$$x^2$$') || '（无）'
  // 空内容
  result['数学·空内容不成公式'] = sweep('$$') || '（无）'
  // 结尾 `$` 前是空白 → 不闭合
  result['数学·结尾前有空白不闭合'] = sweep('$a $') || '（无）'

  // --- 块级识别 -------------------------------------------------------
  result['数学·块级单行'] = findBlockMath('$$E = mc^2$$') ?? '（无）'
  result['数学·块级跨行'] = findBlockMath('$$\n\\int_0^1 x\\,dx\n$$') ?? '（无）'
  result['数学·块级去首尾空白'] = findBlockMath('$$  x  $$') ?? '（无）'
  result['数学·非块级返回空'] = findBlockMath('$x$') ?? '（无）'
  result['数学·空块级返回空'] = findBlockMath('$$$$') ?? '（无）'

  // --- 关闭开关 -------------------------------------------------------
  result['数学·关闭后不扫描'] = 扫描行内公式('$x$', 0, false).length === 0 ? '不扫描' : '仍扫描'

  return result
}

/**
 * 渲染时转换的标点扫描自测。
 *
 * 与输入时转换的区别是**不改文档**：文件里存 ASCII，屏幕上显示排版字符。
 * 两套规则必须一致，所以引号判断复用了同一个函数——这里断言的重点是
 * **扫描的推进顺序**：`---` 必须先于 `--` 匹配，否则破折号会被拆成
 * "连接号 + 连字符"。
 */
export function 运行渲染标点自测(): Record<string, string> {
  const result: Record<string, string> = {}
  const sweep = (docText: string): string =>
    扫描渲染标点(docText, 0)
      .map((segment) => `${segment.originalText}→${segment.show}`)
      .join(' ')

  // --- 破折号：三连优先 ---
  result['标点·三连是破折号'] = sweep('甲---乙')
  result['标点·两连是连接号'] = sweep('甲--乙')
  // 四个连字符：先吃掉三连，剩一个原样保留
  result['标点·四连拆成破折号加连字符'] = sweep('甲----乙')

  // --- 省略号 ---
  result['标点·三点是省略号'] = sweep('等等...')
  result['标点·两点不动'] = sweep('等等..') || '（无）'

  // --- 引号：方向由前文决定 ---
  result['标点·段首是左引号'] = sweep('"甲"')
  result['标点·词后是右引号'] = sweep('甲"乙"')
  // 单引号跟在字母后是撇号（don't），不是引号
  result['标点·撇号'] = sweep("don't")

  // --- 不该动的东西 ---
  result['标点·单个连字符不动'] = sweep('甲-乙') || '（无）'
  result['标点·普通文字不动'] = sweep('甲乙丙') || '（无）'
  // 已经是排版字符的，不该再被"转换"一次
  result['标点·已是弯引号则不动'] = sweep('“甲”') || '（无）'

  // --- 偏移量要对 ---
  const segment = 扫描渲染标点('甲"乙', 100)
  result['标点·偏移量含基准'] = segment.length === 1 ? String(segment[0].from) : `段数=${segment.length}`

  return result
}

/**
 * 模糊匹配自测。
 *
 * 重点不是"能不能匹配上"，而是**排序对不对**。只做子序列匹配的话，
 * 敲 `md` 会把几百个文件全列出来而想要的排在最后——
 * 那还不如直接翻文件树。所以断言的都是相对顺序。
 */
export function 运行模糊匹配自测(): Record<string, string> {
  const result: Record<string, string> = {}

  const 名单 = [
    'E:/项目/文档/无关.md',
    'E:/项目/README.md',
    'E:/项目/src/error.md',
    'E:/项目/甲/乙/丙/深层笔记.md',
    'E:/项目/note.md',
    'E:/项目/a_b_c.md'
  ]
  const filterOut = (query: string): string =>
    模糊筛选(
      query,
      名单.map((p) => ({ entry: p, docText: p })),
      pathTail
    )
      .map((p) => pathTail(p))
      .join(' ')

  // --- 基本匹配 ---
  result['匹配·空查询返回全部'] = pathTail(filterOut('').split(' ')[0] ?? '') || '（空）'
  result['匹配·命中文件名'] = filterOut('readme')
  // 子序列：`nbt` 命中"笔记"的拼音首字母不成立，改用英文字母的子序列
  result['匹配·子序列命中'] = filterOut('nmd')

  // --- 排序：词首/连续优先 ---
  // `err` 应当先命中 error.md，而不是把别的排前面
  result['匹配·前缀优于词中'] = filterOut('err').split(' ')[0]

  // --- 末段权重：同名情况下，文件名命中要压过目录名命中 ---
  // `note` 只在 note.md 的文件名里出现
  result['匹配·末段命中排前'] = filterOut('note').split(' ')[0]

  // --- 不匹配的淘汰 ---
  result['匹配·无命中返回空'] = filterOut('zzzz') || '（空）'

  // --- 评分函数的边界 ---
  result['评分·查询比文本长'] = fuzzyScore('abcdef', 'abc') === null ? '不匹配' : '匹配'
  result['评分·大小写不敏感'] = fuzzyScore('ABC', 'abc') === null ? '不匹配' : '匹配'
  // 完全包含要拿到高分，且位置越靠前分越高
  const 靠前 = fuzzyScore('a', 'a___') ?? -1
  const 靠后 = fuzzyScore('a', '___a') ?? -1
  result['评分·靠前分更高'] = 靠前 > 靠后 ? '是' : `否(${靠前} vs ${靠后})`

  // --- 路径末段 ---
  result['路径末段·反斜杠'] = pathTail('E:\\项目\\文档\\甲.md')
  result['路径末段·正斜杠'] = pathTail('E:/项目/文档/甲.md')
  result['路径末段·没有分隔符'] = pathTail('甲.md')

  return result
}

/**
 * 大纲提取自测。
 *
 * 自建一个 EditorState 而不是复用编辑器的：这些断言关心"给定文档提取出什么"，
 * 与用户当前打开的文件无关，自建状态让断言不依赖外部环境。
 *
 * 覆盖的都是容易写错的边界：收尾井号、Setext 下划线算不算正文、
 * 光标在第一个标题之前该返回什么。
 */
export function 运行大纲自测(): Record<string, string> {
  const docModel = [
    '前言文字。',
    '',
    '# 一级',
    '',
    '正文。',
    '',
    '## 二级 ##',
    '',
    '正文。',
    '',
    'Setext 一级',
    '===========',
    '',
    '### 三级',
    '',
    '另一个 Setext',
    '-------------'
  ].join('\n')

  const state = EditorState.create({ doc: docModel, extensions: [markdown()] })
  const headings = 提取标题(state)
  const result: Record<string, string> = {}

  result['大纲·标题数量'] = String(headings.length)
  result['大纲·级别序列'] = headings.map((t) => t.level).join(',')
  result['大纲·文本序列'] = headings.map((t) => t.docText).join(' | ')
  // 收尾井号必须剥掉，否则大纲里会出现「二级 ##」
  result['大纲·收尾井号已剥离'] = headings.some((t) => t.docText.includes('#')) ? '残留' : '已剥离'
  // Setext 的下划线在语法节点内部，只取第一行才是正文
  result['大纲·Setext 下划线已剔除'] = headings.some(
    (t) => t.docText.includes('=') || t.docText.includes('---')
  )
    ? '残留'
    : '已剔除'
  result['大纲·行号'] = headings.map((t) => t.lineNo).join(',')

  // 光标在第一个标题之前 → -1，而不是错误地高亮第一个标题
  result['定位·文首'] = String(locateHeading(headings, 0))
  // 光标正好落在某个标题的起始偏移上
  result['定位·标题起始处'] = String(locateHeading(headings, headings[2].position))
  // 光标在标题正文中间
  result['定位·标题内部'] = String(locateHeading(headings, headings[2].position + 3))
  // 光标在文末
  result['定位·文末'] = String(locateHeading(headings, state.doc.length))

  return result
}
