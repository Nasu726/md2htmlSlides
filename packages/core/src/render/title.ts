import type { Block } from '../ir.js';
import { md } from '../md/instance.js';
import type { Slide, SlideDeck } from '../slides.js';
import type { RenderEnv } from '../md/media.js';
import { findBackground, isBackgroundBlock, renderBackground } from './background.js';
import { renderNotes } from './html.js';
import { phraseBreaks } from './phrase.js';

const esc = (text: string) => md.utils.escapeHtml(text);

/**
 * 日付を `lang` に合わせて整形する（構文仕様 §2.2）。
 * `today` は描いた日、`2026-12-05` の形は日付として整形し、それ以外の文字列はそのまま返す。
 */
export function formatDate(value: string, lang: string, now: Date = new Date()): string {
  let date: Date | undefined;
  if (value === 'today') {
    date = now;
  } else {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
    if (m) date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (!date || Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(
      date,
    );
  } catch {
    return value;
  }
}

/**
 * タイトルスライドを描く。タイトル情報はフロントマター（または先頭の H1）から、
 * 背景・補足・variant は `:::maketitle` の中身と属性から取る。
 */
export function renderTitleSlide(
  slide: Slide,
  deck: SlideDeck,
  renderBlocks: (blocks: Block[]) => string,
  /** 書き出し先での URL・ファイルの情報（背景の明るさ） */
  env: RenderEnv = {},
): string {
  const { meta } = deck;
  const variant = slide.attrs?.values.variant === 'left' ? 'left' : 'center';

  // 背景にする画像（`{bg}`・`{bg=left}`・`{bg=right}`）と、それ以外の補足
  const background = findBackground(slide.blocks);
  const extra = slide.blocks.filter((b) => !isBackgroundBlock(b));
  const assetUrl = env.assetUrl ?? ((src: string) => src);

  const title = slide.titleOverride?.title ?? meta.title ?? '';
  const subtitle = slide.titleOverride?.subtitle ?? meta.subtitle;
  const parts: string[] = [];
  if (meta.logo) parts.push(`<img class="mds-logo" src="${esc(assetUrl(meta.logo))}" alt="">`);
  if (meta.event) parts.push(`<p class="mds-event">${esc(meta.event)}</p>`);
  parts.push(
    `<h1 class="mds-title">${phraseBreaks(slide.titleOverride ? md.renderInline(title, env) : esc(title), meta.lang)}</h1>`,
  );
  if (subtitle) {
    const html = slide.titleOverride?.subtitle ? md.renderInline(subtitle, env) : esc(subtitle);
    parts.push(`<p class="mds-subtitle">${phraseBreaks(html, meta.lang)}</p>`);
  }
  parts.push(...renderAuthors(deck));
  if (meta.date) parts.push(`<p class="mds-date">${esc(formatDate(meta.date, meta.lang))}</p>`);
  if (extra.length > 0) parts.push(`<div class="mds-title-extra">\n${renderBlocks(extra)}</div>`);

  const bg = background ? renderBackground(background, env) : undefined;
  const classes = [
    'mds-slide',
    'layout-title',
    `variant-${variant}`,
    ...(bg?.classes ?? []),
    ...(slide.attrs?.classes ?? []),
  ];
  const bgHtml = bg?.html ?? '';
  return `<section class="${classes.map(esc).join(' ')}" data-id="${esc(slide.id)}" data-kind="title" data-src="${slide.src.start}-${slide.src.end}"${slide.hidden ? ' data-hidden=""' : ''}>
${bgHtml}<div class="mds-titleblock">
${parts.join('\n')}
</div>
${renderNotes(slide, deck.slideLevel, env)}</section>`;
}

/** 著者と所属。所属が複数あれば、著者名に番号を付けて所属を番号付きで並べる（authblk と同じ形）。 */
function renderAuthors(deck: SlideDeck): string[] {
  const { authors, affiliation } = deck.meta;
  const affiliations: string[] = [];
  for (const author of authors) {
    if (author.affiliation && !affiliations.includes(author.affiliation)) {
      affiliations.push(author.affiliation);
    }
  }
  const numbered = affiliations.length > 1;
  const out: string[] = [];
  if (authors.length > 0) {
    const names = authors.map((author) => {
      const mark =
        numbered && author.affiliation
          ? `<sup>${affiliations.indexOf(author.affiliation) + 1}</sup>`
          : '';
      return `<span class="mds-author">${esc(author.name)}${mark}</span>`;
    });
    out.push(`<p class="mds-authors">${names.join('')}</p>`);
  }
  if (numbered) {
    const items = affiliations.map((a, i) => `<span><sup>${i + 1}</sup>${esc(a)}</span>`);
    out.push(`<p class="mds-affiliations">${items.join('')}</p>`);
  } else if (affiliations[0] ?? affiliation) {
    out.push(
      `<p class="mds-affiliations"><span>${esc((affiliations[0] ?? affiliation)!)}</span></p>`,
    );
  }
  return out;
}
