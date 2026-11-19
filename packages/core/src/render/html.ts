import { archCaptionsHtml, archNotesHtml, archUse } from './arch.js';
import { themeCss } from '@mds/themes';
import type { Attrs } from '../attrs.js';
import type { Block } from '../ir.js';
import { md } from '../md/instance.js';
import type { MathRenderer } from '../md/math.js';
import type { CodeHighlighter, DiagramRenderer, RenderEnv } from '../md/media.js';
import type { MediaProbe } from '../media.js';
import type { Slide, SlideDeck } from '../slides.js';
import { BASE_CSS } from './base-css.js';
import { FIT_SCRIPT } from './fit.js';
import {
  chooseLayout,
  isFigureCode,
  isMediaBlock,
  isShortList,
  subheadingGroups,
  type LayoutChoice,
} from './layout.js';
import { findBackground, renderBackground } from './background.js';
import { phraseBreaks } from './phrase.js';
import { renderTitleSlide } from './title.js';

export const SLIDE_SIZES = {
  '16:9': [1280, 720],
  '4:3': [960, 720],
  '16:10': [1280, 800],
} as const;

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
  /** 単一 HTML（#120）に埋め込まない動画なら true。ポスター（なければ枠）に置き換える */
  omitVideo?: (src: string) => boolean;
  /** 同梱するフォントの @font-face（docs/design.md §6）。デッキの外にも効くように、先頭に置く */
  fontCss?: string;
  /** コードの色分け（#68）。色は span の CSS 変数（--mds-code-token-…）で、テーマが決める */
  highlight?: CodeHighlighter;
  /** 図を描いた結果を返す関数（#71）。```mermaid と `.mmd` を SVG にする */
  diagram?: DiagramRenderer;
  /** 数式を描く関数（#72）。`$…$`・`$$…$$`・```math を HTML にする */
  math?: MathRenderer;
  /**
   * 描いた結果に使うライブラリの CSS（今は KaTeX の CSS だけ。#72）。KaTeX の表記を前に付ける（#133）。
   * テーマで上書きできるよう、基本の CSS とテーマの前に置く
   */
  libraryCss?: string;
}

const esc = (text: string) => md.utils.escapeHtml(text);

/**
 * 書き出した HTML に同梱するフォントと KaTeX の表記（THIRD_PARTY_NOTICES.md。#133）。
 * OFL-1.1 は、フォントを配るときに著作権の表示とライセンスを添えることを求める
 */
const FONT_NOTICE =
  '/* フォント：Inter（Copyright 2016 The Inter Project Authors）、Noto Sans JP・Noto Serif JP（Copyright Google Inc.）、' +
  'JetBrains Mono（Copyright 2020 The JetBrains Mono Project Authors）。SIL Open Font License 1.1' +
  '（https://openfontlicense.org/）。名前を「MDS …」に変え、使う文字だけに絞っている */';
