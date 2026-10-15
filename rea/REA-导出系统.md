# REA 分析报告：Typora 1.9.5 导出系统

- **分析对象**：`E:\Typor\Typor1.9.5-x64-CN\Typora`
- **分析目标功能**：导出 HTML / PDF / Word 等格式
- **结论分级**：🟢 直接观察 / 🟡 推断 / 🔴 未确认
- **复现工具**：`scripts/CSS选择器.py`、`scripts/CSS变量契约.py`、`rea/tools/ctx.mjs`

---

## 1. 总体架构：两条路

🟢 从 `frame.js` 的 `exportToNative` 与 `pandoc` 相关代码提取：

| 目标格式 | 实现方式 |
|---|---|
| **HTML** | **自己渲染**（Typora 原生，标志位 `forExport: true`） |
| **PDF** | 自己渲染 HTML 后交给 Chromium 打印 |
| 其余全部（Word / LaTeX / ePub / RTF / wiki / OPML…） | **委托外部 Pandoc** |

🟢 Pandoc 调用方式（`frame.js` 偏移 ~1,372,071）：

```js
s = reqnode("child_process").spawn
u = () => File.option.pandocPath || "pandoc"      // 可配置路径，默认取 PATH
h = function (e, i, r, t) {
  if (!(t || {}).cwd) (n = c.getCurrentFileFolderPath()) && (t = Object.assign({ cwd: n }, t))
  d = s(u(), e, t)                                 // e 是参数数组
  // 收集 stdout / stderr；close 时退出码为 0 才成功
  e.on("error", n).on("close", function (e) { 0 === e ? t(i) : n(r) })
}
```

🟢 版本探测（同一区域）：

```js
f = async function (e) {
  var t = await JSBridge.invoke("pandoc.version")
  // 若原生层没给出，则执行 `pandoc --version` 并从首行提取版本号
  t = ((await i(u(), ["--version"], { windowsHide: true })).toString("utf8")
        .split(/\r|\n|\r\n/) || [])[0].match(/[\d.]{2,}/) || [])[0]
  ...
  window.pandocVersion = t
}
```

🟢 格式名与 Pandoc 输出的映射（`exportToNative` 内）：

```js
e = "pandoc" == e || "native" == e ? i.raw || i.targetFormat : e
"latex-pdf" == e ? e = "latex" : "mediawiki" == e && (e = "wiki")
```

**🟢 结论：Typora 不内置转换器。** 除 HTML/PDF 外的所有格式都依赖用户自行安装
Pandoc——安装说明就在 `resources/Docs/Install and Use Pandoc.md`（5616 字节，
随安装包分发）。

### 🟢 Pandoc 能处理的扩展名清单

从拖放导入的一段代码里提取到：

```js
["latex","ltx","tex","wiki","dokuwiki","docx","rst","rest","org","textile","opml"]
```

这些是 Pandoc 能读的输入格式，Typora 拖入这类文件时会走 Pandoc 转换而非当文本打开。

---

## 2. 导出模式的 DOM 结构

🟢 从 `.typora-export*` 类名反推（这些类名出现在基础样式表与内置主题里）：

```html
<body class="typora-export [typora-export-show-outline]">
  <div class="typora-export-content">
    <aside class="typora-export-sidebar">      <!-- 可选：导出时附大纲 -->
      <div class="outline-content">
        <div class="outline-item">…</div>
      </div>
    </aside>
    <div id="write">…正文…</div>
  </div>
</body>
```

---

## 3. 导出模式的样式差异（完整清单）

🟢 用脚本从 `base.css` 里筛出全部含 `typora-export` 的规则：

| 规则 | 作用 |
|---|---|
| `body.typora-export { padding: 0 30px }` | 页面留白 |
| `.typora-export * { -webkit-print-color-adjust: exact }` | **打印时保留背景色** |
| `.typora-export h1…h6 { page-break-inside: avoid }` | 标题不与正文分离到两页 |
| `.typora-export #write { page-break-after: avoid }` | 内容末尾不产生空页 |
| `.typora-export p, li, .footnote-line { white-space: pre-wrap }` | 保留单个换行 |
| `.typora-export .task-list-item input { pointer-events: none }` | 复选框不可交互 |
| `.typora-export-show-outline .typora-export-content { display:flex }` | 大纲与正文并排 |
| `… .typora-export-sidebar .outline-content { position: fixed }` | 大纲固定不滚动 |

**`-webkit-print-color-adjust: exact` 是 PDF 导出的关键一条。** 没有它，
Chromium 打印时会**丢弃所有背景色与背景图**——代码块、引用块、表格斑马纹
全部变成白底，导出的 PDF 与屏幕所见完全不符。这是最容易被漏掉、
又最容易被用户当成"导出功能坏了"的一条。

