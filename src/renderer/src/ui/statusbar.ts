import type { EditorView } from '@codemirror/view'

/**
 * 状态栏：词数 / 字符数 / 行数，以及光标位置。
 *
 * 计数遵循中英混排文本的通行约定：每个 CJK 表意文字或假名单独算一个词，
 * 而连续的拉丁文字各算一个词。简单地按空白切分会把一个中文段落算成一个词。
 */

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const WORD_CHAR = /[A-Za-z0-9_\u00c0-\u024f]/

export interface Counts {
  words: number
  characters: number
  charactersNoSpaces: number
  lines: number
}

export function countText(text: string): Counts {
  let words = 0
  let inLatinRun = false

  for (const ch of text) {
    if (CJK.test(ch)) {
      words += 1
      inLatinRun = false
    } else if (WORD_CHAR.test(ch)) {
      if (!inLatinRun) {
        words += 1
        inLatinRun = true
      }
    } else {
      inLatinRun = false
    }
  }

  return {
    words,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    lines: text.length === 0 ? 0 : text.split('\n').length
  }
}

export interface StatusBarHandlers {
  onToggleWordCount?: () => void
}

export class StatusBar {
  private host: HTMLElement
  private el: {
    counts: HTMLElement
    position: HTMLElement
    mode: HTMLElement
    doc: HTMLElement
  }

  constructor(host: HTMLElement) {
    this.host = host
    this.host.innerHTML = `
      <span class="stat clickable" data-role="counts" title="字数统计"></span>
      <span class="stat" data-role="doc"></span>
      <span class="spacer"></span>
      <span class="stat" data-role="mode"></span>
      <span class="stat" data-role="position"></span>
    `
    this.el = {
      counts: this.host.querySelector('[data-role="counts"]') as HTMLElement,
      position: this.host.querySelector('[data-role="position"]') as HTMLElement,
      mode: this.host.querySelector('[data-role="mode"]') as HTMLElement,
      doc: this.host.querySelector('[data-role="doc"]') as HTMLElement
    }
  }

  onClick(handler: () => void): void {
    this.el.counts.addEventListener('click', handler)
  }

  setVisible(visible: boolean): void {
    this.host.hidden = !visible
  }

  updateFromView(view: EditorView, mode: string, docName: string): void {
    const text = view.state.doc.toString()
    const counts = countText(text)
    // 状态栏沿用 通行的中文措辞习惯：字数与字符数直接给数字，
    // 不写成 "N words" 这种英文语序。
    this.el.counts.textContent = `${counts.words} 字 · ${counts.characters} 字符`
    this.el.counts.title =
      `字数 ${counts.words} · 字符 ${counts.characters} · ` +
      `不计空格 ${counts.charactersNoSpaces} · 行数 ${counts.lines}`
    this.el.mode.textContent = mode
    this.el.doc.textContent = docName

    const range = view.state.selection.main
    const line = view.state.doc.lineAt(range.head)
    const column = range.head - line.from + 1
    this.el.position.textContent = `第 ${line.number} 行，第 ${column} 列`
  }
}
