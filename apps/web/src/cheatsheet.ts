import {
  ATTRIBUTE_KEYS,
  CONTAINERS,
  DIRECTIVES,
  FRONTMATTER_KEYS,
  LAYOUTS,
  LAYOUT_SUMMARIES,
  type AttrKey,
} from '@mds/core';

/**
 * 早見表（#75）と挿入メニューの項目。早見表は、役割（何をしたいか）ごとに分けて並べる（#99）。
 * 項目は core の構文の定義（属性・コンテナ・指示・レイアウト・フロントマター）から作るので、
 * 構文を足したときは、下の分け方（CHEAT_SECTIONS）にも足す（足し忘れはテストで分かる）。
 */

/** 挿入メニューの項目：書き方の雛形 */
export interface Snippet {
  label: string;
  hint: string;
  text: string;
  /** 入れた後のカーソルの位置（text の中の何文字目）。なければ最後 */
  cursor?: number;
}

/** 挿入メニュー（空の行で `/`）に出す、よく使う雛形 */
export const SNIPPETS: Snippet[] = [
  { label: '横に並べる', hint: ':::row', text: ':::row\n\n:::', cursor: 7 },
  { label: '縦に並べる', hint: ':::stack', text: ':::stack\n\n:::', cursor: 9 },
  { label: '段階表示（ここで止める）', hint: '. . .', text: '. . .\n' },
  { label: '1つずつ表示', hint: ':::steps', text: ':::steps\n- \n:::', cursor: 11 },
  { label: '背景画像', hint: '{bg}', text: '![](bg.jpg){bg}', cursor: 4 },
  { label: '左半分を画像に', hint: '{bg=left}', text: '![](photo.jpg){bg=left}', cursor: 4 },
  { label: 'タイトルスライド', hint: '::maketitle', text: '::maketitle\n' },
  {
    label: '図（Mermaid）',
    hint: '```mermaid',
    text: '```mermaid\nflowchart LR\n  A --> B\n```',
    cursor: 11,
  },
  { label: '数式', hint: '$$', text: '$$\n\n$$', cursor: 3 },
  { label: '発表者ノート', hint: ':::notes', text: ':::notes\n\n:::', cursor: 9 },
  { label: '1枚にまとめる', hint: ':::keep', text: ':::keep\n\n:::', cursor: 8 },
];

/** 構文の定義にはない、基本の書き方（見出し・区切り・画像・コードなど） */
const BASICS: Record<string, Snippet> = {
  chapter: { label: '章（章扉のスライドになる）', hint: '# 章の名前', text: '# ', cursor: 2 },
  slide: { label: 'スライドの見出し', hint: '## 見出し', text: '## ', cursor: 3 },
  break: { label: '見出しなしで次のスライドへ', hint: '---', text: '---\n\n' },
  image: { label: '画像・動画を入れる', hint: '![説明](a.png)', text: '![](a.png)', cursor: 2 },
  code: { label: 'コード', hint: '```ts', text: '```ts\n\n```', cursor: 6 },
  inlineMath: { label: '文中の数式', hint: '$x^2$', text: '$$', cursor: 1 },
};

/** 属性の値の候補（サジェストと早見表で使う） */
export const valueOptions = (key: AttrKey): string[] => {
  const v = key.value;
  if (v.type === 'enum' || v.type === 'flag-or-enum') return [...v.values];
  if (v.type === 'position') {
    return [
      'top',
      'bottom',
      'left',
      'right',
      'center',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ];
  }
  return [];
};

/** 早見表に出す、属性の書き方の例（`{width=40%}` など） */
function attrSample(key: AttrKey): string {
  const v = key.value;
  switch (v.type) {
    case 'flag':
    case 'flag-or-enum':
    case 'flag-or-int':
      return key.name;
    case 'enum':
      return `${key.name}=${v.values[0]}`;
    case 'number':
      return `${key.name}=${v.max !== undefined ? (v.min + v.max) / 2 : v.min}`;
    case 'length':
      return `${key.name}=40%`;
    case 'ratio':
      return `${key.name}=3:2`;
    case 'position':
      return `${key.name}=top`;
    case 'string':
      return `${key.name}="…"`;
    case 'path':
      return `${key.name}=…`;
  }
}

/** 早見表の1行 */
export interface CheatItem {
  label: string;
  code: string;
  snippet: Snippet;
  /** 分類の見出し */
  group: string;
}

/** 分類の中の項目：雛形・基本の書き方・属性・コンテナ・指示・レイアウト・フロントマター */
type Entry =
  | { snippet: string }
  | { basic: keyof typeof BASICS }
  /** sample：書き方の例（既定の値より、よく使う値を見せたいとき） */
  | { attr: string; sample?: string }
  | { container: string }
  | { directive: string }
  | { layouts: true }
  | { frontmatter: true };

