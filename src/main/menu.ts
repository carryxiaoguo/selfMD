import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'
import { COMMANDS, isImplemented, roadmap, 分类显示名, type CommandDef } from '@shared/commands'
import { EV } from '@shared/ipc'
import { 生效主题 } from '@shared/types'
import { listRecent } from './services/recent'
import { listThemes } from './services/themes'
import { getSettings } from './services/settings'
import { 图标路径 } from './util/资源路径'

/**
 * 原生应用菜单。
 *
 * 由共享的命令注册表生成，使结构、标签和快捷键只存在一处。
 * 尚未移植的命令渲染为禁用状态，这让菜单成为未完成工作的实时清单，
 * 而不是一堆静默失效的操作。
 */

function send(commandId: string, args?: unknown): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send(EV.menuCommand, { command: commandId, args })
}

function toItem(c: CommandDef, override?: Partial<MenuItemConstructorOptions>): MenuItemConstructorOptions {
  return {
    id: c.id,
    label: c.label,
    accelerator: c.accelerator,
    enabled: isImplemented(c.id),
    click: () => send(c.id),
    ...override
  }
}

function pick(category: CommandDef['category'], id: string): CommandDef {
  const found = COMMANDS.find((c) => c.id === id && c.category === category)
  if (!found) throw new Error(`[menu] unknown command: ${id}`)
  return found
}

function recentSubmenu(): MenuItemConstructorOptions[] {
  const entries = listRecent().slice(0, 15)
  if (entries.length === 0) {
    // "空"是 zh-Hans 语言包对 No Recent Files 的译法。
    return [{ label: '空', enabled: false }]
  }
  const items: MenuItemConstructorOptions[] = entries.map((e) => ({
    label: e.pinned ? `📌 ${e.path}` : e.path,
    toolTip: e.path,
    click: () => send('file.openPath', e.path)
  }))
  items.push({ type: 'separator' })
  items.push({
    label: '清除最近文件',
    enabled: true,
    click: () => {
      send('file.clearRecent')
      rebuildMenu()
    }
  })
  return items
}

function themesSubmenu(): MenuItemConstructorOptions[] {
  const settings = getSettings()
  const themes = listThemes()
  const 亮色 = settings.theme
  const 深色 = settings.darkTheme

  // 单选组要反映"当前生效的那一个"：开了深色模式就用深色槽位的选中状态，
  // 否则用户会看到菜单勾在浅色主题上、屏幕上却是深色。
  const 当前生效 = 生效主题(settings)

  const items: MenuItemConstructorOptions[] = themes.map((t) => ({
    label: t.name,
    type: 'radio',
    checked: 当前生效 === t.id,
    click: () => send('theme.apply', t.id)
  }))

  items.push({ type: 'separator' })
  items.push({
    label: '浅色模式使用',
    submenu: themes.map((t) => ({
      label: t.name,
      type: 'radio',
      checked: 亮色 === t.id,
      click: () => send('theme.setSlot', { slot: 'light', id: t.id })
    }))
  })
  items.push({
    label: '深色模式使用',
    submenu: themes.map((t) => ({
      label: t.name,
      type: 'radio',
      checked: 深色 === t.id,
      click: () => send('theme.setSlot', { slot: 'dark', id: t.id })
    }))
  })
  items.push({
    label: '深色模式使用独立主题',
    type: 'checkbox',
    checked: settings.useSeparateDarkTheme,
    click: () => send('theme.toggleSeparateDark')
  })
  items.push({ type: 'separator' })
  items.push(toItem(pick('View', 'theme.reload')))
  items.push(toItem(pick('View', 'theme.editBaseCss')))
  items.push(toItem(pick('View', 'theme.editThemeCss')))
  items.push({ type: 'separator' })
  items.push(toItem(pick('View', 'theme.create')))
  items.push(toItem(pick('View', 'theme.install')))
  items.push(toItem(pick('View', 'theme.revealFolder')))

  return items
}

/**
 * Pandoc 是否可用。
 *
 * 菜单构建是同步的，而探测 Pandoc 要跑一个子进程，所以只能先在启动时探测一次、
 * 拿到结果后重建菜单。默认 false：没探测出来之前把 Word 等置灰，
 * 比点亮了却点不动要好——后者用户会以为软件坏了。
 */
