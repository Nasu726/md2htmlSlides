import { describe, expect, it } from 'vitest';
import type { MathRenderer } from './md/math.js';
import { parseDeck } from './parse.js';
import { phraseBreaks } from './render/phrase.js';
import { renderDeckHtml } from './render/html.js';
import { buildSlides } from './slides.js';

/** 文中の数式として見つかった TeX */
const inline = (text: string) =>
  (parseDeck(`## A\n\n${text}\n`).math ?? []).filter((m) => !m.display).map((m) => m.tex);

describe('文中の数式 $…$ の規則（#72、構文仕様 §7.3）', () => {
  it.each([
    ['二次方程式 $ax^2 + bx + c = 0$ の解', ['ax^2 + bx + c = 0']],
    ['合計$x$円', ['x']],
    ['$a\\$b$ は1つの数式', ['a\\$b']],
    ['$5 と $x$', ['x']],
  ])('数式にする：%s', (text, expected) => {
    expect(inline(text)).toEqual(expected);
  });

  it.each([
    ['価格は $10 から $20 です'],
    ['US$100 と US$200'],
    ['$PATH と $HOME'],
    ['$ x$ は開く $ の直後が空白'],
    ['$x $ は閉じる $ の直前が空白'],
    ['\\$x$ はエスケープ'],
    ['コード `$x$` の中'],
    ['$x$5 は閉じる $ の直後が数字'],
  ])('数式にしない：%s', (text) => {
    expect(inline(text)).toEqual([]);
  });

  it('数式にしなかった $ は、そのまま文字として出す', () => {
    const html = render('## A\n\n価格は $10 から $20、\\$5 です\n', { math });
    expect(html).toContain('<p>価格は $10 から $20、$5 です</p>');
  });

  it('文中の $$…$$ は、独立した数式の大きさで描く', () => {
    const deck = parseDeck('## A\n\n式 $$\\sum_i x_i$$ を文中に\n');
    expect(deck.math).toEqual([{ tex: '\\sum_i x_i', display: true, line: 3 }]);
  });
});

describe('独立した数式 $$ と ```math', () => {
  const kinds = (markdown: string) =>
    parseDeck(markdown).root.children[0]!.blocks.map((b) => b.kind);

  it('$$ の行から $$ の行までを1つのブロックにする（1行でも書ける）', () => {
    const deck = parseDeck('## A\n\n文章\n$$\nx = 1 \\\\\ny = 2\n$$\n\n$$ a + b $$\n');
    expect(deck.root.children[0]!.blocks.map((b) => b.kind)).toEqual(['paragraph', 'math', 'math']);
    expect(deck.math).toEqual([
      { tex: 'x = 1 \\\\\ny = 2', display: true, line: 5 },
      { tex: ' a + b ', display: true, line: 9 },
    ]);
  });

  it('閉じる $$ がない・途中に空行があるときは、数式にしない', () => {
    expect(kinds('## A\n\n$$\nx = 1\n')).toEqual(['paragraph']);
    expect(kinds('## A\n\n$$\nx = 1\n\ny\n$$\n')).toEqual(['paragraph', 'paragraph']);
    // 1行の $$…$$ の後に文章が続くなら、文中の数式
    expect(kinds('## A\n\n$$x$$ が解\n')).toEqual(['paragraph']);
  });

  it('```math も独立した数式（TeX の1行目の行番号）', () => {
    const deck = parseDeck('## A\n\n```math\nE = mc^2\n```\n');
    expect(deck.root.children[0]!.blocks.map((b) => b.kind)).toEqual(['math']);
    expect(deck.math).toEqual([{ tex: 'E = mc^2', display: true, line: 4 }]);
  });

  it('行番号：段落の中の改行・リスト・表のセル・見出し', () => {
    const deck = parseDeck(
      '## 見出し $h$\n\n1行目\n2行目 $a$\n\n- 項目 $b$\n\n| x |\n|---|\n| $c$ |\n',
    );
    expect(deck.math?.map((m) => [m.tex, m.line])).toEqual([
      ['h', 1],
      ['a', 4],
      ['b', 6],
      ['c', 10],
    ]);
  });

  it('見出しの文字（目次・<title>）には TeX を残す', () => {
    expect(parseDeck('## 学習率 $\\alpha$\n\n本文\n').root.children[0]!.heading?.text).toBe(
      '学習率 \\alpha',
    );
  });
});

/** 描いたふりをする関数（TeX を印で囲む）。`\bad` を含むとエラー */
const math: MathRenderer = (tex, display) =>
  tex.includes('\\bad')
    ? { error: 'Undefined control sequence: \\bad', position: 0 }
    : { html: `<span class="katex">[${display ? 'D' : 'I'}:${tex}]</span>` };

const render = (markdown: string, options = {}) =>
  renderDeckHtml(buildSlides(parseDeck(markdown)), { fit: false, ...options });

describe('数式の描画', () => {
  it('描く関数の HTML を入れる。独立した数式は .mds-math-block で囲み、{step} を付ける', () => {
    const html = render('## A\n\n文中 $x$ と\n\n$$\ny\n$$ {step}\n\n```math {step}\nz\n```\n', {
      math,
    });
    expect(html).toContain('<p>文中 <span class="katex">[I:x]</span> と</p>');
    expect(html).toContain(
      '<div class="mds-math-block" data-step="1"><span class="katex">[D:y]</span></div>',
    );
    expect(html).toContain(
      '<div class="mds-math-block" data-step="2"><span class="katex">[D:z]</span></div>',
    );
  });

  it('見出し・表の中の数式も描く', () => {
    const html = render('## 学習率 $\\alpha$\n\n| 記号 |\n|---|\n| $\\nabla f$ |\n', { math });
    expect(html).toContain('学習率 <span class="katex">[I:\\alpha]</span>');
    expect(html).toContain('<td><span class="katex">[I:\\nabla f]</span></td>');
  });

  it('エラーはその場に赤字で示す（独立した数式ならメッセージも出す）', () => {
    const html = render('## A\n\n文中 $\\bad$ と\n\n$$\n\\bad\n$$\n', { math });
    expect(html).toContain(
      '<code class="mds-math-error" title="Undefined control sequence: \\bad">$\\bad$</code>',
    );
    expect(html).toContain(
      '<div class="mds-math-block mds-math-error" role="note"><b>数式のエラー</b><span>Undefined control sequence: \\bad</span><code>\\bad</code></div>',
    );
  });

  it('描く関数がなければ、TeX のまま出す', () => {
    const html = render('## A\n\n文中 $x$ と\n\n$$\ny\n$$\n');
    expect(html).toContain('<code class="mds-math-raw">$x$</code>');
    expect(html).toContain('<pre class="mds-math-raw"><code>y</code></pre>');
  });

  it('ライブラリの CSS は、基本の CSS より前に入れる', () => {
    const html = render('## A\n\n$x$\n', { math, libraryCss: '.katex{color:red}' });
    expect(html.indexOf('.katex{color:red}')).toBeLessThan(html.indexOf('@page'));
  });

  it('見出しの文節改行（<wbr>）は、数式の中には入れない', () => {
    const katex =
      '<span class="katex"><span class="katex-html"><span class="mord">最大値</span></span></span>';
    expect(phraseBreaks(`最大値を求める${katex}とする`, 'ja')).toBe(
      `最大値を<wbr>求める${katex}と<wbr>する`,
    );
  });
});
