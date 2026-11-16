import type { Attrs } from './attrs.js';
import type { Diagnostic } from './diagnostics.js';
import type { DeckMeta } from './frontmatter.js';
import { hashString } from './hash.js';
import type { Block, Deck, SectionNode, SourceRange } from './ir.js';
import { detectSlideLevel, type HeadingSummary } from './slide-level.js';

/**
 * - `title`：タイトルスライド（`::maketitle`。中身の描画は #17）
 * - `section`：章扉（slideLevel より浅い見出し）
 * - `content`：普通のスライド
 */
export type SlideKind = 'title' | 'section' | 'content';

export interface SlideHeading {
  level: number;
  text: string;
  /** 元の Markdown（`#` と属性を除く） */
  raw: string;
  /** `---` などで区切った2枚目以降で、節の見出しを引き継いでいる */
  continued: boolean;
}

export interface Slide {
  /** 節の ID をもとにした、本文を編集しても変わりにくい ID */
  id: string;
  kind: SlideKind;
  heading?: SlideHeading;
  /** このスライドが属する章（slideLevel より浅い見出し）の名前 */
  chapter?: string;
  blocks: Block[];
  /** 見出しの属性と `{…}` だけの行の属性を合わせたもの */
  attrs?: Attrs;
  /** `:::notes` の中身 */
  notes: Block[];
  /** `{hidden}`：エディタには出すが、発表と書き出しでは除く */
  hidden: boolean;
  src: SourceRange;
}

export interface SlideDeck {
  meta: DeckMeta;
  slideLevel: number;
  slides: Slide[];
  diagnostics: Diagnostic[];
}

interface Segment {
  kind: SlideKind;
  heading?: SlideHeading;
  attrs?: Attrs;
  blocks: Block[];
  /** 節の最初の区切り（見出しだけでもスライドにする） */
  first: boolean;
  start: number;
}

/**
 * IR を、見出しと `---` でスライドに区切る（構文仕様 §2.1〜§2.3）。
 * あふれたときの自動分割（M2）はまだ行わない。
 */
export function buildSlides(deck: Deck): SlideDeck {
  const slideLevel =
    deck.meta.slideLevel === 'auto'
      ? detectSlideLevel(headingSummaries(deck.root))
      : deck.meta.slideLevel;
  const builder = new Builder(slideLevel);
  builder.emit(deck.root.blocks, {
    baseId: 'start',
    start: deck.root.src.start,
  });
  for (const child of deck.root.children) builder.visit(child, undefined);
  return { meta: deck.meta, slideLevel, slides: builder.slides, diagnostics: deck.diagnostics };
}

/** IR の見出しのツリーを、slideLevel の判定に使う列にする（文書の順）。 */
export function headingSummaries(root: SectionNode): HeadingSummary[] {
  const out: HeadingSummary[] = [];
  const walk = (section: SectionNode) => {
    if (section.heading) {
      out.push({
        level: section.heading.level,
        followedByContent: section.blocks.some((b) => b.kind !== 'comment'),
        hasChildren: section.children.length > 0,
      });
    }
    section.children.forEach(walk);
  };
  walk(root);
  return out;
}

class Builder {
  readonly slides: Slide[] = [];
  private readonly usedIds = new Map<string, number>();

  constructor(private readonly slideLevel: number) {}

  visit(section: SectionNode, chapter: string | undefined): void {
    const heading = toSlideHeading(section);
    if (section.level < this.slideLevel) {
      // 章扉：見出しと、章の導入文（直下のブロック）
      this.emit(section.blocks, {
        baseId: section.id,
        start: section.src.start,
        heading,
        ...(section.attrs ? { attrs: section.attrs } : {}),
        kind: 'section',
        ...(chapter ? { chapter } : {}),
      });
      for (const child of section.children) this.visit(child, heading.text);
      return;
    }
    // slideLevel 以上の深さ：子の節は、スライドの中の小見出しとして平らにする
    this.emit(flatten(section), {
      baseId: section.id,
      start: section.src.start,
      heading,
      ...(section.attrs ? { attrs: section.attrs } : {}),
      kind: 'content',
      ...(chapter ? { chapter } : {}),
    });
  }

