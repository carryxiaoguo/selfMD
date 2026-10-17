/**
 * main / preload / renderer 之间共享的领域类型。
 *
 * 命名与结构参照主流 Markdown 编辑器的通行做法，
 * 但代码是一份独立实现。
 */

// ---------------------------------------------------------------------------
// 平台
// ---------------------------------------------------------------------------

/** 与 Node 自身的联合类型保持一致，这样 `process.platform` 无需类型断言即可赋值，
 *  同时让共享代码不必依赖 @types/node。 */
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

// ---------------------------------------------------------------------------
// 文档
// ---------------------------------------------------------------------------

/** 插入图片时图片应放置的位置。对应 通行的
 *  `File.option.defaultImageStorage` 取值空间（见 §3.1）。 */
export type ImageStoragePolicy =
  | '' // 不做特殊处理
  | 'folder' // <docdir>
  | 'assets' // <docdir>/assets
  | 'per-file-assets' // <docdir>/<name>.assets
  | 'custom' // customImageSaveLocation，支持 ${filename}
  | 'upload' // 交给外部上传器处理

/**
 * 图床上传器的类型。
 *
 * 取值与 从上传器命令表  提取的命令表一一对应。
 * `picgo-app` 与 `piclist-app` 是**哨兵值**：它们不走命令行，而是先试本地 HTTP
 * 端点 `http://127.0.0.1:36677/upload`，失败再启动应用后重试。
 */
export type uploaderType =
  | 'none'
  | 'picgo-app'
  | 'piclist-app'
  | 'upic'
  | 'picsee'
  | 'picgo-cli'
  | 'custom'

export interface DocumentIdentity {
  /** 磁盘上的绝对路径；未命名文档为 null。 */
  path: string | null
  /** 显示名称；未保存时采用 "Untitled" 风格。 */
  name: string
  /** 存在未保存修改时为 true。 */
  dirty: boolean
}

export interface FileStat {
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
  mtimeMs: number
  /** 仅在操作系统报告的编码时存在；用于"以指定编码重新打开"。 */
  encodingHint?: string
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  mtimeMs: number
}

// ---------------------------------------------------------------------------
// 设置（持久化到 <userData>/conf/conf.user.json，JSONC）
// ---------------------------------------------------------------------------

export interface Settings {
  // --- 编辑器 ---------------------------------------------------------------
  /**
   * 正文字号（px）。**0 表示跟随主题。**
   *
   * 用 0 作哨兵而不是拿 16 当"默认值"：主题也要定字号（书籍主题要更大的
   * 字号与行距），而内联样式优先级高于样式表——只要这里永远写一个具体数，
   * 主题定的字号就永远被盖掉，表现为"换了主题只是颜色变了、排版没变"。
   */
  fontSize: number
  fontFamily: string | null
  monospaceFontFamily: string | null
  /** 行高。**0 表示跟随主题**，理由同 `fontSize`。 */
  lineHeight: number
  /** 在源码视图中对长行自动折行。 */
  autoWrapLongLines: boolean
  /** 对应 “段落首行缩进”。 */
  indentFirstLine: boolean
  /** 渲染时保留单个换行符。 */
  preserveSingleLineBreak: boolean
  /** 让 <br/> 可见。 */
  visibleBr: boolean
  /** 按字面渲染空白与换行。 */
  strictMarkdown: boolean
  tabSize: number
  useShiftTabToIndentCode: boolean
  /** 为 true 时 Shift+Tab 对选中代码自动缩进，为 false 时反缩进。 */
  autoLinks: boolean
  /** 隐藏光标所在块之外那部分 Markdown 语法标记。 */
  livePreview: boolean
  focusMode: boolean
  typewriterMode: boolean

  // --- 智能标点 --------------------------------------------------------------
  smartQuotes: boolean
  smartDashes: boolean
  smartPunctuationMode: 'none' | 'input' | 'rendering'
  remapUnicodePunctuationOnParse: boolean

  // --- 图片 ---------------------------------------------------------------
  /** 插入图片时首选的图片语法。 */
  preferredImageSyntax: 'markdown' | 'html'
  imageStoragePolicy: ImageStoragePolicy
  customImageSaveLocation: string
  applyImageMoveForLocal: boolean
  applyImageMoveForWeb: boolean
  useRelativePathForImg: boolean
  relativePathWithDot: boolean
  autoEscapeImageURL: boolean
  allowImageUpload: boolean
  noWarningUploadDisabled: boolean
  /** 图床上传器的类型。从 通行的 `getImageUploaderCommand` 提取。 */
  imageUploader: uploaderType
  /** PicGo / PicList 应用可执行文件的路径（本地 HTTP 不通时用它启动）。 */
  picgoPath: string
  /** 自定义上传命令；支持 `${filepath}` 与 `${filename}` 占位符。 */
  customImageUploader: string

