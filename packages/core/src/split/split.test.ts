import { describe, expect, it } from 'vitest';
import { parseDeck } from '../parse.js';
import { buildSlides } from '../slides.js';
import {
  DEFAULT_WEIGHTS,
  applySplit,
  atomize,
  breakPenalty,
  planSplit,
  splitAtoms,
  type Measurement,
} from './split.js';

const slidesOf = (markdown: string) => buildSlides(parseDeck(markdown));
const blocksOf = (markdown: string) => slidesOf(markdown).slides[0]!.blocks;

/** すべての原子を同じ高さとみなした計測結果。 */
function uniform(count: number, height: number, avail = 480): Measurement {
  return {
    avail,
    gap: 20,
    listGap: 7,
    heights: Array<number>(count).fill(height),
    heads: Array<number>(count).fill(0),
  };
}

describe('atomize', () => {
  it('リストは項目ごと、表は行ごと、ほかはブロックごとに分ける', () => {
    const atoms = atomize(
      blocksOf(
        '## A\n\n導入\n\n- 1\n- 2\n  - 2a\n- 3\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n',
      ),
    );
    expect(atoms.map((a) => a.kind)).toEqual([
      'paragraph',
      'list-item',
      'list-item',
      'list-item',
      'table-row',
      'table-row',
    ]);
    // 入れ子の項目は親の項目に含める
    expect(atoms[2]!.block.raw).toBe('- 2\n  - 2a');
    expect(atoms[5]!.block.raw).toBe('| a | b |\n|---|---|\n| 3 | 4 |');
    expect(atoms[5]!.group).toMatchObject({ index: 1, count: 2, head: '| a | b |\n|---|---|' });
  });

  it('小見出しの下の原子は、その小見出しを覚えている', () => {
    const atoms = atomize(blocksOf('## A\n\n前\n\n### 小\n\n後\n\n## B\n\n本文\n'));
    expect(atoms.map((a) => [a.kind, a.subheading])).toEqual([
      ['paragraph', undefined],
      ['heading', undefined],
      ['paragraph', 1],
    ]);
  });
});

describe('breakPenalty', () => {
  const w = DEFAULT_WEIGHTS;
  const atoms = atomize(
    blocksOf(
      '## A\n\n次の点です：\n\n- 1\n- 2\n- 3\n- 4\n\n### 小見出し\n\n本文\n\nもう一つ\n\n## B\n\n本文\n',
    ),
  );
  // 0:「：」の段落 1-4:リスト 5:小見出し 6,7:段落
  it('「：」で終わる段落の直後と、小見出しの直後では区切らない', () => {
    expect(breakPenalty(atoms, 1, w)).toBe(Infinity);
    expect(breakPenalty(atoms, 6, w)).toBe(Infinity);
  });
  it('小見出しの直前は 0、ブロックの間は 10', () => {
    expect(breakPenalty(atoms, 5, w)).toBe(0);
    expect(breakPenalty(atoms, 7, w)).toBe(10);
  });
  it('リストの項目の間は 30、片方に1項目だけ残るなら +50', () => {
    expect(breakPenalty(atoms, 3, w)).toBe(30);
    expect(breakPenalty(atoms, 2, w)).toBe(80);
    expect(breakPenalty(atoms, 4, w)).toBe(80);
  });
});

describe('splitAtoms', () => {
  const paragraphs = (n: number) =>
    atomize(blocksOf(`## A\n\n${Array.from({ length: n }, (_, i) => `段落${i}`).join('\n\n')}\n`));

  it('収まるなら1枚のまま', () => {
    expect(splitAtoms(paragraphs(3), uniform(3, 100))).toEqual([
      { start: 0, end: 3, scale: 1, fill: 340 / 480, overflow: false },
    ]);
  });

  it('収まらなければ分け、どのページも本文の高さに収め、数行だけのページを作らない', () => {
    const pages = splitAtoms(paragraphs(10), uniform(10, 100));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((p) => p.overflow)).not.toContain(true);
    expect(pages[0]!.start).toBe(0);
    expect(pages.at(-1)!.end).toBe(10);
    for (const p of pages) expect(p.fill).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.lastMin);
  });

  it('小見出しの直前で区切り、小見出しの直後では区切らない', () => {
    const atoms = atomize(blocksOf('## A\n\n前1\n\n前2\n\n### 小\n\n後1\n\n後2\n\n## B\n\n本文\n'));
    const pages = splitAtoms(atoms, uniform(5, 150));
    expect(pages.map((p) => [p.start, p.end])).toEqual([
      [0, 2],
      [2, 5],
    ]);
  });

  it('1つの原子が収まらなければ縮め、60% でも収まらなければあふれとする', () => {
    const one = paragraphs(1);
    expect(splitAtoms(one, uniform(1, 600))[0]).toMatchObject({ scale: 0.8, overflow: false });
    expect(splitAtoms(one, uniform(1, 2000))[0]).toMatchObject({ scale: 0.6, overflow: true });
  });
});

describe('planSplit・applySplit', () => {
  const md = [
    '## 節',
    '',
    '導入',
    '',
    '### 手順',
    '',
    '1. 一',
    '2. 二',
    '3. 三',
    '4. 四',
    '5. 五',
    '6. 六',
    '',
    ':::notes',
    'ノート',
    ':::',
    '',
    '## 表',
    '',
    '| a | b |',
    '|---|---|',
    ...Array.from({ length: 6 }, (_, i) => `| ${i} | x |`),
    '',
  ].join('\n');

  it('続きのスライドは見出しを引き継ぎ、小見出しを（続き）付きで再掲し、番号は元のまま', () => {
    const deck = slidesOf(md);
    const plan = planSplit(deck);
    expect(plan.jobs).toHaveLength(2);
    const m1 = uniform(plan.targets[0]!.atoms.length, 100);
    const m2 = uniform(plan.targets[1]!.atoms.length, 40);
    const result = applySplit(deck, plan, [m1, m2]);
    const pages = result.slides.filter((s) => s.heading?.text === '節');
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((s) => s.id)).toEqual(['節', ...pages.slice(1).map((_, k) => `節~p${k + 2}`)]);
    expect(pages[1]!.heading!.continued).toBe(true);
    expect(pages[0]!.notes).toHaveLength(1);
    expect(pages[1]!.notes).toEqual([]);
    expect(pages[0]!.page).toEqual({ index: 1, total: pages.length });
    const [resub, list] = pages[1]!.blocks;
    expect(resub!.raw).toBe('### 手順（続き）');
    expect(list!.kind).toBe('list');
    expect(list!.raw).toMatch(/^[2-6]\. /);
  });

  it('表を分けたら、続きのスライドにも見出し行を出す', () => {
    const deck = slidesOf(md);
    const plan = planSplit(deck);
    const m1 = uniform(plan.targets[0]!.atoms.length, 40);
    const m2 = uniform(plan.targets[1]!.atoms.length, 140);
    m2.heads = m2.heads.map(() => 40);
    const tables = applySplit(deck, plan, [m1, m2]).slides.filter((s) => s.heading?.text === '表');
    expect(tables).toHaveLength(2);
    for (const s of tables)
      expect(s.blocks[0]!.raw.startsWith('| a | b |\n|---|---|\n')).toBe(true);
  });

  it('split: manual なら分けない', () => {
    expect(planSplit(slidesOf(`---\nsplit: manual\n---\n\n${md}`)).jobs).toEqual([]);
  });
});
