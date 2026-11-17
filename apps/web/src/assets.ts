import { isLocalPath, mediaSize, type MediaInfo } from '@mds/core';

/**
 * 資料が参照する素材（画像・動画・ロゴ・CSS）をどこから読むか（#73、設計プラン §9.1）。
 * - フォルダを開いた：フォルダの中のファイル
 * - ファイルを選んだ・落とした：一緒に選んだファイル（名前で探す）
 * - `?src=URL`：その URL からの相対パス
 * - 新しい資料・下書き：なし（見つからない素材として枠だけを出す）
 */
export interface AssetSource {
  /** 資料のフォルダからの相対パス（`img/a.png`）のファイルを読む。なければ undefined */
  read(path: string): Promise<Blob | undefined>;
}

export const noAssets: AssetSource = { read: async () => undefined };

/** パスを、資料のフォルダからの相対パスにそろえる（`./a.png` → `a.png`、`img/../a.png` → `a.png`） */
export function normalizePath(src: string): string {
  let path = src.split(/[?#]/)[0]!;
  try {
    path = decodeURI(path);
  } catch {
    // そのまま
  }
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** HTML の中で素材を指す印（iframe の中で、その iframe が作った Blob の URL に置き換える） */
export const assetMark = (key: string) => `data:text/plain,mds-asset=${assetKey(key)}`;

/**
 * 印に使うキー：パスを符号化する。`'`・`(`・`)` なども符号化し、CSS の `url('…')` の中でも
 * 印の終わりがわかるようにする
 */
export const assetKey = (path: string) =>
  encodeURIComponent(path).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

interface Entry {
  blob?: Blob;
  info: MediaInfo;
}

/** 素材の読み込みと、縦横の情報（core の probe に渡す） */
export class AssetStore {
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<void>>();

  constructor(private source: AssetSource) {}

  /** パスの一覧を読み込んでおく（読み込み済みのものは飛ばす） */
  async ensure(srcs: string[]): Promise<void> {
    await Promise.all(
      srcs.filter(isLocalPath).map((src) => {
        const key = normalizePath(src);
        if (!key || this.entries.has(key)) return undefined;
        let promise = this.loading.get(key);
        if (!promise) {
          promise = this.load(key);
          this.loading.set(key, promise);
        }
        return promise;
      }),
    );
  }

  private async load(key: string): Promise<void> {
    let blob: Blob | undefined;
    try {
      blob = await this.source.read(key);
    } catch {
      blob = undefined;
    }
    if (!blob) {
      this.entries.set(key, { info: { exists: false } });
      return;
    }
    // 縦横は先頭から読む（MP4 は末尾にあることもあるので、64MB までは全体を読む。CLI と同じ）
    const head = blob.size <= 64 * 1024 * 1024 ? blob : blob.slice(0, 4 * 1024 * 1024);
    const size = mediaSize(new Uint8Array(await head.arrayBuffer()));
    this.entries.set(key, { blob, info: { exists: true, ...size } });
  }

  probe = (src: string): MediaInfo | undefined => {
    if (!isLocalPath(src)) return undefined;
    return this.entries.get(normalizePath(src))?.info;
  };

  /** 描くときに使われたが、まだ読み込んでいない素材（collectMedia で拾えない場所の素材のため） */
  private requested = new Set<string>();

  url = (src: string): string => {
    if (!isLocalPath(src)) return src;
    const key = normalizePath(src);
    if (!this.entries.has(key)) this.requested.add(key);
    return assetMark(key);
  };

  /** 描くときに使われたが、まだ読み込んでいない素材を返し、記録を消す */
  takeRequested(): string[] {
    const keys = [...this.requested].filter((key) => !this.entries.has(key));
    this.requested.clear();
    return keys;
  }

  /** 読み込んだ素材の Blob（iframe に渡す。キーは印と同じく符号化したもの） */
  blobs(): Array<[string, Blob]> {
    const out: Array<[string, Blob]> = [];
    for (const [key, entry] of this.entries) {
      if (entry.blob) out.push([assetKey(key), entry.blob]);
    }
    return out;
  }

  /** CSS などの文字のファイルを読む */
  async text(src: string): Promise<string | undefined> {
    await this.ensure([src]);
    return this.entries.get(normalizePath(src))?.blob?.text();
  }
}

/** フォルダを開いたとき：フォルダの中のファイル。資料のフォルダからの相対パスで探す */
export function folderSource(
  files: Map<string, FileSystemFileHandle>,
  mdPath: string,
): AssetSource {
  const dir = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/') + 1) : '';
  return {
    async read(path) {
      const handle = files.get(normalizePath(dir + path));
      return handle ? handle.getFile() : undefined;
    },
  };
}

/** ファイルを選んだ・落としたとき：一緒に選んだファイルを、パスか名前で探す */
export function fileListSource(files: File[]): AssetSource {
  return {
    async read(path) {
      const name = path.split('/').pop();
      return (
        files.find((file) => normalizePath(file.webkitRelativePath || file.name) === path) ??
        files.find((file) => file.name === name)
      );
    },
  };
}

/** `?src=URL` のとき：その URL からの相対パス（読めなければ、見つからない素材として扱う） */
export function urlSource(base: string): AssetSource {
  return {
    async read(path) {
      const response = await fetch(new URL(path, base));
      return response.ok ? response.blob() : undefined;
    },
  };
}