---

## 4. `@include-when-export` 专有指令

🟢 `frame.js` 偏移 ~712,561 有完整实现：

```js
var o = /^\s*@include-when-export\s+(url)?([('"]+)([^\)"']+)([)'"]+)/im;
function a(e, t) { e && n.push(E(e, t)) }
if (!h) try {
  (r = e.match(/^\s*@include-when-export\s.+$/gim)) && r.map(function (e) {
    a((i = o.exec(e) || [])[3])       // 第 3 组 = 去掉引号后的地址
  })
} catch (e) {}
o = /^\s*@import\s+(url)?([('"]+)([^\)"']+)([)'"]+)/im;   // 紧接着同样处理 @import
```

**语义**：`@include-when-export <地址>` 里的地址**只在导出时内联进 `<style>`**，
屏幕上编辑时不加载。

🟢 内置主题里的实际用法（`github.css`、`newsprint.css`、`pixyll.css`）：

```css
@include-when-export url(https://fonts.googleapis.com/css?family=Open+Sans:...);
```

**为什么这样设计**：远程字体在屏幕上不加载（离线可用、不卡首屏），
而导出成 HTML 时需要它——因为导出的文件要在**别人的浏览器**里打开，
那时未必有本地字体。

🟢 同一个函数紧接着用**完全相同的正则形状**处理标准的 `@import`，
说明 `@include-when-export` 就是照着 `@import` 设计的：语法一致，只是多一个触发条件。

🔴 **未确认**：守卫变量 `h` 的确切含义。🟡 推断它是"当前是否处于导出流程"——
因为在屏幕渲染时收集这些地址、导出时再内联，与函数名相符。

---

## 5. 导出触发点与状态

🟢 相关标志与函数名：

| 名称 | 作用 |
|---|---|
| `File.editor.export.cleanUpTempFiles` | 导出后清理临时文件（说明导出会落临时文件） |
| `forExport: true` | 传给渲染器的选项，切换成导出态渲染 |
| `showExportNotification(...)` | 导出进度通知（`"Exporting in progress..."`） |
| `window.pandocVersion` | 全局缓存 Pandoc 版本，供界面决定显示哪些格式 |

🟡 推断：导出菜单项是**动态生成**的——静态 `Menu.json` 里只有
`导出` / `打印` / `HTML (无样式)` / `使用上一次设置导出` /
`导出并覆盖上一次导出的文件` / `导出设置` 六条，没有任何具体格式名。
具体格式（Word、LaTeX、ePub…）要等 `pandoc --version` 返回后才出现。

---

## 6. 与本项目（selfMD）的差距

| 能力 | Typora | selfMD 当前 | 计划 |
|---|---|---|---|
| Markdown → HTML | ✅ 自研 | ❌ | **本轮实现** |
| HTML 导出（含样式） | ✅ | ❌ | **本轮实现** |
| HTML（无样式） | ✅ | ❌ | **本轮实现** |
| 导出时附大纲 | ✅ | ❌ | **本轮实现** |
| PDF 导出 | ✅ Chromium 打印 | ❌ | **本轮实现**（Electron `printToPDF`，无需外部依赖） |
| Word / LaTeX / ePub | ✅ 经 Pandoc | ❌ | **本轮实现委托层**，无 Pandoc 时明确提示 |
| `@include-when-export` | ✅ | ❌ | **本轮实现** |
| 打印时保留背景色 | ✅ | ❌ | **本轮实现**（`print-color-adjust: exact`） |
| 图片内嵌（自包含 HTML） | ✅ | ❌ | 本轮实现 base64 内嵌 |

---

## 7. 对 selfMD 的实施建议

1. **Markdown → HTML 用自己的渲染器**，直接遍历已有的 Lezer 语法树。
   好处是导出结果与实时预览基于**同一棵树**，不会出现"屏幕上是一种、
   导出是另一种"的偏差。
2. **PDF 走 Electron 的 `printToPDF`**，不引入外部依赖——这是 Electron 相比
   Typora 白拿的优势（Typora 也得靠 Chromium，但它的调用链更深）。
3. **必须加 `print-color-adjust: exact`**，否则 PDF 丢失全部背景色。
4. **Word 等格式委托 Pandoc**，并做成"检测不到就明确告知"而不是静默失败。
5. **`@include-when-export` 按 Typora 的正则形状实现**，让现成主题能直接迁移。
6. **图片默认内嵌成 base64**，导出单个 HTML 文件即可分享；
   可选"复制到同名目录"，与 Typora 的两种模式对齐。

---

*报告完。所有 🟢 结论均可用 `rea/tools/ctx.mjs` 与随附的 Python 脚本
在原始安装目录上复现。*
