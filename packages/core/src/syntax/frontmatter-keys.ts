import { THEMES } from '@mds/themes';

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
  | { type: 'authors' };

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

const MVP = 'syntax.md#11-最初に用意するキーmvp';

export const FRONTMATTER_KEYS: readonly FrontmatterKey[] = [
  {
    name: 'title',
    summary: 'タイトルスライドとブラウザのタイトルに使う',
    value: { type: 'string' },
    titleInfo: true,
    docAnchor: MVP,
  },
  { name: 'subtitle', summary: '副題', value: { type: 'string' }, titleInfo: true, docAnchor: MVP },
  {
    name: 'author',
    summary: '著者。所属が違う場合は { name, affiliation } の配列で書く',
    value: { type: 'authors' },
    titleInfo: true,
    docAnchor: MVP,
  },
  {
    name: 'affiliation',
    summary: '全員に共通の所属',
    value: { type: 'string' },
    titleInfo: true,
    docAnchor: MVP,
  },
  {
    name: 'date',
    summary: '日付。today は発表日に置き換わる。日付以外の文字列はそのまま表示する',
    value: { type: 'date' },
    titleInfo: true,
    docAnchor: MVP,
  },
  {
    name: 'event',
    summary: '発表の場（勉強会名・学会名など）',
    value: { type: 'string' },
    titleInfo: true,
    docAnchor: MVP,
  },
  {
    name: 'logo',
    summary: 'タイトルスライドに表示するロゴ',
    value: { type: 'path' },
    titleInfo: true,
    docAnchor: MVP,
  },
  {
    name: 'theme',
    summary: 'テーマ',
    value: { type: 'enum', values: THEMES },
    default: 'clean',
    docAnchor: MVP,
  },
  {
    name: 'aspect',
    summary: '縦横比（1280×720 / 960×720 / 1280×800）',
    value: { type: 'enum', values: ['16:9', '4:3', '16:10'] },
    default: '16:9',
    docAnchor: MVP,
  },
  {
    name: 'lang',
    summary: '言語。改行規則とフォントの選択に使う',
    value: { type: 'string' },
    default: 'ja',
    docAnchor: MVP,
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
    docAnchor: MVP,
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
    docAnchor: MVP,
  },
  {
    name: 'footer',
    summary: '全スライド共通のフッター',
    value: { type: 'string' },
    docAnchor: MVP,
  },
  {
    name: 'accent',
    summary: 'アクセントカラーだけを差し替える',
    value: { type: 'color' },
    docAnchor: MVP,
  },
  { name: 'css', summary: 'カスタムCSS（上級者向け）', value: { type: 'path' }, docAnchor: MVP },
];

export const FRONTMATTER_KEY_NAMES: readonly string[] = FRONTMATTER_KEYS.map((key) => key.name);

export function findFrontmatterKey(name: string): FrontmatterKey | undefined {
  return FRONTMATTER_KEYS.find((key) => key.name === name);
}
