import { THEMES } from '@mdhs/themes';

/**
 * 構文の定義（docs/design.md §9.3）のうち、フロントマターのキー。
 * パーサの検証と、エディタのサジェスト・構文ヒントは、すべてこの定義から作る。
 */

export type ValueSpec =
  | { type: 'string' }
  | { type: 'enum'; values: readonly (string | number | boolean)[] }
  | { type: 'boolean' }
  /** 日付・`today`・任意の文字列（「2026年 秋」など） */
  | { type: 'date' }
  | { type: 'path' }
  | { type: 'color' }
  /** 文字列・文字列の配列・`{ name, affiliation }` の配列 */
  | { type: 'authors' }
  /** `{ steps: final | each }`（PDF の書き出し。構文仕様 §5.5） */
  | { type: 'pdf' };

export interface FrontmatterKey {
  name: string;
  /** 1行の説明（構文ヒントに出す） */
  summary: string;
  value: ValueSpec;
  default?: string | number | boolean;
  /** `::maketitle` で表示するタイトル情報か */
  titleInfo?: boolean;
  /** 構文仕様の該当箇所 */
  docAnchor: string;
}

const KEY_LIST = 'syntax.md#11-キーの一覧';

export const FRONTMATTER_KEYS: readonly FrontmatterKey[] = [
  {
    name: 'title',
    summary: 'タイトルスライドとブラウザのタイトルに使う',
    value: { type: 'string' },
    titleInfo: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'subtitle',
    summary: '副題',
    value: { type: 'string' },
    titleInfo: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'author',
    summary: '著者。所属が違う場合は { name, affiliation } の配列で書く',
    value: { type: 'authors' },
    titleInfo: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'affiliation',
    summary: '全員に共通の所属',
    value: { type: 'string' },
    titleInfo: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'date',
    summary: '日付。today は発表日に置き換わる。日付以外の文字列はそのまま表示する',
    value: { type: 'date' },
    titleInfo: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'event',
    summary: '発表の場（勉強会名・学会名など）',
    value: { type: 'string' },
    titleInfo: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'logo',
    summary: 'タイトルスライドに表示するロゴ',
    value: { type: 'path' },
    titleInfo: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'theme',
    summary: 'テーマ',
    value: { type: 'enum', values: THEMES },
    default: 'clean',
    docAnchor: KEY_LIST,
  },
  {
    name: 'aspect',
    summary: '縦横比（1280×720 / 960×720 / 1280×800）',
    value: { type: 'enum', values: ['16:9', '4:3', '16:10'] },
    default: '16:9',
    docAnchor: KEY_LIST,
  },
  {
    name: 'lang',
    summary: '言語。改行規則とフォントの選択に使う',
    value: { type: 'string' },
    default: 'ja',
    docAnchor: KEY_LIST,
  },
  {
    name: 'slideLevel',
    summary: 'スライドを始める見出しのレベル',
    value: { type: 'enum', values: ['auto', 1, 2, 3] },
    default: 'auto',
    docAnchor: 'syntax.md#21-見出しによる区切り',
  },
  {
    name: 'split',
    summary: 'auto は自動で分割、manual は --- と見出しでだけ区切る',
    value: { type: 'enum', values: ['auto', 'manual'] },
    default: 'auto',
    docAnchor: KEY_LIST,
  },
  {
    name: 'titleSlide',
    summary: '::maketitle がないときに、先頭にタイトルスライドを自動で作るか',
    value: { type: 'enum', values: ['auto', false] },
    default: 'auto',
    docAnchor: 'syntax.md#22-タイトルスライドmaketitle',
  },
  {
    name: 'paginate',
    summary: 'ページ番号を表示するか',
    value: { type: 'boolean' },
    default: true,
    docAnchor: KEY_LIST,
  },
  {
    name: 'transition',
    summary: 'スライドの切り替え効果（none / fade / slide）',
    value: { type: 'enum', values: ['none', 'fade', 'slide'] },
    default: 'none',
    docAnchor: KEY_LIST,
  },
  {
    name: 'footer',
    summary: '全スライド共通のフッター',
    value: { type: 'string' },
    docAnchor: KEY_LIST,
  },
  {
    name: 'accent',
    summary: 'アクセントカラーだけを差し替える',
    value: { type: 'color' },
    docAnchor: KEY_LIST,
  },
  {
    name: 'css',
    summary: 'カスタムCSS（上級者向け）',
    value: { type: 'path' },
    docAnchor: KEY_LIST,
  },
  {
    name: 'pdf',
    summary: 'PDF の書き出し（steps: each でステップごとのページにする）',
    value: { type: 'pdf' },
    docAnchor: 'syntax.md#55-pdf-での扱い',
  },
];

export const FRONTMATTER_KEY_NAMES: readonly string[] = FRONTMATTER_KEYS.map((key) => key.name);

export function findFrontmatterKey(name: string): FrontmatterKey | undefined {
  return FRONTMATTER_KEYS.find((key) => key.name === name);
}
