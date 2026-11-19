import type { ArchScenario } from '../arch/parse.js';
import { archEmbedAttrs, selectArchScenario } from '../render/arch.js';
import type { MarkdownIt, Renderer, StateCore, Token } from 'markdown-it';
import { cssPosition, isPosition, type Attrs } from '../attrs.js';
import {
  decodePath,
  embedUrl,
  mediaKind,
  type MediaInfo,
  type MediaKind,
  type MediaProbe,
} from '../media.js';
import type { MathRenderer } from './math.js';

/**
 * 描画のときに markdown-it に渡す情報。
 * markdown-it の Env（添字シグネチャ付き）と互換にするため、interface ではなく type にする。
 */
export type RenderEnv = {
  /** ファイルを調べる関数（見つからない画像に枠だけを出す・縦横比を先に決めるのに使う） */
  probe?: MediaProbe;
  /** 書き出し先での URL に置き換える関数（素材をコピーする CLI が使う） */
  assetUrl?: (src: string) => string;
  /**
   * 単一 HTML（#120）に埋め込まない動画（大きすぎる動画）なら true。
   * 動画の代わりにポスター（なければ枠）を出す。背景の動画も同じ
   */
  omitVideo?: (src: string) => boolean;
  /** デッキの言語（見出しの文節改行に使う） */
  lang?: string;
  /**
   * コードの色分け（#68）。色を付けた HTML（エスケープ済みの文字と span）を返す。
   * 対応していない言語なら undefined を返し、色を付けずに出す。
   */
  highlight?: CodeHighlighter;
  /** 図を描く関数（#71）。なければ ```mermaid はコードのまま、`.mmd` は枠だけを出す */
  diagram?: DiagramRenderer;
  /** 数式を描く関数（#72）。なければ TeX のまま出す */
  math?: MathRenderer;
};

/** コードの色分けをする関数。同期で返す（必要な文法は、呼ぶ側が先に読み込んでおく） */
export type CodeHighlighter = (code: string, lang: string) => string | undefined;

/** 図にするもの：コードブロック（```mermaid）の中身か、ファイル（`![](flow.mmd)`）のパス */
export type DiagramInput = { lang: string; code: string } | { lang: string; src: string };
/**
 * 描いた図（SVG と、その縦横の大きさ）か、構文エラー。
 * 動く構成図（#107）は、説明のリストと再生のために、読んだシナリオも持つ
 */
export type DiagramResult =
  { svg: string; width: number; height: number; scenarios?: ArchScenario[] } | { error: string };
/**
 * 図を描く関数（#71）。CLI が書き出しの前にヘッドレス Chromium で描いておき、ここでは結果を返すだけ。
 * 描けないとき（Chromium がないなど）は undefined を返す。
 */
export type DiagramRenderer = (input: DiagramInput) => DiagramResult | undefined;

/** 図の中身の HTML。SVG は縦横比を保って枠に合わせる（has-ratio） */
export function diagramHtml(
  esc: (s: string) => string,
  result: DiagramResult,
  label: string,
  errorTitle = 'Mermaid の構文エラー',
): string {
  if ('error' in result) {
    return `<div class="mds-diagram-error" role="note"><b>${esc(errorTitle)}</b><span>${esc(result.error)}</span></div>`;
  }
  const ratio = result.width > 0 && result.height > 0 ? result.width / result.height : 1.6;
  return `<div class="mds-diagram has-ratio" style="--mds-ar:${ratio.toFixed(4)}" role="img" aria-label="${esc(label)}">${result.svg}</div>`;
}

/** 画像・動画だけからなる段落に付ける印。 */
export type MediaGroupMeta = {
  mediaGroup?: 'flex' | 'rigid';
  /** 背景の画像だけの段落（本文には何も出さない） */
  empty?: boolean;
};

type ImageMeta = { attrs?: Attrs; figure?: boolean };

const attrsOf = (token: Token) => (token.meta as ImageMeta | null)?.attrs;
const isBackground = (token: Token) => attrsOf(token)?.values.bg !== undefined;

function widthOf(token: Token): string | undefined {
  const width = attrsOf(token)?.values.width;
  return typeof width === 'string' ? width : undefined;
}

/**
 * 画像・動画だけからなる段落を「メディアの並び」にする（構文仕様 §6.1）。
 * 並びは `figure` を横に並べ、空いた領域いっぱいに縦横比を保って伸縮する（設計プラン §5.4）。
 * すべてに `width=` があれば、伸縮せずに幅から高さを決める。
 */
