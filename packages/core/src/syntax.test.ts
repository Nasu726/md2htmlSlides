import { describe, expect, it } from 'vitest';
import type { Block } from './ir.js';
import { parseDeck } from './parse.js';

/** 先頭の節（root の最初の子）のブロック */
const blocksOf = (markdown: string): Block[] => parseDeck(markdown).root.children[0]!.blocks;
const codes = (markdown: string) => parseDeck(markdown).diagnostics.map((d) => [d.code, d.line]);

describe('属性 {…}', () => {
  it('見出しの末尾の属性は、その節に付く', () => {
    const section = parseDeck('## 結果 {layout=statement .big}\n\n本文').root.children[0]!;
    expect(section.heading?.text).toBe('結果');
    expect(section.attrs).toEqual({ values: { layout: 'statement' }, classes: ['big'] });
  });

  it('段落の末尾（前に空白）の属性は、その段落に付き、文字からは除く', () => {
    const [p] = blocksOf('## A\n\n答えは2です。 {step=2}');
    expect(p).toMatchObject({ kind: 'paragraph', attrs: { values: { step: '2' } } });
  });

  it('画像の直後（空白なし）の属性は、その画像に付く', () => {
    const [p] = blocksOf('## A\n\n![](a.jpg){bg=left dim=0.4} ![b](b.png "説明"){step}');
    expect(p!.media).toEqual([
      {
        kind: 'image',
        src: 'a.jpg',
        alt: '',
        line: 3,
        attrs: { values: { bg: 'left', dim: '0.4' }, classes: [] },
      },
      {
        kind: 'image',
        src: 'b.png',
        alt: 'b',
        line: 3,
        title: '説明',
        attrs: { values: { step: true }, classes: [] },
      },
    ]);
  });

  it('{…} だけの行は、スライドに付ける属性', () => {
    const [b] = blocksOf('## A\n\n{layout=media}\n\n![](x.png)');
    expect(b).toMatchObject({ kind: 'slide-attrs', attrs: { values: { layout: 'media' } } });
  });

  it('フェンスコードの情報文字列の属性', () => {
    const [code] = blocksOf('## A\n\n```ts {lines="1|2-3"}\nconst a = 1;\n```');
    expect(code).toMatchObject({ kind: 'code', lang: 'ts', attrs: { values: { lines: '1|2-3' } } });
  });

  it('書き間違いは文字のまま残して警告し、普通の文字列とエスケープは警告しない', () => {
    expect(codes('## A {lyout=split}\n\nこんにちは、{name} さん。 {name}\n\n\\{step}')).toEqual([
      ['attrs/unknown-key', 1],
    ]);
    expect(parseDeck('## A {lyout=split}').root.children[0]!.heading?.text).toBe('A {lyout=split}');
  });

  it('値が正しくない属性は除いて警告する', () => {
    expect(codes('## A {layout=columnz}')).toEqual([['attrs/invalid-value', 1]]);
    expect(parseDeck('## A {layout=columnz keep}').root.children[0]!.attrs?.values).toEqual({
      keep: true,
    });
  });
});

describe('コンテナ :::', () => {
  it('中の見出しは節にせず、heading ブロックにする', () => {
    const deck = parseDeck(':::row {ratio=2:1}\n### 左\n本文\n\n### 右\n本文\n:::\n');
    expect(deck.root.children).toEqual([]);
    const [row] = deck.root.blocks;
    expect(row).toMatchObject({
      kind: 'container',
      name: 'row',
      attrs: { values: { ratio: '2:1' } },
    });
    expect(row!.children!.map((b) => [b.kind, b.text ?? ''])).toEqual([
      ['heading', '左'],
      ['paragraph', ''],
      ['heading', '右'],
      ['paragraph', ''],
    ]);
  });

  it('入れ子は外側のコロンを増やす', () => {
    const [row] = parseDeck('::::row\n:::stack\nA\n:::\n:::stack\nB\n:::\n::::').root.blocks;
    expect(row!.children!.map((b) => b.name)).toEqual(['stack', 'stack']);
  });

  it('閉じていないコンテナは、次の節の見出しの直前で閉じて警告する', () => {
    const deck = parseDeck('## A\n\n:::row\n中身\n\n## B\n\n本文');
    expect(deck.root.children.map((s) => s.heading?.text)).toEqual(['A', 'B']);
    expect(deck.diagnostics.map((d) => [d.code, d.line])).toEqual([['container/unclosed', 3]]);
  });

  it('コードブロックの中の ::: では閉じない', () => {
    const [keep] = parseDeck(':::keep\n```\n:::\n```\n:::').root.blocks;
    expect(keep!.children!.map((b) => b.kind)).toEqual(['code']);
  });

  it('未知のコンテナは警告し、中身は普通に読む', () => {
    const deck = parseDeck(':::rwo\n本文\n:::');
    expect(deck.diagnostics).toEqual([
      expect.objectContaining({ code: 'container/unknown', suggestion: 'row' }),
    ]);
    expect(deck.root.blocks[0]!.children!.map((b) => b.kind)).toEqual(['paragraph']);
  });
});

describe('. . . と ::maketitle', () => {
  it('. . . だけの段落は pause', () => {
    expect(blocksOf('## A\n\n問題\n\n. . .\n\n答え').map((b) => b.kind)).toEqual([
      'paragraph',
      'pause',
      'paragraph',
    ]);
  });

  it('::maketitle は指示、コンテナ形式は maketitle コンテナ', () => {
    const deck = parseDeck('::maketitle{variant=left}\n\n:::maketitle\n![](c.jpg){bg=right}\n:::');
    expect(deck.root.blocks.map((b) => [b.kind, b.name, b.attrs?.values])).toEqual([
      ['directive', 'maketitle', { variant: 'left' }],
      ['container', 'maketitle', undefined],
    ]);
  });

  it('未定義の指示は段落のまま残して警告する', () => {
    const deck = parseDeck('::toc\n\n::maketitel');
    expect(deck.root.blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(deck.diagnostics.map((d) => [d.code, d.suggestion])).toEqual([
      ['directive/unknown', undefined],
      ['directive/unknown', 'maketitle'],
    ]);
  });
});