  emit(
    blocks: Block[],
    options: {
      baseId: string;
      start: number;
      heading?: SlideHeading;
      attrs?: Attrs;
      kind?: SlideKind;
      chapter?: string;
    },
  ): void {
    const { heading, attrs, chapter } = options;
    const segments: Segment[] = [];
    let current: Segment = {
      kind: options.kind ?? 'content',
      ...(heading ? { heading } : {}),
      ...(attrs ? { attrs } : {}),
      blocks: [],
      first: true,
      start: options.start,
    };
    const continuation = (start: number): Segment => ({
      kind: 'content',
      ...(heading ? { heading: { ...heading, continued: true } } : {}),
      ...(attrs ? { attrs } : {}),
      blocks: [],
      first: false,
      start,
    });

    for (const block of blocks) {
      // `---` で区切る（`***`・`___` は水平線のまま）
      if (block.kind === 'rule' && block.marker === '---') {
        segments.push(current);
        current = continuation(block.src.end + 1);
        continue;
      }
      // ::maketitle と :::maketitle は、必ず1枚を単独で占める（構文仕様 §2.2）
      if (
        block.name === 'maketitle' &&
        (block.kind === 'directive' || block.kind === 'container')
      ) {
        segments.push(current);
        segments.push({
          kind: 'title',
          ...(block.attrs ? { attrs: block.attrs } : {}),
          blocks: block.children ?? [],
          first: true,
          start: block.src.start,
        });
        current = continuation(block.src.end + 1);
        continue;
      }
      // `:::keep` などの中が slideLevel 以上の見出しで始まるなら、その見出しの1枚にする（§2.5）
      const lead = block.kind === 'container' ? block.children?.[0] : undefined;
      if (lead?.kind === 'heading' && (lead.level ?? 99) <= this.slideLevel) {
        segments.push(current);
        segments.push({
          kind: 'content',
          heading: {
            level: lead.level!,
            text: lead.text ?? '',
            raw: lead.text ?? '',
            continued: false,
          },
          ...(lead.attrs ? { attrs: lead.attrs } : {}),
          blocks: [{ ...block, children: block.children!.slice(1) }],
          first: true,
          start: block.src.start,
        });
        current = continuation(block.src.end + 1);
        continue;
      }
      current.blocks.push(block);
    }
    segments.push(current);

    let page = 0;
    for (const segment of segments) {
      const visible = segment.blocks.some((b) => b.kind !== 'comment' && b.kind !== 'slide-attrs');
      const keep = visible || segment.kind === 'title' || (segment.first && segment.heading);
      if (!keep) continue;
      page++;
      this.slides.push(this.toSlide(segment, options.baseId, page, chapter));
    }
  }

  private toSlide(
    segment: Segment,
    baseId: string,
    page: number,
    chapter: string | undefined,
  ): Slide {
    let attrs = segment.attrs;
    const blocks: Block[] = [];
    const notes: Block[] = [];
    for (const block of segment.blocks) {
      if (block.kind === 'slide-attrs' && block.attrs) {
        attrs = mergeAttrs(attrs, block.attrs);
      } else if (block.kind === 'container' && block.name === 'notes') {
        notes.push(...(block.children ?? []));
      } else {
        blocks.push(block);
      }
    }
    const ends = [segment.start, ...segment.blocks.map((b) => b.src.end)];
    const id = this.uniqueId(
      segment.kind === 'title' ? 'title' : page === 1 ? baseId : `${baseId}-${page}`,
    );
    return {
      id,
      kind: segment.kind,
      ...(segment.heading ? { heading: segment.heading } : {}),
      ...(chapter ? { chapter } : {}),
      blocks,
      ...(attrs ? { attrs } : {}),
      notes,
      hidden: attrs?.values.hidden === true,
      src: { start: segment.start, end: Math.max(...ends) },
    };
  }

  private uniqueId(id: string): string {
    const count = this.usedIds.get(id) ?? 0;
    this.usedIds.set(id, count + 1);
    return count === 0 ? id : `${id}~${count + 1}`;
  }
}

function toSlideHeading(section: SectionNode): SlideHeading {
  return {
    level: section.heading!.level,
    text: section.heading!.text,
    raw: section.heading!.raw,
    continued: false,
  };
}

/** 節の子孫を、見出しブロックとその中身の並びにする。 */
function flatten(section: SectionNode): Block[] {
  const blocks = [...section.blocks];
  for (const child of section.children) {
    const h = child.heading!;
    blocks.push({
      kind: 'heading',
      raw: `${'#'.repeat(h.level)} ${h.raw}`,
      hash: hashString(`heading\n${h.level}\n${h.raw}`),
      src: { start: h.line, end: h.line },
      level: h.level,
      text: h.text,
      ...(child.attrs ? { attrs: child.attrs } : {}),
    });
    blocks.push(...flatten(child));
  }
  return blocks;
}

function mergeAttrs(base: Attrs | undefined, extra: Attrs): Attrs {
  if (!base) return extra;
  return {
    values: { ...base.values, ...extra.values },
    classes: [...base.classes, ...extra.classes],
    ...((extra.id ?? base.id) ? { id: (extra.id ?? base.id)! } : {}),
  };
}
