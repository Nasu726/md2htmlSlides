import { parseDeck } from '@mdhs/core';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  linkedMathFontCss,
  mathDiagnostics,
  mathEngine,
  mathFontFileFor,
  mathLayoutCss,
  subsetMathFontCss,
} from './math.js';

describe('数式（#72）', () => {
  it('KaTeX で HTML にする。同じ数式は1回だけ描く', async () => {
    const engine = await mathEngine();
    const result = engine.render('x^2', false);
    expect(result).toEqual({ html: expect.stringContaining('<span class="katex">') });
    expect(engine.render('x^2', false)).toBe(result);
    expect(engine.render('x^2', true)).toEqual({
      html: expect.stringContaining('<span class="katex-display">'),
    });
  });

  it('構文エラーは、メッセージと TeX の中の位置を返し、ファイルの行で警告する', async () => {
    const engine = await mathEngine();
    const deck = parseDeck('## A\n\n文中 $\\frac{1}{2$\n\n$$\na = 1 \\\\\nb = \\foo\n$$\n');
    const diagnostics = mathDiagnostics(deck, engine.render);
    expect(diagnostics.map((d) => [d.line, d.code])).toEqual([
      [3, 'math/katex-error'],
      [7, 'math/katex-error'],
    ]);
    expect(diagnostics[1]!.message).toContain('\\foo');
  });

  it('組版の CSS には @font-face を含めず、フォントは別に読み込む', () => {
    expect(mathLayoutCss()).toContain('.katex{');
    expect(mathLayoutCss()).not.toContain('@font-face');
    const css = linkedMathFontCss('/__mds/fonts');
    expect(css).toContain('font-family:KaTeX_Main;font-style:normal;font-weight:400');
    expect(css).toContain('url(/__mds/fonts/katex/KaTeX_Main-Regular.woff2)');
    const file = mathFontFileFor('katex/KaTeX_Main-Regular.woff2');
    expect(file && existsSync(file)).toBe(true);
    expect(mathFontFileFor('katex/../../package.json')).toBeUndefined();
    expect(mathFontFileFor('katex/KaTeX_Nope.woff2')).toBeUndefined();
  });

  it('書き出しでは、使った書体だけを、使った文字だけに絞って埋め込む', async () => {
    const plain = await mathEngine();
    plain.render('x + 1', false);
    const few = await subsetMathFontCss(plain.used());
    const families = (css: string) =>
      Array.from(css.matchAll(/font-family:(KaTeX_\w+);font-style:(\w+);font-weight:(\d+)/g), (m) =>
        m.slice(1).join(' '),
      ).sort();
    expect(families(few.css)).toEqual(['KaTeX_Main normal 400', 'KaTeX_Math italic 400']);

    const rich = await mathEngine();
    rich.render('\\mathbb{R} \\to \\mathbf{v}', false);
    rich.render('\\sum_{k=1}^n k', true);
    const more = await subsetMathFontCss(rich.used());
    expect(families(more.css)).toEqual(
      expect.arrayContaining([
        'KaTeX_AMS normal 400',
        'KaTeX_Main normal 700',
        'KaTeX_Size2 normal 400',
      ]),
    );
    expect(more.css).not.toContain('KaTeX_Fraktur');
    expect(more.bytes).toBeGreaterThan(few.bytes);
  });
});
