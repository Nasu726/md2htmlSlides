import { describe, expect, it } from 'vitest';
import type { Diagnostic } from './diagnostics.js';
import { DEFAULT_META, parseMeta, splitFrontmatter } from './frontmatter.js';

function meta(text: string) {
  const diagnostics: Diagnostic[] = [];
  const split = splitFrontmatter(text, diagnostics);
  return { meta: parseMeta(split.frontmatter, diagnostics), diagnostics, split };
}

describe('splitFrontmatter', () => {
  it('フロントマターがなければ全体が本文', () => {
    const { split } = meta('# タイトル\n\n本文');
    expect(split.frontmatter).toBeNull();
    expect(split.bodyStartLine).toBe(1);
  });

  it('本文の開始行は、閉じる --- の次の行', () => {
    const { split } = meta('---\ntitle: A\ntheme: dark\n---\n# 見出し');
    expect(split.frontmatter).toEqual({ yaml: 'title: A\ntheme: dark', startLine: 1, endLine: 4 });
    expect(split.body).toBe('# 見出し');
    expect(split.bodyStartLine).toBe(5);
  });

  it('閉じていないフロントマターは警告して本文として扱う', () => {
    const { split, diagnostics } = meta('---\ntitle: A\n# 見出し');
    expect(split.frontmatter).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['frontmatter/unclosed']);
  });
});

describe('parseMeta', () => {
  it('何も書かなければ既定値', () => {
    expect(meta('# A').meta).toEqual(DEFAULT_META);
  });

  it('値を読み、既定値を上書きする', () => {
    const { meta: m, diagnostics } = meta(
      [
        '---',
        'title: 発表',
        'theme: dark',
        'aspect: 4:3',
        'slideLevel: 2',
        'titleSlide: false',
        'paginate: false',
        'accent: "#e11d48"',
        'date: 2026-11-16',
        '---',
      ].join('\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(m).toMatchObject({
      title: '発表',
      theme: 'dark',
      aspect: '4:3',
      slideLevel: 2,
      titleSlide: false,
      paginate: false,
      accent: '#e11d48',
      date: '2026-11-16',
    });
  });

  it('著者は文字列・配列・{ name, affiliation } のどれでも書ける', () => {
    expect(meta('---\nauthor: 山田\n---').meta.authors).toEqual([{ name: '山田' }]);
    expect(meta('---\nauthor: [山田, 佐藤]\naffiliation: ○○大学\n---').meta).toMatchObject({
      affiliation: '○○大学',
      authors: [
        { name: '山田', affiliation: '○○大学' },
        { name: '佐藤', affiliation: '○○大学' },
      ],
    });
    const objects = meta(
      '---\nauthor:\n  - name: 山田\n    affiliation: ○○大学\n  - name: 佐藤\n---',
    );
    expect(objects.meta.authors).toEqual([
      { name: '山田', affiliation: '○○大学' },
      { name: '佐藤' },
    ]);
  });

  it('未知のキーは行番号と修正の候補を付けて警告する', () => {
    const { diagnostics } = meta('---\ntitle: A\nthme: dark\n---');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'frontmatter/unknown-key',
        line: 3,
        suggestion: 'theme',
      }),
    ]);
  });

  it('値が正しくなければ警告して既定値を使う', () => {
    const { meta: m, diagnostics } = meta('---\ntheme: pastel\npaginate: yes\n---');
    expect(m.theme).toBe('clean');
    expect(m.paginate).toBe(true);
    expect(diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['frontmatter/invalid-value', 2],
      ['frontmatter/invalid-value', 3],
    ]);
    expect(diagnostics[0]!.message).toContain('clean・dark・bold');
  });

  it('YAML として読めなければエラーにする', () => {
    const { diagnostics } = meta('---\ntitle: [閉じていない\n---');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'frontmatter/yaml' });
  });
});
