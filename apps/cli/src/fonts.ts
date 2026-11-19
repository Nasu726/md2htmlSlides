/**
 * 同梱するフォント（docs/design.md §6、#67）。
 *
 * - `mdhs dev` と計測：fontsource の分割ファイル一式を unicode-range で読み込む（ブラウザが必要な分だけ読む）
 * - `mdhs build`：スライドで使っている文字だけに絞り、HTML に埋め込む（file:// でも読み込める）
 *
 * 文字の形と幅はどちらも同じなので、計測と書き出しの結果はずれない。
 */
import { visibleText } from '@mdhs/embeds';
import { BUNDLED_FONTS, SERIF_FAMILY } from '@mdhs/themes';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);

/** 計測用のページでフォントを配る、架空の場所（ヘッドレス Chromium の route で返す） */
export const FONT_HOST = 'https://mds-fonts.invalid';

export interface FontFile {
  family: string;
  /** URL に使うパス（`@fontsource-variable/inter/files/….woff2`） */
  path: string;
  /** ファイルの絶対パス */
  file: string;
  /** `100 900` */
  weight: string;
  /** CSS の unicode-range の値 */
  rangeText: string;
  ranges: Array<[number, number]>;
}

let cache: FontFile[] | undefined;

/** 同梱するフォントの分割ファイルの一覧（パッケージの wght.css から読む） */
export function fontFiles(): FontFile[] {
  cache ??= BUNDLED_FONTS.flatMap(({ family, package: pkg }) => {
    const cssFile = require.resolve(`${pkg}/wght.css`);
    const css = readFileSync(cssFile, 'utf8');
    return Array.from(css.matchAll(/@font-face\s*\{([^}]*)\}/g), (m): FontFile | undefined => {
      const body = m[1]!;
      if (/font-style:\s*italic/.test(body)) return undefined;
      const url = /url\(\.\/([^)]+\.woff2)\)/.exec(body)?.[1];
      if (!url) return undefined;
      const rangeText = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'U+0-10FFFF';
      return {
        family,
        path: `${pkg}/${url}`,
        file: join(dirname(cssFile), url),
        weight: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '100 900',
        rangeText,
        ranges: parseRanges(rangeText),
      };
    }).filter((face): face is FontFile => face !== undefined);
  });
  return cache;
}

function parseRanges(text: string): Array<[number, number]> {
  return text.split(',').map((part) => {
    const [from, to] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(from!, 16), parseInt(to ?? from!, 16)];
  });
}

const covers = (face: FontFile, cp: number) => face.ranges.some(([a, b]) => cp >= a && cp <= b);

const fontFace = (face: FontFile, src: string, range = face.rangeText) =>
  `@font-face{font-family:'${face.family}';font-style:normal;font-display:swap;font-weight:${face.weight};src:url(${src}) format('woff2');unicode-range:${range};}`;

/** URL のパス（`@fontsource-variable/…`）から、ファイルの絶対パスを返す（dev と計測で配る） */
export function fontFileFor(path: string): string | undefined {
  return fontFiles().find((face) => face.path === path)?.file;
}

/** 分割ファイル一式の @font-face。prefix はファイルを配る場所（`/__mds/fonts` など） */
export function linkedFontCss(prefix: string): string {
  return fontFiles()
    .map((face) => fontFace(face, `${prefix}/${face.path}`))
    .join('\n');
}

const SANS = 'MDS Inter';
const CJK = 'MDS Noto Sans JP';
const MONO = 'MDS JetBrains Mono';
const SERIF = SERIF_FAMILY;

/**
 * 使っている文字だけに絞った @font-face（data: URL で埋め込む）。
 *
 * 書体ごとに、実際に描く文字だけを入れる（テーマのフォントの並び：本文は Inter → Noto Sans JP、
 * コードは JetBrains Mono → Noto Sans JP）。
 * - Inter：本文の文字のうち、Inter の範囲にあるもの。英数字と記号（U+20〜U+7E）はいつも含める
 * - JetBrains Mono：コードの文字のうち、範囲にあるもの（コードがなければ含めない）
 * - Noto Sans JP：上の2つで描けない文字
 *
 * - Noto Serif JP：明朝体を使うテーマ（academic。#93）のときだけ。見出しのほか引用などにも使うので、
 *   本文の文字をすべて入れる
 *
 * Noto Sans JP の分割ファイルは範囲が重なっているので、1つの文字は1つのファイルにだけ入れる。
 */
export async function subsetFontCss(
  text: string,
  code = '',
  options: { serif?: boolean } = {},
): Promise<{ css: string; bytes: number }> {
  const ascii = Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i);
  const points = (s: string) => Array.from(s, (c) => c.codePointAt(0)!).filter((cp) => cp >= 0x20);
  const faces = fontFiles();
  const of = (family: string) => faces.filter((face) => face.family === family);
  const inFamily = (family: string, cp: number) => of(family).some((face) => covers(face, cp));
  const sans = new Set([...points(text), ...ascii]);
  const mono = new Set(code ? [...points(code), ...ascii] : []);
  const want = new Map<string, Set<number>>([
    [SANS, new Set([...sans].filter((cp) => inFamily(SANS, cp)))],
    [MONO, new Set([...mono].filter((cp) => inFamily(MONO, cp)))],
    [
      CJK,
      new Set([
        ...[...sans].filter((cp) => !inFamily(SANS, cp)),
        ...[...mono].filter((cp) => !inFamily(MONO, cp)),
      ]),
    ],
  ]);
  if (options.serif) want.set(SERIF, new Set([...sans].filter((cp) => inFamily(SERIF, cp))));
  const rules: string[] = [];
  let bytes = 0;
  for (const face of faces) {
    const wanted = want.get(face.family);
    if (!wanted) continue;
    const used = [...wanted].filter((cp) => covers(face, cp)).sort((a, b) => a - b);
    for (const cp of used) wanted.delete(cp); // 次のファイルには入れない
    if (used.length === 0) continue;
    const subset = await subsetFont(readFileSync(face.file), String.fromCodePoint(...used), {
      targetFormat: 'woff2',
    });
    bytes += subset.length;
    // unicode-range は、実際に入れた文字だけにする（入っていない文字は次の書体で描く）
    const range = used.map((cp) => `U+${cp.toString(16)}`).join(',');
    rules.push(
      fontFace(face, `data:font/woff2;base64,${Buffer.from(subset).toString('base64')}`, range),
    );
  }
  return { css: rules.join('\n'), bytes };
}

/** HTML の中のコード（`<code>`。`<pre>` の中も含む）の文字 */
export function codeText(html: string): string {
  return Array.from(html.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi), (m) =>
    visibleText(m[1]!),
  ).join('');
}

export { visibleText };
