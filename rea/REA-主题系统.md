# REA 分析报告：Typora 1.9.5 主题系统

- **分析对象**：`E:\Typor\Typor1.9.5-x64-CN\Typora`
- **分析目标功能**：主题加载、发现、切换与自定义 CSS 级联
- **结论分级**：🟢 直接观察 / 🟡 推断 / 🔴 未确认
- **复现工具**：`scripts/CSS选择器.py`、`scripts/CSS变量契约.py`

---

## 1. 样式表的加载顺序（14 层）

🟢 从 `resources/window.html` 提取，顺序即层叠优先级：

| # | 样式表 | 作用域 | 标记 |
|---|---|---|---|
| 1 | `lib.asar/bootstrape/css/bootstrap.css` | 第三方 UI 框架 | |
| 2 | `lib.asar/diagram/css/mermaid.css` | 图表 | `css-include` |
| 3 | `style/font-awesome-4.1.0/css/font-awesome.min.css` | 图标字体 | |
| 4 | `style/ionicons-2.0.1/css/ionicons.min.css` | 图标字体 | |
| 5 | `style/typora-icon/style.css` | 自有图标 | |
| 6 | `style/typora-file-icon/style.css` | 文件树图标 | |
| 7 | **`style/base.css`** | **基础变量与文档排版** | `css-include` |
| 8 | `style/base-control.css` | **控件变量（大部分变量在这里）** | |
| 9 | `style/codemirror.css` | 编辑器 | `css-include` |
| 10 | `style/window.css` | 窗口、侧边栏 | |
| 11 | `style/megamenu.css` | 菜单面板 | |
| 12 | `typora-bg://bg.css` | 背景图/背景色 | `id=bg_css` |
| 13 | **`typora://app/userData/themes/current-theme.css`** | **当前主题** | `id=theme_css` |
| 14 | `` `#base_user_css` `` | 用户全局自定义 CSS | `href` 初始为空 |
| 15 | `` `#theme_user_css` `` | 用户按主题自定义 CSS | `href` 初始为空 |

**🟢 关键结论：主题位于整个层叠的倒数第三层。** 它压过所有框架与控件样式，
但**被用户自定义 CSS 压过**。这个顺序是刻意的——用户永远能覆盖主题，
不需要去改主题文件（主题会在升级时被覆盖，见 `themes/Readme.md` 原文：
"The built-in CSS will be replaced after update / reinstall, DO NOT MODIFY THEM."）。

---

## 2. 三层主题级联（核心机制）

🟢 从 `frame.js` 偏移 ~578,670 提取到完整实现：

```js
File.option.curTheme = e || File.option.curTheme || "github.css"
e = File.option.curTheme.replace(/\.css$/, "")
o = "typora://app/userData"
a = File.isWin ? "\\" : "/"

$("#theme_css")     .attr("href", [o, "themes", e + ".css"].join(a))
$("#base_user_css") .attr("href", [o, "themes", "base.user.css"].join(a))
$("#theme_user_css").attr("href", [o, "themes", e + ".user.css"].join(a))

document.body.style.backgroundColor = ""
document.body.style.setProperty("--bg-color", "")
```

**三层文件：**

| 层 | 文件 | 作用 |
|---|---|---|
| 1 | `<userData>/themes/<主题名>.css` | 主题本体 |
| 2 | `<userData>/themes/base.user.css` | **全局**自定义 CSS，对所有主题生效 |
| 3 | `<userData>/themes/<主题名>.user.css` | **该主题专属**自定义 CSS |

三者都是普通文件，**不存在就 404，浏览器静默忽略**——不需要任何存在性检查。
这解释了为什么后两个 `<link>` 的 `href` 在 HTML 里是空串：它们由 JS 在切换主题时填入。

**🟢 切换时还会清空内联的 `--bg-color` 覆盖**，否则上一次主题或背景图功能
设下的内联样式会压过新主题——内联样式优先级高于样式表，忘了清就换不动主题。

### `current-theme.css` 不是生成的文件

🟢 另一段代码（偏移 ~1,524,943）揭示了它的真实身份：

```js
/current-theme\.css$/.exec(t) && (t = t.replace(/current-theme\.css$/, File.option.curTheme))
```

`typora://app/userData/themes/current-theme.css` 是一个**虚拟路径**，
由协议层在解析时替换成当前主题的真实文件名。同一段代码还处理：

- `typora://app/userData` → `window._options.userDataPath`
- `typora://app/typemark` → `window.dirname`
- 剥掉 `?query` 与 `#fragment`

