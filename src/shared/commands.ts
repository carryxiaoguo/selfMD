/**
 * 命令注册表。
 *
 * 每个菜单项和键盘操作都是一条带稳定 id 的命令。原生菜单由这份注册表生成，
 * 因此应用菜单同时充当移植进度的实时地图：仍在路线图上的命令会渲染成禁用
 * 状态，而不是被隐藏。
 *
 * 标签全部取自 常见的**简体中文**语言包
 * 。刻意不自己另译：
 * 用户已经对 通行的中文菜单形成肌肉记忆，"源代码模式"、"保持窗口在最前端"、
 * "应用内窗口切换"这类译法照搬，切换成本才是零。
 * 可用 `node scripts/dump-locale.mjs 菜单` 重新导出对照表。
 *
 * 注意 `category` 是内部分组键，不面向用户，故保留英文标识符；
 * 显示名见 `分类显示名`。
 */

export type MenuCategory = 'File' | 'Edit' | 'Paragraph' | 'Format' | 'View' | 'Help'

export interface CommandDef {
  id: string
  label: string
  category: MenuCategory
  /** Electron 的 accelerator 语法；菜单项没有默认快捷键时省略。 */
  accelerator?: string
  /** 为 false 时该项渲染成禁用状态，并列入未完成工作。 */
  implemented: boolean
}

