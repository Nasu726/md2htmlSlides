import type { Diagnostic } from './diagnostics.js';
import type { Block, Deck, MediaRef, SectionNode } from './ir.js';

/** 本文中のメディアの種類（構文仕様 §6.1）。 */
export type MediaKind = 'image' | 'video' | 'youtube' | 'vimeo';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

/** 拡張子と URL から、メディアの種類を決める。 */
export function mediaKind(src: string): MediaKind {
  if (youtubeId(src)) return 'youtube';
  if (vimeoId(src)) return 'vimeo';
  const path = src.split(/[?#]/)[0] ?? '';
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext && VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
}

function youtubeId(src: string): string | undefined {
  const m =
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/)([\w-]{6,})/.exec(
      src,
    ) ?? /^https?:\/\/youtu\.be\/([\w-]{6,})/.exec(src);
  return m?.[1];
}

function vimeoId(src: string): string | undefined {
  return /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)/.exec(src)?.[1];
}

/** YouTube・Vimeo の URL を、埋め込みプレイヤーの URL にする。 */
export function embedUrl(src: string): string | undefined {
  const yt = youtubeId(src);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}`;
  const vimeo = vimeoId(src);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo}`;
  return undefined;
}

/** 手元のファイルを指すパスか（URL・data URI でない）。 */
export function isLocalPath(src: string): boolean {
  return src !== '' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src);
}

/** ファイルを調べた結果。width と height は画像の縦横の画素数（わかれば）。 */
export interface MediaInfo {
  exists: boolean;
  width?: number;
  height?: number;
  /** 背景に使うときの明るさ（0〜1。CLI がブラウザで測る） */
  luminance?: number;
}

/**
 * パスからファイルを調べる関数。CLI やエディタが、ファイルの読み方に合わせて渡す。
 * 調べられないもの（URL など）には undefined を返す。
 */
export type MediaProbe = (src: string) => MediaInfo | undefined;

/**
 * ファイルの先頭から縦横の画素数を読む（PNG・JPEG・GIF・WebP・SVG と、MP4・MOV の動画）。
 * 縦横比を描く前に決めておくと、読み込みの途中でレイアウトが動かない（設計プラン §5.4）。
 */
export function mediaSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const at = (i: number) => bytes[i] ?? 0;
  const u16be = (i: number) => (at(i) << 8) | at(i + 1);
  const u16le = (i: number) => at(i) | (at(i + 1) << 8);
  const u24le = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
  const u32be = (i: number) =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  const ok = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : undefined;

  // PNG：IHDR の幅と高さ
  if (ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') return ok(u32be(16), u32be(20));
  // GIF
  if (ascii(0, 3) === 'GIF') return ok(u16le(6), u16le(8));
  // JPEG：SOF マーカーを探す
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return undefined;
      const marker = at(i + 1);
      if (marker === 0xff) {
        i++;
        continue;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return ok(u16be(i + 7), u16be(i + 5));
      i += 2 + u16be(i + 2);
    }
    return undefined;
  }
  // WebP
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const b = (i: number) => at(21 + i);
      return ok(
        1 + (((b(1) & 0x3f) << 8) | b(0)),
        1 + (((b(3) & 0x0f) << 10) | (b(2) << 2) | (b(1) >> 6)),
      );
    }
    if (chunk === 'VP8X') return ok(1 + u24le(24), 1 + u24le(27));
    return undefined;
  }
  // MP4・MOV：映像のトラックの tkhd にある幅と高さ（16.16 の固定小数点）
  if (ascii(4, 4) === 'ftyp') {
    for (let i = 4; i + 92 < bytes.length; i++) {
      if (at(i) !== 0x74 || ascii(i, 4) !== 'tkhd') continue;
      const base = i + 4 + (at(i + 4) === 1 ? 88 : 76);
      const size = ok(u32be(base) >>> 16, u32be(base + 4) >>> 16);
      if (size) return size;
    }
    return undefined;
  }
  // SVG：width と height、なければ viewBox
  const head = new TextDecoder().decode(bytes.subarray(0, 2048));
  const svg = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (svg) {
    const num = (name: string) => {
      const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`).exec(svg);
      return m ? Number(m[1]) : undefined;
    };
    const width = num('width');
    const height = num('height');
    if (width && height) return ok(width, height);
    const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
    if (box) return ok(Number(box[1]), Number(box[2]));
  }
  return undefined;
}

/** デッキの中のメディアを、出てくる順にすべて返す（背景も含む）。 */
export function collectMedia(deck: Deck): MediaRef[] {
  const out: MediaRef[] = [];
  const visitBlocks = (blocks: Block[]) => {
    for (const block of blocks) {
      out.push(...(block.media ?? []));
      if (block.children) visitBlocks(block.children);
    }
  };
  const visit = (node: SectionNode) => {
    visitBlocks(node.blocks);
    node.children.forEach(visit);
  };
  visit(deck.root);
  return out;
}

/**
 * 手元のファイルが見つからないメディアを警告する（構文仕様 §6.1）。
 * ファイルの読み方は環境で違うので、調べる関数を受け取る。
 */
export function checkMediaFiles(deck: Deck, probe: MediaProbe): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const media of collectMedia(deck)) {
    if (!isLocalPath(media.src)) continue;
    const poster = media.attrs?.values.poster;
    const paths = [media.src, ...(typeof poster === 'string' ? [poster] : [])];
    for (const path of paths) {
      if (probe(path)?.exists !== false) continue;
      diagnostics.push({
        severity: 'warning',
        code: 'media/not-found',
        message: `ファイルが見つかりません：${path}`,
        line: media.line,
      });
    }
  }
  return diagnostics;
}
