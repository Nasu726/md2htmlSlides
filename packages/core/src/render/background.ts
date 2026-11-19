/**
 * スライドの背景（構文仕様 §6.2）：`{bg}`・`{bg=left}`・`{bg=right}` の画像・動画。
 * `dim=`（暗くする）・`blur=`（ぼかす）・`fit=contain`（切り取らずに収める）・
 * `pos=`（切り取る・収めるときに残す位置）・`fill=blur`（収めたときの帯をぼかした画像で埋める）を反映し、
 * 全面の背景では、背景の明るさから文字色（明るい文字／暗い文字）を選ぶ。
 */
import { cssPosition, isPosition } from '../attrs.js';
import type { Block, MediaRef } from '../ir.js';
import { md } from '../md/instance.js';
import type { RenderEnv } from '../md/media.js';
import { decodePath, mediaKind } from '../media.js';

export type BackgroundPosition = 'full' | 'left' | 'right';

export interface Background {
  media: MediaRef;
  position: BackgroundPosition;
}

const esc = (text: string) => md.utils.escapeHtml(text);

/** 背景だけの段落か（本文には何も出さない）。 */
export function isBackgroundBlock(b: Block): boolean {
  return (
    b.kind === 'paragraph' &&
    (b.media ?? []).length > 0 &&
    b.media!.every((m) => m.attrs?.values.bg !== undefined) &&
    b.raw.replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, '').trim() === ''
  );
}

/** スライドの中で最初に書かれた背景。 */
export function findBackground(blocks: Block[]): Background | undefined {
  for (const block of blocks) {
    const media = block.media?.find((m) => m.attrs?.values.bg !== undefined);
    if (!media) continue;
    const value = media.attrs!.values.bg;
    const position: BackgroundPosition = value === 'left' || value === 'right' ? value : 'full';
    return { media, position };
  }
  return undefined;
}

/** 明るさがわからない全面の背景は、文字を読めるように少し暗くする。 */
const DEFAULT_DIM = 0.35;
/** これより明るい背景には暗い文字を使う（dim を反映した後の明るさ） */
const LIGHT = 0.55;

/**
 * 背景の HTML と、スライドに付けるクラスを返す。
 * クラス：`has-bg-full|left|right`、全面なら `bg-tone-dark`（明るい文字）か `bg-tone-light`（暗い文字）。
 */
export function renderBackground(
  bg: Background,
  env: RenderEnv,
): { html: string; classes: string[] } {
  const { media, position } = bg;
  const values = media.attrs?.values ?? {};
  // 単一 HTML に埋め込まない動画（#120）：ポスターがあれば画像として、なければ暗い面を敷く
  const isVideo = mediaKind(media.src) === 'video';
  const decoded = decodePath(media.src);
  const omitted = isVideo && Boolean(env.omitVideo?.(decoded));
  const poster = omitted && typeof values.poster === 'string' ? values.poster : undefined;
  const src = poster ?? media.src;
  const url = env.assetUrl ? env.assetUrl(src) : src;
  const blur = typeof values.blur === 'string' ? Number(values.blur) : 0;
  // fill=blur は「帯をぼかした画像で埋めて、全体を収める」なので、fit=contain になる
  const fillBlur = values.fill === 'blur' && values.fit !== 'cover';
  const contain = values.fit === 'contain' || fillBlur;
  // 切り取る・収めるときに残す位置（pos=）
  const pos =
    typeof values.pos === 'string' && isPosition(values.pos) ? cssPosition(values.pos) : '';

  // 明るさ（0〜1）。CLI がブラウザで測って probe で渡す
  const path = decodePath(media.src);
  const luminance = env.probe?.(path)?.luminance;
  let dim = typeof values.dim === 'string' ? Number(values.dim) : undefined;
  let tone: 'dark' | 'light' | undefined;
  if (position === 'full') {
    if (luminance === undefined) {
      dim ??= DEFAULT_DIM;
      tone = 'dark';
    } else {
      tone = luminance * (1 - (dim ?? 0)) >= LIGHT ? 'light' : 'dark';
    }
  }

  const filter = blur > 0 ? `filter:blur(${blur}px);transform:scale(1.04);` : '';
  const cssUrl = url.replace(/["'()\\\s]/g, (c) => encodeURIComponent(c));
  const video = isVideo && !omitted;
  const place = pos ? (video ? `object-position:${pos};` : `background-position:${pos};`) : '';
  const blank = omitted && !poster;
  const layer = blank
    ? `<div class="mds-bg-media" style="background:#1e293b"></div>`
    : video
      ? `<video class="mds-bg-media" src="${esc(url)}" style="${filter}${place}" autoplay muted loop playsinline preload="auto" aria-hidden="true"></video>`
      : `<div class="mds-bg-media" style="background-image:url('${esc(cssUrl)}');${filter}${place}"></div>`;
  // 帯を埋める、ぼかした同じ画像・動画（全面を覆うように拡大して、後ろに置く）
  const fill =
    !fillBlur || blank
      ? ''
      : video
        ? `<video class="mds-bg-fill" src="${esc(url)}" autoplay muted loop playsinline preload="auto" aria-hidden="true"></video>`
        : `<div class="mds-bg-fill" style="background-image:url('${esc(cssUrl)}')"></div>`;
  const overlay =
    dim !== undefined && dim > 0 ? `<div class="mds-bg-dim" style="opacity:${dim}"></div>` : '';
  const classes = [
    'mds-bg',
    `mds-bg-${position}`,
    ...(contain ? ['fit-contain'] : []),
    ...(fillBlur ? ['fill-blur'] : []),
  ];
  return {
    html: `<div class="${classes.join(' ')}">${fill}${layer}${overlay}</div>\n`,
    classes: [`has-bg-${position}`, ...(tone ? [`bg-tone-${tone}`] : [])],
  };
}

/**
 * ブラウザで実行する：画像・動画を 32×32 に縮めて描き、平均の明るさ（相対輝度）を返す。
 * Playwright の page.evaluate にそのまま渡すので、外側の変数を使わない。
 */
export async function averageLuminance(
  items: Array<{ url: string; video: boolean }>,
): Promise<Array<number | null>> {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return items.map(() => null);
  const load = (item: { url: string; video: boolean }) =>
    new Promise<CanvasImageSource | null>((done) => {
      const timer = setTimeout(() => done(null), 4000);
      const finish = (source: CanvasImageSource | null) => {
        clearTimeout(timer);
        done(source);
      };
      if (item.video) {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.addEventListener('loadeddata', () => (video.currentTime = 0.1), { once: true });
        video.addEventListener('seeked', () => finish(video), { once: true });
        video.addEventListener('error', () => finish(null), { once: true });
        video.src = item.url;
      } else {
        const image = new Image();
        image.addEventListener('load', () => finish(image), { once: true });
        image.addEventListener('error', () => finish(null), { once: true });
        image.src = item.url;
      }
    });
  const out: Array<number | null> = [];
  for (const item of items) {
    const source = await load(item);
    if (!source) {
      out.push(null);
      continue;
    }
    context.clearRect(0, 0, 32, 32);
    context.drawImage(source, 0, 0, 32, 32);
    const { data } = context.getImageData(0, 0, 32, 32);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
    }
    out.push(sum / (data.length / 4));
  }
  return out;
}