export function mediaPlugin(md: MarkdownIt): void {
  md.core.ruler.push('mds_media_group', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i + 1 < tokens.length; i++) {
      const open = tokens[i]!;
      const inline = tokens[i + 1]!;
      if (open.type !== 'paragraph_open' || open.hidden || inline.type !== 'inline') continue;
      const children = inline.children ?? [];
      const onlyMedia = children.every(
        (c) =>
          c.type === 'image' ||
          c.type === 'softbreak' ||
          c.type === 'hardbreak' ||
          (c.type === 'text' && c.content.trim() === ''),
      );
      const images = children.filter((c) => c.type === 'image');
      if (!onlyMedia || images.length === 0) continue;
      const visible = images.filter((c) => !isBackground(c));
      const meta: MediaGroupMeta =
        visible.length === 0
          ? { empty: true }
          : { mediaGroup: visible.every((c) => widthOf(c) !== undefined) ? 'rigid' : 'flex' };
      open.meta = { ...(open.meta as object | null), ...meta };
      for (const image of visible) image.meta = { ...(image.meta as object | null), figure: true };
    }
  });
}

/** 画像・動画の描画。背景（`{bg}`）は本文に出さない。並びの中では `figure` にする。 */
export function renderMedia(
  md: MarkdownIt,
  tokens: Token[],
  idx: number,
  env: RenderEnv | undefined,
): string {
  const token = tokens[idx]!;
  const meta = token.meta as ImageMeta | null;
  const attrs = meta?.attrs;
  if (attrs?.values.bg !== undefined) return '';
  const esc = md.utils.escapeHtml;
  const src = String(token.attrGet('src') ?? '');
  const alt = md.renderer.renderInlineAsText(token.children ?? [], md.options, env ?? {});
  const kind = mediaKind(src);
  const info = kind === 'image' || kind === 'video' ? env?.probe?.(decodePath(src)) : undefined;
  // 図のファイル（.mmd・.arch）：描いた図。描けなければファイル名の枠だけを出す（#71・#106）
  const diagram =
    kind === 'diagram' || kind === 'arch'
      ? env?.diagram?.({ lang: kind === 'arch' ? 'arch' : 'mermaid', src: decodePath(src) })
      : undefined;
  const width = widthOf(token);
  const url = (path: string) => (env?.assetUrl ? env.assetUrl(path) : path);
  // 単一 HTML に埋め込まない動画（#120）
  const omitted = kind === 'video' && Boolean(env?.omitVideo?.(decodePath(src)));

  if (!meta?.figure) {
    // 文中の画像：縦横比で伸縮しない。属性のクラスと ID、幅だけを付ける
    const element = mediaElement(esc, kind, src, alt, attrs, info, false, url, diagram, omitted);
    const extra = classAndId(esc, attrs) + (width ? ` style="width:${esc(width)}"` : '');
    return element.replace(/^<(\w+)/, (_, tag: string) => `<${tag}${extra}`);
  }
  const element = mediaElement(esc, kind, src, alt, attrs, info, true, url, diagram, omitted);

  const title = token.attrGet('title');
  const caption =
    typeof attrs?.values.caption === 'string' ? attrs.values.caption : title ? String(title) : '';
  const classes = [
    'mds-media',
    `mds-media-${kind === 'youtube' || kind === 'vimeo' ? 'embed' : kind}`,
    ...(width ? ['is-fixed'] : []),
    ...(info?.exists === false ? ['is-missing'] : []),
    ...(attrs?.values.fit === 'cover' ? ['fit-cover'] : []),
    ...(attrs?.classes ?? []),
  ];
  const id = attrs?.id ? ` id="${esc(attrs.id)}"` : '';
  const step = attrs?.values.step;
  const stepAttr =
    step === undefined ? '' : ` data-mds-step="${step === true ? 'auto' : esc(String(step))}"`;
  const style = width ? ` style="width:${esc(width)}"` : '';
  const figcaption = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
  // 動く構成図（#108）：シナリオの再生のための属性
  const embed =
    kind === 'arch' && diagram && !('error' in diagram)
      ? archEmbedAttrs(selectArchScenario(diagram.scenarios, attrs), esc, attrs)
      : '';
  return `<figure class="${classes.map(esc).join(' ')}"${id}${stepAttr}${embed}${style}><div class="mds-media-frame">${element}</div>${figcaption}</figure>`;
}