  // --- 文件 ----------------------------------------------------------------
  defaultFileExtension: string
  /** 启动时恢复上次打开的文件 / 文件夹。 */
  onLaunch: 'newFile' | 'restoreFolders' | 'restoreFilesAndFolders' | 'customFolder'
  customLaunchFolder: string
  quitWhenLastWindowClosed: boolean
  recordRecentFiles: boolean
  autoSave: boolean

  // --- 拼写检查 --------------------------------------------------------------
  /**
   * 是否启用拼写检查。
   *
   * 由 Chromium 自带的拼写检查器完成——它提供红波浪线与"建议替换"菜单，
   * 不必自己实现词典与算法。**代价是词典由 Chromium 提供**，
   * 中文没有可用的拼写词典，所以这项只对西文有意义（这也是默认关闭的原因：
   * 中文用户开着它只会看到满屏红波浪线）。
   */
  spellCheck: boolean
  /** 启用的语言，取值见 Chromium 支持的列表（如 `en-US`、`en-GB`）。 */
  spellCheckLanguages: string[]

  // --- 导出 ------------------------------------------------------------------
  /**
   * 导出的 HTML 里是否附带侧边目录。
   *
   * 默认开：导出的 HTML 常常是给人看的，没有目录的长文很难导航。
   */
  exportIncludeOutline: boolean
  /**
   * 是否把本地图片内嵌成 base64，做成单文件。
   *
   * 默认关：内嵌会让文件大出好几倍，而个人使用时图片通常就在同一个目录里。
   * 需要发给别人时再打开。
   */
  exportEmbedImages: boolean

  // --- 外观 ----------------------------------------------------------------
  theme: string
  darkTheme: string
  useSeparateDarkTheme: boolean
  isDarkMode: boolean
  /**
   * 侧边栏的显示策略。
   *
   * 三态而不是一个布尔值：
   *   - `always` 始终显示——快捷键与菜单都关不掉它
   *   - `never`  始终隐藏——同样改不了
   *   - `toggle` 可自由切换（默认），切换结果记在 `sidebarVisible` 里
   *
   * 为什么需要"始终"这两档：侧边栏占着 260px 宽，写长文时有人想让它彻底
   * 消失、且**不该被一次误按快捷键叫回来**；也有人反过来，把文件树当作
   * 常驻导航，不希望手滑把它关了。这两种需求用"记住上次状态"都表达不了。
   */
  sidebarMode: 'always' | 'never' | 'toggle'
  /** `sidebarMode` 为 `toggle` 时记住的可见状态；另外两档下这个值被忽略。 */
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarTab: 'outline' | 'files' | 'articles'
  outlineHighlightCurrentHeader: boolean
  outlineCollapsible: boolean
  showStatusBar: boolean
  zoomLevel: number
  /** 菜单标签 -> accelerator，用于覆盖默认值。 */
  keyBinding: Record<string, string>

  // --- Markdown 变体 --------------------------------------------------------
  mathAutoNumbering: 'none' | 'ams' | 'all'
  enablePhysicsPackage: boolean
  enableInlineMath: boolean
  enableCodeBlockMath: boolean
  mermaidEnabled: boolean

  // --- 杂项 -----------------------------------------------------------------
  pandocPath: string
  defaultCodeLanguage: string
  readingSpeed: number
  language: 'en' | 'zh-Hans'
}

