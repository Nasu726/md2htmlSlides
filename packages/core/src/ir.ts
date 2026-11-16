import type { Attrs } from './attrs.js';
import type { Diagnostic } from './diagnostics.js';
import type { DeckMeta } from './frontmatter.js';

/** 元のファイルでの行の範囲（1 から始まり、両端を含む）。 */
export interface SourceRange {
  start: number;
  end: number;
}

/**
 * ブロックの種類。
 * - `comment`：HTML コメントだけのブロック。表示しない（構文仕様 §8）
 * - `heading`：コンテナの中の見出し（コンテナの外の見出しは節になる）
 * - `container`：`:::名前` … `:::`（§4）。中身は children
 * - `directive`：`::maketitle` などの単独行の指示（§2.2）
 * - `pause`：`. . .`（§5.1）
 * - `slide-attrs`：`{…}` だけの行。それを含むスライドに付ける属性（§3.2）
 */
export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'code'
  | 'table'
  | 'quote'
  | 'html'
  | 'comment'
  | 'rule'
  | 'container'
  | 'directive'
  | 'pause'
  | 'slide-attrs';

/** 段落の中の画像（`![alt](src "title"){属性}`）。動画の判定は #18 で加える。 */
export interface MediaRef {
  src: string;
  alt: string;
  title?: string;
  attrs?: Attrs;
}

export interface Block {
  kind: BlockKind;
  /** このブロックの元の Markdown */
  raw: string;
  /** 内容のハッシュ（キャッシュのキー） */
  hash: string;
  src: SourceRange;
  /** 属性（段落の末尾・コードの情報文字列・コンテナと指示の開始行・`{…}` だけの行） */
  attrs?: Attrs;
  /** code：言語名 */
  lang?: string;
  /** list：番号付きリストか */
  ordered?: boolean;
  /** rule：区切りに使った記号（`---`・`***`・`___`） */
  marker?: string;
  /** container・directive：名前 */
  name?: string;
  /** container：中身 */
  children?: Block[];
  /** heading（コンテナの中）：レベルと文字列 */
  level?: number;
  text?: string;
  /** paragraph：中の画像 */
  media?: MediaRef[];
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** 書式と末尾の属性を除いた文字列（ID とタイトルに使う） */
  text: string;
  /** 見出しの元の Markdown（`#` と末尾の属性を除く） */
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
  /** 見出しの末尾の属性（そのスライドに付ける。構文仕様 §3.3） */
  attrs?: Attrs;
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