let 有Pandoc = false

/** 启动时探测到结果后调用，然后重建菜单。 */
export function 设置Pandoc可用(可用: boolean): void {
  有Pandoc = 可用
}

/**
 * 导出子菜单。
 *
 * HTML 与 PDF **一定可用**（自己渲染 + Chromium 打印，不需要外部程序）；
 * Word / LaTeX / ePub 等依赖 Pandoc，检测不到就置灰。
 *
 * 置灰而不是隐藏：用户看不到 Word 会以为软件没这个功能，
 * 看到它灰着并附一句说明，才知道"装了 Pandoc 就能用"。
 */
function 导出子菜单(): MenuItemConstructorOptions[] {
  const 项 = (id: string, 可用 = true): MenuItemConstructorOptions => {
    const 定义 = pick('File', id)
    return {
      // 带上命令 id，菜单摘要才能从注册表读出真实实现状态
      id,
      label: 定义.label,
      accelerator: 定义.accelerator,
      enabled: 可用,
      click: () => send(id)
    }
  }

  const 结果: MenuItemConstructorOptions[] = [
    项('file.exportHtml'),
    项('file.exportPdf'),
    { type: 'separator' },
    项('file.exportDocx', 有Pandoc),
    项('file.exportLatex', 有Pandoc),
    项('file.exportEpub', 有Pandoc),
    项('file.exportRtf', 有Pandoc),
    项('file.exportOdt', 有Pandoc),
    { type: 'separator' },
    项('file.exportHtmlPlain')
  ]

  if (!有Pandoc) {
    结果.push({ type: 'separator' }, { label: '安装 Pandoc 后可用 Word 等格式', enabled: false })
  }

  return 结果
}

function fileMenu(): MenuItemConstructorOptions {
  return {
    label: 分类显示名.File,
    submenu: [
      toItem(pick('File', 'file.new')),
      toItem(pick('File', 'file.newWindow')),
      toItem(pick('File', 'file.open')),
      toItem(pick('File', 'file.openFolder')),
      { label: '打开最近文件', submenu: recentSubmenu() },
      toItem(pick('File', 'file.openQuickly')),
      toItem(pick('File', 'file.reopenClosed')),
      { type: 'separator' },
      toItem(pick('File', 'file.save')),
      toItem(pick('File', 'file.saveAs')),
      toItem(pick('File', 'file.saveAll')),
      { type: 'separator' },
      toItem(pick('File', 'file.duplicate')),
      toItem(pick('File', 'file.rename')),
      toItem(pick('File', 'file.moveTo')),
      { type: 'separator' },
      toItem(pick('File', 'file.import')),
      { label: '导出', submenu: 导出子菜单() },
      toItem(pick('File', 'file.print')),
      { type: 'separator' },
      toItem(pick('File', 'file.preferences')),
      toItem(pick('File', 'file.close')),
      { type: 'separator' },
      toItem(pick('File', 'file.quit'), {
        click: () => {
          app.quit()
        }
      })
    ]
  }
}

function editMenu(): MenuItemConstructorOptions {
  // 剪切 / 复制 / 粘贴使用 Electron 的 role，而不是绕一圈到渲染进程：
  // role 直接作用于获得焦点的 webContents，从而保留原生剪贴板行为
  // （富文本粘贴、输入法、选区手势）。
  return {
    label: 分类显示名.Edit,
    submenu: [
      toItem(pick('Edit', 'edit.undo')),
      toItem(pick('Edit', 'edit.redo')),
      { type: 'separator' },
      {
        role: 'cut',
        label: pick('Edit', 'edit.cut').label,
        accelerator: pick('Edit', 'edit.cut').accelerator
      },
      {
        role: 'copy',
        label: pick('Edit', 'edit.copy').label,
        accelerator: pick('Edit', 'edit.copy').accelerator
      },
      {
        role: 'paste',
        label: pick('Edit', 'edit.paste').label,
        accelerator: pick('Edit', 'edit.paste').accelerator
      },
      toItem(pick('Edit', 'edit.pasteAsPlainText')),
      toItem(pick('Edit', 'edit.copyAsMarkdown')),
      toItem(pick('Edit', 'edit.copyAsHtmlCode')),
      toItem(pick('Edit', 'edit.copyAsImage')),
      { type: 'separator' },
      toItem(pick('Edit', 'edit.selectAll')),
      toItem(pick('Edit', 'edit.selectLineOrSentence')),
      toItem(pick('Edit', 'edit.selectWord')),
      toItem(pick('Edit', 'edit.selectBlock')),
      toItem(pick('Edit', 'edit.delete')),
      toItem(pick('Edit', 'edit.deleteLine')),
      { type: 'separator' },
      toItem(pick('Edit', 'edit.find')),
      toItem(pick('Edit', 'edit.findAndReplace')),
      { type: 'separator' },
      toItem(pick('Edit', 'edit.jumpToTop')),
      toItem(pick('Edit', 'edit.jumpToBottom')),
      toItem(pick('Edit', 'edit.jumpToLineStart')),
      toItem(pick('Edit', 'edit.jumpToLineEnd')),
      { type: 'separator' },
      { label: '智能标点', submenu: smartPunctuationSubmenu() },
      toItem(pick('Edit', 'edit.spellCheck'))
    ]
  }
}