export const DEFAULT_SETTINGS: Settings = {
  // 0 = 跟随主题。主题理应能决定正文的排版（书籍主题要更大字号、更松行距），
  // 而内联样式压得过任何样式表——所以"我不表态"必须是可表达的。
  fontSize: 0,
  fontFamily: null,
  monospaceFontFamily: null,
  lineHeight: 0,
  autoWrapLongLines: true,
  indentFirstLine: false,
  preserveSingleLineBreak: false,
  visibleBr: false,
  strictMarkdown: false,
  tabSize: 4,
  useShiftTabToIndentCode: true,
  autoLinks: true,
  livePreview: true,
  focusMode: false,
  typewriterMode: false,

  smartQuotes: false,
  smartDashes: false,
  smartPunctuationMode: 'none',
  remapUnicodePunctuationOnParse: false,

  preferredImageSyntax: 'markdown',
  imageStoragePolicy: '',
  customImageSaveLocation: './${filename}',
  applyImageMoveForLocal: true,
  applyImageMoveForWeb: false,
  useRelativePathForImg: true,
  relativePathWithDot: false,
  autoEscapeImageURL: true,
  allowImageUpload: false,
  noWarningUploadDisabled: false,
  imageUploader: 'none',
  picgoPath: '',
  customImageUploader: '',

  defaultFileExtension: '.md',
  onLaunch: 'restoreFilesAndFolders',
  customLaunchFolder: '',
  quitWhenLastWindowClosed: false,
  recordRecentFiles: true,
  autoSave: false,

  spellCheck: false,
  spellCheckLanguages: ['en-US'],

  exportIncludeOutline: true,
  exportEmbedImages: false,

  // 默认用「月之亮面」而不是「黄皮纸」：默认值应当中性，
  // 黄皮纸的衬线正文与暖色纸底是很强的风格主张，更适合按需选。
  theme: 'moon-light',
  darkTheme: 'moon-dark',
  useSeparateDarkTheme: false,
  isDarkMode: false,
  sidebarMode: 'toggle',
  sidebarVisible: true,
  sidebarWidth: 260,
  sidebarTab: 'outline',
  outlineHighlightCurrentHeader: true,
  outlineCollapsible: true,
  showStatusBar: true,
  zoomLevel: 1,
  keyBinding: {},

  mathAutoNumbering: 'none',
  enablePhysicsPackage: false,
  enableInlineMath: true,
  enableCodeBlockMath: true,
  mermaidEnabled: true,

  pandocPath: '',
  defaultCodeLanguage: '',
  readingSpeed: 240,
  language: 'zh-Hans'
}

// ---------------------------------------------------------------------------
// 主题
// ---------------------------------------------------------------------------

export interface ThemeInfo {
  /** 不含扩展名的文件名，例如 "github"。 */
  id: string
  name: string
  /** .css 文件的绝对路径。 */
  path: string
  /** 启发式判定：内容中声明了深色配色方案的主题。 */
  isDark: boolean
  builtin: boolean
}

/**
 * 当前实际生效的主题 id。
 *
 * 由「是否深色模式」与「是否使用独立深色主题」共同决定。主进程与渲染层都要用，
 * 所以放在共享层——两边各写一份，迟早会在某个分支上分叉。
 */
export function activeTheme(settings: Settings): string {
  if (settings.isDarkMode && settings.useSeparateDarkTheme) return settings.darkTheme
  return settings.theme
}

/**
 * 侧边栏此刻该不该显示。
 *
 * 收在一处而不是散着写 `settings.sidebarVisible`：有三档模式之后，
 * 任何一处漏掉模式判断，就会出现"设了始终显示、某个入口还是能关掉它"
 * 这种自相矛盾的状态。所有需要判断的地方都调这个函数。
 */
export function sidebarShown(settings: Settings): boolean {
  if (settings.sidebarMode === 'always') return true
  if (settings.sidebarMode === 'never') return false
  return settings.sidebarVisible
}

/** 侧边栏是否被策略锁住（锁住时切换命令应当说明原因，而不是默默无效）。 */
export function sidebarLocked(settings: Settings): boolean {
  return settings.sidebarMode !== 'toggle'
}

/**
 * 一份自动保存的草稿。
 *
 * 恢复界面靠这些字段判断"要不要提示用户"：草稿比原文件新才提示；
 * 内容长度一致则视为没改动——纯粹时间戳造成的差异不值得打扰用户。
 */
export interface DraftInfo {
  /** 草稿键，用于定位与删除。 */
  key: string
  /** 原文档路径；未保存的文档为 null。 */
  rawPath: string | null
  /** 草稿写入时间（毫秒）。 */
  savedAt: number
  /** 原文件最后修改时间；文件不存在时为 null。 */
  originalMtime: number | null
  /** 原文件的字符数；读不到时为 null。 */
  originalCharCount: number | null
  /** 草稿内容的字符数。 */
  draftChars: number
}

// ---------------------------------------------------------------------------
// 最近打开的文件 / 位置
// ---------------------------------------------------------------------------

export interface RecentEntry {
  path: string
  /** 上次打开的时间戳（毫秒）；用于排序。 */
  openedAt: number
  pinned: boolean
}