const KATEX_NOTICE =
  '/* KaTeX の CSS とフォント：MIT License、Copyright (c) 2013-2020 Khan Academy and other contributors */';

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
    ...(options.omitVideo ? { omitVideo: options.omitVideo } : {}),
    ...(options.highlight ? { highlight: options.highlight } : {}),
    ...(options.diagram ? { diagram: options.diagram } : {}),
    ...(options.math ? { math: options.math } : {}),
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
<style>${options.fontCss ? `${FONT_NOTICE}\n${options.fontCss}\n` : ''}${options.libraryCss ? `${KATEX_NOTICE}\n${options.libraryCss}\n` : ''}@page { size: ${width}px ${height}px; margin: 0; }
${BASE_CSS}${themeCss(meta.theme)}${custom}</style>
</head>
<body>
<main class="mds-deck theme-${meta.theme}" style="${style.join(';')}"${meta.transition && meta.transition !== 'none' ? ` data-transition="${meta.transition}"` : ''}${options.debug ? ' data-debug=""' : ''}>
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
      env,
    );
  }
  const choice = chooseLayout(slide, deck.slideLevel, env.probe, env.diagram);
  const { layout } = choice;
  const align = slide.attrs?.values.align;
  const background = findBackground(slide.blocks);
  const bg = background ? renderBackground(background, env) : undefined;
  const classes = [
    'mds-slide',
    `layout-${layout}`,
    ...(align === 'center' || align === 'top' ? [`align-${align}`] : []),
    ...(bg?.classes ?? []),
    ...(slide.attrs?.classes ?? []),
  ];
  const parts: string[] = bg ? [bg.html.trimEnd()] : [];

  // 章の名前と見出し。statement と media では、引き継いだ見出しは出さない（§4.5）。
  // 続きのスライドも、見出しは同じ文言のまま（「（続き）」は付けない。#91）
  const titled =
    layout === 'stack' || layout === 'split' || layout === 'columns' || layout === 'grid';
  if (slide.chapter && titled) parts.push(`<p class="mds-chapter">${esc(slide.chapter)}</p>`);
  if (slide.heading && (titled || !slide.heading.continued)) {
    const tag = layout === 'section' ? 'h1' : 'h2';
    parts.push(
      `<${tag} class="mds-title">${phraseBreaks(md.renderInline(slide.heading.raw, env), deck.meta.lang)}</${tag}>`,
    );
  }
  const body = renderBody(slide, choice, deck.slideLevel, env);
  // 自動分割で決めた倍率で文字を小さくする（縮小のスクリプトは、ここから始めて足りなければさらに縮める）
  const scale = slide.scale && slide.scale < 1 ? slide.scale : undefined;
  const style = [
    ...(scale ? [`--mds-fit:${scale}`] : []),
    ...(choice.ratio ? [`--mds-split:${choice.ratio[0]}fr ${choice.ratio[1]}fr`] : []),
    ...(choice.columns ? [`--mds-cols:${choice.columns}`] : []),
  ];
  const bodyAttrs =
    (scale ? ` data-scale="${scale}"` : '') +
    (style.length > 0 ? ` style="${style.join(';')}"` : '') +
    (choice.mediaLeft ? ' data-media="left"' : '');
  // ステップの番号を文書順に決める（data-steps：最初の表示から最後までの操作の回数）
  const numbered = numberSteps(body);
  if (body) parts.push(`<div class="mds-body"${bodyAttrs}>\n${numbered.html}</div>`);
  parts.push(renderFooter(slide, deck, position));
  const notes = renderNotes(slide, deck.slideLevel, env);
  if (notes) parts.push(notes);

  const attrs = [
    `class="${classes.map(esc).join(' ')}"`,
    `data-id="${esc(slide.id)}"`,
    `data-kind="${slide.kind}"`,
    `data-src="${slide.src.start}-${slide.src.end}"`,
    ...(slide.attrs?.id ? [`id="${esc(slide.attrs.id)}"`] : []),
    ...(numbered.steps > 0 ? [`data-steps="${numbered.steps}"`] : []),
    ...(slide.hidden ? ['data-hidden=""'] : []),
    // 切り替え効果（#110）：このスライドに入るとき。資料全体の指定より優先
    ...(typeof slide.attrs?.values.transition === 'string'
      ? [`data-transition="${esc(slide.attrs.values.transition)}"`]
      : []),
  ];
  return `<section ${attrs.join(' ')}>\n${parts.join('\n')}\n</section>`;
}

/** 発表者ノート（`:::notes`）。発表の画面には出さず、発表者ビューが読む（設計プラン §8.4）。 */
export function renderNotes(slide: Slide, slideLevel: number, env: RenderEnv = {}): string {
  // 動く構成図のステップのノート（`note:`。#108）も足す
  const arch = archNotesHtml(
    slide.blocks.map((b) => archUse(b, env.diagram)).find((use) => use !== undefined),
    esc,
  );
  if (slide.notes.length === 0 && !arch) return '';
  return `<aside class="mds-notes" hidden>\n${renderBlocks(slide.notes, slideLevel, env)}${arch}</aside>`;
}

/** レイアウトに合わせて本文を組む（§5.1）。 */
function renderBody(
  slide: Slide,
  choice: LayoutChoice,
  slideLevel: number,
  env: RenderEnv,
): string {
  const blocks = slide.blocks;
  const html = (list: Block[]) => renderBlocks(list, slideLevel, env);
  // 動く構成図の説明のリスト（#107）：split では文章の側、ほかは図の後ろ
  const arch = blocks.map((b) => archUse(b, env.diagram)).find((use) => use !== undefined);
  const captions = arch ? archCaptionsHtml(arch, esc) : '';
  switch (choice.layout) {
    case 'split': {
      // 文章とメディア（またはコード）を左右に並べる
      const isMedia = (b: Block) => isMediaBlock(b) || isFigureCode(b) || b.kind === 'code';
      const media = blocks.filter(isMedia);
      const text = blocks.filter((b) => !isMedia(b));
      if (media.length === 0) return html(blocks) + captions;
      const textHtml = `<div class="mds-split-text">\n${html(text)}${captions}</div>\n`;
      const mediaHtml = `<div class="mds-split-media">\n${html(media)}</div>\n`;
      // 並びは左から。比（--mds-split）も左：右
      return choice.mediaLeft ? mediaHtml + textHtml : textHtml + mediaHtml;
    }
    case 'grid': {
      // 画像を格子に並べる（文章は上に置く）
      // `. . .` は画像の並びの中の位置に残す（問題の画像 → . . . → 答えの画像）
      const media = blocks.filter((b) => isMediaBlock(b) || isFigureCode(b) || b.kind === 'pause');
      const text = blocks.filter((b) => !media.includes(b));
      return `${html(text)}<div class="mds-grid">\n${html(media)}</div>\n`;
    }
    case 'columns': {
      // 小見出しごとにカードにする（小見出しがなければブロックごと）
      const visible = blocks.filter((b) => b.kind !== 'comment');
      const groups = subheadingGroups(visible, slideLevel) ?? visible.map((b) => [b]);
      const level = slideLevel + 1;
      const cards = groups.map((group, i) => {
        const heading = visible.filter((b) => b.kind === 'heading' && b.level === level)[i];
        return `<div class="mds-card">\n${html(heading ? [heading, ...group] : group)}</div>\n`;
      });
      return `<div class="mds-columns">\n${cards.join('')}</div>\n`;
    }
    default:
      return html(blocks) + captions;
  }
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
  // `. . .` の後ろは、次の `. . .` までを1つのステップにまとめる（構文仕様 §5.1）
  const parts: string[] = [];
  let group: string[] | undefined;
  const flush = () => {
    if (group && group.length > 0) {
      parts.push(`<div class="mds-step-group" data-mds-step="auto">\n${group.join('')}</div>\n`);
    }
  };
  for (const block of blocks) {
    if (block.kind === 'pause') {
      flush();
      group = [];
      continue;
    }
    (group ?? parts).push(renderBlock(block, slideLevel, env));
  }
  flush();
  return parts.join('');
}