/**
 * 智能标点子菜单。
 *
 * 结构沿用通行做法：一个"何时转换"的单选（输入时 / 渲染时 / 关闭），
 * 加上两个"转换什么"的复选框。两者正交——只勾引号不勾破折号是完全合理的用法。
 */
function smartPunctuationSubmenu(): MenuItemConstructorOptions[] {
  const s = getSettings()
  return [
    {
      label: pick('Edit', 'edit.smartPunctuationInput').label,
      type: 'checkbox',
      checked: s.smartPunctuationMode === 'input',
      click: () => send('edit.smartPunctuationInput')
    },
    toItem(pick('Edit', 'edit.smartPunctuationRendering')),
    { type: 'separator' },
    {
      label: pick('Edit', 'edit.smartQuotes').label,
      type: 'checkbox',
      checked: s.smartQuotes,
      click: () => send('edit.smartQuotes')
    },
    {
      label: pick('Edit', 'edit.smartDashes').label,
      type: 'checkbox',
      checked: s.smartDashes,
      click: () => send('edit.smartDashes')
    }
  ]
}

function paragraphMenu(): MenuItemConstructorOptions {
  return {
    label: 分类显示名.Paragraph,
    submenu: [
      toItem(pick('Paragraph', 'para.h1')),
      toItem(pick('Paragraph', 'para.h2')),
      toItem(pick('Paragraph', 'para.h3')),
      toItem(pick('Paragraph', 'para.h4')),
      toItem(pick('Paragraph', 'para.h5')),
      toItem(pick('Paragraph', 'para.h6')),
      toItem(pick('Paragraph', 'para.headingUp')),
      toItem(pick('Paragraph', 'para.headingDown')),
      { type: 'separator' },
      toItem(pick('Paragraph', 'para.table')),
      toItem(pick('Paragraph', 'para.codeFences')),
      toItem(pick('Paragraph', 'para.mathBlock')),
      toItem(pick('Paragraph', 'para.quote')),
      { type: 'separator' },
      toItem(pick('Paragraph', 'para.orderedList')),
      toItem(pick('Paragraph', 'para.unorderedList')),
      toItem(pick('Paragraph', 'para.taskList')),
      { type: 'separator' },
      toItem(pick('Paragraph', 'para.indent')),
      toItem(pick('Paragraph', 'para.outdent')),
      { type: 'separator' },
      toItem(pick('Paragraph', 'para.linkReference')),
      toItem(pick('Paragraph', 'para.footnotes')),
      toItem(pick('Paragraph', 'para.horizontalLine')),
      toItem(pick('Paragraph', 'para.toc')),
      toItem(pick('Paragraph', 'para.yamlFrontMatter'))
    ]
  }
}

