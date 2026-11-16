import { themeCss } from '@mds/themes';
import type { Attrs } from '../attrs.js';
import type { Block } from '../ir.js';
import { md } from '../md/instance.js';
import type { RenderEnv } from '../md/media.js';
import type { MediaProbe } from '../media.js';
import type { Slide, SlideDeck } from '../slides.js';
import type { LayoutName } from '../syntax/elements.js';
import { BASE_CSS } from './base-css.js';
import { FIT_SCRIPT } from './fit.js';
import { phraseBreaks } from './phrase.js';
import { renderTitleSlide } from './title.js';

export const SLIDE_SIZES = {
  '16:9': [1280, 720],
  '4:3': [960, 720],
  '16:10': [1280, 800],
} as const;

/** M1 で描けるレイアウト。ほかのレイアウトの指定は M2 までは stack で描く。 */
const M1_LAYOUTS: readonly LayoutName[] = ['stack', 'title', 'section'];

export interface RenderOptions {
  /** `{hidden}` のスライドも出す（エディタのプレビュー用） */
  includeHidden?: boolean;
  /** カスタム CSS（`css:` で指定したファイルの中身）。デッキの中だけに効かせる */
  customCss?: string;
  /** 読み込んだあとに縮小して収めるスクリプトを入れる（既定は入れる） */
  fit?: boolean;
  /** 収まらなかったスライドに印を付ける（開発・プレビュー用） */
  debug?: boolean;
  /** 画像・動画のファイルを調べる関数（縦横比を先に決め、見つからないものは枠だけにする） */
  probe?: MediaProbe;
  /** 文書の最後に入れるスクリプト（発表用の runtime など）。縮小のスクリプトの後に実行する */
  scripts?: string[];
  /** 画像・動画・ロゴのパスを、書き出し先での URL に置き換える関数 */
  assetUrl?: (src: string) => string;
}

const esc = (text: string) => md.utils.escapeHtml(text);

/** スライドのデッキを、1つの HTML 文書にする。 */
export function renderDeckHtml(deck: SlideDeck, options: RenderOptions = {}): string {
  const { meta } = deck;
  const [width, height] = SLIDE_SIZES[meta.aspect];
  const slides = options.includeHidden ? deck.slides : deck.slides.filter((s) => !s.hidden);
  const style = [`--mds-w:${width}px`, `--mds-h:${height}px`];
  if (meta.accent) style.push(`--mds-accent:${meta.accent}`);
  const env: RenderEnv = {
    lang: meta.lang,
    ...(options.probe ? { probe: options.probe } : {}),
    ...(options.assetUrl ? { assetUrl: options.assetUrl } : {}),
  };
  const custom = options.customCss ? `@scope (.mds-deck) {\n${options.customCss}\n}` : '';
  const body = slides
    .map((slide, i) => renderSlide(slide, deck, { page: i + 1, total: slides.length }, env))
    .join('\n');
  return `<!doctype html>
<html lang="${esc(meta.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title ?? slides[0]?.heading?.text ?? 'Slides')}</title>
<style>${BASE_CSS}${themeCss(meta.theme)}${custom}</style>
</head>
<body>
<main class="mds-deck theme-${meta.theme}" style="${style.join(';')}"${options.debug ? ' data-debug=""' : ''}>
${body}
</main>
${[...(options.fit === false ? [] : [FIT_SCRIPT]), ...(options.scripts ?? [])]
  .map((script) => `<script>${script.replace(/<\/(script)/gi, '<\\/$1')}</script>\n`)
  .join('')}</body>
</html>
`;
}

/** スライド1枚を `<section>` にする。 */
export function renderSlide(
  slide: Slide,
  deck: SlideDeck,
  position: { page: number; total: number },
  env: RenderEnv = { lang: deck.meta.lang },
): string {
  if (slide.kind === 'title') {
    return renderTitleSlide(
      slide,
      deck,
      (blocks) => renderBlocks(blocks, deck.slideLevel, env),
      env.assetUrl,
    );
  }
  const layout = chooseLayout(slide);
  const classes = ['mds-slide', `layout-${layout}`, ...(slide.attrs?.classes ?? [])];
  const parts: string[] = [];

  if (slide.chapter && layout === 'stack') {
    parts.push(`<p class="mds-chapter">${esc(slide.chapter)}</p>`);
  }
  if (slide.heading) {
    const tag = layout === 'section' ? 'h1' : 'h2';
    const continued = slide.heading.continued ? '<span class="mds-continued">（続き）</span>' : '';
    parts.push(
      `<${tag} class="mds-title">${phraseBreaks(md.renderInline(slide.heading.raw), deck.meta.lang)}${continued}</${tag}>`,
    );
  }
  const blocks = renderBlocks(slide.blocks, deck.slideLevel, env);
  // 自動分割で決めた倍率で文字を小さくする（縮小のスクリプトは、ここから始めて足りなければさらに縮める）
  const scale = slide.scale && slide.scale < 1 ? slide.scale : undefined;
  const scaleAttrs = scale ? ` data-scale="${scale}" style="--mds-fit:${scale}"` : '';
  if (blocks) parts.push(`<div class="mds-body"${scaleAttrs}>\n${blocks}</div>`);
  parts.push(renderFooter(slide, deck, position));

  const attrs = [
    `class="${classes.map(esc).join(' ')}"`,
    `data-id="${esc(slide.id)}"`,
    `data-kind="${slide.kind}"`,
    `data-src="${slide.src.start}-${slide.src.end}"`,
    ...(slide.attrs?.id ? [`id="${esc(slide.attrs.id)}"`] : []),
    ...(slide.hidden ? ['data-hidden=""'] : []),
  ];
  return `<section ${attrs.join(' ')}>\n${parts.join('\n')}\n</section>`;
}

