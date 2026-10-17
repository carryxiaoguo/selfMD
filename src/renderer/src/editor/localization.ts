import { EditorState } from '@codemirror/state'

/**
 * CodeMirror 界面文案的中文化。
 *
 * CodeMirror 6 **自带**本地化机制：面板里的每个按钮、标签、输入框提示都是通过
 * `phrase(view, "next")` 取词的，而 `EditorState.phrases` 这个 Facet 就是用来
 * 注册译文的（`@codemirror/state` 的类型声明里写明："Registers translation
 * phrases. The `phrase` method will look through all objects registered with
 * this facet to find translations for its argument."）。
 *
 * 所以正确做法是注册这张表，而不是用 CSS 的 `::after` 把原生英文盖掉。
 * 伪元素方案有两个问题：
 *   1. **破坏可访问性**——读屏软件读到的仍是英文原文
 *   2. 依赖 DOM 结构，CodeMirror 改版就会失效
 *
 * 键名必须与包里的调用完全一致（大小写敏感）。下面是扫
 * `@codemirror/search` 的 `dist/index.js` 提取出的全部 10 个键。
 * 多注册几个无害，注册错了只是不生效，不会报错——所以宁可多列。
 */
export const cjkPhrase: Record<string, string> = {
  // --- @codemirror/search 实测用到的 10 个 ---
  Find: '查找',
  Replace: '替换为',
  next: '下一个',
  previous: '上一个',
  all: '全选',
  'replace all': '全部替换',
  close: '关闭',
  'match case': '区分大小写',
  regexp: '正则表达式',
  'by word': '全词匹配',

  // --- 名称变体：包在不同版本里用过不同写法，一并给出 ---
  replace: '替换',
  'Replace all': '全部替换',
  'Match case': '区分大小写',
  'By word': '全词匹配',
  'go to line': '跳转到行',
  'Go to line': '跳转到行',
  line: '行号',
  go: '跳转',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'on line': '位于第'
}

/** 注册中文界面文案。放在编辑器扩展里即可全局生效。 */
export const uiLocalization = EditorState.phrases.of(cjkPhrase)
