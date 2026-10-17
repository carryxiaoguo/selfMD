/**
 * 快速预览：构建并刷新免安装目录，**不生成安装包**。
 *
 * ## 为什么需要它
 *
 * 完整打包（`pnpm build` + electron-builder 出 NSIS）要一两分钟，
 * 而每次只想看一眼改动，那一两分钟纯属浪费。
 *
 * 这个脚本走 electron-builder 的 `--dir` 模式：同样产出
 * `release/win-unpacked/`，但跳过 NSIS 安装程序那一大段压缩。
 * 目录里的 `selfMD.exe` 可以直接双击运行，**不需要安装**。
 *
 * 用法：
 *   node scripts/preview.mjs           只构建
 *   node scripts/preview.mjs --启动     构建完顺手把程序拉起来
 *
 * 之后每次改完代码跑一次，程序窗口关掉重开就是最新的。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const 根 = process.cwd()
const 要启动 = process.argv.includes('--启动')

/**
 * 保证 PATH 上有 `pnpm`。
 *
 * electron-builder 即使面对一个**没有生产依赖**的项目，也要调 pnpm 去枚举
 * 依赖树；PATH 上没有 pnpm 时它会以 `spawnSync pnpm ENOENT` 失败，
 * 而报错信息埋在几十行堆栈里，很难看出真实原因。
 *
 * 这里自己造一个 shim：找得到 pnpm 就包一层，找不到就退回 PATH。
 * 用户不必知道这些，跑一条命令就行。
 */
function 准备Pnpm() {
  const 候选 = [
    // 随 DSH 一起装的 pnpm
    join(
      process.env.USERPROFILE ?? '',
      '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs'
    ),
    // 全局 npm 装的
    join(process.env.APPDATA ?? '', 'npm/node_modules/pnpm/bin/pnpm.mjs')
  ]
  const 找到 = 候选.find((p) => existsSync(p))
  if (!找到) return process.env.PATH

  const 目录 = join(tmpdir(), 'selfmd-预览')
  mkdirSync(目录, { recursive: true })
  // Windows 上必须是 .cmd：PATH 查找按 PATHEXT 来，没有扩展名的文件不认
  writeFileSync(
    join(目录, 'pnpm.cmd'),
    `@echo off\r\n"${process.execPath}" "${找到}" %*\r\n`,
    'utf8'
  )
  return `${目录};${process.env.PATH}`
}

/**
 * 跑一个 Node 写的 CLI。
 *
 * **不调 `pnpm`，也不调 `npx`。** 它们不一定在 PATH 上——这台机器上就没有，
 * 直接 spawn 会报 `spawnSync pnpm ENOENT`。改成用当前这个 node 解释器
 * 去跑 `node_modules` 里真正的入口文件，只依赖仓库里确实存在的东西。
 */
const 跑CLI = (入口, 参数) => {
  execFileSync(process.execPath, [join(根, 入口), ...参数], {
    cwd: 根,
    stdio: 'inherit',
    env: {
      ...process.env,
      // 镜像不是可选项：本机网络里有一层代理，走默认源会报
      // `unable to verify the first certificate`。写在这里，
      // 用户不必自己记这两个变量。
      ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
      ELECTRON_BUILDER_BINARIES_MIRROR:
        'https://npmmirror.com/mirrors/electron-builder-binaries/',
      // 从 DSH 的 shell 继承过来时，Electron 会把自己当成纯 Node 跑，
      // 报 `bad option: --smoke-test` 之类的怪错。必须清掉。
      ELECTRON_RUN_AS_NODE: '',
      PATH: 准备Pnpm()
    }
  })
}

console.log('=== 1/2 构建渲染层与主进程 ===')
跑CLI('node_modules/electron-vite/bin/electron-vite.js', ['build'])

console.log('\n=== 2/2 刷新免安装目录（跳过安装包） ===')
跑CLI('node_modules/electron-builder/out/cli/cli.js', ['--win', '--dir'])

const 程序 = join(根, 'release', 'win-unpacked', 'selfMD.exe')
if (!existsSync(程序)) {
  console.error(`\n没有找到 ${程序}，构建可能失败了。`)
  process.exit(1)
}

console.log(`\n完成。免安装版在：${程序}`)
console.log('直接双击它就能看最新改动，不需要装。')

if (要启动) {
  console.log('\n正在启动…')
  // `detached` + `unref`：让程序独立于本脚本活着，脚本退出不会带走它
  spawn(程序, [], { detached: true, stdio: 'ignore' }).unref()
}
