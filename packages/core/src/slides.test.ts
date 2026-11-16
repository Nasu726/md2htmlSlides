import { describe, expect, it } from 'vitest';
import { parseDeck } from './parse.js';
import { buildSlides } from './slides.js';

const slidesOf = (markdown: string) => buildSlides(parseDeck(markdown));
const summary = (markdown: string) =>
  slidesOf(markdown).slides.map(
    (s) =>
      `${s.kind}:${s.heading ? s.heading.text + (s.heading.continued ? '+' : '') : '-'}:${s.blocks.length}`,
  );

describe('buildSlides', () => {
  it('slideLevel の見出しごとに1枚。深い見出しはスライドの中の小見出し', () => {
    const deck = slidesOf('# 題\n\n導入\n\n## A\n\n本文\n\n### 小\n\n本文\n\n## B\n\n本文');
    expect(deck.slideLevel).toBe(2);
    expect(summary('# 題\n\n導入\n\n## A\n\n本文\n\n### 小\n\n本文\n\n## B\n\n本文')).toEqual([
      'section:題:1',
      'content:A:3',
      'content:B:1',
    ]);
    expect(deck.slides[1]!.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
    ]);
  });

  it('slideLevel より浅い見出しは章扉。導入文を一緒に置き、子のスライドに章の名前を付ける', () => {
    const deck = slidesOf('# 章1\n\n導入\n\n## A\n\n本文\n\n## B\n\n本文\n\n# 章2\n\n## C\n\n本文');
    expect(deck.slides.map((s) => [s.kind, s.heading?.text, s.chapter])).toEqual([
      ['section', '章1', undefined],
      ['content', 'A', '章1'],
      ['content', 'B', '章1'],
      ['section', '章2', undefined],
      ['content', 'C', '章2'],
    ]);
  });

  it('--- で区切った2枚目は、節の見出しを引き継ぐ', () => {
    expect(summary('## A\n\n前半\n\n---\n\n後半')).toEqual(['content:A:1', 'content:A+:1']);
  });

  it('空のスライドは作らない（--- の直後の見出し、連続した ---）', () => {
    expect(summary('## A\n\n本文\n\n---\n\n## B\n\n本文')).toEqual(['content:A:1', 'content:B:1']);
    expect(summary('## A\n\n本文\n\n---\n\n---\n\n2枚目')).toEqual(['content:A:1', 'content:A+:1']);
  });

  it('*** と ___ は区切らない', () => {
    expect(summary('## A\n\n上\n\n***\n\n下')).toEqual(['content:A:3']);
  });

  it('::maketitle は1枚を単独で占める', () => {
    expect(summary('前置き\n\n::maketitle\n\n## A\n\n本文\n\n::maketitle')).toEqual([
      'content:-:1',
      'title:-:0',
      'content:A:1',
      'title:-:0',
    ]);
  });

  it(':::keep の中が slideLevel の見出しで始まるなら、その見出しの1枚にする', () => {
    const deck = slidesOf(
      '## A\n\n本文\n\n:::keep\n## 前半\n\n内容\n\n## 後半\n\n内容\n:::\n\n## B\n\n本文',
    );
    expect(deck.slides.map((s) => s.heading?.text)).toEqual(['A', '前半', 'B']);
    expect(deck.slides[1]!.blocks[0]!.children!.map((b) => b.kind)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
    ]);
  });

  it('{…} だけの行の属性はスライドに付き、:::notes はノートになる', () => {
    const deck = slidesOf(
      '## A {hidden}\n\n本文\n\n---\n\n{layout=media}\n\n![](a.png)\n\n:::notes\nメモ\n:::',
    );
    const [first, second] = deck.slides;
    expect(first!.hidden).toBe(true);
    expect(second!.attrs?.values).toEqual({ hidden: true, layout: 'media' });
    expect(second!.blocks.map((b) => b.kind)).toEqual(['paragraph']);
    expect(second!.notes.map((b) => b.kind)).toEqual(['paragraph']);
  });

  it('コメントだけの前置きはスライドにしない', () => {
    expect(summary('<!-- メモ -->\n\n## A\n\n本文')).toEqual(['content:A:1']);
  });

  it('フロントマターの slideLevel を使う', () => {
    expect(slidesOf('---\nslideLevel: 3\n---\n## A\n\n### B\n\n本文').slideLevel).toBe(3);
  });
});
