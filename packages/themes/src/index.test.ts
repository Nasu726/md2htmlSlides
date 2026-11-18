import { describe, expect, it } from 'vitest';
import { SERIF_FAMILY, THEMES, isThemeId, themeCss, themeFonts } from './index.js';

describe('themeCss（#66）', () => {
  it('どのテーマも、それぞれのセレクタの中だけに効き、配色が違う', () => {
    const css = Object.fromEntries(THEMES.map((id) => [id, themeCss(id)]));
    for (const id of THEMES) {
      const selectors = css[id]!.match(/^[^{}\n]+(?=\s*\{)/gm) ?? [];
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) expect(selector).toContain(`.theme-${id}`);
    }
    const bg = (id: string) => /--mds-bg:\s*([^;]+);/.exec(css[id]!)?.[1];
    // clean・bold・band・academic は白、dark は暗い、pop はクリーム色
    expect(new Set(THEMES.map(bg)).size).toBe(3);
    expect(bg('dark')).toBe('#0b1120');
    expect(bg('pop')).toBe('#fffaf0');
    const accent = (id: string) => /--mds-accent:\s*([^;]+);/.exec(css[id]!)?.[1];
    expect(new Set(THEMES.map(accent)).size).toBe(THEMES.length);
  });

  it('bold の色面は accent に合わせて変わる（色面の中では accent を別の色にする）', () => {
    const css = themeCss('bold');
    expect(css).toContain('--mds-strong: var(--mds-accent);');
    expect(css).toMatch(/\.layout-title[^{]*\{[^}]*background: var\(--mds-strong\)/);
  });

  it('bold・band の章扉は、一面を色で塗らない（番号と線・見出しの帯。#100）', () => {
    for (const id of ['bold', 'band'] as const) {
      const css = themeCss(id);
      // 章扉のスライドそのもの（.layout-section の直後に { が来る規則）に背景の色を付けない
      expect(css, id).not.toMatch(/\.layout-section(:not\([^)]*\))?\s*[,{][^}]*background:/);
      expect(css, id).toContain('counter(mds-section, decimal-leading-zero)');
    }
  });
});

describe('band・academic・pop（#93）', () => {
  it('band の帯の色は accent に合わせて変わる', () => {
    const css = themeCss('band');
    expect(css).toContain('--mds-band: var(--mds-accent);');
    expect(css).toMatch(/\.layout-title[^{]*\{[^}]*background: var\(--mds-band\)/);
  });

  it('academic だけが見出しに明朝体を使い、その書体を読み込む', () => {
    expect(themeCss('academic')).toMatch(/--mds-font-heading: 'MDS Noto Serif JP'/);
    for (const id of THEMES) {
      expect(themeFonts(id).includes(SERIF_FAMILY), id).toBe(id === 'academic');
      expect(themeFonts(id)).toContain('MDS Noto Sans JP');
    }
  });
});

describe('themes', () => {
  it('テーマは clean・dark・bold と、#93 で足した band・academic・pop', () => {
    expect(THEMES).toEqual(['clean', 'dark', 'bold', 'band', 'academic', 'pop']);
  });

  it('テーマ名かどうかを判定できる', () => {
    expect(isThemeId('dark')).toBe(true);
    expect(isThemeId('Dark')).toBe(false);
    expect(isThemeId('minimal')).toBe(false);
  });
});
