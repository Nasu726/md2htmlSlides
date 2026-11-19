import { ATTRIBUTE_KEYS, CONTAINERS, DIRECTIVES, FRONTMATTER_KEYS, LAYOUTS } from '@mdhs/core';
import { describe, expect, it } from 'vitest';
import { CHEAT_SECTIONS, SNIPPETS, cheatGroups, cheatSheet } from './cheatsheet.js';

describe('早見表（#99）', () => {
  const items = cheatSheet();

  it('構文の定義（属性・コンテナ・指示・レイアウト・フロントマター）は、どれも早見表に出る', () => {
    const codes = items.map((it) => it.code);
    const has = (pattern: RegExp) => codes.some((code) => pattern.test(code));
    for (const k of ATTRIBUTE_KEYS) expect(has(new RegExp(`[{ ]${k.name}\\b`)), k.name).toBe(true);
    for (const c of CONTAINERS) expect(has(new RegExp(`^:::${c.name}$`)), c.name).toBe(true);
    for (const d of DIRECTIVES) expect(has(new RegExp(`^::${d.name}$`)), d.name).toBe(true);
    for (const l of LAYOUTS) expect(codes, l).toContain(`{layout=${l}}`);
    for (const k of FRONTMATTER_KEYS) expect(codes, k.name).toContain(`${k.name}:`);
  });

  it('分け方に書いた名前は、どれも定義にある（名前を変えたら、分け方も直す）', () => {
    for (const { entries } of CHEAT_SECTIONS) {
      for (const entry of entries) {
        if ('attr' in entry) expect(ATTRIBUTE_KEYS.map((k) => k.name)).toContain(entry.attr);
        if ('container' in entry) expect(CONTAINERS.map((c) => c.name)).toContain(entry.container);
        if ('directive' in entry) expect(DIRECTIVES.map((d) => d.name)).toContain(entry.directive);
        if ('snippet' in entry) expect(SNIPPETS.map((s) => s.label)).toContain(entry.snippet);
      }
    }
  });

  it('同じ書き方は1回だけ出し、雛形があれば雛形を使う', () => {
    const codes = items.map((it) => it.code);
    expect(new Set(codes).size).toBe(codes.length);
    // `{bg}` は「背景画像」の雛形（画像ごと入れる）で出す
    expect(items.find((it) => it.code === '{bg}')?.snippet.text).toBe('![](bg.jpg){bg}');
    // `:::row` は雛形の「横に並べる」
    expect(items.find((it) => it.code === ':::row')?.label).toBe('横に並べる');
    // `{layout=…}` だけの行は出さない（レイアウトごとの行がある）
    expect(codes.filter((code) => code.startsWith('{layout='))).toHaveLength(LAYOUTS.length);
  });

  it('分類の順に並び、どの分類にも項目がある', () => {
    const groups = cheatGroups(items, '');
    expect(groups.map((g) => g.group)).toEqual(CHEAT_SECTIONS.map((s) => s.group));
    expect(groups[0]!.items.map((it) => it.code).slice(0, 3)).toEqual([
      '# 章の名前',
      '## 見出し',
      '---',
    ]);
    const background = groups.find((g) => g.group === '背景')!;
    expect(background.items.map((it) => it.code)).toEqual(
      expect.arrayContaining(['{bg}', '{bg=left}', '{dim=0.5}', '{blur=8}', '{fill=blur}']),
    );
  });

  it('検索すると、当てはまる項目がある分類だけを出す', () => {
    const groups = cheatGroups(items, '背景');
    expect(groups.map((g) => g.group)).toContain('背景');
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(cheatGroups(items, 'notes').map((g) => g.group)).toEqual(['発表者ノート']);
  });
});
