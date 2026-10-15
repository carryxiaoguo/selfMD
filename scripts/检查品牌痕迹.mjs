/**
 * 检查产品里是否残留第三方品牌痕迹。
 *
 * 两类要查：
 *
 *   1. **品牌化标识** —— 带 `typora` 字样的字段名、目录名、类名。硬约束，出现即错。
 *   2. **分析痕迹** —— 内部文件名、字节偏移量、分析代号。它们泄漏的是
 *      "这个功能是怎么知道的"，对使用者毫无价值，却会让人以为代码是搬来的。
 *
 * 注释里说明设计取舍时提到"某编辑器也这么做"是正常的工程表达，
 * 不在禁止范围内——**禁止的是痕迹，不是借鉴**。
 *
 * ## 词表为什么要拼出来
 *
 * 清理脚本按同一批词做替换。如果这里把词**字面**写出来，
 * 清理脚本一跑就会把这份检查表也改掉——第一次运行时它就把自己废了。
 * 用数组 join 拼出来，字面上不出现这些词，清理脚本就匹配不到。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const 根 = resolve(process.argv[2] ?? process.cwd())

/** 本脚本自身必须豁免：它的词表是拼出来的，注释里也会解释这些词指什么。 */
const 工具脚本 = new Set([resolve(根, 'scripts', '检查品牌痕迹.mjs')])

const 跳过目录 = ['node_modules', 'out', 'release', '.git']
const 处理扩展 = ['.ts', '.md', '.css', '.mjs', '.py', '.json', '.html']

const 拼 = (...段) => 段.join('')
const 品 = 拼('ty', 'pora')

const 品牌词 = [
  拼(品, '-copy-images-to'),
  拼(品, '-root-url'),
  拼(品, '-user-images'),
  拼('drafts', 'Recover'),
  拼(品, '-sidebar'),
  拼(品, '-export'),
  拼('ty-on-', 'typewriter-mode'),
  拼(品, '://'),
  拼(品, '-icon'),
  拼('cm-s-', 品)
]

const 痕迹词 = [
  { 词: 拼('fra', 'me.js'), 说明: '内部文件名' },
  { 词: 拼('at', 'om.js'), 说明: '内部文件名' },
  { 词: 拼('base-', 'control.css'), 说明: '内部文件名' },
  { 词: 拼('Menu', '.json'), 说明: '内部资源名' },
  { 词: 拼('Panel', '.json'), 说明: '内部资源名' },
  { 词: 拼('conf', '.default.json'), 说明: '内部资源名' },
  { 词: 拼('R', 'E', 'A'), 说明: '分析代号' }
  // 不再把「分析痕迹」本身列为触发词：它已经是本项目自己的词汇
  // （这个检查脚本就叫这个名字），出现在 README 里是在描述检查本身，
  // 而不是留下了痕迹。真正的信号是上面那些具体的内部分文件名与分析代号。
]

function 收集(目录) {
  const 结果 = []
  for (const 名 of readdirSync(目录)) {
    const 全 = join(目录, 名)
    if (工具脚本.has(全)) continue
    let 是目录 = false
    try {
      是目录 = statSync(全).isDirectory()
    } catch {
      continue
    }
    if (是目录) {
      if (跳过目录.includes(名)) continue
      结果.push(...收集(全))
    } else if (处理扩展.some((扩展) => 名.endsWith(扩展))) {
      if (名 === 'pnpm-lock.yaml') continue
      结果.push(全)
    }
  }
  return 结果
}

/**
 * 分析代号的匹配方式。
 *
 * 不能用 `includes`：**`README` 里就含 `REA` 三个字母**，子串匹配会把
 * 每一处 `README.md` 都报成命中。用词边界框住，只认独立出现的代号。
 */
const 代号正则 = new RegExp(`(?<![A-Za-z])${拼('R', 'E', 'A')}(?![A-Za-z])`)

/** 字节偏移量的形态：`偏移 ~510257`、`@165,442`。 */
const 偏移正则 = new RegExp(拼('偏移\\s*~?[\\d,]{3,}', '|@\\s*\\d{3},\\d{3}'), 'g')

const 品牌命中 = []
const 痕迹命中 = []

for (const 文件 of 收集(根)) {
  const 文本 = readFileSync(文件, 'utf8')
  const 相对 = relative(根, 文件)

  文本.split('\n').forEach((行, 下标) => {
    for (const 词 of 品牌词) {
      if (行.includes(词)) {
        品牌命中.push(`${相对}:${下标 + 1}  ${词}  | ${行.trim().slice(0, 90)}`)
      }
    }
    for (const { 词, 说明 } of 痕迹词) {
      const 命中 = 词 === 拼('R', 'E', 'A') ? 代号正则.test(行) : 行.includes(词)
      if (!命中) continue
      // `REA` 也是 `rea/REA-主题系统.md` 这类**文件名**的一部分。
      // 文件名不是叙述文字，删掉一个词链接就断了——所以路径上下文里放行。
      // （上一轮就是按词硬替，把 README 里的跨文件链接全改断了。）
      if (词 === 拼('R', 'E', 'A') && 行.includes('rea/')) continue
      痕迹命中.push(`${相对}:${下标 + 1}  ${说明}  | ${行.trim().slice(0, 84)}`)
    }
    const 偏移 = 行.match(偏移正则)
    if (偏移) {
      痕迹命中.push(`${相对}:${下标 + 1}  字节偏移「${偏移.join(' ')}」  | ${行.trim().slice(0, 76)}`)
    }
  })
}

console.log('=== 品牌痕迹检查 ===')
console.log()

if (品牌命中.length === 0) {
  console.log('✅ 未发现品牌化标识')
} else {
  console.log(`❌ 发现 ${品牌命中.length} 处品牌化标识：`)
  for (const 行 of 品牌命中.slice(0, 30)) console.log(`   ${行}`)
  if (品牌命中.length > 30) console.log(`   …另有 ${品牌命中.length - 30} 处`)
}

console.log()
if (痕迹命中.length === 0) {
  console.log('✅ 未发现分析痕迹')
} else {
  console.log(`⚠️  发现 ${痕迹命中.length} 处分析痕迹：`)
  for (const 行 of 痕迹命中.slice(0, 30)) console.log(`   ${行}`)
  if (痕迹命中.length > 30) console.log(`   …另有 ${痕迹命中.length - 30} 处`)
}

// 品牌化标识是硬约束：出现即失败。
// 分析痕迹先作为提示——它们散落在注释里、数量大，一次性清完不现实，
// 但必须能被看见，才能逐步收敛。
process.exit(品牌命中.length > 0 ? 1 : 0)
