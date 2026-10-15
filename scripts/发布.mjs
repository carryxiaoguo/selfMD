/**
 * 把 release 产物发到 GitHub Release。
 *
 * ## 为什么是 .mjs 而不是 .ps1
 *
 * 先写的是 PowerShell 脚本，结果**中文全乱**：Windows 上的 PowerShell 读
 * 没有 BOM 的 `.ps1` 会按系统 ANSI 码页（中文系统是 GBK）解码，
 * 而本项目的编码检查**禁止 BOM**。两者直接冲突。
 *
 * Node 不存在这个问题：源码一律按 UTF-8 读，与文件系统、
 * 与控制台的码页都无关。项目里其他脚本也都是 `.mjs`，保持一致。
 *
 * ## 凭据
 *
 * 取自 git 自己的凭据管理器（`git credential fill`），
 * **不在仓库里存任何明文令牌**——那样仓库里就会躺着一把钥匙。
 *
 * 用法：
 *   node --use-system-ca scripts/发布.mjs --仓库 carryxiaoguo/selfMD --标签 v0.1.0 \
 *     --标题 "selfMD 0.1.0" --说明 release/发布说明.md \
 *     --附件 release/selfMD-0.1.0-setup.exe release/selfMD-0.1.0-portable.zip
 *
 * **`--use-system-ca` 不能省。** Node 默认只信它自带的根证书，而本机网络里
 * 有一层代理，证书链是代理签的——不加这个参数会直接报
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE`。PowerShell 的 `Invoke-RestMethod`
 * 之所以没这个问题，是因为它读 Windows 证书存储。
 *
 * ## 附件名只用 ASCII
 *
 * 中文名经 URL 传给 GitHub 会被打坏（实测「安装程序」变成了一个 `.`），
 * 而 GitHub **不支持重命名附件**，只能删掉重传。与其赌编码，不如一开始就用 ASCII。
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const 参数 = process.argv.slice(2)

/** 读一个 `--名字 值...` 形式的参数；`多值` 为真时收集到下一个选项为止。 */
function 取值(名字, 多值 = false) {
  const 下标 = 参数.indexOf(`--${名字}`)
  if (下标 < 0) return 多值 ? [] : null
  if (!多值) return 参数[下标 + 1] ?? null
  const 结果 = []
  for (let i = 下标 + 1; i < 参数.length && !参数[i].startsWith('--'); i++) 结果.push(参数[i])
  return 结果
}

const 仓库 = 取值('仓库')
const 标签 = 取值('标签')
const 标题 = 取值('标题') ?? 标签
const 说明文件 = 取值('说明')
const 附件 = 取值('附件', true)

if (!仓库 || !标签) {
  console.error('用法：node scripts/发布.mjs --仓库 <owner/repo> --标签 <tag> [--标题 <标题>] [--说明 <文件>] [--附件 <文件...>]')
  process.exit(2)
}

// --- 取令牌 ---------------------------------------------------------------
const 凭据输出 = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8'
})
const 令牌行 = 凭据输出.split('\n').find((行) => 行.startsWith('password='))
const 令牌 = 令牌行?.slice('password='.length).trim()
if (!令牌) {
  console.error('取不到 GitHub 凭据；先确认 `git push` 能成功。')
  process.exit(2)
}

const 头 = {
  authorization: `Bearer ${令牌}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  // HTTP 头只能是 Latin-1，写中文会直接抛
  // "Cannot convert argument to a ByteString"。其余字段用中文没问题，
  // 因为它们在请求体里而不是头部。
  'user-agent': 'selfMD-release-script'
}

async function 取(url) {
  const 响应 = await fetch(url, { headers: 头 })
  if (!响应.ok) throw new Error(`${响应.status} ${await 响应.text()}`)
  return 响应.json()
}

async function 发(url, 体, 方法 = 'POST') {
  const 响应 = await fetch(url, {
    method: 方法,
    headers: { ...头, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(体)
  })
  if (!响应.ok) throw new Error(`${响应.status} ${await 响应.text()}`)
  return 响应.json()
}

// --- 建 Release（已存在就复用）--------------------------------------------
const 说明 = 说明文件 ? readFileSync(resolve(说明文件), 'utf8') : ''
let 发布
try {
  发布 = await 发(`https://api.github.com/repos/${仓库}/releases`, {
    tag_name: 标签,
    name: 标题,
    body: 说明,
    draft: false,
    prerelease: false
  })
  console.log(`已创建 Release ${标签}`)
} catch {
  发布 = await 取(`https://api.github.com/repos/${仓库}/releases/tags/${标签}`)
  console.log(`Release ${标签} 已存在，复用`)
  // 说明有变就更新；没变不折腾
  if (说明 && 发布.body !== 说明) {
    发布 = await 发(`https://api.github.com/repos/${仓库}/releases/${发布.id}`, { body: 说明 }, 'PATCH')
    console.log('已更新说明')
  }
}

console.log(`地址：${发布.html_url}`)

// --- 传附件 ---------------------------------------------------------------
for (const 路径 of 附件) {
  const 全 = resolve(路径)
  // **附件名只用 ASCII。** 中文名经 URL 传递时会被 GitHub 打坏
  // （实测 `安装程序` 变成了一个 `.`），而 GitHub 不支持重命名附件，
  // 只能删掉重传。与其赌编码，不如一开始就用 ASCII。
  const 名字 = basename(全)
  const 大小 = statSync(全).size

  // 同名旧附件要先删，否则 GitHub 报 422
  const 旧 = (发布.assets ?? []).find((a) => a.name === 名字)
  if (旧) {
    await fetch(旧.url, { method: 'DELETE', headers: 头 })
    console.log(`  已删除同名旧附件 ${名字}`)
  }

  console.log(`上传 ${名字}（${(大小 / 1024 / 1024).toFixed(1)} MB）…`)

  // 用流而不是读进内存：便携版压缩包一百多 MB，
  // 一次性读进来会白占一份等量内存。
  const 响应 = await fetch(
    `https://uploads.github.com/repos/${仓库}/releases/${发布.id}/assets?name=${encodeURIComponent(名字)}`,
    {
      method: 'POST',
      headers: { ...头, 'content-type': 'application/octet-stream' },
      body: createReadStream(全),
      duplex: 'half',
      // 大文件上传可能超过默认超时
      signal: AbortSignal.timeout(30 * 60 * 1000)
    }
  )
  if (!响应.ok) {
    console.error(`  ❌ ${响应.status} ${await 响应.text()}`)
    continue
  }
  const 结果 = await 响应.json()
  console.log(`  ✅ ${(结果.size / 1024 / 1024).toFixed(1)} MB  ${结果.browser_download_url}`)
}

console.log('\n全部完成。')
