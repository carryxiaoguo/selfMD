/**
 * 解析树转储工具。
 *
 * 装饰层是按 Lezer 语法树的节点名分派的，节点名写错会静默失效——
 * 不报错、不生效，最难排查。所以在实现块级装饰之前，先把真实节点名 dump 出来。
 *
 * 用法：node scripts/dump-tree.mjs fixtures/块级语法.md
 */
import { readFileSync } from 'node:fs'
import { parser } from '@lezer/markdown'
import { GFM } from '@lezer/markdown'

const 文件 = process.argv[2]
if (!文件) {
  console.error('用法：node scripts/dump-tree.mjs <markdown 文件>')
  process.exit(2)
}

const 文本 = readFileSync(文件, 'utf8')
const 解析器 = parser.configure(GFM)
const 树 = 解析器.parse(文本)

const 行号表 = []
{
  let 起点 = 0
  const 行数组 = 文本.split('\n')
  for (const 行 of 行数组) {
    行号表.push(起点)
    起点 += 行.length + 1
  }
}
function 取行号(位置) {
  let 低 = 0
  let 高 = 行号表.length - 1
  while (低 < 高) {
    const 中 = Math.ceil((低 + 高) / 2)
    if (行号表[中] <= 位置) 低 = 中
    else 高 = 中 - 1
  }
  return 低 + 1
}

/** 收集"从根到该节点的路径"，用于区分同名节点在不同上下文中的含义。 */
const 出现次数 = new Map()

console.log(`文件：${文件}`)
console.log(`长度：${文本.length} 字符`)
console.log('')
console.log('深度  节点名                          位置区间           行     片段')
console.log('----  ------------------------------  -----------------  -----  --------------------')

树.iterate({
  enter(节点) {
    const 深度 = 节点.node.parent ? 计算深度(节点.node) : 0
    const 片段 = 文本.slice(节点.from, 节点.to).replace(/\n/g, '⏎')
    const 显示片段 = 片段.length > 34 ? 片段.slice(0, 34) + '…' : 片段
    出现次数.set(节点.name, (出现次数.get(节点.name) ?? 0) + 1)
    console.log(
      `${String(深度).padStart(4)}  ${节点.name.padEnd(30)}  ${String(节点.from).padStart(6)}..${String(节点.to).padEnd(7)}  ${String(取行号(节点.from)).padStart(5)}  ${显示片段}`
    )
  }
})

function 计算深度(节点) {
  let 深度 = 0
  let 当前 = 节点.parent
  while (当前) {
    深度 += 1
    当前 = 当前.parent
  }
  return 深度
}

console.log('')
console.log('=== 节点名汇总（按出现次数倒序）===')
for (const [名, 次数] of [...出现次数.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(次数).padStart(4)}  ${名}`)
}
