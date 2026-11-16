import type { Diagnostic } from './diagnostics.js';
import type { DeckMeta } from './frontmatter.js';

/** 元のファイルでの行の範囲（1 から始まり、両端を含む）。 */
export interface SourceRange {
  start: number;
  end: number;
}

/**
 * ブロックの種類。追加構文（`{…}`・`:::`・`. . .`・`::maketitle`）は #14 で加える。
 * `comment` は HTML コメントだけのブロックで、表示しない（構文仕様 §8）。
 */
export type BlockKind =
  'paragraph' | 'list' | 'code' | 'table' | 'quote' | 'html' | 'comment' | 'rule';

export interface Block {
  kind: BlockKind;
  /** このブロックの元の Markdown */
  raw: string;
  /** 内容のハッシュ（キャッシュのキー） */
  hash: string;
  src: SourceRange;
  /** code：言語名 */
  lang?: string;
  /** list：番号付きリストか */
  ordered?: boolean;
  /** rule：区切りに使った記号（`---`・`***`・`___`） */
  marker?: string;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** 書式を除いた文字列（ID とタイトルに使う） */
  text: string;
  /** 見出しの元の Markdown（`#` を除く） */
  raw: string;
  /** 下線（`===`・`---`）で書いた見出しか */
  setext: boolean;
  line: number;
}

/** 見出しで区切った節。root は見出しを持たない level 0 の節で、最初の見出しより前の本文を持つ。 */
export interface SectionNode {
  /** 見出しのslug（重複時は連番）。本文を編集しても変わらない */
  id: string;
  level: number;
  heading?: Heading;
  blocks: Block[];
  children: SectionNode[];
  src: SourceRange;
  /** 見出し・ブロック・子の節から計算したハッシュ */
  hash: string;
}

export interface Deck {
  meta: DeckMeta;
  /** フロントマターの範囲（ない場合は undefined） */
  frontmatter?: SourceRange;
  root: SectionNode;
  diagnostics: Diagnostic[];
}
