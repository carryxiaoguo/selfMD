/**
 * 把中文标识符按对照表改成英文。
 *
 * ## 为什么用 TypeScript 编译器 API 而不是正则替换
 *
 * 这个项目里"结果"两个字既是指标符，也出现在注释、界面文案、
 * 甚至对象字面量的**值**里（`{ 标签: '字体大小' }`）。
 * 正则替换会把文案一起改掉——那是最难发现的一类破坏：
 * 代码照样编译，界面上却出现了英文或空字符串。
 *
 * 走 AST 只碰 `Identifier` 节点，字符串与注释天生免疫。
 *
 * ## 已知的边界
 *
 * - 字符串里的键名（`{ '中文键': 1 }`）不会被改。本项目没有这种写法，
 *   但如果有，会在这里表现为"类型对不上"，而不是静默错。
 * - 简写属性 `{ 浏览器 }` 改名后键名跟着变，这是**想要的**行为：
 *   消费端也是同名解构，两边一起改才对。
 *
 * 用法：
 *   node scripts/改英文标识符.mjs           只看统计（dry run）
 *   node scripts/改英文标识符.mjs --应用     真的改
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import ts from 'typescript'

const 根 = process.cwd()
const 要应用 = process.argv.includes('--应用')
const 中文 = /[\u4e00-\u9fff]/

/** 读出对照表。键是中文标识符，值是英文。
 *
 * 支持**多个表文件**（`scripts/改名表*.json`），后加载的同名键覆盖前面的。
 * 这样做是为了能一批一批往里加词，而不必每次重写整张表——
 * 1448 个标识符一趟改不完，分批是这个活唯一可行的推进方式。
 */
const 表目录 = join(根, 'scripts')
const 表文件们 = readdirSync(表目录)
  .filter((名) => /^改名表.*\.json$/.test(名))
  .sort()
const 合并表 = {}
for (const 名 of 表文件们) {
  Object.assign(合并表, JSON.parse(readFileSync(join(表目录, 名), 'utf8')))
}
// 以 `_` 开头的是注释性字段，跳过
const 对照 = Object.fromEntries(
  Object.entries(合并表).filter(([k]) => !k.startsWith('_') && k.trim().length > 0)
)

/**
 * 排除清单：这些标识符**不参与改名**。
 *
 * 它们会进入日志，而 `scripts/verify.mjs` 按中文匹配这些键。改名等于把
 * 断言全部打断——而且失败信息长这样："渲染 水平线：期望 1，实际 缺失"，
 * 界面上一切正常，只有一个数字从 1 变成 0。极难反查。
 *
 * 排除清单单独一个文件，就是为了让这条理由跟着数据走。
 */
let 排除 = {}
try {
  const 原 = JSON.parse(readFileSync(join(表目录, '改名排除.json'), 'utf8'))
  // 注意是 `Object.entries`，不是 `Object.keys`：
  // 喂 keys 数组给 fromEntries 会被当成"字符串可迭代"，
  // 结果每个字符变成一个键，排除清单形同不存在——而且不报错。
  排除 = Object.fromEntries(Object.entries(原).filter(([k]) => !k.startsWith('_')))
} catch {
  // 没有排除清单就不排除
}
let 被排除数 = 0
for (const 名 of Object.keys(排除)) {
  if (对照[名]) {
    delete 对照[名]
    被排除数++
  }
}
console.log(`表文件：${表文件们.join(', ')}  排除：${被排除数} 个`)

function 收集文件(目录, 结果 = []) {
  for (const 名 of readdirSync(目录)) {
    const 全 = join(目录, 名)
    if (statSync(全).isDirectory()) 收集文件(全, 结果)
    else if (/\.tsx?$/.test(全)) 结果.push(全)
  }
  return 结果
}

const 文件们 = 收集文件(join(根, 'src'))

/**
 * 跳过清单：路径里含这些子串的文件**整份不动**。
 *
 * 用来**隔离破坏**：某组改名把功能弄坏、又定位不到是哪一处时，
 * 先把整份文件排除在外，其余全改，验证功能恢复——这样问题就被锁进这几个文件里。
 */
