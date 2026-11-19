/**
 * md2htmlSlides の中核：Markdown → スライド（パース・分割・レイアウト・描画）。
 * 設計は docs/design.md §3〜§5 を参照。
 */
export const VERSION = '0.0.0';

export type { Diagnostic, Severity } from './diagnostics.js';
export { type Author, type DeckMeta, type FrontmatterBlock } from './frontmatter.js';
export { hashString } from './hash.js';
export type {
  Block,
  BlockKind,
  Deck,
  Heading,
  MathRef,
  MediaRef,
  SectionNode,
  SourceRange,
} from './ir.js';
export {
  checkMediaFiles,
  collectMedia,
  decodePath,
  isLocalPath,
  mediaMime,
  mediaSize,
  type MediaInfo,
  type MediaKind,
  type MediaProbe,
} from './media.js';
export type {
  CodeHighlighter,
  DiagramInput,
  DiagramRenderer,
  DiagramResult,
  RenderEnv,
} from './md/media.js';
export type { MathRenderer, MathResult } from './md/math.js';
export { parseDeck } from './parse.js';
export { closest } from './suggest.js';
export {
  FRONTMATTER_KEYS,
  findFrontmatterKey,
  type FrontmatterKey,
  type ValueSpec,
} from './syntax/frontmatter-keys.js';
export { type Attrs, type AttrsResult } from './attrs.js';
export { type HeadingSummary } from './slide-level.js';
export {
  buildSlides,
  type Slide,
  type SlideDeck,
  type SlideHeading,
  type SlideKind,
} from './slides.js';
export {
  applySplit,
  measureJobs,
  planSplit,
  type Atom,
  type MeasureJob,
  type Measurement,
  type Page,
  type SplitPlan,
  type SplitWeights,
} from './split/split.js';
export {
  ATTRIBUTE_KEYS,
  CONTAINERS,
  DIRECTIVES,
  LAYOUTS,
  LAYOUT_SUMMARIES,
  findAttributeKey,
  type AttrKey,
  type AttrPlace,
  type AttrValueSpec,
  type LayoutName,
} from './syntax/elements.js';
export { md } from './md/instance.js';
export {
  ARCH_KEYWORDS,
  ARCH_KIND_SUMMARIES,
  ARCH_NODE_KINDS,
  parseArch,
  type ArchAction,
  type ArchDiagnostic,
  type ArchDiagram,
  type ArchEdge,
  type ArchGroup,
  type ArchMove,
  type ArchNode,
  type ArchNodeKind,
  type ArchScenario,
  type ArchState,
  type ArchStep,
} from './arch/parse.js';
export { archDiagnostics, collectArch, type ArchSource } from './arch/collect.js';
export { FIT_MARGIN, fitSlides } from './render/fit.js';
export { renderDeckHtml, renderSlide, type RenderOptions } from './render/html.js';
export { averageLuminance, type Background, type BackgroundPosition } from './render/background.js';
