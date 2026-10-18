/**
 * 内置主题。
 *
 * 主题是**普通的 CSS 文件**，放在 `<userData>/themes`。它有两套写法可用：
 *
 *   1. **覆盖变量** —— 短、稳、跟着基础样式走
 *   2. **直接写选择器** —— 表达力强，覆盖任何细节，代价是基础样式改了可能失配
 *
 * 变量分两层，两层都写在 `renderer/src/styles/base.css` 的 `:root` 里：
 *
 *   - **通用变量层**（`--bg-color`、`--text-color`、`--side-bar-bg-color`…）
 *     名字与默认值沿用主流 Markdown 编辑器主题的通行约定。
 *     沿用的意义是**现成主题能直接迁移**——一份设了 `--bg-color: #363B40`
 *     的深色主题放进来同样生效。
 *   - **本项目层**（`--bg-primary`、`--text-primary`…）全部由上面派生，
 *     所以主题**只需要管第一层**，派生层会自己跟上。
 *
 * 可选元数据写在开头的块注释里（CSS 本身不认识，是加载器读的）：
 *
 *   @name 显示名       省略时用文件名
 *   @dark true|false   是否深色配色，供界面判断，不影响渲染
 *
 * ## 关于 id 为什么是英文
 *
 * `id` 会被当成**文件名**（`<userData>/themes/<id>.css`），而主题加载器
 * 有一道路径安全检查只放行 ASCII。所以中文名走 `@name`，用户在界面里
 * 看到的是「黄皮纸」「月之暗面」，磁盘上是 `parchment.css`。
 *
 * ## 三款主题的分工
 *
 *   黄皮纸    暖色纸感、衬线正文，适合长时间读写的散文
 *   月之亮面  冷调浅色，中性、克制，适合日常默认
 *   月之暗面  与亮面同一色系的深夜版，切换时不会有"换了个软件"的割裂感
 *
 * 亮面与暗面**共用同一套色相**（蓝紫），只改明度——这是刻意的：
 * 两者是同一轮月亮的两个面，白天黑夜切来切去不该让人重新适应配色。
 */

export interface BuiltinTheme {
  id: string
  css: string
}

