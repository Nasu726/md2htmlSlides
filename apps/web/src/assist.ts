import {
  acceptCompletion,
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, type Tooltip } from '@codemirror/view';
import {
  ARCH_KEYWORDS,
  ARCH_KIND_SUMMARIES,
  ARCH_NODE_KINDS,
  ATTRIBUTE_KEYS,
  CONTAINERS,
  DIRECTIVES,
  FRONTMATTER_KEYS,
  LAYOUTS,
  LAYOUT_SUMMARIES,
  findAttributeKey,
  findFrontmatterKey,
  parseArch,
  type AttrPlace,
} from '@mds/core';
import { SNIPPETS, valueOptions, type Snippet } from './cheatsheet.js';

/**
 * 入力の補助（#75、設計プラン §9.3）。候補・説明は、すべて core の構文の定義（syntax/）から作る。
 * - サジェスト：書いている場所に合う候補だけを出す（文章を書いているときは出さない）
 * - 挿入メニュー：空の行で `/`
 * - 構文ヒント：カーソルを合わせたときの説明
 */
export interface AssistOptions {
  /** 開いているフォルダ・一緒に選んだファイル（`![](` の中の候補。資料のフォルダからの相対パス） */
  files(): string[];
  /** この行を含むスライドの、今のレイアウト（`layout=` の値のヒントに出す） */
  layoutAt(line: number): string | undefined;
}

/** 構文仕様の該当箇所の URL */
export const docUrl = (anchor: string) =>
  `https://github.com/Nasu726/md2htmlSlides/blob/main/docs/${anchor.replace(/#(.*)$/, (_, hash: string) => `#${encodeURIComponent(hash)}`)}`;

/** フロントマターの中か（1行目が `---` で、まだ閉じていない） */
function inFrontmatter(context: CompletionContext): boolean {
  const doc = context.state.doc;
  if (doc.line(1).text.trim() !== '---') return false;
  const line = doc.lineAt(context.pos).number;
  if (line === 1) return false;
  for (let n = 2; n < line; n++) if (/^(---|\.\.\.)\s*$/.test(doc.line(n).text)) return false;
  return true;
}

