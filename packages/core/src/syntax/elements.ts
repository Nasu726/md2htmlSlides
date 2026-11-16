/**
 * 構文の定義（docs/design.md §9.3）のうち、属性・コンテナ・指示・レイアウト。
 * パーサの検証と、エディタのサジェスト・構文ヒントは、すべてこの定義から作る。
 */

export const LAYOUTS = [
  'title',
  'section',
  'stack',
  'split',
  'columns',
  'grid',
  'media',
  'statement',
] as const;
export type LayoutName = (typeof LAYOUTS)[number];

/** 属性を書ける場所 */
export type AttrPlace = 'slide' | 'block' | 'media' | 'code' | 'container' | 'arch' | 'maketitle';

export type AttrValueSpec =
  /** 値を書かない（`{keep}`） */
  | { type: 'flag' }
  /** 値なし、または決まった値（`{bg}`・`{bg=left}`） */
  | { type: 'flag-or-enum'; values: readonly string[] }
  /** 値なし、または正の整数（`{step}`・`{step=2}`） */
  | { type: 'flag-or-int' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'number'; min: number; max?: number }
  /** `40%` か `320px` */
  | { type: 'length' }
  /** `3:2` */
  | { type: 'ratio' }
  | { type: 'string' }
  | { type: 'path' };

export interface AttrKey {
  name: string;
  summary: string;
  value: AttrValueSpec;
  places: readonly AttrPlace[];
  docAnchor: string;
}

const SLIDE = 'syntax.md#33-スライドに付けるキー';
const ELEMENT = 'syntax.md#34-要素に付けるキー';
const ARCH = 'arch-diagram.md#52-属性';

export const ATTRIBUTE_KEYS: readonly AttrKey[] = [
  // スライドに付けるキー（構文仕様 §3.3）
  {
    name: 'layout',
    summary: 'レイアウトを指定する',
    value: { type: 'enum', values: LAYOUTS },
    places: ['slide'],
    docAnchor: SLIDE,
  },
  {
    name: 'keep',
    summary: '分割せず1枚に収める',
    value: { type: 'flag' },
    places: ['slide'],
    docAnchor: SLIDE,
  },
  {
    name: 'ratio',
    summary: '幅の比（左：右）',
    value: { type: 'ratio' },
    places: ['slide', 'container'],
    docAnchor: SLIDE,
  },
  {
    name: 'media',
    summary: 'split でメディアを置く側',
    value: { type: 'enum', values: ['left', 'right'] },
    places: ['slide'],
    docAnchor: SLIDE,
  },
  {
    name: 'align',
    summary: '縦方向の揃え',
    value: { type: 'enum', values: ['top', 'center'] },
    places: ['slide'],
    docAnchor: SLIDE,
  },
  {
    name: 'hidden',
    summary: '発表と書き出しから外す',
    value: { type: 'flag' },
    places: ['slide', 'maketitle'],
    docAnchor: SLIDE,
  },
  // 要素に付けるキー（構文仕様 §3.4）
  {
    name: 'step',
    summary: '段階的に表示する（番号を省くと次の番号）',
    value: { type: 'flag-or-int' },
    places: ['block', 'media', 'code', 'arch'],
    docAnchor: ELEMENT,
  },
  {
    name: 'bg',
    summary: '背景にする（left / right で半分）',
    value: { type: 'flag-or-enum', values: ['left', 'right'] },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'fit',
    summary: '枠に対する収め方',
    value: { type: 'enum', values: ['cover', 'contain'] },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'dim',
    summary: '背景を暗くする（0〜1）',
    value: { type: 'number', min: 0, max: 1 },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'blur',
    summary: '背景をぼかす',
    value: { type: 'number', min: 0 },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'width',
    summary: '幅を固定する（40% / 320px）',
    value: { type: 'length' },
    places: ['media', 'arch'],
    docAnchor: ELEMENT,
  },
  {
    name: 'autoplay',
    summary: '動画を自動で再生する',
    value: { type: 'flag' },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'loop',
    summary: '動画をくり返す',
    value: { type: 'flag' },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'muted',
    summary: '動画の音を消す',
    value: { type: 'flag' },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'controls',
    summary: '動画の操作ボタンを出す',
    value: { type: 'flag' },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'poster',
    summary: '動画の静止画',
    value: { type: 'path' },
    places: ['media'],
    docAnchor: ELEMENT,
  },
  {
    name: 'caption',
    summary: 'キャプション',
    value: { type: 'string' },
    places: ['media', 'code', 'arch'],
    docAnchor: ELEMENT,
  },
  // コード（構文仕様 §5.4）
  {
    name: 'lines',
    summary: '行ハイライトの段階（例："1|2-3|5"）',
    value: { type: 'string' },
    places: ['code'],
    docAnchor: 'syntax.md#54-図コードの内部ステップm4',
  },
  // 動く構成図（docs/arch-diagram.md §5.2）
  {
    name: 'scenario',
    summary: '再生するシナリオ（none で動きなし）',
    value: { type: 'string' },
    places: ['arch'],
    docAnchor: ARCH,
  },
  {
    name: 'captions',
    summary: 'ステップの説明の位置',
    value: { type: 'enum', values: ['auto', 'side', 'below', 'none'] },
    places: ['arch'],
    docAnchor: ARCH,
  },
  {
    name: 'focus',
    summary: 'カメラを使うか',
    value: { type: 'enum', values: ['auto', 'none'] },
    places: ['arch'],
    docAnchor: ARCH,
  },
  // タイトルスライド（構文仕様 §2.2）
  {
    name: 'variant',
    summary: 'タイトルの揃え',
    value: { type: 'enum', values: ['center', 'left'] },
    places: ['maketitle'],
    docAnchor: 'syntax.md#22-タイトルスライドmaketitle',
  },
];

export const ATTRIBUTE_KEY_NAMES: readonly string[] = ATTRIBUTE_KEYS.map((key) => key.name);

export function findAttributeKey(name: string): AttrKey | undefined {
  return ATTRIBUTE_KEYS.find((key) => key.name === name);
}

export interface ContainerDef {
  name: string;
  summary: string;
  docAnchor: string;
}

export const CONTAINERS: readonly ContainerDef[] = [
  { name: 'row', summary: '中身を横に並べる', docAnchor: 'syntax.md#4-コンテナ-' },
  { name: 'stack', summary: '中身を縦に並べる', docAnchor: 'syntax.md#4-コンテナ-' },
  { name: 'keep', summary: '中身を同じスライドに置く', docAnchor: 'syntax.md#25-1枚にまとめる' },
  {
    name: 'steps',
    summary: '中身を1つずつ表示する',
    docAnchor: 'syntax.md#52-steps--1つずつ表示する',
  },
  { name: 'notes', summary: '発表者ノート', docAnchor: 'syntax.md#8-発表者ノート' },
  {
    name: 'maketitle',
    summary: '背景や補足を加えたタイトルスライド',
    docAnchor: 'syntax.md#22-タイトルスライドmaketitle',
  },
];
export const CONTAINER_NAMES: readonly string[] = CONTAINERS.map((c) => c.name);

export const DIRECTIVES: readonly ContainerDef[] = [
  {
    name: 'maketitle',
    summary: 'タイトルスライドを置く',
    docAnchor: 'syntax.md#22-タイトルスライドmaketitle',
  },
];
export const DIRECTIVE_NAMES: readonly string[] = DIRECTIVES.map((d) => d.name);