/** 分類と、その中の並び（書く順・よく使う順） */
export const CHEAT_SECTIONS: ReadonlyArray<{
  group: string;
  /** 分類へ飛ぶボタンの名前 */
  short: string;
  entries: readonly Entry[];
}> = [
  {
    group: 'スライドの区切りと構成',
    short: '構成',
    entries: [
      { basic: 'chapter' },
      { basic: 'slide' },
      { basic: 'break' },
      { snippet: 'タイトルスライド' },
      { directive: 'maketitle' },
      { container: 'maketitle' },
      { attr: 'variant' },
      { snippet: '1枚にまとめる' },
      { container: 'keep' },
      { attr: 'keep' },
      { attr: 'hidden' },
    ],
  },
  {
    group: '並べ方',
    short: '並べ方',
    entries: [
      { snippet: '横に並べる' },
      { container: 'row' },
      { snippet: '縦に並べる' },
      { container: 'stack' },
      { layouts: true },
      { attr: 'layout' },
      { attr: 'ratio' },
      { attr: 'media' },
      { attr: 'align' },
    ],
  },
  {
    group: '段階表示',
    short: '段階表示',
    entries: [
      { snippet: '段階表示（ここで止める）' },
      { snippet: '1つずつ表示' },
      { container: 'steps' },
      { attr: 'step' },
      { attr: 'lines', sample: 'lines="1|2-3"' },
    ],
  },
  {
    group: '画像・動画',
    short: '画像・動画',
    entries: [
      { basic: 'image' },
      { attr: 'width' },
      { attr: 'caption' },
      { attr: 'autoplay' },
      { attr: 'loop' },
      { attr: 'muted' },
      { attr: 'controls' },
      { attr: 'poster' },
    ],
  },
  {
    group: '背景',
    short: '背景',
    entries: [
      { snippet: '背景画像' },
      { snippet: '左半分を画像に' },
      { attr: 'bg' },
      { attr: 'dim' },
      { attr: 'blur', sample: 'blur=8' },
      { attr: 'fit', sample: 'fit=contain' },
      { attr: 'fill', sample: 'fill=blur' },
      { attr: 'pos' },
    ],
  },
  {
    group: '図・数式・コード',
    short: '図・数式',
    entries: [
      { snippet: '図（Mermaid）' },
      { snippet: '数式' },
      { basic: 'inlineMath' },
      { basic: 'code' },
      { attr: 'scenario' },
      { attr: 'captions' },
      { attr: 'focus' },
    ],
  },
  {
    group: '発表者ノート',
    short: 'ノート',
    entries: [{ snippet: '発表者ノート' }, { container: 'notes' }],
  },
  {
    group: '資料全体の設定（フロントマター）',
    short: '資料全体',
    entries: [{ frontmatter: true }],
  },
];

const item = (group: string, snippet: Snippet): CheatItem => ({
  label: snippet.label,
  code: snippet.hint,
  snippet,
  group,
});

/** 分類の項目を、早見表の行にする（定義にない名前は undefined） */
function itemsOf(group: string, entry: Entry): CheatItem[] | undefined {
  if ('snippet' in entry) {
    const s = SNIPPETS.find((x) => x.label === entry.snippet);
    return s && [item(group, s)];
  }
  if ('basic' in entry) return [item(group, BASICS[entry.basic]!)];
  if ('attr' in entry) {
    const k = ATTRIBUTE_KEYS.find((x) => x.name === entry.attr);
    if (!k) return undefined;
    const sample = `{${entry.sample ?? attrSample(k)}}`;
    return [item(group, { label: k.summary, hint: sample, text: sample })];
  }
  if ('container' in entry) {
    const c = CONTAINERS.find((x) => x.name === entry.container);
    return (
      c && [
        item(group, {
          label: c.summary,
          hint: `:::${c.name}`,
          text: `:::${c.name}\n\n:::`,
          cursor: c.name.length + 4,
        }),
      ]
    );
  }
  if ('directive' in entry) {
    const d = DIRECTIVES.find((x) => x.name === entry.directive);
    return d && [item(group, { label: d.summary, hint: `::${d.name}`, text: `::${d.name}\n` })];
  }
  if ('layouts' in entry) {
    return LAYOUTS.map((l) =>
      item(group, {
        label: `レイアウト：${LAYOUT_SUMMARIES[l]}`,
        hint: `{layout=${l}}`,
        text: ` {layout=${l}}`,
      }),
    );
  }
  return FRONTMATTER_KEYS.map((k) =>
    item(group, { label: k.summary, hint: `${k.name}:`, text: `${k.name}: ` }),
  );
}

/**
 * 早見表の項目（分類の順）。同じ書き方は1回だけ出す（雛形があれば雛形を使い、
 * 同じ書き方の属性・コンテナは出さない。`{layout=…}` は、レイアウトごとの行があるので出さない）
 */
export function cheatSheet(): CheatItem[] {
  const items: CheatItem[] = [];
  const seen = new Set<string>();
  for (const { group, entries } of CHEAT_SECTIONS) {
    for (const entry of entries) {
      if ('attr' in entry && entry.attr === 'layout') continue;
      for (const it of itemsOf(group, entry) ?? []) {
        if (seen.has(it.code)) continue;
        seen.add(it.code);
        items.push(it);
      }
    }
  }
  return items;
}

/** 早見表の分類の見出しと、その中の項目（検索の文字で絞る。空の分類は出さない） */
export function cheatGroups(
  items: readonly CheatItem[],
  query: string,
): Array<{ group: string; short: string; items: CheatItem[] }> {
  const q = query.trim();
  const hit = (it: CheatItem) =>
    !q || it.label.includes(q) || it.code.includes(q) || it.group.includes(q);
  return CHEAT_SECTIONS.map(({ group, short }) => ({
    group,
    short,
    items: items.filter((it) => it.group === group && hit(it)),
  })).filter((g) => g.items.length > 0);
}
