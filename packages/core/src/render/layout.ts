/**
 * 自動レイアウト：ページの内容からレイアウトを選ぶ（docs/design.md §5.1〜§5.3）。
 * 利用者の `{layout=…}` があればそれを優先する。
 */
import type { Block } from '../ir.js';
import type { DiagramRenderer, DiagramResult } from '../md/media.js';
import { decodePath, type MediaProbe } from '../media.js';
import type { Slide } from '../slides.js';
import { LAYOUTS, type LayoutName } from '../syntax/elements.js';
import { archUse, captionsBelow, hasCaptions } from './arch.js';

export interface LayoutChoice {
  layout: LayoutName;
  /** split：文章とメディアの幅の比 */
  ratio?: [number, number];
  /** split：メディアを左に置く */
  mediaLeft?: boolean;
  /** grid・columns：列の数 */
  columns?: number;
}

const HIDDEN = new Set<Block['kind']>(['comment', 'pause', 'slide-attrs', 'directive']);
const IMAGE = /!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g;

/** 図として扱うコード（Mermaid・動く構成図）。 */
export const isFigureCode = (b: Block) =>
  b.kind === 'code' && (b.lang === 'mermaid' || b.lang === 'arch');

const visibleMedia = (b: Block) => (b.media ?? []).filter((m) => m.attrs?.values.bg === undefined);
const onlyImages = (b: Block) => b.raw.replace(IMAGE, '').trim() === '';

/**
 * 画像・動画だけの段落か（背景だけの段落は除く）。
 * `width=` で幅を固定した画像は、伸縮させずに文章と同じ流れに置くので含めない。
 */
export function isMediaBlock(b: Block): boolean {
  const media = visibleMedia(b);
  return (
    b.kind === 'paragraph' &&
    media.length > 0 &&
    media.every((m) => m.attrs?.values.width === undefined) &&
    onlyImages(b)
  );
}

/** 一文だけか（文末以外に句点・感嘆符・疑問符がない）。 */
const singleSentence = (b: Block) => !/[。！？!?]/.test(b.raw.trim().replace(/[。！？!?]+$/, ''));

const isBackgroundOnly = (b: Block) =>
  b.kind === 'paragraph' &&
  (b.media ?? []).length > 0 &&
  visibleMedia(b).length === 0 &&
  onlyImages(b);

