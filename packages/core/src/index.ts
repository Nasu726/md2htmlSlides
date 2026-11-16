/**
 * md2htmlSlides の中核：Markdown → スライド（パース・分割・レイアウト・描画）。
 * 設計は docs/design.md §3〜§5 を参照。
 */
export const VERSION = '0.0.0';

export type { Diagnostic, Severity } from './diagnostics.js';
export {
  DEFAULT_META,
  parseMeta,
  splitFrontmatter,
  type Author,
  type DeckMeta,
  type FrontmatterBlock,
} from './frontmatter.js';
export { hashString } from './hash.js';
export type { Block, BlockKind, Deck, Heading, SectionNode, SourceRange } from './ir.js';
export { formatOutline } from './outline.js';
export { parseDeck } from './parse.js';
export { SlugRegistry, slugify } from './slug.js';
export { closest, editDistance } from './suggest.js';
export {
  FRONTMATTER_KEYS,
  FRONTMATTER_KEY_NAMES,
  findFrontmatterKey,
  type FrontmatterKey,
  type ValueSpec,
} from './syntax/frontmatter-keys.js';
