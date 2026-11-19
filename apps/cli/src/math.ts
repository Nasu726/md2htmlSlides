/**
 * 数式（#72、設計プラン §7.4）の CSS とフォント（CLI）。描くのは @mdhs/embeds の mathEngine。
 *
 * - KaTeX の CSS とフォントは、数式があるときだけ入れる
 *   - `mdhs dev` と計測：フォント一式を `/__mds/fonts/katex/…` から読み込む
 *   - `mdhs build`：数式で使った書体だけを、使った文字だけに絞って HTML に埋め込む
 */
import {
  parseKatexCss,
  usedFaceKeys,
  type KatexCss,
  type KatexFace,
  type MathUsage,
} from '@mdhs/embeds';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import subsetFont from 'subset-font';

export { mathDiagnostics, mathEngine, type MathEngine, type MathUsage } from '@mdhs/embeds';

const require = createRequire(import.meta.url);

let cssCache: KatexCss | undefined;

/** KaTeX の CSS を、@font-face とそれ以外（組版の規則）に分ける */
function katexCss(): KatexCss {
  cssCache ??= parseKatexCss(readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8'));
  return cssCache;
}

const faceRule = (face: KatexFace, src: string, range?: string) =>
  `@font-face{font-family:${face.family};font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(${src}) format('woff2')${range ? `;unicode-range:${range}` : ''}}`;

/** 数式の組版の CSS（@font-face を除いた KaTeX の CSS） */
export function mathLayoutCss(): string {
  return katexCss().layout;
}

/** KaTeX のフォント一式の @font-face。prefix はファイルを配る場所（`/__mds/fonts` など） */
export function linkedMathFontCss(prefix: string): string {
  return katexCss()
    .faces.map((face) => faceRule(face, `${prefix}/katex/${face.name}`))
    .join('\n');
}

/** URL のパス（`katex/KaTeX_Main-Regular.woff2`）から、フォントのファイルの絶対パスを返す */
export function mathFontFileFor(path: string): string | undefined {
  const m = /^katex\/(KaTeX_[\w-]+\.woff2)$/.exec(path);
  if (!m || !katexCss().faces.some((face) => face.name === m[1])) return undefined;
  return join(dirname(require.resolve('katex/dist/katex.min.css')), 'fonts', m[1]!);
}

let metricsCache: Record<string, Record<string, unknown>> | undefined;

/**
 * 数式で使った文字だけに絞った KaTeX のフォント（data: URL で埋め込む）。
 * - 書体：数式で使ったクラスから決める（使わない書体は入れない）
 * - 文字：KaTeX の文字の寸法表で書体ごとに持っている文字を調べ、使った文字のうち持っているものだけを入れる
 */
export async function subsetMathFontCss(used: MathUsage): Promise<{ css: string; bytes: number }> {
  const { text } = used;
  const keys = usedFaceKeys(katexCss(), used.classes);
  metricsCache ??= (
    (await import('katex/src/fontMetricsData.js')) as {
      default: Record<string, Record<string, unknown>>;
    }
  ).default;
  const points = [...new Set(Array.from(text, (c) => c.codePointAt(0)!))].sort((a, b) => a - b);
  const rules: string[] = [];
  let bytes = 0;
  for (const face of katexCss().faces) {
    if (!keys.has(`${face.family}|${face.weight}|${face.style}`)) continue;
    const metrics = metricsCache[face.metrics];
    const used = points.filter((cp) => metrics?.[String(cp)] !== undefined);
    if (used.length === 0) continue;
    const file = mathFontFileFor(`katex/${face.name}`)!;
    const subset = await subsetFont(readFileSync(file), String.fromCodePoint(...used), {
      targetFormat: 'woff2',
    });
    bytes += subset.length;
    const range = used.map((cp) => `U+${cp.toString(16)}`).join(',');
    rules.push(
      faceRule(face, `data:font/woff2;base64,${Buffer.from(subset).toString('base64')}`, range),
    );
  }
  return { css: rules.join('\n'), bytes };
}
