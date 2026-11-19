import { collectMedia, isLocalPath, mediaSize, type Deck, type MediaInfo } from '@mds/core';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

/** 素材（画像・動画・ロゴ・CSS）のパスを、資料のフォルダを基準に解決する。 */
export interface Assets {
  /** 資料（.md）のあるフォルダ */
  root: string;
  /** ファイルを調べる（core の probe に渡す） */
  probe(src: string): MediaInfo | undefined;
  /** 書き出し先での URL（core の assetUrl に渡す）。フォルダの外のファイルは `_external/` に置く */
  url(src: string): string;
  /** URL から元のファイルの絶対パスを引く（dev サーバー用）。知らない URL なら undefined */
  file(url: string): string | undefined;
  /** これまでに url() を通った手元のファイル（[元の絶対パス, 書き出し先の相対 URL]） */
  used(): Array<[string, string]>;
  /** 手元のファイルの大きさ（バイト）。ないファイル・手元でないものは undefined */
  bytes(src: string): number | undefined;
  /** ファイルの中身を data: URL にする（単一 HTML。#120）。ないファイル・手元でないものはそのまま */
  dataUrl(src: string): string;
  /** data: URL にしたファイル（[元の絶対パス, バイト数]） */
  embedded(): Array<[string, number]>;
}

/** data: URL の種類（拡張子から） */
const MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
};

/**
 * 縦横を読むためのバイト列。MP4 は縦横（moov）が末尾にあることもあるので、
 * 64MB までは全体を読み、それより大きければ先頭の 4MB だけを読む。
 */
function readHead(path: string, size: number): Uint8Array {
  if (size <= 64 * 1024 * 1024) return readFileSync(path);
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(4 * 1024 * 1024);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

function decode(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

/** URL に使えるように、パスの区切りを / にして符号化する。 */
function toUrl(path: string): string {
  return encodeURI(path.split(sep).join('/')).replace(/[?#]/g, encodeURIComponent);
}

export function createAssets(mdFile: string): Assets {
  const root = dirname(resolve(mdFile));
  const sizes = new Map<string, MediaInfo>();
  const byUrl = new Map<string, string>();
  const inlined = new Map<string, { url: string; bytes: number }>();

  const absolute = (src: string) => {
    const path = decode(src).split(/[?#]/)[0]!;
    return isAbsolute(path) ? path : resolve(root, path);
  };
  const bytesOf = (src: string) => {
    if (!isLocalPath(src)) return undefined;
    const path = absolute(src);
    const stat = existsSync(path) ? statSync(path) : undefined;
    return stat?.isFile() ? stat.size : undefined;
  };

  return {
    root,
    probe(src) {
      if (!isLocalPath(src)) return undefined;
      const path = absolute(src);
      const cached = sizes.get(path);
      if (cached) return cached;
      let info: MediaInfo = { exists: false };
      const stat = existsSync(path) ? statSync(path) : undefined;
      if (stat?.isFile()) info = { exists: true, ...mediaSize(readHead(path, stat.size)) };
      sizes.set(path, info);
      return info;
    },
    url(src) {
      if (!isLocalPath(src)) return src;
      const path = absolute(src);
      const inside = relative(root, path);
      const out =
        inside && !inside.startsWith('..') && !isAbsolute(inside)
          ? toUrl(inside)
          : `_external/${createHash('sha256').update(path).digest('hex').slice(0, 8)}/${toUrl(basename(path))}`;
      byUrl.set(out, path);
      return out;
    },
    file(url) {
      const path = decode(url.replace(/^\/+/, '').split(/[?#]/)[0]!);
      const known = byUrl.get(toUrl(path));
      if (known) return known;
      const inside = resolve(root, path);
      // 資料のフォルダの外は、url() を通ったものだけを返す
      return relative(root, inside).startsWith('..') ? undefined : inside;
    },
    used() {
      return [...byUrl.entries()].map(([url, path]) => [path, url]);
    },
    bytes: bytesOf,
    dataUrl(src) {
      if (!isLocalPath(src)) return src;
      const path = absolute(src);
      const cached = inlined.get(path);
      if (cached) return cached.url;
      if (bytesOf(src) === undefined) return src;
      const data = readFileSync(path);
      const ext = extname(path).slice(1).toLowerCase();
      const url = `data:${MIME[ext] ?? 'application/octet-stream'};base64,${data.toString('base64')}`;
      inlined.set(path, { url, bytes: data.length });
      return url;
    },
    embedded() {
      return [...inlined.entries()].map(([path, { bytes }]) => [path, bytes]);
    },
  };
}

/** デッキが参照する手元の素材（画像・動画・poster・ロゴ）をすべて url() に通す。 */
export function registerDeckAssets(deck: Deck, assets: Assets): void {
  for (const media of collectMedia(deck)) {
    assets.url(media.src);
    const poster = media.attrs?.values.poster;
    if (typeof poster === 'string') assets.url(poster);
  }
  if (deck.meta.logo) assets.url(deck.meta.logo);
}