function formatMenu(): MenuItemConstructorOptions {
  return {
    label: 分类显示名.Format,
    submenu: [
      toItem(pick('Format', 'fmt.strong')),
      toItem(pick('Format', 'fmt.emphasis')),
      toItem(pick('Format', 'fmt.underline')),
      toItem(pick('Format', 'fmt.code')),
      toItem(pick('Format', 'fmt.inlineMath')),
      { type: 'separator' },
      toItem(pick('Format', 'fmt.strike')),
      toItem(pick('Format', 'fmt.highlight')),
      toItem(pick('Format', 'fmt.superscript')),
      toItem(pick('Format', 'fmt.subscript')),
      toItem(pick('Format', 'fmt.comment')),
      { type: 'separator' },
      toItem(pick('Format', 'fmt.hyperlink')),
      toItem(pick('Format', 'fmt.image')),
      { type: 'separator' },
      { label: '图像工具', submenu: 图像工具子菜单() },
      { type: 'separator' },
      toItem(pick('Format', 'fmt.clear'))
    ]
  }
}

/** 图像工具子菜单。结构对应 zh-Hans 语言包的「图像工具」一组。 */
function 图像工具子菜单(): MenuItemConstructorOptions[] {
  const s = getSettings()
  return [
    toItem(pick('Format', 'image.insertLocal')),
    toItem(pick('Format', 'image.insertFromUrl')),
    { type: 'separator' },
    {
      // 复选状态直接反映文档级设置是否存在，用户一眼能看出当前这篇文档的图片去哪。
      label: pick('Format', 'image.setFolder').label,
      type: 'checkbox',
      checked: false,
      click: () => send('image.toggleFolder')
    },
    {
      label: pick('Format', 'image.useRootPath').label,
      type: 'checkbox',
      checked: false,
      click: () => send('image.toggleRootPath')
    },
    { type: 'separator' },
    toItem(pick('Format', 'image.upload')),
    toItem(pick('Format', 'image.uploadAll')),
    { type: 'separator' },
    {
      label: '全局图片设置',
      submenu: [
        {
          label: '插入时不做特殊处理',
          type: 'radio',
          checked: s.imageStoragePolicy === '',
          click: () => send('image.setPolicy', '')
        },
        {
          label: '复制到当前文件夹',
          type: 'radio',
          checked: s.imageStoragePolicy === 'folder',
          click: () => send('image.setPolicy', 'folder')
        },
        {
          label: '复制到 ./assets',
          type: 'radio',
          checked: s.imageStoragePolicy === 'assets',
          click: () => send('image.setPolicy', 'assets')
        },
        {
          label: '复制到 ./${filename}.assets',
          type: 'radio',
          checked: s.imageStoragePolicy === 'per-file-assets',
          click: () => send('image.setPolicy', 'per-file-assets')
        },
        {
          label: '复制到自定义文件夹',
          type: 'radio',
          checked: s.imageStoragePolicy === 'custom',
          click: () => send('image.setPolicy', 'custom')
        },
        { type: 'separator' },
        {
          label: '允许依据文档设置自动上传',
          type: 'checkbox',
          checked: s.allowImageUpload,
          click: () => send('image.toggleAllowUpload')
        }
      ]
    }
  ]
}

function viewMenu(): MenuItemConstructorOptions {
  const settings = getSettings()
  return {
    label: 分类显示名.View,
    submenu: [
      {
        label: pick('View', 'view.sourceMode').label,
        type: 'checkbox',
        checked: !settings.livePreview,
        accelerator: pick('View', 'view.sourceMode').accelerator,
        click: () => send('view.sourceMode')
      },
      {
        label: pick('View', 'view.livePreview').label,
        type: 'checkbox',
        checked: settings.livePreview,
        click: () => send('view.livePreview')
      },
      toItem(pick('View', 'view.focusMode')),
      toItem(pick('View', 'view.typewriterMode')),
      { type: 'separator' },
      toItem(pick('View', 'view.toggleSidebar')),
      toItem(pick('View', 'view.outline')),
      toItem(pick('View', 'view.articles')),
      toItem(pick('View', 'view.fileTree')),
      { type: 'separator' },
      {
        label: '主题',
        submenu: themesSubmenu()
      },
      { type: 'separator' },
      toItem(pick('View', 'view.alwaysOnTop'), {
        type: 'checkbox',
        click: (menuItem) => send('view.alwaysOnTop', menuItem.checked)
      }),
      toItem(pick('View', 'view.fullScreen'), {
        type: 'checkbox',
        click: (menuItem) => send('view.fullScreen', menuItem.checked)
      }),
      {
        label: pick('View', 'view.showStatusBar').label,
        type: 'checkbox',
        checked: settings.showStatusBar,
        click: () => send('view.showStatusBar')
      },
      { type: 'separator' },
      toItem(pick('View', 'view.actualSize')),
      toItem(pick('View', 'view.zoomIn')),
      toItem(pick('View', 'view.zoomOut')),
      { type: 'separator' },
      toItem(pick('View', 'view.switchDocument')),
      toItem(pick('View', 'view.devTools'))
    ]
  }
}