function chooseLayout(slide: Slide): LayoutName {
  const requested = slide.attrs?.values.layout;
  if (typeof requested === 'string' && M1_LAYOUTS.includes(requested as LayoutName)) {
    return requested as LayoutName;
  }
  if (slide.kind === 'title') return 'title';
  if (slide.kind === 'section') return 'section';
  const visible = slide.blocks.some((b) => b.kind !== 'comment' && b.kind !== 'pause');
  return visible ? 'stack' : 'section';
}

function renderFooter(
  slide: Slide,
  deck: SlideDeck,
  position: { page: number; total: number },
): string {
  const left = deck.meta.footer ? `<span>${esc(deck.meta.footer)}</span>` : '<span></span>';
  const right =
    deck.meta.paginate && slide.kind !== 'title'
      ? `<span class="mds-page">${position.page} / ${position.total}</span>`
      : '';
  return left === '<span></span>' && !right
    ? ''
    : `<footer class="mds-footer">${left}${right}</footer>`;
}

/** ブロックの並びを HTML にする。コンテナは IR から、それ以外は元の Markdown から描く。 */
export function renderBlocks(blocks: Block[], slideLevel: number, env: RenderEnv = {}): string {
  return blocks.map((block) => renderBlock(block, slideLevel, env)).join('');
}

function renderBlock(block: Block, slideLevel: number, env: RenderEnv): string {
  switch (block.kind) {
    case 'comment':
    case 'pause':
    case 'slide-attrs':
    case 'directive':
      return '';
    case 'heading': {
      const level = Math.min(6, Math.max(3, (block.level ?? slideLevel + 1) - slideLevel + 2));
      const raw = block.raw.replace(/^#{1,6}[ \t]*/, '');
      const html = phraseBreaks(md.renderInline(stripTrailingAttrs(raw)), env.lang ?? '');
      return `<h${level}${attrString(block.attrs)}>${html}</h${level}>\n`;
    }
    case 'container':
      return renderContainer(block, slideLevel, env);
    default:
      return md.render(block.raw, env);
  }
}

function renderContainer(block: Block, slideLevel: number, env: RenderEnv): string {
  const children = block.children ?? [];
  const name = block.name ?? 'div';
  const attrs = attrString(block.attrs, [`mds-c`, `mds-c-${name}`]);
  if (name !== 'row') return `<div${attrs}>\n${renderBlocks(children, slideLevel, env)}</div>\n`;

  // :::row：見出しがあれば見出しごとに1列、なければブロックごとに1列（構文仕様 §4.1）
  const columns: Block[][] = [];
  const byHeading = children.some((b) => b.kind === 'heading');
  for (const child of children) {
    if (child.kind === 'comment') continue;
    if (!byHeading || child.kind === 'heading' || columns.length === 0) columns.push([child]);
    else columns[columns.length - 1]!.push(child);
  }
  const ratio =
    typeof block.attrs?.values.ratio === 'string' ? block.attrs.values.ratio : undefined;
  const style = ratio
    ? ` style="grid-template-columns:${ratio
        .split(':')
        .map((n) => `minmax(0,${n}fr)`)
        .join(' ')}"`
    : '';
  const cols = columns
    .map((col) => `<div class="mds-col">\n${renderBlocks(col, slideLevel, env)}</div>\n`)
    .join('');
  return `<div${attrs}${style}>\n${cols}</div>\n`;
}

function attrString(attrs: Attrs | undefined, baseClasses: string[] = []): string {
  const classes = [...baseClasses, ...(attrs?.classes ?? [])];
  return (
    (classes.length > 0 ? ` class="${classes.map(esc).join(' ')}"` : '') +
    (attrs?.id ? ` id="${esc(attrs.id)}"` : '')
  );
}

function stripTrailingAttrs(raw: string): string {
  return raw.replace(/[ \t]+\{[^{}\n]*\}[ \t]*$/, '');
}