export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    id: 'parchment',
    css: `/**
 * @name 黄皮纸
 * @dark false
 *
 * 像一本摊开的旧书：暖色纸底、墨褐正文、衬线字体。
 *
 * 这款同时演示**两种写法混用**——颜色与字号走变量，
 * 而几处需要改版式的地方直接写选择器（章题居中、引用像边注、代码块加内缩）。
 * 这是主题的典型写法：变量管"是什么颜色"，选择器管"长什么样"。
 */
:root {
  /* --- 纸与墨 --- */
  --bg-color: #f5ecd7;
  --text-color: #3a3126;
  --select-text-bg-color: #e3cf9e;
  --select-text-font-color: #2b2419;

  /* --- 侧栏与控件 --- */
  --side-bar-bg-color: #efe4c9;
  --control-text-color: #6b5c44;
  --control-text-hover-color: #3a3126;
  --blur-text-color: #9c8c6f;
  --active-toggle-btn-color: #d5c6a2;

  /* --- 分隔线 --- */
  --window-border-color: #dccfae;
  --window-border: 1px solid #dccfae;
  --table-border-color: #d5c6a2;
  --panel-border-color: #dccfae;
  --heading-char-color: #c9b98f;
  --drag-placeholder-color: #d5c6a2;

  /* --- 强调色用皮革棕：纸上的红蓝都太扎眼 --- */
  --primary-color: #8a5a2b;
  --primary-btn-border-color: #6f4520;
  --primary-btn-text-color: #fdf8ec;
  --focus-ring-color: #8a5a2b;

  /* --- 标记与面板 --- */
  --md-char-color: #b3a17c;
  --meta-content-color: #7a6a4a;
  --rawblock-edit-panel-bd: #efe4c9;
  --code-bg: #e8dcbd;
  --code-edge: #d3bf92;
  --item-hover-bg-color: #e8dbbd;
  --item-hover-text-color: #2b2419;
  --active-file-bg-color: #e3d4b2;
  --active-file-text-color: #2b2419;
  --active-file-border-color: #8a5a2b;
  --color-popover-bg-color: #f7f0de;
  --search-select-bg-color: #e3cf9e;
  --search-select-text-color: #2b2419;

  /* --- 排版：书籍用衬线、行距更松、版心更窄 --- */
  --font-body: Georgia, "Songti SC", "SimSun", "Noto Serif CJK SC", serif;
  --font-size: 17px;
  --line-height: 1.8;
  /* 一行 30 到 40 个汉字最省眼力，所以版心比默认窄 */
  --content-max-width: 1100px;
  /* 书页是方的，圆角一大就不像纸了 */
  --radius: 3px;
  --shadow: 0 1px 2px rgba(58, 49, 38, 0.1);

  /* --- 代码配色：纸上不能用霓虹色。整体压暗、降饱和，
         像用钢笔和两种墨水写下来的，而不是屏幕上的发光体 --- */
  --code-keyword: #7b3f8c;
  --code-string: #4a7c3f;
  --code-comment: #9c8c6f;
  --code-number: #a8622a;
  --code-type: #8a6a1f;
  --code-function: #2f5d8a;
  --code-property: #9c3b26;
  --code-variable: #3a3126;
  --code-punct: #6b5c44;
  --code-tag: #9c3b26;
  --code-meta: #8a6a1f;
}

/* --- 以下直接写选择器 ------------------------------------------------- */

/* 标题的字距。
   这里原来还有一句 text-align: center，想做成「章题居中」的书籍排法——
   已经删掉，因为它是错的：

   1. .cm-lp-heading 匹配的是全部六级标题，不是只有一级章题，
      结果正文里的每一级小标题都被居中了，层级关系反而更乱；
   2. 编辑器里居中尤其别扭：光标的落点与右侧大片留白对不上，
      写着会觉得「字在飘」。

   书籍排版里章题居中是对的，但那要求标题独占一页、上下文都是空白。
   在连续滚动的编辑器里没有这个前提，居中只是把文字拉离了阅读的起跑线。
   保留字距，它是给标题松一口气的、不改变对齐。

   注意：本文件里的主题 CSS 是模板字符串，注释中**不能出现反引号**，
   否则会把字符串截断。 */
#write .cm-lp-heading {
  letter-spacing: 0.06em;
}

/* 引用块当作"边注"：左侧一道粗线 + 极淡的底色，
   比默认的单线更像纸上的批注。 */
#write .cm-lp-quote {
  font-style: normal;
  border-left-width: 3px;
  border-left-color: #c9b98f;
  background: rgba(201, 185, 143, 0.14);
}

/* 代码块加内缩与上下框线：让它看起来像"贴在书页上的一张纸"，
   而不是与正文平铺。首尾行各补一条边，中间行只留左右。 */
#write .cm-lp-code {
  border-left: 1px solid #dccfae;
  border-right: 1px solid #dccfae;
  margin-left: 1em;
  margin-right: 1em;
}

#write .cm-lp-code-first {
  border-top: 1px solid #dccfae;
}

#write .cm-lp-code-last {
  border-bottom: 1px solid #dccfae;
}

/* 表格用上下两条粗线、中间细线——这是书籍表格的传统做法 */
#write .cm-lp-table-head {
  border-top: 2px solid #b3a17c;
  border-bottom: 1px solid #b3a17c;
}
`
  },
  {
    id: 'moon-light',
    css: `/**
 * @name 月之亮面
 * @dark false
 *
 * 冷调浅色，中性克制。与「月之暗面」共用同一套色相，只改明度——
 * 所以两者之间切换时不会有"换了个软件"的割裂感。
 */
:root {
  /* --- 底与字：白里透一点蓝，比纯白柔和 --- */
  --bg-color: #f7f9fd;
  --text-color: #2a3150;
  --select-text-bg-color: #cfdcff;
  --select-text-font-color: #1a2038;

  --side-bar-bg-color: #eef2fa;
  --control-text-color: #5b6688;
  --control-text-hover-color: #2a3150;
  --blur-text-color: #8f9ab8;
  --active-toggle-btn-color: #d5dcef;

  --window-border-color: #dbe1f0;
  --window-border: 1px solid #dbe1f0;
  --table-border-color: #d5dcef;
  --panel-border-color: #dbe1f0;
  --heading-char-color: #c3cce6;
  --drag-placeholder-color: #c3cce6;

  /* 强调色比暗面深一档：同样的蓝在白底上必须压暗才够对比 */
  --primary-color: #3f63c9;
  --primary-btn-border-color: #3452ab;
  --primary-btn-text-color: #ffffff;
  --focus-ring-color: #3f63c9;

  --md-char-color: #9aa5c4;
  --meta-content-color: #5b6b96;
  --rawblock-edit-panel-bd: #eef2fa;
  --code-bg: #eaeff9;
  --code-edge: #ccd8ef;
  --item-hover-bg-color: #e3e9f7;
  --item-hover-text-color: #1a2038;
  --active-file-bg-color: #dde5f8;
  --active-file-text-color: #1a2038;
  --active-file-border-color: #3f63c9;
  --color-popover-bg-color: #f2f5fc;
  --search-select-bg-color: #cfdcff;
  --search-select-text-color: #1a2038;

  --font-size: 16px;
  --line-height: 1.7;
  --content-max-width: 1400px;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(42, 49, 80, 0.1);

  /* --- 代码配色：白底上要压深才够对比 --- */
  --code-keyword: #8250df;
  --code-string: #1a7f37;
  --code-comment: #8f9ab8;
  --code-number: #953800;
  --code-type: #9a6700;
  --code-function: #0550ae;
  --code-property: #cf222e;
  --code-variable: #2a3150;
  --code-punct: #5b6688;
  --code-tag: #cf222e;
  --code-meta: #9a6700;
}
`
  },
  {
    id: 'moon-dark',
    css: `/**
 * @name 月之暗面
 * @dark true
 *
 * 深夜版：底色是带蓝的墨黑，正文是柔和的月色，而不是刺眼的纯白。
 *
 * 深色主题最容易犯的错是"白字黑底"——对比度过高，看半小时就累。
 * 所以正文用 #c7cfe4 而不是 #ffffff，底色也不用纯黑。
 */
:root {
  --bg-color: #0b0f1c;
  --text-color: #c7cfe4;
  --select-text-bg-color: #2c3a63;
  --select-text-font-color: #eef2fb;

  --side-bar-bg-color: #111730;
  --control-text-color: #8b97b8;
  --control-text-hover-color: #e4e9f7;
  --blur-text-color: #66719a;
  --active-toggle-btn-color: #2c3a63;

  --window-border-color: #232c4c;
  --window-border: 1px solid #232c4c;
  --table-border-color: #232c4c;
  --panel-border-color: #232c4c;
  --heading-char-color: #33406b;
  --drag-placeholder-color: #33406b;

  /* 月光蓝。深色底上要提亮才够对比，与亮面正好相反 */
  --primary-color: #7aa2f7;
  --primary-btn-border-color: #9ab8ff;
  /* 按钮文字用底色：浅蓝底上配白字会糊成一团 */
  --primary-btn-text-color: #0b0f1c;
  --focus-ring-color: #7aa2f7;

  --md-char-color: #4d5878;
  --meta-content-color: #7f8bb0;
  --rawblock-edit-panel-bd: #111730;
  --code-bg: #060912;
  --code-edge: #26304a;
  --item-hover-bg-color: #1a2140;
  --item-hover-text-color: #e4e9f7;
  --active-file-bg-color: #1e2749;
  --active-file-text-color: #e4e9f7;
  --active-file-border-color: #7aa2f7;
  --color-popover-bg-color: #131a35;
  --search-select-bg-color: #2c3a63;
  --search-select-text-color: #eef2fb;

  --font-size: 16px;
  --line-height: 1.75;
  --content-max-width: 1400px;
  --radius: 8px;
  /* 深色下的阴影要更重才看得出层次，浅色的那点阴影在这里等于没有 */
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.45);

  /* --- 代码配色：黑底上要提亮，但别用纯饱和色——
         在暗背景上高饱和度的文字会"发光"，久看刺痛 --- */
  --code-keyword: #c792ea;
  --code-string: #98d982;
  --code-comment: #66719a;
  --code-number: #f0a45d;
  --code-type: #e5c07b;
  --code-function: #7aa2f7;
  --code-property: #ef8f8f;
  --code-variable: #c7cfe4;
  --code-punct: #8b97b8;
  --code-tag: #ef8f8f;
  --code-meta: #e5c07b;
}
`
  }
]
