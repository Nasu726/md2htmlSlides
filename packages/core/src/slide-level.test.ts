import { describe, expect, it } from 'vitest';
import { detectSlideLevel, scanHeadings } from './slide-level.js';

const level = (markdown: string) => detectSlideLevel(scanHeadings(markdown.split('\n')));

describe('detectSlideLevel', () => {
  it('# タイトル → ## 節 → ### 小見出し は 2', () => {
    expect(level('# 題\n\n導入\n\n## 節1\n\n本文\n\n## 節2\n\n本文\n\n### 小\n\n本文')).toBe(2);
  });

  it('子の見出しを持つ ## しかなければ、### がスライドの単位になる（規則どおり）', () => {
    expect(level('# 題\n\n導入\n\n## 節\n\n本文\n\n### 小\n\n本文')).toBe(3);
  });

  it('章（#）の直後に導入文があっても、子の見出しを持つので数えない', () => {
    expect(level('# 章1\n\n導入文\n\n## 節\n\n本文\n\n# 章2\n\n## 節\n\n本文')).toBe(2);
  });

  it('H1 だけで、それぞれに本文があれば 1', () => {
    expect(level('# A\n\n本文\n\n# B\n\n本文')).toBe(1);
  });

  it('当てはまる見出しがなければ最も深いレベル', () => {
    expect(level('# A\n## B\n### C')).toBe(3);
    expect(level('本文だけ')).toBe(1);
  });

  it('コードブロックの中の # は見出しにしない', () => {
    const headings = scanHeadings('## 節\n\n```sh\n# コメント\n```\n'.split('\n'));
    expect(headings.map((h) => h.level)).toEqual([2]);
  });
});