function mediaElement(
  esc: (s: string) => string,
  kind: MediaKind,
  src: string,
  alt: string,
  attrs: Attrs | undefined,
  info: MediaInfo | undefined,
  /** figure の中に置く（枠に合わせて伸縮する） */
  framed: boolean,
  /** 書き出し先での URL */
  url: (path: string) => string,
  /** 図のファイル（.mmd）を描いた結果 */
  diagram?: DiagramResult,
  /** 単一 HTML に埋め込まない動画（#120）：ポスター（なければ枠）を出す */
  omitted = false,
): string {
  const flag = (name: string) => attrs?.values[name] !== undefined;
  if (kind === 'diagram' || kind === 'arch') {
    if (diagram) {
      const title = kind === 'arch' ? '動く構成図を描けません' : undefined;
      return diagramHtml(esc, diagram, alt || src, title);
    }
    const label = alt || decodePath(src).split('/').pop() || src;
    return `<span class="mds-media-placeholder" role="img" aria-label="${esc(label)}">${esc(label)}</span>`;
  }
  if (info?.exists === false) {
    // 見つからないファイルは枠だけを出す
    const label = alt || decodePath(src).split('/').pop() || src;
    return `<span class="mds-media-placeholder" role="img" aria-label="${esc(label)}">${esc(label)}</span>`;
  }
  if (kind === 'youtube' || kind === 'vimeo') {
    const params: string[] = [];
    if (flag('autoplay')) params.push('autoplay=1');
    if (flag('muted')) params.push(kind === 'youtube' ? 'mute=1' : 'muted=1');
    if (flag('loop') && kind === 'vimeo') params.push('loop=1');
    const url = embedUrl(src)! + (params.length > 0 ? `?${params.join('&')}` : '');
    const title = alt || (kind === 'youtube' ? 'YouTube の動画' : 'Vimeo の動画');
    const ratio = framed ? ' class="has-ratio" style="--mds-ar:1.7778"' : '';
    const iframe = `<iframe${ratio} src="${esc(url)}" title="${esc(title)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    if (!framed) return iframe;
    // 印刷・PDF では iframe を出せないので、サムネイル（YouTube）とリンクに置き換える（#70）
    const id = embedUrl(src)!.split('/').pop()!;
    const thumb =
      kind === 'youtube'
        ? `background-image:url('https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg');`
        : '';
    const label = `▶ ${kind === 'youtube' ? 'YouTube' : 'Vimeo'} · ${src}`;
    return `${iframe}<a class="mds-print-link has-ratio" style="--mds-ar:1.7778;${thumb}" href="${esc(src)}"><span>${esc(label)}</span></a>`;
  }
  // 縦横比がわかれば、枠を中身の形に合わせる（角丸が中身に沿う）
  const known = framed && info?.width && info.height ? info : undefined;
  // pos=：切り取る・収めるときに残す位置
  const posValue = attrs?.values.pos;
  const pos = typeof posValue === 'string' && isPosition(posValue) ? cssPosition(posValue) : '';
  const styles = [
    ...(known ? [`--mds-ar:${(known.width! / known.height!).toFixed(4)}`] : []),
    ...(pos ? [`object-position:${pos}`] : []),
  ];
  const ratio =
    (known ? ` class="has-ratio"` : '') +
    (styles.length > 0 ? ` style="${esc(styles.join(';'))}"` : '') +
    (known ? ` width="${known.width}" height="${known.height}"` : '');
  if (kind === 'video' && omitted) {
    const poster = attrs?.values.poster;
    if (typeof poster === 'string') {
      return `<img class="mds-video-poster${known ? ' has-ratio' : ''}" src="${esc(url(poster))}" alt="${esc(alt)}"${ratio.replace(' class="has-ratio"', '')}>`;
    }
    const label = `▶ ${alt || decodePath(src).split('/').pop() || src}`;
    return `<span class="mds-media-placeholder" role="img" aria-label="${esc(label)}">${esc(label)}</span>`;
  }
  if (kind === 'video') {
    const parts = [`src="${esc(url(src))}"`];
    // 再生の方法を何も指定しなければ、操作ボタンを出す（再生できなくならないように）
    if (flag('controls') || !flag('autoplay')) parts.push('controls');
    for (const name of ['autoplay', 'loop', 'muted']) if (flag(name)) parts.push(name);
    parts.push('playsinline', 'preload="metadata"');
    const poster = attrs?.values.poster;
    if (typeof poster === 'string') parts.push(`poster="${esc(url(poster))}"`);
    if (alt) parts.push(`aria-label="${esc(alt)}"`);
    return `<video${ratio} ${parts.join(' ')}></video>`;
  }
  return `<img src="${esc(url(src))}" alt="${esc(alt)}"${ratio}>`;
}

function classAndId(esc: (s: string) => string, attrs: Attrs | undefined): string {
  if (!attrs) return '';
  return (
    (attrs.classes.length > 0 ? ` class="${attrs.classes.map(esc).join(' ')}"` : '') +
    (attrs.id ? ` id="${esc(attrs.id)}"` : '')
  );
}

/** メディアの並びの段落は、画像だけを描く（改行や空白は描かない）。 */
export function renderMediaGroupInline(
  renderer: Renderer,
  children: Token[],
  options: MarkdownIt['options'],
  env: RenderEnv,
): string {
  return children
    .map((child, i) =>
      child.type === 'image' ? renderer.rules.image!(children, i, options, env, renderer) : '',
    )
    .join('');
}