/** 箇条書きのトップレベルの項目に、ステップの印を付ける（入れ子の項目は親と一緒に出る）。 */
function markTopLevelItems(html: string): string {
  let depth = 0;
  return html.replace(
    /<(\/?)(ul|ol|li)\b([^>]*)>/g,
    (tag, close: string, name: string, rest: string) => {
      if (name !== 'li') {
        depth += close ? -1 : 1;
        return tag;
      }
      if (close || depth !== 1 || rest.includes('data-mds-step')) return tag;
      return `<li data-mds-step="auto"${rest}>`;
    },
  );
}

/**
 * ステップの番号を決める（構文仕様 §5.3）。スライドの中を文書順にたどり、自動の印には
 * 「それまでの最大の番号＋1」、明示の番号はそのまま使い、最後に欠けを詰めて 1・2・3… にする。
 *
 * 埋め込みの内部ステップ（`data-mds-substeps="N"`。コードの行ハイライト・動く構成図。#105）は、
 * その位置で N 個の番号を続けて取り、`data-substeps="3,4,5"`（各段が始まるステップ）にする。
 */
export function numberSteps(html: string): { html: string; steps: number } {
  const marks: number[][] = [];
  let max = 0;
  for (const m of html.matchAll(/data-mds-(step|substeps)="([^"]*)"/g)) {
    if (m[1] === 'substeps') {
      const count = Math.max(0, Number.parseInt(m[2]!, 10) || 0);
      marks.push(Array.from({ length: count }, () => ++max));
      continue;
    }
    const explicit = Number.parseInt(m[2]!, 10);
    const n = m[2] === 'auto' || !(explicit > 0) ? max + 1 : explicit;
    marks.push([n]);
    max = Math.max(max, n);
  }
  const order = [...new Set(marks.flat())].sort((a, b) => a - b);
  const rank = new Map(order.map((n, i) => [n, i + 1]));
  let i = 0;
  return {
    html: html.replace(/data-mds-(step|substeps)="[^"]*"/g, (_, kind: string) => {
      const nums = marks[i++]!.map((n) => rank.get(n));
      return kind === 'substeps' ? `data-substeps="${nums.join(',')}"` : `data-step="${nums[0]}"`;
    }),
    steps: order.length,
  };
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
      const html = phraseBreaks(md.renderInline(stripTrailingAttrs(raw), env), env.lang ?? '');
      return `<h${level}${attrString(block.attrs)}>${html}</h${level}>\n`;
    }
    case 'container':
      return renderContainer(block, slideLevel, env);
    case 'list':
      // 短い項目が多いリストは2段組にする
      return isShortList(block)
        ? `<div class="mds-list-cols">\n${md.render(block.raw, env)}</div>\n`
        : md.render(block.raw, env);
    default:
      return md.render(block.raw, env);
  }
}

function renderContainer(block: Block, slideLevel: number, env: RenderEnv): string {
  const children = block.children ?? [];
  const name = block.name ?? 'div';
  const attrs = attrString(block.attrs, [`mds-c`, `mds-c-${name}`]);
  if (name === 'steps') {
    // :::steps：リストはトップレベルの項目ごと、それ以外はブロックごとに1ステップ（§5.2）
    const items = children
      .filter((b) => b.kind !== 'comment')
      .map((b) => {
        const html = renderBlock(b, slideLevel, env);
        if (b.kind === 'list') return markTopLevelItems(html);
        return `<div class="mds-step-group" data-mds-step="auto">\n${html}</div>\n`;
      });
    return `<div${attrs}>\n${items.join('')}</div>\n`;
  }
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
  // 列の最後に `. . .` があれば、次の列をあとから出す（§5.1）
  let afterPause = false;
  const cols = columns
    .map((col) => {
      const step = afterPause ? ' data-mds-step="auto"' : '';
      const visible = col.filter((b) => b.kind !== 'comment');
      afterPause = visible.at(-1)?.kind === 'pause';
      return `<div class="mds-col"${step}>\n${renderBlocks(col, slideLevel, env)}</div>\n`;
    })
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
