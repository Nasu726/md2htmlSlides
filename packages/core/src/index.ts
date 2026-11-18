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
  embedUrl,
  isLocalPath,
  mediaKind,
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
export { formatAttrs, parseAttrs, type Attrs, type AttrsResult } from './attrs.js';
export { detectSlideLevel, scanHeadings, type HeadingSummary } from './slide-level.js';
export {
  buildSlides,
  headingSummaries,
  type Slide,
  type SlideDeck,
  type SlideHeading,
  type SlideKind,
} from './slides.js';
export { formatSlides } from './slides-outline.js';
export {
  DEFAULT_WEIGHTS,
  applySplit,
  atomize,
  breakPenalty,
  measureJobs,
  planSplit,
  splitAtoms,
  type Atom,
  type MeasureJob,
  type Measurement,
  type Page,
  type SplitPlan,
  type SplitWeights,
} from './split/split.js';
export {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_KEY_NAMES,
  CONTAINERS,
  CONTAINER_NAMES,
  DIRECTIVES,
  DIRECTIVE_NAMES,
  LAYOUTS,
  LAYOUT_SUMMARIES,
  findAttributeKey,
  type AttrKey,
  type AttrPlace,
  type AttrValueSpec,
  type LayoutName,
} from './syntax/elements.js';
export { md } from './md/instance.js';
export { BASE_CSS } from './render/base-css.js';
export { FIT_MARGIN, FIT_SCRIPT, fitSlides } from './render/fit.js';
export {
  SLIDE_SIZES,
  numberSteps,
  renderBlocks,
  renderDeckHtml,
  renderSlide,
  type RenderOptions,
} from './render/html.js';
export { formatDate, renderTitleSlide } from './render/title.js';
export {
  averageLuminance,
  findBackground,
  isBackgroundBlock,
  renderBackground,
  type Background,
  type BackgroundPosition,
} from './render/background.js';
