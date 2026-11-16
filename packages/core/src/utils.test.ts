import { describe, expect, it } from 'vitest';
import { hashString } from './hash.js';
import { SlugRegistry, slugify } from './slug.js';
import { closest, editDistance } from './suggest.js';

describe('slugify', () => {
  it('GitHub の見出しアンカーに近い ID を作る', () => {
    expect(slugify('SQL の基本')).toBe('sql-の基本');
    expect(slugify('Before / After')).toBe('before--after');
    expect(slugify('1.1 最初に用意するキー（MVP）')).toBe('11-最初に用意するキーmvp');
  });

  it('重複する ID には連番を付ける', () => {
    const slugs = new SlugRegistry();
    expect([slugs.next('まとめ'), slugs.next('まとめ'), slugs.next('まとめ')]).toEqual([
      'まとめ',
      'まとめ-1',
      'まとめ-2',
    ]);
    expect(slugs.next('！？')).toBe('section');
  });
});

describe('closest', () => {
  it('編集距離が2以下の候補を返す', () => {
    expect(editDistance('lyout', 'layout')).toBe(1);
    expect(closest('lyout', ['layout', 'keep', 'ratio'])).toBe('layout');
    expect(closest('Theme', ['theme'])).toBe('theme');
    expect(closest('name', ['layout', 'keep'])).toBeUndefined();
  });
});

describe('hashString', () => {
  it('同じ入力からは同じ16桁の値を返す', () => {
    expect(hashString('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});
