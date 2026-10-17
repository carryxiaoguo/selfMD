/**
 * 把中文文件名改成英文，并连带改掉所有 import 路径。
 *
 * ## 为什么单独写一个脚本
 *
 * 改标识符那个脚本走 TS 的 AST，只碰 `Identifier` 节点——**模块路径是字符串**，
 * 它碰不到。而 import 路径写错的表现是"文件找不到"，构建期就炸，
 * 好在不会静默错；但十六个文件连带几十处 import，手工改必漏。
 *
 * 这里用 AST 找 `ImportDeclaration` / `ExportDeclaration` 的模块说明符，
 * 只改**说明符本身**，注释和普通字符串一律不动。
 *
 * ## 顺序
 *
 * 先把文件移到位，再改引用。反过来的话中间态没法解析路径。
 * 用 `git mv` 而不是 `mv`，历史才连得上。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import ts from 'typescript'

const 根 = process.cwd()

/** 旧路径 → 新文件名（不含扩展名）。目录不动，只改文件名。 */
const 对照 = {
  'src/main/export/图片.ts': 'image.ts',
  'src/main/services/文件关联.ts': 'file-association.ts',
  'src/main/util/资源路径.ts': 'resource-path.ts',
  'src/renderer/src/editor/live-preview/图表字段.ts': 'diagram-field.ts',
  'src/renderer/src/editor/live-preview/数学字段.ts': 'math-field.ts',
  'src/renderer/src/editor/本地化.ts': 'localization.ts',
  'src/renderer/src/editor/独立撤销.ts': 'isolated-undo.ts',
  'src/renderer/src/editor/表格.ts': 'table.ts',
  'src/renderer/src/image/上传.ts': 'upload.ts',
  'src/renderer/src/image/图片操作.ts': 'image-ops.ts',
  'src/renderer/src/image/显示地址.ts': 'display-src.ts',
  'src/renderer/src/services/标签.ts': 'tabs.ts',
  'src/renderer/src/ui/上下文菜单.ts': 'context-menu.ts',
  'src/renderer/src/ui/快速打开.ts': 'quick-open.ts',
  'src/shared/代码块信息.ts': 'code-block-info.ts',
  'src/shared/数学.ts': 'math.ts',
  'src/shared/模糊匹配.ts': 'fuzzy.ts'
}

// --- 1. 移文件 -------------------------------------------------------------
let 移动数 = 0
for (const [旧, 新名] of Object.entries(对照)) {
  const 全旧 = join(根, 旧)
  const 全新 = join(dirname(全旧), 新名)
  if (!existsSync(全旧)) {
    console.log(`跳过（不存在）：${旧}`)
    continue
  }
  mkdirSync(dirname(全新), { recursive: true })
  execFileSync('git', ['mv', 旧, join(dirname(旧), 新名).replace(/\\/g, '/')], {
    cwd: 根,
    stdio: 'inherit'
  })
  移动数++
}
console.log(`已移动 ${移动数} 个文件`)

/** 旧基名 → 新基名（不含扩展名）。 */
const 基名对照 = Object.fromEntries(
  Object.entries(对照).map(([旧, 新]) => [basename(旧, '.ts'), basename(新, '.ts')])
)

// --- 2. 改 import 路径 -----------------------------------------------------
function 收集文件(目录, 结果 = []) {
  for (const 名 of readdirSync(目录)) {
    const 全 = join(目录, 名)
    if (statSync(全).isDirectory()) 收集文件(全, 结果)
    else if (/\.ts$/.test(全)) 结果.push(全)
  }
  return 结果
}

let 改了引用 = 0
let 涉及文件 = 0

for (const 全路径 of 收集文件(join(根, 'src'))) {
  const 源 = readFileSync(全路径, 'utf8')
  const 树 = ts.createSourceFile(全路径, 源, ts.ScriptTarget.Latest, true)
  const 替换 = []

  const 处理 = (节点) => {
    const 说明符 = 节点.moduleSpecifier
    if (!说明符 || !ts.isStringLiteral(说明符)) return
    const 原文 = 说明符.text
    // 只处理"以某个旧基名结尾"的路径：`./表格`、`../shared/数学`、`@shared/数学`
    const 匹配 = /^(.*\/)?([^/]+)$/.exec(原文)
    if (!匹配) return
    const 新基名 = 基名对照[匹配[2]]
    if (!新基名) return
    替换.push({
      起: 说明符.getStart(树) + 1,
      长: 说明符.getWidth(树) - 2,
      新名: (匹配[1] ?? '') + 新基名
    })
  }

  const 访问 = (节点) => {
    if (ts.isImportDeclaration(节点) || ts.isExportDeclaration(节点)) 处理(节点)
    ts.forEachChild(节点, 访问)
  }
  访问(树)

  if (替换.length === 0) continue
  替换.sort((a, b) => b.起 - a.起)
  let 新源 = 源
  for (const { 起, 长, 新名 } of 替换) 新源 = 新源.slice(0, 起) + 新名 + 新源.slice(起 + 长)
  writeFileSync(全路径, 新源, 'utf8')
  改了引用 += 替换.length
  涉及文件 += 1
}

console.log(`已改 import 路径 ${改了引用} 处，涉及 ${涉及文件} 个文件`)