🟡 **推断**：这是为了让 `window.html` 里写死的 `<link href="...current-theme.css">`
不需要随主题变化而改写。但实际切换代码用的是真实文件名（见上），
所以虚拟路径主要服务于**主题 CSS 内部**对 `current-theme.css` 的引用。

---

## 3. 变量契约：37 个 CSS 自定义属性

🟢 用 `scripts/CSS变量契约.py` 扫全部基础样式表得出。

**只有 5 个在 `base.css`**，其余 32 个在 `base-control.css`。
这说明变量契约并非集中声明，而是随样式表分散定义——扫单个文件必然漏。

### 文档内容（4 个）

| 变量 | 默认值 |
|---|---|
| `--bg-color` | `#ffffff` |
| `--text-color` | `#333333` |
| `--select-text-bg-color` | `#B5D6FC` |
| `--select-text-font-color` | `auto` |

### 排版（1 个）

| 变量 | 默认值 |
|---|---|
| `--monospace` | `"Lucida Console",Consolas,"Courier",monospace` |

### 编辑器与 Markdown（6 个）

| 变量 | 默认值 |
|---|---|
| `--md-char-color` | `#C7C5C5` | Markdown 标记符颜色 |
| `--meta-content-color` | `#5b808d` |
| `--blur-text-color` | `#C8C8C8` |
| `--drag-placeholder-color` | `#c7c5c5` |
| `--table-border-color` | `#ccc` |
| `--heading-char-color` | `#ddd` |

### 侧边栏与控件（其余 26 个）

含 `--side-bar-bg-color`、`--sidebar-width`、`--control-text-color`、
`--item-hover-bg-color`、`--active-file-bg-color`、`--window-border`、
`--primary-color`、`--focus-ring-color`、`--rawblock-edit-panel-bd` 等。

### 降级写法

🟢 `base.css` 用**"硬编码值在前、`var()` 覆盖在后"**的双写：

```css
html { background-color:#fff; background-color:var(--bg-color); color:#333; color:var(--text-color); }
```

🟡 推断：这是给不支持自定义属性的环境兜底。对现代 Electron 已无必要，
但它确立了一个惯例——**变量缺失时页面不能崩**。

---

## 4. 主题能挂钩的选择器：约 288 个

🟢 用 `scripts/CSS选择器.py` 扫 `base.css` + 全部内置主题得出。

出现频率最高的（即主题作者最常覆盖的）：

| 选择器 | 次数 | 含义 |
|---|---|---|
| `#write` | 86 | **文档内容容器** |
| `.md-focus` | 37 | 焦点模式的当前段落 |
| `.cm-s-inner` | 31 | CodeMirror 内部主题类 |
| `.md-task-list-item` | 30 | 任务列表项 |
| `.md-fences` | 24 | 代码围栏 |
| `.outline-expander` / `.outline-item` | 21 | 大纲 |
| `.cm-s-typora-default` | 21 | CodeMirror 默认主题类 |
| `.typora-export` | 20 | 导出态 |
| `.md-toc-inner` | 13 | 内容目录 |
| `.md-image` / `.md-meta` | 10 | 图片与其语法标记 |
| `.md-diagram-panel` | 8 | 图表面板 |
| `.md-alert` | 6 | GitHub 风格警告块 |

其余含 `.md-math-block`、`.md-inline-math`、`.md-footnote`、`.md-tag`、
`.md-attr`、`.md-meta-block`、`.first-line-indent`、`.typora-sidebar`、
`.ty-preferences`、`.megamenu-*`、`.file-list-item`、`.ty-table-edit`、
`.code-tooltip`、`.context-menu`、`.top-titlebar` 等。

### 🟢 关键结论：主题不是 token 驱动的

变量只有 37 个，且**大部分只管界面控件**。文档内容的排版（标题字号、
段落间距、代码块背景）主题是**直接写选择器**的，例如：

```css
#write h1 { font-size: 2em; border-bottom: 1px solid #eee; }
.md-fences { background: #f6f8fa; border-radius: 3px; }
```

这意味着：**只提供 token 的主题系统无法兼容 Typora 主题**。要复用其生态，
宿主必须提供同名选择器所指向的 DOM 结构。

---

## 5. Typora 专有语法

### `@include-when-export`

🟢 出现在 `github.css`、`newsprint.css`、`pixyll.css`：

```css
@include-when-export url(https://fonts.googleapis.com/css?family=Open+Sans:...);
```

🟡 推断：这是一条**自定义 at-rule**，含义是"仅导出时包含"。
屏幕编辑时不加载远程字体（省流量、离线可用），导出成 HTML/PDF 时才拼进去。
它不是标准 CSS，浏览器会直接忽略整条规则——所以不实现也不会报错，
只是导出时少了远程字体。

