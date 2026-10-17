import { app, shell } from 'electron'
import { execFileSync } from 'node:child_process'

/**
 * Markdown 文件关联。
 *
 * ## 为什么安装程序改不了"默认程序"
 *
 * Windows 10 之前，安装程序往 `HKCU\Software\Classes\.md` 写一个默认值
 * 就能把某个程序设成 `.md` 的默认打开方式。Win10 起不行了：真正生效的是
 * `HKCU\...\FileExts\.md\UserChoice`，而它带一个**防止程序擅自修改的校验值**，
 * 只能由用户在系统设置里亲自选。
 *
 * 所以这里能做的是三件事，而不是"一键设为默认"：
 *
 *   1. 安装时注册 ProgID 与 ShellNew（见 `build/markdown-assoc.nsh`），
 *      让 selfMD 出现在「打开方式」里、「新建」菜单里有「Markdown 文档」
 *   2. **报告当前状态**——用户以为设好了、其实没有，是最常见的误会
 *   3. 把用户送到系统设置的那一页。那是唯一可靠的办法，绕不过去
 */

export interface 关联状态 {
  /** 系统里 `.md` 当前生效的打开方式（ProgID 或可执行文件名）。 */
  current: string
  /** 是否就是本程序。 */
  isDefaultFlag: boolean
  /** 是否已注册「新建」菜单项。 */
  有新建菜单: boolean
}

const extension = '.md'
const 本程序ProgId = 'selfMD.md'

/** 读一个注册表值；不存在或读不到时返回空串。 */
function 读注册表(key: string, value: string): string {
  if (process.platform !== 'win32') return ''
  try {
    const output = execFileSync('reg', ['query', key, '/v', value], {
      encoding: 'utf8',
      windowsHide: true,
      // 键不存在时 reg 会以非零码退出并打到 stderr，这里静默当空处理
      stdio: ['ignore', 'pipe', 'ignore']
    })
    // 形如：`    (默认)    REG_SZ    selfMD.md`
    const line = output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith(value) || l.startsWith('(默认)'))
    if (!line) return ''
    const segment = line.split(/\s{2,}/)
    return (segment[segment.length - 1] ?? '').trim()
  } catch {
    return ''
  }
}

/** 查某个注册表键是否存在。 */
function 键存在(key: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    execFileSync('reg', ['query', key], { windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * 当前关联状态。
 *
 * 判断"是不是默认"要**同时看两处**：
 *   - `FileExts\.md\UserChoice`（Win10+ 真正生效的地方）
 *   - `Classes\.md` 的默认值（老机制，UserChoice 不存在时才起作用）
 *
 * 只看后者会得出错误结论：明明用户在设置里选了别的程序，
 * `Classes\.md` 可能还指着 selfMD。
 */
export function 取关联状态(): 关联状态 {
  const 用户选择 = 读注册表(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${extension}\\UserChoice`, 'ProgId')
  const 类默认 = 读注册表(`HKCU\\Software\\Classes\\${extension}`, '(默认)')
  const current = 用户选择 || 类默认

  return {
    current,
    isDefaultFlag: current === 本程序ProgId,
    有新建菜单: 键存在(`HKCU\\Software\\Classes\\${extension}\\ShellNew`)
  }
}

/** 打开系统的"默认应用"设置页。 */
export async function 打开默认应用设置(): Promise<void> {
  if (process.platform !== 'win32') return
  // 这是 Windows 自己的 URI scheme，会拉起「设置 → 应用 → 默认应用」。
  // 不给更深的锚点：那个页面的锚点在不同 Windows 版本上不一样，
  // 写死一个在某些版本上会打开一个空白页。
  await shell.openExternal('ms-settings:defaultapps')
}

/** 让资源管理器重新读一遍关联（改完注册表后不刷新会看不到变化）。 */
export function 通知外壳刷新(): void {
  if (process.platform !== 'win32') return
  try {
    // SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)
    // 用 PowerShell 调 shell32，避免为这一次调用引入原生模块
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -Namespace W -Name S -MemberDefinition \'[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);\'; [W.S]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)'
      ],
      { windowsHide: true, stdio: 'ignore', timeout: 8000 }
    )
  } catch {
    // 刷新失败无关紧要，Explorer 迟早会自己重读
  }
}

/** 本程序可执行文件的路径，供界面显示"关联到哪个程序"。 */
export function 本程序路径(): string {
  return app.getPath('exe')
}
