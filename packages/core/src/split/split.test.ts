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
  it('小見出しの直前は 0、ブロックの間は 10。小見出しと1ブロックだけを残すなら +50（#92）', () => {
    expect(breakPenalty(atoms, 5, w)).toBe(0);
    expect(breakPenalty(atoms, 7, w)).toBe(10 + w.orphan);
    const plain = atomize(blocksOf('## A\n\n一\n\n二\n\n三\n'));
    expect(breakPenalty(plain, 2, w)).toBe(10);
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
      {
        start: 0,
        end: 3,
        scale: 1,
        fill: 340 / (480 * (1 - DEFAULT_WEIGHTS.margin)),
        overflow: false,
      },
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
    expect(splitAtoms(one, uniform(1, 600))[0]).toMatchObject({ scale: 0.75, overflow: false });
    expect(splitAtoms(one, uniform(1, 2000))[0]).toMatchObject({ scale: 0.6, overflow: true });
  });

  it('本文の下に余白を残す：下端ぎりぎりまで埋まるなら、少し縮めるか分ける（#92）', () => {
    // 本文 480px に 470px：余白（6%）に食い込むので縮める
    expect(splitAtoms(paragraphs(1), uniform(1, 470))[0]).toMatchObject({
      scale: 0.95,
      overflow: false,
    });
    // 余白なしなら、そのまま収まる
    const flush = { ...DEFAULT_WEIGHTS, margin: 0 };
    expect(splitAtoms(paragraphs(1), uniform(1, 470), flush)[0]).toMatchObject({ scale: 1 });
    // 複数の原子でも、どのページも余白を残す
    for (const height of [90, 110, 150]) {
      for (const p of splitAtoms(paragraphs(8), uniform(8, height))) {
        const used = (p.end - p.start) * height * p.scale + (p.end - p.start - 1) * 20;
        expect(used).toBeLessThanOrEqual(480 * (1 - DEFAULT_WEIGHTS.margin) + 1);
      }
    }
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

  it('続きのスライドは見出しを引き継ぎ、小見出しを同じ文言で再掲し、番号は元のまま', () => {
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
    expect(resub!.raw.trim()).toBe('### 手順');
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

  it('分けたスライドの行の範囲は、そのスライドに入った項目・行の範囲（エディタの目印に使う。#74）', () => {
    const deck = slidesOf(md);
    const plan = planSplit(deck);
    const m1 = uniform(plan.targets[0]!.atoms.length, 100);
    const m2 = uniform(plan.targets[1]!.atoms.length, 140);
    m2.heads = m2.heads.map(() => 40);
    const result = applySplit(deck, plan, [m1, m2]);
    const pages = result.slides.filter((s) => s.heading?.text === '節');
    const lines = md.split('\n');
    // 最初のスライドは見出しから。続きのスライドは、そのスライドの最初の項目の行から
    expect(pages[0]!.src.start).toBe(1);
    const first = pages[1]!.blocks.find((b) => b.kind === 'list')!;
    expect(lines[pages[1]!.src.start - 1]).toBe(first.raw.split('\n')[0]);
    expect(pages.at(-1)!.src.end).toBe(deck.slides.find((s) => s.heading?.text === '節')!.src.end);
    const tables = result.slides.filter((s) => s.heading?.text === '表');
    // 表の続きは、そのスライドの最初の行（見出し行と区切りの行の後）から
    expect(lines[tables[1]!.src.start - 1]).toBe(tables[1]!.blocks[0]!.raw.split('\n')[2]);
  });

  it('split: manual なら分けない', () => {
    expect(planSplit(slidesOf(`---\nsplit: manual\n---\n\n${md}`)).jobs).toEqual([]);
  });
});

describe('ステップと自動分割（#56）', () => {
  const list = (nums: number[]) =>
    `## A\n\n${nums.map((n) => `- ${n}番目に出る {step=${n}}`).join('\n')}\n\n## B\n\n本文\n`;

  it('明示の番号が逆順のリストは、途中で分けない（1枚に縮小する）', () => {
    const atoms = atomize(blocksOf(list([4, 3, 2, 1])));
    const pages = splitAtoms(atoms, uniform(atoms.length, 150));
    expect(pages).toHaveLength(1);
  });

  it('明示の番号が文書の順なら、途中で分けてよい', () => {
    const atoms = atomize(blocksOf(list([1, 2, 3, 4])));
    const pages = splitAtoms(atoms, uniform(atoms.length, 150));
    expect(pages.length).toBeGreaterThan(1);
  });

  it('同じ番号（同時に出す要素）の間では分けない', () => {
    const atoms = atomize(blocksOf(list([1, 1, 2, 2])));
    const pages = splitAtoms(atoms, uniform(atoms.length, 150));
    expect(pages.map((p) => [p.start, p.end])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });
});

describe('長いコードを行で分ける（#82）', () => {
  const code = (n: number, info = 'ts') =>
    [
      `\`\`\`${info}`,
      ...Array.from({ length: n }, (_, i) => (i % 4 === 3 ? '' : `line${i}();`)),
      '```',
    ].join('\n');

  it('8行以上のコードは行ごとの原子にし、枠の分の高さを測るための head を持つ', () => {
    const atoms = atomize(blocksOf(`## A\n\n${code(10)}\n`));
    expect(atoms.map((a) => a.kind)).toEqual(Array(10).fill('code-line'));
    expect(atoms[0]!.block.raw).toBe('```ts\nline0();\n```');
    expect(atoms[0]!.group!.head).toBe('```ts\n```');
    expect(atoms[1]!.block.src).toEqual({ start: 5, end: 5 });
  });

  it('短いコード・図にするコード・属性のあるコードは分けない', () => {
    const kinds = (md: string) => atomize(blocksOf(md)).map((a) => a.kind);
    expect(kinds(`## A\n\n${code(5)}\n`)).toEqual(['code']);
    expect(kinds(`## A\n\n${code(10, 'mermaid')}\n`)).toEqual(['code']);
    expect(kinds(`## A\n\n${code(10, 'ts {step}')}\n`)).toEqual(['code']);
  });

  it('空行の後では区切りやすく（70）、ほかの行の間は区切りにくい（90）', () => {
    const atoms = atomize(blocksOf(`## A\n\n${code(12)}\n`));
    // 4行目（index 3）が空行：index 4 の直前は空行の後
    expect(breakPenalty(atoms, 4, DEFAULT_WEIGHTS)).toBe(70);
    expect(breakPenalty(atoms, 5, DEFAULT_WEIGHTS)).toBe(90);
    // 1〜2行だけが残る区切りは、さらに重くする
    expect(breakPenalty(atoms, 2, DEFAULT_WEIGHTS)).toBe(90 + DEFAULT_WEIGHTS.orphan);
  });

  it('分けたページでは、行をまとめて1つのコードに戻す', () => {
    const deck = slidesOf(`## A\n\n${code(24)}\n`);
    const plan = planSplit(deck);
    const m = uniform(plan.targets[0]!.atoms.length, 60, 480);
    m.heads = m.heads.map(() => 20);
    const pages = applySplit(deck, plan, [m]).slides;
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const block = page.blocks.find((b) => b.kind === 'code')!;
      expect(block.raw.startsWith('```ts\n')).toBe(true);
      expect(block.raw.endsWith('\n```')).toBe(true);
    }
    // 2枚目は空行の後の行から始まる
    const second = pages[1]!.blocks.find((b) => b.kind === 'code')!.raw.split('\n')[1];
    expect(second).toMatch(/^line\d+\(\);$/);
    expect(Number(/line(\d+)/.exec(second!)![1]) % 4).toBe(0);
  });
});