function helpMenu(): MenuItemConstructorOptions {
  return {
    role: 'help',
    label: 分类显示名.Help,
    submenu: [
      toItem(pick('Help', 'help.about'), {
        click: () => {
          const win = BrowserWindow.getFocusedWindow()
          if (!win) return
          const { total, done } = roadmap()
          const 图标 = 图标路径('icon-128.png')
          void dialog.showMessageBox(win, {
            type: 'info',
            title: '关于 selfMD',
            message: 'selfMD',
            // 有图标就带上；缺失时退回系统默认图标，不影响对话框本身。
            ...(图标 ? { icon: 图标 } : {}),
            detail:
              `版本 ${app.getVersion()}\n` +
              `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}\n\n` +
              '一款所见即所得的 Markdown 编辑器。\n' +
              '纯文本为唯一数据源：所有渲染都只是叠加在 Markdown 之上的视图层，\n' +
              '保存到磁盘的永远是原始文本。\n\n' +
              `命令进度：${done} / ${total} 已实现（菜单中呈灰色的项尚未完成）。`,
            buttons: ['确定']
          })
        }
      }),
      toItem(pick('Help', 'help.website')),
      toItem(pick('Help', 'help.feedback'))
    ]
  }
}

export function rebuildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    fileMenu(),
    editMenu(),
    paragraphMenu(),
    formatMenu(),
    viewMenu(),
    helpMenu()
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * 导出当前应用菜单的文本结构。
 *
 * 用途是**验证**：原生菜单是操作系统绘制的，无头测试截不到图，也就无法断言
 * "菜单确实是中文"。把它导出成文本，冒烟测试里就能逐条对账，中文化是否真的
 * 生效不再依赖肉眼。
 */
export function 菜单摘要(): string[] {
  const 行: string[] = []
  const 菜单 = Menu.getApplicationMenu()
  if (!菜单) return ['（未设置应用菜单）']

  /**
   * 递归展开子菜单：嵌套项（例如"智能标点"里的四个开关）同样要接受中文化检查。
   *
   * "未实现"与"暂不可用"必须分开报：
   *   - **未实现**：命令还没做（注册表里 implemented: false），菜单项灰着
   *   - **暂不可用**：命令已经做了，只是当前环境跑不了
   *     （例如没装 Pandoc 时的 Word 导出）
   *
   * 一开始两者都写成"未实现"，于是"装了 Pandoc 就能用"的功能在验证日志里
   * 显示成没做——断言会因此失去意义。实现状态一律从注册表读，不看 enabled。
   */
  const 展开 = (项: Electron.MenuItem, 层: number): void => {
    const 标签 = 项.label || 项.role || '(无标题)'
    const 键 = 项.accelerator ? `  [${项.accelerator}]` : ''
    const 是命令 = Boolean(项.id)
    let 态 = ''
    if (是命令) {
      if (!isImplemented(项.id)) 态 = '  ← 未实现'
      else if (!项.enabled) 态 = '  ← 暂不可用'
    }
    行.push(`${' '.repeat(6 + (层 - 1) * 4)}${标签}${键}${态}`)
    if (项.submenu) {
      for (const 子 of 项.submenu.items) {
        if (子.type !== 'separator') 展开(子, 层 + 1)
      }
    }
  }

  for (const 顶层 of 菜单.items) {
    const 子项 = 顶层.submenu?.items ?? []
    const 非分隔 = 子项.filter((i) => i.type !== 'separator')
    const 已启用 = 非分隔.filter((i) => i.enabled).length
    行.push(`${顶层.label || 顶层.role || '(无标题)'}（${已启用}/${非分隔.length} 可用）`)

    for (const 子 of 非分隔) 展开(子, 1)
  }
  return 行
}
