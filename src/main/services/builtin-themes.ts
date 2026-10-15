/**
 * 内置主题。
 *
 * 主题是**普通的 CSS 文件**，放在 `<userData>/themes`。它有两套写法可用：
 *
 *   1. **覆盖变量**（本文件主要用这种）——短、稳、跟着基础样式走
 *   2. **直接写选择器**——表达力强，覆盖任何细节，代价是基础样式改了可能失配
 *
 * 变量分两层，两层都写在 `renderer/src/styles/base.css` 的 `:root` 里：
 *
 *   - **通用变量层**（`--bg-color`、`--text-color`、`--side-bar-bg-color`…）
 *     名字与默认值照搬 通行的 base.css / 内部控件样式表。
 *     照搬的意义是**现成主题能直接迁移**——一份设了 `--bg-color: #363B40`
 *     的 深色主题放进来同样生效。
 *   - **本项目层**（`--bg-primary`、`--text-primary`…）全部由上面派生。
 *
 * 可选元数据写在开头的块注释里（CSS 本身不认识，是加载器读的）：
 *
 *   @name 显示名       省略时用文件名
 *   @dark true|false   是否深色配色，供界面判断，不影响渲染
 */

export interface BuiltinTheme {
  id: string
  css: string
}

export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    id: 'github',
    css: `/**
 * @name GitHub 浅色
 * @dark false
 *
 * 演示「只覆盖变量」：改动量最小，也最不容易随基础样式演进而失配。
 */
:root {
  --bg-color: #ffffff;
  --text-color: #1f2328;
  --select-text-bg-color: #b6d7ff;

  --side-bar-bg-color: #f6f8fa;
  --control-text-color: #59636e;
  --control-text-hover-color: #1f2328;
  --blur-text-color: #8c959f;

  --window-border-color: #d1d9e0;
  --table-border-color: #d1d9e0;
  --panel-border-color: #d1d9e0;

  --primary-color: #0969da;
  --primary-btn-border-color: #0550ae;
  --focus-ring-color: #0969da;

  --md-char-color: #a0a8b0;
  --rawblock-edit-panel-bd: #f6f8fa;
  --item-hover-bg-color: #eaeef2;
  --active-file-bg-color: #eaeef2;

  --font-size: 16px;
  --line-height: 1.65;
  --content-max-width: 860px;
  --radius: 6px;
}
`
  },
  {
    id: 'github-dark',
    css: `/**
 * @name GitHub 深色
 * @dark true
 *
 * 演示深色主题。深色版与浅色版共用同一套变量名，
 * 所以切换主题时不会有任何"某个角落没换过来"的问题。
 */
:root {
  --bg-color: #0d1117;
  --text-color: #e6edf3;
  --select-text-bg-color: #264f78;

  --side-bar-bg-color: #161b22;
  --control-text-color: #9198a1;
  --control-text-hover-color: #e6edf3;
  --blur-text-color: #6e7681;

  --window-border: 1px solid #30363d;
  --window-border-color: #30363d;
  --table-border-color: #30363d;
  --panel-border-color: #30363d;

  --primary-color: #4493f8;
  --primary-btn-border-color: #79b8ff;
  --primary-btn-text-color: #0d1117;
  --focus-ring-color: #4493f8;

  --md-char-color: #6e7681;
  --rawblock-edit-panel-bd: #161b22;
  --item-hover-bg-color: #21262d;
  --active-file-bg-color: #21262d;
  --active-file-border-color: #6e7681;
  --color-popover-bg-color: #161b22;

  --font-size: 16px;
  --line-height: 1.65;
  --content-max-width: 860px;
  --radius: 6px;
}
`
  },
  {
    id: 'newsprint',
    css: `/**
 * @name 报刊
 * @dark false
 *
 * 演示「变量 + 选择器」混用：颜色与字体走变量，
 * 而几处需要改版式的地方直接写选择器——这是主题的典型写法。
 */
:root {
  --bg-color: #fbf8f1;
  --text-color: #2b2620;
  --select-text-bg-color: #f0d9a8;

  --side-bar-bg-color: #f3eee2;
  --control-text-color: #6b6152;
  --control-text-hover-color: #2b2620;
  --blur-text-color: #9a8f7d;

  --window-border-color: #ddd4c2;
  --table-border-color: #ddd4c2;
  --panel-border-color: #ddd4c2;

  --primary-color: #9a3b26;
  --primary-btn-border-color: #7d2f1e;
  --focus-ring-color: #9a3b26;

  --md-char-color: #a89b85;
  --rawblock-edit-panel-bd: #f3eee2;
  --item-hover-bg-color: #e9e2d2;
  --active-file-bg-color: #e9e2d2;

  --font-body: Georgia, "Songti SC", "SimSun", serif;
  --font-size: 17px;
  --line-height: 1.75;
  --content-max-width: 760px;
  --radius: 2px;
}

/* --- 以下直接写选择器：\`#write\` 是内容容器，与 通用的锚点同名，
       所以一份针对 \`#write\` 写的规则在两边都能用 --- */

#write .cm-lp-h1,
#write .cm-lp-h2 {
  letter-spacing: 0.01em;
}

#write .cm-lp-quote {
  font-style: normal;
  border-left-width: 4px;
}

#write .cm-lp-code {
  border-left: 2px solid #ddd4c2;
  border-right: 2px solid #ddd4c2;
}

#write .cm-lp-code-first {
  border-top: 2px solid #ddd4c2;
}

#write .cm-lp-code-last {
  border-bottom: 2px solid #ddd4c2;
}
`
  }
]
