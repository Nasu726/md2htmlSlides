import type { CodeHighlighter } from '@mds/core';
import {
  mathEngine,
  needsHighlighter,
  parseKatexCss,
  usedFaceKeys,
  type KatexCss,
  type MathEngine,
} from '@mds/embeds';
import type { WebFontFace } from './fonts.js';

/**
 * コードの色分け・数式・図（#84）を、使うときだけ読み込む（設計プラン §11.2）。
 * 描き方は CLI と同じ（@mds/embeds と runtime の renderMermaid）なので、書き出しと同じ見た目になる。
 */

/** コードの色分け（Shiki）。色分けする言語がなければ読み込まない */
export async function loadHighlighter(text: string): Promise<CodeHighlighter | undefined> {
  if (!needsHighlighter(text)) return undefined;
  const { codeHighlighter, codeLanguages } = await import('@mds/embeds/highlight');
  return codeHighlighter(codeLanguages(text));
}

export interface MathKit {
  engine: MathEngine;
  css: KatexCss;
}

let math: Promise<MathKit> | undefined;

/** 数式（KaTeX と、その CSS）。数式があるときだけ読み込む */
export function loadMath(): Promise<MathKit> {
  math ??= Promise.all([
    mathEngine(),
    import('katex/dist/katex.min.css?raw').then((m) => parseKatexCss(m.default)),
  ]).then(([engine, css]) => ({ engine, css }));
  return math;
}

/** 描いた数式で使う KaTeX の書体（ファイルごと渡す。どの文字を使うかは数式で決まるので、範囲は絞らない） */
export function katexFaces({ engine, css }: MathKit): WebFontFace[] {
  const keys = usedFaceKeys(css, engine.used().classes);
  return css.faces
    .filter((face) => keys.has(`${face.family}|${face.weight}|${face.style}`))
    .map((face) => ({
      family: face.family,
      weight: face.weight,
      style: face.style,
      range: 'U+0-10FFFF',
      url: `fonts/katex/${face.name}`,
    }));
}

let mermaid: Promise<string> | undefined;

/** Mermaid の本体（計測用の iframe に入れて、図を描く）。図があるときだけ読み込む */
export function loadMermaidScript(): Promise<string> {
  mermaid ??= import('mermaid/dist/mermaid.min.js?url')
    .then((m) => fetch(m.default))
    .then((response) => {
      if (!response.ok) throw new Error(`mermaid: ${response.status}`);
      return response.text();
    });
  mermaid.catch(() => (mermaid = undefined));
  return mermaid;
}
