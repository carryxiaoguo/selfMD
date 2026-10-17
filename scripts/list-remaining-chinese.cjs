// 导出「还没被对照表覆盖」的中文标识符，按出现次数排序。
// 只统计真实的 Identifier 节点，不数注释与字符串。
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const 表 = {}
for (const f of fs.readdirSync('scripts').filter((n) => /^rename-map.*\.json$/.test(n))) {
  Object.assign(表, JSON.parse(fs.readFileSync(path.join('scripts', f), 'utf8')))
}
const 排除 = {}
try {
  Object.assign(排除, JSON.parse(fs.readFileSync('scripts/rename-exclude.json', 'utf8')))
} catch {
  /* 没有排除清单 */
}

const 中文 = /[\u4e00-\u9fff]/

const 文件 = []
;(function 走(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) 走(p)
    else if (/\.ts$/.test(p)) 文件.push(p)
  }
})('src')

const 计 = new Map()
let 跳过文件 = 0
for (const f of 文件) {
  if (f.includes('图表字段')) {
    跳过文件++
    continue
  }
  const s = fs.readFileSync(f, 'utf8')
  const t = ts.createSourceFile(f, s, ts.ScriptTarget.Latest, true)
  ;(function 访(n) {
    if (ts.isIdentifier(n) && 中文.test(n.text) && !表[n.text] && !排除[n.text]) {
      计.set(n.text, (计.get(n.text) || 0) + 1)
    }
    ts.forEachChild(n, 访)
  })(t)
}

const 项 = [...计.entries()].sort((a, b) => b[1] - a[1])
console.log(`扫描 ${文件.length} 个文件（跳过 ${跳过文件} 个），未映射 ${项.length} 个标识符`)
fs.writeFileSync('.git/剩余.txt', 项.map(([k, v]) => `${k} ${v}`).join('\n'), 'utf8')
console.log('已写出 .git/剩余.txt')
console.log('--- 前 100 个 ---')
console.log(项.slice(0, 100).map(([k, v]) => `${k}=${v}`).join('  '))
