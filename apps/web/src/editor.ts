import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { slideGutter, type SlideGutterOptions } from './slide-gutter.js';

/**
 * 先頭のフロントマター（`---` から `---` まで）を、ひとまとまりにする。
 * これがないと、閉じる `---` で直前の行が見出し（setext）として色付けされてしまう。
 */
const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true, style: tags.meta }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
        const start = cx.lineStart;
        while (cx.nextLine()) {
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt('Frontmatter', start, cx.prevLineEnd()));
        return true;
      },
    },
  ],
};

/** 書いている文字の色分け。見出しは太字、記号（`#`・`-`・`{…}` など）は控えめにする */
const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--cm-link)' },
  { tag: tags.monospace, color: 'var(--cm-code)' },
  { tag: [tags.meta, tags.processingInstruction, tags.contentSeparator], color: 'var(--cm-muted)' },
  { tag: tags.quote, color: 'var(--cm-muted)' },
]);

export interface EditorOptions {
  text: string;
  onChange(text: string): void;
  onSave(): void;
  onPresent(): void;
  /** カーソルのある行が変わった（1 から始まる行番号） */
  onCursor(line: number): void;
  /** 行番号欄の目印（#74） */
  gutter: SlideGutterOptions;
}

export interface Editor {
  view: EditorView;
  /** 別の資料を開いたとき：中身を入れ替え、元に戻す履歴も消す */
  setText(text: string): void;
}

/** Markdown のエディタ（CodeMirror 6。設計プラン §9） */
export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  const run = (action: () => void) => () => {
    action();
    return true;
  };
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    highlightSelectionMatches(),
    markdown({ extensions: [frontmatter] }),
    syntaxHighlighting(highlight),
    EditorView.lineWrapping,
    keymap.of([
      { key: 'Mod-s', run: run(options.onSave), preventDefault: true },
      { key: 'F5', run: run(options.onPresent), preventDefault: true },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    slideGutter(options.gutter),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString());
      if (update.selectionSet || update.docChanged) {
        options.onCursor(update.state.doc.lineAt(update.state.selection.main.head).number);
      }
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown' }),
  ];
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: options.text, extensions }),
  });
  return {
    view,
    setText(text) {
      view.setState(EditorState.create({ doc: text, extensions }));
    },
  };
}
