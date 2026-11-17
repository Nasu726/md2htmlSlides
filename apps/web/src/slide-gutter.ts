import type { Diagnostic } from '@mds/core';
import { lintGutter, setDiagnostics, type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, type DecorationSet } from '@codemirror/view';
import type { SlideInfo } from './renderer.js';

/**
 * 行番号欄の目印（#74、設計プラン §9.2）。
 * - スライドの始まり：スライドの番号（隠したスライドは「隠」）
 * - 自動分割で区切られた位置：点線と「自動」。クリックすると「ここで区切りを固定」「1枚にまとめる」を選べる
 */
export const setSlideMap = StateEffect.define<SlideInfo[]>();

const slideMapField = StateField.define<SlideInfo[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setSlideMap)) return effect.value;
    return value;
  },
});

class SlideMarker extends GutterMarker {
  constructor(
    readonly label: string,
    readonly auto: boolean,
    readonly title: string,
  ) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof SlideMarker && other.label === this.label && other.auto === this.auto;
  }
  override toDOM(): Node {
    const el = document.createElement('span');
    el.className = this.auto ? 'cm-slide-marker is-auto' : 'cm-slide-marker';
    el.textContent = this.label;
    el.title = this.title;
    return el;
  }
}

/** 行ごとの目印（同じ行から始まるスライドが複数あれば、まとめて1つにする） */
function markersOf(state: EditorView['state']) {
  const map = state.field(slideMapField);
  const byLine = new Map<number, { labels: string[]; auto: boolean }>();
  let shown = 0;
  for (const slide of map) {
    if (!slide.hidden) shown++;
    const line = Math.min(Math.max(1, slide.start), state.doc.lines);
    const entry = byLine.get(line) ?? { labels: [], auto: false };
    entry.labels.push(slide.hidden ? '隠' : String(shown));
    entry.auto ||= slide.auto;
    byLine.set(line, entry);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, { labels, auto }]) => ({
      line,
      auto,
      label: auto ? `自動 ${labels.join('·')}` : labels.join('·'),
    }));
}

const autoBreak = Decoration.line({ class: 'cm-auto-break' });

/** 自動で区切られた行の上に、点線を引く */
const autoBreakLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    if (!tr.effects.some((e) => e.is(setSlideMap)) && !tr.docChanged) return value;
    const ranges = markersOf(tr.state)
      .filter((m) => m.auto)
      .map((m) => autoBreak.range(tr.state.doc.line(m.line).from));
    return Decoration.set(ranges, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface SlideGutterOptions {
  /** 自動の目印をクリックした（メニューを出す）。line は 1 から始まる行番号 */
  onAutoBreak(line: number, rect: DOMRect): void;
  /** スライドの番号をクリックした（プレビューでそのスライドを見せる） */
  onSlide(index: number): void;
}

export function slideGutter(options: SlideGutterOptions): Extension {
  return [
    slideMapField,
    autoBreakLines,
    gutter({
      class: 'cm-slide-gutter',
      markers: (view) =>
        RangeSet.of(
          markersOf(view.state).map((m) =>
            new SlideMarker(
              m.label,
              m.auto,
              m.auto
                ? '自動で区切られた位置。クリックすると、区切りを固定するか、1枚にまとめられます'
                : 'このスライドをプレビューで表示',
            ).range(view.state.doc.line(m.line).from),
          ),
        ),
      domEventHandlers: {
        mousedown(view, block, event) {
          const line = view.state.doc.lineAt(block.from).number;
          const map = view.state.field(slideMapField);
          const index = map.findIndex((s) => Math.max(1, s.start) === line);
          if (index < 0) return false;
          const target = event.target as HTMLElement;
          if (map[index]!.auto) {
            options.onAutoBreak(line, target.getBoundingClientRect());
          } else {
            options.onSlide(index);
          }
          event.preventDefault();
          return true;
        },
      },
    }),
    lintGutter(),
  ];
}

/**
 * カーソルのある行を含むスライド（何枚目か。隠したスライドも数える）。
 * 最初のスライドより前（フロントマター）は、最初のスライド（タイトル）にする
 */
export function slideAt(view: EditorView, line: number): number {
  const map = view.state.field(slideMapField);
  let found = map.length > 0 ? 0 : -1;
  for (const [i, slide] of map.entries()) {
    if (slide.start <= line) found = i;
    else break;
  }
  return found;
}

/** 何枚目のスライドの、始まりの行 */
export function slideStart(view: EditorView, index: number): number | undefined {
  return view.state.field(slideMapField)[index]?.start;
}

/** 「ここで区切りを固定」：自動で区切られた行の前に `---` を入れる（前に空行がなければ空行も入れる） */
export function fixBreak(view: EditorView, line: number): void {
  const at = view.state.doc.line(line);
  const prev = line > 1 ? view.state.doc.line(line - 1).text : '';
  const insert = `${prev.trim() === '' ? '' : '\n'}---\n\n`;
  view.dispatch({ changes: { from: at.from, insert }, scrollIntoView: true });
  view.focus();
}

/**
 * 「1枚にまとめる」：自動で分けられた節の見出しに `{keep}` を付ける。
 * 見出しがなければ（`---` で始まる区切りなど）、区切りの始まりに `{keep}` だけの行を入れる。
 */
export function keepSection(view: EditorView, line: number): void {
  const map = view.state.field(slideMapField);
  const index = map.findIndex((s) => s.start === line);
  // 自動で分けられたスライドの前にある、最初のスライド（節の始まり）
  let first = index;
  while (first > 0 && map[first]!.auto) first--;
  const startLine = Math.max(1, map[first]?.start ?? line);
  const doc = view.state.doc;
  const heading = doc.line(Math.min(startLine, doc.lines));
  let changes: { from: number; to?: number; insert: string };
  if (/^#{1,6}\s/.test(heading.text)) {
    const attrs = /\s\{([^{}]*)\}\s*$/.exec(heading.text);
    if (attrs) {
      if (/(^|\s)keep(\s|$)/.test(attrs[1]!)) return;
      const close = heading.from + attrs.index + attrs[0].lastIndexOf('}');
      changes = { from: close, insert: attrs[1]!.trim() ? ' keep' : 'keep' };
    } else {
      changes = { from: heading.to, insert: ' {keep}' };
    }
  } else {
    changes = { from: heading.from, insert: '{keep}\n\n' };
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

/** 警告を、行番号欄の印と波線で出す（カーソルを合わせると内容が出る） */
export function setWarnings(view: EditorView, diagnostics: Diagnostic[]): void {
  const doc = view.state.doc;
  const lint: LintDiagnostic[] = diagnostics.map((d) => {
    const line = doc.line(Math.min(Math.max(1, d.line), doc.lines));
    return {
      from: line.from,
      to: line.to,
      severity: d.severity === 'error' ? 'error' : d.severity === 'info' ? 'info' : 'warning',
      message: d.message,
      source: d.code,
    };
  });
  view.dispatch(setDiagnostics(view.state, lint));
}

/** スライドの対応表を、エディタに渡す */
export function setSlides(view: EditorView, map: SlideInfo[]): void {
  view.dispatch({ effects: setSlideMap.of(map) });
}