/** 行の種類から、`{` の属性を書ける場所を決める */
function placeOf(lineText: string, before: string): AttrPlace {
  if (/^#{1,6}\s/.test(lineText)) return 'slide';
  if (/^\s*\{[^{}]*$/.test(before)) return 'slide'; // `{…}` だけの行：それを含むスライド
  if (/^\s*(`{3,}|~{3,})\s*arch\b/.test(lineText)) return 'arch';
  if (/^\s*(`{3,}|~{3,})/.test(lineText)) return 'code';
  const container = /^\s*:{3,}\s*([\w-]+)/.exec(lineText);
  if (container) return container[1] === 'maketitle' ? 'maketitle' : 'container';
  if (/!\[[^\]]*\]\([^)]*\)\{[^{}]*$/.test(before)) {
    return /\.arch\)\{/.test(before) ? 'arch' : 'media';
  }
  return 'block';
}

const PLACE_NAMES: Record<AttrPlace, string> = {
  slide: 'スライド',
  block: '要素',
  media: '画像・動画',
  code: 'コード',
  container: 'コンテナ',
  arch: '動く構成図',
  maketitle: 'タイトルスライド',
};

/** 候補を入れて、続けて値の候補を出す（`layout=` を選んだら、レイアウトの一覧を出す） */
const thenSuggest =
  (text: string) => (view: EditorView, _c: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    setTimeout(() => startCompletion(view), 0);
  };

/** `{` の後：その場所で使える属性と、`key=` の後の値 */
function attributeCompletions(
  context: CompletionContext,
  options: AssistOptions,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const brace = /\{([^{}]*)$/.exec(before);
  if (!brace) return null;
  const inside = brace[1]!;
  // 値：`key=` の後
  const value = /(?:^|\s)([\w-]+)=("?)([^\s"]*)$/.exec(inside);
  if (value) {
    const key = findAttributeKey(value[1]!);
    if (!key) return null;
    const from = context.pos - value[3]!.length;
    if (key.name === 'layout') {
      const now = options.layoutAt(line.number);
      const section = { name: now ? `layout の値・このスライドは今 ${now}` : 'layout の値' };
      return {
        from,
        options: LAYOUTS.map((name, i) => ({
          label: name,
          detail: LAYOUT_SUMMARIES[name],
          type: 'enum',
          boost: name === now ? 1 : -i,
          section,
        })),
        validFor: /^[\w-]*$/,
      };
    }
    const values = valueOptions(key);
    if (values.length === 0) return null;
    const section = { name: `${key.name} の値` };
    return {
      from,
      options: values.map((label) => ({ label, type: 'enum', section })),
      validFor: /^[\w-]*$/,
    };
  }
  // キー
  const word = /([\w-]*)$/.exec(inside)!;
  const from = context.pos - word[1]!.length;
  if (!context.explicit && word[1] === '' && !/(^|\s)$/.test(inside)) return null;
  const place = placeOf(line.text, before);
  const used = new Set(Array.from(inside.matchAll(/(?:^|\s)([\w-]+)(?==|\s|$)/g), (m) => m[1]!));
  const keys = ATTRIBUTE_KEYS.filter((key) => key.places.includes(place) && !used.has(key.name));
  const section = { name: `属性（${PLACE_NAMES[place]}）` };
  return {
    from,
    options: keys.map((key): Completion => ({
      label: key.name,
      detail: key.summary,
      type: 'property',
      apply: key.value.type === 'flag' ? key.name : thenSuggest(`${key.name}=`),
      section,
    })),
    validFor: /^[\w-]*$/,
  };
}

/** フロントマター：行頭はキー、`key: ` の後は値 */
function frontmatterCompletions(context: CompletionContext): CompletionResult | null {
  if (!inFrontmatter(context)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const value = /^([\w-]+):\s*(\S*)$/.exec(before);
  if (value) {
    const key = findFrontmatterKey(value[1]!);
    if (!key) return null;
    const from = context.pos - value[2]!.length;
    const v = key.value;
    const values =
      v.type === 'enum'
        ? v.values.map(String)
        : v.type === 'boolean'
          ? ['true', 'false']
          : v.type === 'date'
            ? ['today']
            : [];
    if (values.length === 0) return null;
    return {
      from,
      options: values.map((label) => ({
        label,
        type: 'enum',
        ...(String(key.default) === label ? { detail: '既定' } : {}),
      })),
    };
  }
  const key = /^([\w-]*)$/.exec(before);
  if (!key || (!context.explicit && key[1] === '')) return null;
  return {
    from: line.from,
    options: FRONTMATTER_KEYS.map((k) => ({
      label: k.name,
      detail: k.summary,
      type: 'property',
      apply: thenSuggest(`${k.name}: `),
    })),
    validFor: /^[\w-]*$/,
  };
}

/** 行頭の `:::`（コンテナ）と `::`（指示）。コンテナは閉じる `:::` まで入れる */
function blockCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const container = /^(:{3,})([\w-]*)$/.exec(before);
  if (container) {
    const colons = container[1]!;
    return {
      from: line.from + colons.length,
      options: CONTAINERS.map((c) => ({
        label: c.name,
        detail: c.summary,
        type: 'keyword',
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          view.dispatch({
            changes: { from, to, insert: `${c.name}\n\n${colons}` },
            selection: { anchor: from + c.name.length + 1 },
          });
        },
      })),
      validFor: /^[\w-]*$/,
    };
  }
  const directive = /^::([\w-]*)$/.exec(before);
  if (directive) {
    return {
      from: line.from + 2,
      options: DIRECTIVES.map((d) => ({ label: d.name, detail: d.summary, type: 'keyword' })),
      validFor: /^[\w-]*$/,
    };
  }
  return null;
}

/** よく使うコードの言語名（色分けは Shiki が知っている言語ならすべてできる） */
const LANGUAGES = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'yaml',
  'toml',
  'html',
  'css',
  'scss',
  'md',
  'sh',
  'bash',
  'python',
  'ruby',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'php',
  'sql',
  'dockerfile',
  'diff',
  'graphql',
  'lua',
  'r',
];

