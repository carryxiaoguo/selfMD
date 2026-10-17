import { DEFAULT_SETTINGS, type Settings } from './types'

/**
 * 偏好设置的声明式描述。
 *
 * 界面不硬编码任何一项，而是照着这张表渲染。这样做的直接好处是
 * **"表里的键是不是真的存在"可以被断言**——写成 `livePreveiw` 这种笔误时，
 * 界面照样画得出来、点下去毫无反应，靠肉眼几乎发现不了。
 * `scripts/verify.mjs` 里有一条断言专门比对这里的每一个键都在 `Settings` 里。
 *
 * 文案沿用 Markdown 编辑器里通行的中文译法，分组结构为：
 * 通用 / 编辑器 / 图片 / 保存与恢复 / 导出。
 */

export type 设置项类型 = '开关' | '下拉' | '数字' | '文本' | '列表'

export interface SettingItem {
  /** 必须是 Settings 的键。 */
  key: keyof Settings
  kind: 设置项类型
  label: string
  /** 灰色小字说明。 */
  description?: string
   /** 下拉/列表的可选项。 */
  options?: { value: string; text: string }[]
  minValue?: number
  maxValue?: number
  stepSize?: number
  /** 数值与文本项的单位后缀。 */
  unit?: string
}

export interface 设置小节 {
  /** 小节标题；同一分区里连续的小节可以省略标题，靠视觉间距分组。 */
  title?: string
  description?: string
  item: SettingItem[]
}

export interface 设置分区 {
  title: string
  subsection: 设置小节[]
}

