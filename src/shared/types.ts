/**
 * main / preload / renderer 之间共享的领域类型。
 *
 * 命名与结构参照主流 Markdown 编辑器的通行做法
 * （分析记录见 `rea/`），但代码是一份独立实现。
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
export type 上传器类型 =
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
  fontSize: number
  fontFamily: string | null
  monospaceFontFamily: string | null
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
  imageUploader: 上传器类型
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

  // --- 外观 ----------------------------------------------------------------
  theme: string
  darkTheme: string
  useSeparateDarkTheme: boolean
  isDarkMode: boolean
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
  fontSize: 16,
  fontFamily: null,
  monospaceFontFamily: null,
  lineHeight: 1.6,
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

  theme: 'github',
  darkTheme: 'github-dark',
  useSeparateDarkTheme: false,
  isDarkMode: false,
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
export function 生效主题(设置: Settings): string {
  if (设置.isDarkMode && 设置.useSeparateDarkTheme) return 设置.darkTheme
  return 设置.theme
}

/**
 * 一份自动保存的草稿。
 *
 * 恢复界面靠这些字段判断"要不要提示用户"：草稿比原文件新才提示；
 * 内容长度一致则视为没改动——纯粹时间戳造成的差异不值得打扰用户。
 */
export interface 草稿信息 {
  /** 草稿键，用于定位与删除。 */
  键: string
  /** 原文档路径；未保存的文档为 null。 */
  原路径: string | null
  /** 草稿写入时间（毫秒）。 */
  保存时间: number
  /** 原文件最后修改时间；文件不存在时为 null。 */
  原文件时间: number | null
  /** 原文件的字符数；读不到时为 null。 */
  原文件字符数: number | null
  /** 草稿内容的字符数。 */
  草稿字符数: number
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
