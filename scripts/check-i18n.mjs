/**
 * 中文化检查。
 *
 * 扫描 `src/**\/*.ts`，找出**可能是用户可见文案的英文字符串字面量**。
 *
 * 动机很实际：界面文案散落在主进程菜单、IPC 对话框、渲染层提示三处，
 * 靠人工搜索一定会漏。上一轮就漏掉过状态栏的 "Ln 1, Col 1"。
 *
 * 只报"疑似"，不做判定——`Electron`、`Markdown` 这类专有名词会被列出，
 * 由人工确认是否属于必须保留的例外。
 *
 * 用法：node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 项目根 = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const 源码根 = join(项目根, 'src')

/** 承载用户可见文案的键名。出现这些键名时，其字符串值才值得检查。 */
const 文案键 = [
  'label',
  'title',
  'message',
  'detail',
  'buttons',
  'buttonLabel',
  'placeholder',
  'toolTip',
  'toast',
  'toastError',
  'alert',
  'confirm'
]

/**
 * 必须保留英文的例外。
 *
 * 判断标准：翻译后会失真、失效，或它本来就是专有名词/协议关键字。
 */
const 允许英文 = [
  // 品牌与专有名词
  'selfMD',
  'Markdown',
  'GitHub',
  'Electron',
  'Chromium',
  'Node',
  'CSS',
  'YAML',
  // 平台与协议标识
  'Windows',
  'Unix',
  'CRLF',
  'LF',
  'HTML',
  'MathML',
  'Tex',
  'TeX',
  'iPic',
  'PicGo',
  'API',
  // 导出格式名：**本来就该这么写**。
  // 把 PDF 译成「便携文档格式」、把 RTF 译成「富文本格式」，
  // 用户在菜单里反而找不到自己要的格式。通行的 zh-Hans 语言包同样保留：
  // `'HTML (without Styles)'` 译作 `'HTML (无样式)'`。
  'PDF',
  'RTF',
  'ePub',
  'LaTeX',
  'docx',
  'odt',
  'OpenDocument',
  // 工具指令（翻译即失效）
  'eslint-disable'
]

function 收集文件(目录) {
  const 结果 = []
  for (const 项 of readdirSync(目录)) {
    const 全 = join(目录, 项)
    if (statSync(全).isDirectory()) 结果.push(...收集文件(全))
    else if (项.endsWith('.ts')) 结果.push(全)
  }
  return 结果
}

/** 该字符串是否属于允许保留的例外。 */
function 是例外(文本) {
  return 允许英文.some((词) => 文本.includes(词))
}

const 命中 = []
for (const 文件 of 收集文件(源码根)) {
  const 行们 = readFileSync(文件, 'utf8').split(/\r?\n/)
  行们.forEach((行, 序) => {
    // 跳过整行注释
    if (/^\s*(\/\/|\*|\/\*)/.test(行)) return

    for (const 键 of 文案键) {
      // 键与值之间**只允许**空白，以及 buttons 数组的 `[` / `{`。
      // 早先写成 `[^'"]*` 会跨过括号匹配到 `label: pick('Edit', ...)` 里的
      // 参数，制造出一批假阳性——收紧之后才是"这个键的值真的是英文吗"。
      const 正则 = new RegExp(
        `${键}\\s*[:=(]\\s*[\\[{]?\\s*[\`'"]([A-Za-z][A-Za-z0-9 ,.\\-/%]{2,})[\`'"]`,
        'g'
      )
      for (const 匹配 of 行.matchAll(正则)) {
        const 值 = 匹配[1].trim()
        // 纯标识符/类名/事件名（无空格且全小写或驼峰）视为代码而非文案
        const 像文案 = /\s/.test(值) || /^[A-Z]/.test(值)
        if (!像文案) continue
        if (是例外(值)) continue
        命中.push(`${relative(项目根, 文件)}:${序 + 1}  ${键} → ${值}`)
      }
    }
  })
}

console.log('=== 中文化检查 ===')
console.log('')
if (命中.length === 0) {
  console.log('✅ 未发现残留的英文界面文案')
  process.exit(0)
}
console.log(`⚠️  发现 ${命中.length} 处疑似英文界面文案：`)
for (const 项 of 命中) console.log('   ' + 项)
console.log('')
console.log('说明：以上仅为"疑似"。若属于必须保留的专有名词，请加入脚本的「允许英文」列表。')
process.exit(0)
