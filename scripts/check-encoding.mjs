/**
 * 编码检查。
 *
 * 校验项目内所有文本文件：必须是合法 UTF-8、不带 BOM、且不含 U+FFFD
 * （替换字符 = 乱码的确凿标志）。
 *
 * 为什么需要它：本项目大量文件含中文，而中文一旦在写入或读取环节走错编码，
 * 结果不是报错而是**静默变成乱码**。加上这个检查，乱码会在验证阶段被拦住，
 * 而不是等用户打开界面才发现。
 *
 * 用法：node scripts/check-encoding.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 项目根 = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 不参与检查的目录：第三方依赖、构建产物、外部证据（含二进制）。 */
const 跳过目录 = ['node_modules', 'out', 'dist', '.git', 'evidence']

/**
 * 按前缀跳过的目录。
 *
 * 构建产物的目录名是 electron-builder 决定的，换一次输出目录就多一个
 * （`release2` 就漏过一次，结果一整个 Chromium 的 LICENSE 文件被当成本项目
 * 的源码来检查，报了 78 个"乱码"）。用前缀匹配，以后换名字也不会漏。
 */
const 跳过前缀 = ['release']

/** 参与检查的文本扩展名。 */
const 文本扩展 = /\.(ts|tsx|js|mjs|cjs|md|css|json|html|yaml|yml|txt)$/

const 文件列表 = []
function 遍历(目录) {
  for (const 项 of readdirSync(目录, { withFileTypes: true })) {
    if (跳过目录.includes(项.name)) continue
    if (跳过前缀.some((pre) => 项.name.startsWith(pre))) continue
    const 全 = join(目录, 项.name)
    if (项.isDirectory()) 遍历(全)
    else if (文本扩展.test(项.name) || 项.name === '.gitignore') 文件列表.push(全)
  }
}
遍历(项目根)

const 异常 = []
let 含中文 = 0
const 解码器 = new TextDecoder('utf-8', { fatal: true })

for (const 文件 of 文件列表) {
  const 字节 = readFileSync(文件)
  const 相对 = relative(项目根, 文件)

  // BOM 会让某些工具/脚本把首行当成内容的一部分，本项目一律不用。
  const 有BOM = 字节[0] === 0xef && 字节[1] === 0xbb && 字节[2] === 0xbf

  let 文本
  try {
    文本 = 解码器.decode(字节)
  } catch {
    异常.push(`${相对}：不是合法 UTF-8`)
    continue
  }

  const 替换字符数 = (文本.match(/\uFFFD/g) ?? []).length
  if (/[\u4e00-\u9fff]/.test(文本)) 含中文 += 1

  if (有BOM) 异常.push(`${相对}：带有 UTF-8 BOM`)
  if (替换字符数 > 0) 异常.push(`${相对}：含 ${替换字符数} 个替换字符（乱码）`)
  // 行尾符混用会让 diff 噪声很大，这里一并报出来。
  if (/\r\n/.test(文本) && /(?<!\r)\n/.test(文本)) {
    异常.push(`${相对}：CRLF 与 LF 行尾符混用`)
  }
}

console.log('=== 编码检查 ===')
console.log('')
console.log(`检查 ${文件列表.length} 个文件，其中含中文 ${含中文} 个`)
console.log('')

if (异常.length === 0) {
  console.log('✅ 全部为合法 UTF-8，无 BOM，无乱码，行尾符一致')
  process.exit(0)
}

console.log(`❌ ${异常.length} 个文件有问题：`)
for (const 项 of 异常) console.log('   · ' + 项)
process.exit(1)
