import { describe, expect, it } from 'vitest';
import { parseDeck } from './parse.js';

const doc = [
  '---', //  1
  'title: テスト', //  2
  '---', //  3
  '', //  4
  '前置きの段落', //  5
  '', //  6
  '# 章', //  7
  '', //  8
  '## 節A', //  9
  '', // 10
  '- 項目1', // 11
  '- 項目2', // 12
  '', // 13
  '```ts', // 14
  'const a = 1;', // 15
  '```', // 16
  '', // 17
  '### 小見出し', // 18
  '', // 19
  '<!-- コメント -->', // 20
  '', // 21
  '***', // 22
  '', // 23
  '## 節A', // 24
  '', // 25
  '| a |', // 26
  '|---|', // 27
  '| 1 |', // 28
].join('\n');

describe('parseDeck', () => {
  const deck = parseDeck(doc);

  it('見出しのレベルから節のツリーを作る', () => {
    const [chapter] = deck.root.children;
    expect(chapter?.heading?.text).toBe('章');
    expect(chapter?.children.map((s) => s.heading?.text)).toEqual(['節A', '節A']);
    expect(chapter?.children[0]?.children.map((s) => s.heading?.text)).toEqual(['小見出し']);
  });

  it('最初の見出しより前の本文は root に入る', () => {
    expect(deck.root.blocks.map((b) => [b.kind, b.src.start])).toEqual([['paragraph', 5]]);
  });

  it('ブロックの種類と、元のファイルでの行の範囲', () => {
    const sectionA = deck.root.children[0]!.children[0]!;
    expect(sectionA.blocks.map((b) => [b.kind, b.src.start, b.src.end])).toEqual([
      ['list', 11, 12],
      ['code', 14, 16],
    ]);
    expect(sectionA.blocks[1]!.lang).toBe('ts');
    const sub = sectionA.children[0]!;
    expect(sub.blocks.map((b) => [b.kind, b.marker])).toEqual([
      ['comment', undefined],
      ['rule', '***'],
    ]);
    expect(deck.root.children[0]!.children[1]!.blocks[0]).toMatchObject({
      kind: 'table',
      src: { start: 26, end: 28 },
    });
  });

  it('節の範囲は見出しから最後の内容まで', () => {
    const sectionA = deck.root.children[0]!.children[0]!;
    expect(sectionA.src).toEqual({ start: 9, end: 22 });
  });

  it('同じ見出しの ID は連番で区別する', () => {
    expect(deck.root.children[0]!.children.map((s) => s.id)).toEqual(['節a', '節a-1']);
  });

  it('ハッシュは同じ内容なら同じ、違えば違う', () => {
    expect(parseDeck(doc).root.hash).toBe(deck.root.hash);
    const edited = parseDeck(doc.replace('項目2', '項目二'));
    const [a, b] = [deck, edited].map((d) => d.root.children[0]!.children);
    expect(edited.root.hash).not.toBe(deck.root.hash);
    expect(b![0]!.hash).not.toBe(a![0]!.hash);
    // 編集していない節のハッシュは変わらない
    expect(b![1]!.hash).toBe(a![1]!.hash);
  });

  it('CRLF の改行でも同じ結果になる', () => {
    expect(parseDeck(doc.replace(/\n/g, '\r\n')).root.hash).toBe(deck.root.hash);
  });

  it('空行のない --- で見出しになった場合は警告する', () => {
    const result = parseDeck('本文\n---\n');
    expect(result.root.children[0]?.heading).toMatchObject({ text: '本文', setext: true });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'heading/setext-dash', line: 2 }),
    ]);
  });
});