/** 本文の文字数のおおよそ（記号を除く）。 */
export function textLength(b: Block): number {
  return b.raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{[^}]*\}\s*$/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/gm, '')
    .replace(/[`*_|~]/g, '')
    .replace(/\s+/g, '').length;
}

/** 短い項目が多いリスト（2段組にする。§5.1 の stack の補足）。 */
export function isShortList(b: Block): boolean {
  if (b.kind !== 'list') return false;
  const lines = b.raw.split('\n');
  const items = lines.filter((line) => /^(?:[-*+]|\d+[.)])\s/.test(line));
  const nested = lines.some((line) => /^\s+(?:[-*+]|\d+[.)])\s/.test(line));
  return (
    !nested &&
    items.length >= 8 &&
    items.every((line) => line.replace(/^(?:[-*+]|\d+[.)])\s+/, '').trim().length <= 10)
  );
}

/** ページの内容から、レイアウトを選ぶ。 */
export function chooseLayout(
  slide: Slide,
  slideLevel: number,
  probe?: MediaProbe,
  /** 描いた図（#71）。図の縦横比を、画像と同じように並べ方の判断に使う */
  diagram?: DiagramRenderer,
): LayoutChoice {
  const values = slide.attrs?.values ?? {};
  const mediaLeft = values.media === 'left';
  // ratio= は「左：右」。自動で決めた比は「文章：メディア」なので、メディアが左なら入れ替える
  const ratio = parseRatio(values.ratio);
  const orient = (auto: [number, number]): [number, number] =>
    ratio ?? (mediaLeft ? [auto[1], auto[0]] : auto);
  const requested = values.layout;
  if (typeof requested === 'string' && (LAYOUTS as readonly string[]).includes(requested)) {
    const layout = requested as LayoutName;
    if (layout === 'split') return { layout, ratio: orient([1, 1]), mediaLeft };
    if (layout === 'columns' || layout === 'grid') {
      const groups = subheadingGroups(
        slide.blocks.filter((b) => !HIDDEN.has(b.kind)),
        slideLevel,
      );
      return { layout, columns: Math.min(4, Math.max(2, groups?.length ?? 2)) };
    }
    return { layout };
  }
  if (slide.kind === 'title') return { layout: 'title' };
  if (slide.kind === 'section') return { layout: 'section' };

  const blocks = slide.blocks.filter((b) => !HIDDEN.has(b.kind) && !isBackgroundOnly(b));
  if (blocks.length === 0) return { layout: 'section' };
  const media = blocks.filter((b) => isMediaBlock(b) || isFigureCode(b));
  const codes = blocks.filter((b) => b.kind === 'code' && !isFigureCode(b));
  const texts = blocks.filter((b) => !media.includes(b) && !codes.includes(b));
  const mediaCount = media.reduce((n, b) => n + (isFigureCode(b) ? 1 : visibleMedia(b).length), 0);
  const only = blocks.length === 1 ? blocks[0]! : undefined;

  // 動く構成図（#107、arch-diagram.md §5.4）：説明のリストを文章として数える。
  // 図が横長なら説明を下（stack）、そうでなければ図 3：説明 2 の左右（split。図は左）
  const arch = media.length === 1 ? archUse(media[0]!, diagram) : undefined;
  if (arch && hasCaptions(arch) && codes.length === 0) {
    if (captionsBelow(arch)) return { layout: 'stack' };
    const plain = texts.every((b) => b.kind === 'paragraph' || b.kind === 'list');
    if (texts.length === 0 || (plain && texts.reduce((n, b) => n + textLength(b), 0) <= 200)) {
      return { layout: 'split', ratio: ratio ?? [3, 2], mediaLeft: values.media !== 'right' };
    }
  }

  // statement：短い一文、または引用だけ
  const statement = only?.kind === 'paragraph' && !isMediaBlock(only) && !only.media?.length;
  if (statement && singleSentence(only) && textLength(only) <= 80) {
    return { layout: 'statement' };
  }
  if (only?.kind === 'quote' && textLength(only) <= 140) return { layout: 'statement' };

  // media：画像・動画・図が1つだけ
  if (texts.length === 0 && codes.length === 0 && mediaCount === 1) return { layout: 'media' };

  // grid：画像が2〜6枚で、文章は短い段落が1つまで
  const shortText = texts.every((b) => b.kind === 'paragraph' && textLength(b) <= 60);
  if (codes.length === 0 && mediaCount >= 2 && mediaCount <= 6 && texts.length <= 1 && shortText) {
    return { layout: 'grid', columns: mediaCount <= 3 ? mediaCount : mediaCount === 4 ? 2 : 3 };
  }

  // split：文章＋メディア（またはコード）1つ（§5.3）
  const proseOnly = texts.every((b) => b.kind === 'paragraph' || b.kind === 'list');
  const prose = texts.reduce((n, b) => n + textLength(b), 0);
  if (media.length + codes.length === 1 && texts.length > 0 && proseOnly && prose <= 360) {
    const code = codes[0];
    if (code) {
      // 最長行が60文字を超えるコードは、左右に並べずに上下に積む
      const longest = Math.max(...code.raw.split('\n').map((line) => line.length));
      if (longest <= 62) return { layout: 'split', ratio: orient([1, 1]), mediaLeft };
    } else if (mediaCount === 1) {
      const block = media[0]!;
      const aspect = isFigureCode(block)
        ? diagramAspect(diagram?.({ lang: block.lang ?? '', code: fenceContent(block.raw) }))
        : visibleMedia(block)[0]?.kind === 'diagram' || visibleMedia(block)[0]?.kind === 'arch'
          ? diagramAspect(
              diagram?.({
                lang: visibleMedia(block)[0]!.kind === 'arch' ? 'arch' : 'mermaid',
                src: decodePath(visibleMedia(block)[0]!.src),
              }),
            )
          : aspectOf(visibleMedia(block)[0]?.src, probe);
      // とても横長（2.2:1 以上）なら上下に積む。縦長なら文章 60：メディア 40
      if (aspect === undefined || aspect < 2.2) {
        const auto: [number, number] = aspect !== undefined && aspect < 1 ? [3, 2] : [1, 1];
        return { layout: 'split', ratio: orient(auto), mediaLeft };
      }
    }
  }

  // columns：分量の近い小見出しが2〜4個
  const groups = subheadingGroups(blocks, slideLevel);
  if (groups && groups.length >= 2 && groups.length <= 4) {
    const sizes = groups.map((g) => g.reduce((n, b) => n + textLength(b), 0));
    if (Math.max(...sizes) <= Math.min(...sizes) * 2.5) {
      return { layout: 'columns', columns: groups.length };
    }
  }
  return { layout: 'stack' };
}

/** 小見出しごとの中身。最初の小見出しより前に何かあれば undefined。 */
export function subheadingGroups(blocks: Block[], slideLevel: number): Block[][] | undefined {
  const level = slideLevel + 1;
  if (blocks[0]?.kind !== 'heading' || blocks[0].level !== level) return undefined;
  const groups: Block[][] = [];
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level === level) groups.push([]);
    else if (b.kind === 'heading') return undefined;
    else groups[groups.length - 1]!.push(b);
  }
  return groups.every((g) => g.length > 0) ? groups : undefined;
}

/** 描いた図の縦横比（描けなかった・エラーなら undefined） */
function diagramAspect(result: DiagramResult | undefined): number | undefined {
  return result && 'svg' in result && result.height > 0 ? result.width / result.height : undefined;
}

/** コードブロックの中身（最初と最後の囲みの行を除く） */
function fenceContent(raw: string): string {
  const lines = raw.split('\n');
  return `${lines.slice(1, -1).join('\n')}\n`;
}

function aspectOf(src: string | undefined, probe: MediaProbe | undefined): number | undefined {
  if (!src || !probe) return undefined;
  const path = decodePath(src);
  const info = probe(path);
  return info?.width && info.height ? info.width / info.height : undefined;
}

function parseRatio(value: string | true | undefined): [number, number] | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(value);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}
