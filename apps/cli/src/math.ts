/**
 * 数式（#72、設計プラン §7.4）。KaTeX で、書き出しのときに HTML にする。
 *
 * - 発表用の runtime には KaTeX の JS を含めない（書き出した HTML には、描いた結果だけが入る）
 * - KaTeX の CSS とフォントは、数式があるときだけ入れる
 *   - `mds dev` と計測：フォント一式を `/__mds/fonts/katex/…` から読み込む
 *   - `mds build`：数式で使った文字だけに絞り、HTML に埋め込む
 */
import type { Deck, Diagnostic, MathRenderer, MathResult } from '@mds/core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import subsetFont from 'subset-font';
import { visibleText } from './fonts.js';

const require = createRequire(import.meta.url);

type Katex = typeof import('katex').default;

export interface MathEngine {
  render: MathRenderer;
  /** 描いた数式で使った文字と、KaTeX のクラス（フォントを絞るのに使う） */
  used(): MathUsage;
}

export interface MathUsage {
  text: string;
  classes: Set<string>;
}

/**
 * KaTeX で数式を描く関数。KaTeX は、数式があるときだけ読み込む。
 * 同じ数式は1回だけ描く（自動分割で何度も描くため）。
 */
export async function mathEngine(): Promise<MathEngine> {
  const katex: Katex = (await import('katex')).default;
  const cache = new Map<string, MathResult>();
  const chars = new Set<string>();
  const classes = new Set<string>();
  const render: MathRenderer = (tex, display) => {
    const key = `${display ? 'D' : 'I'}\n${tex}`;
    let result = cache.get(key);
    if (!result) {
      result = renderTex(katex, tex, display);
      cache.set(key, result);
      if ('html' in result) {
        const drawn = drawnHtml(result.html);
        for (const c of visibleText(drawn)) chars.add(c);
        for (const m of drawn.matchAll(/class="([^"]*)"/g)) {
          for (const name of m[1]!.split(/\s+/)) if (name) classes.add(name);
        }
      }
    }
    return result;
  };
  return { render, used: () => ({ text: [...chars].join(''), classes }) };
}

function renderTex(katex: Katex, tex: string, display: boolean): MathResult {
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      // 読み上げ用に MathML も入れる（画面には KaTeX の HTML を出す）
      output: 'htmlAndMathml',
      // 数式の中の日本語などを警告しない（そのまま描く）
      strict: 'ignore',
      trust: false,
    });
    return { html };
  } catch (error) {
    // KaTeX の ParseError は、メッセージ（rawMessage）と TeX の中の位置（position）を持つ
    const parse = error as { rawMessage?: string; position?: number; message?: string };
    return {
      error: parse.rawMessage ?? parse.message ?? String(error),
      ...(typeof parse.position === 'number' ? { position: parse.position } : {}),
    };
  }
}

/** KaTeX の HTML のうち、画面に描く部分（読み上げ用の MathML は除く） */
function drawnHtml(html: string): string {
  return html.replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, '');
}

/** 数式のエラーの警告。KaTeX が示す位置から、ファイルの中の行にする */
export function mathDiagnostics(deck: Deck, render: MathRenderer): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const ref of deck.math ?? []) {
    const result = render(ref.tex, ref.display);
    if (!result || !('error' in result)) continue;
    const before = ref.tex.slice(0, result.position ?? 0);
    const line = ref.line + before.split('\n').length - 1;
    out.push({
      severity: 'warning',
      code: 'math/katex-error',
      message: `数式を描けません：${result.error}`,
      line,
    });
  }
  return out;
}

interface KatexFace {
  family: string;
  weight: string;
  style: string;
  /** フォントのファイル名（`KaTeX_Main-Regular.woff2`） */
  name: string;
  /** KaTeX の文字の寸法表での名前（`Main-Regular`） */
  metrics: string;
}

/** KaTeX の CSS の、書体を決める規則（`.katex .mathbf{font-family:KaTeX_Main;font-weight:700}` など） */
interface FaceRule {
  /** 選択子ごとの、クラスの組（`.katex` を除く）。どれかの組のクラスがすべて使われていれば当てはまる */
  selectors: string[][];
  family?: string;
  weight?: string;
  style?: string;
}

interface KatexCss {
  layout: string;
  faces: KatexFace[];
  rules: FaceRule[];
}

let cssCache: KatexCss | undefined;

/** KaTeX の CSS を、@font-face とそれ以外（組版の規則）に分ける */
function katexCss(): KatexCss {
  if (cssCache) return cssCache;
  const css = readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8');
  const faces: KatexFace[] = [];
  for (const m of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const body = m[1]!;
    const name = /url\(fonts\/([^)]+\.woff2)\)/.exec(body)?.[1];
    if (!name) continue;
    faces.push({
      family: /font-family:([^;]+)/.exec(body)![1]!.trim(),
      weight: /font-weight:([^;]+)/.exec(body)?.[1]?.trim() ?? '400',
      style: /font-style:([^;]+)/.exec(body)?.[1]?.trim() ?? 'normal',
      name,
      metrics: name.replace(/^KaTeX_/, '').replace(/\.woff2$/, ''),
    });
  }
  const layout = css.replace(/@font-face\{[^}]*\}/g, '');
  const rules: FaceRule[] = [];
  for (const m of layout.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2]!;
    const family = /font-family:\s*(KaTeX_\w+)/.exec(body)?.[1];
    const weight = /font-weight:\s*(\w+)/.exec(body)?.[1];
    const style = /font-style:\s*(\w+)/.exec(body)?.[1];
    if (!family && !weight && !style) continue;
    const selectors = m[1]!
      .split(',')
      .map((selector) =>
        Array.from(selector.matchAll(/\.([\w-]+)/g), (c) => c[1]!).filter((c) => c !== 'katex'),
      );
    if (selectors.every((classes) => classes.length === 0)) continue;
    rules.push({
      selectors,
      ...(family ? { family } : {}),
      ...(weight ? { weight: weight === 'bold' ? '700' : weight } : {}),
      ...(style ? { style } : {}),
    });
  }
  cssCache = { layout, faces, rules };
  return cssCache;
}

/**
 * 描いた数式で使う書体（family・太さ・斜体の組）。KaTeX は書体をクラスで決めるので、
 * 使われているクラスに当てはまる規則から求める。KaTeX_Main の標準はいつも使う。
 * 入れ子（\textbf{\textit{…}}）の組み合わせまでは見ない（ないときは近い書体で描かれる）。
 */
function usedFaceKeys(classes: Set<string>): Set<string> {
  const keys = new Set(['KaTeX_Main|400|normal']);
  for (const rule of katexCss().rules) {
    const hit = rule.selectors.some(
      (group) => group.length > 0 && group.every((c) => classes.has(c)),
    );
    if (hit) {
      keys.add(`${rule.family ?? 'KaTeX_Main'}|${rule.weight ?? '400'}|${rule.style ?? 'normal'}`);
    }
  }
  return keys;
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
  const keys = usedFaceKeys(used.classes);
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