/** ```` ``` ```` の後：図にする言語と、コードの言語名 */
function fenceCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = /^\s*(`{3,}|~{3,})([\w-]*)$/.exec(before);
  if (!m) return null;
  return {
    from: context.pos - m[2]!.length,
    options: [
      { label: 'mermaid', detail: 'Mermaid の図', type: 'keyword', boost: 3 },
      { label: 'math', detail: '数式（KaTeX）', type: 'keyword', boost: 2 },
      { label: 'arch', detail: '動く構成図', type: 'keyword', boost: 1 },
      ...LANGUAGES.map((label) => ({ label, type: 'text' })),
    ],
    validFor: /^[\w-]*$/,
  };
}

/** カーソルが ```arch のコードブロックの中なら、その中身（カーソルの行の前まで）。違えば undefined */
function archBlockBefore(context: CompletionContext): string | undefined {
  const doc = context.state.doc;
  const current = doc.lineAt(context.pos).number;
  const lines: string[] = [];
  for (let n = current - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    if (/^\s*(`{3,}|~{3,})/.test(text)) {
      return /^\s*(`{3,}|~{3,})\s*arch\b/.test(text) ? lines.reverse().join('\n') : undefined;
    }
    lines.push(text);
  }
  return undefined;
}

/**
 * 動く構成図（```arch）の中（#106）：行頭のキーワード、`[` の後のノードの種類、
 * 矢印の後と動きの行頭のノードの ID、`direction:` の値
 */
function archCompletions(context: CompletionContext): CompletionResult | null {
  const block = archBlockBefore(context);
  if (block === undefined) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const kind = /\[([\w-]*)$/.exec(before);
  if (kind) {
    return {
      from: context.pos - kind[1]!.length,
      options: ARCH_NODE_KINDS.map((name) => ({
        label: name,
        detail: ARCH_KIND_SUMMARIES[name],
        type: 'keyword',
      })),
      validFor: /^[\w-]*$/,
    };
  }
  const direction = /^\s*direction\s*:\s*(\w*)$/.exec(before);
  if (direction) {
    return {
      from: context.pos - direction[1]!.length,
      options: [
        { label: 'right', detail: '左から右（既定）', type: 'enum' },
        { label: 'down', detail: '上から下', type: 'enum' },
      ],
      validFor: /^\w*$/,
    };
  }
  const { diagram } = parseArch(block);
  const nodes = diagram.nodes.map((n) => ({ label: n.id, detail: n.label, type: 'variable' }));
  const target = /(?:<->|-->|->|--)\s*([\w-]*)$/.exec(before);
  if (target) {
    return { from: context.pos - target[1]!.length, options: nodes, validFor: /^[\w-]*$/ };
  }
  const head = /^(\s*)([\w-]*)$/.exec(before);
  if (!head || (!context.explicit && head[2]!.length === 0)) return null;
  const inScenario = /^scenario\s/m.test(block);
  return {
    from: context.pos - head[2]!.length,
    options: [
      ...ARCH_KEYWORDS.filter((k) => k.scenario === inScenario || k.name === 'scenario').map(
        (k) => ({ label: k.name, apply: k.insert, detail: k.summary, type: 'keyword', boost: 2 }),
      ),
      ...nodes,
    ],
    validFor: /^[\w-]*$/,
  };
}

/** `![…](` の中：画像・動画・図のファイル */
function fileCompletions(
  context: CompletionContext,
  options: AssistOptions,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = /!\[[^\]]*\]\(([^)\s]*)$/.exec(before);
  if (!m) return null;
  const files = options
    .files()
    .filter((path) => /\.(png|jpe?g|gif|webp|svg|avif|mp4|webm|mov|mmd|arch)$/i.test(path));
  if (files.length === 0) return null;
  const kind = (path: string) =>
    /\.(mp4|webm|mov)$/i.test(path) ? '動画' : /\.(mmd|arch)$/i.test(path) ? '図' : '画像';
  return {
    from: context.pos - m[1]!.length,
    options: files.map((path) => ({ label: path, type: 'text', detail: kind(path) })),
    validFor: /^[^)\s]*$/,
  };
}

/** 雛形を入れる（選んでいる範囲を置き換え、カーソルを雛形の中に置く） */
export function insertSnippet(view: EditorView, snippet: Snippet, from: number, to: number): void {
  view.dispatch({
    changes: { from, to, insert: snippet.text },
    selection: { anchor: from + (snippet.cursor ?? snippet.text.length) },
    scrollIntoView: true,
  });
}

