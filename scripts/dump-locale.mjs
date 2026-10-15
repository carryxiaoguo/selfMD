/**
 * 导出台文本地化对照表。
 *
 * 用途：从任意一份 lproj / JSON 语言包里把键值对照打出来，
 * 便于按需取用界面文案，避免自己翻译得与用户已经形成的肌肉记忆不一致。
 *
 * **源目录与文件名都从命令行传入**，不写死在脚本里：
 * 一是不把某一份资源的内部结构固化进本仓库，
 * 二是同一份脚本可以读任意语言包。
 *
 * 用法：
 *   node scripts/dump-locale.mjs <语言包目录> <文件名> [过滤词] [--keys=a,b,c]
 *
 * 例：
 *   node scripts/dump-locale.mjs ./某语言包 菜单.json 导出
 *   node scripts/dump-locale.mjs ./某语言包 界面.json --keys=Untitled,Save
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const 源目录 = process.argv[2]
const 文件名 = process.argv[3]
const 过滤 = process.argv[4] ?? ''
/** `--keys=a,b,c` 只输出指定的键，用于按需取少量文案。 */
const 指定键参数 = process.argv.find((a) => a.startsWith('--keys='))
const 指定键 = 指定键参数 ? 指定键参数.slice('--keys='.length).split(',') : null

if (!源目录 || !文件名) {
  console.error('用法：node scripts/dump-locale.mjs <语言包目录> <文件名> [过滤词] [--keys=a,b,c]')
  process.exit(1)
}

const 路径 = join(resolve(源目录), 文件名)

let 数据
try {
  数据 = JSON.parse(readFileSync(路径, 'utf8'))
} catch (错误) {
  console.error(`读不出「${路径}」：${错误 instanceof Error ? 错误.message : String(错误)}`)
  process.exit(1)
}

if (typeof 数据 !== 'object' || 数据 === null || Array.isArray(数据)) {
  console.error('该文件不是一个简单的键值对照表。')
  process.exit(1)
}

const 全部键 = Object.keys(数据)
console.log(`文件：${路径}`)
console.log(`共 ${全部键.length} 条`)
console.log()

// 指定键时按给定顺序输出；否则全量输出，可用过滤词筛
const 待输出 = 指定键
  ? 指定键.filter((键) => 键 in 数据)
  : 全部键.filter((键) => (过滤 ? 键.includes(过滤) || String(数据[键]).includes(过滤) : true))

let 命中 = 0
for (const 键 of 待输出) {
  console.log(`${键}\t→\t${数据[键]}`)
  命中++
}

if (指定键) {
  const 缺失 = 指定键.filter((键) => !(键 in 数据))
  if (缺失.length > 0) console.log(`\n未找到：${缺失.join('、')}`)
}

console.log(`\n共输出 ${命中} 条`)