const 跳过的子串 = (process.argv.find((a) => a.startsWith('--跳过=')) ?? '')
  .replace('--跳过=', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function 该跳过(全路径) {
  return 跳过的子串.some((子) => 全路径.includes(子))
}

/** 一个文件里需要做的替换：位置 + 长度 + 新名。 */
function 收集替换(全路径) {
  const 源 = readFileSync(全路径, 'utf8')
  const 树 = ts.createSourceFile(全路径, 源, ts.ScriptTarget.Latest, true)
  const 替换 = []
  const 未映射 = new Map()

  const 访问 = (节点) => {
    if (ts.isIdentifier(节点) && 中文.test(节点.text)) {
      const 新名 = 对照[节点.text]
      if (新名) {
        // 已经是英文就别重复改（幂等，脚本可以反复跑）
        if (新名 !== 节点.text) {
          替换.push({ 起: 节点.getStart(树), 长: 节点.getWidth(树), 新名 })
        }
      } else {
        未映射.set(节点.text, (未映射.get(节点.text) ?? 0) + 1)
      }
    }

    // **字符串里的 `data-<中文>` 也要跟着改。**
    //
    // `dataset.状态 = …` 里的 `状态` 是标识符，会被改；
    // 而 `'.cm-w-diagram[data-状态="完成"]'` 里的 `data-状态` 是**字符串**，
    // AST 碰不到。两边就此错开——元素属性变成了 `data-state`，
    // 选择器还在找 `data-状态`，于是一个都匹配不上。
    //
    // 这个坑的症状特别迷惑：功能明明是好的（实测三个图表都在，
    // 两个出了 SVG、一个出了失败占位），只有计数全是 0。
    // 所以这里只针对 `data-` 前缀做替换，范围窄、不会误伤界面文案。
    if (ts.isStringLiteral(节点)) {
      const 原文 = 节点.text
      const 新文 = 原文.replace(/data-([\u4e00-\u9fff][\u4e00-\u9fff\w]*)/g, (整个, 中名) =>
        对照[中名] ? `data-${对照[中名]}` : 整个
      )
      if (新文 !== 原文) {
        替换.push({
          起: 节点.getStart(树) + 1,
          长: 节点.getWidth(树) - 2,
          新名: 新文
        })
      }
    }

    // **只改"索引访问类型里的属性名"**，例如 `围栏信息['样式']`。
    //
    // 一开始放开成"所有字符串字面量类型"，结果把 `'文本'`、`'文件'` 这类
    // **作为数据值的判别字符串**也改了——它们是 `设置项类型` 这种联合类型
    // 的成员，代表界面上能选的取值，不是属性名。改完立刻是十几个类型错误，
    // 而且语义上完全不该动。
    //
    // 收紧到"父节点是索引访问、且自己就是那个索引"才动。
    if (
      ts.isLiteralTypeNode(节点) &&
      ts.isStringLiteral(节点.literal) &&
      ts.isIndexedAccessTypeNode(节点.parent) &&
      节点.parent.indexType === 节点
    ) {
      const 新名 = 对照[节点.literal.text]
      if (新名) {
        替换.push({
          起: 节点.literal.getStart(树) + 1,
          长: 节点.literal.getWidth(树) - 2,
          新名
        })
      }
    }

    ts.forEachChild(节点, 访问)
  }
  访问(树)

  return { 源, 替换, 未映射 }
}

let 总替换 = 0
const 全局未映射 = new Map()
const 待写 = []

for (const 全路径 of 文件们) {
  if (该跳过(全路径)) continue
  const { 源, 替换, 未映射 } = 收集替换(全路径)
  for (const [k, v] of 未映射) 全局未映射.set(k, (全局未映射.get(k) ?? 0) + v)
  if (替换.length === 0) continue
  总替换 += 替换.length

  // 从后往前改，前面的位置才不会因为长度变化而错位
  替换.sort((a, b) => b.起 - a.起)
  let 新源 = 源
  for (const { 起, 长, 新名 } of 替换) {
    新源 = 新源.slice(0, 起) + 新名 + 新源.slice(起 + 长)
  }
  待写.push({ 全路径, 新源, 数: 替换.length })
}

console.log(`对照表：${Object.keys(对照).length} 条`)
console.log(`将改：${待写.length} 个文件，共 ${总替换} 处`)

const 未 = [...全局未映射.entries()].sort((a, b) => b[1] - a[1])
console.log(`未映射：${未.length} 个标识符，共 ${未.reduce((s, x) => s + x[1], 0)} 处`)
if (未.length > 0) {
  console.log('--- 未映射里出现最多的 40 个 ---')
  for (const [k, v] of 未.slice(0, 40)) console.log(`  ${k}  ${v}`)
}

if (!要应用) {
  console.log('\n（预览模式。加 --应用 才真的写文件）')
  process.exit(0)
}

for (const { 全路径, 新源 } of 待写) writeFileSync(全路径, 新源, 'utf8')
console.log(`\n已写入 ${待写.length} 个文件。`)