/** 挿入メニュー：空の行で `/`（`/` の後に Esc を押せば、普通の文字のまま） */
function insertMenu(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = /^\/([^\s/]*)$/.exec(before);
  if (!m || line.text.length !== before.length) return null;
  const query = m[1]!;
  const section = { name: '挿入する' };
  return {
    from: line.from,
    filter: false,
    options: SNIPPETS.filter(
      (s) => !query || s.label.includes(query) || s.hint.includes(query),
    ).map((s) => ({
      label: s.label,
      detail: s.hint,
      type: 'text',
      section,
      apply: (view: EditorView, _c: Completion, from: number, to: number) =>
        insertSnippet(view, s, from, to),
    })),
  };
}

function hint(title: string, summary: string, anchor?: string, example?: string): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-syntax-hint';
  const h = document.createElement('b');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = summary;
  dom.append(h, p);
  if (example) {
    const pre = document.createElement('pre');
    pre.textContent = example;
    dom.append(pre);
  }
  if (anchor) {
    const a = document.createElement('a');
    a.href = docUrl(anchor);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '構文仕様を開く';
    dom.append(a);
  }
  return dom;
}

/** カーソルを合わせたときの説明：コンテナ・指示・属性・フロントマターのキー・`. . .` */
const syntaxHover = hoverTooltip((view, pos): Tooltip | null => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const at = pos - line.from;
  const make = (start: number, end: number, dom: HTMLElement): Tooltip => ({
    pos: line.from + start,
    end: line.from + end,
    above: true,
    create: () => ({ dom }),
  });
  const container = /^(\s*:{3,})\s*([\w-]+)/.exec(text);
  if (container && at <= container[0].length) {
    const def = CONTAINERS.find((c) => c.name === container[2]);
    if (def) {
      const dom = hint(
        `:::${def.name} — ${def.summary}`,
        '閉じる ::: までの中身に効く',
        def.docAnchor,
        `:::${def.name}\n…\n:::`,
      );
      return make(0, container[0].length, dom);
    }
  }
  const directive = /^::([\w-]+)/.exec(text);
  if (directive && at <= directive[0].length) {
    const def = DIRECTIVES.find((d) => d.name === directive[1]);
    if (def) return make(0, directive[0].length, hint(`::${def.name}`, def.summary, def.docAnchor));
  }
  if (/^\.[ \t]\.[ \t]\.\s*$/.test(text)) {
    const dom = hint(
      '. . . — 段階表示',
      'ここで止まり、次のキーで続きが出る',
      'syntax.md#51-一旦止める',
    );
    return make(0, text.length, dom);
  }
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const start = m.index;
    if (at < start || at > start + m[0].length) continue;
    for (const k of m[1]!.matchAll(/([\w-]+)(?:=("[^"]*"|[^\s"}]*))?/g)) {
      const kStart = start + 1 + k.index;
      if (at < kStart || at > kStart + k[0].length) continue;
      const key = findAttributeKey(k[1]!);
      if (!key) return null;
      const layout = k[2] && (LAYOUTS as readonly string[]).includes(k[2]) ? k[2] : undefined;
      const detail =
        key.name === 'layout' && layout
          ? `${layout}：${LAYOUT_SUMMARIES[layout as (typeof LAYOUTS)[number]]}`
          : key.summary;
      return make(kStart, kStart + k[0].length, hint(`{${key.name}}`, detail, key.docAnchor));
    }
  }
  const fm = /^([\w-]+):/.exec(text);
  if (fm && at <= fm[1]!.length && line.number > 1) {
    const key = findFrontmatterKey(fm[1]!);
    if (key) {
      const summary =
        key.summary + (key.default !== undefined ? `（既定：${String(key.default)}）` : '');
      return make(0, fm[1]!.length, hint(`${key.name}（フロントマター）`, summary, key.docAnchor));
    }
  }
  return null;
});

export function assist(options: AssistOptions): Extension {
  return [
    autocompletion({
      override: [
        insertMenu,
        frontmatterCompletions,
        blockCompletions,
        fenceCompletions,
        archCompletions,
        (context) => fileCompletions(context, options),
        (context) => attributeCompletions(context, options),
      ],
      icons: false,
    }),
    // サジェストが出ているときは、Tab でも候補を入れる（#98）。出ていなければ字下げに回す
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    syntaxHover,
  ];
}
