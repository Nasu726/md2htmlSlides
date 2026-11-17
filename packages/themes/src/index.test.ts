import { describe, expect, it } from 'vitest';
import { THEMES, isThemeId, themeCss } from './index.js';

describe('themeCss（#66）', () => {
  it('3つのテーマは、それぞれのセレクタの中だけに効き、配色が違う', () => {
    const css = Object.fromEntries(THEMES.map((id) => [id, themeCss(id)]));
    for (const id of THEMES) {
      const selectors = css[id]!.match(/^[^{}\n]+(?=\s*\{)/gm) ?? [];
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) expect(selector).toContain(`.theme-${id}`);
    }
    const bg = (id: string) => /--mds-bg:\s*([^;]+);/.exec(css[id]!)?.[1];
    expect(new Set(THEMES.map(bg)).size).toBe(2); // clean と bold は白、dark は暗い
    expect(bg('dark')).toBe('#0b1120');
  });

  it('bold の色面は accent に合わせて変わる（色面の中では accent を別の色にする）', () => {
    const css = themeCss('bold');
    expect(css).toContain('--mds-strong: var(--mds-accent);');
    expect(css).toMatch(/\.layout-section[^{]*\{[^}]*background: var\(--mds-strong\)/);
  });
});

describe('themes', () => {
  it('最初のテーマは clean・dark・bold の3つ', () => {
    expect(THEMES).toEqual(['clean', 'dark', 'bold']);
  });

  it('テーマ名かどうかを判定できる', () => {
    expect(isThemeId('dark')).toBe(true);
    expect(isThemeId('Dark')).toBe(false);
    expect(isThemeId('minimal')).toBe(false);
  });
});