/** 各分区的中文标题。 */
export const PrefsSchema: 设置分区[] = [
  {
    title: '通用',
    subsection: [
      {
        item: [
          {
            key: 'theme',
            kind: '文本',
            label: '当前主题',
            description: '在「视图 → 主题」里切换；这里显示当前生效的主题 id。'
          },
          {
            key: 'useSeparateDarkTheme',
            kind: '开关',
            label: '深色模式使用独立主题'
          },
          {
            key: 'outlineHighlightCurrentHeader',
            kind: '开关',
            label: '大纲高亮当前标题'
          },
          {
            key: 'outlineCollapsible',
            kind: '开关',
            label: '允许折叠和展开侧边栏的大纲视图'
          }
        ]
      },
      {
        title: '字体',
        item: [
          {
            key: 'fontSize',
            kind: '数字',
            label: '字体大小',
            unit: 'px',
            minValue: 0,
            maxValue: 32,
            stepSize: 1,
            description: '填 0 表示跟随主题——主题会按自己的气质定正文字号。'
          },
          {
            key: 'lineHeight',
            kind: '数字',
            label: '行高',
            minValue: 0,
            maxValue: 3,
            stepSize: 0.05,
            description: '填 0 表示跟随主题。'
          },
          {
            key: 'fontFamily',
            kind: '文本',
            label: '正文字体',
            description: '留空则跟随主题。可填多个字体名，用逗号分隔。'
          },
          {
            key: 'monospaceFontFamily',
            kind: '文本',
            label: '等宽字体',
            description: '用于代码块与行内代码。留空则跟随主题。'
          }
        ]
      },
      {
        title: '其他',
        item: [
          {
            key: 'showStatusBar',
            kind: '开关',
            label: '显示状态栏'
          },
          {
            key: 'zoomLevel',
            kind: '数字',
            label: '缩放',
            unit: '%',
            minValue: 50,
            maxValue: 300,
            stepSize: 10
          }
        ]
      }
    ]
  },
  {
    title: '编辑器',
    subsection: [
      {
        item: [
          {
            key: 'livePreview',
            kind: '开关',
            label: '即时渲染',
            description: '开启后只显示光标所在块的 Markdown 源码，其余部分渲染显示。'
          },
          {
            key: 'focusMode',
            kind: '开关',
            label: '专注模式',
            description: '只让光标所在的块保持清晰，其余淡化。'
          },
          {
            key: 'typewriterMode',
            kind: '开关',
            label: '打字机模式',
            description: '光标行始终停留在屏幕垂直中央。'
          }
        ]
      },
      {
        title: '输入',
        item: [
          {
            key: 'tabSize',
            kind: '数字',
            label: 'Tab 宽度',
            unit: '空格',
            minValue: 1,
            maxValue: 12,
            stepSize: 1
          },
          {
            key: 'autoWrapLongLines',
            kind: '开关',
            label: '长行自动折行'
          },
          {
            key: 'autoLinks',
            kind: '开关',
            label: '自动识别链接',
            description: '输入网址后自动转成链接。'
          },
          {
            key: 'smartQuotes',
            kind: '开关',
            label: '智能引号',
            description: '把直引号转成中文弯引号。'
          },
          {
            key: 'smartDashes',
            kind: '开关',
            label: '智能破折号',
            description: '把连续短横转成破折号。'
          },
          {
            key: 'smartPunctuationMode',
            kind: '下拉',
            label: '智能标点触发方式',
            options: [
              { value: 'none', text: '关闭' },
              { value: 'input', text: '输入时转换' },
              { value: 'rendering', text: '渲染时转换' }
            ]
          }
        ]
      },
      {
        title: 'Markdown 语法',
        item: [
          {
            key: 'strictMarkdown',
            kind: '开关',
            label: '严格模式',
            description: '更严格地遵循 GFM 标准。'
          },
          {
            key: 'indentFirstLine',
            kind: '开关',
            label: '段落首行缩进'
          },
          {
            key: 'preserveSingleLineBreak',
            kind: '开关',
            label: '保留单个换行'
          },
          {
            key: 'visibleBr',
            kind: '开关',
            label: '显示换行标记'
          },
          {
            key: 'defaultFileExtension',
            kind: '下拉',
            label: '默认文件扩展名',
            options: [
              { value: '.md', text: '.md' },
              { value: '.markdown', text: '.markdown' },
              { value: '.mdown', text: '.mdown' },
              { value: '.txt', text: '.txt' }
            ]
          }
        ]
      }
    ]
  },
  {
    title: '图片',
    subsection: [
      {
        item: [
          {
            key: 'imageStoragePolicy',
            kind: '下拉',
            label: '插入图片时的行为',
            description: '文档里的 image-folder 会覆盖这一项。',
            options: [
              { value: '', text: '不做特殊处理' },
              { value: 'folder', text: '复制到当前文件夹' },
              { value: 'assets', text: '复制到 ./assets' },
              { value: 'per-file-assets', text: '复制到 ./${filename}.assets' },
              { value: 'custom', text: '复制到自定义文件夹' },
              { value: 'upload', text: '上传到图床' }
            ]
          },
          {
            key: 'customImageSaveLocation',
            kind: '文本',
            label: '自定义文件夹',
            description: '仅在上一项选「复制到自定义文件夹」时生效。可以是相对路径。'
          },
          {
            key: 'useRelativePathForImg',
            kind: '开关',
            label: '优先使用相对路径'
          },
          {
            key: 'relativePathWithDot',
            kind: '开关',
            label: '相对路径以 ./ 开头'
          },
          {
            key: 'autoEscapeImageURL',
            kind: '开关',
            label: '自动转义图片地址',
            description: '只转义会破坏解析的字符（空白、井号等），中文保持原样可读。'
          },
          {
            key: 'preferredImageSyntax',
            kind: '下拉',
            label: '默认图片语法',
            options: [
              { value: 'markdown', text: 'Markdown' },
              { value: 'html', text: 'HTML' }
            ]
          },
          {
            key: 'allowImageUpload',
            kind: '开关',
            label: '允许依据文档设置自动上传'
          }
        ]
      },
      {
        title: '图床',
        description: '上传委托给外部程序。PicGo / PicList 走本地端点，其余走命令行。',
        item: [
          {
            key: 'imageUploader',
            kind: '下拉',
            label: '上传器',
            options: [
              { value: 'none', text: '不使用' },
              { value: 'picgo-app', text: 'PicGo (应用)' },
              { value: 'piclist-app', text: 'PicList (应用)' },
              { value: 'picgo-cli', text: 'PicGo (命令行)' },
              { value: 'upic', text: 'uPic' },
              { value: 'picsee', text: 'Picsee' },
              { value: 'custom', text: '自定义命令' }
            ]
          },
          {
            key: 'picgoPath',
            kind: '文本',
            label: 'PicGo / PicList 路径',
            description:
              '本地端点连不上时用它启动应用，等 5 秒后重试一次。' +
              '若应用已在运行可以留空。'
          },
          {
            key: 'customImageUploader',
            kind: '文本',
            label: '自定义上传命令',
            description:
              '支持 ${filepath} 与 ${filename} 占位符。' +
              '命令的输出里应当包含图片地址（每行一个）。'
          }
        ]
      }
    ]
  },
  {
    title: '保存与恢复',
    subsection: [
      {
        item: [
          {
            key: 'autoSave',
            kind: '开关',
            label: '自动保存',
            description: '停止输入 3 秒后把内容写入草稿目录。'
          },
          {
            key: 'recordRecentFiles',
            kind: '开关',
            label: '记录最近打开的文件'
          },
          {
            key: 'quitWhenLastWindowClosed',
            kind: '开关',
            label: '关闭最后一个窗口时退出'
          }
        ]
      },
      {
        title: '启动行为',
        item: [
          {
            key: 'onLaunch',
            kind: '下拉',
            label: '启动时',
            options: [
              { value: 'newFile', text: '新建文件' },
              { value: 'restoreFolders', text: '恢复上次的文件夹' },
              { value: 'restoreFilesAndFolders', text: '恢复上次的文件与文件夹' },
              { value: 'customFolder', text: '打开指定文件夹' }
            ]
          },
          {
            key: 'customLaunchFolder',
            kind: '文本',
            label: '指定文件夹',
            description: '仅在上一项选「打开指定文件夹」时生效。'
          }
        ]
      }
    ]
  },
  {
    title: '拼写检查',
    subsection: [
      {
        description:
          '由 Chromium 自带的拼写检查器完成，提供红波浪线与右键"建议替换"。' +
          '中文没有可用的拼写词典，所以这项只对西文有意义。' +
          '改完之后需要重新打开文档才会生效。',
        item: [
          {
            key: 'spellCheck',
            kind: '开关',
            label: '启用拼写检查'
          },
          {
            key: 'spellCheckLanguages',
            kind: '列表',
            label: '词典语言',
            description: '可填多个，用逗号分隔（如 en-US, en-GB）。填了系统没有的词典会被忽略。'
          }
        ]
      }
    ]
  },
  {
    title: '侧边栏',
    subsection: [
      {
        description: '侧边栏占着 260px 宽。写长文时想让它彻底消失、又不想被误按快捷键叫回来，就选「始终隐藏」。',
        item: [
          {
            key: 'sidebarMode',
            kind: '下拉',
            label: '显示方式',
            options: [
              { value: 'toggle', text: '可自由切换' },
              { value: 'always', text: '始终显示' },
              { value: 'never', text: '始终隐藏' }
            ],
            description: '选「始终」两档后，快捷键与菜单都改不了它。'
          },
          {
            key: 'sidebarVisible',
            kind: '开关',
            label: '当前是否显示',
            description: '只在「可自由切换」下有效；另外两档由上面的设置决定。'
          },
          {
            key: 'sidebarTab',
            kind: '下拉',
            label: '默认标签页',
            options: [
              { value: 'outline', text: '大纲' },
              { value: 'files', text: '文件' },
              { value: 'articles', text: '文档' }
            ]
          }
        ]
      }
    ]
  },
  {
    title: '导出',
    subsection: [
      {
        description:
          '这些选项对 HTML 与 PDF 生效。Word、LaTeX 等格式由 Pandoc 转换，不受影响。',
        item: [
          {
            key: 'exportIncludeOutline',
            kind: '开关',
            label: '附带侧边目录',
            description: '在导出的 HTML 左侧生成大纲。长文没有目录很难导航。'
          },
          {
            key: 'exportEmbedImages',
            kind: '开关',
            label: '内嵌图片（单文件）',
            description: '把本地图片转成 base64 塞进 HTML，便于发给别人。代价是文件大好几倍。'
          }
        ]
      },
      {
        item: [
          {
            key: 'pandocPath',
            kind: '文本',
            label: 'Pandoc 路径',
            description: '留空则从 PATH 中查找 pandoc。HTML 与 PDF 导出不需要它。'
          }
        ]
      }
    ]
  }
]

/** 扁平化后的全部设置项，供校验与遍历使用。 */
export function allSettingItems(): SettingItem[] {
  return PrefsSchema.flatMap((section) => section.subsection.flatMap((subsection) => subsection.item))
}

/**
 * 校验表里的每个键都真实存在于设置中。
 *
 * 返回不存在的键名数组；界面渲染前调用，出错时能立刻定位到是哪一项写错了，
 * 而不是让用户点一个永远没反应的开关。
 */
export function validateSchema(): string[] {
  const 已知 = new Set(Object.keys(DEFAULT_SETTINGS))
  return allSettingItems()
    .map((item) => item.key as string)
    .filter((key) => !已知.has(key))
}
