/**
 * 数式（#72、設計プラン §7.4）。KaTeX で HTML にする。CLI（書き出し）と Web エディタ（プレビュー）で共有する（#84）。
 *
 * KaTeX 本体は、数式があるときだけ読み込む（mathEngine の中で import する）。
 * KaTeX の CSS とフォントのファイルの読み方は環境で違うので、ここでは CSS の文字を受け取って分けるだけにする。
 */
import type { Deck, Diagnostic, MathRenderer, MathResult } from '@mdhs/core';
import { visibleText } from './text.js';

type Katex = typeof import('katex').default;

export interface MathEngine {
  render: MathRenderer;
  /** 描いた数式で使った文字と、KaTeX のクラス（フォントを選ぶ・絞るのに使う） */
  used(): MathUsage;
}

export interface MathUsage {
  text: string;
  classes: Set<string>;
}

/**
 * KaTeX で数式を描く関数。同じ数式は1回だけ描く（自動分割で何度も描くため）。
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

export interface KatexFace {
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

export interface KatexCss {
  /** @font-face を除いた CSS（組版の規則） */
  layout: string;
  faces: KatexFace[];
  rules: FaceRule[];
}

/** KaTeX の CSS（katex.min.css の中身）を、@font-face とそれ以外（組版の規則）に分ける */
export function parseKatexCss(css: string): KatexCss {
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
  return { layout, faces, rules };
}

/**
 * 描いた数式で使う書体（`family|太さ|斜体` の組）。KaTeX は書体をクラスで決めるので、
 * 使われているクラスに当てはまる規則から求める。KaTeX_Main の標準はいつも使う。
 * 入れ子（\textbf{\textit{…}}）の組み合わせまでは見ない（ないときは近い書体で描かれる）。
 */
export function usedFaceKeys(css: KatexCss, classes: Set<string>): Set<string> {
  const keys = new Set(['KaTeX_Main|400|normal']);
  for (const rule of css.rules) {
    const hit = rule.selectors.some(
      (group) => group.length > 0 && group.every((c) => classes.has(c)),
    );
    if (hit) {
      keys.add(`${rule.family ?? 'KaTeX_Main'}|${rule.weight ?? '400'}|${rule.style ?? 'normal'}`);
    }
  }
  return keys;
}