### 深色子样式表靠 `@import` 自行引入

🟢 `night.css` 开头：

```css
@import "night/mermaid.dark.css";
@import "night/codeblock.dark.css";
@import "night/sourcemode.dark.css";
```

**不是 Typora 自动注入的**，而是主题自己用标准 `@import` 拉进来。
这要求 `@import` 的相对路径能相对于主题文件解析。

---

## 6. 主题的目录布局

🟢 `resources/style/themes/` 与 `%APPDATA%\Typora\themes\` 结构一致：

```
themes/
├── github.css              主题本体
├── github/                 同名资源目录
│   └── open-sans-*.woff2     字体
├── newsprint.css
├── newsprint/
│   └── pt-serif-*.woff2
├── night.css
├── night/
│   ├── codeblock.dark.css    深色子样式表
│   ├── mermaid.dark.css
│   ├── sourcemode.dark.css
│   ├── cursor.png            自定义光标
│   └── credit.html
└── Readme.md
```

🟢 主题 CSS 里用**相对路径**引用资源：

```css
src: url('./github/open-sans-v17-latin-ext-latin-regular.woff2') format('woff2');
```

**因此宿主必须让主题目录下的任意文件都能被加载**，
而不只是 `<主题名>.css` 本身。

### 主题没有元数据

🟢 `github.css` 与 `night.css` 的开头都**没有**任何元数据注释。
显示名就是**文件名去掉扩展名**；深浅色由用户在设置里指定两个槽位
（`Panel.json`：`"Light Theme"` / `"Dark Theme"` / `"Use separate theme in dark mode"`），
**不靠自动探测**。

---

## 7. 与本项目（selfMD）的差距

| 能力 | Typora | selfMD 当前 | 差距 |
|---|---|---|---|
| 主题是完整样式表 | ✅ | ✅ 已加载整份 CSS | — |
| 主题资源子目录（字体/图片） | ✅ | ❌ 协议只服务 `<id>.css` | **必须补** |
| `base.user.css` 全局自定义 | ✅ | ❌ | **必须补** |
| `<主题>.user.css` 专属自定义 | ✅ | ❌ | **必须补** |
| 变量契约 | 37 个 | 自定 30 余个，命名不同 | 需对齐 |
| Typora 选择器兼容 | 288 个 | 用自有 `cm-lp-*` | **无法完全兼容**，见下 |
| 深色子样式表 | ✅ `@import` | ✅ 标准 CSS，天然支持 | — |
| `@include-when-export` | ✅ | ❌ | 无导出功能，P7 再做 |
| 主题安装/删除/打开文件夹 | ✅ | 部分 | 补齐 |

### 🔴 无法完全兼容 Typora 主题的根本原因

Typora 的文档内容容器 `#write` 里是**真实 HTML 元素**（`<h1>`、`<p>`、`<pre>`），
主题写的是 `#write h1 { ... }`。

selfMD 用 CodeMirror 6，内容是一堆 `<div class="cm-line">`，
**不存在 `<h1>` 元素**。所以：

- `#write h1 { font-size: 2em }` 在 selfMD 里**不会命中任何东西**
- 要做到兼容，必须让装饰层产出与 Typora 同名的类/结构

**可行的折中**：装饰层同时挂上 Typora 的类名作为别名
（代码块行挂 `md-fences`、任务项挂 `md-task-list-item`、图片挂 `md-image`），
让**基于这些类的主题规则**生效；但基于真实标签（`h1`、`blockquote`）的规则
仍然无效。这一点必须对用户讲清楚，不能假装兼容。

---

## 8. 对 selfMD 的实施建议

1. **协议层改为服务主题目录下的任意文件**（含目录穿越防护）——这是解锁
   真实主题（带字体、带 `@import`）的前提。
2. **补齐三层级联**：`<主题>.css` → `base.user.css` → `<主题>.user.css`，
   三份都允许不存在。
3. **把变量契约对齐到 Typora 的命名**，让主题作者能直接迁移；
   本项目特有的编辑器变量另起前缀，不占用 Typora 的名字。
4. **装饰层挂 Typora 兼容类名别名**，能兼容多少算多少，并在文档里
   明确写出"哪些能兼容、哪些不能"。
5. **切换主题时清空内联变量覆盖**（Typora 也这么做）。
6. **提供主题开发脚手架**：新建主题、打开主题文件夹、打开自定义 CSS。

---

*报告完。所有 🟢 结论均可用 `scripts/CSS选择器.py` 与 `scripts/CSS变量契约.py`
在原始安装目录上复现。*