export const COMMANDS: CommandDef[] = [
  // ---------------------------------------------------------------- 文件 ----
  { id: 'file.new', label: '新建', category: 'File', accelerator: 'CmdOrCtrl+N', implemented: true },
  { id: 'file.newWindow', label: '新建窗口', category: 'File', accelerator: 'CmdOrCtrl+Shift+N', implemented: true },
  { id: 'file.open', label: '打开', category: 'File', accelerator: 'CmdOrCtrl+O', implemented: true },
  { id: 'file.openFolder', label: '打开文件夹', category: 'File', accelerator: 'CmdOrCtrl+Shift+O', implemented: true },
  { id: 'file.openQuickly', label: '快速打开', category: 'File', accelerator: 'CmdOrCtrl+P', implemented: true },
  { id: 'file.save', label: '保存', category: 'File', accelerator: 'CmdOrCtrl+S', implemented: true },
  { id: 'file.saveAs', label: '另存为', category: 'File', accelerator: 'CmdOrCtrl+Shift+S', implemented: true },
  { id: 'file.saveAll', label: '保存全部打开的文件', category: 'File', implemented: true },
  { id: 'file.reopenClosed', label: '重新打开关闭的文件', category: 'File', accelerator: 'CmdOrCtrl+Shift+T', implemented: true },
  { id: 'file.duplicate', label: '创建副本', category: 'File', implemented: true },
  { id: 'file.rename', label: '重命名', category: 'File', implemented: true },
  { id: 'file.moveTo', label: '移动到', category: 'File', implemented: true },
  { id: 'file.import', label: '导入', category: 'File', implemented: true },
  { id: 'file.export', label: '导出', category: 'File', implemented: true },
  { id: 'file.exportHtml', label: 'HTML', category: 'File', implemented: true },
  { id: 'file.exportHtmlPlain', label: 'HTML (无样式)', category: 'File', implemented: true },
  { id: 'file.exportPdf', label: 'PDF', category: 'File', implemented: true },
  { id: 'file.exportDocx', label: 'Word (.docx)', category: 'File', implemented: true },
  { id: 'file.exportLatex', label: 'LaTeX', category: 'File', implemented: true },
  { id: 'file.exportEpub', label: 'ePub', category: 'File', implemented: true },
  { id: 'file.exportRtf', label: 'RTF', category: 'File', implemented: true },
  { id: 'file.exportOdt', label: 'OpenDocument (.odt)', category: 'File', implemented: true },
  { id: 'file.exportSetting', label: '导出设置', category: 'File', implemented: true },
  { id: 'file.print', label: '打印', category: 'File', accelerator: 'CmdOrCtrl+Alt+P', implemented: true },
  { id: 'file.preferences', label: '偏好设置', category: 'File', accelerator: 'CmdOrCtrl+,', implemented: true },
  { id: 'file.close', label: '关闭', category: 'File', accelerator: 'CmdOrCtrl+W', implemented: true },
  { id: 'file.quit', label: '退出', category: 'File', accelerator: 'CmdOrCtrl+Q', implemented: true },

  // ---------------------------------------------------------------- 编辑 ----
  { id: 'edit.undo', label: '撤消', category: 'Edit', accelerator: 'CmdOrCtrl+Z', implemented: true },
  { id: 'edit.redo', label: '重做', category: 'Edit', accelerator: 'CmdOrCtrl+Y', implemented: true },
  { id: 'edit.cut', label: '剪切', category: 'Edit', accelerator: 'CmdOrCtrl+X', implemented: true },
  { id: 'edit.copy', label: '复制', category: 'Edit', accelerator: 'CmdOrCtrl+C', implemented: true },
  { id: 'edit.paste', label: '粘贴', category: 'Edit', accelerator: 'CmdOrCtrl+V', implemented: true },
  { id: 'edit.copyAsMarkdown', label: '复制为 Markdown', category: 'Edit', accelerator: 'CmdOrCtrl+Shift+C', implemented: true },
  { id: 'edit.copyAsHtmlCode', label: '复制为 HTML 代码', category: 'Edit', implemented: true },
  { id: 'edit.pasteAsPlainText', label: '粘贴为纯文本', category: 'Edit', accelerator: 'CmdOrCtrl+Shift+V', implemented: true },
  { id: 'edit.selectAll', label: '全选', category: 'Edit', accelerator: 'CmdOrCtrl+A', implemented: true },
  { id: 'edit.selectLineOrSentence', label: '选中当前行或句', category: 'Edit', accelerator: 'CmdOrCtrl+L', implemented: true },
  { id: 'edit.selectWord', label: '选中当前词', category: 'Edit', accelerator: 'CmdOrCtrl+D', implemented: true },
  { id: 'edit.selectBlock', label: '选择段落或块', category: 'Edit', implemented: true },
  { id: 'edit.delete', label: '删除', category: 'Edit', implemented: true },
  { id: 'edit.deleteLine', label: '删除当前行或句', category: 'Edit', accelerator: 'CmdOrCtrl+Shift+D', implemented: true },
  { id: 'edit.find', label: '查找', category: 'Edit', accelerator: 'CmdOrCtrl+F', implemented: true },
  { id: 'edit.findAndReplace', label: '查找和替换', category: 'Edit', accelerator: 'CmdOrCtrl+H', implemented: true },
  { id: 'edit.findNext', label: '查找下一个', category: 'Edit', accelerator: 'F3', implemented: true },
  { id: 'edit.findPrevious', label: '查找上一个', category: 'Edit', accelerator: 'Shift+F3', implemented: true },
  { id: 'edit.copyAsImage', label: '复制为图片', category: 'Edit', implemented: true },
  { id: 'edit.jumpToTop', label: '跳转到文首', category: 'Edit', implemented: true },
  { id: 'edit.jumpToBottom', label: '跳转到文末', category: 'Edit', implemented: true },
  { id: 'edit.jumpToLineStart', label: '跳转到行首', category: 'Edit', implemented: true },
  { id: 'edit.jumpToLineEnd', label: '跳转到行尾', category: 'Edit', implemented: true },
  { id: 'edit.spellCheck', label: '键入时检查拼写', category: 'Edit', implemented: true },
  { id: 'edit.smartPunctuationInput', label: '输入时转换', category: 'Edit', implemented: true },
  { id: 'edit.smartPunctuationRendering', label: '渲染时转换', category: 'Edit', implemented: true },
  { id: 'edit.smartPunctuationOff', label: '关闭智能标点', category: 'Edit', implemented: true },
  { id: 'edit.smartQuotes', label: '智能引号', category: 'Edit', implemented: true },
  { id: 'edit.smartDashes', label: '智能破折号', category: 'Edit', implemented: true },

  // ---------------------------------------------------------------- 段落 ----
  { id: 'para.h1', label: '一级标题', category: 'Paragraph', accelerator: 'CmdOrCtrl+1', implemented: true },
  { id: 'para.h2', label: '二级标题', category: 'Paragraph', accelerator: 'CmdOrCtrl+2', implemented: true },
  { id: 'para.h3', label: '三级标题', category: 'Paragraph', accelerator: 'CmdOrCtrl+3', implemented: true },
  { id: 'para.h4', label: '四级标题', category: 'Paragraph', accelerator: 'CmdOrCtrl+4', implemented: true },
  { id: 'para.h5', label: '五级标题', category: 'Paragraph', accelerator: 'CmdOrCtrl+5', implemented: true },
  { id: 'para.h6', label: '六级标题', category: 'Paragraph', accelerator: 'CmdOrCtrl+6', implemented: true },
  { id: 'para.headingUp', label: '提升标题级别', category: 'Paragraph', accelerator: 'CmdOrCtrl+=', implemented: true },
  { id: 'para.headingDown', label: '降低标题级别', category: 'Paragraph', accelerator: 'CmdOrCtrl+-', implemented: true },
  { id: 'para.table', label: '表格', category: 'Paragraph', accelerator: 'CmdOrCtrl+T', implemented: true },
  { id: 'para.codeFences', label: '代码块', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+K', implemented: true },
  { id: 'para.mathBlock', label: '公式块', category: 'Paragraph', accelerator: 'CmdOrCtrl+Alt+Shift+M', implemented: true },
  { id: 'para.quote', label: '引用', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+Q', implemented: true },
  { id: 'para.orderedList', label: '有序列表', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+[', implemented: true },
  { id: 'para.unorderedList', label: '无序列表', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+]', implemented: true },
  { id: 'para.taskList', label: '任务列表', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+X', implemented: true },
  { id: 'para.indent', label: '增加缩进', category: 'Paragraph', accelerator: 'CmdOrCtrl+]', implemented: true },
  { id: 'para.outdent', label: '减少缩进', category: 'Paragraph', accelerator: 'CmdOrCtrl+[', implemented: true },
  { id: 'para.linkReference', label: '链接引用', category: 'Paragraph', implemented: true },
  { id: 'para.footnotes', label: '脚注', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+E', implemented: true },
  { id: 'para.horizontalLine', label: '水平分割线', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+-', implemented: true },
  { id: 'para.toc', label: '内容目录', category: 'Paragraph', implemented: true },
  { id: 'para.yamlFrontMatter', label: 'YAML 前置元数据', category: 'Paragraph', accelerator: 'CmdOrCtrl+Shift+Y', implemented: true },

  // ---------------------------------------------------------------- 格式 ----
  { id: 'fmt.strong', label: '加粗', category: 'Format', accelerator: 'CmdOrCtrl+B', implemented: true },
  { id: 'fmt.emphasis', label: '斜体', category: 'Format', accelerator: 'CmdOrCtrl+I', implemented: true },
  { id: 'fmt.underline', label: '下划线', category: 'Format', accelerator: 'CmdOrCtrl+U', implemented: true },
  { id: 'fmt.code', label: '代码', category: 'Format', accelerator: 'CmdOrCtrl+Shift+`', implemented: true },
  { id: 'fmt.inlineMath', label: '内联公式', category: 'Format', accelerator: 'CmdOrCtrl+Shift+M', implemented: true },
  { id: 'fmt.strike', label: '删除线', category: 'Format', accelerator: 'Alt+Shift+5', implemented: true },
  { id: 'fmt.highlight', label: '高亮', category: 'Format', implemented: true },
  { id: 'fmt.superscript', label: '上标', category: 'Format', implemented: true },
  { id: 'fmt.subscript', label: '下标', category: 'Format', implemented: true },
  { id: 'fmt.comment', label: '注释', category: 'Format', implemented: true },
  { id: 'fmt.hyperlink', label: '超链接', category: 'Format', accelerator: 'CmdOrCtrl+K', implemented: true },
  { id: 'fmt.image', label: '图像', category: 'Format', accelerator: 'CmdOrCtrl+Shift+I', implemented: true },
  { id: 'fmt.clear', label: '清除样式', category: 'Format', accelerator: 'CmdOrCtrl+\\', implemented: true },

  // ------------------------------------------------------------ 图像工具 ----
  // 标签取自 zh-Hans 语言包的「图像工具」一组。
  { id: 'image.insertLocal', label: '插入本地图片', category: 'Format', implemented: true },
  { id: 'image.insertFromUrl', label: '插入图片', category: 'Format', implemented: true },
  { id: 'image.setFolder', label: '复制图片到文件夹', category: 'Format', implemented: true },
  { id: 'image.useRootPath', label: '设置图片根目录', category: 'Format', implemented: true },
  { id: 'image.upload', label: '上传图片', category: 'Format', implemented: true },
  { id: 'image.uploadAll', label: '上传所有本地图片', category: 'Format', implemented: true },
  // ---------------------------------------------------------------- 视图 ----
  { id: 'view.sourceMode', label: '源代码模式', category: 'View', accelerator: 'CmdOrCtrl+/', implemented: true },
  { id: 'view.livePreview', label: '实时预览', category: 'View', implemented: true },
  { id: 'view.focusMode', label: '专注模式', category: 'View', accelerator: 'F8', implemented: true },
  { id: 'view.typewriterMode', label: '打字机模式', category: 'View', accelerator: 'F9', implemented: true },
  { id: 'view.toggleSidebar', label: '显示／隐藏侧边栏', category: 'View', accelerator: 'CmdOrCtrl+Shift+L', implemented: true },
  { id: 'view.outline', label: '大纲', category: 'View', accelerator: 'CmdOrCtrl+Shift+1', implemented: true },
  { id: 'view.articles', label: '文档列表', category: 'View', accelerator: 'CmdOrCtrl+Shift+2', implemented: true },
  { id: 'view.fileTree', label: '文件树', category: 'View', accelerator: 'CmdOrCtrl+Shift+3', implemented: true },
  { id: 'view.alwaysOnTop', label: '保持窗口在最前端', category: 'View', implemented: true },
  { id: 'view.fullScreen', label: '全屏', category: 'View', accelerator: 'F11', implemented: true },
  { id: 'view.showStatusBar', label: '显示状态栏', category: 'View', implemented: true },
  { id: 'view.actualSize', label: '实际大小', category: 'View', implemented: true },
  { id: 'view.zoomIn', label: '放大', category: 'View', implemented: true },
  { id: 'view.zoomOut', label: '缩小', category: 'View', implemented: true },
  { id: 'view.switchDocument', label: '应用内窗口切换', category: 'View', accelerator: 'CmdOrCtrl+Tab', implemented: true },
  { id: 'view.devTools', label: '开发者工具', category: 'View', accelerator: 'F12', implemented: true },

  // ---------------------------------------------------------------- 主题 ----
  // 标签沿用 zh-Hans 语言包的「主题」一组。
  { id: 'theme.reload', label: '重新加载主题', category: 'View', implemented: true },
  { id: 'theme.editBaseCss', label: '编辑全局自定义 CSS', category: 'View', implemented: true },
  { id: 'theme.editThemeCss', label: '编辑当前主题的自定义 CSS', category: 'View', implemented: true },
  { id: 'theme.create', label: '新建主题', category: 'View', implemented: true },
  { id: 'theme.install', label: '安装主题', category: 'View', implemented: true },
  { id: 'theme.revealFolder', label: '打开主题文件夹', category: 'View', implemented: true },

  // ---------------------------------------------------------------- 帮助 ----
  { id: 'help.defaultApp', label: '设为 Markdown 默认程序', category: 'Help', implemented: true },
  { id: 'help.about', label: '关于', category: 'Help', implemented: true },
  { id: 'help.website', label: '官方网站', category: 'Help', implemented: true },
  { id: 'help.feedback', label: '反馈', category: 'Help', implemented: true }
]

export const COMMAND_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

/** 顶级菜单的显示名，同样取自 zh-Hans 语言包。 */
export const 分类显示名: Record<MenuCategory, string> = {
  File: '文件',
  Edit: '编辑',
  Paragraph: '段落',
  Format: '格式',
  View: '视图',
  Help: '帮助'
}

export function isImplemented(id: string): boolean {
  return COMMAND_BY_ID.get(id)?.implemented ?? false
}

/** 尚未完成的命令，按分类分组——"关于"对话框与进度统计都读它。 */
export function roadmap(): { total: number; done: number; remaining: CommandDef[] } {
  const done = COMMANDS.filter((c) => c.implemented).length
  return {
    total: COMMANDS.length,
    done,
    remaining: COMMANDS.filter((c) => !c.implemented)
  }
}
